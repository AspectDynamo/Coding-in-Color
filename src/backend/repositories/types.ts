/**
 * DataStore: every persistence operation the routes need. Implemented by MemoryStore (synthetic
 * demo data) and SupabaseStore (supabase-js, service role). The store performs NO authorization:
 * routes decide who may call what, then pass already-scoped ids in.
 *
 * Rules every implementation must follow:
 *  - answer keys are returned ONLY by `listQuestionsWithKeys` and `getAssessmentDetail(id, true)`;
 *  - guardian contact values are write-only here: no method returns them (lists expose hasGuardianContact);
 *  - raw access codes never enter the store (hashes only);
 *  - throw StoreError for expected business-rule failures (see utils/errors.ts).
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
  AssessmentRow,
  AssessmentSessionRow,
  GuardianContactRow,
  MatchedPairRow,
  QuestionRow,
  StaffUserRow,
  StudentCredentialRow,
  StudentRow,
} from '@shared/db';
import type {
  AgeBand,
  AssessmentStage,
  ConsentMethod,
  ConsentStatus,
  DeliveryMode,
  Difficulty,
  ProgramFormat,
  QuestionType,
  SessionStatus,
  SkillCategory,
  StaffRole,
  StudentStatus,
} from '@shared/types';
import type { DashboardFilters } from '@shared/validation';

export type DataStoreKind = 'memory' | 'supabase';

export interface Page<T> {
  items: T[];
  total: number;
}

/** A session with everything needed to render or authorize it. */
export interface SessionContext {
  session: AssessmentSessionRow;
  cohort: {
    id: string;
    name: string;
    programId: string;
    programName: string;
    courseId: string;
    courseName: string;
  };
  assessment: AssessmentRow;
  questionCount: number;
  enrolledCount: number;
  submittedCount: number;
}

export interface StudentEnrollment {
  cohortId: string;
  cohortName: string;
  programId: string;
  programName: string;
  rosterLabel: string;
}

export interface AttemptStartInput {
  studentId: string;
  session: AssessmentSessionRow;
  assessment: AssessmentRow;
}

export interface SubmitAttemptInput {
  attemptId: string;
  studentId: string;
  rawScore: number;
  maxScore: number;
  percentageScore: number;
  selfReportedConfidence: number | null;
  durationSeconds: number;
  responses: {
    question_id: string;
    response_data: Record<string, unknown>;
    is_correct: boolean | null;
    earned_points: number;
    max_points: number;
  }[];
  skills: { skill_category: SkillCategory; earned_points: number; max_points: number }[];
}

export type QuestionWithKey = QuestionRow & { answer_key: Record<string, unknown> | null };

export interface SessionProgressData {
  roster: {
    rosterLabel: string;
    publicCode: string;
    studentStatus: StudentStatus;
    attemptStatus: 'in_progress' | 'submitted' | null;
  }[];
  submitted: { durationSeconds: number | null; percentage: number }[];
}

export interface NewStudentInput {
  publicCode: string;
  ageBand: AgeBand;
  status: StudentStatus;
  credentialHash: string;
  keyVersion: number;
}
export interface CreatedStudent {
  studentId: string;
  publicCode: string;
  rosterLabel: string;
}

export interface NewQuestionInput {
  question_type: QuestionType;
  prompt: string;
  config: Record<string, unknown>;
  skill_category: SkillCategory;
  difficulty: Difficulty;
  points: number;
  display_order: number;
  answer_key: Record<string, unknown> | null;
}
export interface NewAssessmentInput {
  courseId: string | null;
  formFamily: string;
  formLabel: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  estimatedMinutes: number;
  intendedStages: AssessmentStage[];
  skillCategories: SkillCategory[];
  questions: NewQuestionInput[];
}

export interface ConsentWriteInput {
  studentId: string;
  consentStatus: ConsentStatus;
  verificationMethod: ConsentMethod | null;
  noticeVersion: string;
  recordedBy: string;
  guardianContact?: { method: GuardianContactRow['contact_method']; value: string };
}

export interface NewStaffInput {
  authUserId: string | null;
  displayName: string;
  role: StaffRole;
  status: StaffUserRow['status'];
  isSynthetic: boolean;
  programIds: string[];
}

