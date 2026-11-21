import { describe, expect, it } from 'vitest';
import {
  AI_SUMMARY_JSON_SCHEMA,
  PROMPT_VERSION,
  PayloadIdentifierError,
  assertNoIdentifiers,
  buildAiPayload,
  buildImpactDashboard,
  buildSummaryMessages,
  buildTemplateSummary,
  checkNumbers,
  parseAiSummary,
  sanitizeFreeText,
  type AiPayload,
} from '../../../src/backend/analytics';
import type { AiSummaryContent } from '../../../src/shared/api';
import { AI_PROMPT_VERSION } from '../../../src/shared/constants';
import { REPORT_TYPES } from '../../../src/shared/types';
import { dashboardInput, pair, pairsFromDiffs } from './fixtures';

const ctx = { reportType: 'program_impact' as const, scopeLabel: 'AI Academy - Spring cohort' };

function richDashboard() {
  const pairs = [
    ...pairsFromDiffs([10, 20, 30, 24, 16, 22, 18, 26, 14, 20, 12, 28], {
      pre_skills: { loops: 40, variables: 50 },
      post_skills: { loops: 70, variables: 60 },
      pre_confidence: 2,
      post_confidence: 4,
      retention_attempt_id: 'r',
      retention_percentage: 66,
    }),
    ...pairsFromDiffs([5, 5, 5], { pre_skills: { debugging: 10 }, post_skills: { debugging: 90 } }),
  ];
  return buildImpactDashboard(
    dashboardInput({
      pairs,
      cohorts: [
        {
          id: 'c1',
          name: 'Spring cohort',
          programName: 'AI Academy',
          courseName: 'Intro',
          enrolled: 20,
        },
        {
          id: 'c2',
          name: 'Tiny cohort',
          programName: 'AI Academy',
          courseName: 'Intro',
          enrolled: 3,
        },
      ],
    }),
  );
}

