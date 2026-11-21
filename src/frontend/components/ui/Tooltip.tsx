import { useId, useState, type ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Help tooltip: a real button (keyboard + touch reachable). Opens on hover, focus or tap;
 * Esc closes. Content is linked with aria-describedby so screen readers announce it.
 */
export function Tooltip({
  content,
  label = 'More information',
  children,
  align = 'center',
}: {
  content: ReactNode;
  label?: string;
  children?: ReactNode;
  align?: 'center' | 'start' | 'end';
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        className="inline-grid h-6 w-6 place-items-center rounded-full text-ink-3 hover:text-ink"
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        {children ?? <HelpCircle size={16} aria-hidden="true" />}
      </button>
      <span
        id={id}
        role="tooltip"
        className={clsx(
          'tooltip',
          align === 'center' && 'left-1/2 -translate-x-1/2',
          align === 'start' && 'left-0',
          align === 'end' && 'right-0',
          !open && 'hidden',
        )}
      >
        {content}
      </span>
    </span>
  );
}
