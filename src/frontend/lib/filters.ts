import type { DashboardFilters, FilterOptions } from '@shared/api';
import {
  ASSESSMENT_STAGES,
  SKILL_CATEGORIES,
  SKILL_LABELS,
  type AssessmentStage,
  type SkillCategory,
} from '@shared/types';
import { STAGE_LABELS, fmtDate } from './format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FILTER_KEYS = [
  'programId',
  'courseId',
  'cohortId',
  'instructorId',
  'from',
  'to',
  'stage',
  'skill',
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Reads dashboard filters from the URL query, dropping anything malformed. */
export function filtersFromParams(p: URLSearchParams): DashboardFilters {
  const f: DashboardFilters = {};
  for (const k of ['programId', 'courseId', 'cohortId', 'instructorId'] as const) {
    const v = p.get(k);
    if (v && UUID.test(v)) f[k] = v;
  }
  for (const k of ['from', 'to'] as const) {
    const v = p.get(k);
    if (v && DATE.test(v)) f[k] = v;
  }
  const stage = p.get('stage');
  if (stage && (ASSESSMENT_STAGES as readonly string[]).includes(stage))
    f.stage = stage as AssessmentStage;
  const skill = p.get('skill');
  if (skill && (SKILL_CATEGORIES as readonly string[]).includes(skill))
    f.skill = skill as SkillCategory;
  return f;
}

export function filtersToParams(f: DashboardFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of FILTER_KEYS) {
    const v = f[k];
    if (v) p.set(k, v);
  }
  return p;
}

export function filtersKey(f: DashboardFilters): string {
  return filtersToParams(f).toString();
}

/** Human-readable scope lines for report headers ("Program: AI Academy"). */
export function describeFilters(
  f: DashboardFilters,
  options: FilterOptions | undefined,
): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const name = <T extends { id: string }>(
    list: T[] | undefined,
    id: string,
    pick: (t: T) => string,
  ) => {
    const hit = list?.find((x) => x.id === id);
    return hit ? pick(hit) : 'Selected';
  };
  if (f.programId)
    out.push({ label: 'Program', value: name(options?.programs, f.programId, (x) => x.name) });
  if (f.courseId)
    out.push({ label: 'Course', value: name(options?.courses, f.courseId, (x) => x.name) });
  if (f.cohortId)
    out.push({ label: 'Cohort', value: name(options?.cohorts, f.cohortId, (x) => x.name) });
  if (f.instructorId)
    out.push({
      label: 'Lead instructor',
      value: name(options?.instructors, f.instructorId, (x) => x.displayName),
    });
  if (f.from || f.to)
    out.push({
      label: 'Dates',
      value: `${f.from ? fmtDate(f.from) : 'Start'} – ${f.to ? fmtDate(f.to) : 'Today'}`,
    });
  if (f.stage) out.push({ label: 'Stage (completion counts)', value: STAGE_LABELS[f.stage] });
  if (f.skill) out.push({ label: 'Skill', value: SKILL_LABELS[f.skill] });
  return out;
}
