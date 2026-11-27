import { ArrowRight, GraduationCap, LogIn } from 'lucide-react';

interface AdminLoginViewProps {
  onSignIn: () => void;
  signingIn: boolean;
  authError: string | null;
  onBackToParents: () => void;
}

export function AdminLoginView({
  onSignIn,
  signingIn,
  authError,
  onBackToParents,
}: AdminLoginViewProps) {
  return (
    <div className="min-h-screen bg-[#F7F8F7] text-slate-900 flex flex-col">
      <header className="bg-white/95 border-b border-slate-200/80">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <span className="font-display text-lg font-bold text-slate-900">وصال</span>

          <button
            type="button"
            onClick={onBackToParents}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors whitespace-nowrap"
          >
            <ArrowRight className="w-4 h-4" />
            <span>واجهة أولياء الأمور</span>
          </button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-sm bg-white border border-slate-200/80 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/70 text-emerald-700 flex items-center justify-center mx-auto">
              <GraduationCap className="w-6 h-6" />
            </div>
            <h1 className="font-display text-xl font-bold text-slate-900">بوابة الإدارة</h1>
            <p className="text-xs text-slate-500">تسجيل الدخول لإدارة الغياب والدرجات والإشعارات</p>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors"
          >
            <LogIn className="w-4 h-4" />
            <span>{signingIn ? 'جاري الدخول...' : 'دخول الإدارة بحساب Google'}</span>
          </button>
        </div>
      </main>
    </div>
  );
}
