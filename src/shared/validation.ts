/**
 * Shared zod schemas: question configs, answer keys, student responses and request bodies.
 * Owned by the lead. Backend validates every request with these; frontend may reuse them for
 * client-side validation. Answer-key schemas are used ONLY by the backend.
 */
import { z } from 'zod';
import {
  AGE_BANDS,
  ASSESSMENT_STAGES,
  CONSENT_METHODS,
  CONSENT_STATUSES,
  DELIVERY_MODES,
  DIFFICULTIES,
  PROGRAM_FORMATS,
  REPORT_TYPES,
  SKILL_CATEGORIES,
  STAFF_ROLES,
} from './types';

export const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z.string().datetime({ offset: true });

/* ------------------------------------------------------------------ */
/* Question public config (safe to send to students)                   */
/* ------------------------------------------------------------------ */

export const optionSchema = z.object({
  id: z.string().min(1).max(16),
  label: z.string().min(1).max(500),
});

/** multiple_choice, multiple_select, code_comprehension, predict_output */
export const choiceConfigSchema = z.object({
  code: z.string().max(4000).optional(), // optional code snippet shown above options
  language: z.string().max(20).optional(), // e.g. "python", "javascript", "pseudocode"
  options: z.array(optionSchema).min(2).max(8),
});

/** debugging: student picks the (1-based) line number containing the bug */
export const debuggingConfigSchema = z.object({
  code: z.string().min(1).max(4000),
  language: z.string().max(20).optional(),
  hint: z.string().max(300).optional(),
});

/** ordering: items are presented shuffled; student returns the ids in order */
export const orderingConfigSchema = z.object({
  items: z.array(optionSchema).min(2).max(8),
});

/** short_logic: short typed answer */
export const shortLogicConfigSchema = z.object({
  code: z.string().max(4000).optional(),
  language: z.string().max(20).optional(),
  placeholder: z.string().max(60).optional(),
  maxLength: z.number().int().min(1).max(100).default(40),
});

/** confidence_likert: 1..5 scale */
export const likertConfigSchema = z.object({
  minLabel: z.string().max(60).default('Not at all confident'),
  maxLabel: z.string().max(60).default('Very confident'),
});

/** project_rubric: instructor-scored criteria (not shown in student assessments) */
export const rubricConfigSchema = z.object({
  criteria: z
    .array(z.object({ id: z.string(), label: z.string(), maxPoints: z.number().positive() }))
    .min(1),
});

/* ------------------------------------------------------------------ */
/* Answer keys (backend only — never serialized to students)          */
/* ------------------------------------------------------------------ */

export const singleKeySchema = z.object({ correctOptionId: z.string() });
export const multiKeySchema = z.object({ correctOptionIds: z.array(z.string()).min(1) });
export const debuggingKeySchema = z.object({ bugLine: z.number().int().positive() });
export const orderingKeySchema = z.object({ correctOrder: z.array(z.string()).min(2) });
export const shortLogicKeySchema = z.object({
  acceptedAnswers: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().default(false),
});

/* ------------------------------------------------------------------ */
/* Student responses                                                   */
/* ------------------------------------------------------------------ */

export const responseValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single'), optionId: z.string().max(16) }),
  z.object({ kind: z.literal('multi'), optionIds: z.array(z.string().max(16)).max(8) }),
  z.object({ kind: z.literal('line'), line: z.number().int().positive().max(500) }),
  z.object({ kind: z.literal('order'), itemIds: z.array(z.string().max(16)).max(8) }),
  z.object({ kind: z.literal('text'), text: z.string().max(100) }),
  z.object({ kind: z.literal('likert'), value: z.number().int().min(1).max(5) }),
  z.object({ kind: z.literal('skipped') }),
]);
export type ResponseValue = z.infer<typeof responseValueSchema>;

/** Which response `kind` each question type expects (backend rejects mismatches). */
export const RESPONSE_KIND_BY_TYPE = {
  multiple_choice: 'single',
  code_comprehension: 'single',
  predict_output: 'single',
  multiple_select: 'multi',
  debugging: 'line',
  ordering: 'order',
  short_logic: 'text',
  confidence_likert: 'likert',
  project_rubric: null, // not answerable by students
} as const;

/* ------------------------------------------------------------------ */
/* Request bodies                                                      */
/* ------------------------------------------------------------------ */

/**
 * Access code format: 16 Crockford base32 chars (~80 bits), displayed as XXXX-XXXX-XXXX-XXXX.
 * Input is normalized server-side: uppercase, strip spaces/dashes, map I/L->1, O->0, drop U.
 */
export const studentSessionBody = z.object({ code: z.string().min(16).max(40) });

export const submitAttemptBody = z.object({
  attemptId: uuid,
  assessmentVersion: z.number().int().positive(),
  responses: z.array(z.object({ questionId: uuid, response: responseValueSchema })).max(60),
});

