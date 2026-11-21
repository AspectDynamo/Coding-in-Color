import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { StudentMe } from '@shared/api';
import { StudentContext, type StudentState } from '@frontend/hooks/contexts';
import { BAD_CODE_MESSAGE, RATE_LIMIT_MESSAGE } from '@frontend/lib/accessCode';
import CodeEntry from './CodeEntry';

const me: StudentMe = {
  publicCode: 'S-TEST01',
  ageBand: 'AGE_13_17',
  status: 'active',
  cohorts: [],
};
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderEntry(state?: { returnTo?: string }) {
  const setStudent = vi.fn();
  const ctx: StudentState = {
    student: null,
    loading: false,
    error: null,
    setStudent,
    logout: async () => {},
    retry: () => {},
  };
  const router = createMemoryRouter(
    [
      { path: '/s', element: <CodeEntry /> },
      { path: '/s/home', element: <p>HOME</p> },
      { path: '/s/assess/:id', element: <p>ASSESS</p> },
    ],
    { initialEntries: [{ pathname: '/s', state }] },
  );
  render(
    <StudentContext.Provider value={ctx}>
      <RouterProvider router={router} />
    </StudentContext.Provider>,
  );
  return { setStudent };
}

const postedBodies = () =>
  fetchMock.mock.calls
    .filter(([url, init]) => String(url).endsWith('/student/session') && init?.method === 'POST')
    .map(([, init]) => JSON.parse(String(init?.body)) as { code: string });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'cic_csrf=t; path=/';
  window.history.replaceState(null, '', '/s');
  window.sessionStorage.clear();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CodeEntry', () => {
  it('auto-formats typed input and submits the code', async () => {
    fetchMock.mockResolvedValue(json({ data: me }));
    const { setStudent } = renderEntry();
    const input = screen.getByLabelText('Access code');
    await userEvent.type(input, '7kq2 m9x4abcd0123');
    expect(input).toHaveValue('7KQ2-M9X4-ABCD-0123');
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    await screen.findByText('HOME');
    expect(postedBodies()).toEqual([{ code: '7KQ2-M9X4-ABCD-0123' }]);
    expect(setStudent).toHaveBeenCalledWith(me);
  });

  it('reads #code= from the fragment, removes it from the URL, and signs in automatically', async () => {
    window.history.replaceState(null, '', '/s#code=7KQ2-M9X4-ABCD-0123');
    fetchMock.mockResolvedValue(json({ data: me }));
    renderEntry();
    await screen.findByText('HOME');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('7KQ2');
    expect(postedBodies()).toEqual([{ code: '7KQ2-M9X4-ABCD-0123' }]);
  });

  it('never writes the code to web storage', async () => {
    window.history.replaceState(null, '', '/s#code=7KQ2-M9X4-ABCD-0123');
    fetchMock.mockResolvedValue(json({ data: me }));
    renderEntry();
    await screen.findByText('HOME');
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);
  });

  it('shows one identical friendly message for any rejected code', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'invalid_code', message: 'Invalid access code.' } }, 401),
    );
    renderEntry();
    await userEvent.type(screen.getByLabelText('Access code'), '0000111122223333');
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD_CODE_MESSAGE);

    fetchMock.mockResolvedValue(
      json({ error: { code: 'bad_request', message: 'Malformed.' } }, 400),
    );
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    await waitFor(() => expect(postedBodies()).toHaveLength(2));
    expect(await screen.findByRole('alert')).toHaveTextContent(BAD_CODE_MESSAGE);
  });

  it('shows the rate-limit message on 429', async () => {
    fetchMock.mockResolvedValue(
      json({ error: { code: 'rate_limited', message: 'Slow down' } }, 429),
    );
    renderEntry();
    await userEvent.type(screen.getByLabelText('Access code'), '0000111122223333');
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(RATE_LIMIT_MESSAGE);
  });

  it('does not call the server for an incomplete code', async () => {
    renderEntry();
    await userEvent.type(screen.getByLabelText('Access code'), 'ABCD');
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/16 letters and numbers/);
    expect(postedBodies()).toHaveLength(0);
  });

  it('returns to the assessment from a join link after sign-in', async () => {
    fetchMock.mockResolvedValue(json({ data: me }));
    renderEntry({ returnTo: '/s/assess/11111111-2222-4333-8444-555555555555' });
    await userEvent.type(screen.getByLabelText('Access code'), '7kq2m9x4abcd0123');
    await userEvent.click(screen.getByRole('button', { name: /let’s go/i }));
    await screen.findByText('ASSESS');
  });
});
