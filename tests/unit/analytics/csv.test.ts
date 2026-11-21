import { describe, expect, it } from 'vitest';
import {
  buildImpactDashboard,
  csvCell,
  csvRow,
  impactCsv,
  sessionCsv,
  skillsCsv,
} from '../../../src/backend/analytics';
import type { SessionProgressDto } from '../../../src/shared/api';
import { dashboardInput, pairsFromDiffs } from './fixtures';

describe('csvCell', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-3.4)).toBe('-3.4');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvRow(['a', 1, null, 'b,c'])).toBe('a,1,,"b,c"');
  });

  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx'])(
    'defuses formula injection %j',
    (v) => {
      const out = csvCell(v);
      expect(out.startsWith("'") || out.startsWith('"\'')).toBe(true);
    },
  );

  it('prefixes and quotes together', () => {
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });
});

describe('impactCsv / skillsCsv', () => {
  const d = buildImpactDashboard(
    dashboardInput({
      cohorts: [
        {
          id: 'c1',
          name: '=EVIL(),"cohort"',
          programName: 'AI Academy',
          courseName: 'Intro',
          enrolled: 16,
        },
      ],
    }),
  );

  it('has header comment rows, table header and CRLF endings', () => {
    const csv = impactCsv(d);
    expect(csv.endsWith('\r\n')).toBe(true);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toMatch(/^# Coding in Color Impact/);
    expect(csv).toContain('# Generated: 2026-11-21T12:00:00.000Z');
    expect(csv).toContain('SYNTHETIC DEMO DATA');
    expect(csv).toContain('# Filters: none');
    expect(csv).toContain('Suppression threshold: 10');
    expect(csv).toContain('# Limitation: Results describe matched participants');
    const header = lines.findIndex((l) => l.startsWith('scope,'));
    expect(header).toBeGreaterThan(5);
    expect(lines[header + 1]).toMatch(/^overall,,,,16,12,50,70,20,40,100,0,0,/);
    expect(lines).toHaveLength(header + 3);
  });

  it('protects cohort names against injection and quotes them', () => {
    const csv = impactCsv(d);
    expect(csv).toContain(`"'=EVIL(),""cohort"""`);
  });

  it('omits the synthetic banner for real data and lists active filters', () => {
    const real = buildImpactDashboard(
      dashboardInput({ isSyntheticData: false, filters: { skill: 'loops', stage: 'POST' } }),
    );
    const csv = impactCsv(real);
    expect(csv).not.toContain('SYNTHETIC');
    expect(csv).toContain('skill=loops');
    expect(csv).toContain('stage=POST');
  });

  it('suppresses small groups even if given an unsuppressed dashboard', () => {
    const small = buildImpactDashboard(dashboardInput({ pairs: pairsFromDiffs([10, 20, 30]) }));
    const csv = impactCsv(small);
    const overall = csv.split('\r\n').find((l) => l.startsWith('overall'))!;
    expect(overall).toBe('overall,,,,16,3,,,,,,,,,,,yes');
    const cohort = csv.split('\r\n').find((l) => l.startsWith('cohort,'))!;
    expect(cohort.endsWith(',yes')).toBe(true);
    expect(cohort).not.toMatch(/,20,/);
  });

  it('skillsCsv lists labelled skills and blanks suppressed rows', () => {
    const pairs = [
      ...pairsFromDiffs(Array(10).fill(10), {
        pre_skills: { loops: 40 },
        post_skills: { loops: 60 },
      }),
      ...pairsFromDiffs(Array(3).fill(10), {
        pre_skills: { loops: 40, debugging: 20 },
        post_skills: { loops: 60, debugging: 90 },
      }),
    ];
    const csv = skillsCsv(buildImpactDashboard(dashboardInput({ pairs })));
    const lines = csv.trimEnd().split('\r\n');
    expect(lines).toContain(
      'skill,matched_students,average_pre_pct,average_post_pct,average_change_pts,suppressed',
    );
    expect(lines).toContain('Loops,13,40,60,20,no');
    expect(lines).toContain('Debugging,3,,,,yes');
    expect(csv).toContain('SYNTHETIC DEMO DATA');
  });
});

describe('sessionCsv', () => {
  const base = (over: Partial<SessionProgressDto> = {}): SessionProgressDto => ({
    session: {
      id: 's1',
      cohortId: 'c1',
      cohortName: 'Spring, "A"',
      programName: 'AI Academy',
      assessmentId: 'a1',
      assessmentTitle: 'Python basics',
      stage: 'PRE',
      title: 'Pre test',
      status: 'open',
      startsAt: null,
      endsAt: null,
      createdAt: '2026-01-01T00:00:00Z',
      enrolledCount: 20,
      submittedCount: 12,
      joinUrl: 'https://x/s',
    },
    enrolled: 20,
    notStarted: 5,
    inProgress: 3,
    submitted: 12,
    completionRate: 60,
    medianDurationSeconds: 300,
    roster: [{ rosterLabel: '01', publicCode: 'S-ABC123', status: 'submitted' }],
    aggregate: { averagePercentage: 71.5, n: 12 },
    suppressionThreshold: 10,
    ...over,
  });

  it('exports the aggregate without roster or codes', () => {
    const csv = sessionCsv(base(), { generatedAt: '2026-11-21T00:00:00Z' });
    expect(csv).toContain('# Generated: 2026-11-21T00:00:00Z');
    expect(csv).not.toContain('S-ABC123');
    expect(csv).not.toContain('roster');
    expect(csv).toContain(
      '"Spring, ""A""",AI Academy,Python basics,PRE,open,20,5,3,12,60,300,71.5,12,no',
    );
  });

  it('withholds score and duration below the threshold', () => {
    const csv = sessionCsv(base({ submitted: 9, aggregate: null }), { generatedAt: 'x' });
    expect(csv).toContain(',9,60,,,9,yes');
    expect(csv).not.toContain('71.5');
    const csv2 = sessionCsv(base({ submitted: 12, aggregate: { averagePercentage: 70, n: 4 } }), {
      generatedAt: 'x',
    });
    expect(csv2).toMatch(/,12,60,,,4,yes\r\n$/);
  });
});
