/**
 * Shared domain vocabulary. Owned by the lead (Opus). Frontend and backend import from here;
 * do not redefine these elsewhere. Request changes instead of editing.
 */

export const AGE_BANDS = ['UNDER_13', 'AGE_13_17', 'AGE_18_PLUS'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const ASSESSMENT_STAGES = ['PRE', 'POST', 'RETENTION', 'PRACTICE'] as const;
export type AssessmentStage = (typeof ASSESSMENT_STAGES)[number];

export const PROGRAM_FORMATS = [
  'workshop', // ~1-3 hours
  'hackathon', // ~6-12 hours
  'camp', // multi-day summer camp
  'semester',
  'year_long',
  'ai_academy',
  'community',
] as const;
export type ProgramFormat = (typeof PROGRAM_FORMATS)[number];

export const DELIVERY_MODES = ['in_person', 'remote', 'hybrid'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const SKILL_CATEGORIES = [
  'programming_fundamentals',
  'variables',
  'data_types',
  'conditionals',
  'loops',
  'functions',
  'debugging',
  'logic',
  'problem_solving',
  'code_comprehension',
  'computational_thinking',
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const SKILL_LABELS: Record<SkillCategory, string> = {
  programming_fundamentals: 'Programming fundamentals',
  variables: 'Variables',
  data_types: 'Data types',
  conditionals: 'Conditionals',
  loops: 'Loops',
  functions: 'Functions',
  debugging: 'Debugging',
  logic: 'Logic',
  problem_solving: 'Problem solving',
  code_comprehension: 'Code comprehension',
  computational_thinking: 'Computational thinking',
};

export const DIFFICULTIES = ['intro', 'intermediate', 'advanced'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Question types. New types are added by (1) adding the literal here, (2) adding its public
 * config + answer-key + response schemas in `validation.ts`, (3) adding a scorer in the backend
 * scoring registry, (4) adding a renderer in the frontend assessment components.
 */
export const QUESTION_TYPES = [
  'multiple_choice', // single correct option
  'multiple_select', // several correct options, partial credit
  'code_comprehension', // code snippet + single correct option
  'predict_output', // code snippet + single correct option
  'debugging', // code snippet; pick the line containing the bug
  'ordering', // put steps in the right order
  'short_logic', // short typed answer, normalized exact match against accepted answers
  'confidence_likert', // self-reported confidence 1-5; 0 points; reported separately
  'project_rubric', // instructor-scored; excluded from auto score
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Question types that contribute to the measured (auto-scored) score. */
export const AUTO_SCORED_TYPES: readonly QuestionType[] = [
  'multiple_choice',
  'multiple_select',
  'code_comprehension',
  'predict_output',
  'debugging',
  'ordering',
  'short_logic',
];

export const STAFF_ROLES = ['owner', 'admin', 'analyst', 'instructor'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const PERMISSIONS = [
  'dashboard.view', // aggregate impact dashboard
  'students.view_individual', // pseudonymous longitudinal history
  'students.manage', // withdraw / delete student records
  'catalog.manage', // programs, courses, cohorts, assessments
  'sessions.manage', // create/open/close assessment sessions (scoped to assigned programs for instructors)
  'credentials.issue', // generate / reissue student access cards (scoped)
  'consent.manage', // consent records and guardian contacts
  'reports.export', // CSV / printable exports (suppressed)
  'reports.ai', // generate AI impact summaries
  'staff.manage', // invite / disable staff
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const STUDENT_STATUSES = ['active', 'pending_consent', 'withdrawn'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const CONSENT_STATUSES = [
  'not_required',
  'pending',
  'granted',
  'denied',
  'withdrawn',
] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const CONSENT_METHODS = ['signed_form', 'email_plus', 'in_person', 'other'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const SESSION_STATUSES = ['scheduled', 'open', 'closed'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'abandoned'] as const;
export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const REPORT_TYPES = [
  'program_impact',
  'cohort_summary',
  'grant_narrative',
  'donor_update',
  'board_summary',
  'instructional_insights',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  program_impact: 'Program impact summary',
  cohort_summary: 'Cohort summary',
  grant_narrative: 'Grant-reporting narrative',
  donor_update: 'Donor update',
  board_summary: 'Board summary',
  instructional_insights: 'Strengths, weaknesses & instructional recommendations',
};
