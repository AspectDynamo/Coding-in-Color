/**
 * API contract: envelopes, DTOs and the endpoint list. Owned by the lead (Opus).
 * All endpoints live under /api/v1. JSON in/out. Request bodies are validated with the
 * schemas in validation.ts. The frontend must import these types rather than redefine them.
 *
 * Auth model
 *  - Students: POST /student/session with an access code -> HttpOnly cookie `cic_student`.
 *  - Staff:    POST /auth/login (Supabase Auth) or /auth/demo-login (synthetic demo store only)
 *              -> HttpOnly cookie `cic_staff`.
 *  - CSRF:     the API sets a readable cookie `cic_csrf`; every POST/PUT/PATCH/DELETE must send
 *              header `X-CSRF-Token` equal to it. Mutations also require a same-origin `Origin`.
 */
import type {
  AgeBand,
  AssessmentStage,
  AttemptStatus,
  ConsentMethod,
  ConsentStatus,
  DeliveryMode,
  Difficulty,
  Permission,
  ProgramFormat,
  QuestionType,
  ReportType,
  SessionStatus,
  SkillCategory,
  StaffRole,
  StudentStatus,
} from './types';
import type { DashboardFilters, ResponseValue } from './validation';

export const API_BASE = '/api/v1';
export const CSRF_COOKIE = 'cic_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

export interface ApiSuccess<T> {
  data: T;
}
export interface Page {
  limit: number;
  offset: number;
  total: number;
}
export interface ApiPage<T> {
  data: T[];
  page: Page;
}
export type ApiErrorCode =
  | 'bad_request' // 400 validation failure (details = zod issues, field paths only)
  | 'unauthenticated' // 401
  | 'invalid_code' // 401 student code unknown/revoked/invalid (identical for all three)
  | 'mfa_required' // 401 staff must complete MFA
  | 'forbidden' // 403
  | 'csrf_failed' // 403
  | 'consent_required' // 403 student blocked until consent recorded
  | 'not_found' // 404
  | 'conflict' // 409 e.g. already submitted
  | 'session_closed' // 409 assessment session not open
  | 'rate_limited' // 429
  | 'ai_unavailable' // 503 Workers AI failed (template fallback still offered)
  | 'not_configured' // 503 data store not configured
  | 'internal'; // 500
export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}

/* ------------------------------------------------------------------ */
/* Public config                                                       */
/* ------------------------------------------------------------------ */

/** GET /config */
export interface PublicConfig {
  appEnv: 'development' | 'production';
  demoMode: boolean;
  dataStore: 'memory' | 'supabase';
  /** Demo staff login buttons are only allowed when the store is the synthetic memory store. */
  demoLoginEnabled: boolean;
  under13RegistrationEnabled: boolean;
  aiEnabled: boolean;
  suppressionThreshold: number;
}

/* ------------------------------------------------------------------ */
/* Staff auth                                                          */
/* ------------------------------------------------------------------ */

export interface StaffProfile {
  id: string;
  displayName: string;
  role: StaffRole;
  permissions: Permission[];
  programIds: string[]; // assigned programs (instructors); owners/admins/analysts see all
  isSynthetic: boolean;
}
/** POST /auth/login -> LoginResult; POST /auth/mfa/verify -> { staff }; POST /auth/demo-login -> { staff } */
export type LoginResult =
  | { status: 'ok'; staff: StaffProfile }
  | { status: 'mfa_required'; factors: { id: string; type: 'totp' }[] }
  /** MFA is required but the account has no verified TOTP factor yet: call POST /auth/mfa/enroll. */
  | { status: 'mfa_enroll_required' };
/**
 * POST /auth/mfa/enroll (no body; needs the short-lived cic_mfa cookie from /auth/login) -> MfaEnrollment.
 * Then POST /auth/mfa/verify { factorId, code } verifies the new factor and issues the staff session.
 */
