import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { AlertCircle } from 'lucide-react';

interface FieldShellProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  className?: string;
}

function FieldShell({
  id,
  label,
  hint,
  error,
  hideLabel,
  className,
  children,
}: FieldShellProps & { id: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className={clsx('field-label', hideLabel && 'sr-only')}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error" role="alert">
          <AlertCircle size={15} className="mt-0.5 flex-none" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: ReactNode, error?: string | null) {
  if (error) return `${id}-err`;
  if (hint) return `${id}-hint`;
  return undefined;
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> &
  FieldShellProps & { inputSize?: 'sm' | 'md'; wrapperClassName?: string };

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, hideLabel, wrapperClassName, className, inputSize, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <input
        ref={ref}
        id={fid}
        className={clsx('input', inputSize === 'sm' && 'input-sm', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldShellProps & { wrapperClassName?: string };

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, hideLabel, wrapperClassName, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <textarea
        ref={ref}
        id={fid}
        className={clsx('input', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
});

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> &
  FieldShellProps & { inputSize?: 'sm' | 'md'; wrapperClassName?: string };

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, hideLabel, wrapperClassName, className, inputSize, id, children, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldShell
      id={fid}
      label={label}
      hint={hint}
      error={error}
      hideLabel={hideLabel}
      className={wrapperClassName}
    >
      <select
        ref={ref}
        id={fid}
        className={clsx('input', inputSize === 'sm' && 'input-sm', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fid, hint, error)}
        {...rest}
      >
        {children}
      </select>
    </FieldShell>
  );
});

interface ChoiceProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  hint?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, ChoiceProps>(function Checkbox(
  { label, hint, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input
        ref={ref}
        id={fid}
        type="checkbox"
        className="check mt-0.5"
        aria-describedby={hint ? `${fid}-hint` : undefined}
        {...rest}
      />
      <div>
        <label htmlFor={fid} className="text-[0.9375rem] font-medium text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${fid}-hint`} className="field-hint mt-0">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
});

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio(
  { label, hint, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={clsx('flex items-start gap-3', className)}>
      <input
        ref={ref}
        id={fid}
        type="radio"
        className="check mt-0.5"
        aria-describedby={hint ? `${fid}-hint` : undefined}
        {...rest}
      />
      <div>
        <label htmlFor={fid} className="text-[0.9375rem] font-medium text-ink">
          {label}
        </label>
        {hint && (
          <p id={`${fid}-hint`} className="field-hint mt-0">
            {hint}
          </p>
        )}
      </div>
    </div>
  );
});

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={clsx('flex items-center justify-between gap-4', className)}>
      <div>
        <span id={`${id}-l`} className="text-[0.9375rem] font-semibold text-ink">
          {label}
        </span>
        {hint && (
          <p id={`${id}-h`} className="field-hint mt-0">
            {hint}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className="toggle"
        aria-checked={checked}
        aria-labelledby={`${id}-l`}
        aria-describedby={hint ? `${id}-h` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

/** Group of related controls with a legend. */
export function Fieldset({
  legend,
  hint,
  children,
  className,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className="field-label">{legend}</legend>
      {hint && <p className="field-hint mt-0 mb-2">{hint}</p>}
      {children}
    </fieldset>
  );
}
