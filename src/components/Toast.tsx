import { CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface ToastState {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface ToastProps {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  if (!toast) return null;

  const isSuccess = toast.kind === 'success';

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-5 left-5 z-50 max-w-sm w-[calc(100%-2.5rem)] sm:w-auto"
    >
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-sm transition-all duration-150 ${
          isSuccess
            ? 'bg-slate-900 text-white border-slate-800'
            : 'bg-rose-700 text-white border-rose-800'
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        ) : (
          <AlertCircle className="w-4 h-4 text-rose-200 shrink-0" />
        )}
        <span className="text-sm font-medium leading-snug">{toast.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق الإشعار"
          className="mr-auto p-1 text-white/70 hover:text-white rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
