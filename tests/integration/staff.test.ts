/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  PRESENTER_FRESH,
  PRESENTER_POST,
  answerAll,
  dataset,
  freshState,
  makeAiStub,
  makeEnv,
  startFirstAssessment,
} from './helpers';

beforeEach(freshState);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

async function as(role: string, env = makeEnv()) {
  const c = new Client(env);
  const r = await c.staffDemo(role);
  expect(r.status).toBe(200);
  return c;
}

describe('staff auth', () => {
  it('demo login works per role and returns role-correct permissions', async () => {
    for (const role of ['owner', 'admin', 'analyst', 'instructor']) {
      const c = new Client();
      const r = await c.staffDemo(role);
      expect(r.status).toBe(200);
      expect(r.body.data.staff.role).toBe(role);
      const me = await c.get('/auth/me');
      expect(me.body.data.role).toBe(role);
    }
    const analyst = await as('analyst');
    expect((await analyst.get('/auth/me')).body.data.permissions).not.toContain(
      'students.view_individual',
    );
    const owner = await as('owner');
    expect((await owner.get('/auth/me')).body.data.permissions).toContain('staff.manage');
  });

  it('demo login is a 404 unless the store is the memory store; /auth/login is not configured without Supabase', async () => {
    const c = new Client();
    expect((await c.post('/auth/login', { email: 'a@example.org', password: 'x' })).status).toBe(
      503,
    );
    const cfg = await c.get('/config');
    expect(cfg.body.data.demoLoginEnabled).toBe(true);
    expect(cfg.body.data.dataStore).toBe('memory');
  });

  it('data routes answer 503 not_configured without secrets or store', async () => {
    const noSecret = new Client(makeEnv({ SESSION_SECRET: 'short' }));
    expect((await noSecret.get('/student/me')).status).toBe(503);
    expect((await noSecret.get('/health')).status).toBe(200);
    const noStore = new Client(makeEnv({ DEMO_MODE: 'false' }));
    const r = await noStore.get('/student/assessments');
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('not_configured');
    expect((await noStore.staffDemo('owner')).status).toBe(503);
  });

  it('logout clears the staff cookie; password reset always answers ok', async () => {
    const c = await as('admin');
    await c.post('/auth/logout');
    expect((await c.get('/auth/me')).status).toBe(401);
    const r = await new Client().post('/auth/password-reset', { email: 'nobody@example.org' });
    expect(r.body).toEqual({ data: { ok: true } });
  });

  it('mutations need CSRF even for staff', async () => {
    const c = await as('admin');
    expect(
      (await c.post('/admin/programs', { name: 'X Program', format: 'workshop' }, { csrf: false }))
        .status,
    ).toBe(403);
  });
});

describe('authorization', () => {
  it('analyst cannot read individual students; admin can', async () => {
    expect((await (await as('analyst')).get('/admin/students')).status).toBe(403);
    const admin = await as('admin');
    const list = await admin.get('/admin/students?limit=5');
    expect(list.status).toBe(200);
    expect(list.body.page.total).toBeGreaterThan(100);
    const one = await admin.get(`/admin/students/${list.body.data[0].id}`);
    expect(one.status).toBe(200);
    expect(await admin.get('/admin/students/not-a-uuid')).toMatchObject({ status: 404 });
  });

  it('instructors cannot reach admin routes; analysts cannot reach instructor routes', async () => {
    const ins = await as('instructor');
    for (const p of [
      '/admin/dashboard',
      '/admin/staff',
      '/admin/audit-log',
      '/admin/consent',
      '/admin/exports/impact.csv',
    ]) {
      expect((await ins.get(p)).status, p).toBe(403);
    }
    const analyst = await as('analyst');
    expect((await analyst.get('/instructor/cohorts')).status).toBe(403);
    expect((await analyst.get('/admin/staff')).status).toBe(403);
    expect((await (await as('admin')).get('/admin/staff')).status).toBe(403);
    expect((await (await as('owner')).get('/admin/staff')).status).toBe(200);
  });

  it("instructor is forbidden from another program's cohort and sessions", async () => {
    const d = dataset();
    const camp = d.cohorts.find((c) => c.name.includes('Python Game Camp (Week 1)'))!;
    const campSession = d.sessions.find((s) => s.cohort_id === camp.id)!;
    const ins = await as('instructor');
    const visible = (await ins.get('/instructor/cohorts')).body.data;
    expect(visible.map((c: any) => c.id)).not.toContain(camp.id);
    expect((await ins.get(`/instructor/cohorts/${camp.id}/roster`)).status).toBe(403);
    expect((await ins.get(`/instructor/assessment-sessions/${campSession.id}`)).status).toBe(403);
    expect(
      (await ins.get(`/instructor/assessment-sessions/${campSession.id}/progress`)).status,
    ).toBe(403);
    expect(
      (await ins.patch(`/instructor/assessment-sessions/${campSession.id}`, { status: 'closed' }))
        .status,
    ).toBe(403);
    expect(
      (
        await ins.post('/instructor/student-credentials', {
          cohortId: camp.id,
          count: 1,
          ageBand: 'AGE_13_17',
        })
      ).status,
    ).toBe(403);
    // Admins pass.
    expect((await (await as('admin')).get(`/instructor/cohorts/${camp.id}/roster`)).status).toBe(
      200,
    );
  });

  it('privileged-only catalog and consent actions are enforced', async () => {
    const ins = await as('instructor');
    expect((await ins.post('/admin/programs', { name: 'Nope', format: 'camp' })).status).toBe(403);
    const analyst = await as('analyst');
    expect((await analyst.post('/admin/programs', { name: 'Nope', format: 'camp' })).status).toBe(
      403,
    );
    expect(
      (await analyst.get('/admin/assessments/00000000-0000-4000-8000-000000000000')).status,
    ).toBe(403);
  });
});

