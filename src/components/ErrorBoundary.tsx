import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'حدث خطأ غير متوقع أثناء تشغيل المنصة.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        if (parsed.error.includes('Quota exceeded')) {
          readable = 'تم الوصول إلى الحد اليومي المجاني لقاعدة البيانات. يُعاد التعيين تلقائياً في اليوم التالي.';
        } else if (parsed.error.includes('Missing or insufficient permissions')) {
          readable = 'تعذر إتمام العملية بسبب صلاحيات الوصول. يرجى التأكد من تسجيل الدخول بحساب موثق.';
        } else {
          readable = parsed.error;
        }
      }
    } catch {
      // Keep raw error message
    }
    return { hasError: true, message: readable };
  }

  componentDidCatch(error: Error) {
    console.error('Wisaal ErrorBoundary:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8F9F7] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 text-center">
            <div className="w-12 h-12 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="font-display text-xl font-bold text-slate-900 mb-2">
              تعذر عرض هذه الصفحة مؤقتاً
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed mb-6">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              <span>إعادة تحميل الصفحة</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
