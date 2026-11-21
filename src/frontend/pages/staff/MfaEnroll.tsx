import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Copy, Smartphone } from 'lucide-react';
import type { MfaEnrollment, StaffProfile } from '@shared/api';
import { Button, Input, Notice } from '@frontend/components/ui';
import { api, errorMessage, isApiError } from '@frontend/services/api';
import { copyText } from '@frontend/lib/clipboard';

export const MFA_EXPIRED_MESSAGE =
  'Your sign-in timed out before setup finished. Sign in again to set up your authenticator app.';
const RATE_LIMITED = 'Too many attempts. Please wait a minute and try again.';

/** Only an inline image is ever rendered: a remote URL here would leak that an enrollment is happening. */
const isInlineImage = (src: string) => /^data:image\//i.test(src);
const grouped = (secret: string) => secret.replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ');

/**
 * First-time authenticator setup for owners and admins (LoginResult 'mfa_enroll_required').
 * The TOTP secret lives in this component's state only: never in storage, the URL or a context,
 * and it is dropped when the step unmounts.
 */
export function MfaEnroll({
  onVerified,
  onExpired,
  onCancel,
}: {
  onVerified: (staff: StaffProfile) => void;
  /** The 5-minute cic_mfa cookie ran out (401): sign-in has to start again. */
  onExpired: (message: string) => void;
  onCancel: () => void;
}) {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'enroll' | 'verify' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(copyTimer.current);
      setEnrollment(null);
      setCode('');
    },
    [],
  );

  const hasEnrollment = enrollment !== null;
  useEffect(() => {
    if (hasEnrollment) heading.current?.focus();
  }, [hasEnrollment]);

  const begin = async () => {
    setBusy('enroll');
    setError(null);
    try {
      setEnrollment(await api.post<MfaEnrollment>('/auth/mfa/enroll'));
    } catch (err) {
      if (isApiError(err) && err.status === 401) onExpired(MFA_EXPIRED_MESSAGE);
      else if (isApiError(err, 'rate_limited')) setError(RATE_LIMITED);
      else if (isApiError(err, 'forbidden'))
        setError(
          err.message ||
            'This account can’t set up an authenticator right now. Ask a workspace owner for help.',
        );
      else setError(errorMessage(err, 'We couldn’t start authenticator setup. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy('verify');
    setError(null);
    try {
      const r = await api.post<{ staff: StaffProfile }>('/auth/mfa/verify', {
        factorId: enrollment.factorId,
        code,
      });
      setEnrollment(null);
      onVerified(r.staff);
    } catch (err) {
      // A wrong code is 401 mfa_required (retryable); any other 401 means the cic_mfa cookie is gone.
      if (isApiError(err, 'mfa_required') || isApiError(err, 'bad_request')) {
        setCode('');
        setError('That code didn’t work. Wait for a new code in your app and try again.');
      } else if (isApiError(err) && err.status === 401) onExpired(MFA_EXPIRED_MESSAGE);
      else if (isApiError(err, 'rate_limited')) setError(RATE_LIMITED);
      else setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!enrollment) return;
    setCopied((await copyText(enrollment.secret)) ? 'yes' : 'failed');
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 4000);
  };

  const back = (
    <p className="mt-4">
      <button
        type="button"
        className="link inline-flex items-center gap-1 text-sm"
        onClick={onCancel}
      >
        <ArrowLeft size={15} aria-hidden="true" /> Back to sign in
      </button>
    </p>
  );
  const alert = error && (
    <Notice tone="bad" role="alert" className="mt-4">
      {error}
    </Notice>
  );

  if (!enrollment) {
    return (
      <div data-testid="mfa-enroll-intro">
        <p className="t-meta">Step 2 of 2</p>
        <h1 className="t-h1 mt-2" tabIndex={-1} data-page-heading>
          Set up two-step sign-in
        </h1>
        <p className="mt-3 text-ink-2">
          Owner and admin accounts can see individual student records, so they need a second step at
          sign-in: a 6-digit code from an authenticator app on your phone.
        </p>
        <ul className="mt-4 space-y-2 text-sm text-ink-2">
          <li className="flex gap-2">
            <Smartphone size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
            <span>
              Have an authenticator app ready, such as Google Authenticator, Microsoft
              Authenticator, 1Password or Authy.
            </span>
          </li>
          <li className="flex gap-2">
            <Check size={18} className="mt-0.5 shrink-0 text-ink" aria-hidden="true" />
            <span>
              Setup takes about a minute. For security it must be finished within 5 minutes of
              signing in.
            </span>
          </li>
        </ul>
        {alert}
        <Button
          variant="primary"
          size="lg"
          block
          className="mt-6"
          loading={busy === 'enroll'}
          onClick={() => void begin()}
        >
          Set up authenticator app
        </Button>
        {back}
      </div>
    );
  }

  return (
    <form onSubmit={verify} noValidate data-testid="mfa-enroll">
      <h1 ref={heading} className="t-h1" tabIndex={-1} data-page-heading>
        Add this account to your app
      </h1>
      <ol className="mt-5 space-y-6">
        <li>
          <h2 className="t-h3 border-t border-ink pt-3">1. Scan the QR code</h2>
          <p className="mt-1 text-sm text-ink-2">
            In your authenticator app, add an account and point the camera here.
          </p>
          {isInlineImage(enrollment.qrCode) ? (
            <div className="mt-3 w-fit border border-ink bg-white p-3">
              <img
                src={enrollment.qrCode}
                width={184}
                height={184}
                className="block h-auto max-w-full"
                alt="QR code to add your Coding in Color staff account to an authenticator app. If you can’t scan it, use the setup key below."
              />
            </div>
          ) : (
            <Notice tone="warn" className="mt-3">
              The QR code couldn’t be shown. Use the setup key below instead.
            </Notice>
          )}
          <div
            className="mt-3 border border-rule bg-sheet p-3"
            role="group"
            aria-labelledby="mfa-secret-label"
          >
            <p id="mfa-secret-label" className="t-caption">
              Can’t scan? Enter this setup key in the app (time-based)
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              <code
                data-testid="mfa-secret"
                aria-label={`Setup key: ${enrollment.secret.split('').join(' ')}`}
                className="min-w-0 flex-1 select-all break-all font-mono text-base font-medium tracking-wider text-ink"
              >
                {grouped(enrollment.secret)}
              </code>
              <Button
                size="sm"
                className="shrink-0"
                onClick={() => void copy()}
                icon={
                  copied === 'yes' ? (
                    <Check size={15} aria-hidden="true" />
                  ) : (
                    <Copy size={15} aria-hidden="true" />
                  )
                }
                aria-label="Copy setup key"
              >
                {copied === 'yes' ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <p className="t-caption mt-1.5" role="status">
              {copied === 'yes' &&
                'Setup key copied. Paste it into your app, then clear your clipboard.'}
              {copied === 'failed' && 'Couldn’t copy. Select the key and copy it by hand.'}
            </p>
          </div>
          <p className="t-caption mt-2">
            This key is shown once and isn’t saved here. Don’t share it or screenshot it.
          </p>
        </li>
        <li>
          <h2 className="t-h3 border-t border-ink pt-3">2. Enter the code from the app</h2>
          <Input
            wrapperClassName="mt-2"
            label="6-digit code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            className="input-code text-center !tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </li>
      </ol>
      {alert}
      <Button
        type="submit"
        variant="primary"
        size="lg"
        block
        className="mt-6"
        loading={busy === 'verify'}
      >
        Verify and sign in
      </Button>
      {back}
    </form>
  );
}
