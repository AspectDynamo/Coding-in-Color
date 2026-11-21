import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { MfaEnrollment, StaffProfile } from '@shared/api';
import { StaffContext, type StaffState } from '@frontend/hooks/contexts';
import Login from './Login';
import { MFA_EXPIRED_MESSAGE } from './MfaEnroll';

const SECRET = 'JBSWY3DPEHPK3PXP';
const enrollment: MfaEnrollment = {
  factorId: 'factor-1',
  qrCode:
    'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
  secret: SECRET,
};
const admin: StaffProfile = {
  id: 'st-1',
  displayName: 'Ada Admin',
  role: 'admin',
  permissions: ['dashboard.view'],
  programIds: [],
  isSynthetic: false,
};

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (code: string, status: number, message = 'x') =>
  json({ error: { code, message } }, status);

/** Routes each API path to a queue of responses (the last one repeats). */
function mockApi(routes: Record<string, (() => Response)[]>) {
  const served: Record<string, number> = {};
  fetchMock.mockImplementation(async (url) => {
    const path = String(url).replace('/api/v1', '');
    const queue = routes[path];
    if (!queue) return apiError('not_found', 404);
    const i = Math.min(served[path] ?? 0, queue.length - 1);
    served[path] = (served[path] ?? 0) + 1;
    return queue[i]!();
  });
}
const calls = (path: string) => fetchMock.mock.calls.filter(([url]) => String(url).endsWith(path));
const bodyOf = (call: Parameters<typeof fetch>) =>
  call[1]?.body === undefined ? undefined : (JSON.parse(String(call[1]?.body)) as unknown);

function renderLogin() {
  const setStaff = vi.fn();
  const ctx: StaffState = {
    staff: null,
    loading: false,
    error: null,
    setStaff,
    logout: async () => {},
    can: () => false,
    retry: () => {},
  };
  const router = createMemoryRouter(
    [
      { path: '/staff/login', element: <Login /> },
      { path: '/admin/*', element: <p>ADMIN HOME</p> },
      { path: '/instructor/*', element: <p>INSTRUCTOR HOME</p> },
    ],
    { initialEntries: ['/staff/login'] },
  );
  const view = render(
    <StaffContext.Provider value={ctx}>
      <RouterProvider router={router} />
    </StaffContext.Provider>,
  );
  return { setStaff, ...view };
}

async function signInToEnrollIntro() {
  await userEvent.type(screen.getByLabelText('Email'), 'ada@example.org');
  await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery');
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  return screen.findByRole('heading', { name: 'Set up two-step sign-in' });
}
async function startSetup() {
  await signInToEnrollIntro();
  await userEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
  return screen.findByRole('img', { name: /QR code/ });
}

