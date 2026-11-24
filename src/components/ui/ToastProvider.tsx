import React, { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { Z_INDEX } from './zIndex';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ShowToastOptions {
  action?: ToastAction;
  durationMs?: number;
}

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {}
});

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = 'info', options?: ShowToastOptions) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev.slice(-3), { id, message, variant, action: options?.action }]);
      const duration = options?.durationMs ?? (variant === 'error' ? 6000 : options?.action ? 6000 : 3500);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          className={`fixed bottom-9 right-4 ${Z_INDEX.toast} flex flex-col gap-2 max-w-[min(24rem,calc(100vw-2rem))] w-full pointer-events-none`}
          role="status"
          aria-live="polite"
        >
          {toasts.map((t) => {
            const palette =
              t.variant === 'error'
                ? 'bg-red-50 dark:bg-red-950/95 border-red-300 dark:border-red-800 text-red-900 dark:text-red-100'
                : t.variant === 'warning'
                  ? 'bg-amber-50 dark:bg-amber-950/95 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-100'
                  : t.variant === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/95 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100';

            const Icon =
              t.variant === 'success'
                ? CheckCircle2
                : t.variant === 'error' || t.variant === 'warning'
                  ? AlertTriangle
                  : Info;

            return (
              <div
                key={t.id}
                data-testid="app-toast-item"
                data-toast-variant={t.variant}
                className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-lg text-xs ${palette}`}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 leading-snug space-y-1.5">
                  <div className="break-words">{t.message}</div>
                  {t.action && (
                    <div>
                      <button
                        type="button"
                        onClick={() => {
                          t.action?.onClick();
                          dismiss(t.id);
                        }}
                        className="inline-flex items-center px-2 py-1 rounded-md border border-current/25 bg-white/75 dark:bg-slate-900/75 hover:bg-white dark:hover:bg-slate-900 font-semibold text-[11px] transition-colors cursor-pointer"
                      >
                        {t.action.label}
                      </button>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  className="opacity-60 hover:opacity-100 p-0.5 rounded transition-opacity cursor-pointer"
                  aria-label="Закрыть уведомление"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext.Provider>
  );
};
