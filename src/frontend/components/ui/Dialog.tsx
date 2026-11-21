import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { Button, IconButton, type ButtonVariant } from './Button';
import { Input } from './Form';

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'full';
  /** Block Esc / backdrop close while a mutation is running. */
  busy?: boolean;
}

/** Modal dialog: focus trap, Esc to close, backdrop click, focus returns to the opener. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  busy,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    closeRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first =
      node?.querySelector<HTMLElement>('[data-autofocus]') ??
      node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === firstEl || !node.contains(active))) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && (active === lastEl || !node.contains(active))) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  const width =
    size === 'full'
      ? 'dialog-full'
      : size === 'sm'
        ? 'sm:max-w-md'
        : size === 'lg'
          ? 'sm:max-w-3xl'
          : 'sm:max-w-xl';
  return createPortal(
    <div
      className={clsx('scrim no-print', size === 'full' && '!p-0')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={clsx('dialog', width)}
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <h2 id={titleId} className="t-h3 pt-1.5">
            {title}
          </h2>
          <IconButton
            label="Close dialog"
            variant="quiet"
            size="sm"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} aria-hidden="true" />
          </IconButton>
        </div>
        {description && (
          <div id={descId} className="t-small mb-4 text-ink-2">
            {description}
          </div>
        )}
        {children}
        {footer && (
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  /** Strong confirmation: the user must type this exact text. */
  requireText?: string;
  requireTextLabel?: string;
  busy?: boolean;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  // Mounted only while open so the typed confirmation text always starts empty.
  return props.open ? <ConfirmDialogInner {...props} /> : null;
}

function ConfirmDialogInner({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  requireText,
  requireTextLabel,
  busy,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const ok = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();
  const variant: ButtonVariant = tone === 'danger' ? 'danger' : 'primary';
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            data-autofocus={requireText ? undefined : ''}
          >
            {cancelLabel}
          </Button>
          <Button variant={variant} onClick={() => void onConfirm()} disabled={!ok} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
      {requireText && (
        <Input
          wrapperClassName="mt-4"
          label={requireTextLabel ?? `Type ${requireText} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
        />
      )}
    </Dialog>
  );
}
