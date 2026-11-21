import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { LoginResult, StaffProfile } from '@shared/api';
import { STAFF_ROLES, type StaffRole } from '@shared/types';
import {
  BrandMark,
  Button,
  Input,
  Notice,
  Skeleton,
  Spinner,
  Wordmark,
  useDocumentTitle,
} from '@frontend/components/ui';
import { useConfig, useStaff } from '@frontend/hooks/contexts';
import { api, errorMessage, isApiError } from '@frontend/services/api';
import { ROLE_LABELS } from '@frontend/lib/format';
import { homeFor } from '@frontend/layouts/nav';
import { MfaEnroll } from './MfaEnroll';

type Step = 'password' | 'mfa' | 'mfa-enroll' | 'reset' | 'reset-sent';

const ROLE_BLURB: Record<StaffRole, string> = {
  owner: 'Everything, including staff',
  admin: 'Dashboard, students, catalog',
  analyst: 'Aggregates only',
  instructor: 'Sessions and access cards',
};

export default function Login() {
  useDocumentTitle('Staff sign in');
  const { staff, loading, setStaff } = useStaff();
  const { config } = useConfig();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = (profile: StaffProfile) => {
    setStaff(profile);
    const home = homeFor(profile);
    const allowed =
      from && (from.startsWith('/admin') || from.startsWith('/instructor')) ? from : home;
    navigate(profile.role === 'instructor' && allowed.startsWith('/admin') ? home : allowed, {
      replace: true,
    });
  };

  if (!loading && staff && busy === null) return <Navigate to={homeFor(staff)} replace />;

  const fail = (e: unknown) => {
    if (isApiError(e, 'rate_limited'))
      setError('Too many attempts. Please wait a minute and try again.');
    else if (isApiError(e, 'unauthenticated'))
      setError('That email and password don’t match an active staff account.');
    else if (isApiError(e, 'forbidden'))
      setError(
        e.message || 'This account can’t sign in right now. Ask a workspace owner for help.',
      );
    else if (isApiError(e, 'bad_request')) setError('Check the details and try again.');
    else setError(errorMessage(e));
  };

  const onPassword = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('password');
    setError(null);
    try {
      const r = await api.post<LoginResult>('/auth/login', { email: email.trim(), password });
      if (r.status === 'ok') return finish(r.staff);
      setPassword('');
      setCode('');
      if (r.status === 'mfa_enroll_required') {
        setStep('mfa-enroll');
        return;
      }
      setFactorId(r.factors[0]?.id ?? null);
      setStep('mfa');
    } catch (err) {
      if (isApiError(err, 'mfa_required')) {
        const factors = (err.details as { factors?: { id: string }[] } | undefined)?.factors;
        setFactorId(factors?.[0]?.id ?? null);
        setStep('mfa');
      } else fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onMfa = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    if (!factorId) {
      setError('No authenticator is set up for this account. Ask an owner for help.');
      return;
    }
    setBusy('mfa');
    setError(null);
    try {
      const r = await api.post<{ staff: StaffProfile }>('/auth/mfa/verify', { factorId, code });
      finish(r.staff);
    } catch (err) {
      // A wrong code is 401 mfa_required (retryable); 401 unauthenticated means the 5-minute cic_mfa cookie is gone.
      if (isApiError(err, 'mfa_required') || isApiError(err, 'bad_request'))
        setError('That code didn’t work. Try the newest code from your app.');
      else if (isApiError(err, 'unauthenticated'))
        restart('Your sign-in timed out. Sign in again to get a fresh verification step.');
      else fail(err);
    } finally {
      setBusy(null);
    }
  };

  const onReset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('reset');
    setError(null);
    try {
      await api.post('/auth/password-reset', { email: email.trim() });
    } catch (err) {
      if (isApiError(err, 'rate_limited')) {
        setError('Too many attempts. Please wait a minute and try again.');
        setBusy(null);
        return;
      }
      /* Same confirmation whether or not the address is registered. */
    }
    setBusy(null);
    setStep('reset-sent');
  };

  const demo = async (role: StaffRole) => {
    setBusy(`demo-${role}`);
    setError(null);
    try {
      const r = await api.post<{ staff: StaffProfile }>('/auth/demo-login', { role });
      finish(r.staff);
    } catch (err) {
      fail(err);
      setBusy(null);
    }
  };

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  /** The short-lived MFA cookie expired: back to the password step with the reason shown. */
  const restart = (message: string) => {
    setCode('');
    setFactorId(null);
    setStep('password');
    setError(message);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[5fr_7fr]">
      {/* Ink panel: identity and one statement. Desktop only. */}
      <aside className="block-ink on-ink hidden flex-col justify-between p-10 lg:flex xl:p-14">
        <div className="flex items-center gap-3">
          <BrandMark size={32} />
          <span className="text-[1.0625rem] font-bold tracking-[-0.01em]">Coding in Color</span>
        </div>
        <div>
          <p className="t-display !text-paper">Measure what was learned.</p>
          <p className="mt-5 max-w-sm text-[1.0625rem] text-[#e4e0d6]">
            Matched pre- and post-assessments, honest sample sizes, and reports that say what the
            numbers can and cannot show.
          </p>
        </div>
        <p className="font-mono text-[0.8125rem] uppercase tracking-[0.06em] text-[#c9c5ba]">
          Staff · Instructors and administrators
        </p>
      </aside>
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-10 pt-3 lg:justify-center lg:py-10">
        <header className="flex min-h-14 items-center justify-between lg:mb-6 lg:min-h-0">
          <Link to="/" aria-label="Coding in Color Impact — start page" className="lg:hidden">
            <Wordmark size={28} />
          </Link>
          <Link to="/" className="link hidden text-sm lg:inline">
            Back to the start page
          </Link>
        </header>
        <main id="main" tabIndex={-1} className="mt-4 space-y-10 lg:mt-0">
          <div className="rule-heavy pt-6">
            {step === 'password' && (
              <form onSubmit={onPassword} noValidate>
                <h1 className="t-h1" tabIndex={-1} data-page-heading>
                  Staff sign-in
                </h1>
                <p className="t-lede mt-2">Use your staff account.</p>
                <div className="mt-6 space-y-4">
                  <Input
                    label="Email"
                    type="email"
                    name="email"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <Input
                    label="Password"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && (
                  <Notice tone="bad" role="alert" className="mt-4">
                    {error}
                  </Notice>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  className="mt-6"
                  loading={busy === 'password'}
                  disabled={!email || !password}
                >
                  Sign in
                </Button>
                <p className="mt-4">
                  <button type="button" className="link text-sm" onClick={() => go('reset')}>
                    Forgot your password?
                  </button>
                </p>
                <p className="t-caption mt-3">
                  Accounts are by invitation only. Ask a workspace owner to invite you.
                </p>
              </form>
            )}

            {step === 'mfa' && (
              <form onSubmit={onMfa} noValidate>
                <p className="t-meta">Step 2 of 2</p>
                <h1 className="t-h1 mt-2" tabIndex={-1} data-page-heading>
                  One more step
                </h1>
                <p className="t-lede mt-2">Enter the 6-digit code from your authenticator app.</p>
                <Input
                  wrapperClassName="mt-5"
                  label="Verification code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input-code text-center !tracking-[0.4em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  autoFocus
                />
                {error && (
                  <Notice tone="bad" role="alert" className="mt-4">
                    {error}
                  </Notice>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  className="mt-6"
                  loading={busy === 'mfa'}
                >
                  Verify and sign in
                </Button>
                <p className="mt-4">
                  <button
                    type="button"
                    className="link inline-flex items-center gap-1 text-sm"
                    onClick={() => go('password')}
                  >
                    <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
                  </button>
                </p>
              </form>
            )}

            {step === 'mfa-enroll' && (
              <MfaEnroll onVerified={finish} onExpired={restart} onCancel={() => go('password')} />
            )}

            {step === 'reset' && (
              <form onSubmit={onReset} noValidate>
                <h1 className="t-h1" tabIndex={-1} data-page-heading>
                  Reset your password
                </h1>
                <p className="t-lede mt-2">We’ll email a reset link to your staff address.</p>
                <Input
                  wrapperClassName="mt-5"
                  label="Email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
                {error && (
                  <Notice tone="bad" role="alert" className="mt-4">
                    {error}
                  </Notice>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  block
                  className="mt-6"
                  loading={busy === 'reset'}
                  disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
                >
                  Send reset link
                </Button>
                <p className="mt-4">
                  <button
                    type="button"
                    className="link inline-flex items-center gap-1 text-sm"
                    onClick={() => go('password')}
                  >
                    <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
                  </button>
                </p>
              </form>
            )}

            {step === 'reset-sent' && (
              <div role="status">
                <h1 className="t-h1" tabIndex={-1} data-page-heading>
                  Check your email
                </h1>
                <p className="t-lede mt-2">
                  If that address belongs to a staff account, a reset link is on its way. It can
                  take a few minutes.
                </p>
                <Button
                  className="mt-6"
                  onClick={() => go('password')}
                  icon={<ArrowLeft size={16} aria-hidden="true" />}
                >
                  Back to sign in
                </Button>
              </div>
            )}
          </div>

          {!config && loading && <Skeleton className="h-24 w-full" />}
          {config?.demoLoginEnabled && (
            <section aria-labelledby="demo-h" data-testid="demo-login">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-2">
                <h2 id="demo-h" className="t-h4">
                  Demo sign-in
                </h2>
                <span className="bg-yellow px-1.5 text-[0.8125rem] font-semibold text-ink">
                  Synthetic data only
                </span>
              </div>
              <p className="t-caption mt-2">No password needed. Not available with real data.</p>
              <ul className="mt-2">
                {STAFF_ROLES.map((role) => (
                  <li key={role} className="border-b border-rule">
                    <button
                      type="button"
                      onClick={() => void demo(role)}
                      disabled={busy !== null}
                      aria-busy={busy === `demo-${role}` || undefined}
                      className="flex min-h-14 w-full items-center justify-between gap-4 py-2 text-left hover:bg-sheet disabled:text-ink-3"
                      aria-label={`Demo ${ROLE_LABELS[role]}`}
                    >
                      <span>
                        <span className="block font-semibold">Demo {ROLE_LABELS[role]}</span>
                        <span className="t-caption block">{ROLE_BLURB[role]}</span>
                      </span>
                      {busy === `demo-${role}` ? (
                        <Spinner size={18} />
                      ) : (
                        <ArrowRight size={18} aria-hidden="true" className="flex-none" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
