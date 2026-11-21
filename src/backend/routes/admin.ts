import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { FilterOptions } from '@shared/api';
import { SKILL_CATEGORIES } from '@shared/types';
import type { Permission } from '@shared/types';
import {
  consentRecordBody,
  createAssessmentBody,
  createCohortBody,
  createCourseBody,
  createProgramBody,
  dashboardFiltersSchema,
  paginationQuery,
  studentSearchQuery,
  updateAssessmentStatusBody,
  updateStaffBody,
  inviteStaffBody,
  choiceConfigSchema,
  debuggingConfigSchema,
  likertConfigSchema,
  orderingConfigSchema,
  shortLogicConfigSchema,
  singleKeySchema,
  multiKeySchema,
  debuggingKeySchema,
  orderingKeySchema,
  shortLogicKeySchema,
} from '@shared/validation';
import { CONSENT_STATUSES } from '@shared/types';
import type { AppEnv } from '../env';
import { requirePermission, requireStaff } from '../middleware/auth';
import { suppressForExternal } from '../analytics';
import { audit } from '../services/audit';
import { computeDashboard } from '../services/dashboard';
import { inviteUser } from '../services/supabase-auth';
import type { NewQuestionInput } from '../repositories/types';
import { HttpError, StoreError, badRequest, forbidden, notFound } from '../utils/errors';
import { idParam, ok, paged, parseBody, parseQuery } from '../utils/http';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('/admin/*', requireStaff);

const anyOf =
  (...perms: Permission[]) =>
  async (c: Context<AppEnv>, next: () => Promise<void>) => {
    const staff = c.get('staff')!;
    if (!perms.some((p) => staff.permissions.includes(p))) throw forbidden();
    await next();
  };

/* ------------------------------------------------------------ dashboard */

const dashboardQuery = dashboardFiltersSchema.extend({
  view: z.enum(['internal', 'external']).optional(),
});

adminRoutes.get('/admin/dashboard', requirePermission('dashboard.view'), async (c) => {
  const { view, ...filters } = parseQuery(c, dashboardQuery);
  const dashboard = await computeDashboard(c, filters);
  // Callers without individual-level access (analysts) never get the internal, unsuppressed view,
  // whatever `view` asks for. Small cohorts are suppressed server-side for them.
  const external =
    view === 'external' || !c.get('staff')!.permissions.includes('students.view_individual');
  if (!external) return ok(c, dashboard);
  const suppressed = suppressForExternal(dashboard);
  // Explicit external view (printable/shareable reports) carries no operational session data.
  // Analysts (forced into the suppressed view) still see participation-only recent activity.
  return ok(c, view === 'external' ? { ...suppressed, recentActivity: [] } : suppressed);
});

adminRoutes.get('/admin/filters', requirePermission('dashboard.view'), async (c) => {
  const store = c.get('store');
  const [programs, courses, cohorts] = await Promise.all([
    store.listPrograms(),
    store.listCourses(),
    store.listCohorts(),
  ]);
  const instructors = new Map<string, string>();
  for (const co of cohorts)
    if (co.leadInstructor) instructors.set(co.leadInstructor.id, co.leadInstructor.displayName);
  const dto: FilterOptions = {
    programs: programs.map((p) => ({ id: p.id, name: p.name })),
    courses: courses.map((x) => ({ id: x.id, name: x.name, programId: x.programId })),
    cohorts: cohorts.map((x) => ({
      id: x.id,
      name: x.name,
      programId: x.programId,
      courseId: x.courseId,
    })),
    instructors: [...instructors].map(([id, displayName]) => ({ id, displayName })),
    skills: [...SKILL_CATEGORIES],
  };
  return ok(c, dto);
});

/* ------------------------------------------------------------- students */

adminRoutes.get('/admin/students', requirePermission('students.view_individual'), async (c) => {
  const q = parseQuery(c, studentSearchQuery);
  const page = await c.get('store').listStudents(q);
  return paged(c, page.items, page.total, q.limit, q.offset);
});

