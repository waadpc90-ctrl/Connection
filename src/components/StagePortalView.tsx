import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { motion } from 'motion/react';
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
  QrCode,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { clearLockedStageToken } from '../lib/adminSecurity';
import { db } from '../lib/firebase';
import {
  getSavedChildren,
  getStageReadState,
  SavedChildPass,
  saveStageReadState,
  StageReadState,
} from '../lib/parentStorage';
import {
  showSystemNotificationViaSW,
  updateStagePushSectionFilter,
} from '../lib/pushNotifications';
import {
  formatArabicDate,
  StageBroadcastItem,
  StageBroadcastKind,
  StagePortal,
  StudentPass,
} from '../types/wisaal';
import { ExternalPushBanner } from './ExternalPushBanner';
import { MediaAttachmentPreview } from './MediaAttachmentPreview';
import { PWAInstallButton } from './PWAInstallButton';

interface StagePortalViewProps {
  stageToken?: string;
  demoPortal?: StagePortal;
  lockedToStage?: boolean;
  onExit: () => void;
  onOpenStudentPass: (passToken: string) => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
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
    // Ignore audio context restrictions
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
      return { label: 'عاجل', colorClass: 'text-rose-700', Icon: AlertTriangle };
    case 'grades':
      return { label: 'درجات', colorClass: 'text-emerald-800', Icon: Award };
    case 'attendance':
      return { label: 'غياب', colorClass: 'text-amber-700', Icon: ClipboardCheck };
    default:
      return { label: 'تعميم', colorClass: 'text-slate-700', Icon: Megaphone };
  }
}

function extractPassTokenInput(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.includes('://') || trimmed.includes('?pass=')) {
      const url = trimmed.includes('://')
        ? new URL(trimmed)
        : new URL(
            trimmed.startsWith('?') ? `https://w.local/${trimmed}` : `https://w.local/?${trimmed}`
          );
      const fromQuery = url.searchParams.get('pass')?.trim() || '';
      if (/^[a-zA-Z0-9_\-]{16,64}$/.test(fromQuery)) return fromQuery;
    }
  } catch {
    // Fall back to raw token check
  }
  if (/^[a-zA-Z0-9_\-]{16,64}$/.test(trimmed)) return trimmed;
  return null;
}