export interface MfaEnrollment {
  factorId: string;
  /** SVG QR code as a data: URI, for authenticator apps. */
  qrCode: string;
  /** Base32 secret for manual entry. Shown once; never stored by the app. */
  secret: string;
}
/** GET /auth/me -> StaffProfile. POST /auth/logout -> { ok: true }. POST /auth/password-reset -> { ok: true } (always). */

/* ------------------------------------------------------------------ */
/* Student                                                             */
/* ------------------------------------------------------------------ */

/** POST /student/session, GET /student/me */
export interface StudentMe {
  publicCode: string;
  ageBand: AgeBand;
  status: StudentStatus;
  cohorts: { id: string; name: string; programName: string }[];
}

/** GET /student/assessments — open sessions in the student's cohorts */
export interface StudentAssessmentSummary {
  sessionId: string;
  assessmentId: string;
  title: string;
  stage: AssessmentStage;
  cohortName: string;
  programName: string;
  estimatedMinutes: number;
  questionCount: number;
  state: 'available' | 'in_progress' | 'completed';
  closesAt: string | null;
}

/** Question as shown to a student. `config` is the public config only — NEVER answer keys. */
export interface PublicQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  config: Record<string, unknown>;
  skillCategory: SkillCategory;
  points: number;
  order: number;
}

/** GET /student/assessments/:sessionId */
export interface StudentAssessmentDetail {
  sessionId: string;
  assessmentId: string;
  assessmentVersion: number;
  title: string;
  description: string;
  stage: AssessmentStage;
  estimatedMinutes: number;
  questions: PublicQuestion[]; // ordering items are pre-shuffled server-side
  attempt: { id: string; status: AttemptStatus; startedAt: string } | null;
}

/** POST /student/assessments/:sessionId/start -> AttemptStarted (idempotent: returns the existing in-progress attempt) */
export interface AttemptStarted {
  attemptId: string;
  startedAt: string;
}

/** POST /student/assessments/:sessionId/submit (body: submitAttemptBody) -> SubmitResult. 409 conflict if already submitted. */
export interface SubmitResult {
  attemptId: string;
  submittedAt: string;
  answeredCount: number;
  totalQuestions: number;
  durationSeconds: number;
}

/** GET /student/progress — the student's own completed attempts (scores only; no per-question correctness). */
export interface StudentProgress {
  attempts: {
    attemptId: string;
    title: string;
    stage: AssessmentStage;
    submittedAt: string;
    percentageScore: number;
  }[];
}

/* ------------------------------------------------------------------ */
/* Catalog (programs, courses, cohorts, assessments)                   */
/* ------------------------------------------------------------------ */

export interface ProgramDto {
  id: string;
  name: string;
  description: string;
  format: ProgramFormat;
  status: 'active' | 'archived';
  courseCount: number;
  cohortCount: number;
}
export interface CourseDto {
  id: string;
  programId: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
}
export interface CohortDto {
  id: string;
  programId: string;
  programName: string;
  courseId: string;
  courseName: string;
  name: string;
  deliveryMode: DeliveryMode;
  startDate: string;
  endDate: string;
  leadInstructor: { id: string; displayName: string } | null;
  status: 'planned' | 'active' | 'completed' | 'archived';
  enrolledCount: number;
}
export interface AssessmentSummaryDto {
  id: string;
  courseId: string | null;
  formFamily: string;
  formLabel: string;
  title: string;
  version: number;
  difficulty: Difficulty;
  estimatedMinutes: number;
  intendedStages: AssessmentStage[];
  skillCategories: SkillCategory[];
  questionCount: number;
  status: 'draft' | 'active' | 'retired';
}
/** GET /admin/assessments/:id — staff preview; includes answer keys ONLY for catalog.manage holders. */
export interface AssessmentDetailDto extends AssessmentSummaryDto {
  description: string;
  questions: (PublicQuestion & {
    difficulty: Difficulty;
    answerKey?: Record<string, unknown> | null;
  })[];
}

