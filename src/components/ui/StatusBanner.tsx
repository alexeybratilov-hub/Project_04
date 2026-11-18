import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type StatusBannerVariant = 'info' | 'success' | 'warning' | 'error';

interface StatusBannerProps {
  variant?: StatusBannerVariant;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  role?: 'alert' | 'status';
  compact?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const VARIANT_STYLE: Record<StatusBannerVariant, string> = {
  info: 'bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/70 text-blue-900 dark:text-blue-200',
  success:
    'bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200',
  warning:
    'bg-amber-50/90 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200',
  error:
    'bg-red-50/90 dark:bg-red-950/50 border-red-300 dark:border-red-700 text-red-900 dark:text-red-100'
};

const ICON_COLOR: Record<StatusBannerVariant, string> = {
  info: 'text-blue-600 dark:text-blue-400',
  success: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  error: 'text-red-600 dark:text-red-400'
};

export const StatusBanner: React.FC<StatusBannerProps> = ({
  variant = 'info',
  title,
  icon,
  action,
  role,
  compact = false,
  className = '',
  children
}) => {
  const effectiveRole =
    role ?? (variant === 'error' || variant === 'warning' ? 'alert' : 'status');

  const defaultIcon =
    variant === 'success' ? (
      <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLOR[variant]}`} />
    ) : variant === 'warning' ? (
      <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLOR[variant]}`} />
    ) : variant === 'error' ? (
      <AlertCircle className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLOR[variant]}`} />
    ) : (
      <Info className={`w-4 h-4 shrink-0 mt-0.5 ${ICON_COLOR[variant]}`} />
    );

  return (
    <div
      role={effectiveRole}
      className={`rounded-xl border flex items-start justify-between gap-2.5 ${VARIANT_STYLE[variant]} ${
        compact ? 'px-3 py-2 text-[11px]' : 'p-3.5 text-xs'
      } ${className}`}
    >
      <div className="flex items-start gap-2.5 min-w-0 flex-1">
        {icon ?? defaultIcon}
        <div className="min-w-0 flex-1 space-y-0.5 leading-relaxed">
          {title && <div className="font-semibold">{title}</div>}
          {children && <div className="opacity-95">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};