describe('buildAiPayload', () => {
  it('contains only aggregate fields and only unsuppressed skills/cohorts', () => {
    const p = buildAiPayload(richDashboard(), ctx);
    expect(Object.keys(p).sort()).toEqual(
      [
        'report_type',
        'scope_label',
        'assessment_period',
        'students_enrolled',
        'pre_completions',
        'post_completions',
        'matched_students',
        'completion_rate',
        'match_rate',
        'average_pre_score',
        'average_post_score',
        'average_change_points',
        'relative_change_percent',
        'percentage_improving',
        'percentage_unchanged',
        'percentage_declining',
        'change_ci95',
        'effect_size_dz',
        'self_reported_confidence',
        'retention',
        'skills',
        'strongest_skill',
        'weakest_skill',
        'cohorts',
        'suppression_threshold',
        'sample_sufficient',
        'limitations',
        'is_synthetic_data',
      ].sort(),
    );
    expect(p.matched_students).toBe(15);
    expect(p.sample_sufficient).toBe(true);
    expect(p.skills.map((s) => s.skill)).toEqual(['Variables', 'Loops']); // Debugging n=3 suppressed
    expect(p.strongest_skill).toBe('Loops');
    expect(p.weakest_skill).toBe('Variables');
    expect(p.cohorts.map((c) => c.name)).toEqual(['Spring cohort']);
    expect(p.self_reported_confidence).toMatchObject({ n: 12, average_pre: 2, average_post: 4 });
    expect(p.is_synthetic_data).toBe(true);
    expect(p.scope_label).toBe(ctx.scopeLabel);
    const json = JSON.stringify(p);
    expect(json).not.toMatch(/c1|c2|student_id|a-\d+-pre/);
  });

  it('marks insufficient samples and nulls values', () => {
    const p = buildAiPayload(
      buildImpactDashboard(dashboardInput({ pairs: pairsFromDiffs([10, 20, 30]) })),
      ctx,
    );
    expect(p.sample_sufficient).toBe(false);
    expect(p.matched_students).toBe(3);
    expect(p.average_change_points).toBeNull();
    expect(p.skills).toEqual([]);
    expect(p.cohorts).toEqual([]);
    expect(p.strongest_skill).toBeNull();
  });

  it('reports undefined relative change as the string "undefined"', () => {
    const pairs = pairsFromDiffs(Array(10).fill(10)).map((x) => ({
      ...x,
      pre_percentage: 0,
      post_percentage: 10,
    }));
    const p = buildAiPayload(buildImpactDashboard(dashboardInput({ pairs })), ctx);
    expect(p.relative_change_percent).toBe('undefined');
  });

  it('redacts identifier-like substrings in free-text labels instead of failing', () => {
    const d = richDashboard();
    d.cohorts[0]!.cohortName = 'Cohort 3f2b8c1e-9a4d-4E6F-8b1c-2d3e4f5a6b7c';
    const p = buildAiPayload(d, ctx);
    expect(p.cohorts[0]!.name).toBe('Cohort [redacted]');
    expect(JSON.stringify(p)).not.toMatch(/3f2b8c1e/i);
  });

  it('a cohort named "S-SPRING Cohort" still yields a working payload', () => {
    const d = richDashboard();
    d.cohorts[0]!.cohortName = 'S-SPRING Cohort';
    const p = buildAiPayload(d, { ...ctx, scopeLabel: 'Program / S-SPRING Cohort' });
    expect(p.cohorts[0]!.name).toBe('[redacted] Cohort');
    expect(p.scope_label).toBe('Program / [redacted] Cohort');
    expect(() => assertNoIdentifiers(p)).not.toThrow();
  });

  it('redacts public codes, access codes and emails in labels, case-insensitively', () => {
    for (const [label, expected] of [
      ['Group s-7kq2m9', 'Group [redacted]'],
      ['X 7KQ2-M9XA-B3CD-EF45', 'X [redacted]'],
      ['X 7kq2m9xab3cdef45', 'X [redacted]'],
      ['kid@example.com', '[redacted]'],
    ] as const) {
      expect(buildAiPayload(richDashboard(), { ...ctx, scopeLabel: label }).scope_label).toBe(
        expected,
      );
    }
  });

  it('sanitizeFreeText trims, strips control characters and caps at 80 characters', () => {
    expect(sanitizeFreeText('  a\u0000b\nc  ')).toBe('a b c');
    expect(sanitizeFreeText('x'.repeat(200))).toHaveLength(80);
  });

  it('assertNoIdentifiers still throws on payloads that were not sanitized', () => {
    const p = buildAiPayload(richDashboard(), ctx);
    expect(() => assertNoIdentifiers({ ...p, scope_label: 'Group S-7KQ2M9' })).toThrow(
      PayloadIdentifierError,
    );
  });
});

describe('assertNoIdentifiers', () => {
  it('rejects denylisted keys anywhere', () => {
    for (const k of [
      'student_id',
      'attempt_id',
      'code',
      'email',
      'student_name',
      'responses',
      'id',
    ]) {
      expect(() => assertNoIdentifiers({ ok: 1, nested: [{ [k]: 'x' }] }), k).toThrow(
        PayloadIdentifierError,
      );
    }
  });
  it('allows ordinary aggregate data', () => {
    expect(() =>
      assertNoIdentifiers({
        name: 'Spring cohort',
        students_enrolled: 12,
        text: 'CLASS-ABCDEF is not a code',
        nums: [1, 2],
      }),
    ).not.toThrow();
    expect(() => assertNoIdentifiers({ label: 'COMPUTATIONALTHINKING' })).not.toThrow();
  });
});

