import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import clsx from 'clsx';
import { ToastContext, type ToastApi, type ToastTone } from './toast-context';

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback(
    (id: number) => setItems((list) => list.filter((t) => t.id !== id)),
    [],
  );
  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = ++seq.current;
      setItems((list) => [...list.slice(-3), { id, message, tone }]);
      window.setTimeout(() => dismiss(id), tone === 'bad' ? 9000 : 5000);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show(m, 'good'), error: (m) => show(m, 'bad') }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 bottom-0 z-[60] sm:p-6 flex flex-col items-center gap-2 p-4 sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === 'bad' ? 'alert' : 'status'}
            className={clsx(
              'toast pointer-events-auto',
              t.tone === 'good' && 'toast-good',
              t.tone === 'bad' && 'toast-bad',
            )}
          >
            <span className="mt-0.5 flex-none" aria-hidden="true">
              {t.tone === 'good' ? (
                <CheckCircle2 size={18} />
              ) : t.tone === 'bad' ? (
                <AlertTriangle size={18} />
              ) : (
                <Info size={18} />
              )}
            </span>
            <p className="min-w-0 flex-1">{t.message}</p>
            <button
              type="button"
              className="grid h-7 w-7 flex-none place-items-center hover:bg-ink-2"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
