import { useState } from 'react';
import { ArrowLeft, BellRing, GraduationCap, QrCode } from 'lucide-react';

interface LandingViewProps {
  onSignIn: () => void;
  signingIn: boolean;
  onPreviewParentPass: () => void;
  onPreviewStagePortal: () => void;
  authError: string | null;
}

const HERO_IMAGE_PATH = './src/assets/images/hero_wisaal_school_1795623756360.jpg';

export function LandingView({
  onSignIn,
  signingIn,
  onPreviewParentPass,
  onPreviewStagePortal,
  authError,
}: LandingViewProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F7F8F7] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-30 bg-[#F7F8F7]/95 backdrop-blur-sm border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            وصال
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              type="button"
              onClick={onPreviewStagePortal}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              بوابة المرحلة
            </button>
            <button
              type="button"
              onClick={onPreviewParentPass}
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              بطاقة الطالب
            </button>
          </nav>

          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            className="px-4 py-2 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {signingIn ? 'جاري الدخول...' : 'دخول الإدارة'}
          </button>
        </div>
      </header>

      <main id="top" className="flex-1 flex items-center">
        <section className="max-w-6xl w-full mx-auto px-6 py-12 lg:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <h1
                className="font-display font-bold text-slate-900 leading-[1.2] mb-5"
                style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.25rem)', textWrap: 'balance' }}
              >
                متابعة الغياب والدرجات بإشعار فوري مباشر
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-lg mb-8">
                إدارة المراحل الثلاث، قراءة كشوف الدرجات بالصورة، وإرسال التبليغات لأولياء الأمور
                عبر الباركود.
              </p>

              {authError && (
                <div className="mb-6 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
                  {authError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={signingIn}
                  className="inline-flex items-center justify-center gap-2.5 px-6 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <span>{signingIn ? 'جاري تسجيل الدخول...' : 'الدخول بحساب Google'}</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onPreviewStagePortal}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <BellRing className="w-4 h-4 text-emerald-700" />
                  <span>بوابة المرحلة</span>
                </button>

                <button
                  type="button"
                  onClick={onPreviewParentPass}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <QrCode className="w-4 h-4 text-emerald-700" />
                  <span>بطاقة الطالب</span>
                </button>
              </div>

              <div className="mt-10 pt-6 border-t border-slate-200/80 grid grid-cols-3 gap-6 max-w-lg">
                <div>
                  <p className="font-mono tabular-nums text-lg font-bold text-slate-900">3 مراحل</p>
                  <p className="text-xs text-slate-500 mt-0.5">بباركود مستقل</p>
                </div>
                <div>
                  <p className="font-mono tabular-nums text-lg font-bold text-slate-900">فوري</p>
                  <p className="text-xs text-slate-500 mt-0.5">إشعارات داخلية وخارجية</p>
                </div>
                <div>
                  <p className="font-mono tabular-nums text-lg font-bold text-slate-900">بالصورة</p>
                  <p className="text-xs text-slate-500 mt-0.5">رصد درجات الشعبة</p>
                </div>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[300px] lg:min-h-[420px] rounded-xl overflow-hidden border border-slate-200/80 bg-slate-100">
                {!imgFailed ? (
                  <img
                    src={HERO_IMAGE_PATH}
                    alt="قاعة دراسية منظمة"
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full min-h-[300px] bg-gradient-to-br from-emerald-50 via-stone-50 to-slate-100 flex flex-col items-center justify-center p-8 text-center">
                    <GraduationCap className="w-12 h-12 text-emerald-700 mb-3" />
                    <p className="font-display text-lg font-semibold text-slate-800">وصال</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
