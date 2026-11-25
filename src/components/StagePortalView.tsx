import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Bell,
  BellRing,
  CheckCheck,
  ClipboardCheck,
  ExternalLink,
  Megaphone,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { updateStagePushSectionFilter } from '../lib/pushNotifications';
import {
  formatArabicDate,
  StageBroadcastItem,
  StageBroadcastKind,
  StagePortal,
} from '../types/wisaal';
import { ExternalPushBanner } from './ExternalPushBanner';
import { MediaAttachmentPreview } from './MediaAttachmentPreview';
import { PWAInstallButton } from './PWAInstallButton';

interface StagePortalViewProps {
  stageToken?: string;
  demoPortal?: StagePortal;
  onExit: () => void;
  onOpenStudentPass: (passToken: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

interface SavedChildPass {
  passToken: string;
  studentDisplayName: string;
  className: string;
  stageId?: string;
}

function playNotificationChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.14);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
  } catch {
    // Ignore audio context autoplay restrictions
  }
}

function formatBroadcastTimestamp(iso: string): string {
  if (!iso) return '';
  const datePart = iso.slice(0, 10);
  const timePart = iso.length >= 16 ? iso.slice(11, 16) : '';
  return timePart ? `${formatArabicDate(datePart)} · ${timePart}` : formatArabicDate(datePart);
}

function getKindMeta(kind: StageBroadcastKind): {
  label: string;
  colorClass: string;
  Icon: typeof Megaphone;
} {
  switch (kind) {
    case 'urgent':
      return { label: 'تنبيه عاجل', colorClass: 'text-rose-700', Icon: AlertTriangle };
    case 'grades':
      return { label: 'إشعار درجات', colorClass: 'text-emerald-800', Icon: Award };
    case 'attendance':
      return { label: 'حضور وغياب', colorClass: 'text-amber-700', Icon: ClipboardCheck };
    default:
      return { label: 'إعلان جماعي', colorClass: 'text-slate-700', Icon: Megaphone };
  }
}

