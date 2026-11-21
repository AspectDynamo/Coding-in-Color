import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { StudentMe } from '@shared/api';
import { Button, Notice, Spinner, useDocumentTitle } from '@frontend/components/ui';
import { HeroFigure } from '@frontend/components/illustrations';
import { Steps } from '@frontend/pages/Landing';
import { useStudent } from '@frontend/hooks/contexts';
import { api, isApiError } from '@frontend/services/api';
import {
  BAD_CODE_MESSAGE,
  RATE_LIMIT_MESSAGE,
  formatCode,
  isCompleteCode,
  readCodeFromHash,
} from '@frontend/lib/accessCode';

/** Takes the code out of the address bar as soon as we have read it. */
function stripFragment() {
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
}

export default function CodeEntry() {
  useDocumentTitle('Enter your code');
  const { student, setStudent } = useStudent();
  const navigate = useNavigate();
  // Students who opened a join link (/s/assess/:id) go back to it after entering their code.
  const returnTo = (useLocation().state as { returnTo?: string } | null)?.returnTo;
  const next = returnTo && /^\/s\/assess\/[0-9a-f-]{36}$/i.test(returnTo) ? returnTo : '/s/home';
  const [fragmentCode] = useState(() => readCodeFromHash(window.location.hash));
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(fragmentCode !== null);
  const started = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const signIn = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const me = await api.post<StudentMe>('/student/session', { code: value });
      setCode('');
      setStudent(me);
      navigate(next, { replace: true });
    } catch (e) {
      if (isApiError(e, 'rate_limited')) setError(RATE_LIMIT_MESSAGE);
      else if (isApiError(e) && e.status !== 0 && e.status < 500) setError(BAD_CODE_MESSAGE);
      else setError('We couldn’t reach the server. Check the internet connection and try again.');
      setAuto(false);
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  };
  const signInRef = useRef(signIn);
  useEffect(() => {
    signInRef.current = signIn;
  });

  // QR cards open /s#code=XXXX-…; read it once, remove it from the URL, then sign in.
  useEffect(() => {
    if (window.location.hash) stripFragment();
    if (!fragmentCode || started.current) return;
    started.current = true;
    void signInRef.current(fragmentCode);
  }, [fragmentCode]);

  // A card scanned while this page is already open only changes the fragment — handle that too.
  useEffect(() => {
    const onHashChange = () => {
      const scanned = readCodeFromHash(window.location.hash);
      if (window.location.hash) stripFragment();
      if (!scanned) return;
      setAuto(true);
      void signInRef.current(scanned);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (student && !fragmentCode && !busy) return <Navigate to={next} replace />;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!isCompleteCode(code)) {
      setError('Codes have 16 letters and numbers. Check your card — a few are missing.');
      inputRef.current?.focus();
      return;
    }
    void signIn(code);
  };

  if (auto) {
    return (
      <div className="rule-heavy pt-8">
        <p className="t-meta">Access card</p>
        <h1 className="t-display mt-4" tabIndex={-1} data-page-heading>
          Signing you in…
        </h1>
        <p className="t-lede mt-4">Reading the code from your card.</p>
        <div className="mt-6 text-ink">
          <Spinner size={28} label="Please wait" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <section className="rule-heavy grid gap-x-6 gap-y-6 lg:grid-cols-12">
        <div className="pt-6 sm:pt-10 lg:col-span-7">
          <p className="t-meta">Learning check-in</p>
          <h1 className="t-display mt-4" tabIndex={-1} data-page-heading>
            Hello! Enter your access code.
          </h1>
          {next !== '/s/home' && (
            <p
              className="mt-4 inline-block bg-yellow px-2 py-1 text-sm font-semibold"
              role="status"
            >
              Your instructor’s check-in will open right after you sign in.
            </p>
          )}
          <p className="t-lede mt-4">
            It’s on the card from your instructor — 16 letters and numbers. You can also scan the QR
            code on the card with a camera.
          </p>

          <form onSubmit={onSubmit} noValidate className="mt-8 max-w-xl">
            <label htmlFor="access-code" className="field-label text-base">
              Access code
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                ref={inputRef}
                id="access-code"
                name="access-code"
                className="input input-code min-w-0 flex-1"
                value={code}
                onChange={(e) => {
                  setCode(formatCode(e.target.value));
                  if (error) setError(null);
                }}
                placeholder="XXXX-XXXX-XXXX-XXXX"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                maxLength={40}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'code-error' : 'code-hint'}
                autoFocus
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                className="!min-h-[3.75rem]"
                loading={busy}
                iconRight={<ArrowRight size={20} aria-hidden="true" />}
              >
                Let’s go
              </Button>
            </div>
            <p id="code-hint" className="field-hint">
              Capital or small letters both work. We add the dashes for you.
            </p>
            {error && (
              <Notice tone="bad" role="alert" className="mt-3">
                <span id="code-error" className="font-semibold text-ink">
                  {error}
                </span>
              </Notice>
            )}
          </form>
        </div>
        <div className="order-first lg:order-none lg:col-span-5">
          <HeroFigure className="ml-auto block h-28 w-28 sm:h-44 sm:w-44 lg:h-auto lg:w-full lg:max-w-md" />
        </div>
      </section>

      <section aria-labelledby="how-h" className="mt-10 lg:mt-14">
        <h2 id="how-h" className="t-h3 mb-4">
          How a check-in works
        </h2>
        <Steps />
      </section>

      <p className="t-caption rule-hair mt-10 pt-4">
        No names, emails or passwords — just your card.{' '}
        <Link to="/" className="link">
          Not a student?
        </Link>
      </p>
    </div>
  );
}
