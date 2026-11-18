import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { isTopMostModal, registerOpenModal, unregisterOpenModal } from './modalStack';
import { Z_INDEX } from './zIndex';

export type AppModalSize =
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | '2xl'
  | '3xl'
  | '4xl'
  | '5xl'
  | '6xl'
  | 'full';

export type AppModalIconTone =
  | 'blue'
  | 'amber'
  | 'emerald'
  | 'purple'
  | 'indigo'
  | 'red'
  | 'slate';

const SIZE_CLASSES: Record<AppModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  full: 'max-w-[96vw]'
};

const ICON_TONE_CLASSES: Record<AppModalIconTone, string> = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400',
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  slate: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

function getVisibleFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0 && el.tabIndex !== -1
  );
}

interface AppModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  iconTone?: AppModalIconTone;
  headerRight?: React.ReactNode;
  headerClassName?: string;
  footer?: React.ReactNode;
  size?: AppModalSize;
  heightClass?: string;
  layer?: 'modal' | 'nested';
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  closeDisabled?: boolean;
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
}

export const AppModal: React.FC<AppModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  iconTone = 'blue',
  headerRight,
  headerClassName = '',
  footer,
  size = '2xl',
  heightClass = 'max-h-[92vh]',
  layer = 'modal',
  closeOnEscape = true,
  closeOnBackdrop = false,
  closeDisabled = false,
  ariaLabel,
  className = '',
  children
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const modalIdRef = useRef<symbol | null>(null);
  if (!modalIdRef.current) {
    modalIdRef.current = Symbol('AppModal');
  }

  // Register on modal stack, capture previous focus, move initial focus into modal, restore on close
  useEffect(() => {
    if (!isOpen) return;
    const modalId = modalIdRef.current!;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    registerOpenModal(modalId);

    const rafId = requestAnimationFrame(() => {
      const container = dialogRef.current;
      if (!container || !isTopMostModal(modalId)) return;
      if (container.contains(document.activeElement)) return;
      const focusable = getVisibleFocusable(container);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
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

  // Top-most modal Escape & Tab focus trap
  useEffect(() => {
    if (!isOpen) return;
    const modalId = modalIdRef.current!;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isTopMostModal(modalId)) return;

      if (e.key === 'Escape') {
        if (!closeOnEscape || closeDisabled || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = getVisibleFocusable(dialogRef.current);
        if (focusable.length === 0) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (!active || !dialogRef.current.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
          return;
        }

        if (e.shiftKey) {
          if (active === first || active === dialogRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeOnEscape, closeDisabled, onClose]);

  if (!isOpen) return null;

  const zClass = layer === 'nested' ? Z_INDEX.modalNested : Z_INDEX.modal;

  return (
    <div
      className={`fixed inset-0 ${zClass} flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4`}
      onMouseDown={(e) => {
        if (closeOnBackdrop && !closeDisabled && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={!title ? ariaLabel : undefined}
        tabIndex={-1}
        className={`w-full ${SIZE_CLASSES[size]} ${heightClass} bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden outline-none ${className}`}
      >
        {(title || headerRight) && (
          <div
            className={`flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 shrink-0 gap-4 ${headerClassName}`}
          >
            <div className="flex items-center gap-3 min-w-0">
              {icon && (
                <div className={`p-2 rounded-lg shrink-0 ${ICON_TONE_CLASSES[iconTone]}`}>
                  {icon}
                </div>
              )}
              <div className="min-w-0">
                {title && (
                  <h2
                    id={titleId}
                    className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate"
                  >
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              <button
                type="button"
                disabled={closeDisabled}
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70"
                aria-label="Закрыть"
                title="Закрыть (Esc)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {children}

        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-3.5 bg-slate-50/70 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 text-xs shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
