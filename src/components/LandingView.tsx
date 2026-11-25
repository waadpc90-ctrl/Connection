import { useState } from 'react';
import {
  ArrowLeft,
  BellRing,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  QrCode,
  Radar,
  ShieldCheck,
} from 'lucide-react';

interface LandingViewProps {
  onSignIn: () => void;
  signingIn: boolean;
  onPreviewParentPass: () => void;
  onPreviewStagePortal: () => void;
  authError: string | null;
}

const HERO_IMAGE_PATH = '/src/assets/images/hero_wisaal_school_1795623756360.jpg';

export function LandingView({
  onSignIn,
  signingIn,
  onPreviewParentPass,
  onPreviewStagePortal,
  authError,
}: LandingViewProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="min-h-screen bg-[#F8F9F7] text-slate-900 flex flex-col">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-[#F8F9F7]/95 backdrop-blur-sm border-b border-slate-200/90">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="font-display text-xl font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            وصال
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a
              href="#workflow"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              كيف يعمل
            </a>
            <a
              href="#parent-experience"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              تجربة الأهل
            </a>
            <a
              href="#capabilities"
              className="hover:text-slate-900 transition-colors whitespace-nowrap shrink-0"
            >
              مزايا المدرسة
            </a>
          </nav>

          <button
            type="button"
            onClick={onSignIn}
            disabled={signingIn}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {signingIn ? 'جاري الدخول...' : 'دخول الإدارة'}
          </button>
        </div>
      </header>

      <main id="top" className="flex-1">
        {/* Balanced 2-Column Editorial Hero */}
        <section className="max-w-6xl mx-auto px-6 pt-12 pb-16 lg:pt-16 lg:pb-20">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-sm font-medium text-emerald-800 mb-4">
                باركود لكل مرحلة · إشعار فوري جماعي عبر الموقع بدون واتساب
              </p>

              <h1
                className="font-display font-bold text-slate-900 leading-[1.22] mb-5"
                style={{ fontSize: 'clamp(2.1rem, 3.6vw, 3.15rem)', textWrap: 'balance' }}
              >
                بلّغ جميع شعب المرحلة بالدرجات والغياب فوراً عبر الموقع
              </h1>

              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-8">
                أعطِ أولياء الأمور باركوداً واحداً لكل مرحلة دراسية. فور رفع صورة درجات الشعبة أو
                رصد الغياب أو إرسال تعميم جماعي، يصل الإشعار حياً وفورياً عبر الموقع مباشرة دون
                واتساب ودون تسجيل دخول للأهل.
              </p>

              {authError && (
                <div className="mb-5 p-3.5 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-800">
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
                  <span>{signingIn ? 'جاري تسجيل الدخول...' : 'ابدأ بلوحة المدرسة (Google)'}</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onPreviewStagePortal}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <BellRing className="w-4 h-4 text-emerald-700" />
                  <span>معاينة باركود المرحلة</span>
                </button>

                <button
                  type="button"
                  onClick={onPreviewParentPass}
                  className="inline-flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <QrCode className="w-4 h-4 text-emerald-700" />
                  <span>معاينة بطاقة الطالب</span>
                </button>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-200 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-500">
                <span>3 مراحل مفصولة بالكامل</span>
                <span aria-hidden="true">·</span>
                <span>إشعار فوري حي عبر الموقع</span>
                <span aria-hidden="true">·</span>
                <span>رفع درجات الشعبة بالصورة</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="relative h-full min-h-[320px] rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                {!imgFailed ? (
                  <img
                    src={HERO_IMAGE_PATH}
                    alt="قاعة دراسية مضاءة بنور الصباح تعكس هدوء البيئة المدرسية المنظمة"
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full min-h-[320px] bg-gradient-to-br from-emerald-50 via-stone-50 to-slate-100 flex flex-col items-center justify-center p-8 text-center">
                    <GraduationCap className="w-12 h-12 text-emerald-700 mb-3" />
                    <p className="font-display text-lg font-semibold text-slate-800">
                      تواصل مدرسي هادئ ومباشر
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 4-Column Quantitative Proof Strip Below Hero Split */}
          <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 bg-white border border-slate-200 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:divide-x-reverse divide-slate-200">
            <div className="p-5">
              <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900">3 باركود</p>
              <p className="text-xs text-slate-600 mt-1">باركود مستقل لكل مرحلة يبلّغ جميع شعبها</p>
            </div>
            <div className="p-5">
              <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900">0 خطوات</p>
              <p className="text-xs text-slate-600 mt-1">تسجيل دخول مطلوب من ولي الأمر</p>
            </div>
            <div className="p-5">
              <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900">صورة واحدة</p>
              <p className="text-xs text-slate-600 mt-1">لرفع درجات شعبة كاملة وتجميع خلاصة المواد</p>
            </div>
            <div className="p-5">
              <p className="font-mono tabular-nums text-2xl font-semibold text-slate-900">فوري 100%</p>
              <p className="text-xs text-slate-600 mt-1">إشعار حي مباشر عبر الموقع بدون واتساب</p>
            </div>
          </div>
        </section>

        {/* 3-Step Workflow Section */}
        <section id="workflow" className="border-t border-slate-200 bg-white py-16">
          <div className="max-w-6xl mx-auto px-6">
            <div className="max-w-2xl mb-12">
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 mb-3">
                ثلاث خطوات لتبليغ جماعي فوري بلا واتساب
              </h2>
              <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
                نظام متكامل يفصل درجات وغيابات كل مرحلة ويجمع كل المواد تلقائياً في بطاقة واحدة.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="pt-5 border-t border-slate-200">
                <p className="font-mono text-xs text-emerald-800 font-semibold mb-2">01</p>
                <h3 className="font-display text-lg font-semibold text-slate-900 mb-2">
                  باركود واحد لكل مرحلة دراسية
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  تطبع المدرسة ملصقاً يحتوي على باركود كل مرحلة. يمسحه ولي الأمر مرة واحدة لتفتح له
                  بوابة المرحلة الحية ويختار شعبة ابنه لتصله التنبيهات فوراً.
                </p>
              </div>

              <div className="pt-5 border-t border-slate-200">
                <p className="font-mono text-xs text-emerald-800 font-semibold mb-2">02</p>
                <h3 className="font-display text-lg font-semibold text-slate-900 mb-2">
                  رفع درجات الشعبة بالصورة وتجميع المواد
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  صوّر ورقة درجات أي مادة لشعبة كاملة، يقرأها النظام ويجمع درجات الطالب من جميع
                  المواد في بطاقة خلاصة شاملة ويصدر إشعاراً فورياً للجميع.
                </p>
              </div>

              <div className="pt-5 border-t border-slate-200">
                <p className="font-mono text-xs text-emerald-800 font-semibold mb-2">03</p>
                <h3 className="font-display text-lg font-semibold text-slate-900 mb-2">
                  إشعار فوري حي عبر الموقع
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  عند إرسال تعميم للمرحلة أو اعتماد غياب اليوم أو نشر الدرجات، يظهر الإشعار لحظياً
                  على بوابة المرحلة وبطاقة كل طالب مع تنبيه صوتي وإشعار متصفح فوري.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Parent Experience & School Capabilities */}
        <section id="parent-experience" className="py-16 max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
            <div className="bg-white border border-slate-200 rounded-xl p-7">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                  <BellRing className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  ماذا يرى ولي الأمر؟
                </h3>
              </div>

              <p className="text-sm text-slate-600 leading-relaxed mb-6">
                تجربة ويب فورية بدون تحميل تطبيقات وبدون مجموعات واتساب مزدحمة:
              </p>

              <ul className="space-y-3.5 text-sm text-slate-700 mb-7">
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>بوابة المرحلة عبر الباركود: تستقبل جميع إشعارات المرحلة والشعبة لحظياً.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>بطاقة خلاصة الطالب: تجمع درجات جميع المواد وحالة الغياب اليومي في صفحة واحدة.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                  <span>توثيق فوري للاطلاع أو إرسال عذر غياب مباشرة لإدارة المدرسة عبر الموقع.</span>
                </li>
              </ul>

              <div className="flex flex-wrap items-center gap-5">
                <button
                  type="button"
                  onClick={onPreviewStagePortal}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800 hover:text-emerald-900 transition-colors"
                >
                  <span>معاينة بوابة باركود المرحلة</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={onPreviewParentPass}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
                >
                  <span>معاينة بطاقة الطالب</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div id="capabilities" className="bg-white border border-slate-200 rounded-xl p-7">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <h3 className="font-display text-xl font-bold text-slate-900">
                  أدوات قوية لإدارة المدرسة
                </h3>
              </div>

              <div className="divide-y divide-slate-200">
                <div className="py-3.5 first:pt-1 flex items-start gap-3">
                  <Camera className="w-4 h-4 text-emerald-700 shrink-0 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      قراءة كشوف الدرجات بالصورة وتجميع الخلاصة
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      ارفع صورة كشف أي مادة ليطابق الأسماء والدرجات تلقائياً ويحدّث بطاقة الخلاصة
                      الشاملة لكل طالب مع إشعار فوري لجميع أولياء الأمور.
                    </p>
                  </div>
                </div>

                <div className="py-3.5 flex items-start gap-3">
                  <Radar className="w-4 h-4 text-amber-600 shrink-0 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      فصل تام بين المراحل الثلاث ورادار متابعة
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      درجات وغيابات وشعب كل مرحلة مفصولة بالكامل، مع رصد تلقائي للطلاب الذين
                      يحتاجون متابعة مبكرة.
                    </p>
                  </div>
                </div>

                <div className="py-3.5 last:pb-0 flex items-start gap-3">
                  <ShieldCheck className="w-4 h-4 text-slate-700 shrink-0 mt-1" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      خصوصية كاملة على بوابة باركود المرحلة
                    </p>
                    <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
                      باركود المرحلة يعرض الإشعارات الجماعية للشعب فقط، ولا يكشف أبداً أرقام هواتف
                      أو درجات طلاب آخرين.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <span className="font-display font-semibold text-slate-800">وصال للتواصل المدرسي</span>
          <span>باركود لكل مرحلة · إشعار فوري عبر الموقع بالغياب والدرجات</span>
        </div>
      </footer>
    </div>
  );
}