adminRoutes.get('/admin/students/:id', requirePermission('students.view_individual'), async (c) => {
  const history = await c.get('store').getStudentHistory(idParam(c));
  if (!history) throw notFound('Student not found.');
  return ok(c, history);
});

adminRoutes.post(
  '/admin/students/:id/withdraw',
  requirePermission('students.manage'),
  async (c) => {
    const store = c.get('store');
    const id = idParam(c);
    const student = await store.getStudent(id);
    if (!student) throw notFound('Student not found.');
    await store.setStudentStatus(id, 'withdrawn');
    await audit(store, {
      actorType: 'staff',
      actorId: c.get('staff')!.id,
      action: 'student.withdraw',
      targetType: 'student',
      targetId: id,
      metadata: { publicCode: student.public_code },
    });
    return ok(c, { ok: true });
  },
);

adminRoutes.delete('/admin/students/:id', requirePermission('students.manage'), async (c) => {
  const store = c.get('store');
  const id = idParam(c);
  const deleted = await store.deleteStudent(id);
  if (!deleted) throw notFound('Student not found.');
  // The audit entry keeps only the public code (target_id is not a foreign key).
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'student.delete',
    targetType: 'student',
    targetId: null,
    metadata: { publicCode: deleted.publicCode },
  });
  return ok(c, { ok: true });
});

/* -------------------------------------------------------------- catalog */

const URL_LIKE =
  /(?:[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|org|net|edu|gov|io|co|dev|app|ai|us|info|biz|xyz|ly|me)\b)/i;

/**
 * Program, course and cohort names reach reports and the AI payload, so they are plain labels:
 * control characters are stripped, whitespace collapsed, and URLs are refused (zod already caps length at 120).
 */
export function cleanName(raw: string): string {
  return raw
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function checkedName(raw: string): string {
  const name = cleanName(raw);
  if (name.length < 2 || name.length > 120) {
    throw badRequest('Names must be between 2 and 120 characters.', [
      { path: 'name', code: 'invalid_length' },
    ]);
  }
  if (URL_LIKE.test(name))
    throw badRequest('Names cannot contain web addresses.', [
      { path: 'name', code: 'contains_url' },
    ]);
  return name;
}

const canReadCatalog = anyOf('catalog.manage', 'dashboard.view');

adminRoutes.get('/admin/programs', canReadCatalog, async (c) =>
  ok(c, await c.get('store').listPrograms()),
);
adminRoutes.get('/admin/courses', canReadCatalog, async (c) =>
  ok(c, await c.get('store').listCourses()),
);
adminRoutes.get('/admin/cohorts', canReadCatalog, async (c) =>
  ok(c, await c.get('store').listCohorts()),
);
adminRoutes.get('/admin/assessments', canReadCatalog, async (c) =>
  ok(c, await c.get('store').listAssessments()),
);

adminRoutes.post('/admin/programs', requirePermission('catalog.manage'), async (c) => {
  const store = c.get('store');
  const body = await parseBody(c, createProgramBody);
  const program = await store.createProgram({ ...body, name: checkedName(body.name) });
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'catalog.program_create',
    targetType: 'program',
    targetId: program.id,
  });
  return ok(c, program, 201);
});

adminRoutes.post('/admin/courses', requirePermission('catalog.manage'), async (c) => {
  const store = c.get('store');
  const body = await parseBody(c, createCourseBody);
  const name = checkedName(body.name);
  if (!(await store.listPrograms()).some((p) => p.id === body.programId))
    throw notFound('Program not found.');
  const course = await store.createCourse({ ...body, name });
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'catalog.course_create',
    targetType: 'course',
    targetId: course.id,
  });
  return ok(c, course, 201);
});

