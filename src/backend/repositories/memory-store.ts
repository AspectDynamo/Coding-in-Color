/**
 * MemoryStore: the DataStore over the deterministic SYNTHETIC demo dataset. Per-isolate and reset
 * on restart. It enforces the same rules as the SQL schema (one non-PRACTICE attempt per
 * student+session, one in-progress attempt, one active credential per student, unique roster
 * labels / public codes / hashes) and implements matched pairs exactly as docs/architecture.md § 6.
 */
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
  AssessmentResponseRow,
  AssessmentRow,
  AssessmentSessionRow,
  AttemptSkillScoreRow,
  AuditLogRow,
  CohortStudentRow,
  ConsentRecordRow,
  MatchedPairRow,
  QuestionRow,
  StaffUserRow,
  StudentCredentialRow,
  StudentRow,
} from '@shared/db';
import type {
  AssessmentStage,
  ConsentStatus,
  SkillCategory,
  StaffRole,
  StudentStatus,
} from '@shared/types';
import type { AppConfig } from '../config';
import { generateDemoDataset } from '../demo/generate';
import type { DemoDataset } from '../demo/types';
import { hashAccessCode, normalizeAccessCode } from '../services/credentials';
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
  NewStudentInput,
  Page,
  QuestionWithKey,
  SessionContext,
  SessionProgressData,
  StudentEnrollment,
  SubmitAttemptInput,
} from './types';

const nowIso = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const r2 = (n: number) => Math.round(n * 100) / 100;
const ms = (iso: string) => Date.parse(iso);
const utcDate = (iso: string) => new Date(iso).toISOString().slice(0, 10);

let baseDataset: DemoDataset | null = null;
function freshDataset(): DemoDataset {
  baseDataset ??= generateDemoDataset();
  return structuredClone(baseDataset);
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'program'
  );
}

export class MemoryStore implements DataStore {
  readonly kind = 'memory' as const;
  private d: DemoDataset;
  private credentials: StudentCredentialRow[] = [];
  private aiReports: AiReportRow[] = [];

  private constructor(d: DemoDataset) {
    this.d = d;
  }

  static async create(pepper: string, keyVersion: number): Promise<MemoryStore> {
    const store = new MemoryStore(freshDataset());
    const base = Date.parse('2026-01-01T00:00:00Z');
    for (const dc of store.d.demoCredentials) {
      const normalized = normalizeAccessCode(dc.code);
      if (!normalized) continue;
      store.credentials.push({
        id: uuid(),
        student_id: dc.studentId,
        credential_hash: await hashAccessCode(normalized, pepper),
        key_version: keyVersion,
        created_by: null,
        created_at: new Date(base).toISOString(),
        revoked_at: null,
        revoked_reason: null,
        last_used_at: null,
      });
    }
    // Raw demo codes are only needed to derive hashes; drop them from the live state.
    store.d.demoCredentials = [];
    return store;
  }

  /* ------------------------------------------------------------ lookups */

  private student(id: string) {
    return this.d.students.find((s) => s.id === id) ?? null;
  }
  private cohortRow(id: string) {
    return this.d.cohorts.find((c) => c.id === id) ?? null;
  }
  private programName(id: string) {
    return this.d.programs.find((p) => p.id === id)?.name ?? '';
  }
  private courseName(id: string) {
    return this.d.courses.find((c) => c.id === id)?.name ?? '';
  }
  private enrolledIn(cohortId: string): CohortStudentRow[] {
    return this.d.cohortStudents.filter(
      (cs) => cs.cohort_id === cohortId && cs.status === 'enrolled',
    );
  }
  /** Ids of students whose records are excluded from every analytic (status 'withdrawn'). */
  private withdrawnIds(): Set<string> {
    return new Set(this.d.students.filter((s) => s.status === 'withdrawn').map((s) => s.id));
  }
  /** Enrolled seats that count in analytics/aggregates: withdrawn students are excluded. */
  private countedEnrolledIn(cohortId: string): CohortStudentRow[] {
    const withdrawn = this.withdrawnIds();
    return this.enrolledIn(cohortId).filter((cs) => !withdrawn.has(cs.student_id));
  }
  private assessmentOf(id: string): AssessmentRow | null {
    return this.d.assessments.find((a) => a.id === id) ?? null;
  }
  private questionsOf(assessmentId: string): QuestionRow[] {
    return this.d.questions
      .filter((q) => q.assessment_id === assessmentId)
      .sort((a, b) => a.display_order - b.display_order);
  }
  private staffName(id: string | null): string | null {
    return id ? (this.d.staff.find((s) => s.id === id)?.display_name ?? null) : null;
  }
  private programIdsOf(staffId: string): string[] {
    return this.d.staffAssignments.filter((a) => a.staff_id === staffId).map((a) => a.program_id);
  }

  private context(session: AssessmentSessionRow): SessionContext | null {
    const cohort = this.cohortRow(session.cohort_id);
    const assessment = this.assessmentOf(session.assessment_id);
    if (!cohort || !assessment) return null;
    const withdrawn = this.withdrawnIds();
    const submittedStudents = new Set(
      this.d.attempts
        .filter(
          (a) =>
            a.assessment_session_id === session.id &&
            a.status === 'submitted' &&
            !withdrawn.has(a.student_id),
        )
        .map((a) => a.student_id),
    );
    return {
      session,
      cohort: {
        id: cohort.id,
        name: cohort.name,
        programId: cohort.program_id,
        programName: this.programName(cohort.program_id),
        courseId: cohort.course_id,
        courseName: this.courseName(cohort.course_id),
      },
      assessment,
      questionCount: this.questionsOf(assessment.id).filter(
        (q) => q.question_type !== 'project_rubric',
      ).length,
      enrolledCount: this.countedEnrolledIn(cohort.id).length,
      submittedCount: submittedStudents.size,
    };
  }

