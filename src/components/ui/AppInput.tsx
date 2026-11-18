import React from 'react';

const BASE_CONTROL_CLASSES =
  'w-full bg-white dark:bg-slate-900 border rounded-lg text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/70 disabled:opacity-60 disabled:cursor-not-allowed';

const NORMAL_BORDER = 'border-slate-300 dark:border-slate-700';
const ERROR_BORDER = 'border-red-500 dark:border-red-500 focus:ring-red-500/60';

export interface AppInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  mono?: boolean;
  compact?: boolean;
}

export const AppInput = React.forwardRef<HTMLInputElement, AppInputProps>(
  ({ error = false, mono = false, compact = false, className = '', ...rest }, ref) => (
    <input
      ref={ref}
      className={`${BASE_CONTROL_CLASSES} ${error ? ERROR_BORDER : NORMAL_BORDER} ${
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
      } ${mono ? 'font-mono tabular-nums' : ''} ${className}`}
      {...rest}
    />
  )
);
AppInput.displayName = 'AppInput';

export interface AppSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean;
  mono?: boolean;
  compact?: boolean;
}

export const AppSelect = React.forwardRef<HTMLSelectElement, AppSelectProps>(
  ({ error = false, mono = false, compact = false, className = '', children, ...rest }, ref) => (
    <select
      ref={ref}
      className={`${BASE_CONTROL_CLASSES} ${error ? ERROR_BORDER : NORMAL_BORDER} ${
        compact ? 'px-2.5 py-1.5' : 'px-3 py-2'
      } ${mono ? 'font-mono tabular-nums' : ''} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
);
AppSelect.displayName = 'AppSelect';

export interface AppTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean;
  mono?: boolean;
}

export const AppTextarea = React.forwardRef<HTMLTextAreaElement, AppTextareaProps>(
  ({ error = false, mono = false, className = '', ...rest }, ref) => (
    <textarea
      ref={ref}
      className={`${BASE_CONTROL_CLASSES} px-3 py-2 ${error ? ERROR_BORDER : NORMAL_BORDER} ${
        mono ? 'font-mono' : ''
      } ${className}`}
      {...rest}
    />
  )
);
AppTextarea.displayName = 'AppTextarea';