export function StagePortalView({
  stageToken,
  demoPortal,
  lockedToStage = false,
  onExit,
  onOpenStudentPass,
  onNotify,
}: StagePortalViewProps) {
  const [portal, setPortal] = useState<StagePortal | null>(demoPortal ?? null);
  const [loading, setLoading] = useState<boolean>(!demoPortal);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('all');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [readState, setReadState] = useState<StageReadState>({ lastReadId: '', lastReadIso: '' });
  const [freshBroadcast, setFreshBroadcast] = useState<StageBroadcastItem | null>(null);
  const [savedChildren, setSavedChildren] = useState<SavedChildPass[]>([]);
  const [showPassLookup, setShowPassLookup] = useState<boolean>(false);
  const [passInput, setPassInput] = useState<string>('');
  const [checkingPass, setCheckingPass] = useState<boolean>(false);

  const lastSeenBroadcastIdRef = useRef<string | null>(null);
  const soundEnabledRef = useRef<boolean>(soundEnabled);
  const storageKeyPrefix = stageToken || demoPortal?.stageToken || 'demo';

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    try {
      const savedSec = window.localStorage.getItem(`wisaal_stage_sec_${storageKeyPrefix}`);
      if (savedSec) setSelectedSectionId(savedSec);
    } catch {
      // Ignore storage restrictions
    }
    setReadState(getStageReadState(storageKeyPrefix));
    setSavedChildren(getSavedChildren());
  }, [storageKeyPrefix]);

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
            onNotify('success', incomingBroadcast.title);
            if (soundEnabledRef.current) {
              playNotificationChime();
            }
            if (
              typeof window !== 'undefined' &&
              'Notification' in window &&
              Notification.permission === 'granted'
            ) {
              void showSystemNotificationViaSW(
                `${nextData.schoolName} — ${nextData.stageName}`,
                `${incomingBroadcast.title}: ${incomingBroadcast.body}`,
                `./?stage=${encodeURIComponent(nextData.stageToken)}`,
                `wisaal-stage-${incomingBroadcast.id}`
              );
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
  }, [stageToken, demoPortal, onNotify]);

  const handleSelectSection = (secId: string) => {
    setSelectedSectionId(secId);
    try {
      window.localStorage.setItem(`wisaal_stage_sec_${storageKeyPrefix}`, secId);
    } catch {
      // Ignore
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

  const unreadIds = useMemo(() => {
    const ids = new Set<string>();
    if (visibleBroadcasts.length === 0) return ids;

    if (!readState.lastReadId && !readState.lastReadIso) {
      for (const b of visibleBroadcasts) ids.add(b.id);
      return ids;
    }

    if (readState.lastReadId) {
      const idx = visibleBroadcasts.findIndex((b) => b.id === readState.lastReadId);
      if (idx !== -1) {
        for (let i = 0; i < idx; i += 1) {
          ids.add(visibleBroadcasts[i].id);
        }
        return ids;
      }
    }

    // Fallback when lastReadId was deleted or belongs to another section filter
    if (readState.lastReadIso) {
      for (const b of visibleBroadcasts) {
        if (b.createdAtIso && b.createdAtIso > readState.lastReadIso) {
          ids.add(b.id);
        }
      }
    }

    return ids;
  }, [visibleBroadcasts, readState]);

  const unreadCount = unreadIds.size;

  const handleMarkAllRead = () => {
    const newest = visibleBroadcasts[0];
    if (!newest) return;
    const nextState: StageReadState = {
      lastReadId: newest.id,
      lastReadIso: newest.createdAtIso || new Date().toISOString(),
    };
    setReadState(nextState);
    setFreshBroadcast(null);
    saveStageReadState(storageKeyPrefix, nextState.lastReadId, nextState.lastReadIso);
    onNotify('success', 'تم تأكيد الاطلاع.');
  };

  const handleStagePassLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portal) return;
    const token = extractPassTokenInput(passInput);
    if (!token) {
      onNotify('error', 'أدخل رمز البطاقة الصحيح.');
      return;
    }

    setCheckingPass(true);
    try {
      const snap = await getDoc(doc(db, 'passes', token));
      if (!snap.exists()) {
        onNotify('error', 'لم يتم العثور على بطاقة بهذا الرمز.');
        return;
      }
      const data = snap.data() as Omit<StudentPass, 'passToken'>;
      if (data.stageId && data.stageId !== portal.stageId) {
        onNotify('error', `هذه البطاقة لا تنتمي إلى ${portal.stageName}.`);
        return;
      }
      setPassInput('');
      setShowPassLookup(false);
      onOpenStudentPass(token);
    } catch {
      onNotify('error', 'تعذر التحقق من رمز البطاقة.');
    } finally {
      setCheckingPass(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] py-10 px-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          <div className="h-56 bg-white border border-slate-200 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  if (notFound || !portal) {
    return (
      <div className="min-h-screen bg-[#F7F8F7] flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
          <h1 className="font-display text-lg font-bold text-slate-900 mb-2">
            البوابة غير متوفرة
          </h1>
          <p className="text-sm text-slate-600 mb-6">تأكد من مسح رمز الباركود الصحيح.</p>
          <button
            type="button"
            onClick={() => {
              clearLockedStageToken();
              onExit();
            }}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            <span>الرئيسية</span>
          </button>
        </div>
      </div>
    );
  }

  const matchingSavedChildren = savedChildren.filter(
    (child) => !child.stageId || child.stageId === portal.stageId
  );

  return (
    <div className="min-h-screen bg-[#F4F6F5] text-slate-900 pb-14">
      <header className="sticky top-0 z-20 bg-white/88 backdrop-blur-md border-b border-slate-200/75">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            {!lockedToStage && (
              <button
                type="button"
                onClick={onExit}
                className="min-h-[40px] min-w-[40px] -mr-2 flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors shrink-0"
                aria-label="رجوع"
              >
                <ArrowRight className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <p className="font-display font-bold text-slate-900 text-sm sm:text-base truncate">
                {portal.stageName}
              </p>
              <p className="text-[11px] text-slate-500 truncate">{portal.schoolName}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={() => setSoundEnabled((v) => !v)}
              aria-label={soundEnabled ? 'كتم الصوت' : 'تفعيل الصوت'}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200/80 rounded-xl transition-colors"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-5 space-y-5">
        {freshBroadcast && (
          <section className="bg-emerald-900 text-white rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
            <div className="flex items-start gap-3">
              <BellRing className="w-5 h-5 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-emerald-200">{freshBroadcast.targetSectionName}</p>
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
              className="px-4 py-2 text-xs font-semibold text-emerald-950 bg-white hover:bg-emerald-50 rounded-xl transition-colors whitespace-nowrap shrink-0 self-start sm:self-center"
            >
              تم الاطلاع
            </button>
          </section>
        )}

        {/* Section Filter & Child Shortcut */}
        <section className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100/90 rounded-xl">
              <button
                type="button"
                onClick={() => handleSelectSection('all')}
                className={`relative px-3.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${
                  selectedSectionId === 'all'
                    ? 'text-white font-bold'
                    : 'text-slate-600 hover:text-slate-900 font-medium'
                }`}
              >
                {selectedSectionId === 'all' && (
                  <motion.span
                    layoutId="portal-section-active"
                    transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                    className="absolute inset-0 rounded-lg bg-emerald-700 shadow-xs"
                  />
                )}
                <span className="relative z-10">الكل ({portal.broadcasts.length})</span>
              </button>

              {portal.sections.map((sec) => {
                const active = selectedSectionId === sec.classId;
                return (
                  <button
                    key={sec.classId}
                    type="button"
                    onClick={() => handleSelectSection(sec.classId)}
                    className={`relative px-3.5 py-1.5 text-xs rounded-lg transition-colors whitespace-nowrap ${
                      active
                        ? 'text-white font-bold'
                        : 'text-slate-600 hover:text-slate-900 font-medium'
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="portal-section-active"
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                        className="absolute inset-0 rounded-lg bg-emerald-700 shadow-xs"
                      />
                    )}
                    <span className="relative z-10">{sec.name}</span>
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
                <span>قراءة الكل ({unreadCount})</span>
              </button>
            )}
          </div>

          <div className="pt-3.5 border-t border-slate-100 space-y-2.5">
            {matchingSavedChildren.length > 0 ? (
              <div className="space-y-2">
                {matchingSavedChildren.map((child, idx) => (
                  <div key={child.passToken} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-600 truncate">
                      <strong className="text-slate-900">{child.studentDisplayName}</strong> ·{' '}
                      {child.className}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => onOpenStudentPass(child.passToken)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>بطاقة الطالب</span>
                      </button>
                      {idx === 0 && !demoPortal && (
                        <button
                          type="button"
                          onClick={() => setShowPassLookup((v) => !v)}
                          aria-label="بطاقة أخرى"
                          className="p-1.5 text-slate-500 hover:text-slate-900 border border-slate-200 rounded-lg"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-500">الاستعلام عن بطاقة الطالب</span>
                {!demoPortal && (
                  <button
                    type="button"
                    onClick={() => setShowPassLookup((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>بطاقة الطالب</span>
                  </button>
                )}
              </div>
            )}

            {showPassLookup && !demoPortal && (
              <form onSubmit={handleStagePassLookup} className="flex items-center gap-2">
                <input
                  type="text"
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                  dir="ltr"
                  placeholder="رمز بطاقة الطالب"
                  className="flex-1 px-3 py-1.5 text-xs font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 text-right placeholder:text-right"
                />
                <button
                  type="submit"
                  disabled={checkingPass}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  {checkingPass ? 'جاري...' : 'عرض'}
                </button>
              </form>
            )}
          </div>
        </section>

        <ExternalPushBanner
          scope="stage"
          scopeToken={portal.stageToken}
          schoolOwnerId={portal.ownerId}
          schoolName={portal.schoolName}
          sectionId={selectedSectionId}
          contextLabel={
            selectedSectionId === 'all'
              ? portal.stageName
              : `${portal.stageName} — ${portal.sections.find((s) => s.classId === selectedSectionId)?.name || ''}`
          }
          disabledDemo={Boolean(demoPortal)}
          onNotify={onNotify}
        />

        {/* Broadcasts Feed */}
        <section className="bg-white border border-slate-200/80 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200/80 flex items-center justify-between gap-3">
            <h2 className="font-display text-base font-bold text-slate-900">التبليغات</h2>
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {visibleBroadcasts.length}
            </span>
          </div>

          {visibleBroadcasts.length === 0 ? (
            <div className="p-10 text-center">
              <Bell className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">لا توجد إشعارات بعد</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200/80">
              {visibleBroadcasts.map((item) => {
                const { label, colorClass, Icon } = getKindMeta(item.kind);
                const isUnread = unreadIds.has(item.id);

                return (
                  <article
                    key={item.id}
                    className={`p-5 transition-colors ${isUnread ? 'bg-emerald-50/30' : 'bg-white'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs mb-1.5">
                      <div className="flex flex-wrap items-center gap-x-2">
                        <span className={`inline-flex items-center gap-1 font-semibold ${colorClass}`}>
                          <Icon className="w-3.5 h-3.5" />
                          <span>{label}</span>
                        </span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-600">{item.targetSectionName}</span>
                        {item.subject && (
                          <>
                            <span className="text-slate-300" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-slate-600">{item.subject}</span>
                          </>
                        )}
                      </div>

                      <time className="font-mono tabular-nums text-slate-400">
                        {formatBroadcastTimestamp(item.createdAtIso)}
                      </time>
                    </div>

                    <h3 className="font-display text-base font-bold text-slate-900">
                      {item.title}
                    </h3>
                    <p className="text-sm text-slate-700 leading-relaxed mt-1 whitespace-pre-line">
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
