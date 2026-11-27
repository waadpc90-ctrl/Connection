import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Monitor,
  MonitorDown,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react';
import {
  InstallPlatform,
  onOpenInstallGuide,
  usePWAInstall,
} from '../hooks/usePWAInstall';

const FIRST_VISIT_SEEN_KEY = 'wisaal_install_guide_seen_v1';

interface FirstVisitInstallGuideProps {
  onNotify?: (kind: 'success' | 'error', message: string) => void;
}

function hasSeenInstallGuide(): boolean {
  try {
    return window.localStorage.getItem(FIRST_VISIT_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markInstallGuideSeen(): void {
  try {
    window.localStorage.setItem(FIRST_VISIT_SEEN_KEY, '1');
  } catch {
    // Ignore restricted storage contexts
  }
}

const PLATFORM_TABS: Array<{ id: InstallPlatform; label: string }> = [
  { id: 'desktop', label: 'كمبيوتر' },
  { id: 'android', label: 'أندرويد' },
  { id: 'ios', label: 'آيفون' },
];

export function FirstVisitInstallGuide({ onNotify }: FirstVisitInstallGuideProps) {
  const { isInstallable, isInstalled, platform, install } = usePWAInstall();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedPlatform, setSelectedPlatform] = useState<InstallPlatform>(platform);
  const [installing, setInstalling] = useState<boolean>(false);

  // Sync default tab to detected platform
  useEffect(() => {
    setSelectedPlatform(platform);
  }, [platform]);

  // Auto-open once on the very first visit if the app is not already installed
  useEffect(() => {
    if (isInstalled || hasSeenInstallGuide()) return;
    const timer = window.setTimeout(() => {
      setIsOpen(true);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [isInstalled]);

  // Allow re-opening manually from any "تثبيت التطبيق" button
  useEffect(() => {
    return onOpenInstallGuide(() => {
      if (!isInstalled) {
        setSelectedPlatform(platform);
        setIsOpen(true);
      }
    });
  }, [isInstalled, platform]);

  const handleClose = useCallback(() => {
    markInstallGuideSeen();
    setIsOpen(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleClose]);

  const handleDirectInstall = async () => {
    setInstalling(true);
    try {
      const accepted = await install();
      if (accepted) {
        markInstallGuideSeen();
        setIsOpen(false);
        onNotify?.('success', 'تم تثبيت تطبيق «وصال» على جهازك بنجاح.');
      }
    } finally {
      setInstalling(false);
    }
  };

  if (isInstalled || !isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-guide-title"
    >
      <div
        className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="./pwa-192x192.png"
              alt="شعار وصال"
              className="w-11 h-11 rounded-xl border border-emerald-100 shadow-xs shrink-0 bg-emerald-700"
            />
            <div className="min-w-0">
              <h2
                id="install-guide-title"
                className="font-display text-base font-bold text-slate-900 leading-snug"
              >
                تثبيت «وصال» على سطح المكتب
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                أضف الموقع كتطبيق لفتحه بسرعة واستلام الإشعارات الفورية
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
            aria-label="إغلاق"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Direct One-Tap Native Install CTA when browser supports beforeinstallprompt */}
          {isInstallable && (
            <button
              type="button"
              onClick={() => void handleDirectInstall()}
              disabled={installing}
              className="w-full py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-sm transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{installing ? 'جاري التثبيت...' : 'تثبيت التطبيق الآن بضغطة واحدة'}</span>
            </button>
          )}

          {/* Platform Switcher */}
          <div
            className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 rounded-xl"
            role="tablist"
            aria-label="اختر نوع جهازك"
          >
            {PLATFORM_TABS.map((tab) => {
              const active = selectedPlatform === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedPlatform(tab.id)}
                  className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-white text-emerald-800 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.id === 'desktop' ? (
                    <Monitor className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Smartphone className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Step-by-step Instructions */}
          <ol className="space-y-2.5">
            {selectedPlatform === 'desktop' && (
              <>
                <StepItem
                  step={1}
                  icon={<MonitorDown className="w-4 h-4 text-emerald-700" />}
                  title="اضغط على أيقونة التثبيت في شريط العنوان"
                  detail="تظهر أعلى المتصفح (Chrome أو Edge) بجانب علامة النجمة."
                />
                <StepItem
                  step={2}
                  icon={<MoreVertical className="w-4 h-4 text-emerald-700" />}
                  title="أو من قائمة المتصفح (⋮)"
                  detail="اختر «تثبيت وصال» أو «حفظ ومشاركة ← تثبيت الصفحة كتطبيق»."
                />
                <StepItem
                  step={3}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />}
                  title="أكد التثبيت ليظهر على سطح المكتب"
                  detail="اضغط «تثبيت» (Install) لإنشاء اختصار مباشر على سطح المكتب."
                />
              </>
            )}

            {selectedPlatform === 'android' && (
              <>
                <StepItem
                  step={1}
                  icon={<MoreVertical className="w-4 h-4 text-emerald-700" />}
                  title="افتح قائمة متصفح Chrome (⋮)"
                  detail="اضغط على النقاط الثلاث في الزاوية العلوية للشاشة."
                />
                <StepItem
                  step={2}
                  icon={<PlusSquare className="w-4 h-4 text-emerald-700" />}
                  title="اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية»"
                  detail="ستظهر نافذة تأكيد باسم وأيقونة «وصال»."
                />
                <StepItem
                  step={3}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />}
                  title="اضغط «تثبيت»"
                  detail="ستضاف أيقونة التطبيق مباشرة على الشاشة الرئيسية لجهازك."
                />
              </>
            )}

            {selectedPlatform === 'ios' && (
              <>
                <StepItem
                  step={1}
                  icon={<Share className="w-4 h-4 text-emerald-700" />}
                  title="اضغط على زر المشاركة في Safari"
                  detail="الأيقونة الموجودة في الشريط السفلي لمتصفح Safari."
                />
                <StepItem
                  step={2}
                  icon={<PlusSquare className="w-4 h-4 text-emerald-700" />}
                  title="اختر «إضافة إلى الشاشة الرئيسية»"
                  detail="مرّر القائمة للأسفل واضغط Add to Home Screen."
                />
                <StepItem
                  step={3}
                  icon={<CheckCircle2 className="w-4 h-4 text-emerald-700" />}
                  title="اضغط «إضافة» (Add)"
                  detail="افتح «وصال» من الشاشة الرئيسية لتفعيل الإشعارات والوصول السريع."
                />
              </>
            )}
          </ol>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleClose}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors"
          >
            {isInstallable ? 'لاحقاً، متابعة للموقع' : 'فهمت، متابعة للموقع'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface StepItemProps {
  step: number;
  icon: React.ReactNode;
  title: string;
  detail: string;
}

function StepItem({ step, icon, title, detail }: StepItemProps) {
  return (
    <li className="flex items-start gap-3 p-3 rounded-xl bg-[#F7F8F7] border border-slate-200/70">
      <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-slate-900 leading-snug">
          <span className="text-emerald-700 ml-1">{step}.</span>
          {title}
        </p>
        <p className="text-[11px] text-slate-600 mt-0.5 leading-relaxed">{detail}</p>
      </div>
    </li>
  );
}
