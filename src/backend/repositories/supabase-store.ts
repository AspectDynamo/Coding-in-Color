/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SupabaseStore: the DataStore over Supabase Postgres using supabase-js (PostgREST) with the
 * SERVICE ROLE key, which bypasses RLS. The Worker (routes/middleware) is the authorization layer;
 * this class performs no authorization. Only the parameterized query builder and rpc() are used
 * (never string-built SQL, never `.or()` / `.filter()` strings). Error messages deliberately carry
 * only the operation name, SQLSTATE and HTTP status: PostgREST details can echo row values
 * (hashes, codes), so they are never propagated or logged.
 *
 *  - `question_answer_keys` is read ONLY in listQuestionsWithKeys / getAssessmentDetail(…, true);
 *  - guardian contact values are write-only here (`contact_value` is never selected);
 *  - atomic multi-row writes use SQL functions (submit_attempt, reissue_credential); multi-step
 *    inserts (credential batches, assessments) clean up on failure by deleting what they created;
 *  - every embedded resource names its foreign key explicitly (`table!fk_constraint(...)`). Several
 *    tables are connected by more than one path (e.g. cohort_students <-> students directly AND via
 *    assessment_attempts), which PostgREST otherwise rejects as ambiguous (PGRST201);
 *  - PostgREST caps responses (default 1000 rows): unbounded reads page with range(), and `.in()`
 *    lists are chunked so URLs stay short;
 *  - timestamps come back as `+00:00` (not `Z`) and numerics may be strings: every row is
 *    normalized to ISO `Z` strings / numbers so output matches MemoryStore.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AiReportDto,
  AssessmentDetailDto,
  AssessmentSummaryDto,
  AuditEntryDto,
  CohortDto,
  ConsentDto,
  CourseDto,
  ProgramDto,
  RecentActivityItem,
  RosterEntryDto,
  StaffDto,
  StudentHistory,
  StudentListItem,
} from '@shared/api';
import type {
  AiReportRow,
  AssessmentAttemptRow,
  AssessmentRow,
  AssessmentSessionRow,
  ConsentRecordRow,
  MatchedPairRow,
  QuestionRow,
  StaffUserRow,
  StudentCredentialRow,
  StudentRow,
} from '@shared/db';
import type { AssessmentStage, ConsentStatus, StaffRole, StudentStatus } from '@shared/types';
import type { AppConfig } from '../config';
import { StoreError } from '../utils/errors';
import type {
  AttemptStartInput,
  AuditAppendInput,
  ConsentWriteInput,
  CreatedStudent,
  DataStore,
  NewAiReportInput,
  NewAssessmentInput,
  NewStaffInput,
  Page,
  QuestionWithKey,
  SessionContext,
  SessionProgressData,
  StudentEnrollment,
  SubmitAttemptInput,
} from './types';

/** PostgREST returns at most this many rows per request by default (Supabase: db-max-rows = 1000). */
const PAGE = 1000;
/** ids per `.in()` list: 100 uuids is ~3.7 KB of URL. */
const IN_CHUNK = 100;

/**
 * SQLSTATEs raised by supabase/migrations (see 0001/0002):
 *  CI001 attempt_not_found, CI002 already_submitted, CI003 attempt_not_in_progress,
 *  CI004 invalid_payload, CI005 attempt_immutable, CI006 question_not_in_assessment,
 *  CI007 max_points_mismatch, CI008 audit_log_append_only, CI010 student_not_found.
 */
const SQLSTATE = {
  attemptNotFound: 'CI001',
  alreadySubmitted: 'CI002',
  attemptNotInProgress: 'CI003',
  studentNotFound: 'CI010',
  unique: '23505',
  foreignKey: '23503',
} as const;

/**
 * Foreign-key constraint names used as embed hints. Verified against the migrations applied to a
 * real Postgres (auto-generated `<table>_<column>_fkey` names plus the explicitly named ones).
 */
const FK = {
  cohortProgram: 'cohorts_program_id_fkey',
  cohortCourse: 'cohorts_course_program_fk',
  cohortLead: 'cohorts_lead_instructor_id_fkey',
  credentialStudent: 'student_credentials_student_id_fkey',
  enrollmentCohort: 'cohort_students_cohort_id_fkey',
  enrollmentStudent: 'cohort_students_student_id_fkey',
  attemptStudent: 'assessment_attempts_student_id_fkey',
  consentStudent: 'consent_records_student_id_fkey',
  questionAssessment: 'questions_assessment_id_fkey',
} as const;

