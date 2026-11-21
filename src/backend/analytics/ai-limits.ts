/** Shared size limits for AiSummaryContent (used by the JSON schema and the output parser). */
export const AI_LIMITS = {
  headlineMaxLength: 200,
  textMaxLength: 600,
  maxItems: 6,
} as const;
