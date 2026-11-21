import type { Context } from 'hono';
import type { CohortDto, ImpactDashboard } from '@shared/api';
import type { DashboardFilters } from '@shared/validation';
import type { AppEnv, StaffAuth } from '../env';
import { buildImpactDashboard } from '../analytics';
import { programScope } from '../middleware/auth';
import type { DataStore } from '../repositories/types';

export const RECENT_ACTIVITY_LIMIT = 6;

/** Cohorts matching the filters, restricted to the staff member's program scope. */
export async function scopedCohorts(
  store: DataStore,
  staff: StaffAuth,
  filters: DashboardFilters,
): Promise<CohortDto[]> {
  const scope = programScope(staff);
  return (await store.listCohorts()).filter(
    (c) =>
      (!scope || scope.includes(c.programId)) &&
      (!filters.programId || c.programId === filters.programId) &&
      (!filters.courseId || c.courseId === filters.courseId) &&
      (!filters.cohortId || c.id === filters.cohortId) &&
      (!filters.instructorId || c.leadInstructor?.id === filters.instructorId),
  );
}

/** Internal (admin) dashboard: NOT suppressed; small groups are flagged by the analytics layer. */
export async function computeDashboard(
  c: Context<AppEnv>,
  filters: DashboardFilters,
): Promise<ImpactDashboard> {
  const store = c.get('store');
  const staff = c.get('staff')!;
  const cohorts = await scopedCohorts(store, staff, filters);
  const ids = cohorts.map((x) => x.id);
  const [pairs, attempts, counts, recentActivity] = ids.length
    ? await Promise.all([
        store.getMatchedPairs(ids, filters.from, filters.to),
        store.listSubmittedAttemptsInScope(ids, filters.from, filters.to),
        store.countStudentRecords(ids),
        store.listRecentSessionActivity(ids, RECENT_ACTIVITY_LIMIT),
      ])
    : [[], [], { total: 0, synthetic: 0 }, []];
  return buildImpactDashboard({
    filters,
    pairs,
    attempts,
    cohorts: cohorts.map((x) => ({
      id: x.id,
      name: x.name,
      programName: x.programName,
      courseName: x.courseName,
      enrolled: x.enrolledCount,
    })),
    totalStudentRecords: counts.total,
    recentActivity,
    suppressionThreshold: c.get('config').suppressionThreshold,
    isSyntheticData: store.kind === 'memory' || counts.synthetic > 0,
    generatedAt: new Date().toISOString(),
  });
}

/** Human-readable scope for AI/report text, from filter names only (never ids). */
export async function scopeLabel(store: DataStore, filters: DashboardFilters): Promise<string> {
  const [programs, courses, cohorts] = await Promise.all([
    store.listPrograms(),
    store.listCourses(),
    store.listCohorts(),
  ]);
  const parts: string[] = [];
  const program = filters.programId && programs.find((p) => p.id === filters.programId);
  const course = filters.courseId && courses.find((x) => x.id === filters.courseId);
  const cohort = filters.cohortId && cohorts.find((x) => x.id === filters.cohortId);
  if (program) parts.push(program.name);
  if (course) parts.push(course.name);
  if (cohort) parts.push(cohort.name);
  return parts.length ? parts.join(' / ') : 'All Coding in Color programs';
}
