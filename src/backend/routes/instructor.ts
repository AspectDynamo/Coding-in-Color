import { Hono, type Context } from 'hono';
import type {
  AssessmentSessionDto,
  CohortDto,
  IssuedCredential,
  SessionProgressDto,
} from '@shared/api';
import { CURRENT_PRIVACY_NOTICE_VERSION } from '@shared/constants';
import {
  createSessionBody,
  issueCredentialsBody,
  reissueCredentialBody,
  updateSessionBody,
} from '@shared/validation';
import type { AppEnv, StaffAuth } from '../env';
import {
  assertProgramAccess,
  programScope,
  requirePermission,
  requireStaff,
} from '../middleware/auth';
import { sessionCsv } from '../analytics';
import {
  formatAccessCode,
  generateAccessCode,
  generatePublicCode,
  hashAccessCode,
} from '../services/credentials';
import { audit } from '../services/audit';
import type { DataStore, SessionContext } from '../repositories/types';
import { HttpError, StoreError, badRequest, forbidden, notFound } from '../utils/errors';
import { idParam, ok, originOf, parseBody } from '../utils/http';

export const instructorRoutes = new Hono<AppEnv>();

// Instructor surface: anyone who may manage sessions or issue cards (instructors, admins, owners).
const needsInstructorAccess = async (c: Context<AppEnv>, next: () => Promise<void>) => {
  const staff = c.get('staff')!;
  if (
    !staff.permissions.includes('sessions.manage') &&
    !staff.permissions.includes('credentials.issue')
  )
    throw forbidden();
  await next();
};
instructorRoutes.use('/instructor/*', requireStaff, needsInstructorAccess);

const roundTo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/** Cohorts the staff member may see (instructors: assigned programs only). */
async function visibleCohorts(store: DataStore, staff: StaffAuth): Promise<CohortDto[]> {
  const all = await store.listCohorts();
  const scope = programScope(staff);
  return scope ? all.filter((c) => scope.includes(c.programId)) : all;
}

async function cohortForStaff(
  store: DataStore,
  staff: StaffAuth,
  cohortId: string,
): Promise<CohortDto> {
  const cohort = await store.getCohort(cohortId);
  if (!cohort) throw notFound('Cohort not found.');
  assertProgramAccess(staff, cohort.programId);
  return cohort;
}

async function sessionForStaff(
  store: DataStore,
  staff: StaffAuth,
  sessionId: string,
): Promise<SessionContext> {
  const ctx = await store.getSessionContext(sessionId);
  if (!ctx) throw notFound('Session not found.');
  assertProgramAccess(staff, ctx.cohort.programId);
  return ctx;
}

export function toSessionDto(ctx: SessionContext, origin: string): AssessmentSessionDto {
  return {
    id: ctx.session.id,
    cohortId: ctx.cohort.id,
    cohortName: ctx.cohort.name,
    programName: ctx.cohort.programName,
    assessmentId: ctx.assessment.id,
    assessmentTitle: ctx.assessment.title,
    stage: ctx.session.stage,
    title: ctx.session.title,
    status: ctx.session.status,
    startsAt: ctx.session.starts_at,
    endsAt: ctx.session.ends_at,
    createdAt: ctx.session.created_at,
    enrolledCount: ctx.enrolledCount,
    submittedCount: ctx.submittedCount,
    joinUrl: `${origin}/s/assess/${ctx.session.id}`,
  };
}

