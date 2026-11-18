import React from 'react';

interface FormFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className = '',
  children
}) => {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>
      ) : null}
    </div>
  );
};
