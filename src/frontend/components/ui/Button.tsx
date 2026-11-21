import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import clsx from 'clsx';
import { Spinner } from './Feedback';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface StyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
}

function classes({ variant = 'secondary', size = 'md', block }: StyleProps, extra?: string) {
  return clsx(
    'btn',
    `btn-${variant}`,
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    block && 'btn-block',
    extra,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, StyleProps {
  loading?: boolean;
  /** Renders the pressed (inset) state for toggle-style buttons. */
  pressed?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant,
    size,
    block,
    loading,
    pressed,
    icon,
    iconRight,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-pressed={pressed}
      data-pressed={pressed || undefined}
      {...rest}
    >
      {loading ? <Spinner size={18} /> : icon}
      <span>{children}</span>
      {iconRight}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'secondary', size = 'md', pressed, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={clsx('btn btn-icon', `btn-${variant}`, size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export function ButtonLink({
  variant,
  size,
  block,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: LinkProps & StyleProps & { icon?: ReactNode; iconRight?: ReactNode }) {
  return (
    <Link className={classes({ variant, size, block }, className)} {...rest}>
      {icon}
      <span>{children}</span>
      {iconRight}
    </Link>
  );
}