/* ------------------------------------------------------------------ */
/* Instructor                                                          */
/* ------------------------------------------------------------------ */

export interface AssessmentSessionDto {
  id: string;
  cohortId: string;
  cohortName: string;
  programName: string;
  assessmentId: string;
  assessmentTitle: string;
  stage: AssessmentStage;
  title: string;
  status: SessionStatus;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  enrolledCount: number;
  submittedCount: number;
  /** Shareable URL for remote/voice-chat sessions: students open it and use their own code. */
  joinUrl: string;
}

/** GET /instructor/assessment-sessions/:id/progress */
export interface SessionProgressDto {
  session: AssessmentSessionDto;
  enrolled: number;
  notStarted: number;
  inProgress: number;
  submitted: number;
  completionRate: number; // submitted / enrolled * 100, 0..100
  medianDurationSeconds: number | null;
  /** Pseudonymous seat-level status only — no scores per student. */
  roster: {
    rosterLabel: string;
    publicCode: string;
    status: 'not_started' | 'in_progress' | 'submitted' | 'blocked_consent';
  }[];
  /** Aggregate session score; null when submitted < suppressionThreshold (shown as "suppressed"). */
  aggregate: { averagePercentage: number; n: number } | null;
  suppressionThreshold: number;
}

/** GET /instructor/cohorts/:id/roster */
export interface RosterEntryDto {
  studentId: string; // needed for admin links; instructors never see history
  rosterLabel: string;
  publicCode: string;
  ageBand: AgeBand;
  status: StudentStatus;
  hasActiveCredential: boolean;
  consent: ConsentStatus; // 'not_required' for 13+
}

/**
 * POST /instructor/student-credentials -> IssuedCredential[]
 * POST /instructor/student-credentials/reissue -> IssuedCredential (1 item)
 * The raw accessCode appears ONLY in this response (for printing cards) and is never retrievable again.
 */
export interface IssuedCredential {
  studentId: string;
  publicCode: string;
  rosterLabel: string;
  cohortName: string;
  accessCode: string; // formatted XXXX-XXXX-XXXX-XXXX
  /** Card QR URL: `${origin}/s#code=${accessCode}` — fragment so the code never reaches server logs. */
  accessUrl: string;
  requiresConsent: boolean;
}

/* ------------------------------------------------------------------ */
/* Admin — impact metrics                                              */
/* ------------------------------------------------------------------ */

/** Numeric stat that may be suppressed for small groups in external outputs. */
export interface SuppressibleNumber {
  value: number | null; // null when suppressed or undefined
  suppressed: boolean;
}

export interface ImpactKpis {
  totalStudentRecords: number; // all pseudonymous records in scope
  enrolledStudents: number; // enrolled in filtered cohorts
  preCompletions: number;
  postCompletions: number;
  retentionCompletions: number;
  matchedPairs: number; // n behind every pre/post metric
  completionRate: number | null; // postCompletions / enrolledStudents * 100
  matchRate: number | null; // matchedPairs / preCompletions * 100
}

export interface ImpactMetrics {
  n: number; // matched sample size
  averagePre: number | null; // mean pre %, matched only
  averagePost: number | null; // mean post %, matched only
  /** Mean of (post − pre) in PERCENTAGE POINTS. */
  averageChangePoints: number | null;
  /** (averagePost − averagePre) / averagePre * 100 in PERCENT; null when averagePre is 0 ("undefined"). */
  relativeChangePercent: number | null;
  relativeChangeUndefined: boolean;
  /** True in external (suppressed) views when n < threshold: outcome values are null and counts are zeroed. */
  suppressed?: boolean;
  improvedPercent: number | null; // share of matched students with post > pre
  unchangedPercent: number | null; // post == pre (to 2 dp)
  declinedPercent: number | null; // post < pre
  improvedCount: number;
  unchangedCount: number;
  declinedCount: number;
  /** Statistical context: 95% CI of the mean change (points) and paired effect size d_z. Null when n < 2. */
  changeCi95: { low: number; high: number } | null;
  effectSizeDz: number | null;
  /** Self-reported confidence (1..5), reported separately from measured scores. */
  confidence: { n: number; averagePre: number | null; averagePost: number | null } | null;
  /** Retention: matched students who also completed a RETENTION assessment. */
  retention: { n: number; averagePost: number | null; averageRetention: number | null } | null;
}

