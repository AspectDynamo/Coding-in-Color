import { Hono } from 'hono';
import { z } from 'zod';
import type {
  AttemptStarted,
  StudentAssessmentDetail,
  StudentAssessmentSummary,
  StudentMe,
  StudentProgress,
  SubmitResult,
} from '@shared/api';
import { submitAttemptBody } from '@shared/validation';
import type { AppEnv, StudentAuth } from '../env';
import { requireStudent } from '../middleware/auth';
import { findCredentialForCode, normalizeAccessCode } from '../services/credentials';
import { enforceRateLimit } from '../services/rate-limit';
import { signToken } from '../services/session-token';
import {
  STUDENT_COOKIE,
  clearSessionCookie,
  setSessionCookie,
  studentCookieMaxAge,
} from '../services/cookies';
import { ResponseValidationError, ScoringError, scoreAttempt, toPublicQuestion } from '../scoring';
import type { DataStore, SessionContext } from '../repositories/types';
import {
  HttpError,
  StoreError,
  badRequest,
  conflict,
  invalidCode,
  notFound,
} from '../utils/errors';
import { idParam, ok, parseBody } from '../utils/http';
import { log } from '../utils/logger';

export const studentRoutes = new Hono<AppEnv>();

/** Loose on purpose: malformed codes must answer exactly like unknown codes (401 invalid_code). */
const looseCodeBody = z.object({ code: z.unknown() });

async function buildMe(
  store: DataStore,
  s: {
    id: string;
    public_code: string;
    age_band: StudentMe['ageBand'];
    status: StudentMe['status'];
  },
): Promise<StudentMe> {
  const enrollments = await store.listStudentEnrollments(s.id);
  return {
    publicCode: s.public_code,
    ageBand: s.age_band,
    status: s.status,
    cohorts: enrollments.map((e) => ({
      id: e.cohortId,
      name: e.cohortName,
      programName: e.programName,
    })),
  };
}

/** Session is open: status open and inside the optional window. */
export function isSessionOpen(ctx: SessionContext, now = Date.now()): boolean {
  const { session } = ctx;
  if (session.status !== 'open') return false;
  if (session.starts_at && Date.parse(session.starts_at) > now) return false;
  if (session.ends_at && Date.parse(session.ends_at) < now) return false;
  return true;
}

function requireConsent(student: StudentAuth): void {
  if (student.status === 'pending_consent') {
    throw new HttpError(
      403,
      'consent_required',
      'A grown-up needs to complete a form before you can start.',
    );
  }
}

/** Loads the session, checks consent and enrollment (404 for any outsider). */
async function loadSessionForStudent(
  store: DataStore,
  student: StudentAuth,
  sessionId: string,
): Promise<SessionContext> {
  requireConsent(student);
  const ctx = await store.getSessionContext(sessionId);
  if (!ctx || !(await store.isEnrolled(student.id, ctx.cohort.id)))
    throw notFound('Assessment not found.');
  return ctx;
}

studentRoutes.post('/student/session', async (c) => {
  await enforceRateLimit(c, 'STUDENT_LOGIN_LIMITER');
  const body = await parseBody(c, looseCodeBody);
  const code = typeof body.code === 'string' ? body.code : '';
  // Malformed input answers exactly like an unknown or revoked code.
  const normalized = normalizeAccessCode(code);
  if (!normalized) throw invalidCode();

  const cfg = c.get('config');
  const store = c.get('store');
  const found = await findCredentialForCode(store, normalized, cfg);
  if (!found || found.credential.revoked_at || found.student.status === 'withdrawn')
    throw invalidCode();

  await store.touchCredentialUsed(found.credential.id);
  const token = await signToken(
    { sub: found.student.id, typ: 'student', cid: found.credential.id },
    cfg.sessionSecret,
    studentCookieMaxAge,
  );
  setSessionCookie(c, STUDENT_COOKIE, token, studentCookieMaxAge);
  return ok(c, await buildMe(store, found.student));
});

studentRoutes.post('/student/logout', (c) => {
  clearSessionCookie(c, STUDENT_COOKIE);
  return ok(c, { ok: true });
});

