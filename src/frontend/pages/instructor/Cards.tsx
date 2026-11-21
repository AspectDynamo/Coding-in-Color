import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Printer, Trash2 } from 'lucide-react';
import type { IssuedCredential } from '@shared/api';
import {
  BrandMark,
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  Notice,
  PageHeader,
} from '@frontend/components/ui';
import { QrCode } from '@frontend/components/QrCode';
import { useIssuedCards } from '@frontend/hooks/contexts';

const CARD_STEPS = [
  'Scan the QR code, or open the web address your instructor shows you.',
  'Type the access code.',
  'Keep this card — you’ll use it again.',
];

/**
 * Print-first access card. Hierarchy comes from rules, size and mono type, so it stays
 * legible on a one-colour printer; the brand mark is the only colour.
 */
function AccessCard({ c }: { c: IssuedCredential }) {
  return (
    <li
      className="access-card print-break-avoid flex flex-col border-[1.5px] border-ink bg-sheet"
      data-testid="access-card"
    >
      <div className="flex items-stretch justify-between border-b-[1.5px] border-ink">
        <div className="flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <BrandMark size={24} />
          <div className="min-w-0 leading-tight">
            <p className="text-sm font-bold text-ink">Coding in Color</p>
            <p className="truncate text-xs text-ink-2">{c.cohortName}</p>
          </div>
        </div>
        <p className="flex flex-none flex-col items-center justify-center border-l-[1.5px] border-ink px-3 leading-none">
          <span className="text-[0.6875rem] font-semibold text-ink-2">Seat</span>
          <span className="t-figure mt-0.5 text-[1.5625rem] text-ink">{c.rosterLabel}</span>
        </p>
      </div>

      <div className="flex flex-1 items-center gap-3 px-3 py-3">
        <QrCode value={c.accessUrl} size={112} label={`QR code for seat ${c.rosterLabel}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink-2">Access code</p>
          <p
            className="t-mono text-[1.0625rem] font-medium leading-snug text-ink"
            data-testid="card-code"
          >
            {c.accessCode.split('-').map((part, i) => (
              <span key={i} className="inline-block">
                {i > 0 && <span aria-hidden="true">-</span>}
                {part}
              </span>
            ))}
          </p>
          <p className="mt-2 text-xs font-semibold text-ink-2">Public code</p>
          <p className="t-mono text-sm text-ink">{c.publicCode}</p>
        </div>
      </div>

      <ol className="border-t border-ink px-3 py-2.5 text-xs leading-snug text-ink">
        {CARD_STEPS.map((step, i) => (
          <li key={step} className="flex items-start gap-2 py-0.5">
            <span
              className="count-cell !h-[1.125rem] !w-[1.125rem] flex-none !text-[0.6875rem]"
              data-state="answered"
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      {c.requiresConsent && (
        <p className="border-t border-ink px-3 py-2 text-xs font-semibold text-ink">
          A parent/guardian form is needed before the first check-in.
        </p>
      )}
    </li>
  );
}

export default function Cards() {
  const { cards, clear } = useIssuedCards();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);

  // The codes exist only in memory: warn before a refresh or tab close discards them.
  useEffect(() => {
    if (cards.length === 0) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [cards.length]);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Access cards"
          back={{ to: '/instructor', label: 'Sessions & cohorts' }}
          description="Print on US Letter paper, two cards across, then cut along the card borders."
          actions={
            cards.length > 0 ? (
              <>
                <Button
                  variant="primary"
                  icon={<Printer size={16} aria-hidden="true" />}
                  onClick={() => window.print()}
                >
                  Print {cards.length} {cards.length === 1 ? 'card' : 'cards'}
                </Button>
                <Button
                  icon={<Trash2 size={16} aria-hidden="true" />}
                  onClick={() => setConfirm(true)}
                >
                  Clear cards
                </Button>
              </>
            ) : undefined
          }
        />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          title="No cards to print"
          action={<ButtonLink to="/instructor">Choose a cohort</ButtonLink>}
        >
          Access codes are shown only once, right after you generate them, and are never saved in
          this browser. To make cards, open a cohort and choose “Generate access cards”. If a
          printed card was lost, reissue it by seat.
        </EmptyState>
      ) : (
        <>
          <Notice
            tone="warn"
            className="no-print mb-8"
            role="alert"
            title="Print these now — the codes can’t be shown again"
          >
            They live only on this page. Refreshing, closing the tab or signing out discards them,
            and you would need to reissue each card. Treat printed cards like keys: anyone holding a
            card can sign in as that seat.
          </Notice>
          <p className="t-caption no-print mb-3 border-t border-ink pt-3">
            <span className="t-num">{cards.length}</span> {cards.length === 1 ? 'card' : 'cards'},
            one per seat. Each card works for one student only.
          </p>
          <ul className="card-sheet grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <AccessCard key={c.studentId + c.accessCode} c={c} />
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => {
          clear();
          setConfirm(false);
          navigate('/instructor');
        }}
        tone="danger"
        title="Clear these cards?"
        description="Do this after printing. The codes can’t be shown again — unprinted cards would need to be reissued."
        confirmLabel="Clear cards"
      />
    </>
  );
}
