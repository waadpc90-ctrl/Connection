import { useEffect, useMemo, useState } from 'react';
import { Camera, ClipboardCheck, ExternalLink, ListChecks, RotateCcw } from 'lucide-react';
import { saveClassAttendanceBatch } from '../lib/wisaalService';
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
import { AttendanceImageUploadPanel } from './AttendanceImageUploadPanel';

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

type AttendanceSubMode = 'manual' | 'photo';

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
  const [subMode, setSubMode] = useState<AttendanceSubMode>('manual');
  const [selectedClassId, setSelectedClassId] = useState<string>(classrooms[0]?.id || '');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayIso());
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({});
  const [noteMap, setNoteMap] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    if (classrooms.length === 0) {
      setSelectedClassId('');
      return;
    }
    if (!classrooms.some((c) => c.id === selectedClassId)) {
      setSelectedClassId(classrooms[0].id);
    }
  }, [classrooms, selectedClassId]);

  const activeClassroom = classrooms.find((c) => c.id === selectedClassId);

  const classStudents = useMemo(
    () =>
      students
        .filter((s) => s.classId === selectedClassId)
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ar')),
    [students, selectedClassId]
  );

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

  const persistAttendanceBatch = async (
    batchStatuses: Record<string, AttendanceStatus>,
    batchNotes: Record<string, string>
  ) => {
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
        batchStatuses,
        batchNotes
      );
      onNotify('success', 'تم اعتماد الحضور وإرسال الإشعارات.');
    } catch {
      onNotify('error', 'تعذر حفظ سجل الحضور.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAttendance = async () => {
    await persistAttendanceBatch(statusMap, noteMap);
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
      <div className="bg-white border border-slate-200/80 rounded-xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubMode('manual')}
              className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs rounded-md transition-colors whitespace-nowrap ${
                subMode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900 font-medium'
              }`}
            >
              <ListChecks className="w-3.5 h-3.5 text-emerald-700" />
              <span>يدوي</span>
            </button>

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
          </div>

          {subMode === 'manual' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSetAllPresent}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>الكل حاضر</span>
              </button>

              <button
                type="button"
                onClick={handleSaveAttendance}
                disabled={saving || classStudents.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <ClipboardCheck className="w-4 h-4" />
                <span>{saving ? 'جاري الحفظ...' : 'اعتماد وإشعار'}</span>
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 max-w-md">
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            aria-label="الشعبة"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
          >
            {classrooms.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            aria-label="التاريخ"
            className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
          />
        </div>
      </div>

      {subMode === 'photo' && (
        <AttendanceImageUploadPanel
          sectionName={activeClassroom?.name || 'الشعبة'}
          sectionStudents={classStudents}
          onDetectedDate={(isoDate) => {
            setSelectedDate(isoDate);
            onNotify('success', 'تم تحديث التاريخ.');
          }}
          onApplyToManual={(extractedStatuses, extractedNotes) => {
            setStatusMap(extractedStatuses);
            setNoteMap(extractedNotes);
            setSubMode('manual');
            onNotify('success', 'تم تعبئة قائمة الحضور للمراجعة.');
          }}
          onPublishExtracted={async (extractedStatuses, extractedNotes) => {
            setStatusMap(extractedStatuses);
            setNoteMap(extractedNotes);
            await persistAttendanceBatch(extractedStatuses, extractedNotes);
            setSubMode('manual');
          }}
          onNotify={onNotify}
        />
      )}

      {subMode === 'manual' && (
      <section className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
            {formatArabicDate(selectedDate)}
          </h2>
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-500">
            <span className="text-emerald-700">حاضر {counts.present}</span>
            <span>·</span>
            <span className="text-rose-700">غائب {counts.absent}</span>
            <span>·</span>
            <span className="text-amber-700">متأخر {counts.late}</span>
            <span>·</span>
            <span className="text-sky-700">بعذر {counts.excused}</span>
          </div>
        </div>

        {classStudents.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">لا يوجد طلاب في هذه الشعبة</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {classStudents.map((student) => {
              const currentStatus = statusMap[student.id] || 'present';
              const isException = currentStatus !== 'present';

              return (
                <div
                  key={student.id}
                  className={`px-5 py-3.5 transition-colors ${
                    currentStatus === 'absent'
                      ? 'bg-rose-50/35'
                      : currentStatus === 'late'
                        ? 'bg-amber-50/35'
                        : currentStatus === 'excused'
                          ? 'bg-sky-50/35'
                          : 'bg-white'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{student.fullName}</p>
                      <p className="text-xs text-slate-400 font-mono tabular-nums">
                        {student.studentCode}
                      </p>
                    </div>

                    <div className="grid grid-cols-4 sm:flex items-center gap-1.5 shrink-0">
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
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {isException && (
                    <div className="mt-2.5 sm:max-w-sm">
                      <input
                        type="text"
                        value={noteMap[student.id] || ''}
                        onChange={(e) =>
                          setNoteMap((prev) => ({ ...prev, [student.id]: e.target.value }))
                        }
                        maxLength={300}
                        placeholder="ملاحظة اختيارية..."
                        className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {savedAlertsForSelection.length > 0 && (
        <section className="bg-white border border-slate-200/80 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="font-display text-sm font-bold text-slate-900">
              المسجلون غياباً أو تأخراً ({savedAlertsForSelection.length})
            </h2>
            {stageToken && (
              <button
                type="button"
                onClick={() => onPreviewStagePortal(stageToken)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:underline whitespace-nowrap"
              >
                <span>بوابة {stageName}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {savedAlertsForSelection.map((log) => {
              const student = studentById.get(log.studentId);
              if (!student) return null;
              return (
                <div
                  key={log.id}
                  className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {student.fullName} ·{' '}
                      <span
                        className={
                          log.status === 'absent'
                            ? 'text-rose-700 font-semibold'
                            : log.status === 'late'
                              ? 'text-amber-700 font-semibold'
                              : 'text-sky-700 font-semibold'
                        }
                      >
                        {log.status === 'absent'
                          ? 'غائب'
                          : log.status === 'late'
                            ? 'متأخر'
                            : 'بعذر'}
                      </span>
                    </p>
                    {log.note && <p className="text-xs text-slate-500">{log.note}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => onPreviewPass(student.passToken)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg whitespace-nowrap shrink-0"
                  >
                    البطاقة
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
