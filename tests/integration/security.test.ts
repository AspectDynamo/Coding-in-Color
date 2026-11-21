/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/backend/config';
import { getMemoryStore } from '../../src/backend/repositories/memory-store';
import { Client, PRESENTER_FRESH, answerAll, dataset, freshState, makeEnv } from './helpers';

beforeEach(freshState);

async function as(role: string, env = makeEnv()) {
  const c = new Client(env);
  expect((await c.staffDemo(role)).status).toBe(200);
  return c;
}

describe('analyst dashboard is always suppressed', () => {
  it('analysts get externalView with suppressed small cohorts whatever `view` says', async () => {
    const env = makeEnv({ SUPPRESSION_THRESHOLD: '100000' });
    const analyst = await as('analyst', env);
    const admin = await as('admin', env);
    for (const q of ['', '?view=internal', '?view=external']) {
      const d = (await analyst.get(`/admin/dashboard${q}`)).body.data;
      expect(d.externalView).toBe(true);
      expect(d.metrics.suppressed).toBe(true);
      expect(d.metrics.averageChangePoints).toBeNull();
      expect(d.cohorts.length).toBeGreaterThan(0);
      expect(d.cohorts.every((c: any) => c.suppressed && c.averageChangePoints === null)).toBe(
        true,
      );
    }
    const internal = (await admin.get('/admin/dashboard?view=internal')).body.data;
    expect(internal.externalView).not.toBe(true);
    expect(internal.metrics.averageChangePoints).not.toBeNull();
  });

  it('explicit external view carries no session activity; analyst view keeps participation-only activity', async () => {
    const admin = await as('admin');
    const analyst = await as('analyst');
    expect((await admin.get('/admin/dashboard')).body.data.recentActivity.length).toBeGreaterThan(
      0,
    );
    expect((await admin.get('/admin/dashboard?view=external')).body.data.recentActivity).toEqual(
      [],
    );
    expect((await analyst.get('/admin/dashboard?view=external')).body.data.recentActivity).toEqual(
      [],
    );
    expect((await analyst.get('/admin/dashboard')).body.data.recentActivity.length).toBeGreaterThan(
      0,
    );
  });
});

describe('practice sessions cannot be used as a score oracle', () => {
  it('/student/progress omits PRACTICE attempts', async () => {
    const d = dataset();
    const env = makeEnv();
    const tempe = d.cohorts.find((c) => c.name.includes('Tempe'))!;
    const pre = d.sessions.find((s) => s.cohort_id === tempe.id && s.stage === 'PRE')!;
    // The API refuses practice on a graded assessment, so seed the legacy overlap straight into the store.
    const store = await getMemoryStore(parseConfig(env));
    const practice = (
      await store.createSession({
        cohortId: tempe.id,
        assessmentId: pre.assessment_id,
        stage: 'PRACTICE',
        title: 'Practice',
        startsAt: null,
        endsAt: null,
        status: 'open',
        createdBy: 'test',
      })
    ).session;

    const s = new Client(env);
    await s.studentLogin(PRESENTER_FRESH);
    const submit = async (sessionId: string) => {
      const detail = (await s.get(`/student/assessments/${sessionId}`)).body.data;
      const start = await s.post(`/student/assessments/${sessionId}/start`);
      return s.post(`/student/assessments/${sessionId}/submit`, {
        attemptId: start.body.data.attemptId,
        assessmentVersion: detail.assessmentVersion,
        responses: answerAll(detail.questions),
      });
    };
    expect((await submit(practice.id)).status).toBe(200);
    expect((await submit(pre.id)).status).toBe(200);
    const progress = (await s.get('/student/progress')).body.data.attempts;
    expect(progress.length).toBe(1);
    expect(progress.map((a: any) => a.stage)).toEqual(['PRE']);
    expect(typeof progress[0].percentageScore).toBe('number');
  });

  it('an assessment cannot be both graded and practice in the same cohort', async () => {
    const d = dataset();
    const tempe = d.cohorts.find((c) => c.name.includes('Mesa'))!;
    const sessions = d.sessions.filter((s) => s.cohort_id === tempe.id);
    const practice = sessions.find((s) => s.stage === 'PRACTICE')!;
    const post = sessions.find((s) => s.stage === 'POST')!;
    const ins = await as('instructor');

    // Practice on an assessment already used for POST.
    const r1 = await ins.post('/instructor/assessment-sessions', {
      cohortId: tempe.id,
      assessmentId: post.assessment_id,
      stage: 'PRACTICE',
    });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toMatch(/graded session/i);
    expect(r1.body.error.details[0]).toMatchObject({
      path: 'assessmentId',
      code: 'practice_graded_conflict',
    });

    // Graded session on an assessment already used for PRACTICE.
    const r2 = await ins.post('/instructor/assessment-sessions', {
      cohortId: tempe.id,
      assessmentId: practice.assessment_id,
      stage: 'RETENTION',
    });
    expect(r2.status).toBe(400);
    expect(r2.body.error.message).toMatch(/practice session/i);

    // Graded-on-graded reuse is not a conflict (Week 3 camp has no practice session).
    const wk3 = d.cohorts.find((c) => c.name.includes('Week 3'))!;
    const wk3Post = d.sessions.find((s) => s.cohort_id === wk3.id && s.stage === 'POST')!;
    const r3 = await (
      await as('admin')
    ).post('/instructor/assessment-sessions', {
      cohortId: wk3.id,
      assessmentId: wk3Post.assessment_id,
      stage: 'POST',
    });
    expect(r3.status).toBe(201);
  });
});

