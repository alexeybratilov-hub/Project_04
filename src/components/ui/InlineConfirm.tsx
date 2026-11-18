import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { AppButton } from './AppButton';

interface InlineConfirmProps {
  message: React.ReactNode;
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  compact?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}

export const InlineConfirm: React.FC<InlineConfirmProps> = ({
  message,
  details,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = true,
  compact = false,
  disabled = false,
  onConfirm,
  onCancel,
  className = ''
}) => {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border ${
        danger
          ? 'bg-red-50/90 dark:bg-red-950/45 border-red-200 dark:border-red-900 text-red-900 dark:text-red-200'
          : 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
      } ${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2.5 text-[11px]'} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        {!compact && (
          <AlertTriangle
            className={`w-4 h-4 shrink-0 mt-0.5 ${
              danger ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
            }`}
          />
        )}
        <div className="min-w-0 space-y-0.5">
          <div className="font-medium leading-snug">{message}</div>
          {details && <div className="opacity-90 leading-snug">{details}</div>}
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <AppButton
          variant="secondary"
          size="xs"
          disabled={disabled}
          onClick={onCancel}
        >
          {cancelLabel}
        </AppButton>
        <AppButton
          variant={danger ? 'danger' : 'primary'}
          size="xs"
          disabled={disabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </AppButton>
      </div>
    </div>
  );
};
