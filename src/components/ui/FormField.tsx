import React, { useId } from 'react';

interface FormFieldProps {
  label: React.ReactNode;
  htmlFor?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/**
 * Label + control + message. When `htmlFor` is omitted the field generates an id and
 * clones the single child control with it, so every form control is programmatically
 * labelled and error/hint text is announced via aria-describedby.
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  className = '',
  children
}) => {
  const autoId = useId();
  const fieldId = htmlFor || autoId;
  const messageId = `${fieldId}-message`;
  const hasMessage = Boolean(error || hint);

  const childProps = (children as React.ReactElement<Record<string, unknown>> | null)?.props;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: (childProps?.id as string | undefined) ?? fieldId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': hasMessage
          ? messageId
          : (childProps?.['aria-describedby'] as string | undefined)
      })
    : children;

  return (
    <div className={className}>
      <label
        htmlFor={fieldId}
        className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {control}
      {error ? (
        <p id={messageId} role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
};