export function StagePortalView({
  stageToken,
  demoPortal,
  onExit,
  onOpenStudentPass,
  onNotify,
}: StagePortalViewProps) {
  const [portal, setPortal] = useState<StagePortal | null>(demoPortal ?? null);
  const [loading, setLoading] = useState<boolean>(!demoPortal);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [lastReadId, setLastReadId] = useState<string>('');
  const [freshBroadcast, setFreshBroadcast] = useState<StageBroadcastItem | null>(null);
  const [savedChildPass, setSavedChildPass] = useState<SavedChildPass | null>(null);

  const lastSeenBroadcastIdRef = useRef<string | null>(null);
  const storageKeyPrefix = stageToken || demoPortal?.stageToken || 'demo';

  // Restore saved section preference, read marker, and same-device child pass shortcut
  useEffect(() => {
    try {
      const savedSec = window.localStorage.getItem(`wisaal_stage_sec_${storageKeyPrefix}`);
      if (savedSec) setSelectedSectionId(savedSec);
      const savedRead = window.localStorage.getItem(`wisaal_stage_read_${storageKeyPrefix}`);
      if (savedRead) setLastReadId(savedRead);
      const rawChild = window.localStorage.getItem('wisaal_saved_child_pass');
      if (rawChild) {
        const parsed = JSON.parse(rawChild) as SavedChildPass;
        if (parsed?.passToken && parsed?.studentDisplayName) {
          setSavedChildPass(parsed);
        }
      }
    } catch {
      // Ignore storage access restrictions
    }
  }, [storageKeyPrefix]);

  // Live Firestore subscription for instant in-website notifications
  useEffect(() => {
    if (demoPortal) {
      setPortal(demoPortal);
      setLoading(false);
      lastSeenBroadcastIdRef.current = demoPortal.latestBroadcast?.id || null;
      return;
    }

    if (!stageToken) {
      setLoading(false);
      setNotFound(true);
      return;
    }

    setLoading(true);
    setNotFound(false);

    const portalRef = doc(db, 'stagePortals', stageToken);
    const unsub = onSnapshot(
      portalRef,
      (snap) => {
        if (!snap.exists()) {
          setPortal(null);
          setNotFound(true);
          setLoading(false);
          return;
        }

        const nextData = {
          stageToken: snap.id,
          ...(snap.data() as Omit<StagePortal, 'stageToken'>),
        };
        setPortal(nextData);
        setNotFound(false);
        setLoading(false);

        const incomingBroadcast = nextData.latestBroadcast;
        if (incomingBroadcast?.id) {
          if (
            lastSeenBroadcastIdRef.current !== null &&
            lastSeenBroadcastIdRef.current !== incomingBroadcast.id
          ) {
            setFreshBroadcast(incomingBroadcast);
            onNotify('success', `إشعار فوري جديد: ${incomingBroadcast.title}`);
            if (soundEnabled) {
              playNotificationChime();
            }
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              try {
                new Notification(`${nextData.schoolName} — ${nextData.stageName}`, {
                  body: `${incomingBroadcast.title}: ${incomingBroadcast.body}`,
                });
              } catch {
                // Ignore Notification constructor errors in restricted iframes
              }
            }
          }
          lastSeenBroadcastIdRef.current = incomingBroadcast.id;
        }
      },
      () => {
        setNotFound(true);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [stageToken, demoPortal, onNotify, soundEnabled]);

  const handleSelectSection = (secId: string) => {
    setSelectedSectionId(secId);
    try {
      window.localStorage.setItem(`wisaal_stage_sec_${storageKeyPrefix}`, secId);
    } catch {
      // Ignore storage error
    }
    if (!demoPortal && portal?.stageToken) {
      void updateStagePushSectionFilter(portal.stageToken, secId);
    }
  };

  const visibleBroadcasts = useMemo(() => {
    if (!portal) return [];
    const list = portal.broadcasts || [];
    if (selectedSectionId === 'all') return list;
    return list.filter(
      (item) => item.targetClassId === 'all' || item.targetClassId === selectedSectionId
    );
  }, [portal, selectedSectionId]);

  const unreadCount = useMemo(() => {
    if (visibleBroadcasts.length === 0) return 0;
    if (!lastReadId) return visibleBroadcasts.length;
    const idx = visibleBroadcasts.findIndex((b) => b.id === lastReadId);
    return idx === -1 ? visibleBroadcasts.length : idx;
  }, [visibleBroadcasts, lastReadId]);

  const handleMarkAllRead = () => {
    const newest = visibleBroadcasts[0]?.id;
    if (!newest) return;
    setLastReadId(newest);
    setFreshBroadcast(null);
    try {
      window.localStorage.setItem(`wisaal_stage_read_${storageKeyPrefix}`, newest);
    } catch {
      // Ignore
    }
    onNotify('success', 'تم تأكيد الاطلاع على جميع الإشعارات.');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8F9F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="font-display text-lg font-bold text-slate-900 mb-2">
            جاري فتح بوابة المرحلة الفورية...
          </p>
          <p className="text-sm text-slate-500">يتم الآن الاتصال المباشر بإشعارات المدرسة</p>
        </div>
      </div>
    );
  }

  if (notFound || !portal) {
    return (
      <div className="min-h-screen bg-[#F8F9F7] flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h1 className="font-display text-xl font-bold text-slate-900 mb-2">
            تعذر العثور على بوابة المرحلة
          </h1>
          <p className="text-sm text-slate-600 leading-relaxed mb-6">
            تأكد من مسح رمز الباركود الصحيح الخاص بالمرحلة أو التواصل مع إدارة المدرسة.
          </p>
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>العودة للرئيسية</span>
          </button>
        </div>
      </div>
    );
  }

  const totalStudentsInStage = (portal.sections || []).reduce(
    (sum, s) => sum + (Number(s.studentCount) || 0),
    0
  );

  const matchingSavedChild =
    savedChildPass && (!savedChildPass.stageId || savedChildPass.stageId === portal.stageId)
      ? savedChildPass
      : null;

  return (
    <div className="min-h-screen bg-[#F8F9F7] text-slate-900 pb-16">
      {/* Clean Contextual Top Bar */}
      <header className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onExit}
              className="p-2 -mr-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
              title="رجوع"
            >
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <p className="font-display font-bold text-slate-900 text-sm sm:text-base truncate">
                {portal.schoolName}
              </p>
              <p className="text-xs text-slate-500 truncate">
                {portal.stageName} · {portal.academicYear}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              title={soundEnabled ? 'كتم صوت الإشعار الفوري' : 'تفعيل صوت الإشعار الفوري'}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-6 space-y-6">
        {/* Live Instant Arrival Banner (when a real-time broadcast just arrived) */}
        {freshBroadcast && (
          <section className="bg-emerald-900 text-white rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <BellRing className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-emerald-200 font-medium">
                  وصل إشعار فوري جديد الآن · {freshBroadcast.targetSectionName}
                </p>
                <h2 className="font-display text-base font-bold mt-0.5">{freshBroadcast.title}</h2>
                <p className="text-sm text-emerald-50/90 mt-1 leading-relaxed whitespace-pre-line">
                  {freshBroadcast.body}
                </p>
                {!demoPortal && freshBroadcast.imageMediaId && (
                  <MediaAttachmentPreview
                    scope="stage"
                    scopeToken={portal.stageToken}
                    mediaId={freshBroadcast.imageMediaId}
                    caption={freshBroadcast.imageCaption}
                    darkSurface
                  />
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="px-4 py-2 text-xs font-semibold text-emerald-950 bg-white hover:bg-emerald-50 rounded-lg transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              تم الاطلاع
            </button>
          </section>
        )}

        {/* Stage Identity Hero Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-5 border-b border-slate-200">
            <div>
              <p className="text-xs text-slate-500">
                بوابة الإشعارات الفورية عبر الموقع · بدون واتساب
              </p>
              <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mt-1">
                {portal.stageName}
              </h1>
              <p className="text-xs text-slate-600 mt-1.5 flex flex-wrap items-center gap-x-2">
                <span>{portal.schoolName}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  {portal.sections.length} شعب دراسية
                </span>
                {totalStudentsInStage > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">{totalStudentsInStage} طالب</span>
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 shrink-0">
              <span
                className="w-2 h-2 rounded-full bg-emerald-600 shrink-0"
                aria-hidden="true"
              />
              <span>متصل بالبث الفوري المباشر</span>
            </div>
          </div>

          {/* Interactive Section Filter (Parents pick their child's section) */}
          <div className="pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleSelectSection('all')}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  selectedSectionId === 'all'
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                جميع الشعب ({portal.broadcasts.length})
              </button>

              {portal.sections.map((sec) => {
                const active = selectedSectionId === sec.classId;
                return (
                  <button
                    key={sec.classId}
                    type="button"
                    onClick={() => handleSelectSection(sec.classId)}
                    className={`px-3.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {sec.name}
                  </button>
                );
              })}
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 hover:text-emerald-950 whitespace-nowrap shrink-0"
              >
                <CheckCheck className="w-4 h-4" />
                <span>تأكيد الاطلاع ({unreadCount})</span>
              </button>
            )}
          </div>

          {matchingSavedChild && (
            <div className="mt-5 pt-4 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                بطاقة ابنك المحفوظة على هذا الجهاز:{' '}
                <span className="font-semibold text-slate-900">
                  {matchingSavedChild.studentDisplayName}
                </span>{' '}
                ({matchingSavedChild.className})
              </div>
              <button
                type="button"
                onClick={() => onOpenStudentPass(matchingSavedChild.passToken)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>فتح بطاقة خلاصة درجات ابني</span>
              </button>
            </div>
          )}
        </section>

        {/* External OS / Background Web Push Notifications Activation */}
        <ExternalPushBanner
          scope="stage"
          scopeToken={portal.stageToken}
          schoolOwnerId={portal.ownerId}
          schoolName={portal.schoolName}
          sectionId={selectedSectionId}
          contextLabel={
            selectedSectionId === 'all'
              ? portal.stageName
              : `${portal.stageName} — ${portal.sections.find((s) => s.classId === selectedSectionId)?.name || 'الشعبة'}`
          }
          disabledDemo={Boolean(demoPortal)}
          onNotify={onNotify}
        />

        {/* Collective Instant Broadcasts Feed */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900">
                سجل التبليغات والإشعارات الفورية
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedSectionId === 'all'
                  ? `عرض جميع التبليغات الجماعية وتنبيهات الشعب في ${portal.stageName}`
                  : `عرض التبليغات الجماعية للمرحلة + إشعارات الشعبة المختارة`}
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
              {visibleBroadcasts.length} إشعار
            </span>
          </div>

          {visibleBroadcasts.length === 0 ? (
            <div className="p-10 text-center">
              <Bell className="w-6 h-6 text-slate-400 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">لا توجد إشعارات منشورة بعد</p>
              <p className="text-xs text-slate-500 mt-1">
                أبقِ هذه الصفحة محفوظة لديك؛ سيظهر أي إشعار جديد ترسله إدارة المدرسة هنا فوراً.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {visibleBroadcasts.map((item, idx) => {
                const { label, colorClass, Icon } = getKindMeta(item.kind);
                const isUnread =
                  !lastReadId || (visibleBroadcasts.findIndex((b) => b.id === lastReadId) === -1)
                    ? idx === 0 && !lastReadId
                    : idx < visibleBroadcasts.findIndex((b) => b.id === lastReadId);

                return (
                  <article
                    key={item.id}
                    className={`p-6 transition-colors ${isUnread ? 'bg-emerald-50/35' : 'bg-white'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-2">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className={`inline-flex items-center gap-1 font-semibold ${colorClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-slate-700">{item.targetSectionName}</span>
                        {item.subject && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-slate-600">مادة {item.subject}</span>
                          </>
                        )}
                        {isUnread && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-semibold text-emerald-700">جديد</span>
                          </>
                        )}
                      </div>

                      <time className="font-mono tabular-nums text-slate-500">
                        {formatBroadcastTimestamp(item.createdAtIso)}
                      </time>
                    </div>

                    <h3 className="font-display text-base font-bold text-slate-900">
                      {item.title}
                    </h3>
                    <p className="text-sm text-slate-700 leading-relaxed mt-1.5 whitespace-pre-line">
                      {item.body}
                    </p>
                    {!demoPortal && item.imageMediaId && (
                      <MediaAttachmentPreview
                        scope="stage"
                        scopeToken={portal.stageToken}
                        mediaId={item.imageMediaId}
                        caption={item.imageCaption}
                      />
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