  private cohortDto(c: {
    id: string;
    program_id: string;
    course_id: string;
    name: string;
    delivery_mode: CohortDto['deliveryMode'];
    start_date: string;
    end_date: string;
    lead_instructor_id: string | null;
    status: CohortDto['status'];
  }): CohortDto {
    const lead = c.lead_instructor_id
      ? this.d.staff.find((s) => s.id === c.lead_instructor_id)
      : null;
    return {
      id: c.id,
      programId: c.program_id,
      programName: this.programName(c.program_id),
      courseId: c.course_id,
      courseName: this.courseName(c.course_id),
      name: c.name,
      deliveryMode: c.delivery_mode,
      startDate: c.start_date,
      endDate: c.end_date,
      leadInstructor: lead ? { id: lead.id, displayName: lead.display_name } : null,
      status: c.status,
      enrolledCount: this.countedEnrolledIn(c.id).length,
    };
  }

  private assessmentSummary(a: AssessmentRow): AssessmentSummaryDto {
    return {
      id: a.id,
      courseId: a.course_id,
      formFamily: a.form_family,
      formLabel: a.form_label,
      title: a.title,
      version: a.version,
      difficulty: a.difficulty,
      estimatedMinutes: a.estimated_minutes,
      intendedStages: a.intended_stages,
      skillCategories: a.skill_categories,
      questionCount: this.questionsOf(a.id).length,
      status: a.status,
    };
  }