async function buildProgress(c: Context<AppEnv>, ctx: SessionContext): Promise<SessionProgressDto> {
  const store = c.get('store');
  const threshold = c.get('config').suppressionThreshold;
  const data = await store.getSessionProgressData(ctx.session.id);

  let submitted = 0;
  let inProgress = 0;
  const roster = data.roster.map((r) => {
    let status: SessionProgressDto['roster'][number]['status'] = 'not_started';
    if (r.attemptStatus === 'submitted') {
      status = 'submitted';
      submitted += 1;
    } else if (r.attemptStatus === 'in_progress') {
      status = 'in_progress';
      inProgress += 1;
    } else if (r.studentStatus === 'pending_consent') {
      status = 'blocked_consent';
    }
    return { rosterLabel: r.rosterLabel, publicCode: r.publicCode, status };
  });
  const enrolled = roster.length;
  const durations = data.submitted
    .map((s) => s.durationSeconds)
    .filter((d): d is number => d !== null)
    .sort((a, b) => a - b);
  let median: number | null = null;
  if (durations.length) {
    const mid = Math.floor(durations.length / 2);
    median =
      durations.length % 2
        ? durations[mid]!
        : roundTo((durations[mid - 1]! + durations[mid]!) / 2, 0);
  }
  const scores = data.submitted.map((s) => s.percentage);
  const aggregate =
    submitted >= threshold && scores.length >= threshold
      ? {
          averagePercentage: roundTo(scores.reduce((a, b) => a + b, 0) / scores.length, 1),
          n: scores.length,
        }
      : null;

  return {
    session: toSessionDto(
      { ...ctx, enrolledCount: enrolled, submittedCount: submitted },
      originOf(c),
    ),
    enrolled,
    notStarted: Math.max(0, enrolled - submitted - inProgress),
    inProgress,
    submitted,
    completionRate: enrolled > 0 ? roundTo((submitted / enrolled) * 100, 1) : 0,
    medianDurationSeconds: median,
    roster: roster.sort((a, b) =>
      a.rosterLabel.localeCompare(b.rosterLabel, undefined, { numeric: true }),
    ),
    aggregate,
    suppressionThreshold: threshold,
  };
}

/* ---------------------------------------------------------------- reads */

instructorRoutes.get('/instructor/programs', async (c) => {
  const staff = c.get('staff')!;
  const scope = programScope(staff);
  const programs = await c.get('store').listPrograms();
  return ok(c, scope ? programs.filter((p) => scope.includes(p.id)) : programs);
});

instructorRoutes.get('/instructor/cohorts', async (c) => {
  return ok(c, await visibleCohorts(c.get('store'), c.get('staff')!));
});

instructorRoutes.get('/instructor/cohorts/:id/roster', async (c) => {
  const store = c.get('store');
  const cohort = await cohortForStaff(store, c.get('staff')!, idParam(c));
  return ok(c, await store.listRoster(cohort.id));
});

instructorRoutes.get('/instructor/assessments', async (c) => {
  return ok(c, await c.get('store').listAssessments({ status: 'active' }));
});

instructorRoutes.get(
  '/instructor/assessment-sessions',
  requirePermission('sessions.manage'),
  async (c) => {
    const store = c.get('store');
    const staff = c.get('staff')!;
    const cohorts = await visibleCohorts(store, staff);
    const cohortId = c.req.query('cohortId');
    let ids = cohorts.map((x) => x.id);
    if (cohortId) ids = ids.filter((id) => id === cohortId);
    const sessions = ids.length ? await store.listSessions({ cohortIds: ids }) : [];
    sessions.sort((a, b) => b.session.created_at.localeCompare(a.session.created_at));
    const origin = originOf(c);
    return ok(
      c,
      sessions.map((s) => toSessionDto(s, origin)),
    );
  },
);

instructorRoutes.get(
  '/instructor/assessment-sessions/:id',
  requirePermission('sessions.manage'),
  async (c) => {
    const ctx = await sessionForStaff(c.get('store'), c.get('staff')!, idParam(c));
    return ok(c, toSessionDto(ctx, originOf(c)));
  },
);

instructorRoutes.get(
  '/instructor/assessment-sessions/:id/progress',
  requirePermission('sessions.manage'),
  async (c) => {
    const ctx = await sessionForStaff(c.get('store'), c.get('staff')!, idParam(c));
    return ok(c, await buildProgress(c, ctx));
  },
);