export interface SkillImpact {
  skill: SkillCategory;
  n: number; // matched students with this skill on both forms
  averagePre: number | null;
  averagePost: number | null;
  averageChangePoints: number | null;
  suppressed: boolean; // n < threshold (external outputs hide values)
}

export interface ScoreDistributionBucket {
  bucket: string; // '0-19', '20-39', '40-59', '60-79', '80-100'
  pre: number; // count of matched students
  post: number;
}

export interface ChangeDistributionBucket {
  bucket: string; // e.g. '≤ -20', '-19 to -1', '0', '1 to 19', '20 to 39', '≥ 40' (points)
  count: number;
}

export interface CohortComparisonRow {
  cohortId: string;
  cohortName: string;
  programName: string;
  courseName: string;
  enrolled: number;
  matched: number;
  averagePre: number | null;
  averagePost: number | null;
  averageChangePoints: number | null;
  improvedPercent: number | null;
  suppressed: boolean;
}

/**
 * Recent assessment-session activity in the dashboard's scope (participation counts only — no
 * scores, no student-level data). Newest first, at most 6.
 */
export interface RecentActivityItem {
  sessionId: string;
  title: string;
  cohortName: string;
  programName: string;
  stage: AssessmentStage;
  status: SessionStatus;
  enrolledCount: number; // non-withdrawn enrolled seats in the cohort
  submittedCount: number; // submitted attempts by non-withdrawn students
  /** Most recent submission in the session, else the session's creation time. */
  lastActivityAt: string;
}

export interface TrendPoint {
  period: string; // 'YYYY-MM'
  preCompletions: number;
  postCompletions: number;
  averageChangePoints: number | null; // for pairs whose POST fell in this period
  matched: number;
}

/**
 * GET /admin/dashboard?filters                 — internal view (values shown, small groups flagged)
 * GET /admin/dashboard?filters&view=external   — suppressed view (suppressForExternal); REQUIRED for
 *                                                printable/PDF reports and anything shared outside staff.
 */
export interface ImpactDashboard {
  filters: DashboardFilters;
  generatedAt: string;
  isSyntheticData: boolean;
  /** True when this is the suppressed external view (?view=external). */
  externalView?: boolean;
  assessmentPeriod: { from: string | null; to: string | null }; // min/max POST submitted dates in scope
  suppressionThreshold: number;
  kpis: ImpactKpis;
  metrics: ImpactMetrics;
  skills: SkillImpact[];
  scoreDistribution: ScoreDistributionBucket[];
  changeDistribution: ChangeDistributionBucket[];
  cohorts: CohortComparisonRow[];
  trend: TrendPoint[];
  /** Plain-language limitations always displayed with metrics (e.g. "Pre/post design without a comparison group; observed changes are not proof of causation."). */
  limitations: string[];
  /** Recent session activity in scope (newest first, ≤ 6). Empty array when none. */
  recentActivity: RecentActivityItem[];
}

/** GET /admin/filters */
export interface FilterOptions {
  programs: { id: string; name: string }[];
  courses: { id: string; name: string; programId: string }[];
  cohorts: { id: string; name: string; programId: string; courseId: string }[];
  instructors: { id: string; displayName: string }[];
  skills: SkillCategory[];
}

/* ------------------------------------------------------------------ */
/* Admin — students                                                    */
/* ------------------------------------------------------------------ */

