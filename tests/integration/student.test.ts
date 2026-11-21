/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Client,
  PRESENTER_FRESH,
  PRESENTER_POST,
  answerAll,
  freshState,
  makeEnv,
  startFirstAssessment,
} from './helpers';

const FORBIDDEN_KEYS = [
  'answerKey',
  'correctOptionId',
  'correctOptionIds',
  'acceptedAnswers',
  'bugLine',
  'correctOrder',
  'caseSensitive',
];

function deepKeys(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => deepKeys(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      deepKeys(x, out);
    }
  return out;
}

beforeEach(freshState);

describe('student login', () => {
  it('signs in a presenter code and sets an HttpOnly session cookie', async () => {
    const c = new Client();
    const r = await c.studentLogin(PRESENTER_FRESH);
    expect(r.status).toBe(200);
    expect(r.body.data.publicCode).toMatch(/^S-[0-9A-Z]{6}$/);
    const set = r.res.headers.getSetCookie().find((s) => s.startsWith('cic_student='))!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    expect(set).not.toMatch(/Secure/i); // plain-http localhost
    expect((await c.get('/student/me')).status).toBe(200);
  });

  it('accepts lowercase, spaces and ambiguous characters in the code', async () => {
    const r = await new Client().studentLogin('dema frsh-pre0 2026');
    expect(r.status).toBe(200);
  });

  it('returns the identical body for unknown, malformed and revoked codes', async () => {
    const c = new Client();
    const unknown = await c.studentLogin('ABCD-EFGH-JKMN-PQRS');
    const malformed = await c.studentLogin('nope');
    const nonString = await c.post('/student/session', { code: 12345 });

    // Revoke the presenter's credential by reissuing the seat, then try the old code.
    const staff = new Client();
    await staff.staffDemo('instructor');
    const roster = await staff.get(
      '/instructor/cohorts/ab33b082-87c2-4aa9-8e11-000000000000/roster',
    ); // placeholder uuid -> 404
    expect(roster.status).toBe(404);
    const cohorts = await staff.get('/instructor/cohorts');
    const tempe = cohorts.body.data.find((x: any) => x.name.includes('Tempe'));
    const reissue = await staff.post('/instructor/student-credentials/reissue', {
      cohortId: tempe.id,
      rosterLabel: '07',
      reason: 'lost',
    });
    expect(reissue.status).toBe(200);
    const revoked = await new Client().studentLogin(PRESENTER_FRESH);

    for (const r of [unknown, malformed, nonString, revoked]) expect(r.status).toBe(401);
    expect(unknown.body).toEqual(malformed.body);
    expect(unknown.body).toEqual(nonString.body);
    expect(unknown.body).toEqual(revoked.body);
    expect(unknown.body.error.code).toBe('invalid_code');

    // New code from the reissue works and maps to the same student.
    const again = await new Client().studentLogin(reissue.body.data.accessCode);
    expect(again.status).toBe(200);
    expect(again.body.data.publicCode).toBe(reissue.body.data.publicCode);
  });

  it('rate limits repeated attempts', async () => {
    const c = new Client();
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = (await c.studentLogin('ABCD-EFGH-JKMN-PQRS')).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it('never logs the raw access code', async () => {
    const lines: string[] = [];
    const spies = (['log', 'warn', 'error', 'info'] as const).map((m) =>
      vi
        .spyOn(console, m)
        .mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' '))),
    );
    try {
      const c = new Client();
      await c.studentLogin(PRESENTER_FRESH);
      await c.studentLogin('ABCD-EFGH-JKMN-PQRS');
      await c.get('/student/assessments');
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
    const all = lines.join('\n');
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain('DEMA');
    expect(all).not.toContain('FRSH');
    expect(all).not.toContain('ABCD');
  });

  it('requires a CSRF token and same-origin Origin on mutations', async () => {
    const c = new Client();
    await c.get('/config');
    const body = { code: PRESENTER_FRESH };
    expect((await c.post('/student/session', body, { csrf: false })).status).toBe(403);
    expect(
      (await c.post('/student/session', body, { csrf: 'wrong-token-wrong-token-wrong' })).status,
    ).toBe(403);
    expect(
      (await c.post('/student/session', body, { origin: 'https://evil.example' })).status,
    ).toBe(403);
    expect((await c.post('/student/session', body, { origin: null })).status).toBe(403);
    const bad = await c.post('/student/session', body, { origin: 'https://evil.example' });
    expect(bad.body.error.code).toBe('csrf_failed');
    expect((await c.post('/student/session', body)).status).toBe(200);
  });

  it('honours ALLOWED_ORIGINS', async () => {
    const c = new Client(makeEnv({ ALLOWED_ORIGINS: 'https://app.example.org' }));
    expect(
      (
        await c.post(
          '/student/session',
          { code: PRESENTER_FRESH },
          { origin: 'https://app.example.org' },
        )
      ).status,
    ).toBe(200);
  });
});