adminRoutes.post('/admin/cohorts', requirePermission('catalog.manage'), async (c) => {
  const store = c.get('store');
  const body = await parseBody(c, createCohortBody);
  const name = checkedName(body.name);
  const course = await store.getCourse(body.courseId);
  if (!course || course.programId !== body.programId) {
    throw badRequest('That course does not belong to the program.', [
      { path: 'courseId', code: 'program_mismatch' },
    ]);
  }
  if (body.endDate < body.startDate)
    throw badRequest('The end date must not be before the start date.', [
      { path: 'endDate', code: 'before_start' },
    ]);
  if (body.leadInstructorId) {
    const lead = await store.getStaff(body.leadInstructorId);
    if (!lead || lead.staff.status === 'disabled')
      throw badRequest('Lead instructor not found.', [
        { path: 'leadInstructorId', code: 'unknown' },
      ]);
  }
  const cohort = await store.createCohort({
    ...body,
    name,
    leadInstructorId: body.leadInstructorId ?? null,
  });
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'catalog.cohort_create',
    targetType: 'cohort',
    targetId: cohort.id,
  });
  return ok(c, cohort, 201);
});

adminRoutes.get('/admin/assessments/:id', requirePermission('catalog.manage'), async (c) => {
  const detail = await c.get('store').getAssessmentDetail(idParam(c), true);
  if (!detail) throw notFound('Assessment not found.');
  return ok(c, detail);
});

type KeyCheck = { config: Record<string, unknown>; answerKey: Record<string, unknown> | null };

/** Validates a question's public config and answer key with the per-type schemas. Returns null if invalid. */
function validateQuestion(
  q: z.infer<typeof createAssessmentBody>['questions'][number],
): KeyCheck | null {
  const t = q.questionType;
  switch (t) {
    case 'multiple_choice':
    case 'code_comprehension':
    case 'predict_output': {
      const cfg = choiceConfigSchema.safeParse(q.config);
      const key = singleKeySchema.safeParse(q.answerKey);
      if (!cfg.success || !key.success) return null;
      if (!cfg.data.options.some((o) => o.id === key.data.correctOptionId)) return null;
      return { config: cfg.data, answerKey: key.data };
    }
    case 'multiple_select': {
      const cfg = choiceConfigSchema.safeParse(q.config);
      const key = multiKeySchema.safeParse(q.answerKey);
      if (!cfg.success || !key.success) return null;
      const ids = new Set(cfg.data.options.map((o) => o.id));
      if (!key.data.correctOptionIds.every((id) => ids.has(id))) return null;
      return { config: cfg.data, answerKey: key.data };
    }
    case 'debugging': {
      const cfg = debuggingConfigSchema.safeParse(q.config);
      const key = debuggingKeySchema.safeParse(q.answerKey);
      if (!cfg.success || !key.success) return null;
      if (key.data.bugLine > cfg.data.code.split('\n').length) return null;
      return { config: cfg.data, answerKey: key.data };
    }
    case 'ordering': {
      const cfg = orderingConfigSchema.safeParse(q.config);
      const key = orderingKeySchema.safeParse(q.answerKey);
      if (!cfg.success || !key.success) return null;
      const ids = cfg.data.items.map((i) => i.id).sort();
      const order = [...key.data.correctOrder].sort();
      if (ids.length !== order.length || ids.some((v, i) => v !== order[i])) return null;
      return { config: cfg.data, answerKey: key.data };
    }
    case 'short_logic': {
      const cfg = shortLogicConfigSchema.safeParse(q.config);
      const key = shortLogicKeySchema.safeParse(q.answerKey);
      if (!cfg.success || !key.success) return null;
      return { config: cfg.data, answerKey: key.data };
    }
    case 'confidence_likert': {
      const cfg = likertConfigSchema.safeParse(q.config);
      if (!cfg.success || q.answerKey !== null) return null;
      return { config: cfg.data, answerKey: null };
    }
  }
}

