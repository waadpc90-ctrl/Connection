import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import {
  ArrowLeft,
  BellRing,
  GraduationCap,
  QrCode,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase';
import { getSavedChildren, removeSavedChildPass, SavedChildPass } from '../lib/parentStorage';
import {
  DEFAULT_STAGE_NAMES,
  PublicPortal,
  STAGE_IDS,
  StageId,
} from '../types/wisaal';
import { PWAInstallButton } from './PWAInstallButton';

interface ParentHomeViewProps {
  schoolId?: string | null;
  isAdminSignedIn: boolean;
  onSelectLiveStage: (stageToken: string) => void;
  onSelectDemoStage: (stageId: StageId, stageName: string) => void;
  onOpenLivePass: (passToken: string) => void;
  onOpenDemoPass: () => void;
  onOpenAdmin: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

function extractPassToken(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.includes('://') || trimmed.includes('?pass=')) {
      const url = trimmed.includes('://')
        ? new URL(trimmed)
        : new URL(trimmed.startsWith('?') ? `https://w.local/${trimmed}` : `https://w.local/?${trimmed}`);
      const fromQuery = url.searchParams.get('pass')?.trim() || '';
      if (/^[a-zA-Z0-9_\-]{16,64}$/.test(fromQuery)) {
        return fromQuery;
      }
    }
  } catch {
    // Fall back to direct token check
  }

  if (/^[a-zA-Z0-9_\-]{16,64}$/.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function ParentHomeView({
  schoolId,
  isAdminSignedIn,
  onSelectLiveStage,
  onSelectDemoStage,
  onOpenLivePass,
  onOpenDemoPass,
  onOpenAdmin,
  onNotify,
}: ParentHomeViewProps) {
  const [directory, setDirectory] = useState<PublicPortal | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState<boolean>(true);
  const [savedChildren, setSavedChildren] = useState<SavedChildPass[]>([]);
  const [passInput, setPassInput] = useState<string>('');
  const [checkingPass, setCheckingPass] = useState<boolean>(false);

  useEffect(() => {
    setSavedChildren(getSavedChildren());
  }, []);

  const handleRemoveSavedChild = (passToken: string) => {
    setSavedChildren(removeSavedChildPass(passToken));
  };

  useEffect(() => {
    let active = true;
    const targetId = schoolId && /^[a-zA-Z0-9_\-]{1,128}$/.test(schoolId) ? schoolId : 'primary';

    const loadDirectory = async () => {
      setLoadingDirectory(true);
      try {
        const snap = await getDoc(doc(db, 'publicPortals', targetId));
        if (active && snap.exists()) {
          setDirectory({
            portalId: snap.id,
            ...(snap.data() as Omit<PublicPortal, 'portalId'>),
          });
        } else if (active) {
          setDirectory(null);
        }
      } catch {
        if (active) setDirectory(null);
      } finally {
        if (active) setLoadingDirectory(false);
      }
    };

    void loadDirectory();
    return () => {
      active = false;
    };
  }, [schoolId]);

  const stageNames = directory?.stageNames || DEFAULT_STAGE_NAMES;

  const handleStageClick = (stageId: StageId) => {
    const liveToken = directory?.stageTokens?.[stageId];
    if (liveToken) {
      onSelectLiveStage(liveToken);
    } else {
      onSelectDemoStage(stageId, stageNames[stageId]);
    }
  };

  const handleOpenPassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = extractPassToken(passInput);
    if (!token) {
      onNotify('error', 'أدخل رمز البطاقة الصحيح أو الصق رابط البطاقة.');
      return;
    }

    setCheckingPass(true);
    try {
      const snap = await getDoc(doc(db, 'passes', token));
      if (!snap.exists()) {
        onNotify('error', 'لم يتم العثور على بطاقة بهذا الرمز.');
        return;
      }
      onOpenLivePass(token);
    } catch {
      onNotify('error', 'تعذر التحقق من رمز البطاقة.');
    } finally {
      setCheckingPass(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F4F6F5] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-20 bg-white/88 backdrop-blur-md border-b border-slate-200/75">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-800 text-white flex items-center justify-center shrink-0 shadow-xs">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="font-display text-base font-bold text-slate-900 truncate">
              {directory?.schoolName || 'وصال'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={onOpenAdmin}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-emerald-900 bg-slate-100/80 hover:bg-emerald-50 border border-slate-200/80 hover:border-emerald-200 rounded-lg transition-all duration-150 whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
              <span>{isAdminSignedIn ? 'لوحة الإدارة' : 'الإدارة'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-7 sm:py-9 space-y-6">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-900">
            بوابة أولياء الأمور
          </h1>
          {directory?.academicYear && (
            <p className="text-xs text-slate-500 mt-1">{directory.academicYear}</p>
          )}
        </div>

        {/* Section 1: Stage Selection */}
        <section className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-emerald-700 shrink-0" />
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
              اختر المرحلة
            </h2>
          </div>

          {loadingDirectory ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {STAGE_IDS.map((sid) => (
                <div
                  key={sid}
                  className="h-14 rounded-xl bg-slate-100 animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {STAGE_IDS.map((sid) => (
                <button
                  key={sid}
                  type="button"
                  onClick={() => handleStageClick(sid)}
                  className="group flex items-center justify-between gap-2 px-4 py-3.5 rounded-xl border border-slate-200/90 bg-[#F7F9F8] hover:bg-emerald-50/70 hover:border-emerald-700/40 hover:shadow-[0_4px_14px_rgba(6,95,70,0.06)] text-right transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
                >
                  <span className="font-display text-sm font-bold text-slate-900 group-hover:text-emerald-950 truncate transition-colors">
                    {stageNames[sid]}
                  </span>
                  <ArrowLeft className="w-4 h-4 text-emerald-700 group-hover:-translate-x-1 transition-transform duration-200 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Section 2: Student Card */}
        <section className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 space-y-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
          <div className="flex items-center gap-2">
            <QrCode className="w-4 h-4 text-emerald-700 shrink-0" />
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
              بطاقة الطالب
            </h2>
          </div>

          {savedChildren.length > 0 && (
            <div className="space-y-2">
              {savedChildren.map((child) => (
                <div
                  key={child.passToken}
                  className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenLivePass(child.passToken)}
                    className="flex-1 min-w-0 p-3.5 flex items-center justify-between gap-3 text-right"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
                        <UserRound className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">
                          {child.studentDisplayName}
                        </p>
                        <p className="text-xs text-slate-600 truncate">
                          {child.stageName ? `${child.stageName} · ` : ''}
                          {child.className}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 whitespace-nowrap shrink-0">
                      <span>عرض البطاقة</span>
                      <ArrowLeft className="w-3.5 h-3.5" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveSavedChild(child.passToken)}
                    aria-label={`إزالة ${child.studentDisplayName}`}
                    className="p-2 ml-2 text-slate-400 hover:text-rose-700 hover:bg-white/80 rounded-lg transition-colors shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleOpenPassSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={passInput}
              onChange={(e) => setPassInput(e.target.value)}
              dir="ltr"
              placeholder="رمز البطاقة أو الرابط"
              aria-label="رمز البطاقة أو الرابط"
              className="flex-1 px-3.5 py-2.5 text-sm font-mono bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 text-right placeholder:text-right"
            />
            <button
              type="submit"
              disabled={checkingPass}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {checkingPass ? 'جاري الفتح...' : 'عرض البطاقة'}
            </button>
          </form>

          {savedChildren.length === 0 && (
            <div className="pt-1 flex justify-end">
              <button
                type="button"
                onClick={onOpenDemoPass}
                className="text-xs font-medium text-emerald-800 hover:underline"
              >
                عرض بطاقة نموذجية
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
