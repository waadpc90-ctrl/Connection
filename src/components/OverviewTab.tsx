import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  GraduationCap,
  Megaphone,
  QrCode,
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

  // Smart Attention Radar: students meeting absence threshold OR avg grade < 70%
  const radarItems = students
    .map((student) => {
      const sLogs = attendanceLogs.filter((l) => l.studentId === student.id);
      const absentCount = sLogs.filter((l) => l.status === 'absent').length;
      const lateCount = sLogs.filter((l) => l.status === 'late').length;
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
        reasons.push(`غياب متكرر (${absentCount} أيام)`);
      }
      if (avg !== null && avg < 70) {
        reasons.push(`تراجع درجات (${avg}%)`);
      }
      return { student, absentCount, lateCount, avg, reasons };
    })
    .filter((item) => item.reasons.length > 0);

  if (totalSchoolStudents === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-12 text-center max-w-2xl mx-auto">
        <div className="w-12 h-12 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
          <GraduationCap className="w-6 h-6" />
        </div>
        <h2 className="font-display text-2xl font-bold text-slate-900 mb-2">
          مرحباً بك في لوحة {school.name}
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed max-w-lg mx-auto mb-7">
          النظام مقسم إلى 3 مراحل مستقلة، لكل مرحلة باركود خاص بها لتبليغ جميع شعبها بإشعار فوري
          عبر الموقع دون واتساب. ابدأ بإضافة شعبك وطلابك، أو حمّل 3 مراحل نموذجية جاهزة للتجربة
          فوراً.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={onSeedDemo}
            disabled={seeding}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-4 h-4" />
            <span>
              {seeding ? 'جاري تجهيز المراحل النموذجية...' : 'تحميل 3 مراحل نموذجية للتجربة'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onNavigate('students')}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
          >
            <Users className="w-4 h-4" />
            <span>إضافة شعبة وطالب يدوياً</span>
          </button>
        </div>
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 sm:p-10 text-center max-w-xl mx-auto">
        <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mx-auto mb-4">
          <Users className="w-5 h-5" />
        </div>
        <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
          لا يوجد طلاب في {stageName} بعد
        </h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6">
          درجات وغيابات وباركود {stageName} مفصولة بالكامل عن باقي المراحل. أضف أول شعبة وطلابها
          للبدء.
        </p>
        <button
          type="button"
          onClick={() => onNavigate('students')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
        >
          <Users className="w-4 h-4" />
          <span>إضافة شعبة وطلاب في {stageName}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 4-Column Tabular KPI Strip (Single Elevation, Stage-Isolated) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-200">
        <div className="p-5">
          <p className="text-xs text-slate-500">طلاب {stageName}</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {students.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            في <span className="font-mono tabular-nums">{classrooms.length}</span> شعب دراسية
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">غياب اليوم ({stageName})</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-rose-700 mt-1">
            {todayAbsent.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            متأخرون اليوم: <span className="font-mono tabular-nums">{todayLate.length}</span>
          </p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">الإشعار الفوري عبر الموقع</p>
          <p className="font-display text-xl font-bold text-emerald-800 mt-1">مفعّل لحظياً</p>
          <p className="text-xs text-slate-500 mt-1">عبر باركود المرحلة وبطاقات الطلاب</p>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-500">الدرجات المرصودة ({stageName})</p>
          <p className="font-mono tabular-nums text-2xl font-bold text-slate-900 mt-1">
            {gradeEntries.length}
          </p>
          <p className="text-xs text-slate-500 mt-1">مجمّعة تلقائياً في بطاقات الأهل</p>
        </div>
      </div>

      {/* Quick Action Pair: Stage QR Collective Broadcast + Photo Grade Sheet Upload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <QrCode className="w-4 h-4 text-emerald-700 shrink-0" />
              <h2 className="font-display text-base font-bold text-slate-900">
                باركود {stageName} والإشعار الجماعي الفوري
              </h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              أرسل تبليغاً جماعياً فورياً لجميع شعب {stageName} عبر الموقع مباشرة بدون واتساب، أو
              اطبع باركود المرحلة لتعليقه وتوزيعه على الأهالي.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onNavigate('stage-broadcasts')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <Megaphone className="w-3.5 h-3.5" />
              <span>باركود المرحلة وإرسال إشعار للجميع</span>
            </button>

            {stageToken && (
              <button
                type="button"
                onClick={() => onPreviewStagePortal(stageToken)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                <span>معاينة البوابة الحية</span>
              </button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Camera className="w-4 h-4 text-emerald-700 shrink-0" />
              <h2 className="font-display text-base font-bold text-slate-900">
                رفع كشف درجات شعبة كاملة بالصورة — {stageName}
              </h2>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              صوّر ورقة درجات أي مادة ليقرأها النظام ويجمعها مع باقي المواد في بطاقة خلاصة واحدة
              ويُشعر أولياء الأمور عبر الموقع فوراً.
            </p>
          </div>
          <div>
            <button
              type="button"
              onClick={() => onNavigate('grades')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>رفع صورة كشف درجات</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Split: Live Today Attendance Notifications + Smart Attention Radar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Today's Instant Website Attendance Alerts */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                إشعارات الغياب والتأخر اليوم — {stageName}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                فور اعتماد الغياب يصل الإشعار تلقائياً لبوابة باركود المرحلة وبطاقة كل طالب عبر
                الموقع
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('attendance')}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 whitespace-nowrap shrink-0"
            >
              <span>رصد الحضور</span>
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
          </div>

          {todayExceptions.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">
                لا توجد حالات غياب أو تأخر مسجلة اليوم في {stageName}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                ابدأ برصد حضور اليوم ليتم تحديث بوابة المرحلة وإشعار الأهالي عبر الموقع فوراً.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('attendance')}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                <span>الذهاب لرصد الغياب (10 ثوانٍ)</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {todayExceptions.map((log) => {
                const student = studentById.get(log.studentId);
                if (!student) return null;

                return (
                  <div
                    key={log.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
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
                            ? 'غائب اليوم'
                            : log.status === 'late'
                              ? 'متأخر عن الطابور'
                              : 'غائب بعذر'}
                        </span>
                        {log.note ? ` · ${log.note}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 whitespace-nowrap">
                        <BellRing className="w-3.5 h-3.5" />
                        <span>أُشعر عبر الموقع</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => onPreviewPass(student.passToken)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-emerald-700" />
                        <span>معاينة البطاقة</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Smart Attention Radar */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              رادار المتابعة المبكرة — {stageName}
            </h2>
          </div>
          <p className="text-xs text-slate-500 mb-5">
            طلاب {stageName} الذين تجاوزوا {school.absenceAlertThreshold} أيام غياب أو متوسط درجاتهم
            أقل من 70%
          </p>

          {radarItems.length === 0 ? (
            <div className="py-8 text-center border border-dashed border-slate-200 rounded-lg">
              <p className="text-sm font-medium text-slate-800">الوضع الدراسي مستقر</p>
              <p className="text-xs text-slate-500 mt-1">
                لا يوجد طلاب في دائرة الخطر الأكاديمي أو الغياب المتكرر في {stageName} حالياً.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {radarItems.map(({ student, reasons }) => (
                <div key={student.id} className="py-3.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">
                        {student.fullName}
                      </p>
                      <p className="text-xs text-slate-500">{student.className}</p>
                      <p className="text-xs font-medium text-rose-700 mt-1">
                        {reasons.join(' · ')}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onPreviewPass(student.passToken)}
                        title="معاينة بطاقة الطالب الحية"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>بطاقة الطالب</span>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
