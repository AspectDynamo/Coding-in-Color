/**
 * Database row types — the contract between supabase/migrations (SQL) and the backend data stores.
 * Column names and types here MUST match the SQL exactly. Owned by the lead.
 * Backend-only: the frontend never receives raw rows (it receives the DTOs in api.ts).
 *
 * Conventions: uuid PKs default gen_random_uuid(); timestamps are timestamptz serialized as ISO
 * strings; numeric columns are returned as numbers; nullable columns are `| null`.
 */
import type {
  AgeBand,
  AssessmentStage,
  AttemptStatus,
  ConsentMethod,
  ConsentStatus,
  DeliveryMode,
  Difficulty,
  ProgramFormat,
  QuestionType,
  ReportType,
  SessionStatus,
  SkillCategory,
  StaffRole,
  StudentStatus,
} from './types';

export interface ProgramRow {
  id: string;
  name: string;
  slug: string; // unique
  description: string;
  format: ProgramFormat;
  status: 'active' | 'archived';
  created_at: string;
  updated_at: string;
}

export interface CourseRow {
  id: string;
  program_id: string; // fk programs
  name: string;
  description: string;
  status: 'active' | 'archived';
  created_at: string;
}

export interface CohortRow {
  id: string;
  program_id: string; // fk programs
  course_id: string; // fk courses (course.program_id must equal program_id — enforced by trigger or composite fk)
  name: string;
  delivery_mode: DeliveryMode;
  start_date: string; // date
  end_date: string; // date, check end_date >= start_date
  lead_instructor_id: string | null; // fk staff_users
  status: 'planned' | 'active' | 'completed' | 'archived';
  created_at: string;
}

