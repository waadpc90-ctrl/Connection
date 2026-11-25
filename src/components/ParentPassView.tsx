import { useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowRight,
  BellRing,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileCheck2,
  Layers,
  Printer,
  Send,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import {
  buildPassUrl,
  submitParentAcknowledgement,
} from '../lib/wisaalService';
import {
  classifyPercentage,
  formatArabicDate,
  getAttendanceMeta,
  getTodayIso,
  ParentAcknowledgement,
  StudentPass,
} from '../types/wisaal';
import { ExternalPushBanner } from './ExternalPushBanner';
import { MediaAttachmentPreview } from './MediaAttachmentPreview';
import { PWAInstallButton } from './PWAInstallButton';

interface ParentPassViewProps {
  passToken?: string;
  demoPass?: StudentPass;
  user: User | null;
  onSignIn: () => void;
  onExit?: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

export function ParentPassView({
  passToken,
  demoPass,
  user,
  onSignIn,
  onExit,
  onNotify,
}: ParentPassViewProps) {
  const [passData, setPassData] = useState<StudentPass | null>(demoPass ?? null);
  const [loading, setLoading] = useState<boolean>(!demoPass);
  const [notFound, setNotFound] = useState<boolean>(false);

  const [acks, setAcks] = useState<ParentAcknowledgement[]>([]);
  const [ackType, setAckType] = useState<'seen' | 'excuse'>('seen');
  const [excuseDate, setExcuseDate] = useState<string>(getTodayIso());
  const [senderLabel, setSenderLabel] = useState<string>('ولي الأمر');
  const [messageText, setMessageText] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const lastSeenAlertIdRef = useRef<string | null>(null);

  // Load live pass document by exact capability token (zero login required to read)
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
          }
          if (nextPass.latestAlert?.id) {
            lastSeenAlertIdRef.current = nextPass.latestAlert.id;
          }
          // Remember this parent's child pass on their own device so the Stage QR Portal
          // can offer a private 1-tap shortcut back to their child's summary card.
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

  // Subscribe to parent's own acknowledgements if signed in (or school owner's view)
  useEffect(() => {
    if (!passData || demoPass || !user) {
      setAcks([]);
      return;
    }

    const isOwner = user.uid === passData.ownerId;
    const acksCol = collection(db, 'passes', passData.passToken, 'acknowledgements');
    const q = isOwner
      ? query(acksCol, where('schoolOwnerId', '==', user.uid))
      : query(acksCol, where('authorId', '==', user.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<ParentAcknowledgement, 'id'>),
        }));
        setAcks(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `passes/${passData.passToken}/acknowledgements`);
      }
    );

    return () => unsub();
  }, [passData, demoPass, user]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9F7] py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-36 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound || !passData) {
    return (
      <div className="min-h-screen bg-[#F8F9F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mx-auto mb-4">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            تعذر العثور على بطاقة الطالب
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            تأكد من صحة الرابط أو اطلب من إدارة المدرسة إعادة إرسال رابط بطاقة المتابعة الحية.
          </p>
          {onExit && (
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              <span>العودة للرئيسية</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const todayMeta = getAttendanceMeta(passData.todayStatus);
  const passUrl = demoPass ? window.location.origin : buildPassUrl(passData.passToken);
  const needsAttendanceAlert = passData.totalAbsent >= passData.absenceAlertThreshold;
  const subjectSummaries = passData.subjectSummaries || [];
  const overallRating = classifyPercentage(passData.averagePercent);

  const handleSubmitAck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (demoPass) {
      const localAck: ParentAcknowledgement = {
        id: `demo_${Date.now()}`,
        authorId: 'demo',
        schoolOwnerId: 'demo',
        studentId: passData.studentId,
        type: ackType,
        targetDate: ackType === 'excuse' ? excuseDate : passData.todayDate,
        message:
          messageText.trim() ||
          (ackType === 'seen'
            ? 'تم الاطلاع على خلاصة الدرجات والحضور.'
            : 'عذر غياب مرسل من ولي الأمر.'),
        senderLabel: senderLabel.trim() || 'ولي الأمر',
        schoolStatus: 'pending',
      };
      setAcks((prev) => [localAck, ...prev]);
      setMessageText('');
      onNotify('success', 'تم تسجيل تأكيد الاطلاع في المعاينة النموذجية.');
      return;
    }

    if (!user) {
      onSignIn();
      return;
    }

    setSubmitting(true);
    try {
      await submitParentAcknowledgement(passData, user.uid, {
        type: ackType,
        targetDate: ackType === 'excuse' ? excuseDate : passData.todayDate,
        message:
          messageText.trim() ||
          (ackType === 'seen'
            ? 'تم الاطلاع على خلاصة الدرجات والحضور بنجاح.'
            : 'أرجو قبول عذر الغياب لهذا اليوم.'),
        senderLabel: senderLabel.trim() || user.displayName || 'ولي الأمر',
      });
      setMessageText('');
      onNotify(
        'success',
        ackType === 'excuse'
          ? 'تم إرسال عذر الغياب لإدارة المدرسة.'
          : 'تم تسجيل تأكيد الاطلاع بنجاح.'
      );
    } catch {
      onNotify('error', 'تعذر إرسال التوثيق الآن. تأكد من اتصالك بالإنترنت ثم حاول مجدداً.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9F7] text-slate-900 pb-16">
      {/* Compact Top Utility Strip */}
      <div className="no-print sticky top-0 z-20 bg-[#F8F9F7]/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
              >
                <ArrowRight className="w-4 h-4" />
                <span>رجوع</span>
              </button>
            )}
            <span className="font-display font-bold text-slate-900 truncate">
              {demoPass ? 'معاينة بطاقة الخلاصة لولي الأمر' : 'بطاقة وصال الحية'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة الخلاصة</span>
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {demoPass && (
          <div className="no-print p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>
              هذه معاينة حية لبطاقة الخلاصة الشاملة التي تصل ولي الأمر فور رفع كشف درجات الشعبة أو
              تسجيل الغياب.
            </span>
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 underline whitespace-nowrap shrink-0"
              >
                العودة للمنصة
              </button>
            )}
          </div>
        )}

        {/* Instant Live In-Website School Alert Banner */}
        {passData.latestAlert && (
          <section
            className={`rounded-xl p-5 flex items-start gap-3.5 text-white ${
              passData.latestAlert.kind === 'urgent' ? 'bg-rose-950' : 'bg-slate-900'
            }`}
          >
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
                passData.latestAlert.kind === 'urgent'
                  ? 'bg-rose-500/20 text-rose-200'
                  : 'bg-emerald-600/20 text-emerald-300'
              }`}
            >
              <BellRing className="w-4 h-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={`text-[11px] font-medium mb-0.5 ${
                  passData.latestAlert.kind === 'urgent' ? 'text-rose-200' : 'text-emerald-300'
                }`}
              >
                إشعار فوري عبر الموقع من {passData.schoolName}
              </p>
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

        {/* School & Student Identity Header */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs font-medium text-emerald-800 mb-1">
                {passData.schoolName} · {passData.academicYear}
              </p>
              <h1 className="font-display text-2xl font-bold text-slate-900">
                {passData.studentDisplayName}
              </h1>
              <p className="text-sm text-slate-600 mt-1">
                {passData.stageName ? `${passData.stageName} · ` : ''}
                {passData.className} · رمز الطالب:{' '}
                <span className="font-mono tabular-nums text-slate-800">{passData.studentCode}</span>
              </p>
            </div>

            <div className="hidden sm:block p-2 border border-slate-200 rounded-lg bg-white shrink-0">
              <QRCodeSVG value={passUrl} size={64} level="M" />
            </div>
          </div>

          {/* Today's Status Banner — Dual-coded */}
          <div className="pt-5">
            <div
              className={`rounded-lg p-4 border flex items-start gap-3 ${
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
                <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              ) : todayMeta.tone === 'amber' ? (
                <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle
                  className={`w-5 h-5 shrink-0 mt-0.5 ${
                    todayMeta.tone === 'rose'
                      ? 'text-rose-700'
                      : todayMeta.tone === 'sky'
                        ? 'text-sky-700'
                        : 'text-slate-500'
                  }`}
                />
              )}
              <div className="min-w-0">
                <p className="text-xs text-slate-600 mb-0.5">
                  آخر تحديث للحضور ({passData.stageName || 'المرحلة الحالية'}) ·{' '}
                  {formatArabicDate(passData.todayDate)}
                </p>
                <p className="font-display text-base font-bold">{todayMeta.label}</p>
                {passData.recentAttendance[0]?.note && (
                  <p className="text-xs mt-1 opacity-90">
                    ملاحظة المدرسة: {passData.recentAttendance[0].note}
                  </p>
                )}
              </div>
            </div>

            {needsAttendanceAlert && (
              <div className="mt-3 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                <span>
                  تنبيه متابعة: بلغ مجموع الغياب بدون عذر{' '}
                  <strong className="font-mono tabular-nums">{passData.totalAbsent}</strong> أيام
                  (حد المتابعة المعتمد {passData.absenceAlertThreshold} أيام).
                </span>
              </div>
            )}
          </div>

          {/* 4-Column Executive Metrics Strip */}
          <div className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-y-4 sm:divide-x sm:divide-x-reverse divide-slate-200 text-center">
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-emerald-800">
                {passData.recentGrades.length > 0 ? `${passData.averagePercent}%` : '—'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                المعدل ({passData.recentGrades.length > 0 ? overallRating.label : 'غير مرصود'})
              </p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-slate-900">
                {passData.totalMaxScoreSum && passData.totalMaxScoreSum > 0
                  ? `${passData.totalScoreSum ?? 0}/${passData.totalMaxScoreSum}`
                  : '—'}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                المجموع ({passData.subjectsCount ?? subjectSummaries.length} مواد)
              </p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-rose-700">
                {passData.totalAbsent}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">أيام الغياب</p>
            </div>
            <div className="px-2">
              <p className="font-mono tabular-nums text-xl font-bold text-amber-700">
                {passData.totalLate}
              </p>
              <p className="text-xs text-slate-600 mt-0.5">مرات التأخر</p>
            </div>
          </div>
        </section>

        {/* External OS / Background Web Push Notifications Activation for this Student */}
        <ExternalPushBanner
          scope="pass"
          scopeToken={passData.passToken}
          schoolOwnerId={passData.ownerId}
          schoolName={passData.schoolName}
          studentId={passData.studentId}
          contextLabel={`الطالب ${passData.studentDisplayName}`}
          disabledDemo={Boolean(demoPass)}
          onNotify={onNotify}
        />

        {/* Aggregated Multi-Subject Summary Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 print-break-inside-avoid">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-2.5">
              <Layers className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                خلاصة درجات جميع المواد
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {subjectSummaries.length} مواد مجمّعة
            </span>
          </div>

          {subjectSummaries.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
              لم تُرصد درجات مواد لهذا الطالب بعد. ستُجمع جميع مواده تلقائياً هنا.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {subjectSummaries.map((sub) => {
                const rating = classifyPercentage(sub.averagePercent);
                return (
                  <div
                    key={sub.subject}
                    className="p-4 rounded-lg border border-slate-200 bg-[#F8F9F7]/60"
                  >
                    <div className="flex items-baseline justify-between gap-2 mb-2">
                      <p className="text-sm font-bold text-slate-900">{sub.subject}</p>
                      <p className="font-mono tabular-nums text-sm font-bold text-slate-900">
                        {sub.latestScore}
                        <span className="text-xs font-normal text-slate-500">
                          /{sub.latestMaxScore}
                        </span>
                      </p>
                    </div>

                    <div className="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden mb-2">
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

                    <div className="flex items-center justify-between text-xs">
                      <span
                        className={
                          rating.tier === 'excellent' || rating.tier === 'very-good'
                            ? 'text-emerald-700 font-medium'
                            : rating.tier === 'good'
                              ? 'text-amber-700 font-medium'
                              : 'text-rose-700 font-medium'
                        }
                      >
                        {sub.averagePercent}% · {rating.label}
                      </span>
                      <span className="text-slate-500">{formatArabicDate(sub.latestDate)}</span>
                    </div>

                    {sub.latestNote && (
                      <p className="text-[11px] text-slate-600 mt-1.5 leading-snug">
                        {sub.latestNote}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Chronological Detailed Grades Log */}
        {passData.recentGrades.length > 0 && (
          <section className="bg-white border border-slate-200 rounded-xl p-6 print-break-inside-avoid">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-2.5">
                <TrendingUp className="w-5 h-5 text-emerald-700" />
                <h2 className="font-display text-lg font-bold text-slate-900">
                  سجل الامتحانات والتقييمات التفصيلي
                </h2>
              </div>
              <span className="text-xs text-slate-500 font-mono tabular-nums">
                {passData.recentGrades.length} تقييمات
              </span>
            </div>

            <div className="divide-y divide-slate-200">
              {passData.recentGrades.map((grade) => {
                const pct = Math.round((grade.score / Math.max(1, grade.maxScore)) * 100);
                const rating = classifyPercentage(pct);
                return (
                  <div
                    key={grade.id}
                    className="py-3.5 first:pt-0 last:pb-0 flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {grade.subject} ·{' '}
                        <span className="font-normal text-slate-700">{grade.title}</span>
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {formatArabicDate(grade.date)} ·{' '}
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
                      </p>
                      {grade.teacherNote && (
                        <p className="text-xs text-slate-600 mt-1">{grade.teacherNote}</p>
                      )}
                    </div>

                    <div className="text-left shrink-0 font-mono tabular-nums">
                      <span className="text-sm font-bold text-slate-900">{grade.score}</span>
                      <span className="text-xs text-slate-500"> / {grade.maxScore}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Attendance Pulse Timeline */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 print-break-inside-avoid">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="flex items-center gap-2.5">
              <CalendarDays className="w-5 h-5 text-emerald-700" />
              <h2 className="font-display text-lg font-bold text-slate-900">
                سجل الحضور والغياب
              </h2>
            </div>
            <span className="text-xs text-slate-500">
              بعذر: <span className="font-mono tabular-nums">{passData.totalExcused}</span>
            </span>
          </div>

          {passData.recentAttendance.length === 0 ? (
            <p className="text-sm text-slate-500 py-6 text-center border border-dashed border-slate-200 rounded-lg">
              لا توجد سجلات حضور مسجلة حتى الآن.
            </p>
          ) : (
            <div className="divide-y divide-slate-200">
              {passData.recentAttendance.map((item, idx) => {
                const meta = getAttendanceMeta(item.status);
                return (
                  <div
                    key={`${item.date}_${idx}`}
                    className="py-3 first:pt-0 last:pb-0 flex items-start justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatArabicDate(item.date)}
                      </p>
                      {item.note && <p className="text-xs text-slate-600 mt-0.5">{item.note}</p>}
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

        {/* Parent Action & Excuse Submission Panel */}
        <section className="no-print bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-2">
            <FileCheck2 className="w-5 h-5 text-emerald-700" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              تأكيد الاطلاع أو إرسال عذر للمدرسة
            </h2>
          </div>
          <p className="text-xs text-slate-600 mb-5 leading-relaxed">
            وثّق تأكيد الاطلاع أو أرسل عذر الغياب مباشرة عبر الموقع ليصل فوراً إلى لوحة إدارة
            المدرسة دون الحاجة لواتساب.
          </p>

          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg mb-4">
            <button
              type="button"
              onClick={() => setAckType('seen')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                ackType === 'seen'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              تأكيد الاطلاع
            </button>
            <button
              type="button"
              onClick={() => setAckType('excuse')}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                ackType === 'excuse'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              إرسال عذر غياب
            </button>
          </div>

          <form onSubmit={handleSubmitAck} className="space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">صفة المرسل</label>
                <input
                  type="text"
                  value={senderLabel}
                  onChange={(e) => setSenderLabel(e.target.value)}
                  maxLength={80}
                  placeholder="والد الطالب / والدة الطالب"
                  className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                />
              </div>

              {ackType === 'excuse' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    تاريخ الغياب
                  </label>
                  <input
                    type="date"
                    value={excuseDate}
                    onChange={(e) => setExcuseDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {ackType === 'excuse' ? 'سبب العذر أو الملاحظة للمدرسة' : 'ملاحظة اختيارية للإدارة'}
              </label>
              <textarea
                rows={2}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                maxLength={400}
                placeholder={
                  ackType === 'excuse'
                    ? 'مثال: كان لدى الطالب موعد طبي صباح اليوم، شاكرين تفهمكم.'
                    : 'مثال: تم الاطلاع على خلاصة الدرجات، شكراً لجهودكم.'
                }
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600/20 focus:border-emerald-700"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Send className="w-4 h-4" />
                <span>
                  {submitting
                    ? 'جاري التوثيق الفوري...'
                    : user || demoPass
                      ? 'إرسال وتوثيق فوري عبر الموقع'
                      : 'توثيق فوري عبر حساب Google'}
                </span>
              </button>
            </div>
          </form>

          {acks.length > 0 && (
            <div className="mt-5 pt-4 border-t border-slate-200 space-y-2.5">
              <p className="text-xs font-semibold text-slate-700">التوثيقات المرسلة:</p>
              {acks.map((ack) => (
                <div
                  key={ack.id}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-start justify-between gap-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {ack.type === 'excuse' ? 'عذر غياب' : 'تأكيد اطلاع'} · {ack.senderLabel}
                    </p>
                    <p className="text-slate-600 mt-0.5">{ack.message}</p>
                  </div>
                  <span
                    className={`font-medium whitespace-nowrap shrink-0 ${
                      ack.schoolStatus === 'reviewed' ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {ack.schoolStatus === 'reviewed' ? 'تمت مراجعة المدرسة' : 'بانتظار المراجعة'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
