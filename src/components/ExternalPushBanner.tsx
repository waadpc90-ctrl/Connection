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
      onNotify('success', 'متاح على البطاقة الفعلية.');
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
        welcomeTitle: schoolName,
        welcomeBody: `تم تفعيل إشعارات ${contextLabel}.`,
      });
      setPermission('granted');
      setSubscribed(true);
      onNotify('success', 'تم تفعيل الإشعارات الخارجية.');
    } catch (err) {
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setPermission(Notification.permission);
      }
      onNotify('error', err instanceof Error ? err.message : 'تعذر تفعيل الإشعارات.');
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
      onNotify('success', 'تم إيقاف الإشعارات الخارجية.');
    } catch {
      onNotify('error', 'تعذر إيقاف الإشعارات.');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    if (disabledDemo) return;
    try {
      const targetUrl =
        scope === 'stage'
          ? `./?stage=${encodeURIComponent(scopeToken)}`
          : `./?pass=${encodeURIComponent(scopeToken)}`;
      await sendLocalTestExternalNotification(schoolName, `إشعار تجريبي — ${contextLabel}`, targetUrl);
      onNotify('success', 'تم إرسال إشعار تجريبي.');
    } catch (err) {
      onNotify('error', err instanceof Error ? err.message : 'تعذر الإرسال.');
    }
  };

  return (
    <section className="no-print bg-white border border-slate-200/80 rounded-xl px-4 py-3.5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        {subscribed ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
        ) : (
          <BellRing className="w-4 h-4 text-slate-600 shrink-0" />
        )}
        <p className="text-xs sm:text-sm font-medium text-slate-800 truncate">
          {subscribed
            ? 'الإشعارات الخارجية مفعّلة'
            : iosNeedsInstall
              ? 'أضف التطبيق للشاشة الرئيسية لتفعيل الإشعارات'
              : permission === 'denied'
                ? 'الإشعارات محظورة من إعدادات المتصفح'
                : !supported
                  ? 'افتح الرابط في Chrome أو Safari لتفعيل الإشعارات'
                  : 'تفعيل الإشعارات الخارجية على الجهاز'}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <PWAInstallButton compact />

        {subscribed ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              <span>تجربة</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleDisable}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap"
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
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>{busy ? 'جاري...' : 'تفعيل'}</span>
            </button>
          )
        )}
      </div>
    </section>
  );
}
