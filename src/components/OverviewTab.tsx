import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ClipboardCheck,
  ExternalLink,
  GraduationCap,
  Megaphone,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  AttendanceLog,
  Classroom,
  getTodayIso,
  GradeEntry,
  School,
  SchoolTab,
  StageId,
  Student,
} from '../types/wisaal';

interface OverviewTabProps {
  school: School;
  stageId: StageId;
  stageName: string;
  stageToken: string;
  totalSchoolStudents: number;
  classrooms: Classroom[];
  students: Student[];
  attendanceLogs: AttendanceLog[];
  gradeEntries: GradeEntry[];
  seeding: boolean;
  onSeedDemo: () => void;
  onNavigate: (tab: SchoolTab) => void;
  onPreviewPass: (passToken: string) => void;
  onPreviewStagePortal: (stageToken: string) => void;
}

export function OverviewTab({
  school,
  stageName,
  stageToken,
  totalSchoolStudents,
  classrooms,
  students,
  attendanceLogs,
  gradeEntries,
  seeding,
  onSeedDemo,
  onNavigate,
  onPreviewPass,
  onPreviewStagePortal,
}: OverviewTabProps) {
  const today = getTodayIso();
  const todayLogs = attendanceLogs.filter((l) => l.date === today);
  const todayAbsent = todayLogs.filter((l) => l.status === 'absent');
  const todayLate = todayLogs.filter((l) => l.status === 'late');
  const todayExceptions = todayLogs.filter(
    (l) => l.status === 'absent' || l.status === 'late' || l.status === 'excused'
  );

  const studentById = new Map(students.map((s) => [s.id, s]));

  const radarItems = students
    .map((student) => {
      const sLogs = attendanceLogs.filter((l) => l.studentId === student.id);
      const absentCount = sLogs.filter((l) => l.status === 'absent').length;
      const sGrades = gradeEntries.filter((g) => g.studentId === student.id);
      const avg =
        sGrades.length > 0
          ? Math.round(
              sGrades.reduce((acc, g) => acc + (g.score / Math.max(1, g.maxScore)) * 100, 0) /
                sGrades.length
            )
          : null;

      const reasons: string[] = [];
      if (absentCount >= school.absenceAlertThreshold) {
        reasons.push(`غياب ${absentCount} أيام`);
      }
      if (avg !== null && avg < 70) {
        reasons.push(`المعدل ${avg}%`);
      }
      return { student, reasons };
    })
    .filter((item) => item.reasons.length > 0);

  if (totalSchoolStudents === 0) {
    return (
      <div className="bg-white border border-slate-200/80 rounded-xl p-8 sm:p-12 text-center max-w-lg mx-auto">
        <GraduationCap className="w-8 h-8 text-emerald-700 mx-auto mb-3" />
        <h2 className="font-display text-xl font-bold text-slate-900 mb-6">{school.name}</h2>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seeding}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>{seeding ? 'جاري التحميل...' : 'بيانات تجريبية'}</span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>إضافة طلاب</span>
          </button>
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-white border border-slate-200/80 rounded-xl p-8 text-center max-w-md mx-auto">
        <p className="font-display text-lg font-bold text-slate-900 mb-4">
          لا يوجد طلاب في {stageName}
        </p>
        <button
          type="button"
          onClick={() => onNavigate('students')}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
        >
          <Users className="w-4 h-4" />
          <span>إضافة شعبة وطلاب</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 4 KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200/80 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-200/80">
        <div className="p-5">
          <p className="text-xs text-slate-500">الطلاب</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {students.length}
          </p>
          <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
            {classrooms.length} شعب
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">غياب اليوم</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-rose-700 mt-1">
            {todayAbsent.length}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">المتأخرون</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-amber-700 mt-1">
            {todayLate.length}
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">الدرجات</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {gradeEntries.length}
          </p>
        </div>
      </div>

      {/* 3 Primary Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          type="button"
          onClick={() => onNavigate('attendance')}
          className="bg-white border border-slate-200/80 hover:border-emerald-600/50 rounded-xl p-4 flex items-center justify-between gap-3 text-right transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <ClipboardCheck className="w-4 h-4" />
            </div>
            <span className="font-display text-sm font-bold text-slate-900">رصد الغياب</span>
          </div>
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('grades')}
          className="bg-white border border-slate-200/80 hover:border-emerald-600/50 rounded-xl p-4 flex items-center justify-between gap-3 text-right transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <span className="font-display text-sm font-bold text-slate-900">رفع الدرجات</span>
          </div>
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>

        <button
          type="button"
          onClick={() => onNavigate('stage-broadcasts')}
          className="bg-white border border-slate-200/80 hover:border-emerald-600/50 rounded-xl p-4 flex items-center justify-between gap-3 text-right transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Megaphone className="w-4 h-4" />
            </div>
            <span className="font-display text-sm font-bold text-slate-900">إرسال إشعار</span>
          </div>
          <ArrowLeft className="w-4 h-4 text-slate-400" />
        </button>
      </div>

      {/* Live Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <section className="lg:col-span-7 bg-white border border-slate-200/80 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">غياب وتأخر اليوم</h2>
            {stageToken && (
              <button
                type="button"
                onClick={() => onPreviewStagePortal(stageToken)}
                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-800 hover:text-emerald-950 whitespace-nowrap"
              >
                <span>بوابة {stageName}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {todayExceptions.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">لا توجد حالات اليوم</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {todayExceptions.map((log) => {
                const student = studentById.get(log.studentId);
                if (!student) return null;
                return (
                  <div
                    key={log.id}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {student.fullName}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {student.className} ·{' '}
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
                    </div>

                    <button
                      type="button"
                      onClick={() => onPreviewPass(student.passToken)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      البطاقة
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200/80 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <h2 className="font-display text-base font-bold text-slate-900">يحتاج متابعة</h2>
          </div>

          {radarItems.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">الوضع مستقر</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {radarItems.map(({ student, reasons }) => (
                <div
                  key={student.id}
                  className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">
                      {student.fullName}
                    </p>
                    <p className="text-xs text-rose-700 mt-0.5">
                      {student.className} · {reasons.join(' · ')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onPreviewPass(student.passToken)}
                    className="px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    البطاقة
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
