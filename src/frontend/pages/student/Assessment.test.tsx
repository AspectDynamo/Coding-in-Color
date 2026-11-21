import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router';
import type { StudentAssessmentDetail } from '@shared/api';
import { Runner } from './Assessment';

const ATTEMPT = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const Q = (n: number) => `cccccccc-3333-4333-8333-00000000000${n}`;

const detail = (attempt: StudentAssessmentDetail['attempt'] = null): StudentAssessmentDetail => ({
  sessionId: SESSION,
  assessmentId: 'dddddddd-4444-4444-8444-dddddddddddd',
  assessmentVersion: 3,
  title: 'Python basics — Form A',
  description: 'A short check-in.',
  stage: 'PRE',
  estimatedMinutes: 6,
  attempt,
  questions: [
    {
      id: Q(1),
      type: 'multiple_choice',
      prompt: 'What is 2 + 2?',
      config: {
        options: [
          { id: 'a', label: 'Three' },
          { id: 'b', label: 'Four' },
        ],
      },
      skillCategory: 'logic',
      points: 1,
      order: 1,
    },
    {
      id: Q(2),
      type: 'short_logic',
      prompt: 'How many times does the loop run?',
      config: { maxLength: 10 },
      skillCategory: 'loops',
      points: 1,
      order: 2,
    },
    {
      id: Q(3),
      type: 'confidence_likert',
      prompt: 'How confident do you feel reading code?',
      config: {},
      skillCategory: 'code_comprehension',
      points: 0,
      order: 3,
    },
    {
      id: Q(4),
      type: 'project_rubric',
      prompt: 'Instructor only',
      config: { criteria: [] },
      skillCategory: 'logic',
      points: 0,
      order: 4,
    },
  ],
});

