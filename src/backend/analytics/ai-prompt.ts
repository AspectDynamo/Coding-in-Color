/** Prompt + JSON schema for the AI impact summary. The model only ever sees an AiPayload. */
import { AI_PROMPT_VERSION } from '../../shared/constants';
import { REPORT_TYPE_LABELS, type ReportType } from '../../shared/types';
import type { AiPayload } from './ai-payload';
import { AI_LIMITS } from './ai-limits';

export const PROMPT_VERSION = AI_PROMPT_VERSION;

const stringArray = (maxItems: number) => ({
  type: 'array',
  items: { type: 'string', maxLength: AI_LIMITS.textMaxLength },
  maxItems,
});

/** JSON schema for AiSummaryContent. All fields required; no additional properties. */
export const AI_SUMMARY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'headline',
    'summary',
    'key_findings',
    'areas_for_improvement',
    'recommendations',
    'limitations',
  ],
  properties: {
    headline: { type: 'string', maxLength: AI_LIMITS.headlineMaxLength },
    summary: { type: 'string', maxLength: AI_LIMITS.textMaxLength },
    key_findings: stringArray(AI_LIMITS.maxItems),
    areas_for_improvement: stringArray(AI_LIMITS.maxItems),
    recommendations: stringArray(AI_LIMITS.maxItems),
    limitations: stringArray(AI_LIMITS.maxItems),
  },
} as const;

const REPORT_GUIDANCE: Record<ReportType, string> = {
  program_impact:
    'Audience: nonprofit leaders. Give a balanced overview of observed learning outcomes for the program.',
  cohort_summary:
    'Audience: program staff. Summarize how this cohort performed and how its cohorts or skills compare.',
  grant_narrative:
    'Audience: funders reading a grant report. Use measured, factual language suitable for a grant-reporting narrative; do not oversell.',
  donor_update: 'Audience: donors. Use warm but strictly factual plain language; do not overstate.',
  board_summary:
    'Audience: a board of directors. Be brief and decision-oriented, leading with the headline measures and the limits of the data.',
  instructional_insights:
    'Audience: instructors and curriculum leads. Emphasize strongest and weakest skills and practical instructional recommendations grounded in the data.',
};

export function buildSystemPrompt(reportType: ReportType): string {
  return [
    `You write ${REPORT_TYPE_LABELS[reportType]} text for Coding in Color, an Arizona nonprofit that teaches coding. You are given a JSON object of AGGREGATE assessment results. ${REPORT_GUIDANCE[reportType]}`,
    '',
    'Rules (all mandatory):',
    '1. Use ONLY numbers that appear in the JSON. Never invent, estimate, extrapolate or compute new counts, percentages or averages. If a value is null or absent, do not mention a number for it.',
    '2. Describe results as "observed" or "measured". Never claim or imply that the program caused the change (no "because of", "thanks to", "proved", "resulted in").',
    '3. Distinguish percentage points (average_change_points, change values, CI bounds) from percent (relative_change_percent, percentage_* fields). If relative_change_percent is "undefined", say the relative change is undefined because the average pre score was zero.',
    '4. Confidence values are self-reported; report them separately from measured scores and do not treat them as skill.',
    '5. If sample_sufficient is false, state clearly that the data are insufficient for conclusions and do not describe trends or rank skills or cohorts.',
    '6. If is_synthetic_data is true, say this is synthetic demonstration data.',
    '7. Include the limitations from the JSON; you may add that matched students only are included. Mention the assessment period and the number of matched students.',
    '8. Be concise: a headline, a short summary, and at most six short items per list. Plain language, no jargon, no markdown.',
    '9. Never mention individual students, student identifiers, or anything not in the JSON.',
    '',
    'Respond with a single JSON object with exactly these fields: headline (string), summary (string), key_findings (string[]), areas_for_improvement (string[]), recommendations (string[]), limitations (string[]). Output JSON only.',
  ].join('\n');
}

export function buildSummaryMessages(
  payload: AiPayload,
): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: buildSystemPrompt(payload.report_type) },
    {
      role: 'user',
      content: `Write the ${REPORT_TYPE_LABELS[payload.report_type]} from this aggregate data (JSON). Use only these numbers.\n\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}
