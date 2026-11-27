import { useEffect, useState } from 'react';
import { ArrowRight, KeyRound, Lock, LogOut, ShieldCheck } from 'lucide-react';
import {
  isValidAdminPinFormat,
  normalizePinInput,
  verifyAdminPin,
} from '../lib/adminSecurity';
import { setSchoolAdminPin } from '../lib/wisaalService';

interface AdminPinGateProps {
  schoolId: string;
  schoolName: string;
  userEmail: string;
  isSchoolOwner: boolean;
  hasPinConfigured: boolean;
  pinHash?: string;
  pinSalt?: string;
  onUnlocked: () => void;
  onSignOut: () => void;
  onBackToParents: () => void;
  onNotify: (kind: 'success' | 'error', message: string) => void;
}

const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

export function AdminPinGate({
  schoolId,
  schoolName,
  userEmail,
  isSchoolOwner,
  hasPinConfigured,
  pinHash,
  pinSalt,
  onUnlocked,
  onSignOut,
  onBackToParents,
  onNotify,
}: AdminPinGateProps) {
  const [pin, setPin] = useState<string>('');
  const [confirmPin, setConfirmPin] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState<number>(0);
  const [cooldownLeft, setCooldownLeft] = useState<number>(0);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownLeft((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownLeft]);

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cooldownLeft > 0 || !pinHash || !pinSalt) return;
    const normalized = normalizePinInput(pin);
    if (!normalized) {
      setErrorMsg('أدخل رمز الدخول.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const ok = await verifyAdminPin(normalized, pinHash, pinSalt);
      if (ok) {
        setPin('');
        setFailedAttempts(0);
        onUnlocked();
      } else {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        setPin('');
        if (nextAttempts >= MAX_ATTEMPTS) {
          setCooldownLeft(LOCKOUT_SECONDS);
          setFailedAttempts(0);
          setErrorMsg(`محاولات خاطئة متكررة. انتظر ${LOCKOUT_SECONDS} ثانية.`);
        } else {
          setErrorMsg('الرمز غير صحيح.');
        }
      }
    } catch {
      setErrorMsg('تعذر التحقق من الرمز.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetupPinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const first = normalizePinInput(pin);
    const second = normalizePinInput(confirmPin);

    if (!isValidAdminPinFormat(first)) {
      setErrorMsg('اختر رمزاً من 4 إلى 16 خانة.');
      return;
    }
    if (first !== second) {
      setErrorMsg('الرمزان غير متطابقين.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      await setSchoolAdminPin(schoolId, first);
      setPin('');
      setConfirmPin('');
      onNotify('success', 'تم تفعيل رمز قفل لوحة الإدارة.');
      onUnlocked();
    } catch {
      setErrorMsg('تعذر حفظ الرمز. حاول مرة أخرى.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8F7] text-slate-900 flex flex-col">
      <header className="bg-white/95 border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="font-display text-lg font-bold text-slate-900 truncate">
            {schoolName || 'وصال'}
          </span>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBackToParents}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap"
            >
              <ArrowRight className="w-4 h-4" />
              <span>الأولياء</span>
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-rose-700 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>خروج</span>
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200/80 rounded-xl p-6 sm:p-8 space-y-6">
          {hasPinConfigured ? (
            <>
              <div className="text-center space-y-2">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 flex items-center justify-center mx-auto">
                  <Lock className="w-5 h-5" />
                </div>
                <h1 className="font-display text-xl font-bold text-slate-900">
                  لوحة الإدارة مقفولة
                </h1>
                <p className="text-xs text-slate-500 truncate" dir="ltr">
                  {userEmail}
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 text-center">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleUnlockSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1.5">
                    رمز دخول الإدارة
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    autoComplete="off"
                    maxLength={16}
                    dir="ltr"
                    value={pin}
                    disabled={cooldownLeft > 0 || submitting}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="••••"
                    className="w-full px-4 py-3 text-center text-lg font-mono tracking-[0.35em] bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700 disabled:bg-slate-50"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || cooldownLeft > 0 || !pin.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>
                    {cooldownLeft > 0
                      ? `انتظر (${cooldownLeft}ث)`
                      : submitting
                        ? 'جاري التحقق...'
                        : 'فتح لوحة الإدارة'}
                  </span>
                </button>
              </form>
            </>
          ) : isSchoolOwner ? (
            <>
              <div className="text-center space-y-2">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 flex items-center justify-center mx-auto">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h1 className="font-display text-xl font-bold text-slate-900">
                  تعيين رمز قفل الإدارة
                </h1>
                <p className="text-xs text-slate-500">
                  أنشئ رمزاً سرياً (4 إلى 16 خانة) لقفل لوحة الإدارة
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 text-center">
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleSetupPinSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    الرمز الجديد
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoFocus
                    autoComplete="new-password"
                    maxLength={16}
                    dir="ltr"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="••••"
                    className="w-full px-4 py-2.5 text-center text-base font-mono tracking-[0.3em] bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    تأكيد الرمز
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    maxLength={16}
                    dir="ltr"
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value)}
                    placeholder="••••"
                    className="w-full px-4 py-2.5 text-center text-base font-mono tracking-[0.3em] bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-700"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting || !pin.trim() || !confirmPin.trim()}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  <span>{submitting ? 'جاري الحفظ...' : 'حفظ الرمز والدخول'}</span>
                </button>
              </form>
            </>
          ) : (
            <div className="text-center space-y-4">
              <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h1 className="font-display text-lg font-bold text-slate-900">
                بانتظار تعيين رمز الإدارة
              </h1>
              <p className="text-xs text-slate-500">
                يجب على مدير المدرسة تعيين رمز قفل لوحة الإدارة أولاً.
              </p>
              <button
                type="button"
                onClick={onSignOut}
                className="w-full py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                تسجيل الخروج
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
