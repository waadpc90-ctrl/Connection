import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock,
  Printer,
  ShieldAlert,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { showSystemNotificationViaSW } from '../lib/pushNotifications';
import {
  classifyPercentage,
  formatArabicDate,
  getAttendanceMeta,
  StudentPass,
} from '../types/wisaal';
import { ExternalPushBanner } from './ExternalPushBanner';
import { MediaAttachmentPreview } from './MediaAttachmentPreview';
import { PWAInstallButton } from './PWAInstallButton';

interface ParentPassViewProps {
  passToken?: string;
  demoPass?: StudentPass;
  onExit?: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

export function ParentPassView({
  passToken,
  demoPass,
  onExit,
  onNotify,
}: ParentPassViewProps) {
  const [passData, setPassData] = useState<StudentPass | null>(demoPass ?? null);
  const [loading, setLoading] = useState<boolean>(!demoPass);
  const [notFound, setNotFound] = useState<boolean>(false);

  const lastSeenAlertIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (demoPass) {
      setPassData(demoPass);
      setLoading(false);
      setNotFound(false);
      return;
    }

    if (!passToken) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setNotFound(false);
    const passRef = doc(db, 'passes', passToken);
    const unsub = onSnapshot(
      passRef,
      (snap) => {
        if (!snap.exists()) {
          setPassData(null);
          setNotFound(true);
        } else {
          const data = snap.data() as Omit<StudentPass, 'passToken'>;
          const nextPass: StudentPass = { ...data, passToken: snap.id };
          if (
            nextPass.latestAlert?.id &&
            lastSeenAlertIdRef.current &&
            lastSeenAlertIdRef.current !== nextPass.latestAlert.id
          ) {
            onNotify('success', nextPass.latestAlert.title);
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              void showSystemNotificationViaSW(
                `${nextPass.schoolName} — ${nextPass.studentDisplayName}`,
                `${nextPass.latestAlert.title}: ${nextPass.latestAlert.body}`,
                `./?pass=${encodeURIComponent(nextPass.passToken)}`,
                `wisaal-pass-${nextPass.latestAlert.id}`
              );
            }
          }
          if (nextPass.latestAlert?.id) {
            lastSeenAlertIdRef.current = nextPass.latestAlert.id;
          }
          try {
            window.localStorage.setItem(
              'wisaal_saved_child_pass',
              JSON.stringify({
                passToken: nextPass.passToken,
                studentDisplayName: nextPass.studentDisplayName,
                className: nextPass.className,
                stageId: nextPass.stageId || '',
              })
            );
          } catch {
            // Ignore storage restrictions
          }
          setPassData(nextPass);
          setNotFound(false);
        }
        setLoading(false);
      },
      (err) => {
        console.error('Pass read error:', err);
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [passToken, demoPass, onNotify]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="h-28 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-48 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound || !passData) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <ShieldAlert className="w-8 h-8 text-slate-500 mx-auto mb-3" />
          <h1 className="font-display text-lg font-bold text-slate-900 mb-2">
            البطاقة غير متوفرة
          </h1>
          <p className="text-sm text-slate-600 mb-6">تأكد من صحة رابط أو رمز البطاقة.</p>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const todayMeta = getAttendanceMeta(passData.todayStatus);
  const needsAttendanceAlert = passData.totalAbsent >= passData.absenceAlertThreshold;
  const subjectSummaries = passData.subjectSummaries || [];
  const overallRating = classifyPercentage(passData.averagePercent);

  return (
    <div className="min-h-screen bg-[#F7F8F7] text-slate-900 pb-14">
      <header className="no-print sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200/80">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="p-2 -mr-2 text-slate-600 hover:text-slate-900 rounded-lg transition-colors shrink-0"
                aria-label="رجوع"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
            <span className="font-display font-bold text-slate-900 text-sm sm:text-base truncate">
              {passData.studentDisplayName}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-5 space-y-5">
        {/* Latest Alert */}
        {passData.latestAlert && (
          <section
            className={`rounded-xl p-5 flex items-start gap-3 text-white ${
              passData.latestAlert.kind === 'urgent' ? 'bg-rose-950' : 'bg-slate-900'
            }`}
          >
            <BellRing
              className={`w-4 h-4 shrink-0 mt-1 ${
                passData.latestAlert.kind === 'urgent' ? 'text-rose-300' : 'text-emerald-400'
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm sm:text-base font-bold leading-snug">
                {passData.latestAlert.title}
              </p>
              <p className="text-xs text-slate-200 mt-1 leading-relaxed whitespace-pre-line">
                {passData.latestAlert.body}
              </p>
              {!demoPass &&
                passData.latestAlert.imageMediaId &&
                passData.latestAlert.imageScope &&
                passData.latestAlert.imageScopeToken && (
                  <MediaAttachmentPreview
                    scope={passData.latestAlert.imageScope}
                    scopeToken={passData.latestAlert.imageScopeToken}
                    mediaId={passData.latestAlert.imageMediaId}
                    caption={passData.latestAlert.imageCaption}
                    darkSurface
                  />
                )}
            </div>
          </section>
        )}

        {/* Student Overview & Today Status */}
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6">
          <div className="pb-4 border-b border-slate-100">
            <p className="text-xs text-slate-500">
              {passData.schoolName} · {passData.academicYear}
            </p>
            <h1 className="font-display text-2xl font-bold text-slate-900 mt-1">
              {passData.studentDisplayName}
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              {passData.stageName ? `${passData.stageName} · ` : ''}
              {passData.className} ·{' '}
              <span className="font-mono tabular-nums">{passData.studentCode}</span>
            </p>
          </div>

          <div className="py-4">
            <div
              className={`rounded-lg p-3.5 border flex items-center gap-3 ${
                todayMeta.tone === 'emerald'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : todayMeta.tone === 'rose'
                    ? 'bg-rose-50/80 border-rose-200 text-rose-950'
                    : todayMeta.tone === 'amber'
                      ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                      : todayMeta.tone === 'sky'
                        ? 'bg-sky-50/80 border-sky-200 text-sky-950'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
              }`}
            >
              {todayMeta.tone === 'emerald' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
              ) : todayMeta.tone === 'amber' ? (
                <Clock className="w-5 h-5 text-amber-700 shrink-0" />
              ) : (
                <AlertCircle
                  className={`w-5 h-5 shrink-0 ${
                    todayMeta.tone === 'rose'
                      ? 'text-rose-700'
                      : todayMeta.tone === 'sky'
                        ? 'text-sky-700'
                        : 'text-slate-500'
                  }`}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-bold">{todayMeta.label}</p>
                  <span className="text-[11px] opacity-75">
                    {formatArabicDate(passData.todayDate)}
                  </span>
                </div>
                {passData.recentAttendance[0]?.note && (
                  <p className="text-xs mt-0.5 opacity-85">{passData.recentAttendance[0].note}</p>
                )}
              </div>
            </div>

            {needsAttendanceAlert && (
              <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>
                  بلغ الغياب{' '}
                  <strong className="font-mono tabular-nums">{passData.totalAbsent}</strong> أيام
                </span>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-y-4 sm:divide-x sm:divide-x-reverse divide-slate-100 text-center">
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-emerald-800">
                {passData.recentGrades.length > 0 ? `${passData.averagePercent}%` : '—'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {passData.recentGrades.length > 0 ? overallRating.label : 'المعدل'}
              </p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-slate-900">
                {passData.totalMaxScoreSum && passData.totalMaxScoreSum > 0
                  ? `${passData.totalScoreSum ?? 0}/${passData.totalMaxScoreSum}`
                  : '—'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">المجموع</p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-rose-700">
                {passData.totalAbsent}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">الغياب</p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-amber-700">
                {passData.totalLate}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">التأخر</p>
            </div>
          </div>
        </section>

        <ExternalPushBanner
          scope="pass"
          scopeToken={passData.passToken}
          schoolOwnerId={passData.ownerId}
          schoolName={passData.schoolName}
          studentId={passData.studentId}
          contextLabel={passData.studentDisplayName}
          disabledDemo={Boolean(demoPass)}
          onNotify={onNotify}
        />

        {/* Subject Summaries (Read-Only Inquiry) */}
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6 print-break-inside-avoid">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">المواد والدرجات</h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {subjectSummaries.length} مواد
            </span>
          </div>

          {subjectSummaries.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">لا توجد درجات مرصودة بعد</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {subjectSummaries.map((sub) => {
                const rating = classifyPercentage(sub.averagePercent);
                return (
                  <div key={sub.subject} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-3 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{sub.subject}</p>
                        {sub.latestNote && (
                          <p className="text-xs text-slate-500 mt-0.5">{sub.latestNote}</p>
                        )}
                      </div>
                      <div className="text-left shrink-0 font-mono tabular-nums">
                        <span className="text-sm font-bold text-slate-900">{sub.latestScore}</span>
                        <span className="text-xs text-slate-400">/{sub.latestMaxScore}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            rating.tier === 'excellent' || rating.tier === 'very-good'
                              ? 'bg-emerald-600'
                              : rating.tier === 'good'
                                ? 'bg-amber-500'
                                : 'bg-rose-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(4, sub.averagePercent))}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                        {sub.averagePercent}% · {rating.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Attendance Log (Read-Only Inquiry) */}
        <section className="bg-white border border-slate-200/80 rounded-xl p-5 sm:p-6 print-break-inside-avoid">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="font-display text-base font-bold text-slate-900">سجل الحضور</h2>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              بعذر: {passData.totalExcused}
            </span>
          </div>

          {passData.recentAttendance.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center">لا توجد سجلات حضور بعد</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {passData.recentAttendance.map((item, idx) => {
                const meta = getAttendanceMeta(item.status);
                return (
                  <div
                    key={`${item.date}_${idx}`}
                    className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">
                        {formatArabicDate(item.date)}
                      </p>
                      {item.note && <p className="text-xs text-slate-500 mt-0.5">{item.note}</p>}
                    </div>
                    <span
                      className={`text-xs font-semibold whitespace-nowrap shrink-0 ${
                        meta.tone === 'emerald'
                          ? 'text-emerald-700'
                          : meta.tone === 'rose'
                            ? 'text-rose-700'
                            : meta.tone === 'amber'
                              ? 'text-amber-700'
                              : 'text-sky-700'
                      }`}
                    >
                      {meta.shortLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
