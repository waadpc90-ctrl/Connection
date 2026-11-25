import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Camera,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Layers,
  Save,
  Table2,
  Trash2,
} from 'lucide-react';
import {
  buildGradeWhatsAppMessage,
  buildPassUrl,
  buildStudentSummaryWhatsAppMessage,
  computePassMetrics,
  deleteGradeEntryAndSyncPass,
  pushInstantSummaryAlertToSection,
  saveClassGradesBatch,
} from '../lib/wisaalService';
import {
  AttendanceLog,
  classifyPercentage,
  Classroom,
  DEFAULT_SUBJECTS,
  formatArabicDate,
  getTodayIso,
  GradeEntry,
  School,
  StageId,
  Student,
} from '../types/wisaal';
import { GradeImageUploadPanel } from './GradeImageUploadPanel';

interface GradesTabProps {
  uid: string;
  school: School;
  stageId: StageId;
  stageName: string;
  stageToken: string;
  classrooms: Classroom[];
  students: Student[];
  attendanceLogs: AttendanceLog[];
  gradeEntries: GradeEntry[];
  onPreviewPass: (passToken: string) => void;
  onPreviewStagePortal: (stageToken: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

const QUICK_NOTES = [
  'أداء متميز وتفاعل رائع',
  'تحسن ملحوظ، استمر',
  'يحتاج مراجعة الدروس السابقة',
];

type GradeSubMode = 'photo' | 'manual' | 'summary';

export function GradesTab({
  uid,
  school,
  stageId,
  stageName,
  stageToken,
  classrooms,
  students,
  attendanceLogs,
  gradeEntries,
  onPreviewPass,
  onPreviewStagePortal,
  onNotify,
}: GradesTabProps) {
  const [subMode, setSubMode] = useState<GradeSubMode>('photo');
  const [selectedClassId, setSelectedClassId] = useState<string>(classrooms[0]?.id || '');
  const [subject, setSubject] = useState<string>(DEFAULT_SUBJECTS[0]);
  const [customSubject, setCustomSubject] = useState<string>('');
  const [title, setTitle] = useState<string>('امتحان الشهر الأول');
  const [maxScore, setMaxScore] = useState<number>(100);
  const [date, setDate] = useState<string>(getTodayIso());

  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [broadcasting, setBroadcasting] = useState<boolean>(false);
  const [lastBroadcastSubject, setLastBroadcastSubject] = useState<string>('');

  const [dispatchFilter, setDispatchFilter] = useState<'all' | 'high' | 'attention'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Keep selectedClassId strictly synced to classrooms of the active stage
  useEffect(() => {
    const existsInStage = classrooms.some((c) => c.id === selectedClassId);
    if (!existsInStage) {
      setSelectedClassId(classrooms[0]?.id || '');
    }
  }, [classrooms, selectedClassId]);

  const activeSubject = customSubject.trim() || subject;
  const activeClassroom = classrooms.find((c) => c.id === selectedClassId);

  const classStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === selectedClassId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')),
    [students, selectedClassId]
  );

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const enteredCount = useMemo(
    () =>
      classStudents.filter((s) => {
        const val = scores[s.id];
        return val !== undefined && val.trim() !== '' && !Number.isNaN(Number(val));
      }).length,
    [classStudents, scores]
  );

  // All distinct subjects recorded for this section (for multi-subject aggregation table)
  const sectionSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const g of gradeEntries) {
      if (g.classId === selectedClassId) set.add(g.subject);
    }
    return Array.from(set);
  }, [gradeEntries, selectedClassId]);

  // Precomputed full multi-subject summary per student in this section
  const sectionSummaryRows = useMemo(() => {
    return classStudents.map((student) => {
      const metrics = computePassMetrics(student.id, attendanceLogs, gradeEntries, stageId);
      const bySub = new Map(metrics.subjectSummaries.map((s) => [s.subject, s]));
      return { student, metrics, bySub };
    });
  }, [classStudents, attendanceLogs, gradeEntries, stageId]);

  const handleKeyDownScore = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextStudent = classStudents[index + 1];
      if (nextStudent) {
        inputRefs.current[nextStudent.id]?.focus();
      }
    }
  };

  const publishBatchAndOpenSummary = async (
    batchScores: Record<string, string>,
    batchNotes: Record<string, string>
  ) => {
    setSaving(true);
    try {
      const created = await saveClassGradesBatch(
        uid,
        school,
        stageId,
        classStudents,
        attendanceLogs,
        gradeEntries,
        {
          subject: activeSubject,
          title: title.trim() || 'تقييم مادة',
          maxScore,
          date,
          scores: batchScores,
          notes: batchNotes,
        }
      );
      setScores({});
      setNotes({});
      setLastBroadcastSubject(activeSubject);
      setSubMode('summary');
      onNotify(
        'success',
        `تم رصد ${created.length} درجة لمادة ${activeSubject} وتجميع خلاصة المواد وإرسال الإشعار الفوري عبر الموقع لبوابة المرحلة وجميع البطاقات.`
      );
    } catch {
      onNotify('error', 'تعذر حفظ الدرجات. تأكد من أن كل درجة لا تتجاوز الدرجة العظمى.');
    } finally {
      setSaving(false);
    }
  };

  const handleManualPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      onNotify('error', 'يرجى كتابة عنوان الاختبار أو التقييم.');
      return;
    }
    if (enteredCount === 0) {
      onNotify('error', 'أدخل درجة واحدة على الأقل قبل النشر.');
      return;
    }
    await publishBatchAndOpenSummary(scores, notes);
  };

  const handlePushInstantSummaryAll = async () => {
    if (classStudents.length === 0) return;
    setBroadcasting(true);
    try {
      await pushInstantSummaryAlertToSection(
        school,
        stageId,
        classStudents,
        attendanceLogs,
        gradeEntries
      );
      onNotify(
        'success',
        `تم إرسال إشعار فوري عبر الموقع بالخلاصة الشاملة لبوابة باركود ${stageName} وبطاقات جميع طلاب ${activeClassroom?.name || 'الشعبة'} (${classStudents.length} طالب).`
      );
    } catch {
      onNotify('error', 'تعذر إرسال الإشعار الفوري الآن.');
    } finally {
      setBroadcasting(false);
    }
  };

  const filteredRecentGrades = useMemo(() => {
    return gradeEntries
      .filter((g) => !selectedClassId || g.classId === selectedClassId)
      .filter((g) => {
        const pct = Math.round((g.score / Math.max(1, g.maxScore)) * 100);
        if (dispatchFilter === 'high') return pct >= 85;
        if (dispatchFilter === 'attention') return pct < 70;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
  }, [gradeEntries, selectedClassId, dispatchFilter]);

  const handleCopy = async (id: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedId(id);
      onNotify('success', 'تم نسخ نص التبليغ.');
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر النسخ إلى الحافظة.');
    }
  };

  const handleDeleteGrade = async (entry: GradeEntry) => {
    try {
      await deleteGradeEntryAndSyncPass(
        uid,
        entry,
        studentById.get(entry.studentId),
        attendanceLogs,
        gradeEntries
      );
      setConfirmDeleteId(null);
      onNotify('success', 'تم حذف الدرجة وإعادة حساب خلاصة بطاقة الطالب.');
    } catch {
      onNotify('error', 'تعذر حذف الدرجة.');
    }
  };

  if (classrooms.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="font-display text-lg font-bold text-slate-900 mb-1">
          لا توجد شعب مضافة في {stageName} بعد
        </p>
        <p className="text-sm text-slate-600">
          انتقل إلى تبويب «الطلاب وبطاقات QR» لإضافة شعب {stageName} ثم ابدأ برفع كشوف الدرجات.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Shared Section + Subject Context Bar & Mode Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setSubMode('photo')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subMode === 'photo'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Camera className="w-3.5 h-3.5 text-emerald-700" />
              <span>رفع صورة كشف الشعبة</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('manual')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subMode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-700" />
              <span>إدخال يدوي سريع</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('summary')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                subMode === 'summary'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-700" />
              <span>تجميع المواد وإرسال الخلاصة للجميع</span>
            </button>
          </div>

          <p className="text-xs text-slate-500">
            المرحلة النشطة: <strong className="text-slate-800">{stageName}</strong> · الشعب:{' '}
            <span className="font-mono tabular-nums">{classrooms.length}</span>
          </p>
        </div>

        {/* Assessment Metadata Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 pt-2 border-t border-slate-100">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الشعبة</label>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            >
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">المادة الدراسية</label>
            <select
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setCustomSubject('');
              }}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            >
              {DEFAULT_SUBJECTS.map((sub) => (
                <option key={sub} value={sub}>
                  {sub}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">عنوان الامتحان</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="امتحان الشهر الأول"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">الدرجة العظمى</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={maxScore}
              onChange={(e) => setMaxScore(Math.max(1, Number(e.target.value) || 100))}
              className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">تاريخ الرصد</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>
        </div>
      </div>

      {/* MODE 1: Photo Grade Sheet Extraction */}
      {subMode === 'photo' && (
        <GradeImageUploadPanel
          sectionName={activeClassroom?.name || 'الشعبة'}
          stageName={stageName}
          subject={activeSubject}
          maxScore={maxScore}
          sectionStudents={classStudents}
          onDetectedMetadata={(meta) => {
            if (meta.subject) {
              if (DEFAULT_SUBJECTS.includes(meta.subject)) {
                setSubject(meta.subject);
                setCustomSubject('');
              } else {
                setCustomSubject(meta.subject);
              }
            }
            if (meta.maxScore && meta.maxScore > 0) {
              setMaxScore(meta.maxScore);
            }
            onNotify('success', 'تم تحديث المادة والدرجة العظمى من ترويسة الكشف.');
          }}
          onPublishExtracted={publishBatchAndOpenSummary}
          onNotify={onNotify}
        />
      )}

      {/* MODE 2: Rapid Manual Keyboard Entry */}
      {subMode === 'manual' && (
        <form
          onSubmit={handleManualPublish}
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                إدخال درجات {activeSubject} — {activeClassroom?.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                اضغط Enter بعد كل درجة للانتقال التلقائي للطالب التالي، ثم انشرها لبطاقات الجميع.
              </p>
            </div>
            <button
              type="submit"
              disabled={saving || enteredCount === 0}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'جاري النشر...' : `نشر وتحديث بطاقات الجميع (${enteredCount})`}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-5">الطالب</th>
                  <th className="py-3 px-4 w-36">الدرجة (من {maxScore})</th>
                  <th className="py-3 px-4 w-32">التقدير</th>
                  <th className="py-3 px-5">ملاحظة المعلم لولي الأمر</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {classStudents.map((student, index) => {
                  const raw = scores[student.id] ?? '';
                  const hasNum = raw.trim() !== '' && !Number.isNaN(Number(raw));
                  const pct = hasNum
                    ? Math.round(
                        (Math.min(maxScore, Math.max(0, Number(raw))) / Math.max(1, maxScore)) * 100
                      )
                    : null;
                  const rating = pct !== null ? classifyPercentage(pct) : null;

                  return (
                    <tr key={student.id} className="hover:bg-slate-50/60">
                      <td className="py-3 px-5">
                        <p className="font-medium text-slate-900">{student.fullName}</p>
                        <p className="text-xs text-slate-500 font-mono tabular-nums">
                          {student.studentCode}
                        </p>
                      </td>

                      <td className="py-3 px-4">
                        <input
                          ref={(el) => {
                            inputRefs.current[student.id] = el;
                          }}
                          type="number"
                          step="0.5"
                          min={0}
                          max={maxScore}
                          value={raw}
                          onKeyDown={(e) => handleKeyDownScore(index, e)}
                          onChange={(e) =>
                            setScores((prev) => ({ ...prev, [student.id]: e.target.value }))
                          }
                          placeholder="—"
                          className="w-24 px-3 py-1.5 text-sm font-mono tabular-nums text-center bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                        />
                      </td>

                      <td className="py-3 px-4 font-mono tabular-nums text-xs">
                        {rating && pct !== null ? (
                          <span
                            className={`font-semibold ${
                              rating.tier === 'excellent' || rating.tier === 'very-good'
                                ? 'text-emerald-700'
                                : rating.tier === 'good'
                                  ? 'text-amber-700'
                                  : 'text-rose-700'
                            }`}
                          >
                            {pct}% · {rating.label}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      <td className="py-3 px-5">
                        <div className="space-y-1.5">
                          <input
                            type="text"
                            value={notes[student.id] || ''}
                            onChange={(e) =>
                              setNotes((prev) => ({ ...prev, [student.id]: e.target.value }))
                            }
                            maxLength={300}
                            placeholder="ملاحظة تربوية اختيارية..."
                            className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                          />
                          <div className="flex flex-wrap gap-1.5">
                            {QUICK_NOTES.map((quick) => (
                              <button
                                key={quick}
                                type="button"
                                onClick={() =>
                                  setNotes((prev) => ({ ...prev, [student.id]: quick }))
                                }
                                className="text-[11px] text-slate-500 hover:text-emerald-800 underline underline-offset-2 transition-colors"
                              >
                                {quick}
                              </button>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {/* MODE 3: Aggregated Multi-Subject Summary Card & Instant In-Website Broadcast */}
      {subMode === 'summary' && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900">
                خلاصة جميع المواد لطلاب {activeClassroom?.name} ({stageName})
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                يجمع النظام تلقائياً درجات كل طالب من جميع المواد في هذه المرحلة مع سجل غيابه في بطاقة
                خلاصة واحدة ويُشعر أولياء الأمور عبر الموقع فوراً بدون واتساب.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {stageToken && (
                <button
                  type="button"
                  onClick={() => onPreviewStagePortal(stageToken)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                  <span>معاينة بوابة المرحلة</span>
                </button>
              )}

              <button
                type="button"
                disabled={broadcasting || classStudents.length === 0}
                onClick={handlePushInstantSummaryAll}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>
                  {broadcasting
                    ? 'جاري إرسال الإشعار...'
                    : 'إرسال إشعار فوري للجميع عبر الموقع'}
                </span>
              </button>
            </div>
          </div>

          {classStudents.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا يوجد طلاب في هذه الشعبة بعد.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">الطالب</th>
                    {sectionSubjects.map((sub) => (
                      <th key={sub} className="py-3 px-3 text-center whitespace-nowrap">
                        {sub}
                      </th>
                    ))}
                    <th className="py-3 px-3 text-center whitespace-nowrap">المجموع والمعدل</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">الغياب</th>
                    <th className="py-3 px-4 text-left whitespace-nowrap">بطاقة الخلاصة الحية</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sectionSummaryRows.map(({ student, metrics, bySub }) => {
                    const rating = classifyPercentage(metrics.averagePercent);
                    const passUrl = buildPassUrl(student.passToken);
                    const summaryMsg = buildStudentSummaryWhatsAppMessage(
                      school.name,
                      stageName,
                      student,
                      metrics,
                      passUrl,
                      lastBroadcastSubject || undefined
                    );

                    return (
                      <tr key={student.id} className="hover:bg-slate-50/60">
                        <td className="py-3.5 px-4">
                          <p className="font-semibold text-slate-900 whitespace-nowrap">
                            {student.fullName}
                          </p>
                          <p className="text-xs text-slate-500 font-mono tabular-nums">
                            {student.studentCode}
                          </p>
                        </td>

                        {sectionSubjects.map((sub) => {
                          const s = bySub.get(sub);
                          return (
                            <td
                              key={sub}
                              className="py-3.5 px-3 text-center font-mono tabular-nums text-xs"
                            >
                              {s ? (
                                <span className="font-semibold text-slate-900">
                                  {s.latestScore}
                                  <span className="text-slate-400">/{s.latestMaxScore}</span>
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}

                        <td className="py-3.5 px-3 text-center font-mono tabular-nums text-xs whitespace-nowrap">
                          {metrics.subjectsCount > 0 ? (
                            <div>
                              <span className="font-bold text-slate-900">
                                {metrics.totalScoreSum}/{metrics.totalMaxScoreSum}
                              </span>
                              <p
                                className={`font-semibold ${
                                  rating.tier === 'excellent' || rating.tier === 'very-good'
                                    ? 'text-emerald-700'
                                    : rating.tier === 'good'
                                      ? 'text-amber-700'
                                      : 'text-rose-700'
                                }`}
                              >
                                {metrics.averagePercent}% · {rating.label}
                              </p>
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        <td className="py-3.5 px-3 text-center font-mono tabular-nums text-xs">
                          <span
                            className={
                              metrics.totalAbsent >= school.absenceAlertThreshold
                                ? 'font-bold text-rose-700'
                                : 'text-slate-700'
                            }
                          >
                            {metrics.totalAbsent}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 ml-1 whitespace-nowrap">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>محدّثة حياً</span>
                            </span>

                            <button
                              type="button"
                              onClick={() => handleCopy(`sum_${student.id}`, summaryMsg)}
                              title="نسخ ملخص الدرجات"
                              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg"
                            >
                              {copiedId === `sum_${student.id}` ? (
                                <Check className="w-4 h-4 text-emerald-700" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => onPreviewPass(student.passToken)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                              <span>فتح البطاقة</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Recent Subject Entries Log for this Section (Stage-Isolated) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              سجل درجات المواد المرصودة ({activeClassroom?.name})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              درجات هذه المرحلة فقط — تُحدّث تلقائياً في بطاقة ولي الأمر وبوابة باركود المرحلة عبر
              الموقع.
            </p>
          </div>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'high', label: 'المتفوقون (85%+)' },
                { id: 'attention', label: 'يحتاج متابعة (<70%)' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDispatchFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  dispatchFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredRecentGrades.length === 0 ? (
          <p className="text-sm text-slate-500 py-8 text-center border border-dashed border-slate-200 rounded-lg">
            لا توجد درجات مطابقة لهذا التصنيف في الشعبة المحددة.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredRecentGrades.map((entry) => {
              const student = studentById.get(entry.studentId);
              const pct = Math.round((entry.score / Math.max(1, entry.maxScore)) * 100);
              const rating = classifyPercentage(pct);
              const passUrl = student ? buildPassUrl(student.passToken) : window.location.origin;
              const msg = student
                ? buildGradeWhatsAppMessage(school.name, stageName, student, entry, passUrl)
                : '';

              return (
                <div
                  key={entry.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {entry.studentName} ·{' '}
                      <span className="font-normal text-slate-700">
                        {entry.subject} ({entry.title})
                      </span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span className="font-mono tabular-nums font-semibold text-slate-900">
                        {entry.score} / {entry.maxScore} ({pct}%)
                      </span>
                      <span>·</span>
                      <span
                        className={
                          rating.tier === 'excellent' || rating.tier === 'very-good'
                            ? 'text-emerald-700 font-medium'
                            : rating.tier === 'good'
                              ? 'text-amber-700 font-medium'
                              : 'text-rose-700 font-medium'
                        }
                      >
                        {rating.label}
                      </span>
                      <span>·</span>
                      <span>{formatArabicDate(entry.date)}</span>
                      {entry.teacherNote && (
                        <>
                          <span>·</span>
                          <span className="text-slate-600">{entry.teacherNote}</span>
                        </>
                      )}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {student && (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 ml-1 whitespace-nowrap">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>أُشعر عبر الموقع</span>
                        </span>

                        <button
                          type="button"
                          onClick={() => handleCopy(entry.id, msg)}
                          className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          title="نسخ ملخص الدرجة"
                        >
                          {copiedId === entry.id ? (
                            <Check className="w-4 h-4 text-emerald-700" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onPreviewPass(student.passToken)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                          <span>فتح البطاقة</span>
                        </button>
                      </>
                    )}

                    {confirmDeleteId === entry.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteGrade(entry)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg whitespace-nowrap"
                        >
                          تأكيد الحذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(entry.id)}
                        title="حذف الدرجة"
                        className="p-2 text-slate-400 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
