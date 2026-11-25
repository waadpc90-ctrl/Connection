import { useEffect, useState } from 'react';
import { BellOff, BellRing, CheckCircle2, Send, Smartphone } from 'lucide-react';
import {
  checkActiveExternalSubscription,
  isExternalPushSupported,
  isIOSDevice,
  isStandaloneMode,
  sendLocalTestExternalNotification,
  subscribeDeviceToExternalPush,
  unsubscribeDeviceFromExternalPush,
} from '../lib/pushNotifications';
import { PWAInstallButton } from './PWAInstallButton';

interface ExternalPushBannerProps {
  scope: 'stage' | 'pass';
  scopeToken: string;
  schoolOwnerId: string;
  schoolName: string;
  sectionId?: string;
  studentId?: string;
  contextLabel: string;
  disabledDemo?: boolean;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

export function ExternalPushBanner({
  scope,
  scopeToken,
  schoolOwnerId,
  schoolName,
  sectionId = 'all',
  studentId,
  contextLabel,
  disabledDemo = false,
  onNotify,
}: ExternalPushBannerProps) {
  const [supported] = useState<boolean>(() => isExternalPushSupported());
  const [iosNeedsInstall] = useState<boolean>(() => isIOSDevice() && !isStandaloneMode());
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'default'
  );
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    if (disabledDemo || !scopeToken) return;
    let active = true;
    checkActiveExternalSubscription(scope, scopeToken).then((isActive) => {
      if (active) setSubscribed(isActive);
    });
    return () => {
      active = false;
    };
  }, [scope, scopeToken, disabledDemo]);

  const handleEnable = async () => {
    if (disabledDemo) {
      onNotify('success', 'في البطاقة الحقيقية سيتم تفعيل الإشعارات الخارجية على جهاز ولي الأمر مباشرة.');
      return;
    }
    setBusy(true);
    try {
      await subscribeDeviceToExternalPush({
        scope,
        scopeToken,
        schoolOwnerId,
        sectionId,
        studentId,
        welcomeTitle: `تم تفعيل إشعارات ${schoolName}`,
        welcomeBody: `ستصلك الإشعارات الخارجية لـ ${contextLabel} فوراً على جهازك حتى عند إغلاق الموقع.`,
      });
      setPermission('granted');
      setSubscribed(true);
      onNotify('success', 'تم تفعيل الإشعارات الخارجية بنجاح! ستصلك التنبيهات حتى عند إغلاق الموقع.');
    } catch (err) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
      }
      const msg = err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات الخارجية على هذا الجهاز.';
      onNotify('error', msg);
    } finally {
      setBusy(false);
    }
  };

  const handleDisable = async () => {
    if (disabledDemo) return;
    setBusy(true);
    try {
      await unsubscribeDeviceFromExternalPush(scope, scopeToken);
      setSubscribed(false);
      onNotify('success', 'تم إيقاف الإشعارات الخارجية على هذا الجهاز.');
    } catch {
      onNotify('error', 'تعذر إيقاف الإشعارات حالياً.');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (disabledDemo) return;
    try {
      const targetUrl =
        scope === 'stage'
          ? `/?stage=${encodeURIComponent(scopeToken)}`
          : `/?pass=${encodeURIComponent(scopeToken)}`;
      await sendLocalTestExternalNotification(
        `إشعار تجريبي — ${schoolName}`,
        `الإشعارات الخارجية تعمل بنجاح لـ ${contextLabel}. اضغط لفتح البوابة.`,
        targetUrl
      );
      onNotify('success', 'تم إرسال إشعار خارجي تجريبي إلى جهازك الآن.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر إرسال الإشعار التجريبي.';
      onNotify('error', msg);
    }
  };

  return (
    <section className="no-print bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${
              subscribed
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {subscribed ? <CheckCircle2 className="w-5 h-5" /> : <BellRing className="w-5 h-5" />}
          </div>

          <div className="min-w-0">
            <h2 className="font-display text-sm sm:text-base font-bold text-slate-900">
              {subscribed
                ? 'الإشعارات الخارجية مفعّلة على هذا الجهاز'
                : 'تفعيل الإشعارات الخارجية على جهازك'}
            </h2>
            <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
              {subscribed
                ? `ستصلك تنبيهات ${schoolName} (${contextLabel}) مباشرة على شاشة الجهاز حتى لو كان الموقع مغلقاً.`
                : iosNeedsInstall
                  ? 'على أجهزة iPhone و iPad، أضف الموقع إلى الشاشة الرئيسية أولاً لتفعيل إشعارات شاشة القفل.'
                  : permission === 'denied'
                    ? 'تم حظر الإشعارات من إعدادات المتصفح. يمكنك السماح بها من أيقونة القفل في شريط العنوان ثم إعادة المحاولة.'
                    : !supported
                      ? 'متصفحك الحالي لا يدعم الإشعارات الخلفية؛ افتح الرابط في Chrome أو Safari الحديث لتفعيلها.'
                      : 'استلم تنبيهات الغياب والدرجات والرسائل والصور فوراً على شاشة جوالك أو حاسوبك حتى عند إغلاق الموقع.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <PWAInstallButton compact />

          {subscribed ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleTest}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                <span>تجربة إشعار</span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleDisable}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>إيقاف</span>
              </button>
            </>
          ) : (
            supported &&
            !iosNeedsInstall && (
              <button
                type="button"
                disabled={busy}
                onClick={handleEnable}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>{busy ? 'جاري التفعيل...' : 'تفعيل الإشعارات الخارجية'}</span>
              </button>
            )
          )}
        </div>
      </div>
    </section>
  );
}