export interface AuditAppendInput {
  actorType: 'staff' | 'student' | 'system';
  actorId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NewAiReportInput {
  reportType: AiReportRow['report_type'];
  filters: DashboardFilters;
  inputMetrics: Record<string, unknown>;
  content: Record<string, unknown>;
  generationMode: 'ai' | 'template';
  modelId: string | null;
  promptVersion: string;
  validation: Record<string, unknown>;
  createdBy: string | null;
}

export interface DataStore {
  readonly kind: DataStoreKind;

  /* ---- student auth ---- */
  /** Returns the credential even when revoked; the caller treats revoked/withdrawn as invalid. */
  findCredentialByHash(
    hash: string,
  ): Promise<{ credential: StudentCredentialRow; student: StudentRow } | null>;
  getCredentialWithStudent(
    credentialId: string,
  ): Promise<{ credential: StudentCredentialRow; student: StudentRow } | null>;
  touchCredentialUsed(credentialId: string): Promise<void>;
  getStudent(id: string): Promise<StudentRow | null>;
  listStudentEnrollments(studentId: string): Promise<StudentEnrollment[]>;

  /* ---- student assessments ---- */
  /** All sessions (any status) of the student's enrolled cohorts, with the student's latest attempt. */
  listStudentSessions(
    studentId: string,
  ): Promise<{ context: SessionContext; attempt: AssessmentAttemptRow | null }[]>;
  getSessionContext(sessionId: string): Promise<SessionContext | null>;
  isEnrolled(studentId: string, cohortId: string): Promise<boolean>;
  listQuestions(assessmentId: string): Promise<QuestionRow[]>;
  listQuestionsWithKeys(assessmentId: string): Promise<QuestionWithKey[]>;
  /** in_progress attempt if any, else the latest submitted one. */
  getStudentAttempt(studentId: string, sessionId: string): Promise<AssessmentAttemptRow | null>;
  getAttempt(attemptId: string): Promise<AssessmentAttemptRow | null>;
  /** Idempotent. Throws StoreError('already_submitted') when a non-PRACTICE attempt is already submitted. */
  startAttempt(
    input: AttemptStartInput,
  ): Promise<{ attempt: AssessmentAttemptRow; created: boolean }>;
  /** Atomic (RPC `submit_attempt` / memory equivalent). Throws 'attempt_not_found' | 'already_submitted'. */
  submitAttempt(input: SubmitAttemptInput): Promise<AssessmentAttemptRow>;
  listStudentSubmittedAttempts(studentId: string): Promise<
    {
      attemptId: string;
      title: string;
      stage: AssessmentStage;
      submittedAt: string;
      percentageScore: number;
    }[]
  >;

  /* ---- catalog ---- */
  listPrograms(): Promise<ProgramDto[]>;
  listCourses(): Promise<CourseDto[]>;
  listCohorts(): Promise<CohortDto[]>;
  getCohort(id: string): Promise<CohortDto | null>;
  getCourse(id: string): Promise<CourseDto | null>;
  createProgram(input: {
    name: string;
    description: string;
    format: ProgramFormat;
  }): Promise<ProgramDto>;
  createCourse(input: { programId: string; name: string; description: string }): Promise<CourseDto>;
  createCohort(input: {
    programId: string;
    courseId: string;
    name: string;
    deliveryMode: DeliveryMode;
    startDate: string;
    endDate: string;
    leadInstructorId: string | null;
  }): Promise<CohortDto>;
  listAssessments(opts?: { status?: AssessmentRow['status'] }): Promise<AssessmentSummaryDto[]>;
  getAssessmentDetail(id: string, includeKeys: boolean): Promise<AssessmentDetailDto | null>;
  createAssessment(input: NewAssessmentInput): Promise<AssessmentSummaryDto>;
  updateAssessmentStatus(
    id: string,
    status: AssessmentRow['status'],
  ): Promise<AssessmentSummaryDto | null>;