export interface StaffUserRow {
  id: string;
  auth_user_id: string | null; // Supabase auth.users id; unique; null only for synthetic demo staff
  display_name: string;
  role: StaffRole;
  status: 'invited' | 'active' | 'disabled';
  is_synthetic: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface StaffProgramAssignmentRow {
  staff_id: string; // pk part, fk staff_users on delete cascade
  program_id: string; // pk part, fk programs on delete cascade
  created_at: string;
}

/** Pseudonymous student. NO names, emails, birthdates, IPs or device identifiers — ever. */
export interface StudentRow {
  id: string; // internal UUID, never shown to students or printed on cards
  public_code: string; // non-secret short pseudonymous label, e.g. "S-7KQ2M9"; unique
  age_band: AgeBand;
  status: StudentStatus;
  is_synthetic: boolean;
  created_at: string;
  updated_at: string;
}

export interface StudentCredentialRow {
  id: string;
  student_id: string; // fk students on delete cascade
  credential_hash: string; // hex HMAC-SHA256(pepper[key_version], normalized code); unique
  key_version: number;
  created_by: string | null; // fk staff_users
  created_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_used_at: string | null;
  // partial unique index: one active (revoked_at is null) credential per student
}

export interface CohortStudentRow {
  id: string;
  cohort_id: string; // fk cohorts on delete cascade
  student_id: string; // fk students on delete cascade
  roster_label: string; // cohort-local seat label, e.g. "07"; unique (cohort_id, roster_label)
  enrolled_at: string;
  status: 'enrolled' | 'withdrawn';
  // unique (cohort_id, student_id)
}

export interface ConsentRecordRow {
  id: string;
  student_id: string; // fk students on delete cascade
  consent_status: ConsentStatus;
  verification_method: ConsentMethod | null;
  notice_version: string;
  consent_timestamp: string | null;
  withdrawal_timestamp: string | null;
  recorded_by: string | null; // fk staff_users
  created_at: string;
}

/** Restricted: guardian contact for consent only. Never joined into analytics or shown to instructors. */
export interface GuardianContactRow {
  id: string;
  consent_record_id: string; // fk consent_records on delete cascade
  contact_method: 'email' | 'phone' | 'paper';
  contact_value: string;
  created_at: string;
}

export interface AssessmentRow {
  id: string;
  course_id: string | null; // fk courses (null = usable across courses)
  form_family: string; // equivalent forms share a family; pre/post matching requires same family
  form_label: string; // 'A', 'B', ...
  title: string;
  description: string;
  version: number; // bump when questions change; unique (form_family, form_label, version)
  difficulty: Difficulty;
  estimated_minutes: number; // check 1..15
  intended_stages: AssessmentStage[];
  skill_categories: SkillCategory[];
  status: 'draft' | 'active' | 'retired';
  created_at: string;
}

export interface QuestionRow {
  id: string;
  assessment_id: string; // fk assessments on delete cascade
  question_type: QuestionType;
  prompt: string;
  config: Record<string, unknown>; // public config (see validation.ts per type). NO answer data.
  skill_category: SkillCategory;
  difficulty: Difficulty;
  points: number; // numeric(5,2) >= 0; 0 for confidence_likert
  display_order: number; // unique (assessment_id, display_order)
}

/** Backend-only. Never selected by student-facing queries. */
export interface QuestionAnswerKeyRow {
  question_id: string; // pk, fk questions on delete cascade
  answer_key: Record<string, unknown>;
}

export interface AssessmentSessionRow {
  id: string;
  cohort_id: string; // fk cohorts
  assessment_id: string; // fk assessments
  stage: AssessmentStage;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  status: SessionStatus;
  created_by: string | null; // fk staff_users
  created_at: string;
}

export interface AssessmentAttemptRow {
  id: string;
  student_id: string; // fk students on delete cascade
  assessment_session_id: string; // fk assessment_sessions
  assessment_id: string; // fk assessments (denormalized from session; must match)
  assessment_version: number; // version the student saw
  cohort_id: string; // fk cohorts (denormalized from session; must match) — guards cross-cohort matching
  stage: AssessmentStage; // denormalized from session; must match
  status: AttemptStatus;
  raw_score: number | null; // null until submitted
  max_score: number | null;
  percentage_score: number | null; // numeric(5,2), 0..100, = round(100*raw/max, 2)
  self_reported_confidence: number | null; // mean of likert items, 1..5, null if none answered
  started_at: string;
  submitted_at: string | null;
  duration_seconds: number | null;
  created_at: string;
  // unique (student_id, assessment_session_id) where stage <> 'PRACTICE'
  // check raw_score <= max_score; check status='submitted' => scores not null
}

export interface AssessmentResponseRow {
  id: string;
  attempt_id: string; // fk assessment_attempts on delete cascade
  question_id: string; // fk questions
  response_data: Record<string, unknown>; // ResponseValue
  is_correct: boolean | null; // null for non-scored items
  earned_points: number;
  max_points: number;
  submitted_at: string;
  // unique (attempt_id, question_id)
}

/** Per-attempt skill sub-scores, written at submission for efficient skill reporting. */
export interface AttemptSkillScoreRow {
  attempt_id: string; // pk part, fk assessment_attempts on delete cascade
  skill_category: SkillCategory; // pk part
  earned_points: number;
  max_points: number; // > 0
}

export interface ProjectEvaluationRow {
  id: string;
  student_id: string;
  cohort_id: string;
  project_key: string;
  rubric_score: number;
  rubric_max: number;
  rubric_details: Record<string, unknown>;
  evaluated_at: string;
  evaluator_id: string | null;
}

export interface AiReportRow {
  id: string;
  report_type: ReportType;
  filters: Record<string, unknown>;
  input_metrics: Record<string, unknown>; // the exact aggregate payload sent to the model
  generated_content: Record<string, unknown>; // AiSummaryContent
  generation_mode: 'ai' | 'template';
  model_id: string | null;
  prompt_version: string;
  validation: Record<string, unknown>; // number-guard results
  saved: boolean;
  created_by: string | null; // fk staff_users
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  actor_type: 'staff' | 'student' | 'system';
  actor_id: string | null;
  action: string; // e.g. 'credential.reissue', 'student.delete', 'export.csv'
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>; // never secrets, codes or guardian contact values
  created_at: string;
}

/**
 * One matched pre/post pair (output of the `matched_pairs` SQL function / memory-store
 * equivalent). See docs/architecture.md § Matching rule.
 */
export interface MatchedPairRow {
  student_id: string;
  cohort_id: string;
  program_id: string;
  course_id: string;
  form_family: string;
  pre_attempt_id: string;
  post_attempt_id: string;
  pre_percentage: number;
  post_percentage: number;
  pre_submitted_at: string;
  post_submitted_at: string;
  pre_confidence: number | null;
  post_confidence: number | null;
  retention_attempt_id: string | null;
  retention_percentage: number | null;
  /** skill sub-scores keyed by skill category, as percentages 0..100 (only skills present). */
  pre_skills: Partial<Record<SkillCategory, number>>;
  post_skills: Partial<Record<SkillCategory, number>>;
}