instructorRoutes.get(
  '/instructor/assessment-sessions/:id/export.csv',
  requirePermission('sessions.manage'),
  async (c) => {
    const store = c.get('store');
    const staff = c.get('staff')!;
    const ctx = await sessionForStaff(store, staff, idParam(c));
    const progress = await buildProgress(c, ctx);
    await audit(store, {
      actorType: 'staff',
      actorId: staff.id,
      action: 'export.session_csv',
      targetType: 'assessment_session',
      targetId: ctx.session.id,
    });
    return new Response(sessionCsv(progress), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="session-${ctx.session.id}.csv"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
);

/* --------------------------------------------------------------- writes */

instructorRoutes.post(
  '/instructor/assessment-sessions',
  requirePermission('sessions.manage'),
  async (c) => {
    const store = c.get('store');
    const staff = c.get('staff')!;
    const body = await parseBody(c, createSessionBody);
    const cohort = await cohortForStaff(store, staff, body.cohortId);
    const assessment = (await store.listAssessments()).find((a) => a.id === body.assessmentId);
    if (!assessment) throw notFound('Assessment not found.');
    if (assessment.status !== 'active')
      throw badRequest('That assessment is not active.', [
        { path: 'assessmentId', code: 'not_active' },
      ]);
    if (!assessment.intendedStages.includes(body.stage)) {
      throw badRequest('That assessment is not intended for this stage.', [
        { path: 'stage', code: 'stage_not_intended' },
      ]);
    }
    if (assessment.courseId && assessment.courseId !== cohort.courseId) {
      throw badRequest('That assessment belongs to a different course.', [
        { path: 'assessmentId', code: 'course_mismatch' },
      ]);
    }
    if (body.startsAt && body.endsAt && Date.parse(body.endsAt) <= Date.parse(body.startsAt)) {
      throw badRequest('The end time must be after the start time.', [
        { path: 'endsAt', code: 'before_start' },
      ]);
    }
    // A practice session must never reuse an assessment that is also graded (PRE/POST/RETENTION) in the
    // same cohort, and vice versa: unlimited practice attempts would otherwise expose the graded items.
    const wantsPractice = body.stage === 'PRACTICE';
    const clash = (await store.listSessions({ cohortIds: [cohort.id] })).find(
      (s) =>
        s.assessment.id === assessment.id && (s.session.stage === 'PRACTICE') !== wantsPractice,
    );
    if (clash) {
      throw badRequest(
        wantsPractice
          ? 'This assessment is already used for a graded session (pre, post or retention) in this cohort. Choose a different assessment for practice.'
          : 'This assessment is already used for a practice session in this cohort. Choose a different assessment for graded sessions.',
        [{ path: 'assessmentId', code: 'practice_graded_conflict' }],
      );
    }
    const ctx = await store.createSession({
      cohortId: cohort.id,
      assessmentId: assessment.id,
      stage: body.stage,
      title: body.title ?? `${assessment.title} (${body.stage})`,
      startsAt: body.startsAt ?? null,
      endsAt: body.endsAt ?? null,
      status: body.openNow ? 'open' : 'scheduled',
      createdBy: staff.id,
    });
    await audit(store, {
      actorType: 'staff',
      actorId: staff.id,
      action: 'session.create',
      targetType: 'assessment_session',
      targetId: ctx.session.id,
      metadata: { stage: body.stage, status: ctx.session.status },
    });
    return ok(c, toSessionDto(ctx, originOf(c)), 201);
  },
);

instructorRoutes.patch(
  '/instructor/assessment-sessions/:id',
  requirePermission('sessions.manage'),
  async (c) => {
    const store = c.get('store');
    const staff = c.get('staff')!;
    const existing = await sessionForStaff(store, staff, idParam(c));
    const body = await parseBody(c, updateSessionBody);
    // Capture before the update: some stores hand back live rows that the update mutates.
    const previousStatus = existing.session.status;
    const submittedBefore = existing.submittedCount;
    const updated = await store.updateSessionStatus(existing.session.id, body.status);
    if (!updated) throw notFound('Session not found.');
    await audit(store, {
      actorType: 'staff',
      actorId: staff.id,
      action: 'session.update',
      targetType: 'assessment_session',
      targetId: existing.session.id,
      metadata: { status: body.status },
    });
    // Reopening a session that already has submissions is allowed but always leaves a trail.
    if (body.status === 'open' && previousStatus !== 'open' && submittedBefore > 0) {
      await audit(store, {
        actorType: 'staff',
        actorId: staff.id,
        action: 'session.reopen',
        targetType: 'assessment_session',
        targetId: existing.session.id,
        metadata: { previousStatus, submittedAttempts: submittedBefore },
      });
    }
    return ok(c, toSessionDto(updated, originOf(c)));
  },
);

const MAX_ISSUE_ATTEMPTS = 4;

instructorRoutes.post(
  '/instructor/student-credentials',
  requirePermission('credentials.issue'),
  async (c) => {
    const store = c.get('store');
    const cfg = c.get('config');
    const staff = c.get('staff')!;
    const body = await parseBody(c, issueCredentialsBody);
    const cohort = await cohortForStaff(store, staff, body.cohortId);

    if (body.ageBand === 'UNDER_13' && !cfg.allowUnder13) {
      throw forbidden('Registering students under 13 is not enabled for this deployment.');
    }
    const requiresConsent = body.ageBand === 'UNDER_13';

    for (let attempt = 1; attempt <= MAX_ISSUE_ATTEMPTS; attempt++) {
      const publicCodes = new Set<string>();
      const generated: { code: string; hash: string; publicCode: string }[] = [];
      for (let i = 0; i < body.count; i++) {
        let publicCode = generatePublicCode();
        while (publicCodes.has(publicCode)) publicCode = generatePublicCode();
        publicCodes.add(publicCode);
        const code = generateAccessCode();
        generated.push({
          code,
          publicCode,
          hash: await hashAccessCode(code, cfg.credentialPepper),
        });
      }
      try {
        const created = await store.createStudentsWithCredentials({
          cohortId: cohort.id,
          createdBy: staff.id,
          pendingConsentNoticeVersion: requiresConsent ? CURRENT_PRIVACY_NOTICE_VERSION : null,
          students: generated.map((g) => ({
            publicCode: g.publicCode,
            ageBand: body.ageBand,
            status: requiresConsent ? 'pending_consent' : 'active',
            credentialHash: g.hash,
            keyVersion: cfg.keyVersion,
          })),
        });
        const origin = originOf(c);
        const byPublic = new Map(generated.map((g) => [g.publicCode, g.code]));
        const out: IssuedCredential[] = created.map((s) => {
          const formatted = formatAccessCode(byPublic.get(s.publicCode) ?? '');
          return {
            studentId: s.studentId,
            publicCode: s.publicCode,
            rosterLabel: s.rosterLabel,
            cohortName: cohort.name,
            accessCode: formatted,
            accessUrl: `${origin}/s#code=${formatted}`,
            requiresConsent,
          };
        });
        await audit(c.get('store'), {
          actorType: 'staff',
          actorId: staff.id,
          action: 'credentials.issue',
          targetType: 'cohort',
          targetId: cohort.id,
          metadata: { count: out.length, ageBand: body.ageBand },
        });
        return ok(c, out, 201);
      } catch (e) {
        if (
          e instanceof StoreError &&
          (e.code === 'public_code_conflict' || e.code === 'roster_conflict') &&
          attempt < MAX_ISSUE_ATTEMPTS
        )
          continue;
        throw e;
      }
    }
    throw new HttpError(500, 'internal', 'Could not issue credentials. Please try again.');
  },
);

instructorRoutes.post(
  '/instructor/student-credentials/reissue',
  requirePermission('credentials.issue'),
  async (c) => {
    const store = c.get('store');
    const cfg = c.get('config');
    const staff = c.get('staff')!;
    const body = await parseBody(c, reissueCredentialBody);
    const cohort = await cohortForStaff(store, staff, body.cohortId);

    const code = generateAccessCode();
    const seat = await store.reissueCredential({
      cohortId: cohort.id,
      rosterLabel: body.rosterLabel,
      newHash: await hashAccessCode(code, cfg.credentialPepper),
      keyVersion: cfg.keyVersion,
      staffId: staff.id,
      reason: body.reason,
    });
    if (!seat) throw notFound('No student found at that seat.');
    const student = await store.getStudent(seat.studentId);
    const formatted = formatAccessCode(code);
    await audit(store, {
      actorType: 'staff',
      actorId: staff.id,
      action: 'credential.reissue',
      targetType: 'student',
      targetId: seat.studentId,
      metadata: {
        publicCode: seat.publicCode,
        rosterLabel: seat.rosterLabel,
        reason: body.reason,
        cohortId: cohort.id,
      },
    });
    const dto: IssuedCredential = {
      studentId: seat.studentId,
      publicCode: seat.publicCode,
      rosterLabel: seat.rosterLabel,
      cohortName: cohort.name,
      accessCode: formatted,
      accessUrl: `${originOf(c)}/s#code=${formatted}`,
      requiresConsent: student?.status === 'pending_consent',
    };
    return ok(c, dto);
  },
);