  /* ---- instructor ---- */
  listRoster(cohortId: string): Promise<RosterEntryDto[]>;
  listSessions(filter?: { cohortIds?: string[] }): Promise<SessionContext[]>;
  createSession(input: {
    cohortId: string;
    assessmentId: string;
    stage: AssessmentStage;
    title: string;
    startsAt: string | null;
    endsAt: string | null;
    status: SessionStatus;
    createdBy: string;
  }): Promise<SessionContext>;
  updateSessionStatus(id: string, status: 'open' | 'closed'): Promise<SessionContext | null>;
  getSessionProgressData(sessionId: string): Promise<SessionProgressData>;
  /**
   * Creates students + enrollments (next roster labels) + credentials (hash only) [+ pending consent
   * records]. Memory: all-or-nothing. Supabase: sequential inserts, deleting created students (which
   * cascades) on any failure, so a partial batch never survives. Throws StoreError('public_code_conflict'
   * | 'roster_conflict') when the caller should retry with fresh values.
   */
  createStudentsWithCredentials(input: {
    cohortId: string;
    createdBy: string;
    pendingConsentNoticeVersion: string | null;
    students: NewStudentInput[];
  }): Promise<CreatedStudent[]>;
  /** Revokes the seat's active credential and issues the new hash for the same student (RPC `reissue_credential`). */
  reissueCredential(input: {
    cohortId: string;
    rosterLabel: string;
    newHash: string;
    keyVersion: number;
    staffId: string;
    reason: string;
  }): Promise<{ studentId: string; publicCode: string; rosterLabel: string } | null>;

  /* ---- analytics inputs ---- */
  getMatchedPairs(cohortIds: string[], from?: string, to?: string): Promise<MatchedPairRow[]>;
  listSubmittedAttemptsInScope(
    cohortIds: string[],
    from?: string,
    to?: string,
  ): Promise<{ stage: AssessmentStage; cohort_id: string; submitted_at: string }[]>;
  countStudentRecords(cohortIds: string[]): Promise<{ total: number; synthetic: number }>;
  /**
   * Most recent assessment sessions in the given (already scoped) cohorts, newest first, at most
   * `limit`. Participation counts only; withdrawn students are excluded from enrolledCount,
   * submittedCount and lastActivityAt. lastActivityAt = latest submitted_at among counted submitted
   * attempts of the session, else the session's created_at. Ties break on session id (ascending).
   */
  listRecentSessionActivity(cohortIds: string[], limit: number): Promise<RecentActivityItem[]>;

  /* ---- students (admin) ---- */
  listStudents(q: {
    q?: string;
    cohortId?: string;
    limit: number;
    offset: number;
  }): Promise<Page<StudentListItem>>;
  getStudentHistory(id: string): Promise<StudentHistory | null>;
  setStudentStatus(id: string, status: StudentStatus): Promise<void>;
  /** Hard delete with cascade. Returns the public code (for the audit entry) or null if not found. */
  deleteStudent(id: string): Promise<{ publicCode: string } | null>;

  /* ---- consent ---- */
  listConsent(q: {
    status?: ConsentStatus;
    limit: number;
    offset: number;
  }): Promise<Page<ConsentDto>>;
  getConsent(id: string): Promise<ConsentDto | null>;
  /** Creates a consent record (+ separate guardian contact); updates student status accordingly. */
  recordConsent(input: ConsentWriteInput): Promise<ConsentDto>;
  withdrawConsent(id: string): Promise<ConsentDto | null>;

  /* ---- AI reports ---- */
  insertAiReport(input: NewAiReportInput): Promise<AiReportDto>;
  listAiReports(q: {
    limit: number;
    offset: number;
    savedOnly: boolean;
  }): Promise<Page<AiReportDto>>;
  getAiReport(id: string): Promise<AiReportDto | null>;
  setAiReportSaved(id: string, saved: boolean): Promise<AiReportDto | null>;
  deleteAiReport(id: string): Promise<boolean>;

  /* ---- staff ---- */
  getStaff(id: string): Promise<{ staff: StaffUserRow; programIds: string[] } | null>;
  getStaffByAuthUserId(
    authUserId: string,
  ): Promise<{ staff: StaffUserRow; programIds: string[] } | null>;
  getStaffByRole(
    role: StaffRole,
    synthetic: boolean,
  ): Promise<{ staff: StaffUserRow; programIds: string[] } | null>;
  touchStaffLogin(id: string): Promise<void>;
  listStaff(): Promise<StaffDto[]>;
  createStaff(input: NewStaffInput): Promise<StaffDto>;
  updateStaff(
    id: string,
    patch: { role?: StaffRole; status?: 'active' | 'disabled'; programIds?: string[] },
  ): Promise<StaffDto | null>;

  /* ---- audit ---- */
  appendAudit(entry: AuditAppendInput): Promise<void>;
  listAudit(q: { limit: number; offset: number }): Promise<Page<AuditEntryDto>>;
}

export type { GuardianContactRow };