class DbError extends Error {
  constructor(
    public readonly op: string,
    public readonly sqlState: string,
    public readonly httpStatus?: number,
  ) {
    super(`db_error:${op}:${sqlState}${httpStatus ? `:${httpStatus}` : ''}`);
    this.name = 'DbError';
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
/** Deduplicated, uuid-shaped ids only (anything else can never match a row and must not reach `.in()`). */
const uuids = (xs: readonly unknown[]): string[] => [...new Set(xs.filter(isUuid))];

const chunk = <T>(xs: T[], n = IN_CHUNK): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const nowIso = () => new Date().toISOString();
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const r2 = (n: number) => Math.round(n * 100) / 100;
const isUnique = (e: { code?: string } | null | undefined) => e?.code === SQLSTATE.unique;
const ms = (iso: string | null | undefined) => Date.parse(iso ?? '');

/** PostgREST `2026-11-15T17:00:00.5+00:00` -> `2026-11-15T17:00:00.500Z`. Unparseable input is returned as is. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? String(v) : new Date(t).toISOString();
}
function normTs<T>(r: any, keys: readonly string[]): T {
  const out = { ...r };
  for (const k of keys) if (k in out) out[k] = iso(out[k]);
  return out as T;
}

function ok<T>(res: { data: T | null; error: any; status?: number }, op: string): T {
  if (res.error) throw new DbError(op, String(res.error.code || 'unknown'), res.status);
  return res.data as T;
}

/* ---- row mappers: timestamps -> ISO Z, numerics -> numbers ---- */
const studentRow = (r: any): StudentRow => normTs<StudentRow>(r, ['created_at', 'updated_at']);
const credentialRow = (r: any): StudentCredentialRow =>
  normTs<StudentCredentialRow>(r, ['created_at', 'revoked_at', 'last_used_at']);
const sessionRow = (r: any): AssessmentSessionRow =>
  normTs<AssessmentSessionRow>(r, ['starts_at', 'ends_at', 'created_at']);
const staffRow = (r: any): StaffUserRow => normTs<StaffUserRow>(r, ['created_at', 'last_login_at']);
const assessmentRow = (r: any): AssessmentRow => ({
  ...normTs<AssessmentRow>(r, ['created_at']),
  version: num(r.version),
  estimated_minutes: num(r.estimated_minutes),
});
const consentRow = (r: any) =>
  normTs<any>(r, ['consent_timestamp', 'withdrawal_timestamp', 'created_at']);
const reportRow = (r: any): AiReportRow => normTs<AiReportRow>(r, ['created_at']);
function attemptRow(r: any): AssessmentAttemptRow {
  return {
    ...normTs<AssessmentAttemptRow>(r, ['started_at', 'submitted_at', 'created_at']),
    raw_score: numOrNull(r.raw_score),
    max_score: numOrNull(r.max_score),
    percentage_score: numOrNull(r.percentage_score),
    self_reported_confidence: numOrNull(r.self_reported_confidence),
    assessment_version: num(r.assessment_version),
    duration_seconds: numOrNull(r.duration_seconds),
  };
}
function questionRow(r: any): QuestionRow {
  return { ...r, points: num(r.points) };
}

/** in_progress attempt if any, else the latest submitted one (same rule as MemoryStore). */
function pickAttempt(rows: AssessmentAttemptRow[]): AssessmentAttemptRow | null {
  return (
    rows.find((a) => a.status === 'in_progress') ??
    rows
      .filter((a) => a.status === 'submitted')
      .sort((a, b) => ms(b.submitted_at) - ms(a.submitted_at))[0] ??
    null
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'program'
  );
}

/** 'YYYY-MM-DD' -> start-of-day UTC ms; throws a DbError-shaped failure for anything else. */
function utcDayStart(op: string, d: string): number {
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00.000Z`) : Number.NaN;
  if (Number.isNaN(t)) throw new DbError(op, '22007');
  return t;
}

export class SupabaseStore implements DataStore {
  readonly kind = 'supabase' as const;
  private db: SupabaseClient<any, 'public', any>;

  /** `opts.fetch` exists for tests (request-shape assertions); production uses the global fetch. */
  constructor(url: string, serviceKey: string, opts?: { fetch?: typeof fetch }) {
    this.db = createClient<any, 'public', any>(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(opts?.fetch ? { global: { fetch: opts.fetch } } : {}),
    });
  }

  /** Reads every row of a query by paging with range(). `build` must return a fresh, ordered query. */
  private async all<T = any>(op: string, build: () => any): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = ok<T[]>(await build().range(from, from + PAGE - 1), op) ?? [];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return out;
  }

  /** Pages through `build(part)` for each chunk of ids. Each query must be ordered (stable paging). */
  private async allIn<T = any>(
    op: string,
    ids: readonly unknown[],
    build: (part: string[]) => any,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const part of chunk(uuids(ids))) out.push(...(await this.all<T>(op, () => build(part))));
    return out;
  }

  /** One `.in()` query per chunk, for lookups that return at most one row per id (never exceeds the row cap). */
  private async inChunks<T>(
    ids: readonly unknown[],
    fn: (part: string[]) => Promise<T[]>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const part of chunk(uuids(ids))) out.push(...(await fn(part)));
    return out;
  }

  /**
   * One page + exact total. An offset past the end makes PostgREST answer 416 (PGRST103); that is an
   * empty page with the real total, exactly like MemoryStore's `slice`.
   */
  private async page<T = any>(
    op: string,
    build: () => any,
    offset: number,
    limit: number,
  ): Promise<{ rows: T[]; total: number }> {
    const res = await build().range(offset, offset + limit - 1);
    if (res.error?.code === 'PGRST103') {
      const head = await build().range(0, 0);
      ok(head, op);
      return { rows: [], total: head.count ?? 0 };
    }
    const rows = ok<T[]>(res, op) ?? [];
    return { rows, total: res.count ?? offset + rows.length };
  }

  /* ----------------------------------------------------- context helpers */

  private async contexts(sessions: AssessmentSessionRow[]): Promise<SessionContext[]> {
    if (!sessions.length) return [];
    const cohortIds = [...new Set(sessions.map((s) => s.cohort_id))];
    const assessmentIds = [...new Set(sessions.map((s) => s.assessment_id))];
    const sessionIds = sessions.map((s) => s.id);

    const [cohorts, assessments, questions, enrolled, submitted] = await Promise.all([
      this.inChunks<any>(cohortIds, async (p) =>
        ok(
          await this.db
            .from('cohorts')
            .select(
              `id,name,program_id,course_id,programs!${FK.cohortProgram}(name),courses!${FK.cohortCourse}(name)`,
            )
            .in('id', p),
          'ctx.cohorts',
        ),
      ),
      this.inChunks<any>(assessmentIds, async (p) =>
        ok(await this.db.from('assessments').select('*').in('id', p), 'ctx.assessments'),
      ),
      this.allIn<any>('ctx.questions', assessmentIds, (p) =>
        this.db
          .from('questions')
          .select('assessment_id')
          .in('assessment_id', p)
          .neq('question_type', 'project_rubric')
          .order('id'),
      ),
      this.allIn<any>('ctx.enrolled', cohortIds, (p) =>
        this.db
          .from('cohort_students')
          .select(`cohort_id,student_id,students!${FK.enrollmentStudent}!inner(status)`)
          .in('cohort_id', p)
          .eq('status', 'enrolled')
          .neq('students.status', 'withdrawn') // withdrawn students are excluded from counts
          .order('id'),
      ),
      this.allIn<any>('ctx.submitted', sessionIds, (p) =>
        this.db
          .from('assessment_attempts')
          .select(`assessment_session_id,student_id,students!${FK.attemptStudent}!inner(status)`)
          .in('assessment_session_id', p)
          .eq('status', 'submitted')
          .neq('students.status', 'withdrawn')
          .order('id'),
      ),
    ]);

    const cohortById = new Map<string, any>(cohorts.map((c: any) => [c.id, c]));
    const assessmentById = new Map(assessments.map((a: any) => [a.id, assessmentRow(a)]));
    const qCount = new Map<string, number>();
    for (const q of questions) qCount.set(q.assessment_id, (qCount.get(q.assessment_id) ?? 0) + 1);
    const enrolledCount = new Map<string, number>();
    for (const e of enrolled)
      enrolledCount.set(e.cohort_id, (enrolledCount.get(e.cohort_id) ?? 0) + 1);
    const submittedBy = new Map<string, Set<string>>();
    for (const a of submitted) {
      const set = submittedBy.get(a.assessment_session_id) ?? new Set<string>();
      set.add(a.student_id);
      submittedBy.set(a.assessment_session_id, set);
    }

    return sessions.flatMap((session) => {
      const cohort = cohortById.get(session.cohort_id);
      const assessment = assessmentById.get(session.assessment_id);
      if (!cohort || !assessment) return [];
      return [
        {
          session,
          cohort: {
            id: cohort.id,
            name: cohort.name,
            programId: cohort.program_id,
            programName: cohort.programs?.name ?? '',
            courseId: cohort.course_id,
            courseName: cohort.courses?.name ?? '',
          },
          assessment,
          questionCount: qCount.get(assessment.id) ?? 0,
          enrolledCount: enrolledCount.get(cohort.id) ?? 0,
          submittedCount: submittedBy.get(session.id)?.size ?? 0,
        },
      ];
    });
  }

  private async cohortDtos(filter?: { id?: string }): Promise<CohortDto[]> {
    const rows = await this.all<any>('cohorts.list', () => {
      let q = this.db
        .from('cohorts')
        .select(
          `*, programs!${FK.cohortProgram}(name), courses!${FK.cohortCourse}(name), staff_users!${FK.cohortLead}(id,display_name)`,
        )
        .order('start_date', { ascending: false })
        .order('id');
      if (filter?.id) q = q.eq('id', filter.id);
      return q;
    });
    const enrolled = await this.all<any>('cohorts.enrolled', () => {
      let q = this.db
        .from('cohort_students')
        .select(`cohort_id,students!${FK.enrollmentStudent}!inner(status)`)
        .eq('status', 'enrolled')
        .neq('students.status', 'withdrawn') // withdrawn students are excluded from counts
        .order('id');
      if (filter?.id) q = q.eq('cohort_id', filter.id);
      return q;
    });
    const counts = new Map<string, number>();
    for (const e of enrolled) counts.set(e.cohort_id, (counts.get(e.cohort_id) ?? 0) + 1);
    return rows.map((c) => ({
      id: c.id,
      programId: c.program_id,
      programName: c.programs?.name ?? '',
      courseId: c.course_id,
      courseName: c.courses?.name ?? '',
      name: c.name,
      deliveryMode: c.delivery_mode,
      startDate: c.start_date,
      endDate: c.end_date,
      leadInstructor: c.staff_users
        ? { id: c.staff_users.id, displayName: c.staff_users.display_name }
        : null,
      status: c.status,
      enrolledCount: counts.get(c.id) ?? 0,
    }));
  }

  private assessmentSummary(a: any): AssessmentSummaryDto {
    return {
      id: a.id,
      courseId: a.course_id,
      formFamily: a.form_family,
      formLabel: a.form_label,
      title: a.title,
      version: num(a.version),
      difficulty: a.difficulty,
      estimatedMinutes: num(a.estimated_minutes),
      intendedStages: a.intended_stages,
      skillCategories: a.skill_categories,
      questionCount: Array.isArray(a.questions) ? num(a.questions[0]?.count ?? 0) : 0,
      status: a.status,
    };
  }

  private async staffNames(ids: string[]): Promise<Map<string, string>> {
    const rows = await this.inChunks<any>(ids, async (p) =>
      ok(await this.db.from('staff_users').select('id,display_name').in('id', p), 'staff.names'),
    );
    return new Map(rows.map((r) => [r.id, r.display_name]));
  }

  /* ------------------------------------------------------- student auth */

  private async credentialWithStudent(column: 'credential_hash' | 'id', value: string, op: string) {
    const row = ok<any>(
      await this.db
        .from('student_credentials')
        .select(`*, students!${FK.credentialStudent}(*)`)
        .eq(column, value)
        .maybeSingle(),
      op,
    );
    if (!row || !row.students) return null;
    const { students, ...credential } = row;
    return { credential: credentialRow(credential), student: studentRow(students) };
  }
  async findCredentialByHash(hash: string) {
    return this.credentialWithStudent('credential_hash', hash, 'cred.find');
  }
  async getCredentialWithStudent(credentialId: string) {
    if (!isUuid(credentialId)) return null;
    return this.credentialWithStudent('id', credentialId, 'cred.get');
  }
  async touchCredentialUsed(credentialId: string) {
    ok(
      await this.db
        .from('student_credentials')
        .update({ last_used_at: nowIso() })
        .eq('id', credentialId),
      'cred.touch',
    );
  }
  async getStudent(id: string) {
    if (!isUuid(id)) return null;
    const r = ok<any>(
      await this.db.from('students').select('*').eq('id', id).maybeSingle(),
      'student.get',
    );
    return r ? studentRow(r) : null;
  }
  async listStudentEnrollments(studentId: string): Promise<StudentEnrollment[]> {
    const rows = await this.all<any>('student.enrollments', () =>
      this.db
        .from('cohort_students')
        .select(
          `roster_label, cohorts!${FK.enrollmentCohort}!inner(id,name,program_id,programs!${FK.cohortProgram}(name))`,
        )
        .eq('student_id', studentId)
        .eq('status', 'enrolled')
        .order('enrolled_at')
        .order('id'),
    );
    return rows.map((r) => ({
      cohortId: r.cohorts.id,
      cohortName: r.cohorts.name,
      programId: r.cohorts.program_id,
      programName: r.cohorts.programs?.name ?? '',
      rosterLabel: r.roster_label,
    }));
  }

  /* ------------------------------------------------ student assessments */

  async listStudentSessions(studentId: string) {
    const enrollments = await this.listStudentEnrollments(studentId);
    const cohortIds = enrollments.map((e) => e.cohortId);
    if (!cohortIds.length) return [];
    const sessions = (
      await this.allIn<any>('student.sessions', cohortIds, (p) =>
        this.db.from('assessment_sessions').select('*').in('cohort_id', p).order('id'),
      )
    ).map(sessionRow);
    const contexts = await this.contexts(sessions);
    if (!contexts.length) return [];
    const attempts = (
      await this.all<any>('student.session_attempts', () =>
        this.db.from('assessment_attempts').select('*').eq('student_id', studentId).order('id'),
      )
    ).map(attemptRow);
    return contexts.map((context) => ({
      context,
      attempt: pickAttempt(attempts.filter((a) => a.assessment_session_id === context.session.id)),
    }));
  }
  async getSessionContext(sessionId: string) {
    if (!isUuid(sessionId)) return null;
    const row = ok<any>(
      await this.db.from('assessment_sessions').select('*').eq('id', sessionId).maybeSingle(),
      'session.get',
    );
    return row ? ((await this.contexts([sessionRow(row)]))[0] ?? null) : null;
  }
  async isEnrolled(studentId: string, cohortId: string) {
    const rows = ok<any[]>(
      await this.db
        .from('cohort_students')
        .select('id')
        .eq('student_id', studentId)
        .eq('cohort_id', cohortId)
        .eq('status', 'enrolled')
        .limit(1),
      'student.enrolled',
    );
    return (rows ?? []).length > 0;
  }
  async listQuestions(assessmentId: string) {
    const rows = await this.all<any>('questions.list', () =>
      this.db
        .from('questions')
        .select('*')
        .eq('assessment_id', assessmentId)
        .order('display_order'),
    );
    return rows.map(questionRow);
  }
  async listQuestionsWithKeys(assessmentId: string): Promise<QuestionWithKey[]> {
    const questions = await this.listQuestions(assessmentId);
    if (!questions.length) return [];
    // The ONLY place answer keys are read for scoring.
    const keys = await this.allIn<any>(
      'questions.keys',
      questions.map((q) => q.id),
      (p) =>
        this.db
          .from('question_answer_keys')
          .select('question_id,answer_key')
          .in('question_id', p)
          .order('question_id'),
    );
    const byId = new Map(keys.map((k) => [k.question_id, k.answer_key as Record<string, unknown>]));
    return questions.map((q) => ({ ...q, answer_key: byId.get(q.id) ?? null }));
  }
  async getStudentAttempt(studentId: string, sessionId: string) {
    const rows = (
      await this.all<any>('attempt.student_session', () =>
        this.db
          .from('assessment_attempts')
          .select('*')
          .eq('student_id', studentId)
          .eq('assessment_session_id', sessionId)
          .order('id'),
      )
    ).map(attemptRow);
    return pickAttempt(rows);
  }
  async getAttempt(attemptId: string) {
    if (!isUuid(attemptId)) return null;
    const r = ok<any>(
      await this.db.from('assessment_attempts').select('*').eq('id', attemptId).maybeSingle(),
      'attempt.get',
    );
    return r ? attemptRow(r) : null;
  }
  async startAttempt(input: AttemptStartInput) {
    const { studentId, session, assessment } = input;
    // Two unique indexes can fire on insert (one in_progress; one non-PRACTICE attempt per session).
    // On a race we re-read and either return the winner's in-progress attempt, report
    // already_submitted, or (PRACTICE attempt submitted in between) insert again.
    for (let i = 0; i < 3; i++) {
      const existing = await this.getStudentAttempt(studentId, session.id);
      if (existing?.status === 'in_progress') return { attempt: existing, created: false };
      if (existing?.status === 'submitted' && session.stage !== 'PRACTICE')
        throw new StoreError('already_submitted');
      const res = await this.db
        .from('assessment_attempts')
        .insert({
          student_id: studentId,
          assessment_session_id: session.id,
          assessment_id: assessment.id,
          assessment_version: assessment.version,
          cohort_id: session.cohort_id,
          stage: session.stage,
          status: 'in_progress',
        })
        .select('*')
        .single();
      if (!res.error) return { attempt: attemptRow(res.data), created: true };
      if (!isUnique(res.error))
        throw new DbError('attempt.start', String(res.error.code || 'unknown'), res.status);
    }
    throw new DbError('attempt.start', SQLSTATE.unique);
  }
  async submitAttempt(input: SubmitAttemptInput) {
    // Round to the column scales (numeric(8,2) / (6,2) / (3,2)) so float noise can never trip the
    // percentage-consistency or max_points-equals-question-points checks.
    const res = await this.db.rpc('submit_attempt', {
      p_attempt_id: input.attemptId,
      p_student_id: input.studentId,
      p_raw: r2(input.rawScore),
      p_max: r2(input.maxScore),
      p_percentage: r2(input.percentageScore),
      p_confidence: input.selfReportedConfidence === null ? null : r2(input.selfReportedConfidence),
      p_duration: Math.max(0, Math.round(input.durationSeconds)),
      p_responses: input.responses.map((r) => ({
        question_id: r.question_id,
        response_data: r.response_data,
        is_correct: r.is_correct,
        earned_points: r2(r.earned_points),
        max_points: r2(r.max_points),
      })),
      p_skills: input.skills.map((s) => ({
        skill_category: s.skill_category,
        earned_points: r2(s.earned_points),
        max_points: r2(s.max_points),
      })),
    });
    if (res.error) {
      const code = String(res.error.code || '');
      // Same domain errors as MemoryStore: unknown / foreign attempt -> not found; not in_progress -> already submitted.
      if (code === SQLSTATE.attemptNotFound) throw new StoreError('attempt_not_found');
      if (code === SQLSTATE.alreadySubmitted || code === SQLSTATE.attemptNotInProgress)
        throw new StoreError('already_submitted');
      throw new DbError('attempt.submit', code || 'unknown', res.status);
    }
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) throw new DbError('attempt.submit', 'empty');
    return attemptRow(row);
  }
  async listStudentSubmittedAttempts(studentId: string) {
    const attempts = (
      await this.all<any>('student.progress', () =>
        this.db
          .from('assessment_attempts')
          .select('*')
          .eq('student_id', studentId)
          .eq('status', 'submitted')
          .order('submitted_at')
          .order('id'),
      )
    ).map(attemptRow);
    const sessionIds = attempts.map((a) => a.assessment_session_id);
    const sessions = await this.inChunks<any>(sessionIds, async (p) =>
      ok(
        await this.db.from('assessment_sessions').select('id,title').in('id', p),
        'student.progress.sessions',
      ),
    );
    const titles = new Map(sessions.map((s) => [s.id, s.title as string]));
    return attempts
      .filter((a) => a.submitted_at && a.percentage_score !== null)
      .map((a) => ({
        attemptId: a.id,
        title: titles.get(a.assessment_session_id) ?? '',
        stage: a.stage,
        submittedAt: a.submitted_at as string,
        percentageScore: a.percentage_score as number,
      }));
  }

  /* ------------------------------------------------------------ catalog */

  async listPrograms(): Promise<ProgramDto[]> {
    const [programs, courses, cohorts] = await Promise.all([
      this.all<any>('programs.list', () =>
        this.db.from('programs').select('*').order('name').order('id'),
      ),
      this.all<any>('programs.courses', () =>
        this.db.from('courses').select('program_id').order('id'),
      ),
      this.all<any>('programs.cohorts', () =>
        this.db.from('cohorts').select('program_id').order('id'),
      ),
    ]);
    const cc = new Map<string, number>();
    for (const c of courses) cc.set(c.program_id, (cc.get(c.program_id) ?? 0) + 1);
    const hc = new Map<string, number>();
    for (const c of cohorts) hc.set(c.program_id, (hc.get(c.program_id) ?? 0) + 1);
    return programs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      format: p.format,
      status: p.status,
      courseCount: cc.get(p.id) ?? 0,
      cohortCount: hc.get(p.id) ?? 0,
    }));
  }
  async listCourses(): Promise<CourseDto[]> {
    const rows = await this.all<any>('courses.list', () =>
      this.db.from('courses').select('*').order('name').order('id'),
    );
    return rows.map((c) => ({
      id: c.id,
      programId: c.program_id,
      name: c.name,
      description: c.description,
      status: c.status,
    }));
  }
  async listCohorts() {
    return this.cohortDtos();
  }
  async getCohort(id: string) {
    if (!isUuid(id)) return null;
    return (await this.cohortDtos({ id }))[0] ?? null;
  }
  async getCourse(id: string) {
    if (!isUuid(id)) return null;
    const c = ok<any>(
      await this.db.from('courses').select('*').eq('id', id).maybeSingle(),
      'course.get',
    );
    return c
      ? {
          id: c.id,
          programId: c.program_id,
          name: c.name,
          description: c.description,
          status: c.status,
        }
      : null;
  }
  async createProgram(input: { name: string; description: string; format: ProgramDto['format'] }) {
    const base = slugify(input.name);
    for (let i = 0; i < 5; i++) {
      const slug = i === 0 ? base : `${base}-${Math.floor(Math.random() * 9000 + 1000)}`;
      const res = await this.db
        .from('programs')
        .insert({ name: input.name, slug, description: input.description, format: input.format })
        .select('*')
        .single();
      if (isUnique(res.error)) continue;
      const p = ok<any>(res, 'programs.create');
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        format: p.format,
        status: p.status,
        courseCount: 0,
        cohortCount: 0,
      } satisfies ProgramDto;
    }
    throw new StoreError('duplicate');
  }
  async createCourse(input: { programId: string; name: string; description: string }) {
    const res = await this.db
      .from('courses')
      .insert({ program_id: input.programId, name: input.name, description: input.description })
      .select('*')
      .single();
    if (isUnique(res.error)) throw new StoreError('duplicate');
    const c = ok<any>(res, 'courses.create');
    return {
      id: c.id,
      programId: c.program_id,
      name: c.name,
      description: c.description,
      status: c.status,
    };
  }
  async createCohort(input: Parameters<DataStore['createCohort']>[0]) {
    const row = ok<any>(
      await this.db
        .from('cohorts')
        .insert({
          program_id: input.programId,
          course_id: input.courseId,
          name: input.name,
          delivery_mode: input.deliveryMode,
          start_date: input.startDate,
          end_date: input.endDate,
          lead_instructor_id: input.leadInstructorId,
        })
        .select('id')
        .single(),
      'cohorts.create',
    );
    return (await this.getCohort(row.id))!;
  }
  async listAssessments(opts?: { status?: AssessmentRow['status'] }) {
    const rows = await this.all<any>('assessments.list', () => {
      let q = this.db
        .from('assessments')
        .select(`*, questions!${FK.questionAssessment}(count)`)
        .order('title')
        .order('version')
        .order('id');
      if (opts?.status) q = q.eq('status', opts.status);
      return q;
    });
    return rows.map((a) => this.assessmentSummary(a));
  }
  async getAssessmentDetail(id: string, includeKeys: boolean): Promise<AssessmentDetailDto | null> {
    if (!isUuid(id)) return null;
    const a = ok<any>(
      await this.db.from('assessments').select('*').eq('id', id).maybeSingle(),
      'assessment.get',
    );
    if (!a) return null;
    const questions = await this.listQuestions(id);
    let keys = new Map<string, Record<string, unknown>>();
    if (includeKeys && questions.length) {
      // catalog.manage detail path: the only other place answer keys are read.
      const rows = await this.allIn<any>(
        'assessment.keys',
        questions.map((q) => q.id),
        (p) =>
          this.db
            .from('question_answer_keys')
            .select('question_id,answer_key')
            .in('question_id', p)
            .order('question_id'),
      );
      keys = new Map(rows.map((r) => [r.question_id, r.answer_key]));
    }
    return {
      ...this.assessmentSummary({ ...a, questions: [{ count: questions.length }] }),
      description: a.description,
      questions: questions.map((q) => ({
        id: q.id,
        type: q.question_type,
        prompt: q.prompt,
        config: q.config,
        skillCategory: q.skill_category,
        points: q.points,
        order: q.display_order,
        difficulty: q.difficulty,
        ...(includeKeys ? { answerKey: keys.get(q.id) ?? null } : {}),
      })),
    };
  }
  async createAssessment(input: NewAssessmentInput) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const versions = ok<any[]>(
        await this.db
          .from('assessments')
          .select('version')
          .eq('form_family', input.formFamily)
          .eq('form_label', input.formLabel)
          .order('version', { ascending: false })
          .limit(1),
        'assessment.version',
      );
      const version = num(versions?.[0]?.version ?? 0) + 1;
      const res = await this.db
        .from('assessments')
        .insert({
          course_id: input.courseId,
          form_family: input.formFamily,
          form_label: input.formLabel,
          title: input.title,
          description: input.description,
          version,
          difficulty: input.difficulty,
          estimated_minutes: input.estimatedMinutes,
          intended_stages: input.intendedStages,
          skill_categories: input.skillCategories,
          status: 'draft',
        })
        .select('*')
        .single();
      if (isUnique(res.error)) continue; // another writer took this version: recompute
      const a = ok<any>(res, 'assessment.create');
      try {
        if (input.questions.length) {
          const qs = ok<any[]>(
            await this.db
              .from('questions')
              .insert(
                input.questions.map((q) => ({
                  assessment_id: a.id,
                  question_type: q.question_type,
                  prompt: q.prompt,
                  config: q.config,
                  skill_category: q.skill_category,
                  difficulty: q.difficulty,
                  points: q.points,
                  display_order: q.display_order,
                })),
              )
              .select('id,display_order'),
            'assessment.questions',
          );
          const idByOrder = new Map(qs.map((q) => [num(q.display_order), q.id as string]));
          const keyRows = input.questions
            .filter((q) => q.answer_key)
            .map((q) => ({
              question_id: idByOrder.get(q.display_order),
              answer_key: q.answer_key,
            }));
          if (keyRows.length)
            ok(
              await this.db.from('question_answer_keys').insert(keyRows),
              'assessment.answer_keys',
            );
        }
      } catch (e) {
        await this.db.from('assessments').delete().eq('id', a.id); // cascades to questions / keys
        throw e;
      }
      return this.assessmentSummary({ ...a, questions: [{ count: input.questions.length }] });
    }
    throw new StoreError('duplicate');
  }
  async updateAssessmentStatus(id: string, status: AssessmentRow['status']) {
    if (!isUuid(id)) return null;
    const rows = ok<any[]>(
      await this.db
        .from('assessments')
        .update({ status })
        .eq('id', id)
        .select(`*, questions!${FK.questionAssessment}(count)`),
      'assessment.status',
    );
    return rows?.[0] ? this.assessmentSummary(rows[0]) : null;
  }

  /* --------------------------------------------------------- instructor */

  async listRoster(cohortId: string): Promise<RosterEntryDto[]> {
    const rows = await this.all<any>('roster.list', () =>
      this.db
        .from('cohort_students')
        .select(
          `roster_label, students!${FK.enrollmentStudent}!inner(id,public_code,age_band,status)`,
        )
        .eq('cohort_id', cohortId)
        .eq('status', 'enrolled')
        .order('id'),
    );
    const ids = rows.map((r) => r.students.id as string);
    const [creds, consents] = await Promise.all([
      this.allIn<any>('roster.creds', ids, (p) =>
        this.db
          .from('student_credentials')
          .select('student_id')
          .in('student_id', p)
          .is('revoked_at', null)
          .order('id'),
      ),
      this.allIn<any>('roster.consent', ids, (p) =>
        this.db
          .from('consent_records')
          .select('student_id,consent_status,created_at')
          .in('student_id', p)
          .order('created_at', { ascending: false })
          .order('id'),
      ),
    ]);
    const active = new Set(creds.map((c) => c.student_id));
    const consentBy = new Map<string, ConsentStatus>();
    for (const c of consents)
      if (!consentBy.has(c.student_id)) consentBy.set(c.student_id, c.consent_status);
    return rows
      .map((r) => ({
        studentId: r.students.id,
        rosterLabel: r.roster_label,
        publicCode: r.students.public_code,
        ageBand: r.students.age_band,
        status: r.students.status,
        hasActiveCredential: active.has(r.students.id),
        consent: consentBy.get(r.students.id) ?? ('not_required' as ConsentStatus),
      }))
      .sort((a, b) => a.rosterLabel.localeCompare(b.rosterLabel, undefined, { numeric: true }));
  }
  async listSessions(filter?: { cohortIds?: string[] }) {
    let rows: AssessmentSessionRow[];
    if (filter?.cohortIds) {
      const rawRows = await this.allIn<any>('sessions.list', filter.cohortIds, (p) =>
        this.db.from('assessment_sessions').select('*').in('cohort_id', p).order('id'),
      );
      rows = rawRows
        .map(sessionRow)
        .sort((a, b) => ms(b.created_at) - ms(a.created_at) || a.id.localeCompare(b.id));
    } else {
      rows = (
        await this.all<any>('sessions.list', () =>
          this.db
            .from('assessment_sessions')
            .select('*')
            .order('created_at', { ascending: false })
            .order('id'),
        )
      ).map(sessionRow);
    }
    return this.contexts(rows);
  }
  async createSession(input: Parameters<DataStore['createSession']>[0]) {
    const row = sessionRow(
      ok<any>(
        await this.db
          .from('assessment_sessions')
          .insert({
            cohort_id: input.cohortId,
            assessment_id: input.assessmentId,
            stage: input.stage,
            title: input.title,
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            status: input.status,
            created_by: input.createdBy,
          })
          .select('*')
          .single(),
        'session.create',
      ),
    );
    return (await this.contexts([row]))[0]!;
  }
  async updateSessionStatus(id: string, status: 'open' | 'closed') {
    if (!isUuid(id)) return null;
    const rows = ok<any[]>(
      await this.db.from('assessment_sessions').update({ status }).eq('id', id).select('*'),
      'session.update',
    );
    return rows?.[0] ? ((await this.contexts([sessionRow(rows[0])]))[0] ?? null) : null;
  }
  async getSessionProgressData(sessionId: string): Promise<SessionProgressData> {
    if (!isUuid(sessionId)) return { roster: [], submitted: [] };
    const session = ok<any>(
      await this.db
        .from('assessment_sessions')
        .select('id,cohort_id')
        .eq('id', sessionId)
        .maybeSingle(),
      'progress.session',
    );
    if (!session) return { roster: [], submitted: [] };
    const [rosterRows, attemptRows] = await Promise.all([
      this.all<any>('progress.roster', () =>
        this.db
          .from('cohort_students')
          .select(`roster_label, students!${FK.enrollmentStudent}!inner(id,public_code,status)`)
          .eq('cohort_id', session.cohort_id)
          .eq('status', 'enrolled')
          // Withdrawn students are omitted from the progress roster, hence from enrolled / submitted /
          // aggregate (listRoster still shows them).
          .neq('students.status', 'withdrawn')
          .order('id'),
      ),
      this.all<any>('progress.attempts', () =>
        this.db
          .from('assessment_attempts')
          .select('student_id,status,duration_seconds,percentage_score')
          .eq('assessment_session_id', sessionId)
          .order('id'),
      ),
    ]);
    const enrolledIds = new Set<string>(rosterRows.map((r) => r.students.id));
    const roster = rosterRows.map((r) => {
      const mine = attemptRows.filter((a) => a.student_id === r.students.id);
      const attemptStatus: 'submitted' | 'in_progress' | null = mine.some(
        (a) => a.status === 'submitted',
      )
        ? 'submitted'
        : mine.some((a) => a.status === 'in_progress')
          ? 'in_progress'
          : null;
      return {
        rosterLabel: r.roster_label as string,
        publicCode: r.students.public_code as string,
        studentStatus: r.students.status as StudentStatus,
        attemptStatus,
      };
    });
    const submitted = attemptRows
      .filter(
        (a) =>
          a.status === 'submitted' && a.percentage_score !== null && enrolledIds.has(a.student_id),
      )
      .map((a) => ({
        durationSeconds: numOrNull(a.duration_seconds),
        percentage: num(a.percentage_score),
      }));
    return { roster, submitted };
  }

  async createStudentsWithCredentials(
    input: Parameters<DataStore['createStudentsWithCredentials']>[0],
  ): Promise<CreatedStudent[]> {
    const { cohortId, createdBy, students } = input;
    if (!students.length) return [];
    const createdIds: string[] = [];
    // Deleting the students cascades to cohort_students, student_credentials, consent_records.
    const cleanup = async () => {
      if (createdIds.length) await this.db.from('students').delete().in('id', createdIds);
    };
    try {
      // 1. students (ids generated by the database)
      const sres = await this.db
        .from('students')
        .insert(
          students.map((s) => ({
            public_code: s.publicCode,
            age_band: s.ageBand,
            status: s.status,
            is_synthetic: false,
          })),
        )
        .select('id,public_code');
      if (isUnique(sres.error)) throw new StoreError('public_code_conflict');
      const inserted = ok<{ id: string; public_code: string }[]>(sres, 'issue.students');
      createdIds.push(...inserted.map((s) => s.id));
      const idByPublic = new Map(inserted.map((s) => [s.public_code, s.id]));

      // 2. enrollments with the next roster labels (unique (cohort_id, roster_label) arbitrates races)
      const existing = await this.all<any>('issue.labels', () =>
        this.db
          .from('cohort_students')
          .select('roster_label')
          .eq('cohort_id', cohortId)
          .order('id'),
      );
      const used = existing
        .map((r) => Number.parseInt(r.roster_label, 10))
        .filter((n) => Number.isFinite(n));
      let next = (used.length ? Math.max(...used) : 0) + 1;
      const labelByPublic = new Map<string, string>();
      const enrollRows = students.map((s) => {
        const label = String(next++).padStart(2, '0');
        labelByPublic.set(s.publicCode, label);
        return {
          cohort_id: cohortId,
          student_id: idByPublic.get(s.publicCode),
          roster_label: label,
        };
      });
      const eres = await this.db.from('cohort_students').insert(enrollRows);
      if (isUnique(eres.error)) throw new StoreError('roster_conflict');
      ok(eres, 'issue.enroll');

      // 3. credentials (hash only)
      ok(
        await this.db.from('student_credentials').insert(
          students.map((s) => ({
            student_id: idByPublic.get(s.publicCode),
            credential_hash: s.credentialHash,
            key_version: s.keyVersion,
            created_by: createdBy,
          })),
        ),
        'issue.credentials',
      );

      // 4. pending consent records (under-13 flow)
      if (input.pendingConsentNoticeVersion) {
        ok(
          await this.db.from('consent_records').insert(
            students.map((s) => ({
              student_id: idByPublic.get(s.publicCode),
              consent_status: 'pending',
              notice_version: input.pendingConsentNoticeVersion,
              recorded_by: createdBy,
            })),
          ),
          'issue.consent',
        );
      }
      return students.map((s) => ({
        studentId: idByPublic.get(s.publicCode)!,
        publicCode: s.publicCode,
        rosterLabel: labelByPublic.get(s.publicCode)!,
      }));
    } catch (e) {
      await cleanup();
      // A duplicate credential hash / public code means the caller should retry with fresh random values.
      if (e instanceof DbError && e.sqlState === SQLSTATE.unique)
        throw new StoreError('public_code_conflict');
      throw e;
    }
  }

  async reissueCredential(input: Parameters<DataStore['reissueCredential']>[0]) {
    const seat = ok<any>(
      await this.db
        .from('cohort_students')
        .select(`roster_label, students!${FK.enrollmentStudent}!inner(id,public_code)`)
        .eq('cohort_id', input.cohortId)
        .eq('roster_label', input.rosterLabel)
        .eq('status', 'enrolled')
        .maybeSingle(),
      'reissue.seat',
    );
    if (!seat) return null;
    const res = await this.db.rpc('reissue_credential', {
      p_student_id: seat.students.id,
      p_new_hash: input.newHash,
      p_key_version: input.keyVersion,
      p_staff_id: input.staffId,
      p_reason: input.reason,
    });
    if (res.error) {
      const code = String(res.error.code || '');
      if (code === SQLSTATE.studentNotFound) return null;
      if (code === SQLSTATE.unique) throw new StoreError('duplicate');
      throw new DbError('reissue.rpc', code || 'unknown', res.status);
    }
    return {
      studentId: seat.students.id as string,
      publicCode: seat.students.public_code as string,
      rosterLabel: seat.roster_label as string,
    };
  }

  /* ---------------------------------------------------------- analytics */

  async getMatchedPairs(
    cohortIds: string[],
    from?: string,
    to?: string,
  ): Promise<MatchedPairRow[]> {
    const ids = uuids(cohortIds);
    if (!ids.length) return [];
    // matched_pairs(p_cohort_ids uuid[], p_from date, p_to date) -> setof matched_pair_row. The explicit
    // order mirrors the function's own ORDER BY so range() paging is deterministic.
    const rows = await this.all<any>('analytics.pairs', () =>
      this.db
        .rpc('matched_pairs', { p_cohort_ids: ids, p_from: from ?? null, p_to: to ?? null })
        .order('cohort_id')
        .order('student_id')
        .order('form_family'),
    );
    const skills = (v: unknown) =>
      Object.fromEntries(
        Object.entries((v ?? {}) as Record<string, unknown>).map(([k, x]) => [k, num(x)]),
      );
    return rows.map((r) => ({
      student_id: r.student_id,
      cohort_id: r.cohort_id,
      program_id: r.program_id,
      course_id: r.course_id,
      form_family: r.form_family,
      pre_attempt_id: r.pre_attempt_id,
      post_attempt_id: r.post_attempt_id,
      pre_percentage: num(r.pre_percentage),
      post_percentage: num(r.post_percentage),
      pre_submitted_at: iso(r.pre_submitted_at) as string,
      post_submitted_at: iso(r.post_submitted_at) as string,
      pre_confidence: numOrNull(r.pre_confidence),
      post_confidence: numOrNull(r.post_confidence),
      retention_attempt_id: r.retention_attempt_id ?? null,
      retention_percentage: numOrNull(r.retention_percentage),
      pre_skills: skills(r.pre_skills),
      post_skills: skills(r.post_skills),
    }));
  }

  async listSubmittedAttemptsInScope(cohortIds: string[], from?: string, to?: string) {
    // Inclusive UTC calendar days: [from 00:00Z, day-after-to 00:00Z). (An upper bound of 23:59:59.999Z
    // would drop attempts in the last millisecond; timestamptz has microsecond precision.)
    const lo = from ? new Date(utcDayStart('analytics.attempts', from)).toISOString() : null;
    const hi = to
      ? new Date(utcDayStart('analytics.attempts', to) + 86_400_000).toISOString()
      : null;
    const rows = await this.allIn<any>('analytics.attempts', cohortIds, (p) => {
      let q = this.db
        .from('assessment_attempts')
        .select(`stage,cohort_id,submitted_at,students!${FK.attemptStudent}!inner(status)`)
        .eq('status', 'submitted')
        .neq('stage', 'PRACTICE')
        .neq('students.status', 'withdrawn')
        .in('cohort_id', p)
        .order('id');
      if (lo) q = q.gte('submitted_at', lo);
      if (hi) q = q.lt('submitted_at', hi);
      return q;
    });
    return rows.map((r): { stage: AssessmentStage; cohort_id: string; submitted_at: string } => ({
      stage: r.stage,
      cohort_id: r.cohort_id,
      submitted_at: iso(r.submitted_at) as string,
    }));
  }

  async listRecentSessionActivity(
    cohortIds: string[],
    limit: number,
  ): Promise<RecentActivityItem[]> {
    if (!cohortIds.length || limit <= 0) return [];
    const rawSessions = await this.allIn<any>('activity.sessions', cohortIds, (p) =>
      this.db.from('assessment_sessions').select('*').in('cohort_id', p).order('id'),
    );
    const sessions = rawSessions.map(sessionRow);
    const sessionIds = sessions.map((s) => s.id);
    // Withdrawn students' submissions never count toward lastActivityAt (same rule as the counts).
    const submitted = await this.allIn<any>('activity.submitted', sessionIds, (p) =>
      this.db
        .from('assessment_attempts')
        .select(`assessment_session_id,submitted_at,students!${FK.attemptStudent}!inner(status)`)
        .in('assessment_session_id', p)
        .eq('status', 'submitted')
        .neq('students.status', 'withdrawn')
        .order('id'),
    );
    const lastSubmit = new Map<string, number>();
    for (const a of submitted) {
      const t = ms(a.submitted_at);
      if (Number.isNaN(t)) continue;
      const cur = lastSubmit.get(a.assessment_session_id);
      if (cur === undefined || t > cur) lastSubmit.set(a.assessment_session_id, t);
    }
    const top = sessions
      .map((s) => ({ s, at: lastSubmit.get(s.id) ?? ms(s.created_at) }))
      .sort((a, b) => b.at - a.at || a.s.id.localeCompare(b.s.id))
      .slice(0, limit);
    // Counts for just the top sessions (hinted embeds + withdrawn filter live in contexts()).
    const ctxById = new Map(
      (await this.contexts(top.map((t) => t.s))).map((c) => [c.session.id, c]),
    );
    return top.flatMap(({ s, at }) => {
      const ctx = ctxById.get(s.id);
      if (!ctx) return [];
      return [
        {
          sessionId: s.id,
          title: s.title,
          cohortName: ctx.cohort.name,
          programName: ctx.cohort.programName,
          stage: s.stage,
          status: s.status,
          enrolledCount: ctx.enrolledCount,
          submittedCount: ctx.submittedCount,
          lastActivityAt: new Date(at).toISOString(),
        },
      ];
    });
  }

  async countStudentRecords(cohortIds: string[]) {
    const seen = new Map<string, boolean>();
    const rows = await this.allIn<any>('analytics.students', cohortIds, (p) =>
      this.db
        .from('cohort_students')
        .select(`student_id, students!${FK.enrollmentStudent}!inner(is_synthetic)`)
        .in('cohort_id', p)
        .eq('status', 'enrolled')
        .neq('students.status', 'withdrawn')
        .order('id'),
    );
    for (const r of rows) seen.set(r.student_id, !!r.students.is_synthetic);
    return { total: seen.size, synthetic: [...seen.values()].filter(Boolean).length };
  }

  /* ----------------------------------------------------------- students */

  private async listItems(students: StudentRow[]): Promise<StudentListItem[]> {
    const ids = students.map((s) => s.id);
    const [enrollments, attempts] = await Promise.all([
      this.allIn<any>('students.cohorts', ids, (p) =>
        this.db
          .from('cohort_students')
          .select(`student_id,roster_label,cohorts!${FK.enrollmentCohort}(id,name)`)
          .in('student_id', p)
          .order('enrolled_at')
          .order('id'),
      ),
      this.allIn<any>('students.attempts', ids, (p) =>
        this.db
          .from('assessment_attempts')
          .select('student_id,percentage_score,submitted_at,created_at')
          .in('student_id', p)
          .eq('status', 'submitted')
          .order('id'),
      ),
    ]);
    return students.map((s) => {
      const mine = attempts
        .filter((a) => a.student_id === s.id)
        .sort((a, b) => ms(b.submitted_at ?? b.created_at) - ms(a.submitted_at ?? a.created_at));
      return {
        id: s.id,
        publicCode: s.public_code,
        ageBand: s.age_band,
        status: s.status,
        cohorts: enrollments
          .filter((e) => e.student_id === s.id && e.cohorts)
          .map((e) => ({ id: e.cohorts.id, name: e.cohorts.name, rosterLabel: e.roster_label })),
        attemptCount: mine.length,
        latestScore: numOrNull(mine[0]?.percentage_score),
        createdAt: s.created_at,
        isSynthetic: s.is_synthetic,
      };
    });
  }

  async listStudents(q: {
    q?: string;
    cohortId?: string;
    limit: number;
    offset: number;
  }): Promise<Page<StudentListItem>> {
    // Public codes are `S-` + Crockford base32, so a prefix containing any other character can match
    // nothing (MemoryStore: startsWith). Returning empty here (rather than stripping characters) keeps
    // identical semantics AND guarantees no LIKE wildcard (%, _, PostgREST's `*`) ever reaches the filter.
    const prefix = q.q?.trim().toUpperCase() ?? '';
    if (prefix && !/^[A-Z0-9-]+$/.test(prefix)) return { items: [], total: 0 };
    if (q.cohortId !== undefined && !isUuid(q.cohortId)) return { items: [], total: 0 };

    const { rows, total } = await this.page<any>(
      'students.list',
      () => {
        let query = q.cohortId
          ? this.db
              .from('students')
              .select(`*, cohort_students!${FK.enrollmentStudent}!inner(cohort_id)`, {
                count: 'exact',
              })
              .eq('cohort_students.cohort_id', q.cohortId)
          : this.db.from('students').select('*', { count: 'exact' });
        if (prefix) query = query.like('public_code', `${prefix}%`);
        return query.order('created_at', { ascending: false }).order('public_code');
      },
      q.offset,
      q.limit,
    );
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const students = rows.map(({ cohort_students: _cs, ...rest }) => studentRow(rest));
    return { items: await this.listItems(students), total };
  }

  async getStudentHistory(id: string): Promise<StudentHistory | null> {
    const s = await this.getStudent(id);
    if (!s) return null;
    const [item] = await this.listItems([s]);
    const [consentRows, credRows, attemptRows] = await Promise.all([
      this.db
        .from('consent_records')
        .select('consent_status,notice_version,consent_timestamp')
        .eq('student_id', id)
        .order('created_at', { ascending: false })
        .order('id')
        .limit(1),
      this.all<any>('history.creds', () =>
        this.db
          .from('student_credentials')
          .select('created_at,revoked_at,last_used_at')
          .eq('student_id', id)
          .order('created_at', { ascending: false })
          .order('id'),
      ),
      this.all<any>('history.attempts', () =>
        this.db
          .from('assessment_attempts')
          .select('*')
          .eq('student_id', id)
          .eq('status', 'submitted')
          .order('submitted_at')
          .order('id'),
      ),
    ]);
    const attempts = attemptRows.map(attemptRow);
    const attemptIds = attempts.map((a) => a.id);
    const sessionIds = attempts.map((a) => a.assessment_session_id);
    const assessmentIds = attempts.map((a) => a.assessment_id);
    const cohortIds = attempts.map((a) => a.cohort_id);
    const [skills, sessions, assessments, cohorts] = await Promise.all([
      this.allIn<any>('history.skills', attemptIds, (p) =>
        this.db
          .from('attempt_skill_scores')
          .select('*')
          .in('attempt_id', p)
          .order('attempt_id')
          .order('skill_category'),
      ),
      this.inChunks<any>(sessionIds, async (p) =>
        ok(
          await this.db.from('assessment_sessions').select('id,title').in('id', p),
          'history.sessions',
        ),
      ),
      this.inChunks<any>(assessmentIds, async (p) =>
        ok(await this.db.from('assessments').select('id,title').in('id', p), 'history.assessments'),
      ),
      this.inChunks<any>(cohortIds, async (p) =>
        ok(await this.db.from('cohorts').select('id,name').in('id', p), 'history.cohorts'),
      ),
    ]);
    const title = (rows: any[], key: string) => rows.find((r) => r.id === key)?.title ?? '';
    const creds = credRows.map((c) => credentialRow(c));
    const active = creds.find((c) => !c.revoked_at) ?? null;
    const lastUsed =
      creds
        .map((c) => c.last_used_at)
        .filter((x): x is string => !!x)
        .sort((a, b) => ms(a) - ms(b))
        .pop() ?? null;
    const c0 = ok<any[]>(consentRows, 'history.consent')?.[0] ?? null;
    return {
      student: item!,
      consent: c0
        ? {
            status: c0.consent_status,
            noticeVersion: c0.notice_version,
            consentTimestamp: iso(c0.consent_timestamp),
          }
        : null,
      attempts: attempts
        .filter((a) => a.submitted_at && a.percentage_score !== null)
        .map((a) => ({
          attemptId: a.id,
          sessionTitle: title(sessions, a.assessment_session_id),
          assessmentTitle: title(assessments, a.assessment_id),
          cohortName: cohorts.find((c) => c.id === a.cohort_id)?.name ?? '',
          stage: a.stage,
          submittedAt: a.submitted_at as string,
          percentageScore: a.percentage_score as number,
          durationSeconds: a.duration_seconds,
          skills: skills
            .filter((k) => k.attempt_id === a.id && num(k.max_points) > 0)
            .map((k) => ({
              skill: k.skill_category,
              percentage: r2((100 * num(k.earned_points)) / num(k.max_points)),
            })),
        })),
      credential: {
        active: !!active,
        createdAt: (active ?? creds[0])?.created_at ?? null,
        lastUsedAt: lastUsed,
        reissueCount: Math.max(0, creds.length - 1),
      },
    };
  }

  async setStudentStatus(id: string, status: StudentStatus) {
    ok(await this.db.from('students').update({ status }).eq('id', id), 'student.status');
  }
  async deleteStudent(id: string) {
    const s = await this.getStudent(id);
    if (!s) return null;
    // Relies on FK cascades: student_credentials, cohort_students, consent_records (-> guardian_contacts),
    // assessment_attempts (-> assessment_responses, attempt_skill_scores) and project_evaluations all
    // `on delete cascade`. audit_log has no FK to students, so the audit row written afterwards is safe.
    const rows = ok<any[]>(
      await this.db.from('students').delete().eq('id', id).select('id'),
      'student.delete',
    );
    return rows?.length ? { publicCode: s.public_code } : null;
  }

  /* ------------------------------------------------------------ consent */

  private async consentDtos(rows: any[]): Promise<ConsentDto[]> {
    // Existence only: contact_value is never selected.
    const contacts = await this.allIn<any>(
      'consent.contacts',
      rows.map((r) => r.id),
      (p) =>
        this.db
          .from('guardian_contacts')
          .select('consent_record_id')
          .in('consent_record_id', p)
          .order('id'),
    );
    const has = new Set(contacts.map((c) => c.consent_record_id));
    return rows.map((raw) => {
      const r = consentRow(raw);
      return {
        id: r.id,
        studentId: r.student_id,
        publicCode: r.students?.public_code ?? '',
        ageBand: r.students?.age_band ?? 'AGE_13_17',
        consentStatus: r.consent_status,
        verificationMethod: r.verification_method,
        noticeVersion: r.notice_version,
        consentTimestamp: r.consent_timestamp,
        withdrawalTimestamp: r.withdrawal_timestamp,
        hasGuardianContact: has.has(r.id),
        createdAt: r.created_at,
      };
    });
  }
  async listConsent(q: {
    status?: ConsentStatus;
    limit: number;
    offset: number;
  }): Promise<Page<ConsentDto>> {
    const { rows, total } = await this.page<any>(
      'consent.list',
      () => {
        let query = this.db
          .from('consent_records')
          .select(`*, students!${FK.consentStudent}(public_code,age_band)`, { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id');
        if (q.status) query = query.eq('consent_status', q.status);
        return query;
      },
      q.offset,
      q.limit,
    );
    return { items: await this.consentDtos(rows), total };
  }
  async getConsent(id: string) {
    if (!isUuid(id)) return null;
    const r = ok<any>(
      await this.db
        .from('consent_records')
        .select(`*, students!${FK.consentStudent}(public_code,age_band)`)
        .eq('id', id)
        .maybeSingle(),
      'consent.get',
    );
    return r ? (await this.consentDtos([r]))[0]! : null;
  }
  async recordConsent(input: ConsentWriteInput) {
    const ts = nowIso();
    const rec = ok<ConsentRecordRow>(
      await this.db
        .from('consent_records')
        .insert({
          student_id: input.studentId,
          consent_status: input.consentStatus,
          verification_method: input.verificationMethod,
          notice_version: input.noticeVersion,
          consent_timestamp: input.consentStatus === 'granted' ? ts : null,
          withdrawal_timestamp: input.consentStatus === 'withdrawn' ? ts : null,
          recorded_by: input.recordedBy,
        })
        .select('*')
        .single(),
      'consent.create',
    );
    try {
      if (input.guardianContact) {
        ok(
          await this.db.from('guardian_contacts').insert({
            consent_record_id: rec.id,
            contact_method: input.guardianContact.method,
            contact_value: input.guardianContact.value,
          }),
          'consent.contact',
        );
      }
      if (input.consentStatus === 'granted') {
        ok(
          await this.db
            .from('students')
            .update({ status: 'active' })
            .eq('id', input.studentId)
            .eq('status', 'pending_consent'),
          'consent.student',
        );
      } else if (input.consentStatus === 'withdrawn') {
        ok(
          await this.db.from('students').update({ status: 'withdrawn' }).eq('id', input.studentId),
          'consent.student',
        );
      }
    } catch (e) {
      await this.db.from('consent_records').delete().eq('id', rec.id); // cascades to guardian_contacts
      throw e;
    }
    return (await this.getConsent(rec.id))!;
  }
  async withdrawConsent(id: string) {
    if (!isUuid(id)) return null;
    const rows = ok<any[]>(
      await this.db
        .from('consent_records')
        .update({ consent_status: 'withdrawn', withdrawal_timestamp: nowIso() })
        .eq('id', id)
        .select('student_id'),
      'consent.withdraw',
    );
    if (!rows?.[0]) return null;
    ok(
      await this.db.from('students').update({ status: 'withdrawn' }).eq('id', rows[0].student_id),
      'consent.withdraw_student',
    );
    return this.getConsent(id);
  }

  /* --------------------------------------------------------- AI reports */

  private async reportDtos(rows: AiReportRow[]): Promise<AiReportDto[]> {
    const names = await this.staffNames(rows.map((r) => r.created_by ?? ''));
    return rows.map((raw) => {
      const r = reportRow(raw);
      return {
        id: r.id,
        reportType: r.report_type,
        filters: r.filters as AiReportDto['filters'],
        content: r.generated_content as unknown as AiReportDto['content'],
        generationMode: r.generation_mode,
        modelId: r.model_id,
        promptVersion: r.prompt_version,
        validation: r.validation as unknown as AiReportDto['validation'],
        inputMetrics: r.input_metrics,
        saved: r.saved,
        createdAt: r.created_at,
        createdBy: r.created_by ? (names.get(r.created_by) ?? null) : null,
      };
    });
  }
  async insertAiReport(input: NewAiReportInput) {
    const row = ok<AiReportRow>(
      await this.db
        .from('ai_reports')
        .insert({
          report_type: input.reportType,
          filters: input.filters,
          input_metrics: input.inputMetrics,
          generated_content: input.content,
          generation_mode: input.generationMode,
          model_id: input.modelId,
          prompt_version: input.promptVersion,
          validation: input.validation,
          created_by: input.createdBy,
        })
        .select('*')
        .single(),
      'reports.insert',
    );
    return (await this.reportDtos([row]))[0]!;
  }
  async listAiReports(q: {
    limit: number;
    offset: number;
    savedOnly: boolean;
  }): Promise<Page<AiReportDto>> {
    const { rows, total } = await this.page<AiReportRow>(
      'reports.list',
      () => {
        let query = this.db
          .from('ai_reports')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id');
        if (q.savedOnly) query = query.eq('saved', true);
        return query;
      },
      q.offset,
      q.limit,
    );
    return { items: await this.reportDtos(rows), total };
  }
  async getAiReport(id: string) {
    if (!isUuid(id)) return null;
    const r = ok<AiReportRow | null>(
      await this.db.from('ai_reports').select('*').eq('id', id).maybeSingle(),
      'reports.get',
    );
    return r ? (await this.reportDtos([r]))[0]! : null;
  }
  async setAiReportSaved(id: string, saved: boolean) {
    if (!isUuid(id)) return null;
    const rows = ok<AiReportRow[]>(
      await this.db.from('ai_reports').update({ saved }).eq('id', id).select('*'),
      'reports.save',
    );
    return rows?.[0] ? (await this.reportDtos([rows[0]]))[0]! : null;
  }
  async deleteAiReport(id: string) {
    if (!isUuid(id)) return false;
    const rows = ok<any[]>(
      await this.db.from('ai_reports').delete().eq('id', id).select('id'),
      'reports.delete',
    );
    return (rows ?? []).length > 0;
  }

  /* -------------------------------------------------------------- staff */

  private async withPrograms(s: StaffUserRow | null) {
    if (!s) return null;
    const rows = await this.all<any>('staff.assignments', () =>
      this.db
        .from('staff_program_assignments')
        .select('program_id')
        .eq('staff_id', s.id)
        .order('program_id'),
    );
    return { staff: staffRow(s), programIds: rows.map((r) => r.program_id as string) };
  }
  async getStaff(id: string) {
    if (!isUuid(id)) return null;
    return this.withPrograms(
      ok<StaffUserRow | null>(
        await this.db.from('staff_users').select('*').eq('id', id).maybeSingle(),
        'staff.get',
      ),
    );
  }
  async getStaffByAuthUserId(authUserId: string) {
    if (!isUuid(authUserId)) return null;
    return this.withPrograms(
      ok<StaffUserRow | null>(
        await this.db.from('staff_users').select('*').eq('auth_user_id', authUserId).maybeSingle(),
        'staff.by_auth',
      ),
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getStaffByRole(_role: StaffRole, _synthetic: boolean) {
    return null; // demo staff do not exist in a real database
  }
  async touchStaffLogin(id: string) {
    ok(
      await this.db.from('staff_users').update({ last_login_at: nowIso() }).eq('id', id),
      'staff.touch',
    );
    ok(
      await this.db
        .from('staff_users')
        .update({ status: 'active' })
        .eq('id', id)
        .eq('status', 'invited'),
      'staff.activate',
    );
  }
  private async staffDtos(rows: StaffUserRow[]): Promise<StaffDto[]> {
    const assignments = await this.allIn<any>(
      'staff.all_assignments',
      rows.map((r) => r.id),
      (p) =>
        this.db
          .from('staff_program_assignments')
          .select('staff_id,program_id')
          .in('staff_id', p)
          .order('staff_id')
          .order('program_id'),
    );
    return rows.map((raw) => {
      const s = staffRow(raw);
      return {
        id: s.id,
        displayName: s.display_name,
        role: s.role,
        status: s.status,
        programIds: assignments
          .filter((a) => a.staff_id === s.id)
          .map((a) => a.program_id as string),
        lastLoginAt: s.last_login_at,
        isSynthetic: s.is_synthetic,
      };
    });
  }
  async listStaff() {
    return this.staffDtos(
      await this.all<StaffUserRow>('staff.list', () =>
        this.db.from('staff_users').select('*').order('display_name').order('id'),
      ),
    );
  }
  async createStaff(input: NewStaffInput) {
    const res = await this.db
      .from('staff_users')
      .insert({
        auth_user_id: input.authUserId,
        display_name: input.displayName,
        role: input.role,
        status: input.status,
        is_synthetic: input.isSynthetic,
      })
      .select('*')
      .single();
    if (isUnique(res.error)) throw new StoreError('duplicate');
    const row = ok<StaffUserRow>(res, 'staff.create');
    const programIds = [...new Set(input.programIds)];
    if (programIds.length) {
      const a = await this.db
        .from('staff_program_assignments')
        .insert(programIds.map((program_id) => ({ staff_id: row.id, program_id })));
      if (a.error) {
        await this.db.from('staff_users').delete().eq('id', row.id); // cascades to assignments
        throw new DbError('staff.assign', String(a.error.code || 'unknown'), a.status);
      }
    }
    return (await this.staffDtos([row]))[0]!;
  }
  async updateStaff(
    id: string,
    patch: { role?: StaffRole; status?: 'active' | 'disabled'; programIds?: string[] },
  ) {
    if (!isUuid(id)) return null;
    const fields: Record<string, unknown> = {};
    if (patch.role) fields.role = patch.role;
    if (patch.status) fields.status = patch.status;
    let row: StaffUserRow | null;
    if (Object.keys(fields).length) {
      row =
        ok<StaffUserRow[]>(
          await this.db.from('staff_users').update(fields).eq('id', id).select('*'),
          'staff.update',
        )?.[0] ?? null;
    } else {
      row = ok<StaffUserRow | null>(
        await this.db.from('staff_users').select('*').eq('id', id).maybeSingle(),
        'staff.get',
      );
    }
    if (!row) return null;
    if (patch.programIds) {
      // Two requests (not atomic), ordered so a failure never strips access that was meant to stay:
      // add the missing assignments first, then remove the ones no longer wanted.
      const want = [...new Set(patch.programIds)];
      const current = (
        await this.all<any>('staff.current_assignments', () =>
          this.db
            .from('staff_program_assignments')
            .select('program_id')
            .eq('staff_id', id)
            .order('program_id'),
        )
      ).map((r) => r.program_id as string);
      const add = want.filter((p) => !current.includes(p));
      const remove = current.filter((p) => !want.includes(p));
      if (add.length)
        ok(
          await this.db
            .from('staff_program_assignments')
            .insert(add.map((program_id) => ({ staff_id: id, program_id }))),
          'staff.assign',
        );
      if (remove.length)
        ok(
          await this.db
            .from('staff_program_assignments')
            .delete()
            .eq('staff_id', id)
            .in('program_id', remove),
          'staff.unassign',
        );
    }
    return (await this.staffDtos([row]))[0]!;
  }

  /* -------------------------------------------------------------- audit */

  /** audit_log is append-only (trigger CI008): this class only ever INSERTs into it. */
  async appendAudit(entry: AuditAppendInput) {
    ok(
      await this.db.from('audit_log').insert({
        actor_type: entry.actorType,
        actor_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType ?? null,
        target_id: entry.targetId ?? null,
        metadata: entry.metadata ?? {},
      }),
      'audit.append',
    );
  }
  async listAudit(q: { limit: number; offset: number }): Promise<Page<AuditEntryDto>> {
    const { rows, total } = await this.page<any>(
      'audit.list',
      () =>
        this.db
          .from('audit_log')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .order('id'),
      q.offset,
      q.limit,
    );
    const staffIds = rows
      .filter((r) => r.actor_type === 'staff' && r.actor_id)
      .map((r) => r.actor_id as string);
    const studentIds = rows
      .filter((r) => r.actor_type === 'student' && r.actor_id)
      .map((r) => r.actor_id as string);
    const names = await this.staffNames(staffIds);
    const codes = await this.inChunks<any>(studentIds, async (p) =>
      ok(await this.db.from('students').select('id,public_code').in('id', p), 'audit.students'),
    );
    const codeById = new Map(codes.map((s) => [s.id, s.public_code as string]));
    return {
      total,
      items: rows.map((r): AuditEntryDto => ({
        id: r.id,
        actorType: r.actor_type,
        actorLabel:
          r.actor_type === 'staff'
            ? (names.get(r.actor_id) ?? null)
            : r.actor_type === 'student'
              ? (codeById.get(r.actor_id) ?? null)
              : null,
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata ?? {},
        createdAt: iso(r.created_at) as string,
      })),
    };
  }
}

let cached: { key: string; store: SupabaseStore } | null = null;

export function getSupabaseStore(config: AppConfig): SupabaseStore {
  const key = `${config.supabaseUrl}|${config.supabaseServiceKey?.length}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      store: new SupabaseStore(config.supabaseUrl as string, config.supabaseServiceKey as string),
    };
  }
  return cached.store;
}
