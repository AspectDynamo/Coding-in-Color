/* eslint-disable @typescript-eslint/no-explicit-any */
import { app } from '../../src/backend/index';
import { resetMemoryStore } from '../../src/backend/repositories';
import { resetRateLimits } from '../../src/backend/services/rate-limit';
import { resetUsedMfaTokens } from '../../src/backend/routes/auth';
import type { Bindings } from '../../src/backend/env';
import { generateDemoDataset } from '../../src/backend/demo/generate';

export const ORIGIN = 'http://localhost';
export const SESSION_SECRET = 'test-session-secret-0123456789abcdef-0123456789';
export const PEPPER = 'test-credential-pepper-0123456789abcdef-0123456789';

export const PRESENTER_FRESH = 'DEMA-FRSH-PRE0-2026';
export const PRESENTER_POST = 'DEMA-RDY2-P0ST-2026';

export interface AiStub {
  run: (model: string, input: unknown, options?: unknown) => Promise<unknown>;
  calls: { model: string; input: unknown }[];
}

export function makeAiStub(mode: 'ok' | 'throw' | 'garbage' = 'ok'): AiStub {
  const stub: AiStub = {
    calls: [],
    async run(model, input) {
      stub.calls.push({ model, input });
      if (mode === 'throw') throw new Error('model exploded');
      if (mode === 'garbage') return { response: 'this is not json at all' };
      return {
        response: JSON.stringify({
          headline: 'Observed assessment performance increased in this sample',
          summary:
            'Matched students showed higher post-assessment scores. This is an observed change and not proof of causation.',
          key_findings: ['Observed improvement among matched students.'],
          areas_for_improvement: ['Continue to monitor results.'],
          recommendations: ['Review the weakest skills with instructors.'],
          limitations: ['Pre/post design without a comparison group.'],
        }),
      };
    },
  };
  return stub;
}

export function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    APP_ENV: 'development',
    DEMO_MODE: 'true',
    AI_MODEL: '@cf/test/model',
    SUPPRESSION_THRESHOLD: '10',
    ALLOW_UNDER_13_REGISTRATION: 'false',
    REQUIRE_ADMIN_MFA: 'false',
    CREDENTIAL_KEY_VERSION: '1',
    ALLOWED_ORIGINS: '',
    SESSION_SECRET,
    CREDENTIAL_PEPPER: PEPPER,
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',
    SUPABASE_SERVICE_ROLE_KEY: '',
    ...overrides,
  };
}

export function freshState(): void {
  resetMemoryStore();
  resetRateLimits();
  resetUsedMfaTokens();
}

let datasetCache: ReturnType<typeof generateDemoDataset> | null = null;
export const dataset = () => (datasetCache ??= generateDemoDataset());

/** Minimal cookie-jar HTTP client over app.request(). */
export class Client {
  jar = new Map<string, string>();
  constructor(public env: Bindings = makeEnv()) {}

  cookieHeader(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async raw(
    method: string,
    path: string,
    opts: {
      body?: unknown;
      csrf?: boolean | string;
      origin?: string | null;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    const mutating = !['GET', 'HEAD'].includes(method);
    if (mutating) {
      if (opts.csrf !== false)
        headers['x-csrf-token'] =
          typeof opts.csrf === 'string' ? opts.csrf : (this.jar.get('cic_csrf') ?? '');
      if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
    }
    const res = await app.request(
      `/api/v1${path}`,
      { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) },
      this.env,
    );
    for (const sc of res.headers.getSetCookie()) {
      const [pair = ''] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/max-age=0/i.test(sc) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  async call<T = any>(
    method: string,
    path: string,
    opts: Parameters<Client['raw']>[2] = {},
  ): Promise<{ status: number; body: T; res: Response }> {
    // Make sure we hold a CSRF cookie before any mutation.
    if (!this.jar.has('cic_csrf')) await this.raw('GET', '/config');
    const res = await this.raw(method, path, opts);
    const text = await res.text();
    let body: any = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* csv etc */
    }
    return { status: res.status, body, res };
  }

  get = <T = any>(path: string) => this.call<T>('GET', path);
  post = <T = any>(path: string, body?: unknown, opts: Parameters<Client['raw']>[2] = {}) =>
    this.call<T>('POST', path, { body: body ?? {}, ...opts });
  patch = <T = any>(path: string, body?: unknown) =>
    this.call<T>('PATCH', path, { body: body ?? {} });
  del = <T = any>(path: string) => this.call<T>('DELETE', path);

  studentLogin = (code: string) => this.post('/student/session', { code });
  staffDemo = (role: string) => this.post('/auth/demo-login', { role });
}

/** Builds a plausible response for every question (answers need not be right). */
export function answerAll(questions: any[]): { questionId: string; response: any }[] {
  return questions.map((q) => {
    switch (q.type) {
      case 'multiple_choice':
      case 'code_comprehension':
      case 'predict_output':
        return { questionId: q.id, response: { kind: 'single', optionId: q.config.options[0].id } };
      case 'multiple_select':
        return {
          questionId: q.id,
          response: { kind: 'multi', optionIds: [q.config.options[0].id] },
        };
      case 'debugging':
        return { questionId: q.id, response: { kind: 'line', line: 1 } };
      case 'ordering':
        return {
          questionId: q.id,
          response: { kind: 'order', itemIds: q.config.items.map((i: any) => i.id) },
        };
      case 'short_logic':
        return { questionId: q.id, response: { kind: 'text', text: 'x' } };
      case 'confidence_likert':
        return { questionId: q.id, response: { kind: 'likert', value: 3 } };
      default:
        return { questionId: q.id, response: { kind: 'skipped' } };
    }
  });
}

/** Presenter signs in, opens the first available assessment and returns what is needed to submit. */
export async function startFirstAssessment(c: Client) {
  const list = await c.get('/student/assessments');
  const summary = list.body.data[0];
  const detail = await c.get(`/student/assessments/${summary.sessionId}`);
  const start = await c.post(`/student/assessments/${summary.sessionId}/start`);
  return {
    summary,
    detail: detail.body.data,
    attemptId: start.body.data.attemptId as string,
    sessionId: summary.sessionId as string,
  };
}