const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderRunner(d: StudentAssessmentDetail) {
  const router = createMemoryRouter(
    [
      { path: '/s/assess/:sessionId', element: <Runner detail={d} /> },
      { path: '/s/done/:sessionId', element: <p>DONE</p> },
      { path: '/s/home', element: <p>HOME</p> },
    ],
    { initialEntries: [`/s/assess/${SESSION}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const draftKey = `cic:draft:${ATTEMPT}`;
const readDraft = () =>
  JSON.parse(window.sessionStorage.getItem(draftKey) ?? 'null') as {
    answers: Record<string, unknown>;
    index: number;
  } | null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  document.cookie = 'cic_csrf=t; path=/';
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function start() {
  fetchMock.mockResolvedValueOnce(
    json({ data: { attemptId: ATTEMPT, startedAt: '2026-11-21T10:00:00Z' } }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByRole('heading', { name: 'What is 2 + 2?' });
}

describe('assessment runner', () => {
  it('starts, shows one question per screen with progress, and navigates Previous/Next', async () => {
    renderRunner(detail());
    expect(screen.getByRole('heading', { name: 'Python basics — Form A' })).toBeInTheDocument();
    await start();
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/v1/student/assessments/${SESSION}/start`);
    expect(screen.getByTestId('question-position')).toHaveTextContent('Question 1 of 3');
    expect(screen.queryByText('How many times does the loop run?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await userEvent.click(screen.getByRole('radio', { name: /Four/ }));
    expect(screen.getByTestId('answered-count')).toHaveTextContent('1 of 3 answered');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByTestId('question-position')).toHaveTextContent('Question 2 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('radio', { name: /Four/ })).toBeChecked();
  });

  it('never shows instructor-only rubric items to students', async () => {
    renderRunner(detail());
    await start();
    expect(screen.getByTestId('question-position')).toHaveTextContent('of 3');
  });

  it('saves a draft of answers only, keyed by attempt id', async () => {
    renderRunner(detail());
    await start();
    await userEvent.click(screen.getByRole('radio', { name: /Four/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(readDraft()?.index).toBe(1));
    expect(readDraft()).toEqual({
      v: 1,
      answers: { [Q(1)]: { kind: 'single', optionId: 'b' } },
      index: 1,
    });
    expect(Object.keys(window.sessionStorage)).toEqual([draftKey]);
  });

  it('restores the draft after a refresh when the attempt is in progress', async () => {
    window.sessionStorage.setItem(
      draftKey,
      JSON.stringify({
        v: 1,
        answers: { [Q(1)]: { kind: 'single', optionId: 'a' }, [Q(2)]: { kind: 'text', text: '4' } },
        index: 1,
      }),
    );
    renderRunner(detail({ id: ATTEMPT, status: 'in_progress', startedAt: '2026-11-21T10:00:00Z' }));
    expect(
      await screen.findByRole('heading', { name: 'How many times does the loop run?' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('4');
    expect(screen.getByText('Welcome back')).toBeInTheDocument();
    expect(screen.getByTestId('answered-count')).toHaveTextContent('2 of 3 answered');
    await userEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('radio', { name: /Three/ })).toBeChecked();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('review lists unanswered items, lets the student jump back, and submits skipped for blanks', async () => {
    renderRunner(detail());
    await start();
    await userEvent.click(screen.getByRole('radio', { name: /Four/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(await screen.findByRole('heading', { name: /Check your answers/ })).toBeInTheDocument();
    expect(screen.getByText('2 questions aren’t answered yet')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Your answers' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Answered');
    expect(rows[1]).toHaveTextContent('Not answered yet');
    expect(rows[2]).toHaveTextContent('Not answered yet');

    // jump back to question 2 and answer it
    await userEvent.click(within(rows[1]!).getByRole('button'));
    await userEvent.type(await screen.findByRole('textbox'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(await screen.findByText('1 question isn’t answered yet')).toBeInTheDocument();

    // submit with confirmation
    await userEvent.click(screen.getByRole('button', { name: 'Turn in my answers' }));
    const dialog = await screen.findByRole('dialog', { name: 'Turn in your answers?' });
    expect(dialog).toHaveTextContent('1 unanswered question');
    fetchMock.mockResolvedValueOnce(
      json({
        data: {
          attemptId: ATTEMPT,
          submittedAt: 'x',
          answeredCount: 2,
          totalQuestions: 3,
          durationSeconds: 61,
        },
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, turn it in' }));
    await screen.findByText('DONE');

    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe(`/api/v1/student/assessments/${SESSION}/submit`);
    expect(JSON.parse(String(init?.body))).toEqual({
      attemptId: ATTEMPT,
      assessmentVersion: 3,
      responses: [
        { questionId: Q(1), response: { kind: 'single', optionId: 'b' } },
        { questionId: Q(2), response: { kind: 'text', text: '3' } },
        { questionId: Q(3), response: { kind: 'skipped' } },
      ],
    });
    expect(window.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it('treats 409 already-submitted as done and clears the draft', async () => {
    renderRunner(detail({ id: ATTEMPT, status: 'in_progress', startedAt: 'x' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Four/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn in my answers' }));
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'conflict', message: 'Already submitted.' } }, 409),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Yes, turn it in' }));
    await screen.findByText('DONE');
    expect(window.sessionStorage.getItem(draftKey)).toBeNull();
  });

  it('explains when the session was closed before submitting', async () => {
    renderRunner(detail({ id: ATTEMPT, status: 'in_progress', startedAt: 'x' }));
    await userEvent.click(await screen.findByRole('radio', { name: /Four/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Review' }));
    await userEvent.click(screen.getByRole('button', { name: 'Turn in my answers' }));
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 'session_closed', message: 'Closed.' } }, 409),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Yes, turn it in' }));
    expect(
      await screen.findByRole('heading', { name: 'This check-in is closed' }),
    ).toBeInTheDocument();
  });

  it('asks before leaving with answers that are not turned in', async () => {
    const router = renderRunner(detail());
    await start();
    await userEvent.click(screen.getByRole('radio', { name: /Four/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Leave this check-in?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep going' }));
    expect(router.state.location.pathname).toBe(`/s/assess/${SESSION}`);
    await userEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }),
    );
    await screen.findByText('HOME');
  });
});