export const staffLoginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});
export const mfaVerifyBody = z.object({
  factorId: z.string().min(1).max(100),
  code: z.string().regex(/^\d{6}$/),
});
export const demoLoginBody = z.object({ role: z.enum(STAFF_ROLES) });
export const passwordResetBody = z.object({ email: z.string().email().max(254) });

export const createSessionBody = z.object({
  cohortId: uuid,
  assessmentId: uuid,
  stage: z.enum(ASSESSMENT_STAGES),
  title: z.string().min(1).max(120).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  openNow: z.boolean().default(true),
});
export const updateSessionBody = z.object({ status: z.enum(['open', 'closed']) });

export const issueCredentialsBody = z.object({
  cohortId: uuid,
  count: z.number().int().min(1).max(60),
  ageBand: z.enum(AGE_BANDS),
});
export const reissueCredentialBody = z.object({
  cohortId: uuid,
  rosterLabel: z.string().min(1).max(12),
  reason: z.enum(['lost', 'compromised', 'damaged', 'other']),
});

export const createProgramBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(''),
  format: z.enum(PROGRAM_FORMATS),
});
export const createCourseBody = z.object({
  programId: uuid,
  name: z.string().min(2).max(120),
  description: z.string().max(1000).default(''),
});
export const createCohortBody = z.object({
  programId: uuid,
  courseId: uuid,
  name: z.string().min(2).max(120),
  deliveryMode: z.enum(DELIVERY_MODES),
  startDate: isoDate,
  endDate: isoDate,
  leadInstructorId: uuid.nullable().optional(),
});

export const questionInputSchema = z.object({
  questionType: z.enum([
    'multiple_choice',
    'multiple_select',
    'code_comprehension',
    'predict_output',
    'debugging',
    'ordering',
    'short_logic',
    'confidence_likert',
  ]),
  prompt: z.string().min(3).max(1000),
  config: z.record(z.string(), z.unknown()), // validated per type by backend
  answerKey: z.record(z.string(), z.unknown()).nullable(), // null only for confidence_likert
  skillCategory: z.enum(SKILL_CATEGORIES),
  difficulty: z.enum(DIFFICULTIES),
  points: z.number().min(0).max(10),
});
export const createAssessmentBody = z.object({
  courseId: uuid.nullable(),
  formFamily: z.string().min(2).max(60),
  formLabel: z.string().min(1).max(4),
  title: z.string().min(3).max(160),
  description: z.string().max(1000).default(''),
  difficulty: z.enum(DIFFICULTIES),
  estimatedMinutes: z.number().int().min(1).max(15),
  intendedStages: z.array(z.enum(ASSESSMENT_STAGES)).min(1),
  questions: z.array(questionInputSchema).min(1).max(30),
});
export const updateAssessmentStatusBody = z.object({
  status: z.enum(['draft', 'active', 'retired']),
});

export const consentRecordBody = z.object({
  studentId: uuid,
  consentStatus: z.enum(CONSENT_STATUSES),
  verificationMethod: z.enum(CONSENT_METHODS).nullable(),
  noticeVersion: z.string().min(1).max(40),
  /** Optional guardian contact, stored separately with restricted access. Never shown to instructors. */
  guardianContact: z
    .object({ method: z.enum(['email', 'phone', 'paper']), value: z.string().min(1).max(254) })
    .optional(),
});

export const inviteStaffBody = z.object({
  email: z.string().email().max(254),
  displayName: z.string().min(1).max(80),
  role: z.enum(STAFF_ROLES),
  programIds: z.array(uuid).default([]),
});
export const updateStaffBody = z.object({
  role: z.enum(STAFF_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  programIds: z.array(uuid).optional(),
});

/** Dashboard/report filters. Sent as query string params for GETs, JSON body for POSTs. */
export const dashboardFiltersSchema = z.object({
  programId: uuid.optional(),
  courseId: uuid.optional(),
  cohortId: uuid.optional(),
  instructorId: uuid.optional(),
  from: isoDate.optional(), // inclusive; applies to attempt submitted_at
  to: isoDate.optional(), // inclusive
  stage: z.enum(ASSESSMENT_STAGES).optional(), // narrows completion counts / trend
  skill: z.enum(SKILL_CATEGORIES).optional(), // when set, pre/post scores use this skill's sub-score
});
export type DashboardFilters = z.infer<typeof dashboardFiltersSchema>;

export const summarizeBody = z.object({
  reportType: z.enum(REPORT_TYPES),
  filters: dashboardFiltersSchema,
});

export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export const studentSearchQuery = paginationQuery.extend({
  q: z.string().max(20).optional(), // public code prefix, e.g. "S-7KQ2"
  cohortId: uuid.optional(),
});