const login = () => json({ data: { status: 'mfa_enroll_required' } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'cic_csrf=t; path=/';
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Staff login: MFA enrollment', () => {
  it('explains the requirement first and does not enroll until asked', async () => {
    mockApi({ '/auth/login': [login] });
    renderLogin();
    await signInToEnrollIntro();
    expect(screen.getByText(/Owner and admin accounts/)).toBeInTheDocument();
    expect(screen.getByText(/authenticator app\s+on your phone/)).toBeInTheDocument();
    expect(calls('/auth/mfa/enroll')).toHaveLength(0);
  });

  it('shows the QR code and setup key, verifies the code and redirects', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [() => json({ data: enrollment })],
      '/auth/mfa/verify': [() => json({ data: { staff: admin } })],
    });
    const { setStaff } = renderLogin();
    const qr = await startSetup();
    expect(qr).toHaveAttribute('src', enrollment.qrCode);
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent('JBSW Y3DP EHPK 3PXP');
    expect(screen.getByTestId('mfa-secret').className).toContain('font-mono');
    expect(screen.getByRole('group', { name: /setup key/i })).toContainElement(
      screen.getByRole('button', { name: 'Copy setup key' }),
    );
    const enrollCall = calls('/auth/mfa/enroll')[0]!;
    expect(enrollCall[1]?.method).toBe('POST');
    expect(enrollCall[1]?.body).toBeUndefined();

    await userEvent.type(screen.getByLabelText('6-digit code'), '12a3456');
    expect(screen.getByLabelText('6-digit code')).toHaveValue('123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await screen.findByText('ADMIN HOME');
    expect(bodyOf(calls('/auth/mfa/verify')[0]!)).toEqual({ factorId: 'factor-1', code: '123456' });
    expect(setStaff).toHaveBeenCalledWith(admin);
  });

  it('copies the raw setup key and confirms it', async () => {
    mockApi({ '/auth/login': [login], '/auth/mfa/enroll': [() => json({ data: enrollment })] });
    renderLogin();
    await startSetup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Copy setup key' }));
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(await screen.findByText(/Setup key copied/)).toBeInTheDocument();
  });

  it('keeps the secret out of storage and the URL, and drops it when the step is left', async () => {
    mockApi({ '/auth/login': [login], '/auth/mfa/enroll': [() => json({ data: enrollment })] });
    const { container } = renderLogin();
    await startSetup();
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(window.location.href).not.toContain(SECRET);
    expect(document.cookie).not.toContain(SECRET);
    await userEvent.click(screen.getByRole('button', { name: /Back to sign in/ }));
    await screen.findByRole('button', { name: 'Sign in' });
    expect(container.innerHTML).not.toContain(SECRET);
    expect(container.innerHTML).not.toContain('JBSW');
  });

  it('lets a wrong code be retried without a new enrollment', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [() => json({ data: enrollment })],
      '/auth/mfa/verify': [
        () => apiError('mfa_required', 401),
        () => json({ data: { staff: admin } }),
      ],
    });
    renderLogin();
    await startSetup();
    await userEvent.type(screen.getByLabelText('6-digit code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/code didn’t work/);
    expect(screen.getByTestId('mfa-secret')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('6-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await screen.findByText('ADMIN HOME');
    expect(calls('/auth/mfa/enroll')).toHaveLength(1);
  });

  it('does not call the server for an incomplete code', async () => {
    mockApi({ '/auth/login': [login], '/auth/mfa/enroll': [() => json({ data: enrollment })] });
    renderLogin();
    await startSetup();
    await userEvent.type(screen.getByLabelText('6-digit code'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/6-digit code/);
    expect(calls('/auth/mfa/verify')).toHaveLength(0);
  });

  it('restarts sign-in with a clear message when enrollment gets a 401', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [() => apiError('unauthenticated', 401)],
    });
    renderLogin();
    await signInToEnrollIntro();
    await userEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MFA_EXPIRED_MESSAGE);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });

  it('restarts sign-in and removes the secret when the session expires at verification', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [() => json({ data: enrollment })],
      '/auth/mfa/verify': [() => apiError('unauthenticated', 401)],
    });
    const { container } = renderLogin();
    await startSetup();
    await userEvent.type(screen.getByLabelText('6-digit code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(MFA_EXPIRED_MESSAGE);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument(),
    );
    expect(container.innerHTML).not.toContain('JBSW');
  });

  it('shows rate-limit and server errors in place and allows another try', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [
        () => apiError('rate_limited', 429),
        () => apiError('internal', 500),
        () => json({ data: enrollment }),
      ],
    });
    renderLogin();
    await signInToEnrollIntro();
    const start = () =>
      userEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
    await start();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
    await start();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Something went wrong on our side/),
    );
    await start();
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeInTheDocument();
  });

  it('never renders a remote QR image', async () => {
    mockApi({
      '/auth/login': [login],
      '/auth/mfa/enroll': [
        () => json({ data: { ...enrollment, qrCode: 'https://example.com/qr.svg' } }),
      ],
    });
    renderLogin();
    await signInToEnrollIntro();
    await userEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }));
    await screen.findByTestId('mfa-secret');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText(/QR code couldn’t be shown/)).toBeInTheDocument();
  });
});
