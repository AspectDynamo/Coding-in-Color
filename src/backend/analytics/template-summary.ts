/**
 * Deterministic, non-AI narrative built only from the AiPayload. Used when the model fails or its
 * output is rejected. Every number it writes comes from the payload (so it passes checkNumbers).
 * Uses observational language only; never claims causation.
 */
import type { AiSummaryContent } from '../../shared/api';
import type { AiPayload } from './ai-payload';
import { AI_LIMITS } from './ai-limits';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function clip(s: string): string {
  return s.length > AI_LIMITS.textMaxLength
    ? `${s.slice(0, AI_LIMITS.textMaxLength - 1).trimEnd()}…`
    : s;
}

function periodText(p: AiPayload): string {
  const { from, to } = p.assessment_period;
  if (from && to) return from === to ? `on ${from}` : `from ${from} to ${to}`;
  return 'in the selected period';
}

export function buildTemplateSummary(p: AiPayload): AiSummaryContent {
  const limitations = p.limitations.slice(0, AI_LIMITS.maxItems).map(clip);
  const synthetic = p.is_synthetic_data
    ? ' This report uses synthetic demonstration data, not real students.'
    : '';
  const participation = `${p.students_enrolled} ${plural(p.students_enrolled, 'student was', 'students were')} enrolled; ${p.pre_completions} completed a pre-assessment and ${p.post_completions} completed a post-assessment.`;

  // Insufficient data (or suppressed values): say so and stop.
  if (
    !p.sample_sufficient ||
    p.average_change_points === null ||
    p.average_pre_score === null ||
    p.average_post_score === null
  ) {
    const matchedText =
      p.matched_students === 0
        ? 'No students have both a pre- and a post-assessment in this selection.'
        : `Only ${p.matched_students} matched ${plural(p.matched_students, 'student has', 'students have')} both a pre- and a post-assessment, fewer than the ${p.suppression_threshold} needed to report results.`;
    return {
      headline: 'Not enough matched data to report learning gains yet',
      summary: clip(
        `${matchedText} The data are insufficient for conclusions, so score changes are withheld. Assessment period: ${periodText(p)} for ${p.scope_label}.${synthetic}`,
      ),
      key_findings: [clip(participation)],
      areas_for_improvement: [
        clip('Too few students completed both assessments to identify strengths or weaknesses.'),
      ],
      recommendations: [
        clip(
          'Encourage every participant to complete both the pre- and the post-assessment so a larger matched sample can be measured.',
        ),
        clip('Review results again once enough matched students are available.'),
      ],
      limitations,
    };
  }

  const change = p.average_change_points;
  const direction = change > 0 ? 'rose' : change < 0 ? 'fell' : 'did not change';
  const magnitude = Math.abs(change);
  const changeText =
    change === 0
      ? `The average score did not change (${p.average_pre_score}% before, ${p.average_post_score}% after).`
      : `The average score ${direction} from ${p.average_pre_score}% to ${p.average_post_score}%, an observed change of ${change > 0 ? '+' : '-'}${magnitude} percentage points.`;
  const relative =
    p.relative_change_percent === 'undefined'
      ? ' The relative change in percent is undefined because the average pre-assessment score was zero.'
      : p.relative_change_percent !== null
        ? ` That is a relative change of ${p.relative_change_percent} percent.`
        : '';

  const headline =
    change > 0
      ? `Observed average gain of ${magnitude} percentage points among ${p.matched_students} matched students`
      : change < 0
        ? `Observed average decrease of ${magnitude} percentage points among ${p.matched_students} matched students`
        : `No observed average change among ${p.matched_students} matched students`;

  const rates =
    p.completion_rate !== null && p.match_rate !== null
      ? ` The post-assessment completion rate was ${p.completion_rate}% of enrolled students, and ${p.match_rate}% of pre-assessment completers have a matched post-assessment.`
      : '';
  const findings: string[] = [`${participation}${rates}`];
  if (
    p.percentage_improving !== null &&
    p.percentage_unchanged !== null &&
    p.percentage_declining !== null
  ) {
    findings.push(
      `Among matched students, ${p.percentage_improving}% scored higher, ${p.percentage_unchanged}% scored the same and ${p.percentage_declining}% scored lower on the post-assessment.`,
    );
  }
  if (p.change_ci95) {
    const effect =
      p.effect_size_dz !== null ? ` The paired effect size (d_z) is ${p.effect_size_dz}.` : '';
    findings.push(
      `The 95% confidence interval for the average change is ${p.change_ci95.low} to ${p.change_ci95.high} percentage points.${effect}`,
    );
  }
  if (p.strongest_skill) {
    const s = p.skills.find((x) => x.skill === p.strongest_skill);
    if (s && s.change !== null)
      findings.push(
        `The largest observed change by skill was in ${s.skill} (${s.change} percentage points, ${s.n} matched students).`,
      );
  }
  if (
    p.self_reported_confidence &&
    p.self_reported_confidence.average_pre !== null &&
    p.self_reported_confidence.average_post !== null
  ) {
    findings.push(
      `Self-reported confidence (1 to 5 scale, reported separately from scores) moved from ${p.self_reported_confidence.average_pre} to ${p.self_reported_confidence.average_post} for ${p.self_reported_confidence.n} students.`,
    );
  }
  if (
    p.retention &&
    p.retention.average_post_score !== null &&
    p.retention.average_retention_score !== null
  ) {
    findings.push(
      `For ${p.retention.n} students with a later retention assessment, the average score was ${p.retention.average_post_score}% after the program and ${p.retention.average_retention_score}% at retention.`,
    );
  }

  const improve: string[] = [];
  if (p.weakest_skill) {
    const s = p.skills.find((x) => x.skill === p.weakest_skill);
    if (s && s.change !== null)
      improve.push(
        `The smallest observed change by skill was in ${s.skill} (${s.change} percentage points); it may merit extra instructional attention.`,
      );
  }
  if (p.percentage_declining !== null && p.percentage_declining > 0) {
    improve.push(
      `${p.percentage_declining}% of matched students scored lower on the post-assessment; reviewing assessment conditions and instruction for these learners may help.`,
    );
  }
  if (p.match_rate !== null && p.match_rate < 60) {
    improve.push(
      'A low match rate means many students are missing a pre- or post-assessment; results may not represent the whole group.',
    );
  }
  const lowCohorts = p.cohorts
    .filter((c) => c.change !== null)
    .sort((a, b) => (a.change as number) - (b.change as number));
  if (lowCohorts.length > 1) {
    const c = lowCohorts[0]!;
    improve.push(
      `${c.name} had the smallest observed average change (${c.change} percentage points, ${c.matched} matched students).`,
    );
  }
  if (!improve.length) improve.push('No specific area stands out in these aggregate results.');

  const recommendations = [
    'Keep collecting matched pre- and post-assessments for all participants so results rest on larger samples.',
    p.weakest_skill
      ? `Review how ${p.weakest_skill} is taught and assessed.`
      : 'Review the skills with the smallest observed change when more data are available.',
    'Interpret these results alongside qualitative feedback from students and instructors.',
  ];

  return {
    headline: clip(headline).slice(0, AI_LIMITS.headlineMaxLength),
    summary: clip(
      `${changeText}${relative} This is based on ${p.matched_students} matched students for ${p.scope_label}, assessed ${periodText(p)}.${synthetic}`,
    ),
    key_findings: findings.slice(0, AI_LIMITS.maxItems).map(clip),
    areas_for_improvement: improve.slice(0, AI_LIMITS.maxItems).map(clip),
    recommendations: recommendations.slice(0, AI_LIMITS.maxItems).map(clip),
    limitations,
  };
}
