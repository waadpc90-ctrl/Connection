import { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import {
  buildAttendanceWhatsAppMessage,
  buildPassUrl,
  saveClassAttendanceBatch,
} from '../lib/wisaalService';
import {
  AttendanceLog,
  AttendanceStatus,
  Classroom,
  formatArabicDate,
  getTodayIso,
  GradeEntry,
  School,
  StageId,
  Student,
} from '../types/wisaal';

interface AttendanceTabProps {
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

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; activeClass: string }[] = [
  { value: 'present', label: 'حاضر', activeClass: 'bg-emerald-700 text-white border-emerald-700' },
  { value: 'absent', label: 'غائب', activeClass: 'bg-rose-600 text-white border-rose-600' },
  { value: 'late', label: 'متأخر', activeClass: 'bg-amber-600 text-white border-amber-600' },
  { value: 'excused', label: 'بعذر', activeClass: 'bg-sky-700 text-white border-sky-700' },
];

export function AttendanceTab({
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
}: AttendanceTabProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>(classrooms[0]?.id || '');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayIso());
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({});
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (classrooms.length === 0) {
      setSelectedClassId('');
      return;
    }
    if (!classrooms.some((c) => c.id === selectedClassId)) {
      setSelectedClassId(classrooms[0].id);
    }
  }, [classrooms, selectedClassId]);

  const classStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === selectedClassId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')),
    [students, selectedClassId]
  );

  // Sync draft state whenever class or date changes — default everyone to 'present'
  useEffect(() => {
    const nextStatus: Record<string, AttendanceStatus> = {};
    const nextNotes: Record<string, string> = {};
    const logsForDate = new Map(
      attendanceLogs
        .filter((l) => l.date === selectedDate && l.classId === selectedClassId)
        .map((l) => [l.studentId, l])
    );

    for (const s of classStudents) {
      const existing = logsForDate.get(s.id);
      nextStatus[s.id] = existing ? existing.status : 'present';
      nextNotes[s.id] = existing ? existing.note : '';
    }
    setStatusMap(nextStatus);
    setNoteMap(nextNotes);
  }, [selectedClassId, selectedDate, classStudents, attendanceLogs]);

  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    for (const s of classStudents) {
      const st = statusMap[s.id] || 'present';
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
      else if (st === 'late') late++;
      else excused++;
    }
    return { present, absent, late, excused };
  }, [classStudents, statusMap]);

  const savedAlertsForSelection = useMemo(() => {
    return attendanceLogs.filter(
      (l) =>
        l.date === selectedDate &&
        l.classId === selectedClassId &&
        (l.status === 'absent' || l.status === 'late' || l.status === 'excused')
    );
  }, [attendanceLogs, selectedDate, selectedClassId]);

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  const handleSetAllPresent = () => {
    const reset: Record<string, AttendanceStatus> = {};
    for (const s of classStudents) reset[s.id] = 'present';
    setStatusMap(reset);
    setNoteMap({});
  };

  const handleSaveAttendance = async () => {
    if (classStudents.length === 0) return;
    setSaving(true);
    try {
      await saveClassAttendanceBatch(
        uid,
        school,
        stageId,
        classStudents,
        attendanceLogs,
        gradeEntries,
        selectedDate,
        statusMap,
        noteMap
      );
      const nonPresent = counts.absent + counts.late + counts.excused;
      onNotify(
        'success',
        nonPresent > 0
          ? `تم اعتماد حضور ${stageName} وإرسال إشعار فوري عبر الموقع لبوابة المرحلة وبطاقات الطلاب (${nonPresent} حالات غياب/تأخر).`
          : `تم اعتماد حضور الشعبة في ${stageName} وإرسال إشعار فوري عبر الموقع لبوابة المرحلة وجميع البطاقات.`
      );
    } catch {
      onNotify('error', 'تعذر حفظ سجل الحضور. حاول مرة أخرى.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify('success', 'تم نسخ نص التبليغ بنجاح.');
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      onNotify('error', 'تعذر النسخ إلى الحافظة.');
    }
  };

  if (classrooms.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
        <p className="font-display text-lg font-bold text-slate-900 mb-1">
          لا توجد شعب مضافة في {stageName} بعد
        </p>
        <p className="text-sm text-slate-600">
          انتقل إلى تبويب «الطلاب وبطاقات QR» لإضافة أول شعبة في {stageName} ثم ابدأ برصد الحضور.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Control Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 flex-1 max-w-xl">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              شعبة {stageName}
            </label>
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
            <label className="block text-xs font-medium text-slate-600 mb-1">تاريخ الرصد</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSetAllPresent}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>الكل حاضر</span>
          </button>

          <button
            type="button"
            onClick={handleSaveAttendance}
            disabled={saving || classStudents.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <ClipboardCheck className="w-4 h-4" />
            <span>{saving ? 'جاري الاعتماد...' : 'اعتماد وإشعار فوري عبر الموقع'}</span>
          </button>
        </div>
      </div>

      {/* 10-Second Exception-Only Attendance List */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              قائمة الفصل — {formatArabicDate(selectedDate)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              القاعدة الذهبية: جميع الطلاب حاضرون افتراضياً. انقر فقط على الغائب أو المتأخر.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs font-medium text-slate-600 font-mono tabular-nums">
            <span className="text-emerald-700">حاضر: {counts.present}</span>
            <span aria-hidden="true">·</span>
            <span className="text-rose-700">غائب: {counts.absent}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-700">متأخر: {counts.late}</span>
            <span aria-hidden="true">·</span>
            <span className="text-sky-700">بعذر: {counts.excused}</span>
          </div>
        </div>

        {classStudents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            لا يوجد طلاب مسجلون في هذا الفصل حتى الآن.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {classStudents.map((student) => {
              const currentStatus = statusMap[student.id] || 'present';
              const isException = currentStatus !== 'present';

              return (
                <div
                  key={student.id}
                  className={`px-5 py-3.5 transition-colors ${
                    currentStatus === 'absent'
                      ? 'bg-rose-50/40'
                      : currentStatus === 'late'
                        ? 'bg-amber-50/40'
                        : currentStatus === 'excused'
                          ? 'bg-sky-50/40'
                          : 'bg-white hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{student.fullName}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <span className="font-mono tabular-nums">{student.studentCode}</span>
                        {student.parentName ? ` · ${student.parentName}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {STATUS_OPTIONS.map((opt) => {
                        const active = currentStatus === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() =>
                              setStatusMap((prev) => ({ ...prev, [student.id]: opt.value }))
                            }
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                              active
                                ? opt.activeClass
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-900'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isException && (
                    <div className="mt-2.5 sm:max-w-md">
                      <input
                        type="text"
                        value={noteMap[student.id] || ''}
                        onChange={(e) =>
                          setNoteMap((prev) => ({ ...prev, [student.id]: e.target.value }))
                        }
                        maxLength={300}
                        placeholder="ملاحظة قصيرة لولي الأمر (اختياري، مثال: تأخر 15 دقيقة)"
                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Live In-Website Instant Delivery Status */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <BellRing className="w-4 h-4 text-emerald-700 shrink-0" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                حالة الإشعار الفوري عبر الموقع (بوابة المرحلة + بطاقات الطلاب)
              </h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              بمجرد اعتماد الحضور أعلاه يُنشر إشعار حي فوري على بوابة باركود {stageName} وتُحدّث
              بطاقة كل طالب لحظياً بدون الحاجة لواتساب.
            </p>
          </div>
          {stageToken && (
            <button
              type="button"
              onClick={() => onPreviewStagePortal(stageToken)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
              <span>معاينة بوابة باركود {stageName}</span>
            </button>
          )}
        </div>

        {savedAlertsForSelection.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
            لا توجد حالات غياب أو تأخر معتمدة لهذا الفصل في تاريخ {formatArabicDate(selectedDate)}.
          </p>
        ) : (
          <div className="divide-y divide-slate-200">
            {savedAlertsForSelection.map((log) => {
              const student = studentById.get(log.studentId);
              if (!student) return null;
              const passUrl = buildPassUrl(student.passToken);
              const msg = buildAttendanceWhatsAppMessage(
                school.name,
                stageName,
                student,
                log.status,
                log.date,
                log.note,
                passUrl
              );

              return (
                <div key={log.id} className="py-4 first:pt-0 last:pb-0 space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {student.fullName} ·{' '}
                        <span
                          className={
                            log.status === 'absent'
                              ? 'text-rose-700'
                              : log.status === 'late'
                                ? 'text-amber-700'
                                : 'text-sky-700'
                          }
                        >
                          {log.status === 'absent'
                            ? 'غائب'
                            : log.status === 'late'
                              ? 'متأخر'
                              : 'غائب بعذر'}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        ولي الأمر: {student.parentName || 'غير مسجل'}
                        {log.note ? ` · ${log.note}` : ''}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 ml-1 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تم الإشعار الفوري عبر الموقع</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => handleCopy(log.id, msg)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
                      >
                        {copiedId === log.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-700" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        <span>{copiedId === log.id ? 'تم النسخ' : 'نسخ الملخص'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onPreviewPass(student.passToken)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                        <span>فتح بطاقة الطالب</span>
                      </button>
                    </div>
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