describe('session reopen audit', () => {
  it('reopening a session with submissions writes session.reopen with the submitted count', async () => {
    const d = dataset();
    const tempe = d.cohorts.find((c) => c.name.includes('Tempe'))!;
    const pre = d.sessions.find((s) => s.cohort_id === tempe.id && s.stage === 'PRE')!;
    const ins = await as('instructor');
    const before = (await ins.get(`/instructor/assessment-sessions/${pre.id}`)).body.data;
    expect(before.submittedCount).toBeGreaterThan(0);
    expect(
      (await ins.patch(`/instructor/assessment-sessions/${pre.id}`, { status: 'closed' })).status,
    ).toBe(200);
    expect(
      (await ins.patch(`/instructor/assessment-sessions/${pre.id}`, { status: 'open' })).status,
    ).toBe(200);

    const admin = await as('admin');
    const log = (await admin.get('/admin/audit-log?limit=100')).body.data as any[];
    const reopen = log.filter((e) => e.action === 'session.reopen');
    expect(reopen).toHaveLength(1);
    expect(reopen[0].targetId).toBe(pre.id);
    expect(reopen[0].metadata).toMatchObject({
      submittedAttempts: before.submittedCount,
      previousStatus: 'closed',
    });
  });

  it('closing, or opening a session with no submissions, does not write session.reopen', async () => {
    const ins = await as('instructor');
    const tempe = dataset().cohorts.find((c) => c.name.includes('Tempe'))!;
    const created = (
      await ins.post('/instructor/assessment-sessions', {
        cohortId: tempe.id,
        assessmentId: dataset().sessions.find((s) => s.cohort_id === tempe.id && s.stage === 'PRE')!
          .assessment_id,
        stage: 'PRE',
        openNow: false,
      })
    ).body.data;
    expect(
      (await ins.patch(`/instructor/assessment-sessions/${created.id}`, { status: 'open' })).status,
    ).toBe(200);
    expect(
      (await ins.patch(`/instructor/assessment-sessions/${created.id}`, { status: 'closed' }))
        .status,
    ).toBe(200);
    const log = (await (await as('admin')).get('/admin/audit-log?limit=100')).body.data as any[];
    expect(log.some((e) => e.action === 'session.reopen')).toBe(false);
  });
});

describe('catalog names', () => {
  it('rejects URLs, strips control characters and caps length', async () => {
    const admin = await as('admin');
    const d = dataset();
    const bad = await admin.post('/admin/programs', {
      name: 'Visit https://evil.example/x',
      format: 'camp',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].code).toBe('contains_url');
    expect(
      (await admin.post('/admin/programs', { name: 'Join at www.evil.com now', format: 'camp' }))
        .status,
    ).toBe(400);
    expect(
      (await admin.post('/admin/programs', { name: 'x'.repeat(121), format: 'camp' })).status,
    ).toBe(400);
    expect(
      (await admin.post('/admin/courses', { programId: d.programs[0]!.id, name: 'see evil.io' }))
        .status,
    ).toBe(400);
    const cohort = d.cohorts[0]!;
    expect(
      (
        await admin.post('/admin/cohorts', {
          programId: cohort.program_id,
          courseId: cohort.course_id,
          name: 'http://x.test',
          deliveryMode: 'in_person',
          startDate: '2026-01-01',
          endDate: '2026-02-01',
        })
      ).status,
    ).toBe(400);

    const ok = await admin.post('/admin/programs', {
      name: 'Nice\u0000 \u0007Name\n  Here',
      format: 'camp',
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.name).toBe('Nice Name Here');
  });
});

describe('production data-store safety through the API', () => {
  it('production without Supabase answers 503 not_configured even with DEMO_MODE=true', async () => {
    const c = new Client(makeEnv({ APP_ENV: 'production', DEMO_MODE: 'true' }));
    const r = await c.get('/student/assessments');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('not_configured');
    expect((await c.staffDemo('owner')).status).toBe(503);
    expect((await c.get('/health')).body.data.configured).toBe(false);
  });
  it('an explicitly public synthetic demo still works', async () => {
    const c = new Client(
      makeEnv({ APP_ENV: 'production', DEMO_MODE: 'true', ALLOW_PUBLIC_DEMO: 'true' }),
    );
    expect((await c.staffDemo('owner')).status).toBe(200);
  });
});