studentRoutes.get('/student/me', requireStudent, async (c) => {
  const store = c.get('store');
  const student = await store.getStudent(c.get('student')!.id);
  if (!student) throw notFound();
  return ok(c, await buildMe(store, student));
});

studentRoutes.get('/student/assessments', requireStudent, async (c) => {
  const student = c.get('student')!;
  requireConsent(student);
  const rows = await c.get('store').listStudentSessions(student.id);
  const now = Date.now();
  const out: StudentAssessmentSummary[] = rows
    .filter(({ context }) => isSessionOpen(context, now))
    .map(({ context, attempt }) => {
      const practice = context.session.stage === 'PRACTICE';
      let state: StudentAssessmentSummary['state'] = 'available';
      if (attempt?.status === 'in_progress') state = 'in_progress';
      else if (attempt?.status === 'submitted' && !practice) state = 'completed';
      return {
        sessionId: context.session.id,
        assessmentId: context.assessment.id,
        title: context.session.title,
        stage: context.session.stage,
        cohortName: context.cohort.name,
        programName: context.cohort.programName,
        estimatedMinutes: context.assessment.estimated_minutes,
        questionCount: context.questionCount,
        state,
        closesAt: context.session.ends_at,
      };
    });
  return ok(c, out);
});

studentRoutes.get('/student/assessments/:sessionId', requireStudent, async (c) => {
  const student = c.get('student')!;
  const store = c.get('store');
  const sessionId = idParam(c, 'sessionId');
  const ctx = await loadSessionForStudent(store, student, sessionId);
  if (!isSessionOpen(ctx))
    throw new HttpError(409, 'session_closed', 'This assessment is not open right now.');

  const questions = (await store.listQuestions(ctx.assessment.id)).filter(
    (q) => q.question_type !== 'project_rubric',
  );
  // Stable per student+session so a refresh (or starting the attempt) never reshuffles ordering items.
  const seed = `${student.id}:${sessionId}`;
  let publicQuestions;
  try {
    publicQuestions = questions.map((q) =>
      toPublicQuestion(
        {
          id: q.id,
          type: q.question_type,
          prompt: q.prompt,
          config: q.config,
          skillCategory: q.skill_category,
          points: q.points,
          order: q.display_order,
        },
        { shuffleSeed: seed },
      ),
    );
  } catch (e) {
    if (e instanceof ScoringError) {
      log('error', 'student.assessment.malformed_question', {
        sessionId,
        questionId: e.questionId,
      });
      throw new HttpError(500, 'internal', 'This assessment is not available right now.');
    }
    throw e;
  }
  publicQuestions.sort((a, b) => a.order - b.order);
  const attempt = await store.getStudentAttempt(student.id, sessionId);
  const dto: StudentAssessmentDetail = {
    sessionId,
    assessmentId: ctx.assessment.id,
    assessmentVersion: ctx.assessment.version,
    title: ctx.session.title,
    description: ctx.assessment.description,
    stage: ctx.session.stage,
    estimatedMinutes: ctx.assessment.estimated_minutes,
    questions: publicQuestions,
    attempt: attempt
      ? { id: attempt.id, status: attempt.status, startedAt: attempt.started_at }
      : null,
  };
  return ok(c, dto);
});

studentRoutes.post('/student/assessments/:sessionId/start', requireStudent, async (c) => {
  const student = c.get('student')!;
  const store = c.get('store');
  const sessionId = idParam(c, 'sessionId');
  const ctx = await loadSessionForStudent(store, student, sessionId);
  if (!isSessionOpen(ctx))
    throw new HttpError(409, 'session_closed', 'This assessment is not open right now.');
  try {
    const { attempt } = await store.startAttempt({
      studentId: student.id,
      session: ctx.session,
      assessment: ctx.assessment,
    });
    const dto: AttemptStarted = { attemptId: attempt.id, startedAt: attempt.started_at };
    return ok(c, dto);
  } catch (e) {
    if (e instanceof StoreError && e.code === 'already_submitted')
      throw conflict('You already finished this assessment.');
    throw e;
  }
});

