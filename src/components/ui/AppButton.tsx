import React from 'react';

export type AppButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
export type AppButtonSize = 'xs' | 'sm' | 'md';

export interface AppButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<AppButtonVariant, string> = {
  primary:
    'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-xs border border-transparent',
  secondary:
    'bg-slate-100 hover:bg-slate-200 active:bg-slate-300/80 dark:bg-slate-800 dark:hover:bg-slate-700 dark:active:bg-slate-600 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700',
  ghost:
    'bg-transparent hover:bg-slate-100 active:bg-slate-200/70 dark:hover:bg-slate-800 dark:active:bg-slate-700/70 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-transparent',
  danger:
    'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-xs border border-transparent',
  success:
    'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-xs border border-transparent'
};

const SIZE_CLASSES: Record<AppButtonSize, string> = {
  xs: 'px-2.5 py-1 text-[11px] rounded-md gap-1',
  sm: 'px-3.5 py-1.5 text-xs rounded-lg gap-1.5',
  md: 'px-4 py-2 text-xs rounded-lg gap-2'
};

export const AppButton = React.forwardRef<HTMLButtonElement, AppButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'sm',
      icon,
      loading = false,
      disabled,
      type = 'button',
      className = '',
      children,
      ...rest
    },
    ref
  ) => {
    const isDisabled = Boolean(disabled || loading);
    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={`inline-flex items-center justify-center font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/70 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  }
);

AppButton.displayName = 'AppButton';