  private latestConsent(studentId: string): ConsentRecordRow | null {
    const rows = this.d.consentRecords
      .filter((r) => r.student_id === studentId)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));
    return rows[0] ?? null;
  }

  private consentDto(r: ConsentRecordRow): ConsentDto {
    const s = this.student(r.student_id);
    return {
      id: r.id,
      studentId: r.student_id,
      publicCode: s?.public_code ?? '',
      ageBand: s?.age_band ?? 'AGE_13_17',
      consentStatus: r.consent_status,
      verificationMethod: r.verification_method,
      noticeVersion: r.notice_version,
      consentTimestamp: r.consent_timestamp,
      withdrawalTimestamp: r.withdrawal_timestamp,
      hasGuardianContact: this.d.guardianContacts.some((g) => g.consent_record_id === r.id),
      createdAt: r.created_at,
    };
  }

  private reportDto(r: AiReportRow): AiReportDto {
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
      createdBy: this.staffName(r.created_by),
    };
  }

  private staffDto(s: StaffUserRow): StaffDto {
    return {
      id: s.id,
      displayName: s.display_name,
      role: s.role,
      status: s.status,
      programIds: this.programIdsOf(s.id),
      lastLoginAt: s.last_login_at,
      isSynthetic: s.is_synthetic,
    };
  }

  private listItem(s: StudentRow): StudentListItem {
    const cohorts = this.d.cohortStudents
      .filter((cs) => cs.student_id === s.id)
      .map((cs) => ({
        id: cs.cohort_id,
        name: this.cohortRow(cs.cohort_id)?.name ?? '',
        rosterLabel: cs.roster_label,
      }));
    const submitted = this.d.attempts
      .filter((a) => a.student_id === s.id && a.status === 'submitted')
      .sort((a, b) => ms(b.submitted_at ?? b.created_at) - ms(a.submitted_at ?? a.created_at));
    return {
      id: s.id,
      publicCode: s.public_code,
      ageBand: s.age_band,
      status: s.status,
      cohorts,
      attemptCount: submitted.length,
      latestScore: submitted[0]?.percentage_score ?? null,
      createdAt: s.created_at,
      isSynthetic: s.is_synthetic,
    };
  }

  /* ------------------------------------------------------- student auth */

  async findCredentialByHash(hash: string) {
    const credential = this.credentials.find((c) => c.credential_hash === hash);
    if (!credential) return null;
    const student = this.student(credential.student_id);
    return student ? { credential: { ...credential }, student: { ...student } } : null;
  }
  async getCredentialWithStudent(credentialId: string) {
    const credential = this.credentials.find((c) => c.id === credentialId);
    const student = credential ? this.student(credential.student_id) : null;
    return credential && student
      ? { credential: { ...credential }, student: { ...student } }
      : null;
  }
  async touchCredentialUsed(credentialId: string) {
    const c = this.credentials.find((x) => x.id === credentialId);
    if (c) c.last_used_at = nowIso();
  }
  async getStudent(id: string) {
    const s = this.student(id);
    return s ? { ...s } : null;
  }
  async listStudentEnrollments(studentId: string): Promise<StudentEnrollment[]> {
    return this.d.cohortStudents
      .filter((cs) => cs.student_id === studentId && cs.status === 'enrolled')
      .flatMap((cs) => {
        const c = this.cohortRow(cs.cohort_id);
        return c
          ? [
              {
                cohortId: c.id,
                cohortName: c.name,
                programId: c.program_id,
                programName: this.programName(c.program_id),
                rosterLabel: cs.roster_label,
              },
            ]
          : [];
      });
  }

  /* ------------------------------------------------ student assessments */

  async listStudentSessions(studentId: string) {
    const cohortIds = new Set(
      (await this.listStudentEnrollments(studentId)).map((e) => e.cohortId),
    );
    const out: { context: SessionContext; attempt: AssessmentAttemptRow | null }[] = [];
    for (const session of this.d.sessions.filter((s) => cohortIds.has(s.cohort_id))) {
      const context = this.context(session);
      if (context)
        out.push({ context, attempt: await this.getStudentAttempt(studentId, session.id) });
    }
    return out;
  }
  async getSessionContext(sessionId: string) {
    const s = this.d.sessions.find((x) => x.id === sessionId);
    return s ? this.context(s) : null;
  }
  async isEnrolled(studentId: string, cohortId: string) {
    return this.d.cohortStudents.some(
      (cs) => cs.student_id === studentId && cs.cohort_id === cohortId && cs.status === 'enrolled',
    );
  }
  async listQuestions(assessmentId: string) {
    return this.questionsOf(assessmentId).map((q) => ({ ...q }));
  }
  async listQuestionsWithKeys(assessmentId: string): Promise<QuestionWithKey[]> {
    return this.questionsOf(assessmentId).map((q) => ({
      ...q,
      answer_key: this.d.answerKeys.find((k) => k.question_id === q.id)?.answer_key ?? null,
    }));
  }
  async getStudentAttempt(studentId: string, sessionId: string) {
    const rows = this.d.attempts.filter(
      (a) => a.student_id === studentId && a.assessment_session_id === sessionId,
    );
    const open = rows.find((a) => a.status === 'in_progress');
    if (open) return { ...open };
    const submitted = rows
      .filter((a) => a.status === 'submitted')
      .sort((a, b) => ms(b.submitted_at ?? '') - ms(a.submitted_at ?? ''));
    return submitted[0] ? { ...submitted[0] } : null;
  }
  async getAttempt(attemptId: string) {
    const a = this.d.attempts.find((x) => x.id === attemptId);
    return a ? { ...a } : null;
  }
  async startAttempt(input: AttemptStartInput) {
    const { studentId, session, assessment } = input;
    const existing = this.d.attempts.find(
      (a) =>
        a.student_id === studentId &&
        a.assessment_session_id === session.id &&
        a.status === 'in_progress',
    );
    if (existing) return { attempt: { ...existing }, created: false };
    if (
      session.stage !== 'PRACTICE' &&
      this.d.attempts.some(
        (a) =>
          a.student_id === studentId &&
          a.assessment_session_id === session.id &&
          a.status === 'submitted',
      )
    ) {
      throw new StoreError('already_submitted');
    }
    const ts = nowIso();
    const attempt: AssessmentAttemptRow = {
      id: uuid(),
      student_id: studentId,
      assessment_session_id: session.id,
      assessment_id: assessment.id,
      assessment_version: assessment.version,
      cohort_id: session.cohort_id,
      stage: session.stage,
      status: 'in_progress',
      raw_score: null,
      max_score: null,
      percentage_score: null,
      self_reported_confidence: null,
      started_at: ts,
      submitted_at: null,
      duration_seconds: null,
      created_at: ts,
    };
    this.d.attempts.push(attempt);
    return { attempt: { ...attempt }, created: true };
  }
  async submitAttempt(input: SubmitAttemptInput) {
    const attempt = this.d.attempts.find(
      (a) => a.id === input.attemptId && a.student_id === input.studentId,
    );
    if (!attempt) throw new StoreError('attempt_not_found');
    if (attempt.status !== 'in_progress') throw new StoreError('already_submitted');
    const ts = nowIso();
    const responses: AssessmentResponseRow[] = input.responses.map((r) => ({
      id: uuid(),
      attempt_id: attempt.id,
      question_id: r.question_id,
      response_data: r.response_data,
      is_correct: r.is_correct,
      earned_points: r.earned_points,
      max_points: r.max_points,
      submitted_at: ts,
    }));
    const skills: AttemptSkillScoreRow[] = input.skills.map((s) => ({
      attempt_id: attempt.id,
      skill_category: s.skill_category,
      earned_points: s.earned_points,
      max_points: s.max_points,
    }));
    this.d.responses.push(...responses);
    this.d.skillScores.push(...skills);
    Object.assign(attempt, {
      status: 'submitted',
      raw_score: input.rawScore,
      max_score: input.maxScore,
      percentage_score: input.percentageScore,
      self_reported_confidence: input.selfReportedConfidence,
      duration_seconds: input.durationSeconds,
      submitted_at: ts,
    } satisfies Partial<AssessmentAttemptRow>);
    return { ...attempt };
  }
  async listStudentSubmittedAttempts(studentId: string) {
    return this.d.attempts
      .filter(
        (a) =>
          a.student_id === studentId &&
          a.status === 'submitted' &&
          a.submitted_at &&
          a.percentage_score !== null,
      )
      .sort((a, b) => ms(a.submitted_at!) - ms(b.submitted_at!))
      .map((a) => ({
        attemptId: a.id,
        title:
          this.d.sessions.find((s) => s.id === a.assessment_session_id)?.title ??
          this.assessmentOf(a.assessment_id)?.title ??
          '',
        stage: a.stage,
        submittedAt: a.submitted_at!,
        percentageScore: a.percentage_score!,
      }));
  }

  /* ------------------------------------------------------------ catalog */

  async listPrograms(): Promise<ProgramDto[]> {
    return this.d.programs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      format: p.format,
      status: p.status,
      courseCount: this.d.courses.filter((c) => c.program_id === p.id).length,
      cohortCount: this.d.cohorts.filter((c) => c.program_id === p.id).length,
    }));
  }
  async listCourses(): Promise<CourseDto[]> {
    return this.d.courses.map((c) => ({
      id: c.id,
      programId: c.program_id,
      name: c.name,
      description: c.description,
      status: c.status,
    }));
  }
  async listCohorts(): Promise<CohortDto[]> {
    return this.d.cohorts.map((c) => this.cohortDto(c));
  }
  async getCohort(id: string) {
    const c = this.cohortRow(id);
    return c ? this.cohortDto(c) : null;
  }
  async getCourse(id: string) {
    return (await this.listCourses()).find((c) => c.id === id) ?? null;
  }
  async createProgram(input: { name: string; description: string; format: ProgramDto['format'] }) {
    let slug = slugify(input.name);
    while (this.d.programs.some((p) => p.slug === slug))
      slug = `${slug}-${Math.floor(Math.random() * 1000)}`;
    const ts = nowIso();
    const row = {
      id: uuid(),
      name: input.name,
      slug,
      description: input.description,
      format: input.format,
      status: 'active' as const,
      created_at: ts,
      updated_at: ts,
    };
    this.d.programs.push(row);
    return (await this.listPrograms()).find((p) => p.id === row.id)!;
  }
  async createCourse(input: { programId: string; name: string; description: string }) {
    if (this.d.courses.some((c) => c.program_id === input.programId && c.name === input.name))
      throw new StoreError('duplicate');
    const row = {
      id: uuid(),
      program_id: input.programId,
      name: input.name,
      description: input.description,
      status: 'active' as const,
      created_at: nowIso(),
    };
    this.d.courses.push(row);
    return {
      id: row.id,
      programId: row.program_id,
      name: row.name,
      description: row.description,
      status: row.status,
    };
  }
  async createCohort(input: {
    programId: string;
    courseId: string;
    name: string;
    deliveryMode: CohortDto['deliveryMode'];
    startDate: string;
    endDate: string;
    leadInstructorId: string | null;
  }) {
    const row = {
      id: uuid(),
      program_id: input.programId,
      course_id: input.courseId,
      name: input.name,
      delivery_mode: input.deliveryMode,
      start_date: input.startDate,
      end_date: input.endDate,
      lead_instructor_id: input.leadInstructorId,
      status: 'planned' as const,
      created_at: nowIso(),
    };
    this.d.cohorts.push(row);
    return this.cohortDto(row);
  }
  async listAssessments(opts?: { status?: AssessmentRow['status'] }) {
    return this.d.assessments
      .filter((a) => !opts?.status || a.status === opts.status)
      .map((a) => this.assessmentSummary(a));
  }
  async getAssessmentDetail(id: string, includeKeys: boolean): Promise<AssessmentDetailDto | null> {
    const a = this.assessmentOf(id);
    if (!a) return null;
    return {
      ...this.assessmentSummary(a),
      description: a.description,
      questions: this.questionsOf(id).map((q) => ({
        id: q.id,
        type: q.question_type,
        prompt: q.prompt,
        config: q.config,
        skillCategory: q.skill_category,
        points: q.points,
        order: q.display_order,
        difficulty: q.difficulty,
        ...(includeKeys
          ? { answerKey: this.d.answerKeys.find((k) => k.question_id === q.id)?.answer_key ?? null }
          : {}),
      })),
    };
  }
  async createAssessment(input: NewAssessmentInput) {
    const versions = this.d.assessments
      .filter((a) => a.form_family === input.formFamily && a.form_label === input.formLabel)
      .map((a) => a.version);
    const row: AssessmentRow = {
      id: uuid(),
      course_id: input.courseId,
      form_family: input.formFamily,
      form_label: input.formLabel,
      title: input.title,
      description: input.description,
      version: (versions.length ? Math.max(...versions) : 0) + 1,
      difficulty: input.difficulty,
      estimated_minutes: input.estimatedMinutes,
      intended_stages: input.intendedStages,
      skill_categories: input.skillCategories,
      status: 'draft',
      created_at: nowIso(),
    };
    this.d.assessments.push(row);
    for (const q of input.questions) {
      const id = uuid();
      this.d.questions.push({
        id,
        assessment_id: row.id,
        question_type: q.question_type,
        prompt: q.prompt,
        config: q.config,
        skill_category: q.skill_category,
        difficulty: q.difficulty,
        points: q.points,
        display_order: q.display_order,
      });
      if (q.answer_key) this.d.answerKeys.push({ question_id: id, answer_key: q.answer_key });
    }
    return this.assessmentSummary(row);
  }
  async updateAssessmentStatus(id: string, status: AssessmentRow['status']) {
    const a = this.assessmentOf(id);
    if (!a) return null;
    a.status = status;
    return this.assessmentSummary(a);
  }

  /* --------------------------------------------------------- instructor */

  async listRoster(cohortId: string): Promise<RosterEntryDto[]> {
    return this.enrolledIn(cohortId)
      .flatMap((cs) => {
        const s = this.student(cs.student_id);
        if (!s) return [];
        const consent = this.latestConsent(s.id);
        return [
          {
            studentId: s.id,
            rosterLabel: cs.roster_label,
            publicCode: s.public_code,
            ageBand: s.age_band,
            status: s.status,
            hasActiveCredential: this.credentials.some(
              (c) => c.student_id === s.id && !c.revoked_at,
            ),
            consent: (consent?.consent_status ?? 'not_required') as ConsentStatus,
          },
        ];
      })
      .sort((a, b) => a.rosterLabel.localeCompare(b.rosterLabel, undefined, { numeric: true }));
  }
  async listSessions(filter?: { cohortIds?: string[] }) {
    const ids = filter?.cohortIds ? new Set(filter.cohortIds) : null;
    return this.d.sessions
      .filter((s) => !ids || ids.has(s.cohort_id))
      .flatMap((s) => {
        const ctx = this.context(s);
        return ctx ? [ctx] : [];
      });
  }
  async createSession(input: Parameters<DataStore['createSession']>[0]) {
    const row: AssessmentSessionRow = {
      id: uuid(),
      cohort_id: input.cohortId,
      assessment_id: input.assessmentId,
      stage: input.stage,
      title: input.title,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      status: input.status,
      created_by: input.createdBy,
      created_at: nowIso(),
    };
    this.d.sessions.push(row);
    return this.context(row)!;
  }
  async updateSessionStatus(id: string, status: 'open' | 'closed') {
    const s = this.d.sessions.find((x) => x.id === id);
    if (!s) return null;
    s.status = status;
    return this.context(s);
  }
  async getSessionProgressData(sessionId: string): Promise<SessionProgressData> {
    const session = this.d.sessions.find((s) => s.id === sessionId);
    if (!session) return { roster: [], submitted: [] };
    const attempts = this.d.attempts.filter((a) => a.assessment_session_id === sessionId);
    // Withdrawn students are omitted from the progress roster (and so from enrolled / submitted /
    // aggregate); they stay visible in listRoster().
    const counted = this.countedEnrolledIn(session.cohort_id);
    const roster = counted.flatMap((cs) => {
      const s = this.student(cs.student_id);
      if (!s) return [];
      const mine = attempts.filter((a) => a.student_id === s.id);
      const attemptStatus: 'submitted' | 'in_progress' | null = mine.some(
        (a) => a.status === 'submitted',
      )
        ? 'submitted'
        : mine.some((a) => a.status === 'in_progress')
          ? 'in_progress'
          : null;
      return [
        {
          rosterLabel: cs.roster_label,
          publicCode: s.public_code,
          studentStatus: s.status,
          attemptStatus,
        },
      ];
    });
    const enrolledIds = new Set(counted.map((cs) => cs.student_id));
    const submitted = attempts
      .filter(
        (a) =>
          a.status === 'submitted' && a.percentage_score !== null && enrolledIds.has(a.student_id),
      )
      .map((a) => ({
        durationSeconds: a.duration_seconds,
        percentage: a.percentage_score as number,
      }));
    return { roster, submitted };
  }

  async createStudentsWithCredentials(
    input: Parameters<DataStore['createStudentsWithCredentials']>[0],
  ): Promise<CreatedStudent[]> {
    const { cohortId, createdBy, students } = input;
    for (const s of students) {
      if (this.d.students.some((x) => x.public_code === s.publicCode))
        throw new StoreError('public_code_conflict');
      if (this.credentials.some((c) => c.credential_hash === s.credentialHash))
        throw new StoreError('duplicate');
    }
    const used = this.d.cohortStudents
      .filter((cs) => cs.cohort_id === cohortId)
      .map((cs) => Number.parseInt(cs.roster_label, 10))
      .filter((n) => Number.isFinite(n));
    let next = (used.length ? Math.max(...used) : 0) + 1;
    const created: CreatedStudent[] = [];
    const ts = nowIso();
    for (const s of students as NewStudentInput[]) {
      const id = uuid();
      const label = String(next++).padStart(2, '0');
      this.d.students.push({
        id,
        public_code: s.publicCode,
        age_band: s.ageBand,
        status: s.status,
        is_synthetic: true,
        created_at: ts,
        updated_at: ts,
      });
      this.d.cohortStudents.push({
        id: uuid(),
        cohort_id: cohortId,
        student_id: id,
        roster_label: label,
        enrolled_at: ts,
        status: 'enrolled',
      });
      this.credentials.push({
        id: uuid(),
        student_id: id,
        credential_hash: s.credentialHash,
        key_version: s.keyVersion,
        created_by: createdBy,
        created_at: ts,
        revoked_at: null,
        revoked_reason: null,
        last_used_at: null,
      });
      if (input.pendingConsentNoticeVersion) {
        this.d.consentRecords.push({
          id: uuid(),
          student_id: id,
          consent_status: 'pending',
          verification_method: null,
          notice_version: input.pendingConsentNoticeVersion,
          consent_timestamp: null,
          withdrawal_timestamp: null,
          recorded_by: createdBy,
          created_at: ts,
        });
      }
      created.push({ studentId: id, publicCode: s.publicCode, rosterLabel: label });
    }
    return created;
  }

  async reissueCredential(input: Parameters<DataStore['reissueCredential']>[0]) {
    const cs = this.d.cohortStudents.find(
      (x) =>
        x.cohort_id === input.cohortId &&
        x.roster_label === input.rosterLabel &&
        x.status === 'enrolled',
    );
    const student = cs ? this.student(cs.student_id) : null;
    if (!cs || !student) return null;
    const ts = nowIso();
    for (const c of this.credentials) {
      if (c.student_id === student.id && !c.revoked_at) {
        c.revoked_at = ts;
        c.revoked_reason = input.reason;
      }
    }
    this.credentials.push({
      id: uuid(),
      student_id: student.id,
      credential_hash: input.newHash,
      key_version: input.keyVersion,
      created_by: input.staffId,
      created_at: ts,
      revoked_at: null,
      revoked_reason: null,
      last_used_at: null,
    });
    return { studentId: student.id, publicCode: student.public_code, rosterLabel: cs.roster_label };
  }

  /* ---------------------------------------------------------- analytics */

  async getMatchedPairs(
    cohortIds: string[],
    from?: string,
    to?: string,
  ): Promise<MatchedPairRow[]> {
    const ids = new Set(cohortIds);
    const family = (a: AssessmentAttemptRow) =>
      this.assessmentOf(a.assessment_id)?.form_family ?? '';
    const withdrawn = this.withdrawnIds();
    const sub = this.d.attempts.filter(
      (a) =>
        a.status === 'submitted' &&
        a.submitted_at &&
        a.percentage_score !== null &&
        (a.stage === 'PRE' || a.stage === 'POST' || a.stage === 'RETENTION') &&
        ids.has(a.cohort_id) &&
        !withdrawn.has(a.student_id),
    );
    const key = (a: AssessmentAttemptRow) => `${a.student_id}|${a.cohort_id}|${family(a)}`;
    const byStage = (stage: AssessmentStage) => sub.filter((a) => a.stage === stage);
    const cmpAsc = (a: AssessmentAttemptRow, b: AssessmentAttemptRow) =>
      ms(a.submitted_at!) - ms(b.submitted_at!) || a.id.localeCompare(b.id);

    const earliestPre = new Map<string, AssessmentAttemptRow>();
    for (const a of byStage('PRE').sort(cmpAsc))
      if (!earliestPre.has(key(a))) earliestPre.set(key(a), a);

    const skillsOf = (attemptId: string): Partial<Record<SkillCategory, number>> => {
      const out: Partial<Record<SkillCategory, number>> = {};
      for (const k of this.d.skillScores)
        if (k.attempt_id === attemptId && k.max_points > 0)
          out[k.skill_category] = r2((100 * k.earned_points) / k.max_points);
      return out;
    };

    const rows: MatchedPairRow[] = [];
    for (const pre of earliestPre.values()) {
      const k = key(pre);
      const post = byStage('POST')
        .filter((p) => key(p) === k && ms(p.submitted_at!) > ms(pre.submitted_at!))
        .sort((a, b) => cmpAsc(b, a))[0];
      if (!post) continue;
      const d = utcDate(post.submitted_at!);
      if ((from && d < from) || (to && d > to)) continue;
      const retention = byStage('RETENTION')
        .filter((r) => key(r) === k && ms(r.submitted_at!) > ms(post.submitted_at!))
        .sort((a, b) => cmpAsc(b, a))[0];
      const cohort = this.cohortRow(pre.cohort_id)!;
      rows.push({
        student_id: pre.student_id,
        cohort_id: pre.cohort_id,
        program_id: cohort.program_id,
        course_id: cohort.course_id,
        form_family: family(pre),
        pre_attempt_id: pre.id,
        post_attempt_id: post.id,
        pre_percentage: pre.percentage_score!,
        post_percentage: post.percentage_score!,
        pre_submitted_at: pre.submitted_at!,
        post_submitted_at: post.submitted_at!,
        pre_confidence: pre.self_reported_confidence,
        post_confidence: post.self_reported_confidence,
        retention_attempt_id: retention?.id ?? null,
        retention_percentage: retention?.percentage_score ?? null,
        pre_skills: skillsOf(pre.id),
        post_skills: skillsOf(post.id),
      });
    }
    return rows.sort(
      (a, b) =>
        a.cohort_id.localeCompare(b.cohort_id) ||
        a.student_id.localeCompare(b.student_id) ||
        a.form_family.localeCompare(b.form_family),
    );
  }

  async listSubmittedAttemptsInScope(cohortIds: string[], from?: string, to?: string) {
    const ids = new Set(cohortIds);
    const withdrawn = this.withdrawnIds();
    return this.d.attempts
      .filter((a) => {
        if (
          a.status !== 'submitted' ||
          !a.submitted_at ||
          a.stage === 'PRACTICE' ||
          !ids.has(a.cohort_id) ||
          withdrawn.has(a.student_id)
        )
          return false;
        const d = utcDate(a.submitted_at);
        return (!from || d >= from) && (!to || d <= to);
      })
      .map((a) => ({ stage: a.stage, cohort_id: a.cohort_id, submitted_at: a.submitted_at! }));
  }

  async listRecentSessionActivity(
    cohortIds: string[],
    limit: number,
  ): Promise<RecentActivityItem[]> {
    const ids = new Set(cohortIds);
    const withdrawn = this.withdrawnIds();
    const lastSubmit = new Map<string, number>();
    for (const a of this.d.attempts) {
      if (a.status !== 'submitted' || !a.submitted_at || withdrawn.has(a.student_id)) continue;
      const t = Date.parse(a.submitted_at);
      if (Number.isNaN(t)) continue;
      const cur = lastSubmit.get(a.assessment_session_id);
      if (cur === undefined || t > cur) lastSubmit.set(a.assessment_session_id, t);
    }
    return this.d.sessions
      .filter((s) => ids.has(s.cohort_id))
      .map((s) => ({
        s,
        at: lastSubmit.get(s.id) ?? Date.parse(s.created_at),
      }))
      .sort((a, b) => b.at - a.at || a.s.id.localeCompare(b.s.id))
      .slice(0, Math.max(0, limit))
      .flatMap(({ s, at }) => {
        const ctx = this.context(s);
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
    const ids = new Set(cohortIds);
    const withdrawn = this.withdrawnIds();
    const students = new Set(
      this.d.cohortStudents
        .filter(
          (cs) =>
            ids.has(cs.cohort_id) && cs.status === 'enrolled' && !withdrawn.has(cs.student_id),
        )
        .map((cs) => cs.student_id),
    );
    return { total: students.size, synthetic: students.size };
  }

  /* ----------------------------------------------------------- students */

  async listStudents(q: {
    q?: string;
    cohortId?: string;
    limit: number;
    offset: number;
  }): Promise<Page<StudentListItem>> {
    const prefix = q.q?.trim().toUpperCase();
    const inCohort = q.cohortId
      ? new Set(
          this.d.cohortStudents
            .filter((cs) => cs.cohort_id === q.cohortId)
            .map((cs) => cs.student_id),
        )
      : null;
    const all = this.d.students
      .filter(
        (s) => (!prefix || s.public_code.startsWith(prefix)) && (!inCohort || inCohort.has(s.id)),
      )
      .sort(
        (a, b) => ms(b.created_at) - ms(a.created_at) || a.public_code.localeCompare(b.public_code),
      );
    return {
      items: all.slice(q.offset, q.offset + q.limit).map((s) => this.listItem(s)),
      total: all.length,
    };
  }

  async getStudentHistory(id: string): Promise<StudentHistory | null> {
    const s = this.student(id);
    if (!s) return null;
    const consent = this.latestConsent(id);
    const creds = this.credentials
      .filter((c) => c.student_id === id)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const active = creds.find((c) => !c.revoked_at) ?? null;
    const lastUsed =
      creds
        .map((c) => c.last_used_at)
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null;
    return {
      student: this.listItem(s),
      consent: consent
        ? {
            status: consent.consent_status,
            noticeVersion: consent.notice_version,
            consentTimestamp: consent.consent_timestamp,
          }
        : null,
      attempts: this.d.attempts
        .filter(
          (a) =>
            a.student_id === id &&
            a.status === 'submitted' &&
            a.submitted_at &&
            a.percentage_score !== null,
        )
        .sort((a, b) => ms(a.submitted_at!) - ms(b.submitted_at!))
        .map((a) => ({
          attemptId: a.id,
          sessionTitle: this.d.sessions.find((x) => x.id === a.assessment_session_id)?.title ?? '',
          assessmentTitle: this.assessmentOf(a.assessment_id)?.title ?? '',
          cohortName: this.cohortRow(a.cohort_id)?.name ?? '',
          stage: a.stage,
          submittedAt: a.submitted_at!,
          percentageScore: a.percentage_score!,
          durationSeconds: a.duration_seconds,
          skills: this.d.skillScores
            .filter((k) => k.attempt_id === a.id && k.max_points > 0)
            .map((k) => ({
              skill: k.skill_category,
              percentage: r2((100 * k.earned_points) / k.max_points),
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
    const s = this.student(id);
    if (s) {
      s.status = status;
      s.updated_at = nowIso();
    }
  }

  async deleteStudent(id: string) {
    const s = this.student(id);
    if (!s) return null;
    const attemptIds = new Set(this.d.attempts.filter((a) => a.student_id === id).map((a) => a.id));
    const consentIds = new Set(
      this.d.consentRecords.filter((r) => r.student_id === id).map((r) => r.id),
    );
    this.d.responses = this.d.responses.filter((r) => !attemptIds.has(r.attempt_id));
    this.d.skillScores = this.d.skillScores.filter((k) => !attemptIds.has(k.attempt_id));
    this.d.attempts = this.d.attempts.filter((a) => a.student_id !== id);
    this.d.guardianContacts = this.d.guardianContacts.filter(
      (g) => !consentIds.has(g.consent_record_id),
    );
    this.d.consentRecords = this.d.consentRecords.filter((r) => r.student_id !== id);
    this.d.cohortStudents = this.d.cohortStudents.filter((cs) => cs.student_id !== id);
    this.credentials = this.credentials.filter((c) => c.student_id !== id);
    this.d.students = this.d.students.filter((x) => x.id !== id);
    return { publicCode: s.public_code };
  }

  /* ------------------------------------------------------------ consent */

  async listConsent(q: {
    status?: ConsentStatus;
    limit: number;
    offset: number;
  }): Promise<Page<ConsentDto>> {
    const rows = this.d.consentRecords
      .filter((r) => !q.status || r.consent_status === q.status)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));
    return {
      items: rows.slice(q.offset, q.offset + q.limit).map((r) => this.consentDto(r)),
      total: rows.length,
    };
  }
  async getConsent(id: string) {
    const r = this.d.consentRecords.find((x) => x.id === id);
    return r ? this.consentDto(r) : null;
  }
  async recordConsent(input: ConsentWriteInput) {
    const ts = nowIso();
    const row: ConsentRecordRow = {
      id: uuid(),
      student_id: input.studentId,
      consent_status: input.consentStatus,
      verification_method: input.verificationMethod,
      notice_version: input.noticeVersion,
      consent_timestamp: input.consentStatus === 'granted' ? ts : null,
      withdrawal_timestamp: input.consentStatus === 'withdrawn' ? ts : null,
      recorded_by: input.recordedBy,
      created_at: ts,
    };
    this.d.consentRecords.push(row);
    if (input.guardianContact) {
      this.d.guardianContacts.push({
        id: uuid(),
        consent_record_id: row.id,
        contact_method: input.guardianContact.method,
        contact_value: input.guardianContact.value,
        created_at: ts,
      });
    }
    const s = this.student(input.studentId);
    if (s) {
      if (input.consentStatus === 'granted' && s.status === 'pending_consent') s.status = 'active';
      if (input.consentStatus === 'withdrawn') s.status = 'withdrawn';
      s.updated_at = ts;
    }
    return this.consentDto(row);
  }
  async withdrawConsent(id: string) {
    const r = this.d.consentRecords.find((x) => x.id === id);
    if (!r) return null;
    const ts = nowIso();
    r.consent_status = 'withdrawn';
    r.withdrawal_timestamp = ts;
    const s = this.student(r.student_id);
    if (s) {
      s.status = 'withdrawn';
      s.updated_at = ts;
    }
    return this.consentDto(r);
  }

  /* --------------------------------------------------------- AI reports */

  async insertAiReport(input: NewAiReportInput) {
    const row: AiReportRow = {
      id: uuid(),
      report_type: input.reportType,
      filters: input.filters as Record<string, unknown>,
      input_metrics: input.inputMetrics,
      generated_content: input.content,
      generation_mode: input.generationMode,
      model_id: input.modelId,
      prompt_version: input.promptVersion,
      validation: input.validation,
      saved: false,
      created_by: input.createdBy,
      created_at: nowIso(),
    };
    this.aiReports.push(row);
    return this.reportDto(row);
  }
  async listAiReports(q: {
    limit: number;
    offset: number;
    savedOnly: boolean;
  }): Promise<Page<AiReportDto>> {
    const rows = this.aiReports
      .filter((r) => !q.savedOnly || r.saved)
      .sort((a, b) => ms(b.created_at) - ms(a.created_at));
    return {
      items: rows.slice(q.offset, q.offset + q.limit).map((r) => this.reportDto(r)),
      total: rows.length,
    };
  }
  async getAiReport(id: string) {
    const r = this.aiReports.find((x) => x.id === id);
    return r ? this.reportDto(r) : null;
  }
  async setAiReportSaved(id: string, saved: boolean) {
    const r = this.aiReports.find((x) => x.id === id);
    if (!r) return null;
    r.saved = saved;
    return this.reportDto(r);
  }
  async deleteAiReport(id: string) {
    const n = this.aiReports.length;
    this.aiReports = this.aiReports.filter((r) => r.id !== id);
    return this.aiReports.length < n;
  }

  /* -------------------------------------------------------------- staff */

  async getStaff(id: string) {
    const s = this.d.staff.find((x) => x.id === id);
    return s ? { staff: { ...s }, programIds: this.programIdsOf(s.id) } : null;
  }
  async getStaffByAuthUserId(authUserId: string) {
    const s = this.d.staff.find((x) => x.auth_user_id === authUserId);
    return s ? { staff: { ...s }, programIds: this.programIdsOf(s.id) } : null;
  }
  async getStaffByRole(role: StaffRole, synthetic: boolean) {
    const s = this.d.staff.find(
      (x) => x.role === role && x.is_synthetic === synthetic && x.status === 'active',
    );
    return s ? { staff: { ...s }, programIds: this.programIdsOf(s.id) } : null;
  }
  async touchStaffLogin(id: string) {
    const s = this.d.staff.find((x) => x.id === id);
    if (!s) return;
    s.last_login_at = nowIso();
    if (s.status === 'invited') s.status = 'active';
  }
  async listStaff() {
    return this.d.staff.map((s) => this.staffDto(s));
  }
  async createStaff(input: NewStaffInput) {
    if (input.authUserId && this.d.staff.some((s) => s.auth_user_id === input.authUserId))
      throw new StoreError('duplicate');
    const row: StaffUserRow = {
      id: uuid(),
      auth_user_id: input.authUserId,
      display_name: input.displayName,
      role: input.role,
      status: input.status,
      is_synthetic: input.isSynthetic,
      created_at: nowIso(),
      last_login_at: null,
    };
    this.d.staff.push(row);
    for (const programId of input.programIds)
      this.d.staffAssignments.push({
        staff_id: row.id,
        program_id: programId,
        created_at: nowIso(),
      });
    return this.staffDto(row);
  }
  async updateStaff(
    id: string,
    patch: { role?: StaffRole; status?: 'active' | 'disabled'; programIds?: string[] },
  ) {
    const s = this.d.staff.find((x) => x.id === id);
    if (!s) return null;
    if (patch.role) s.role = patch.role;
    if (patch.status) s.status = patch.status;
    if (patch.programIds) {
      this.d.staffAssignments = this.d.staffAssignments.filter((a) => a.staff_id !== id);
      for (const programId of patch.programIds)
        this.d.staffAssignments.push({ staff_id: id, program_id: programId, created_at: nowIso() });
    }
    return this.staffDto(s);
  }

  /* -------------------------------------------------------------- audit */

  async appendAudit(entry: AuditAppendInput) {
    const row: AuditLogRow = {
      id: uuid(),
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      metadata: entry.metadata ?? {},
      created_at: nowIso(),
    };
    this.d.auditLog.push(row);
  }
  async listAudit(q: { limit: number; offset: number }): Promise<Page<AuditEntryDto>> {
    const rows = [...this.d.auditLog].sort((a, b) => ms(b.created_at) - ms(a.created_at));
    const items = rows.slice(q.offset, q.offset + q.limit).map((r): AuditEntryDto => ({
      id: r.id,
      actorType: r.actor_type,
      actorLabel:
        r.actor_type === 'staff'
          ? this.staffName(r.actor_id)
          : r.actor_type === 'student'
            ? (this.student(r.actor_id ?? '')?.public_code ?? null)
            : null,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
    return { items, total: rows.length };
  }
}

/* ------------------------------------------------------------------------ */

let instance: { key: string; promise: Promise<MemoryStore> } | null = null;

/** Test helper: drop the per-isolate store so the next request starts from a fresh dataset. */
export function resetMemoryStore(): void {
  instance = null;
}

/** Per-isolate singleton, rebuilt only when the pepper / key version changes (hashes depend on them). */
export function getMemoryStore(config: AppConfig): Promise<MemoryStore> {
  const key = `${config.credentialPepper}|${config.keyVersion}`;
  if (!instance || instance.key !== key) {
    instance = { key, promise: MemoryStore.create(config.credentialPepper, config.keyVersion) };
  }
  return instance.promise;
}