studentRoutes.post('/student/assessments/:sessionId/submit', requireStudent, async (c) => {
  const student = c.get('student')!;
  const store = c.get('store');
  const sessionId = idParam(c, 'sessionId');
  const body = await parseBody(c, submitAttemptBody);
  const ctx = await loadSessionForStudent(store, student, sessionId);

  // Ownership: the attempt must belong to this student and this session (404 otherwise).
  const attempt = await store.getAttempt(body.attemptId);
  if (
    !attempt ||
    attempt.student_id !== student.id ||
    attempt.assessment_session_id !== sessionId
  ) {
    throw notFound('Attempt not found.');
  }
  if (attempt.status === 'submitted') throw conflict('You already finished this assessment.');
  if (attempt.status !== 'in_progress') throw conflict('This attempt can no longer be submitted.');
  if (!isSessionOpen(ctx))
    throw new HttpError(409, 'session_closed', 'This assessment is not open right now.');
  if (
    body.assessmentVersion !== attempt.assessment_version ||
    attempt.assessment_id !== ctx.assessment.id
  ) {
    throw badRequest('This assessment changed. Reload and try again.', [
      { path: 'assessmentVersion', code: 'mismatch' },
    ]);
  }

  const questions = await store.listQuestionsWithKeys(ctx.assessment.id);
  let scored;
  try {
    scored = scoreAttempt({
      questions: questions.map((q) => ({
        id: q.id,
        type: q.question_type,
        points: q.points,
        skillCategory: q.skill_category,
        config: q.config,
        answerKey: q.answer_key,
      })),
      responses: body.responses,
    });
  } catch (e) {
    if (e instanceof ResponseValidationError) {
      throw badRequest('One or more answers are not valid.', [
        { path: `responses.${e.questionId ?? ''}`, code: e.code },
      ]);
    }
    if (e instanceof ScoringError) {
      log('error', 'student.submit.scoring_error', { sessionId, questionId: e.questionId });
      throw new HttpError(
        500,
        'internal',
        'We could not score this assessment. Please tell your instructor.',
      );
    }
    throw e;
  }

  const durationSeconds = Math.max(
    0,
    Math.round((Date.now() - Date.parse(attempt.started_at)) / 1000),
  );
  try {
    const submitted = await store.submitAttempt({
      attemptId: attempt.id,
      studentId: student.id,
      rawScore: scored.rawScore,
      maxScore: scored.maxScore,
      percentageScore: scored.percentageScore,
      selfReportedConfidence: scored.selfReportedConfidence,
      durationSeconds,
      responses: scored.responses.map((r) => ({
        question_id: r.questionId,
        response_data: r.responseData as unknown as Record<string, unknown>,
        is_correct: r.isCorrect,
        earned_points: r.earnedPoints,
        max_points: r.maxPoints,
      })),
      skills: scored.skills.map((s) => ({
        skill_category: s.skillCategory,
        earned_points: s.earnedPoints,
        max_points: s.maxPoints,
      })),
    });
    const dto: SubmitResult = {
      attemptId: submitted.id,
      submittedAt: submitted.submitted_at ?? new Date().toISOString(),
      answeredCount: scored.answeredCount,
      totalQuestions: questions.filter((q) => q.question_type !== 'project_rubric').length,
      durationSeconds: submitted.duration_seconds ?? durationSeconds,
    };
    return ok(c, dto);
  } catch (e) {
    if (e instanceof StoreError) {
      if (e.code === 'already_submitted') throw conflict('You already finished this assessment.');
      if (e.code === 'attempt_not_found') throw notFound('Attempt not found.');
    }
    throw e;
  }
});

studentRoutes.get('/student/progress', requireStudent, async (c) => {
  const all = await c.get('store').listStudentSubmittedAttempts(c.get('student')!.id);
  // PRACTICE attempts are unlimited and share assessments with graded stages; returning their scores
  // would let a student probe the answer key. Only PRE/POST/RETENTION attempts are listed.
  const attempts = all.filter((a) => a.stage !== 'PRACTICE');
  const dto: StudentProgress = { attempts };
  return ok(c, dto);
});
