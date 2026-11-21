/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Context } from 'hono';
import type { ImpactDashboard, RecentActivityItem } from '../../src/shared/api';
import {
  assertNoIdentifiers,
  buildAiPayload,
  suppressForExternal,
} from '../../src/backend/analytics';
import { parseConfig } from '../../src/backend/config';
import { getMemoryStore } from '../../src/backend/repositories/memory-store';
import { computeDashboard } from '../../src/backend/services/dashboard';
import { Client, dataset, freshState, makeEnv } from './helpers';

beforeEach(freshState);

const ITEM_KEYS = [
  'cohortName',
  'enrolledCount',
  'lastActivityAt',
  'programName',
  'sessionId',
  'stage',
  'status',
  'submittedCount',
  'title',
];

async function admin() {
  const c = new Client();
  expect((await c.staffDemo('admin')).status).toBe(200);
  return c;
}
const dash = async (c: Client, qs = '') =>
  (await c.get(`/admin/dashboard${qs}`)).body.data as ImpactDashboard;

describe('dashboard recentActivity', () => {
  it('is capped at 6, newest first, participation counts only (no score fields)', async () => {
    const a = await admin();
    const d = await dash(a);
    expect(dataset().sessions.length).toBeGreaterThan(6);
    expect(d.recentActivity).toHaveLength(6);
    const times = d.recentActivity.map((i) => Date.parse(i.lastActivityAt));
    expect(times.every((t) => !Number.isNaN(t))).toBe(true);
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    for (const item of d.recentActivity) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(item.submittedCount).toBeGreaterThanOrEqual(0);
      expect(item.submittedCount).toBeLessThanOrEqual(item.enrolledCount);
    }
    expect(JSON.stringify(d.recentActivity)).not.toMatch(/score|percent|answer|student/i);
  });

  it('respects cohort, program and course filters', async () => {
    const a = await admin();
    const ds = dataset();
    const cohort = ds.cohorts.find((c) => c.name.includes('Python Game Camp (Week 1)'))!;
    const expectedSessions = new Set(
      ds.sessions.filter((s) => s.cohort_id === cohort.id).map((s) => s.id),
    );
    const one = await dash(a, `?cohortId=${cohort.id}`);
    expect(one.recentActivity.length).toBe(expectedSessions.size);
    expect(one.recentActivity.every((i) => expectedSessions.has(i.sessionId))).toBe(true);
    expect(one.recentActivity.every((i) => i.cohortName === cohort.name)).toBe(true);

    const programName = (id: string) => ds.programs.find((p) => p.id === id)!.name;
    const prog = await dash(a, `?programId=${cohort.program_id}`);
    expect(prog.recentActivity.length).toBeGreaterThan(0);
    expect(prog.recentActivity.every((i) => i.programName === programName(cohort.program_id))).toBe(
      true,
    );

    const course = await dash(a, `?courseId=${cohort.course_id}`);
    const courseCohorts = new Set(
      ds.cohorts.filter((c) => c.course_id === cohort.course_id).map((c) => c.name),
    );
    expect(course.recentActivity.every((i) => courseCohorts.has(i.cohortName))).toBe(true);
  });

  it('respects the instructor program scope (computeDashboard with a scoped staff member)', async () => {
    const ds = dataset();
    const env = makeEnv();
    const config = parseConfig(env);
    const store = await getMemoryStore(config);
    const camp = ds.programs.find((p) => p.name === 'Summer Code Camps')!;
    const scoped = ds.programs.filter((p) => p.id !== camp.id);
    const ctx = (programIds: string[]) =>
      ({
        get: (k: string) =>
          ({
            store,
            config,
            staff: {
              id: 'x',
              displayName: 'Scoped',
              role: 'instructor',
              permissions: [],
              programIds,
              isSynthetic: true,
            },
          })[k],
      }) as unknown as Context<any>;

    const d = await computeDashboard(ctx(scoped.map((p) => p.id)), {});
    expect(d.recentActivity.length).toBeGreaterThan(0);
    expect(d.recentActivity.some((i) => i.programName === camp.name)).toBe(false);

    // An explicit filter on a program outside the scope yields nothing, not another program's data.
    const out = await computeDashboard(ctx(scoped.map((p) => p.id)), { programId: camp.id });
    expect(out.recentActivity).toEqual([]);
    // No assignments at all -> empty.
    expect((await computeDashboard(ctx([]), {})).recentActivity).toEqual([]);
  });

  it('excludes withdrawn students from enrolledCount and submittedCount', async () => {
    const ds = dataset();
    const victim = ds.attempts.find(
      (x) =>
        x.status === 'submitted' &&
        x.stage !== 'PRACTICE' &&
        ds.cohortStudents.some((cs) => cs.student_id === x.student_id && cs.status === 'enrolled'),
    )!;
    const a = await admin();
    const find = (d: ImpactDashboard): RecentActivityItem =>
      d.recentActivity.find((i) => i.sessionId === victim.assessment_session_id)!;
    const before = find(await dash(a, `?cohortId=${victim.cohort_id}`));
    expect(before).toBeDefined();
    expect((await a.post(`/admin/students/${victim.student_id}/withdraw`)).status).toBe(200);
    const after = find(await dash(a, `?cohortId=${victim.cohort_id}`));
    expect(after.submittedCount).toBe(before.submittedCount - 1);
    expect(after.enrolledCount).toBe(before.enrolledCount - 1);
    // Their submission also no longer drives lastActivityAt.
    expect(Date.parse(after.lastActivityAt)).toBeLessThanOrEqual(Date.parse(before.lastActivityAt));
  });

  it('is kept by suppressForExternal and never reaches the AI payload', async () => {
    const a = await admin();
    const d = await dash(a);
    const ext = suppressForExternal(d);
    expect(ext.recentActivity).toEqual(d.recentActivity);
    const payload = buildAiPayload(d, { reportType: 'program_impact', scopeLabel: 'All' });
    assertNoIdentifiers(payload);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('recentActivity');
    for (const i of d.recentActivity) {
      expect(json).not.toContain(i.sessionId);
      expect(json).not.toContain(i.title);
    }
  });
});
