import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState<boolean>(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center justify-center gap-1.5 font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
          compact ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'
        }`}
      >
        <Download className="w-3.5 h-3.5 text-emerald-700" />
        <span>تثبيت التطبيق على الجهاز</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-1.5 font-semibold text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            compact ? 'px-3 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'
          }`}
        >
          <Smartphone className="w-3.5 h-3.5 text-emerald-700" />
          <span>تثبيت على iPhone للإشعارات</span>
        </button>

        {showIOSGuide && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={() => setShowIOSGuide(false)}
            role="dialog"
            aria-modal="true"
            aria-label="تثبيت التطبيق على iPhone"
          >
            <div
              className="w-full max-w-sm bg-white border border-slate-200 rounded-xl p-6 space-y-4 text-right"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-base font-bold text-slate-900">
                  تثبيت «وصال» على iPhone / iPad
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                  aria-label="إغلاق"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                لاستلام الإشعارات الخارجية على شاشة القفل في أجهزة Apple، أضف الصفحة للشاشة الرئيسية
                في خطوتين:
              </p>
              <ol className="text-xs text-slate-800 space-y-2.5 leading-relaxed list-decimal list-inside">
                <li>
                  اضغط على زر <strong>المشاركة</strong>{' '}
                  <Share className="w-3.5 h-3.5 inline text-emerald-700" /> أسفل متصفح Safari.
                </li>
                <li>
                  اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong> ثم افتح
                  التطبيق واضغط «تفعيل الإشعارات الخارجية».
                </li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                فهمت
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
