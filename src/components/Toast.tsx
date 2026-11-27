import { AnimatePresence, motion } from 'motion/react';
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
  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-20 lg:bottom-6 left-4 right-4 sm:right-auto sm:left-6 z-50 pointer-events-none flex justify-center sm:justify-start"
    >
      <AnimatePresence mode="wait">
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm w-full sm:w-auto ${
              toast.kind === 'success'
                ? 'bg-slate-900/95 backdrop-blur-md text-white border-slate-800 shadow-slate-900/15'
                : 'bg-rose-700/95 backdrop-blur-md text-white border-rose-800 shadow-rose-900/15'
            }`}
          >
            {toast.kind === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-200 shrink-0" />
            )}
            <span className="text-sm font-medium leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="إغلاق الإشعار"
              className="mr-auto p-1 text-white/70 hover:text-white rounded-md transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