adminRoutes.post('/admin/assessments', requirePermission('catalog.manage'), async (c) => {
  const store = c.get('store');
  const body = await parseBody(c, createAssessmentBody);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(body.formFamily)) {
    throw badRequest('formFamily must be lowercase letters, digits and hyphens.', [
      { path: 'formFamily', code: 'invalid' },
    ]);
  }
  if (body.courseId && !(await store.getCourse(body.courseId))) throw notFound('Course not found.');

  const questions: NewQuestionInput[] = [];
  for (let i = 0; i < body.questions.length; i++) {
    const q = body.questions[i]!;
    const checked = validateQuestion(q);
    if (!checked) {
      throw badRequest('A question has an invalid configuration or answer key.', [
        { path: `questions.${i}`, code: 'invalid_question' },
      ]);
    }
    questions.push({
      question_type: q.questionType,
      prompt: q.prompt,
      config: checked.config,
      skill_category: q.skillCategory,
      difficulty: q.difficulty,
      points: q.questionType === 'confidence_likert' ? 0 : q.points,
      display_order: i + 1,
      answer_key: checked.answerKey,
    });
  }
  const scored = questions.filter((q) => q.question_type !== 'confidence_likert');
  if (!scored.some((q) => q.points > 0)) {
    throw badRequest('An assessment needs at least one scored question worth points.', [
      { path: 'questions', code: 'no_scored_questions' },
    ]);
  }
  const skillCategories = [
    ...new Set((scored.length ? scored : questions).map((q) => q.skill_category)),
  ];

  const created = await store.createAssessment({
    courseId: body.courseId,
    formFamily: body.formFamily,
    formLabel: body.formLabel,
    title: body.title,
    description: body.description,
    difficulty: body.difficulty,
    estimatedMinutes: body.estimatedMinutes,
    intendedStages: body.intendedStages,
    skillCategories,
    questions,
  });
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'assessment.create',
    targetType: 'assessment',
    targetId: created.id,
    metadata: { version: created.version, questions: questions.length },
  });
  return ok(c, created, 201);
});

adminRoutes.patch('/admin/assessments/:id', requirePermission('catalog.manage'), async (c) => {
  const store = c.get('store');
  const id = idParam(c);
  const body = await parseBody(c, updateAssessmentStatusBody);
  const updated = await store.updateAssessmentStatus(id, body.status);
  if (!updated) throw notFound('Assessment not found.');
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'assessment.status',
    targetType: 'assessment',
    targetId: id,
    metadata: { status: body.status },
  });
  return ok(c, updated);
});

/* -------------------------------------------------------------- consent */

const consentListQuery = paginationQuery.extend({ status: z.enum(CONSENT_STATUSES).optional() });

adminRoutes.get('/admin/consent', requirePermission('consent.manage'), async (c) => {
  const q = parseQuery(c, consentListQuery);
  const page = await c.get('store').listConsent(q);
  return paged(c, page.items, page.total, q.limit, q.offset);
});

adminRoutes.post('/admin/consent', requirePermission('consent.manage'), async (c) => {
  const store = c.get('store');
  const staff = c.get('staff')!;
  const body = await parseBody(c, consentRecordBody);
  const student = await store.getStudent(body.studentId);
  if (!student) throw notFound('Student not found.');
  if (body.consentStatus === 'granted' && !body.verificationMethod) {
    throw badRequest('A verification method is required when consent is granted.', [
      { path: 'verificationMethod', code: 'required' },
    ]);
  }
  const dto = await store.recordConsent({
    studentId: body.studentId,
    consentStatus: body.consentStatus,
    verificationMethod: body.verificationMethod,
    noticeVersion: body.noticeVersion,
    recordedBy: staff.id,
    guardianContact: body.guardianContact,
  });
  // Never put the guardian contact value in the audit trail.
  await audit(store, {
    actorType: 'staff',
    actorId: staff.id,
    action: 'consent.record',
    targetType: 'consent',
    targetId: dto.id,
    metadata: {
      status: body.consentStatus,
      publicCode: student.public_code,
      guardianContactStored: !!body.guardianContact,
    },
  });
  return ok(c, dto, 201);
});