/** GET /admin/students -> ApiPage<StudentListItem> (requires students.view_individual) */
export interface StudentListItem {
  id: string;
  publicCode: string;
  ageBand: AgeBand;
  status: StudentStatus;
  cohorts: { id: string; name: string; rosterLabel: string }[];
  attemptCount: number;
  latestScore: number | null;
  createdAt: string;
  isSynthetic: boolean;
}

/** GET /admin/students/:id */
export interface StudentHistory {
  student: StudentListItem;
  consent: {
    status: ConsentStatus;
    noticeVersion: string | null;
    consentTimestamp: string | null;
  } | null;
  attempts: {
    attemptId: string;
    sessionTitle: string;
    assessmentTitle: string;
    cohortName: string;
    stage: AssessmentStage;
    submittedAt: string;
    percentageScore: number;
    durationSeconds: number | null;
    skills: { skill: SkillCategory; percentage: number }[];
  }[];
  credential: {
    active: boolean;
    createdAt: string | null;
    lastUsedAt: string | null;
    reissueCount: number;
  };
}
/** POST /admin/students/:id/withdraw -> { ok: true }; DELETE /admin/students/:id -> { ok: true } (hard delete, audited) */

/* ------------------------------------------------------------------ */
/* Admin — consent                                                     */
/* ------------------------------------------------------------------ */

/** GET /admin/consent?status= -> ApiPage<ConsentDto>. Guardian contact value is NEVER returned in lists. */
export interface ConsentDto {
  id: string;
  studentId: string;
  publicCode: string;
  ageBand: AgeBand;
  consentStatus: ConsentStatus;
  verificationMethod: ConsentMethod | null;
  noticeVersion: string;
  consentTimestamp: string | null;
  withdrawalTimestamp: string | null;
  hasGuardianContact: boolean;
  createdAt: string;
}
/** POST /admin/consent (consentRecordBody) -> ConsentDto; POST /admin/consent/:id/withdraw -> ConsentDto */

/* ------------------------------------------------------------------ */
/* Admin — AI reports & exports                                        */
/* ------------------------------------------------------------------ */

export interface AiSummaryContent {
  headline: string;
  summary: string;
  key_findings: string[];
  areas_for_improvement: string[];
  recommendations: string[];
  limitations: string[];
}

export interface AiReportDto {
  id: string;
  reportType: ReportType;
  filters: DashboardFilters;
  content: AiSummaryContent;
  generationMode: 'ai' | 'template'; // template = deterministic non-AI fallback
  modelId: string | null;
  promptVersion: string;
  /** Number guard: numbers in the narrative not traceable to the input metrics. Empty = clean. */
  validation: { unverifiedNumbers: string[]; passed: boolean };
  /** The exact aggregate payload the model saw (for transparency). */
  inputMetrics: Record<string, unknown>;
  saved: boolean;
  createdAt: string;
  createdBy: string | null; // display name
}
/**
 * POST /admin/reports/summarize (summarizeBody) -> AiReportDto
 *   On model failure: 503 ai_unavailable with details { fallback: AiReportDto } (template-mode report).
 * GET  /admin/reports -> ApiPage<AiReportDto> (saved reports)
 * POST /admin/reports/:id/save -> AiReportDto
 * DELETE /admin/reports/:id -> { ok: true }
 * GET  /admin/exports/impact.csv?filters -> text/csv (cohort-level aggregates, suppressed)
 * GET  /admin/exports/skills.csv?filters -> text/csv (skill-level aggregates, suppressed)
 * GET  /instructor/assessment-sessions/:id/export.csv -> text/csv (session aggregate, suppressed)
 * Printable PDF reports are rendered by the frontend at /admin/reports/print?filters using
 * GET /admin/dashboard data and the browser's print-to-PDF.
 */

/* ------------------------------------------------------------------ */
/* Admin — staff & audit                                               */
/* ------------------------------------------------------------------ */

