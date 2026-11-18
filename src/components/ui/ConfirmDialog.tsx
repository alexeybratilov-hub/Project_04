import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AppButton } from './AppButton';
import { isTopMostModal, registerOpenModal, unregisterOpenModal } from './modalStack';
import { Z_INDEX } from './zIndex';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef<symbol | null>(null);
  if (!modalIdRef.current) {
    modalIdRef.current = Symbol('ConfirmDialog');
  }

  useEffect(() => {
    if (!isOpen) return;
    const modalId = modalIdRef.current!;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    registerOpenModal(modalId);

    const rafId = requestAnimationFrame(() => {
      if (isTopMostModal(modalId)) {
        cancelBtnRef.current?.focus();
      }
    });

    return () => {
      cancelAnimationFrame(rafId);
      unregisterOpenModal(modalId);
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && prev.isConnected) {
        requestAnimationFrame(() => {
          if (prev.isConnected) prev.focus();
        });
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const modalId = modalIdRef.current!;
    const onKey = (e: KeyboardEvent) => {
      if (!isTopMostModal(modalId)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')
        ).filter((el) => el.getClientRects().length > 0);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 ${Z_INDEX.confirm} flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 text-xs"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {danger && (
              <div className="p-1.5 rounded-lg bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400 shrink-0">
                <AlertTriangle className="w-4 h-4" />
              </div>
            )}
            <h3 id={titleId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
          {description}
        </p>

        <div className="flex items-center justify-end gap-2 pt-2">
          <AppButton ref={cancelBtnRef} variant="secondary" size="sm" onClick={onCancel}>
            {cancelLabel}
          </AppButton>
          <AppButton variant={danger ? 'danger' : 'primary'} size="sm" onClick={onConfirm}>
            {confirmLabel}
          </AppButton>
        </div>
      </div>
    </div>
  );
};
