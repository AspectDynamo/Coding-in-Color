import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Check } from 'lucide-react';
import type { SubmitResult } from '@shared/api';
import { Button, ButtonLink, useDocumentTitle } from '@frontend/components/ui';
import { DoneFigure } from '@frontend/components/illustrations';
import { useStudent } from '@frontend/hooks/contexts';
import { fmtDuration } from '@frontend/lib/format';

export interface DoneState {
  result?: SubmitResult;
  already?: boolean;
}

export default function Done() {
  useDocumentTitle('All done');
  const { logout } = useStudent();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as DoneState;
  const [busy, setBusy] = useState(false);
  const r = state.result;

  return (
    <div className="rule-heavy" data-testid="done-screen">
      <DoneFigure className="ml-auto block h-auto w-full max-w-xs sm:max-w-sm" />
      <div className="border-t border-ink pt-6">
        <p className="inline-flex items-center gap-2 bg-green-tint px-2 py-1 text-sm font-semibold text-green-ink">
          <Check size={16} aria-hidden="true" />
          {state.already ? 'Already saved' : 'Answers saved'}
        </p>
        <h1 className="t-display mt-4" tabIndex={-1} data-page-heading>
          {state.already ? 'You already turned this in.' : 'Turned in. Thank you!'}
        </h1>
        <p className="t-lede mt-4">
          {state.already
            ? 'Your answers were saved the first time, so there’s nothing more to do here.'
            : 'Your answers are safely turned in. Every check-in helps your instructors see what to teach next — and shows how far you’ve come.'}
        </p>
        {r && (
          <p className="mt-5 border-y border-rule py-3 font-medium text-ink">
            You answered {r.answeredCount} of {r.totalQuestions} questions in{' '}
            {fmtDuration(r.durationSeconds)}.
          </p>
        )}
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink to="/s/home" variant="primary" size="lg">
            Back to my check-ins
          </ButtonLink>
          <Button
            size="lg"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await logout().catch(() => undefined);
              navigate('/s', { replace: true });
            }}
          >
            I’m finished — sign out
          </Button>
        </div>
        <p className="t-caption mt-4">
          On a shared computer? Sign out so the next person can use their own card.
        </p>
      </div>
    </div>
  );
}