export interface StaffDto {
  id: string;
  displayName: string;
  role: StaffRole;
  status: 'invited' | 'active' | 'disabled';
  programIds: string[];
  lastLoginAt: string | null;
  isSynthetic: boolean;
}
/** GET /admin/staff, POST /admin/staff (inviteStaffBody), PATCH /admin/staff/:id (updateStaffBody) — owner only */

export interface AuditEntryDto {
  id: string;
  actorType: 'staff' | 'student' | 'system';
  actorLabel: string | null; // staff display name or student public code
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}
/** GET /admin/audit-log -> ApiPage<AuditEntryDto> — owner/admin */

/* ------------------------------------------------------------------ */
/* Endpoint registry (documentation + frontend service typing)         */
/* ------------------------------------------------------------------ */

export const ENDPOINTS = {
  health: 'GET /health',
  config: 'GET /config',
  // staff auth
  login: 'POST /auth/login',
  mfaVerify: 'POST /auth/mfa/verify',
  mfaEnroll: 'POST /auth/mfa/enroll',
  demoLogin: 'POST /auth/demo-login',
  logout: 'POST /auth/logout',
  me: 'GET /auth/me',
  passwordReset: 'POST /auth/password-reset',
  // student
  studentSession: 'POST /student/session',
  studentLogout: 'POST /student/logout',
  studentMe: 'GET /student/me',
  studentAssessments: 'GET /student/assessments',
  studentAssessment: 'GET /student/assessments/:sessionId',
  studentStart: 'POST /student/assessments/:sessionId/start',
  studentSubmit: 'POST /student/assessments/:sessionId/submit',
  studentProgress: 'GET /student/progress',
  // instructor (scoped to assigned programs; admins/owners see all)
  instructorPrograms: 'GET /instructor/programs',
  instructorCohorts: 'GET /instructor/cohorts',
  instructorRoster: 'GET /instructor/cohorts/:id/roster',
  instructorAssessments: 'GET /instructor/assessments',
  createSession: 'POST /instructor/assessment-sessions',
  listSessions: 'GET /instructor/assessment-sessions',
  getSession: 'GET /instructor/assessment-sessions/:id',
  updateSession: 'PATCH /instructor/assessment-sessions/:id',
  sessionProgress: 'GET /instructor/assessment-sessions/:id/progress',
  sessionExport: 'GET /instructor/assessment-sessions/:id/export.csv',
  issueCredentials: 'POST /instructor/student-credentials',
  reissueCredential: 'POST /instructor/student-credentials/reissue',
  // admin
  dashboard: 'GET /admin/dashboard',
  filters: 'GET /admin/filters',
  students: 'GET /admin/students',
  student: 'GET /admin/students/:id',
  withdrawStudent: 'POST /admin/students/:id/withdraw',
  deleteStudent: 'DELETE /admin/students/:id',
  programs: 'GET /admin/programs',
  createProgram: 'POST /admin/programs',
  courses: 'GET /admin/courses',
  createCourse: 'POST /admin/courses',
  cohorts: 'GET /admin/cohorts',
  createCohort: 'POST /admin/cohorts',
  assessments: 'GET /admin/assessments',
  assessment: 'GET /admin/assessments/:id',
  createAssessment: 'POST /admin/assessments',
  updateAssessmentStatus: 'PATCH /admin/assessments/:id',
  consentList: 'GET /admin/consent',
  recordConsent: 'POST /admin/consent',
  withdrawConsent: 'POST /admin/consent/:id/withdraw',
  reports: 'GET /admin/reports',
  summarize: 'POST /admin/reports/summarize',
  saveReport: 'POST /admin/reports/:id/save',
  deleteReport: 'DELETE /admin/reports/:id',
  exportImpact: 'GET /admin/exports/impact.csv',
  exportSkills: 'GET /admin/exports/skills.csv',
  staff: 'GET /admin/staff',
  inviteStaff: 'POST /admin/staff',
  updateStaff: 'PATCH /admin/staff/:id',
  auditLog: 'GET /admin/audit-log',
} as const;

export type { ResponseValue, DashboardFilters };