adminRoutes.post('/admin/consent/:id/withdraw', requirePermission('consent.manage'), async (c) => {
  const store = c.get('store');
  const id = idParam(c);
  const dto = await store.withdrawConsent(id);
  if (!dto) throw notFound('Consent record not found.');
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'consent.withdraw',
    targetType: 'consent',
    targetId: id,
    metadata: { publicCode: dto.publicCode },
  });
  return ok(c, dto);
});

/* ---------------------------------------------------------------- staff */

adminRoutes.get('/admin/staff', requirePermission('staff.manage'), async (c) =>
  ok(c, await c.get('store').listStaff()),
);

async function assertProgramsExist(c: Context<AppEnv>, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const known = new Set((await c.get('store').listPrograms()).map((p) => p.id));
  if (!ids.every((id) => known.has(id)))
    throw badRequest('Unknown program.', [{ path: 'programIds', code: 'unknown' }]);
}

adminRoutes.post('/admin/staff', requirePermission('staff.manage'), async (c) => {
  const store = c.get('store');
  const cfg = c.get('config');
  const actor = c.get('staff')!;
  const body = await parseBody(c, inviteStaffBody);
  await assertProgramsExist(c, body.programIds);

  let authUserId: string | null = null;
  let isSynthetic = true;
  if (store.kind === 'supabase') {
    // Real invite email via Supabase Auth admin API. The address is never stored by this app.
    const res = await inviteUser(cfg, body.email);
    if (!res.ok) {
      if (res.reason === 'rejected')
        throw badRequest('That email could not be invited.', [{ path: 'email', code: 'rejected' }]);
      throw new HttpError(503, 'internal', 'Invitations are temporarily unavailable.');
    }
    authUserId = res.value.userId;
    isSynthetic = false;
  }
  try {
    const dto = await store.createStaff({
      authUserId,
      displayName: body.displayName,
      role: body.role,
      status: 'invited',
      isSynthetic,
      programIds: body.programIds,
    });
    await audit(store, {
      actorType: 'staff',
      actorId: actor.id,
      action: 'staff.invite',
      targetType: 'staff',
      targetId: dto.id,
      metadata: { role: body.role },
    });
    return ok(c, dto, 201);
  } catch (e) {
    if (e instanceof StoreError && e.code === 'duplicate')
      throw new HttpError(409, 'conflict', 'That person already has an account.');
    throw e;
  }
});

adminRoutes.patch('/admin/staff/:id', requirePermission('staff.manage'), async (c) => {
  const store = c.get('store');
  const actor = c.get('staff')!;
  const id = idParam(c);
  const body = await parseBody(c, updateStaffBody);
  if (id === actor.id && (body.role !== undefined || body.status !== undefined)) {
    throw forbidden('You cannot change your own role or status.');
  }
  if (body.programIds) await assertProgramsExist(c, body.programIds);
  const dto = await store.updateStaff(id, body);
  if (!dto) throw notFound('Staff member not found.');
  await audit(store, {
    actorType: 'staff',
    actorId: actor.id,
    action: 'staff.update',
    targetType: 'staff',
    targetId: id,
    metadata: {
      role: body.role ?? null,
      status: body.status ?? null,
      programsChanged: body.programIds !== undefined,
    },
  });
  return ok(c, dto);
});

/* ---------------------------------------------------------------- audit */

adminRoutes.get('/admin/audit-log', requirePermission('audit.view'), async (c) => {
  const q = parseQuery(c, paginationQuery);
  const page = await c.get('store').listAudit(q);
  return paged(c, page.items, page.total, q.limit, q.offset);
});
