import { useEffect, useState } from 'react';
import { reauthenticateWithPopup } from 'firebase/auth';
import { ArrowRight, KeyRound, Lock, LogOut, RotateCcw, ShieldCheck } from 'lucide-react';
import {
  clearPinLockout,
  isValidAdminPinFormat,
  normalizePinInput,
  PIN_MAX_ATTEMPTS,
  readPinLockoutState,
  recordPinFailure,
  verifyAdminPin,
} from '../lib/adminSecurity';
import { auth, googleProvider } from '../lib/firebase';
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
  const [cooldownLeft, setCooldownLeft] = useState<number>(0);
  const [resetMode, setResetMode] = useState<boolean>(false);
  const [reauthing, setReauthing] = useState<boolean>(false);

  // Restore persistent lockout timer on mount / school switch
  useEffect(() => {
    const state = readPinLockoutState(schoolId);
    const remainingSec = Math.max(0, Math.ceil((state.lockedUntilMs - Date.now()) / 1000));
    setCooldownLeft(remainingSec);
  }, [schoolId]);

  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = window.setInterval(() => {
      const state = readPinLockoutState(schoolId);
      const remainingSec = Math.max(0, Math.ceil((state.lockedUntilMs - Date.now()) / 1000));
      setCooldownLeft(remainingSec);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownLeft, schoolId]);

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
        clearPinLockout(schoolId);
        setPin('');
        setCooldownLeft(0);
        onUnlocked();
      } else {
        setPin('');
        const next = recordPinFailure(schoolId);
        if (next.state.lockedUntilMs > Date.now()) {
          const secs = Math.max(1, Math.ceil((next.state.lockedUntilMs - Date.now()) / 1000));
          setCooldownLeft(secs);
          setErrorMsg(`محاولات خاطئة متكررة. انتظر ${secs} ثانية.`);
        } else {
          const left = Math.max(1, PIN_MAX_ATTEMPTS - next.state.failedAttempts);
          setErrorMsg(`الرمز غير صحيح (${left} محاولات متبقية).`);
        }
      }
    } catch {
      setErrorMsg('تعذر التحقق من الرمز.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartOwnerReset = async () => {
    if (!isSchoolOwner || !auth.currentUser) return;
    setReauthing(true);
    setErrorMsg(null);
    try {
      await reauthenticateWithPopup(auth.currentUser, googleProvider);
      setPin('');
      setConfirmPin('');
      setResetMode(true);
      onNotify('success', 'تم التحقق من هويتك. يمكنك الآن تعيين رمز جديد.');
    } catch {
      setErrorMsg('تعذر إعادة التحقق عبر Google. حاول مرة أخرى.');
    } finally {
      setReauthing(false);
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
      clearPinLockout(schoolId);
      setPin('');
      setConfirmPin('');
      setResetMode(false);
      setCooldownLeft(0);
      onNotify('success', resetMode ? 'تم إعادة تعيين رمز الإدارة بنجاح.' : 'تم تفعيل رمز قفل لوحة الإدارة.');
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
          {hasPinConfigured && !resetMode ? (
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

              {isSchoolOwner && (
                <div className="pt-2 border-t border-slate-100 text-center">
                  <button
                    type="button"
                    disabled={reauthing}
                    onClick={handleStartOwnerReset}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-800 disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{reauthing ? 'جاري التحقق عبر Google...' : 'نسيت الرمز؟ إعادة تعيين'}</span>
                  </button>
                </div>
              )}
            </>
          ) : isSchoolOwner ? (
            <>
              <div className="text-center space-y-2">
                <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 flex items-center justify-center mx-auto">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h1 className="font-display text-xl font-bold text-slate-900">
                  {resetMode ? 'إعادة تعيين رمز الإدارة' : 'تعيين رمز قفل الإدارة'}
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

                {resetMode && (
                  <button
                    type="button"
                    onClick={() => {
                      setResetMode(false);
                      setErrorMsg(null);
                      setPin('');
                      setConfirmPin('');
                    }}
                    className="w-full py-2 text-xs text-slate-500 hover:text-slate-800"
                  >
                    رجوع لإدخال الرمز
                  </button>
                )}
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
