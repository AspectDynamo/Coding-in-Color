import { describe, expect, it } from 'vitest';
import type { RecentActivityItem } from '../../../src/shared/api';
import { buildImpactDashboard, suppressForExternal } from '../../../src/backend/analytics';
import { dashboardInput } from '../analytics/fixtures';

const item = (n: number): RecentActivityItem => ({
  sessionId: `s${n}`,
  title: `Session ${n}`,
  cohortName: 'Spring cohort',
  programName: 'AI Academy',
  stage: 'PRE',
  status: 'open',
  enrolledCount: 10,
  submittedCount: n,
  lastActivityAt: new Date(Date.UTC(2026, 10, 20 - n)).toISOString(),
});

describe('buildImpactDashboard recentActivity', () => {
  it('passes the input through unchanged and keeps order', () => {
    const recentActivity = [item(1), item(2), item(3)];
    const d = buildImpactDashboard(dashboardInput({ recentActivity }));
    expect(d.recentActivity).toEqual(recentActivity);
  });

  it('never returns more than 6 items', () => {
    const recentActivity = Array.from({ length: 9 }, (_, i) => item(i));
    const d = buildImpactDashboard(dashboardInput({ recentActivity }));
    expect(d.recentActivity).toHaveLength(6);
    expect(d.recentActivity.map((i) => i.sessionId)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5']);
  });

  it('is empty by default and survives external suppression untouched, even for tiny groups', () => {
    expect(buildImpactDashboard(dashboardInput()).recentActivity).toEqual([]);
    const small = buildImpactDashboard(dashboardInput({ pairs: [], recentActivity: [item(1)] }));
    expect(suppressForExternal(small).recentActivity).toEqual([item(1)]);
  });
});