describe('credentials', () => {
  it('issues credentials (raw code only in the response), under-13 is blocked by default', async () => {
    const ins = await as('instructor');
    const cohort = (await ins.get('/instructor/cohorts')).body.data.find((c: any) =>
      c.name.includes('Tempe'),
    );
    expect(
      (
        await ins.post('/instructor/student-credentials', {
          cohortId: cohort.id,
          count: 2,
          ageBand: 'UNDER_13',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await ins.post('/instructor/student-credentials', {
          cohortId: cohort.id,
          count: 61,
          ageBand: 'AGE_13_17',
        })
      ).status,
    ).toBe(400);
    const before = (await ins.get(`/instructor/cohorts/${cohort.id}/roster`)).body.data.length;
    const r = await ins.post('/instructor/student-credentials', {
      cohortId: cohort.id,
      count: 3,
      ageBand: 'AGE_13_17',
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toHaveLength(3);
    const [first] = r.body.data;
    expect(first.accessCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
    expect(first.accessUrl).toBe(`http://localhost/s#code=${first.accessCode}`);
    expect(first.publicCode).toMatch(/^S-/);
    const roster = (await ins.get(`/instructor/cohorts/${cohort.id}/roster`)).body.data;
    expect(roster.length).toBe(before + 3);
    expect(JSON.stringify(roster)).not.toContain(first.accessCode);
    // The new code signs in.
    expect((await new Client().studentLogin(first.accessCode)).status).toBe(200);
    // Audit has the count, never the code.
    const audit = (await (await as('owner')).get('/admin/audit-log?limit=50')).body.data;
    const entry = audit.find((a: any) => a.action === 'credentials.issue');
    expect(entry.metadata.count).toBe(3);
    expect(JSON.stringify(audit)).not.toContain(first.accessCode);
  });

  it('under-13 issuance creates pending-consent students when enabled; they get consent_required', async () => {
    const env = makeEnv({ ALLOW_UNDER_13_REGISTRATION: 'true' });
    const ins = await as('instructor', env);
    const cohort = (await ins.get('/instructor/cohorts')).body.data.find((c: any) =>
      c.name.includes('Tempe'),
    );
    const r = await ins.post('/instructor/student-credentials', {
      cohortId: cohort.id,
      count: 1,
      ageBand: 'UNDER_13',
    });
    expect(r.status).toBe(201);
    expect(r.body.data[0].requiresConsent).toBe(true);
    const s = new Client(env);
    expect((await s.studentLogin(r.body.data[0].accessCode)).body.data.status).toBe(
      'pending_consent',
    );
    const list = await s.get('/student/assessments');
    expect(list.status).toBe(403);
    expect(list.body.error.code).toBe('consent_required');
    // Admin grants consent: student can proceed.
    const admin = await as('admin', env);
    const pending = await admin.get('/admin/consent?status=pending');
    expect(pending.body.data.length).toBeGreaterThan(0);
    const rec = await admin.post('/admin/consent', {
      studentId: r.body.data[0].studentId,
      consentStatus: 'granted',
      verificationMethod: 'signed_form',
      noticeVersion: '2026-11-v1',
      guardianContact: { method: 'email', value: 'guardian@example.org' },
    });
    expect(rec.status).toBe(201);
    expect(rec.body.data.hasGuardianContact).toBe(true);
    expect(JSON.stringify(rec.body)).not.toContain('guardian@example.org');
    expect(JSON.stringify((await admin.get('/admin/consent')).body)).not.toContain(
      'guardian@example.org',
    );
    expect((await s.get('/student/assessments')).status).toBe(200);
    // Withdrawing consent blocks the student again.
    await admin.post(`/admin/consent/${rec.body.data.id}/withdraw`);
    expect((await s.get('/student/me')).status).toBe(401);
  });
});

describe('dashboard, exports and AI', () => {
  it('dashboard n equals matched pairs and filters change the result', async () => {
    const d = dataset();
    // Independent matched-pair count straight from the dataset.
    const fam = (id: string) => d.assessments.find((a) => a.id === id)!.form_family;
    const sub = d.attempts.filter((a) => a.status === 'submitted' && a.submitted_at);
    const expected = new Set<string>();
    for (const pre of sub.filter((a) => a.stage === 'PRE')) {
      if (
        sub.some(
          (p) =>
            p.stage === 'POST' &&
            p.student_id === pre.student_id &&
            p.cohort_id === pre.cohort_id &&
            fam(p.assessment_id) === fam(pre.assessment_id) &&
            Date.parse(p.submitted_at!) > Date.parse(pre.submitted_at!),
        )
      ) {
        expected.add(`${pre.student_id}|${pre.cohort_id}|${fam(pre.assessment_id)}`);
      }
    }
    const admin = await as('admin');
    const all = (await admin.get('/admin/dashboard')).body.data;
    expect(all.metrics.n).toBe(all.kpis.matchedPairs);
    expect(all.kpis.matchedPairs).toBe(expected.size);
    expect(all.externalView).not.toBe(true);

    const cohort = d.cohorts[0]!;
    const one = (await admin.get(`/admin/dashboard?cohortId=${cohort.id}`)).body.data;
    expect(one.kpis.matchedPairs).toBeGreaterThan(0);
    expect(one.kpis.matchedPairs).toBeLessThan(all.kpis.matchedPairs);
    const program = (await admin.get(`/admin/dashboard?programId=${cohort.program_id}`)).body.data;
    expect(program.kpis.matchedPairs).toBeGreaterThanOrEqual(one.kpis.matchedPairs);
    expect(program.kpis.matchedPairs).toBeLessThan(all.kpis.matchedPairs);
    const skill = (await admin.get('/admin/dashboard?skill=loops')).body.data;
    expect(skill.filters.skill).toBe('loops');
    expect((await admin.get('/admin/dashboard?cohortId=nope')).status).toBe(400);
    expect((await (await as('analyst')).get('/admin/dashboard')).status).toBe(200);
    const ext = (await admin.get('/admin/dashboard?view=external')).body.data;
    expect(ext.externalView).toBe(true);
    const filters = (await admin.get('/admin/filters')).body.data;
    expect(filters.cohorts.length).toBe(d.cohorts.length);
  });

  it('a withdrawn student is excluded from every analytic and export, and the record is kept', async () => {
    const d = dataset();
    const fam = (id: string) => d.assessments.find((a) => a.id === id)!.form_family;
    const sub = d.attempts.filter(
      (a) => a.status === 'submitted' && a.submitted_at && a.stage !== 'PRACTICE',
    );
    const pairsOf = (studentId: string) => {
      const mine = sub.filter((a) => a.student_id === studentId);
      return new Set(
        mine
          .filter(
            (pre) =>
              pre.stage === 'PRE' &&
              mine.some(
                (p) =>
                  p.stage === 'POST' &&
                  p.cohort_id === pre.cohort_id &&
                  fam(p.assessment_id) === fam(pre.assessment_id) &&
                  Date.parse(p.submitted_at!) > Date.parse(pre.submitted_at!),
              ),
          )
          .map((pre) => `${pre.cohort_id}|${fam(pre.assessment_id)}`),
      );
    };
    // A student with one seat, exactly one matched pair, one PRE and one POST completion.
    const stage = (studentId: string, st: string) =>
      sub.filter((a) => a.student_id === studentId && a.stage === st).length;
    const victim = d.students.find(
      (s) =>
        pairsOf(s.id).size === 1 &&
        stage(s.id, 'PRE') === 1 &&
        stage(s.id, 'POST') === 1 &&
        d.cohortStudents.filter((cs) => cs.student_id === s.id).length === 1,
    )!;
    expect(victim).toBeDefined();
    const retention = stage(victim.id, 'RETENTION');
    const preAttempt = sub.find((a) => a.student_id === victim.id && a.stage === 'PRE')!;
    const cohortId = preAttempt.cohort_id;
    const cohortSession = d.sessions.find((x) => x.id === preAttempt.assessment_session_id)!;

    const admin = await as('admin');
    const ins = await as('instructor');
    const snap = async () => {
      const all = (await admin.get('/admin/dashboard')).body.data;
      const one = (await admin.get(`/admin/dashboard?cohortId=${cohortId}`)).body.data;
      const csv = (await admin.get('/admin/exports/impact.csv')).body as string;
      const progress = (
        await ins.get(`/instructor/assessment-sessions/${cohortSession.id}/progress`)
      ).body.data;
      const cohorts = (await admin.get('/admin/cohorts')).body.data as any[];
      return { all, one, csv, progress, cohort: cohorts.find((c) => c.id === cohortId) };
    };
    const csvOverall = (csv: string) => {
      const line = csv.split(/\r?\n/).find((l) => l.startsWith('overall,'))!;
      const cells = line.split(',');
      return { enrolled: Number(cells[4]), matched: Number(cells[5]) };
    };

    const before = await snap();
    const trendMatched = (x: any) => x.trend.reduce((n: number, t: any) => n + t.matched, 0);
    expect(before.all.kpis.matchedPairs).toBeGreaterThanOrEqual(10); // not suppressed in the CSV
    expect(before.cohort.enrolledCount).toBe(before.one.kpis.enrolledStudents);

    expect((await admin.post(`/admin/students/${victim.id}/withdraw`)).status).toBe(200);
    const after = await snap();

    // Dashboard (all scope): totals, enrolled, completions, pairs, trend.
    expect(after.all.kpis.matchedPairs).toBe(before.all.kpis.matchedPairs - 1);
    expect(after.all.metrics.n).toBe(before.all.metrics.n - 1);
    expect(after.all.kpis.enrolledStudents).toBe(before.all.kpis.enrolledStudents - 1);
    expect(after.all.kpis.totalStudentRecords).toBe(before.all.kpis.totalStudentRecords - 1);
    expect(after.all.kpis.preCompletions).toBe(before.all.kpis.preCompletions - 1);
    expect(after.all.kpis.postCompletions).toBe(before.all.kpis.postCompletions - 1);
    expect(after.all.kpis.retentionCompletions).toBe(
      before.all.kpis.retentionCompletions - retention,
    );
    expect(trendMatched(after.all)).toBe(trendMatched(before.all) - 1);

    // Cohort scope and the cohort comparison row.
    expect(after.one.kpis.matchedPairs).toBe(before.one.kpis.matchedPairs - 1);
    expect(after.one.kpis.enrolledStudents).toBe(before.one.kpis.enrolledStudents - 1);
    const row = (x: any) => x.all.cohorts.find((c: any) => c.cohortId === cohortId);
    expect(row(after).matched).toBe(row(before).matched - 1);
    expect(row(after).enrolled).toBe(row(before).enrolled - 1);
    expect(after.cohort.enrolledCount).toBe(before.cohort.enrolledCount - 1);

    // Impact export mirrors the dashboard.
    expect(csvOverall(after.csv)).toEqual({
      enrolled: csvOverall(before.csv).enrolled - 1,
      matched: csvOverall(before.csv).matched - 1,
    });
    expect(after.csv).toContain(`matched pairs=${after.all.kpis.matchedPairs};`);
    expect(before.csv).toContain(`matched pairs=${before.all.kpis.matchedPairs};`);

    // Session progress (and the session CSV, which is built from it).
    expect(after.progress.enrolled).toBe(before.progress.enrolled - 1);
    expect(after.progress.submitted).toBe(before.progress.submitted - 1);
    expect(after.progress.roster).toHaveLength(before.progress.roster.length - 1);

    // The record itself is kept: still listed and readable by an admin, status shown as-is.
    const hist = await admin.get(`/admin/students/${victim.id}`);
    expect(hist.status).toBe(200);
    expect(hist.body.data.student.status).toBe('withdrawn');
    const roster = (await ins.get(`/instructor/cohorts/${cohortId}/roster`)).body.data as any[];
    expect(roster.find((r) => r.studentId === victim.id)?.status).toBe('withdrawn');
  });

  it('end to end: presenter submissions show up in instructor progress and the dashboard', async () => {
    const d = dataset();
    const admin = await as('admin');
    const tempe = d.cohorts.find((c) => c.name.includes('Tempe'))!;
    const ai = d.cohorts.find((c) => c.name.includes('Building with AI'))!;
    const dash = async (id: string) =>
      (await admin.get(`/admin/dashboard?cohortId=${id}`)).body.data;
    const before = { tempe: await dash(tempe.id), ai: await dash(ai.id) };

    const ins = await as('instructor');
    const tempeSession = d.sessions.find((s) => s.cohort_id === tempe.id && s.stage === 'PRE')!;
    const progBefore = (
      await ins.get(`/instructor/assessment-sessions/${tempeSession.id}/progress`)
    ).body.data;

    // Presenter takes the PRE.
    const s1 = new Client();
    await s1.studentLogin(PRESENTER_FRESH);
    const a1 = await startFirstAssessment(s1);
    const mid = (await ins.get(`/instructor/assessment-sessions/${tempeSession.id}/progress`)).body
      .data;
    expect(mid.inProgress).toBe(progBefore.inProgress + 1);
    expect(
      (
        await s1.post(`/student/assessments/${a1.sessionId}/submit`, {
          attemptId: a1.attemptId,
          assessmentVersion: a1.detail.assessmentVersion,
          responses: answerAll(a1.detail.questions),
        })
      ).status,
    ).toBe(200);
    const progAfter = (await ins.get(`/instructor/assessment-sessions/${tempeSession.id}/progress`))
      .body.data;
    expect(progAfter.submitted).toBe(progBefore.submitted + 1);
    expect(progAfter.roster.find((r: any) => r.rosterLabel === '07').status).toBe('submitted');
    expect(Object.keys(progAfter.roster[0]).sort()).toEqual([
      'publicCode',
      'rosterLabel',
      'status',
    ]);

    // Presenter with an existing PRE takes the POST -> a new matched pair.
    const s2 = new Client();
    await s2.studentLogin(PRESENTER_POST);
    const a2 = await startFirstAssessment(s2);
    expect(a2.summary.stage).toBe('POST');
    expect(
      (
        await s2.post(`/student/assessments/${a2.sessionId}/submit`, {
          attemptId: a2.attemptId,
          assessmentVersion: a2.detail.assessmentVersion,
          responses: answerAll(a2.detail.questions),
        })
      ).status,
    ).toBe(200);

    const after = { tempe: await dash(tempe.id), ai: await dash(ai.id) };
    expect(after.tempe.kpis.preCompletions).toBe(before.tempe.kpis.preCompletions + 1);
    expect(after.ai.kpis.postCompletions).toBe(before.ai.kpis.postCompletions + 1);
    expect(after.ai.kpis.matchedPairs).toBe(before.ai.kpis.matchedPairs + 1);
  });

  it('AI payload has no identifiers; success is stored; failures fall back to a template with 503', async () => {
    const stub = makeAiStub('ok');
    const admin = await as('admin', makeEnv({ AI: stub }));
    const body = { reportType: 'program_impact', filters: {} };
    const ok = await admin.post('/admin/reports/summarize', body);
    expect(ok.status).toBe(200);
    expect(ok.body.data.generationMode).toBe('ai');
    expect(ok.body.data.validation.passed).toBe(true);
    expect(stub.calls).toHaveLength(1);
    const sent = JSON.stringify(stub.calls[0]!.input);
    expect(sent).not.toMatch(UUID);
    expect(sent).not.toMatch(/S-[0-9A-Z]{6}/);
    expect(sent).not.toMatch(/[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}/);
    expect((stub.calls[0]!.input as any).response_format.type).toBe('json_schema');

    // save + list + delete
    const id = ok.body.data.id;
    expect((await admin.get('/admin/reports')).body.data).toHaveLength(0);
    expect((await admin.post(`/admin/reports/${id}/save`)).body.data.saved).toBe(true);
    expect((await admin.get('/admin/reports')).body.data).toHaveLength(1);
    expect((await admin.del(`/admin/reports/${id}`)).status).toBe(200);
    expect((await admin.get('/admin/reports')).body.data).toHaveLength(0);

    for (const mode of ['throw', 'garbage'] as const) {
      const c = await as('admin', makeEnv({ AI: makeAiStub(mode) }));
      const r = await c.post('/admin/reports/summarize', body);
      expect(r.status, mode).toBe(503);
      expect(r.body.error.code).toBe('ai_unavailable');
      expect(r.body.error.details.fallback.generationMode).toBe('template');
      expect(r.body.error.details.fallback.content.headline.length).toBeGreaterThan(0);
    }
    const noAi = await as('admin');
    const r = await noAi.post('/admin/reports/summarize', body);
    expect(r.status).toBe(503);
    expect(r.body.error.details.fallback.generationMode).toBe('template');
  });

  it('AI generation is rate limited per staff member and needs reports.ai', async () => {
    const admin = await as('admin', makeEnv({ AI: makeAiStub('ok') }));
    let last = 0;
    for (let i = 0; i < 8; i++)
      last = (
        await admin.post('/admin/reports/summarize', { reportType: 'board_summary', filters: {} })
      ).status;
    expect(last).toBe(429);
    const ins = await as('instructor', makeEnv({ AI: makeAiStub('ok') }));
    expect(
      (await ins.post('/admin/reports/summarize', { reportType: 'board_summary', filters: {} }))
        .status,
    ).toBe(403);
  });

  it('CSV exports are suppressed, audited and defuse formula injection', async () => {
    const admin = await as('owner');
    const prog = (
      await admin.post('/admin/programs', {
        name: '=HYPERLINK("evil")',
        description: '',
        format: 'workshop',
      })
    ).body.data;
    const course = (
      await admin.post('/admin/courses', { programId: prog.id, name: '@SUM(A1)', description: '' })
    ).body.data;
    const lead = (await admin.get('/admin/staff')).body.data.find(
      (s: any) => s.role === 'instructor',
    ).id;
    const cohort = await admin.post('/admin/cohorts', {
      programId: prog.id,
      courseId: course.id,
      name: '+cmd|calc',
      deliveryMode: 'remote',
      startDate: '2026-01-01',
      endDate: '2026-02-01',
      leadInstructorId: lead,
    });
    expect(cohort.status).toBe(201);

    for (const path of ['/admin/exports/impact.csv', '/admin/exports/skills.csv']) {
      const r = await admin.get(path);
      expect(r.status).toBe(200);
      expect(r.res.headers.get('content-type')).toMatch(/text\/csv/);
      expect(r.res.headers.get('content-disposition')).toMatch(/attachment/);
      expect(r.body).not.toMatch(UUID);
      const cells = (r.body as string).split(/\r?\n/).flatMap((l) => l.split(','));
      expect(
        cells
          .filter((c) => /^"?[=@+]/.test(c))
          .filter((c) => !c.startsWith("'") && !c.startsWith('"\'')),
      ).toEqual([]);
    }
    const impact = (await admin.get('/admin/exports/impact.csv')).body as string;
    expect(impact).toContain("'=HYPERLINK");
    expect(impact).toContain('suppressed');
    // A small cohort never leaks values: new cohort has zero matched pairs.
    const small = (await admin.get(`/admin/exports/impact.csv?cohortId=${cohort.body.data.id}`))
      .body as string;
    expect(
      small
        .split(/\r?\n/)
        .filter((l) => !l.includes('#'))
        .join('\n'),
    ).not.toMatch(/\d+\.\d/);
    const log = (await admin.get('/admin/audit-log?limit=20')).body.data.map((a: any) => a.action);
    expect(log).toContain('export.impact_csv');
    expect((await (await as('instructor')).get('/admin/exports/impact.csv')).status).toBe(403);

    // Session CSV (instructor): aggregate only.
    const ins = await as('instructor');
    const session = dataset().sessions.find((s) => s.status === 'open')!;
    const csv = await ins.get(`/instructor/assessment-sessions/${session.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.body).not.toMatch(/S-[0-9A-Z]{6}/);
  });
});

describe('catalog and staff admin', () => {
  it('validates assessments per question type and stores answer keys server-side only', async () => {
    const admin = await as('admin');
    const good = {
      courseId: null,
      formFamily: 'test-family',
      formLabel: 'A',
      title: 'Test assessment A',
      description: '',
      difficulty: 'intro',
      estimatedMinutes: 5,
      intendedStages: ['PRE', 'POST'],
      questions: [
        {
          questionType: 'multiple_choice',
          prompt: 'Pick the right one',
          config: {
            options: [
              { id: 'a', label: 'A' },
              { id: 'b', label: 'B' },
            ],
          },
          answerKey: { correctOptionId: 'a' },
          skillCategory: 'loops',
          difficulty: 'intro',
          points: 1,
        },
        {
          questionType: 'confidence_likert',
          prompt: 'How confident are you?',
          config: {},
          answerKey: null,
          skillCategory: 'loops',
          difficulty: 'intro',
          points: 0,
        },
      ],
    };
    const bad = structuredClone(good);
    (bad.questions[0] as any).answerKey = { correctOptionId: 'zzz' };
    expect((await admin.post('/admin/assessments', bad)).status).toBe(400);
    const created = await admin.post('/admin/assessments', good);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('draft');
    const detail = await admin.get(`/admin/assessments/${created.body.data.id}`);
    expect(detail.body.data.questions[0].answerKey).toEqual({ correctOptionId: 'a' });
    expect(
      (await admin.patch(`/admin/assessments/${created.body.data.id}`, { status: 'active' })).body
        .data.status,
    ).toBe('active');
    const v2 = await admin.post('/admin/assessments', good);
    expect(v2.body.data.version).toBe(2);
    expect(
      (await admin.post('/admin/assessments', { ...good, formFamily: 'Bad Family' })).status,
    ).toBe(400);
  });

  it('withdraw and hard delete a student (audited with the public code only)', async () => {
    const admin = await as('admin');
    const list = (await admin.get('/admin/students?limit=1')).body.data[0];
    const code = list.publicCode;
    expect((await admin.post(`/admin/students/${list.id}/withdraw`)).status).toBe(200);
    expect((await admin.get(`/admin/students/${list.id}`)).body.data.student.status).toBe(
      'withdrawn',
    );
    expect((await admin.del(`/admin/students/${list.id}`)).status).toBe(200);
    expect((await admin.get(`/admin/students/${list.id}`)).status).toBe(404);
    const audit = (await admin.get('/admin/audit-log?limit=10')).body.data;
    const del = audit.find((a: any) => a.action === 'student.delete');
    expect(del.metadata.publicCode).toBe(code);
  });

  it('owner invites and updates staff; cannot change self', async () => {
    const owner = await as('owner');
    const me = (await owner.get('/auth/me')).body.data;
    const invited = await owner.post('/admin/staff', {
      email: 'new@example.org',
      displayName: 'New Person',
      role: 'analyst',
      programIds: [],
    });
    expect(invited.status).toBe(201);
    expect(invited.body.data.status).toBe('invited');
    expect(JSON.stringify(invited.body)).not.toContain('new@example.org');
    expect(
      (await owner.patch(`/admin/staff/${invited.body.data.id}`, { status: 'disabled' })).body.data
        .status,
    ).toBe('disabled');
    expect((await owner.patch(`/admin/staff/${me.id}`, { role: 'analyst' })).status).toBe(403);
    expect(
      (
        await owner.post('/admin/staff', {
          email: 'x@example.org',
          displayName: 'X',
          role: 'instructor',
          programIds: [crypto.randomUUID()],
        })
      ).status,
    ).toBe(400);
  });

  it('unknown API routes return the JSON 404 envelope and security headers are present', async () => {
    const c = new Client();
    const r = await c.get('/nope/nothing');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_found');
    expect(r.res.headers.get('cache-control')).toBe('no-store');
    expect(r.res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.res.headers.get('x-request-id')).toBeTruthy();
    const bad = await (await as('admin')).post('/admin/programs', { name: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('bad_request');
    expect(JSON.stringify(bad.body.error.details)).not.toContain('"x"');
  });
});