describe('student assessments', () => {
  it('lists open sessions and never exposes answer keys', async () => {
    const c = new Client();
    await c.studentLogin(PRESENTER_FRESH);
    const list = await c.get('/student/assessments');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].state).toBe('available');
    const detail = await c.get(`/student/assessments/${list.body.data[0].sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.questions.length).toBeGreaterThan(3);
    const keys = deepKeys(detail.body);
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), `leaked key ${k}`).toBe(false);
    // Stable ordering shuffle across refreshes.
    const again = await c.get(`/student/assessments/${list.body.data[0].sessionId}`);
    expect(again.body.data.questions).toEqual(detail.body.data.questions);
  });

  it('start is idempotent, submit scores server-side, second submit is a 409', async () => {
    const c = new Client();
    await c.studentLogin(PRESENTER_FRESH);
    const { detail, attemptId, sessionId } = await startFirstAssessment(c);
    const again = await c.post(`/student/assessments/${sessionId}/start`);
    expect(again.body.data.attemptId).toBe(attemptId);

    const body = {
      attemptId,
      assessmentVersion: detail.assessmentVersion,
      responses: answerAll(detail.questions),
    };
    const submit = await c.post(`/student/assessments/${sessionId}/submit`, body);
    expect(submit.status).toBe(200);
    expect(submit.body.data.attemptId).toBe(attemptId);
    expect(submit.body.data.totalQuestions).toBe(detail.questions.length);
    expect(JSON.stringify(submit.body)).not.toMatch(/score|percentage|correct/i);

    expect((await c.post(`/student/assessments/${sessionId}/submit`, body)).status).toBe(409);
    expect((await c.post(`/student/assessments/${sessionId}/start`)).status).toBe(409);

    const list = await c.get('/student/assessments');
    expect(list.body.data[0].state).toBe('completed');
    const progress = await c.get('/student/progress');
    expect(progress.body.data.attempts.at(-1).percentageScore).toBeGreaterThanOrEqual(0);
  });

  it('rejects wrong version, foreign questionId and wrong response kind with 400', async () => {
    const c = new Client();
    await c.studentLogin(PRESENTER_FRESH);
    const { detail, attemptId, sessionId } = await startFirstAssessment(c);
    const good = answerAll(detail.questions);
    const post = (b: unknown) => c.post(`/student/assessments/${sessionId}/submit`, b);

    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion + 1, responses: good }))
        .status,
    ).toBe(400);
    const foreign = [
      ...good,
      { questionId: crypto.randomUUID(), response: { kind: 'single', optionId: 'a' } },
    ];
    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion, responses: foreign }))
        .status,
    ).toBe(400);
    const dup = [...good, good[0]];
    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion, responses: dup }))
        .status,
    ).toBe(400);
    const wrongKind = good.map((r, i) =>
      i === 0 ? { ...r, response: { kind: 'text', text: 'hello' } } : r,
    );
    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion, responses: wrongKind }))
        .status,
    ).toBe(400);
    const badOption = good.map((r, i) =>
      i === 0 ? { ...r, response: { kind: 'single', optionId: 'zz' } } : r,
    );
    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion, responses: badOption }))
        .status,
    ).toBe(400);
    expect(
      (await post({ attemptId: 'not-a-uuid', assessmentVersion: 1, responses: [] })).status,
    ).toBe(400);
    // Nothing above consumed the attempt.
    expect(
      (await post({ attemptId, assessmentVersion: detail.assessmentVersion, responses: good }))
        .status,
    ).toBe(200);
  });

  it("cannot submit someone else's attempt", async () => {
    const a = new Client();
    await a.studentLogin(PRESENTER_FRESH);
    const first = await startFirstAssessment(a);
    const b = new Client();
    await b.studentLogin(PRESENTER_POST);
    const r = await b.post(`/student/assessments/${first.sessionId}/submit`, {
      attemptId: first.attemptId,
      assessmentVersion: first.detail.assessmentVersion,
      responses: [],
    });
    expect([403, 404]).toContain(r.status);
  });

  it("cannot open another cohort's session", async () => {
    const a = new Client();
    await a.studentLogin(PRESENTER_FRESH);
    const own = (await a.get('/student/assessments')).body.data[0].sessionId;
    const b = new Client();
    await b.studentLogin(PRESENTER_POST);
    const r = await b.get(`/student/assessments/${own}`);
    expect([403, 404]).toContain(r.status);
    expect((await b.post(`/student/assessments/${own}/start`)).status).toBe(404);
  });

  it('blocks staff routes for students and student routes for anonymous callers', async () => {
    const s = new Client();
    await s.studentLogin(PRESENTER_FRESH);
    for (const path of ['/instructor/cohorts', '/admin/dashboard', '/auth/me', '/admin/students']) {
      expect((await s.get(path)).status, path).toBe(401);
    }
    const anon = new Client();
    expect((await anon.get('/student/assessments')).status).toBe(401);
    expect((await anon.get('/student/me')).status).toBe(401);
  });

  it('a tampered or expired student cookie is rejected', async () => {
    const c = new Client();
    await c.studentLogin(PRESENTER_FRESH);
    const tok = c.jar.get('cic_student')!;
    c.jar.set('cic_student', tok.slice(0, -2) + (tok.endsWith('A') ? 'BB' : 'AA'));
    expect((await c.get('/student/me')).status).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const c = new Client();
    await c.studentLogin(PRESENTER_FRESH);
    await c.post('/student/logout');
    expect((await c.get('/student/me')).status).toBe(401);
  });
});

describe('credential pepper rotation', () => {
  const OLD_PEPPER = 'old-credential-pepper-0123456789abcdef-0123456789';
  const rotating = (extra: Record<string, string> = {}) =>
    makeEnv({
      CREDENTIAL_PEPPER_PREVIOUS: OLD_PEPPER,
      CREDENTIAL_KEY_VERSION: '2',
      ...extra,
    });

  /** Re-hashes the presenter's seeded credential with the OLD pepper at the given key version. */
  async function makeLegacy(env: ReturnType<typeof makeEnv>, keyVersion: number) {
    const { parseConfig } = await import('../../src/backend/config');
    const { getMemoryStore } = await import('../../src/backend/repositories/memory-store');
    const { hashAccessCode, normalizeAccessCode } =
      await import('../../src/backend/services/credentials');
    const store: any = await getMemoryStore(parseConfig(env));
    const current = await hashAccessCode(
      normalizeAccessCode(PRESENTER_FRESH)!,
      env.CREDENTIAL_PEPPER!,
    );
    const row = store.credentials.find((c: any) => c.credential_hash === current);
    row.credential_hash = await hashAccessCode(normalizeAccessCode(PRESENTER_FRESH)!, OLD_PEPPER);
    row.key_version = keyVersion;
  }

  it('current-pepper credentials keep working while a previous pepper is configured', async () => {
    expect((await new Client(rotating()).studentLogin(PRESENTER_FRESH)).status).toBe(200);
  });

  it('a credential hashed with the previous pepper at a lower key_version still signs in', async () => {
    const env = rotating();
    await makeLegacy(env, 1);
    expect((await new Client(env).studentLogin(PRESENTER_FRESH)).status).toBe(200);
  });

  it('is rejected once CREDENTIAL_PEPPER_PREVIOUS is removed', async () => {
    const env = rotating();
    await makeLegacy(env, 1);
    const noPrev = { ...env, CREDENTIAL_PEPPER_PREVIOUS: '' };
    // Same store instance (same pepper/version), but the previous pepper is no longer consulted.
    expect((await new Client(noPrev).studentLogin(PRESENTER_FRESH)).status).toBe(401);
  });

  it('a previous-pepper hash at the current key_version is rejected', async () => {
    const env = rotating();
    await makeLegacy(env, 2);
    expect((await new Client(env).studentLogin(PRESENTER_FRESH)).status).toBe(401);
  });
});
