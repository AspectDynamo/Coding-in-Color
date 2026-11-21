import { useState } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import clsx from 'clsx';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingBlock,
  Skeleton,
  Wordmark,
} from '@frontend/components/ui';
import { StudentProvider } from '@frontend/hooks/providers';
import { useStudent } from '@frontend/hooks/contexts';
import { errorMessage } from '@frontend/services/api';

/**
 * Student shell: no navigation. A slim masthead (mark + sign out) over one centred sheet.
 * Entry is wide for the hero composition; the check-in itself gets a workbook-width column.
 */
function Frame() {
  const { student, loading, error, retry, logout } = useStudent();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const isEntry = pathname === '/s' || pathname === '/s/';
  const inAssessment = pathname.startsWith('/s/assess/');
  const width = isEntry ? 'max-w-6xl' : inAssessment ? 'max-w-4xl' : 'max-w-3xl';

  let body;
  if (loading) {
    body = (
      <LoadingBlock label="Getting things ready…">
        <div className="rule-heavy space-y-5 py-8">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton lines={3} />
          <Skeleton className="h-14 w-full" />
        </div>
      </LoadingBlock>
    );
  } else if (error && !isEntry) {
    body = (
      <ErrorState
        title="We couldn’t load your page"
        message={errorMessage(error)}
        onRetry={retry}
      />
    );
  } else if (!student && !isEntry) {
    body = <Navigate to="/s" replace state={inAssessment ? { returnTo: pathname } : undefined} />;
  } else {
    body = <Outlet />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className={clsx(
          'no-print mx-auto flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 sm:px-6',
          width,
        )}
      >
        <Link to={student ? '/s/home' : '/'} aria-label="Coding in Color — home">
          <Wordmark sub="Check-in" size={28} />
        </Link>
        {student && !inAssessment && (
          <Button size="sm" variant="quiet" onClick={() => setConfirm(true)}>
            Sign out
          </Button>
        )}
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={clsx('mx-auto w-full flex-1 px-4 pb-12 sm:px-6', width)}
      >
        {body}
      </main>
      <ConfirmDialog
        open={confirm}
        busy={busy}
        onClose={() => setConfirm(false)}
        title="Sign out?"
        description="You’ll need your access card to sign in again."
        confirmLabel="Sign out"
        onConfirm={async () => {
          setBusy(true);
          await logout().catch(() => undefined);
          setBusy(false);
          setConfirm(false);
          navigate('/s', { replace: true });
        }}
      />
    </div>
  );
}

export function StudentLayout() {
  return (
    <StudentProvider>
      <Frame />
    </StudentProvider>
  );
}
