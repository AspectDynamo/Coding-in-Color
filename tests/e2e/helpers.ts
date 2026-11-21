/// <reference lib="dom" />
import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

/**
 * Presenter access codes for the synthetic demo dataset.
 * Source of truth: src/backend/demo/generate.ts → demoCredentials (labels starting "Presenter").
 */
export const PRESENTER = {
  freshPre: 'DEMA-FRSH-PRE0-2026',
  readyForPost: 'DEMA-RDY2-P0ST-2026',
} as const;

const API = '/api/v1';

export const AUTH_DIR = 'tests/e2e/.auth';
export type DemoRole = 'owner' | 'admin' | 'analyst' | 'instructor';
/** Saved sign-in created once by global-setup.ts, so the suite stays under the staff login rate limit. */
export const authFile = (role: DemoRole) => `${AUTH_DIR}/${role}.json`;

/** Signs in as a demo staff role through the API and returns the context (cookies included). */
export async function apiLogin(baseURL: string, role: DemoRole): Promise<APIRequestContext> {
  const ctx = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
  });
  await ctx.get(`${API}/config`);
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'cic_csrf')?.value ?? '';
  const login = await ctx.post(`${API}/auth/demo-login`, {
    data: { role },
    headers: { 'X-CSRF-Token': csrf },
  });
  if (!login.ok())
    throw new Error(
      `Demo login as ${role} failed with ${login.status()} — is the dev server running with the memory store?`,
    );
  return ctx;
}

/** API client reusing the saved instructor/admin sign-in, with the CSRF header and Origin the API requires. */
export async function staffApi(baseURL: string, role: DemoRole) {
  const ctx = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
    storageState: authFile(role),
  });
  const csrf = (await ctx.storageState()).cookies.find((c) => c.name === 'cic_csrf')?.value ?? '';
  const headers = { 'X-CSRF-Token': csrf };
  return {
    ctx,
    get: async <T>(path: string) =>
      ((await (await ctx.get(`${API}${path}`)).json()) as { data: T }).data,
    post: async <T>(path: string, data: unknown) => {
      const res = await ctx.post(`${API}${path}`, { data, headers });
      expect(res.ok(), `POST ${path} → ${res.status()}`).toBeTruthy();
      return ((await res.json()) as { data: T }).data;
    },
    tryPost: async <T>(path: string, data: unknown) => {
      const res = await ctx.post(`${API}${path}`, { data, headers });
      return res.ok() ? ((await res.json()) as { data: T }).data : null;
    },
    dispose: () => ctx.dispose(),
  };
}

interface SessionRow {
  id: string;
  cohortId: string;
  status: string;
  stage: string;
  title: string;
}

/**
 * Issues one brand-new access card in a cohort that has an open PRE session, so student-flow
 * tests always have an untouched assessment even when the dev server has been running a while.
 */
export async function issueFreshCard(
  baseURL: string,
): Promise<{ accessCode: string; accessUrl: string; sessionId: string }> {
  const api = await staffApi(baseURL, 'instructor');
  try {
    const sessions = await api.get<SessionRow[]>('/instructor/assessment-sessions');
    const open =
      sessions.find((s) => s.status === 'open' && s.stage === 'PRE') ??
      sessions.find((s) => s.status === 'open');
    if (!open) throw new Error('No open session in the demo dataset');
    const [card] = await api.post<{ accessCode: string; accessUrl: string }[]>(
      '/instructor/student-credentials',
      {
        cohortId: open.cohortId,
        count: 1,
        ageBand: 'AGE_13_17',
      },
    );
    if (!card) throw new Error('No card issued');
    return { ...card, sessionId: open.id };
  } finally {
    await api.dispose();
  }
}

/** Creates an open PRACTICE session on a finished cohort so open/close tests never disturb students. */
export async function createScratchSession(
  baseURL: string,
): Promise<{ id: string; title: string }> {
  const api = await staffApi(baseURL, 'instructor');
  try {
    const cohorts = await api.get<{ id: string; status: string }[]>('/instructor/cohorts');
    const assessments = await api.get<{ id: string }[]>('/instructor/assessments');
    const cohort = cohorts.find((c) => c.status === 'completed') ?? cohorts[0];
    if (!cohort) throw new Error('Demo dataset has no cohort');
    const title = `E2E practice ${Date.now().toString(36)}`;
    // The API refuses a practice session on an assessment already used for a graded session in
    // the cohort, so take the first assessment it accepts.
    for (const assessment of assessments) {
      const s = await api.tryPost<{ id: string }>('/instructor/assessment-sessions', {
        cohortId: cohort.id,
        assessmentId: assessment.id,
        stage: 'PRACTICE',
        title,
        openNow: true,
      });
      if (s) return { id: s.id, title };
    }
    throw new Error('Could not create a practice session with any assessment');
  } finally {
    await api.dispose();
  }
}

/** Signs in through the real demo buttons on /staff/login. */
export async function demoLogin(
  page: Page,
  role: 'Owner' | 'Administrator' | 'Analyst' | 'Instructor',
) {
  await page.goto('/staff/login');
  await page.getByRole('button', { name: `Demo ${role}` }).click();
  await page.waitForURL(role === 'Instructor' ? '**/instructor' : '**/admin');
}

/** Signs a student in by typing the code (the "typed" path on the access card). */
export async function signInByTyping(page: Page, code: string) {
  await page.goto('/s');
  await page.getByLabel('Access code').fill(code.toLowerCase().replaceAll('-', ' '));
  await expect(page.getByLabel('Access code')).toHaveValue(code);
  await page.getByRole('button', { name: 'Let’s go' }).click();
  await page.waitForURL('**/s/home');
}

/** Answers whatever question type is on screen using pointer/touch input. */
export async function answerCurrentQuestion(page: Page) {
  const card = page.locator('main');
  if (await card.getByTestId('likert-panel').count()) {
    await card.locator('label.likert-cell').nth(3).click();
  } else if (await card.locator('label.codeblock-line').count()) {
    await card.locator('label.codeblock-line').nth(1).click();
  } else if (await card.locator('label.option').count()) {
    await card.locator('label.option').first().click();
  } else if (await card.getByRole('button', { name: 'This order is already right' }).count()) {
    await card
      .getByRole('button', { name: /^Move .* down$/ })
      .first()
      .click();
  } else {
    await card.getByRole('textbox').fill('4');
  }
}

/** From the assessment intro: start, answer every question, review, submit. Returns the question count. */
export async function completeAssessment(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  const position = page.getByTestId('question-position');
  await expect(position).toContainText('Question 1 of');
  const total = Number(/of (\d+)/.exec((await position.textContent()) ?? '')?.[1]);
  expect(total).toBeGreaterThan(0);
  for (let i = 1; i <= total; i++) {
    await expect(position).toContainText(`Question ${i} of ${total}`);
    await answerCurrentQuestion(page);
    await expect(page.getByTestId('answered-count')).toContainText(`${i} of ${total} answered`);
    await page.getByRole('button', { name: i === total ? 'Review' : 'Next', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Check your answers' })).toBeVisible();
  await expect(page.getByText('Every question has an answer')).toBeVisible();
  await page.getByRole('button', { name: 'Turn in my answers' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, turn it in' }).click();
  await expect(page.getByTestId('done-screen')).toBeVisible();
  return total;
}

/** Console errors collected for the lifetime of the page (ignores dev-server noise). */
export function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Outdated Optimize Dep|\[vite\]|Failed to load resource/.test(t)) return;
    errors.push(t);
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export type { APIRequestContext };
