import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BellRing,
  Camera,
  Download,
  ExternalLink,
  Layers,
  Pencil,
  Plus,
  Save,
  Table2,
  Trash2,
  X,
} from 'lucide-react';
import { exportSectionGradesCsv } from '../lib/csvExport';
import {
  computePassMetrics,
  deleteGradeEntryAndSyncPass,
  pushInstantSummaryAlertToSection,
  saveClassGradesBatch,
  updateStageSubjects,
} from '../lib/wisaalService';
import {
  AttendanceLog,
  classifyPercentage,
  Classroom,
  FIELD_LIMITS,
  formatArabicDate,
  getStageSubjects,
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
  const stageSubjects = useMemo(() => getStageSubjects(school, stageId), [school, stageId]);

  const [subMode, setSubMode] = useState<GradeSubMode>('photo');
  const [selectedClassId, setSelectedClassId] = useState<string>(classrooms[0]?.id || '');
  const [subject, setSubject] = useState<string>(() => getStageSubjects(school, stageId)[0]);
  const [customSubject, setCustomSubject] = useState<string>('');
  const [title, setTitle] = useState<string>('امتحان الشهر الأول');
  const [maxScore, setMaxScore] = useState<number>(100);
  const [date, setDate] = useState<string>(getTodayIso());

  const [editingSubjects, setEditingSubjects] = useState<boolean>(false);
  const [draftSubjects, setDraftSubjects] = useState<string[]>(() =>
    getStageSubjects(school, stageId)
  );
  const [newSubjectName, setNewSubjectName] = useState<string>('');
  const [savingSubjects, setSavingSubjects] = useState<boolean>(false);

  const [scores, setScores] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [broadcasting, setBroadcasting] = useState<boolean>(false);

  const [dispatchFilter, setDispatchFilter] = useState<'all' | 'high' | 'attention'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    const existsInStage = classrooms.some((c) => c.id === selectedClassId);
    if (!existsInStage) {
      setSelectedClassId(classrooms[0]?.id || '');
    }
  }, [classrooms, selectedClassId]);

  useEffect(() => {
    setEditingSubjects(false);
    setNewSubjectName('');
    setCustomSubject('');
  }, [stageId]);

  useEffect(() => {
    if (!stageSubjects.includes(subject)) {
      setSubject(stageSubjects[0]);
    }
  }, [stageSubjects, subject]);

  const subjectOptions = useMemo(() => {
    const trimmedCustom = customSubject.trim();
    if (trimmedCustom && !stageSubjects.includes(trimmedCustom)) {
      return [trimmedCustom, ...stageSubjects];
    }
    return stageSubjects;
  }, [stageSubjects, customSubject]);

  const activeSubject = customSubject.trim() || subject;
  const activeClassroom = classrooms.find((c) => c.id === selectedClassId);

  const handleToggleSubjectsEditor = () => {
    if (!editingSubjects) {
      setDraftSubjects([...stageSubjects]);
      setNewSubjectName('');
      setEditingSubjects(true);
    } else {
      setEditingSubjects(false);
    }
  };

  const handleAddDraftSubject = () => {
    const trimmed = newSubjectName.trim().slice(0, FIELD_LIMITS.subject);
    if (!trimmed) return;
    if (draftSubjects.length >= FIELD_LIMITS.maxSchoolSubjects) {
      onNotify('error', `الحد الأقصى ${FIELD_LIMITS.maxSchoolSubjects} مادة.`);
      return;
    }
    if (draftSubjects.some((s) => s.trim() === trimmed)) {
      setNewSubjectName('');
      return;
    }
    setDraftSubjects((prev) => [...prev, trimmed]);
    setNewSubjectName('');
  };

  const handleSaveSubjects = async () => {
    const pending = newSubjectName.trim().slice(0, FIELD_LIMITS.subject);
    const combined = pending ? [...draftSubjects, pending] : draftSubjects;
    const validItems = combined
      .map((s) => s.trim().slice(0, FIELD_LIMITS.subject))
      .filter(Boolean);

    if (validItems.length === 0) {
      onNotify('error', 'أضف مادة واحدة على الأقل.');
      return;
    }

    const selectedIdx = stageSubjects.indexOf(subject);
    setSavingSubjects(true);
    try {
      const saved = await updateStageSubjects(uid, school, stageId, validItems);
      const renamedCandidate =
        selectedIdx >= 0 && draftSubjects[selectedIdx]?.trim()
          ? draftSubjects[selectedIdx].trim()
          : '';
      if (renamedCandidate && saved.includes(renamedCandidate)) {
        setSubject(renamedCandidate);
        setCustomSubject('');
      } else if (!saved.includes(subject)) {
        setSubject(saved[0]);
        setCustomSubject('');
      }
      setNewSubjectName('');
      setEditingSubjects(false);
      onNotify('success', `تم حفظ مواد ${stageName}.`);
    } catch {
      onNotify('error', 'تعذر حفظ المواد.');
    } finally {
      setSavingSubjects(false);
    }
  };

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

  const sectionSubjects = useMemo(() => {
    const set = new Set<string>();
    for (const g of gradeEntries) {
      if (g.classId === selectedClassId) set.add(g.subject);
    }
    return Array.from(set);
  }, [gradeEntries, selectedClassId]);

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
          title: title.trim() || 'تقييم',
          maxScore,
          date,
          scores: batchScores,
          notes: batchNotes,
        }
      );
      setScores({});
      setNotes({});
      setSubMode('summary');
      onNotify('success', `تم نشر ${created.length} درجة لمادة ${activeSubject}.`);
    } catch {
      onNotify('error', 'تعذر حفظ الدرجات.');
    } finally {
      setSaving(false);
    }
  };

  const handleManualPublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || enteredCount === 0) {
      onNotify('error', 'أدخل درجة واحدة على الأقل.');
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
      onNotify('success', 'تم إرسال إشعار الخلاصة للجميع.');
    } catch {
      onNotify('error', 'تعذر الإرسال.');
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
      onNotify('success', 'تم حذف الدرجة.');
    } catch {
      onNotify('error', 'تعذر الحذف.');
    }
  };

  if (classrooms.length === 0) {
    return (
      <div className="bg-white border border-slate-200/80 rounded-xl p-10 text-center text-sm text-slate-500">
        أضف شعبة في {stageName} أولاً
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Mode Switcher & Contextual Inputs */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubMode('photo')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                subMode === 'photo'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <Camera className="w-3.5 h-3.5 text-emerald-700" />
              <span>من صورة</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('manual')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                subMode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-700" />
              <span>يدوي</span>
            </button>

            <button
              type="button"
              onClick={() => setSubMode('summary')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                subMode === 'summary'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-emerald-700" />
              <span>الخلاصة</span>
            </button>
          </div>

          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            aria-label="الشعبة"
            className="px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
          >
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {subMode !== 'summary' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100">
              <div className="flex items-center gap-1.5 col-span-2 sm:col-span-1">
                <select
                  value={activeSubject}
                  onChange={(e) => {
                    const nextVal = e.target.value;
                    if (stageSubjects.includes(nextVal)) {
                      setSubject(nextVal);
                      setCustomSubject('');
                    } else {
                      setCustomSubject(nextVal);
                    }
                  }}
                  aria-label="المادة"
                  className="w-full min-w-0 px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                >
                  {subjectOptions.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleToggleSubjectsEditor}
                  aria-label="تعديل المواد"
                  title="تعديل المواد"
                  className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap ${
                    editingSubjects
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                  }`}
                >
                  <Pencil className="w-3.5 h-3.5 text-emerald-700" />
                  <span>تعديل</span>
                </button>
              </div>

              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="عنوان الامتحان"
                className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <input
                type="number"
                min={1}
                max={1000}
                value={maxScore}
                onChange={(e) => setMaxScore(Math.max(1, Number(e.target.value) || 100))}
                aria-label="الدرجة العظمى"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />

              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="التاريخ"
                className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
              />
            </div>

            {editingSubjects && (
              <div className="p-4 rounded-xl bg-[#F7F8F7] border border-slate-200/80 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-900">
                    تعديل مواد {stageName} ({draftSubjects.length})
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditingSubjects(false)}
                    aria-label="إغلاق"
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-md"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {draftSubjects.map((subItem, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={subItem}
                        maxLength={FIELD_LIMITS.subject}
                        onChange={(e) =>
                          setDraftSubjects((prev) =>
                            prev.map((item, i) => (i === idx ? e.target.value : item))
                          )
                        }
                        placeholder="اسم المادة"
                        className="w-full px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                      />
                      <button
                        type="button"
                        disabled={draftSubjects.length <= 1}
                        onClick={() =>
                          setDraftSubjects((prev) => prev.filter((_, i) => i !== idx))
                        }
                        aria-label="حذف المادة"
                        className="p-1.5 text-slate-400 hover:text-rose-700 disabled:opacity-30 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newSubjectName}
                    maxLength={FIELD_LIMITS.subject}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddDraftSubject();
                      }
                    }}
                    placeholder="إضافة مادة جديدة..."
                    className="w-full px-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                  <button
                    type="button"
                    onClick={handleAddDraftSubject}
                    disabled={
                      !newSubjectName.trim() ||
                      draftSubjects.length >= FIELD_LIMITS.maxSchoolSubjects
                    }
                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 disabled:opacity-50 rounded-lg whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>إضافة</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-200/70">
                  <button
                    type="button"
                    disabled={savingSubjects}
                    onClick={handleSaveSubjects}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{savingSubjects ? 'جاري الحفظ...' : 'حفظ المواد'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingSubjects(false)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 rounded-lg"
                  >
                    إلغاء
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Mode 1: Photo Upload */}
      {subMode === 'photo' && (
        <GradeImageUploadPanel
          sectionName={activeClassroom?.name || 'الشعبة'}
          stageName={stageName}
          subject={activeSubject}
          maxScore={maxScore}
          sectionStudents={classStudents}
          onDetectedMetadata={(meta) => {
            if (meta.subject) {
              if (stageSubjects.includes(meta.subject)) {
                setSubject(meta.subject);
                setCustomSubject('');
              } else {
                setCustomSubject(meta.subject);
              }
            }
            if (meta.maxScore && meta.maxScore > 0) {
              setMaxScore(meta.maxScore);
            }
            onNotify('success', 'تم تحديث بيانات الكشف.');
          }}
          onPublishExtracted={publishBatchAndOpenSummary}
          onNotify={onNotify}
        />
      )}

      {/* Mode 2: Manual Entry */}
      {subMode === 'manual' && (
        <form
          onSubmit={handleManualPublish}
          className="bg-white border border-slate-200/80 rounded-xl overflow-hidden"
        >
          <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between gap-3">
            <h3 className="font-display text-sm sm:text-base font-bold text-slate-900">
              {activeSubject} · {activeClassroom?.name}
            </h3>
            <button
              type="submit"
              disabled={saving || enteredCount === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'جاري النشر...' : `نشر (${enteredCount})`}</span>
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500">
                  <th className="py-3 px-5">الطالب</th>
                  <th className="py-3 px-4 w-32">الدرجة / {maxScore}</th>
                  <th className="py-3 px-4 w-28">التقدير</th>
                  <th className="py-3 px-5">ملاحظة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
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
                    <tr key={student.id} className="hover:bg-slate-50/50">
                      <td className="py-3 px-5">
                        <p className="font-medium text-slate-900">{student.fullName}</p>
                        <p className="text-xs text-slate-400 font-mono tabular-nums">
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
                          className="w-24 px-3 py-1.5 text-sm font-mono tabular-nums text-center bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
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
                            {pct}%
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>

                      <td className="py-3 px-5">
                        <input
                          type="text"
                          value={notes[student.id] || ''}
                          onChange={(e) =>
                            setNotes((prev) => ({ ...prev, [student.id]: e.target.value }))
                          }
                          maxLength={300}
                          placeholder="اختياري..."
                          className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </form>
      )}

      {/* Mode 3: Multi-Subject Summary */}
      {subMode === 'summary' && (
        <section className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-display text-sm sm:text-base font-bold text-slate-900">
              خلاصة {activeClassroom?.name}
            </h3>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={classStudents.length === 0}
                onClick={() => {
                  exportSectionGradesCsv({
                    schoolName: school.name,
                    stageName,
                    sectionName: activeClassroom?.name || 'الشعبة',
                    subjects: sectionSubjects,
                    rows: sectionSummaryRows,
                  });
                  onNotify('success', 'تم تصدير كشف الدرجات (Excel).');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700" />
                <span>تصدير Excel</span>
              </button>

              {stageToken && (
                <button
                  type="button"
                  onClick={() => onPreviewStagePortal(stageToken)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                  <span>البوابة</span>
                </button>
              )}

              <button
                type="button"
                disabled={broadcasting || classStudents.length === 0}
                onClick={handlePushInstantSummaryAll}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 rounded-lg whitespace-nowrap"
              >
                <BellRing className="w-3.5 h-3.5" />
                <span>{broadcasting ? 'جاري...' : 'إشعار الجميع'}</span>
              </button>
            </div>
          </div>

          {classStudents.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">لا يوجد طلاب</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-semibold text-slate-500">
                    <th className="py-3 px-4">الطالب</th>
                    {sectionSubjects.map((sub) => (
                      <th key={sub} className="py-3 px-3 text-center whitespace-nowrap">
                        {sub}
                      </th>
                    ))}
                    <th className="py-3 px-3 text-center whitespace-nowrap">المعدل</th>
                    <th className="py-3 px-3 text-center whitespace-nowrap">الغياب</th>
                    <th className="py-3 px-4 text-left whitespace-nowrap">البطاقة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sectionSummaryRows.map(({ student, metrics, bySub }) => {
                    const rating = classifyPercentage(metrics.averagePercent);
                    return (
                      <tr key={student.id} className="hover:bg-slate-50/50">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900 whitespace-nowrap">
                            {student.fullName}
                          </p>
                        </td>

                        {sectionSubjects.map((sub) => {
                          const s = bySub.get(sub);
                          return (
                            <td
                              key={sub}
                              className="py-3 px-3 text-center font-mono tabular-nums text-xs"
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

                        <td className="py-3 px-3 text-center font-mono tabular-nums text-xs whitespace-nowrap">
                          {metrics.subjectsCount > 0 ? (
                            <span
                              className={`font-bold ${
                                rating.tier === 'excellent' || rating.tier === 'very-good'
                                  ? 'text-emerald-700'
                                  : rating.tier === 'good'
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                              }`}
                            >
                              {metrics.averagePercent}%
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center font-mono tabular-nums text-xs">
                          <span
                            className={
                              metrics.totalAbsent >= school.absenceAlertThreshold
                                ? 'font-bold text-rose-700'
                                : 'text-slate-600'
                            }
                          >
                            {metrics.totalAbsent}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-left">
                          <button
                            type="button"
                            onClick={() => onPreviewPass(student.passToken)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
                          >
                            <span>فتح</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
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

      {/* Recent Grades Log */}
      <section className="bg-white border border-slate-200/80 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
            سجل الدرجات
          </h2>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'الكل' },
                { id: 'high', label: '85%+' },
                { id: 'attention', label: 'أقل من 70%' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDispatchFilter(tab.id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  dispatchFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {filteredRecentGrades.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">لا توجد درجات</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredRecentGrades.map((entry) => {
              const student = studentById.get(entry.studentId);
              const pct = Math.round((entry.score / Math.max(1, entry.maxScore)) * 100);
              const rating = classifyPercentage(pct);

              return (
                <div
                  key={entry.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {entry.studentName} ·{' '}
                      <span className="font-normal text-slate-600">{entry.subject}</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                      <span className="font-semibold text-slate-900">
                        {entry.score}/{entry.maxScore}
                      </span>{' '}
                      ·{' '}
                      <span
                        className={
                          rating.tier === 'excellent' || rating.tier === 'very-good'
                            ? 'text-emerald-700'
                            : rating.tier === 'good'
                              ? 'text-amber-700'
                              : 'text-rose-700'
                        }
                      >
                        {pct}%
                      </span>{' '}
                      · {formatArabicDate(entry.date)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {student && (
                      <button
                        type="button"
                        onClick={() => onPreviewPass(student.passToken)}
                        className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg whitespace-nowrap"
                      >
                        البطاقة
                      </button>
                    )}

                    {confirmDeleteId === entry.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteGrade(entry)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg"
                        >
                          حذف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1.5 text-xs text-slate-500"
                        >
                          إلغاء
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(entry.id)}
                        aria-label="حذف"
                        className="p-1.5 text-slate-400 hover:text-rose-700 rounded-lg"
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