describe('prompt + schema', () => {
  it('schema requires all fields', () => {
    expect(AI_SUMMARY_JSON_SCHEMA.required).toEqual([
      'headline',
      'summary',
      'key_findings',
      'areas_for_improvement',
      'recommendations',
      'limitations',
    ]);
    expect(AI_SUMMARY_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(AI_SUMMARY_JSON_SCHEMA.properties.key_findings.maxItems).toBe(6);
    expect(AI_SUMMARY_JSON_SCHEMA.properties.summary.maxLength).toBe(600);
    expect(PROMPT_VERSION).toBe(AI_PROMPT_VERSION);
  });

  it.each(REPORT_TYPES)('builds messages for %s', (reportType) => {
    const p = buildAiPayload(richDashboard(), { ...ctx, reportType });
    const msgs = buildSummaryMessages(p);
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user']);
    const system = msgs[0]!.content;
    expect(system).toMatch(/ONLY numbers/);
    expect(system).toMatch(/never claim|Never claim/i);
    expect(system).toMatch(/percentage points/);
    expect(system).toMatch(/self-reported/);
    expect(system).toMatch(/sample_sufficient is false/);
    expect(system).toMatch(/synthetic/);
    expect(system).toMatch(/limitations/);
    expect(JSON.parse(msgs[1]!.content.slice(msgs[1]!.content.indexOf('{')))).toEqual(p);
  });
});

describe('parseAiSummary', () => {
  const good: AiSummaryContent = {
    headline: ' Headline ',
    summary: 'Summary',
    key_findings: ['a', ' b '],
    areas_for_improvement: [],
    recommendations: ['r'],
    limitations: ['l'],
  };

  it('accepts objects, JSON strings and fenced JSON', () => {
    expect(parseAiSummary(good)).toMatchObject({ headline: 'Headline', key_findings: ['a', 'b'] });
    expect(parseAiSummary(JSON.stringify(good))?.summary).toBe('Summary');
    expect(parseAiSummary('```json\n' + JSON.stringify(good) + '\n```')?.summary).toBe('Summary');
    expect(
      parseAiSummary('Here you go:\n```\n' + JSON.stringify(good) + '\n```\nThanks')?.summary,
    ).toBe('Summary');
    expect(parseAiSummary('Sure! ' + JSON.stringify(good))?.summary).toBe('Summary');
  });

  it('caps lengths and list sizes, drops empty items and extra keys', () => {
    const big = {
      ...good,
      headline: 'h'.repeat(500),
      summary: 's'.repeat(2000),
      key_findings: Array.from({ length: 12 }, (_, i) => `f${i}`).concat(['']),
      extra: 'ignored',
    };
    const out = parseAiSummary(big)!;
    expect(out.headline).toHaveLength(200);
    expect(out.summary).toHaveLength(600);
    expect(out.key_findings).toHaveLength(6);
    expect('extra' in out).toBe(false);
  });

  it('returns null for garbage', () => {
    for (const bad of [
      null,
      undefined,
      42,
      [],
      'not json',
      '{"headline":',
      '{}',
      { ...good, headline: '   ' },
      { ...good, key_findings: 'x' },
      { ...good, key_findings: [1] },
      { headline: 'h' },
    ]) {
      expect(parseAiSummary(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('checkNumbers', () => {
  const payload = buildAiPayload(richDashboard(), ctx);
  const content = (text: string, over: Partial<AiSummaryContent> = {}): AiSummaryContent => ({
    headline: 'Observed gain',
    summary: text,
    key_findings: [],
    areas_for_improvement: [],
    recommendations: [],
    limitations: [],
    ...over,
  });

  it('passes numbers present in the payload in many formats', () => {
    const p = payload;
    const c = content(
      `Average score rose from ${p.average_pre_score}% to ${p.average_post_score}%, a ${p.average_change_points}-point change among ${p.matched_students} students (95% CI ${p.change_ci95!.low} to ${p.change_ci95!.high}). Relative ${p.relative_change_percent}%. Period 2026-03-15.`,
      {
        key_findings: [
          '3 of 5 findings',
          `Confidence ${p.self_reported_confidence!.average_pre} to ${p.self_reported_confidence!.average_post}`,
        ],
      },
    );
    expect(checkNumbers(c, p)).toEqual({ unverifiedNumbers: [], passed: true });
  });

  it('accepts roundings, sign changes and K-12', () => {
    const p: AiPayload = {
      ...payload,
      average_change_points: 12.46,
      relative_change_percent: -3.4,
    };
    expect(
      checkNumbers(
        content('About 12 points, 12.5 points, 3.4 percent lower, -3.4, K-12 students'),
        p,
      ).passed,
    ).toBe(true);
  });

  it('catches a fabricated number', () => {
    const r = checkNumbers(
      content('Scores improved by 73% across 1,234 students', { key_findings: ['Up 24-point'] }),
      payload,
    );
    expect(r.passed).toBe(false);
    expect(r.unverifiedNumbers).toContain('73');
    expect(r.unverifiedNumbers).toContain('1234');
  });

  it('catches fabricated numbers in any field', () => {
    const r = checkNumbers(
      content('ok', { recommendations: ['Target a 37.7 point gain'], limitations: ['n = 9999'] }),
      payload,
    );
    expect(r.unverifiedNumbers.sort()).toEqual(['37.7', '9999']);
  });

  it('allows derived outcome counts but not arbitrary ones', () => {
    // improving % of 15 matched students
    const p: AiPayload = {
      ...payload,
      matched_students: 15,
      percentage_improving: 80,
      percentage_unchanged: 0,
      percentage_declining: 20,
    };
    expect(checkNumbers(content('12 of 15 improved and 3 declined'), p).passed).toBe(true);
    expect(checkNumbers(content('13 of 15 improved'), p).unverifiedNumbers).toEqual(['13']);
  });
});

describe('buildTemplateSummary', () => {
  it.each(REPORT_TYPES)('passes the number guard and is non-causal (%s)', (reportType) => {
    const p = buildAiPayload(richDashboard(), { ...ctx, reportType });
    const t = buildTemplateSummary(p);
    expect(checkNumbers(t, p)).toEqual({ unverifiedNumbers: [], passed: true });
    const all = JSON.stringify({ ...t, limitations: [] }); // standard limitations legitimately say "caused"
    expect(all).not.toMatch(/because of|caused|proved|thanks to/i);
    expect(t.headline).toMatch(
      /Observed average gain of 17 percentage points among 15 matched students/,
    );
    expect(t.summary).toMatch(/synthetic/i);
    expect(t.key_findings.length).toBeGreaterThan(2);
    expect(t.key_findings.join(' ')).toMatch(/Self-reported confidence/);
    expect(t.limitations.length).toBeGreaterThan(3);
    for (const arr of [t.key_findings, t.areas_for_improvement, t.recommendations, t.limitations])
      expect(arr.length).toBeLessThanOrEqual(6);
    expect(parseAiSummary(t)).toEqual(t);
  });

  it('handles insufficient data honestly', () => {
    const p = buildAiPayload(
      buildImpactDashboard(dashboardInput({ pairs: pairsFromDiffs([10, 20, 30]) })),
      ctx,
    );
    const t = buildTemplateSummary(p);
    expect(t.summary).toMatch(/insufficient for conclusions/);
    expect(t.summary).toMatch(/Only 3 matched students/);
    expect(t.headline).toMatch(/Not enough matched data/);
    expect(checkNumbers(t, p).passed).toBe(true);
    expect(JSON.stringify(t)).not.toMatch(/percentage points among/);
  });

  it('handles zero matched students', () => {
    const p = buildAiPayload(
      buildImpactDashboard(dashboardInput({ pairs: [], attempts: [] })),
      ctx,
    );
    const t = buildTemplateSummary(p);
    expect(t.summary).toMatch(/No students have both/);
    expect(checkNumbers(t, p).passed).toBe(true);
  });

  it('handles undefined relative change and declines', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => pair(0, i % 2 ? 10 : 0));
    const p = buildAiPayload(buildImpactDashboard(dashboardInput({ pairs })), ctx);
    const t = buildTemplateSummary(p);
    expect(t.summary).toMatch(/undefined because the average pre-assessment score was zero/);
    expect(checkNumbers(t, p).passed).toBe(true);

    const down = buildAiPayload(
      buildImpactDashboard(dashboardInput({ pairs: pairsFromDiffs(Array(10).fill(-5)) })),
      ctx,
    );
    const td = buildTemplateSummary(down);
    expect(td.headline).toMatch(/decrease of 5 percentage points/);
    expect(td.summary).toMatch(/fell from 50% to 45%/);
    expect(checkNumbers(td, down).passed).toBe(true);
  });

  it('does not mention suppressed skills or cohorts', () => {
    const p = buildAiPayload(richDashboard(), ctx);
    expect(JSON.stringify(buildTemplateSummary(p))).not.toMatch(/Debugging|Tiny cohort/);
  });
});
