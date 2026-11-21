import { z } from 'zod';
import type { AiSummaryContent } from '../../shared/api';
import { AI_LIMITS } from './ai-limits';

const cap = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .transform((s) => (s.length > max ? s.slice(0, max).trimEnd() : s));

const list = z
  .array(cap(AI_LIMITS.textMaxLength))
  .transform((a) => a.filter((s) => s.length > 0).slice(0, AI_LIMITS.maxItems));

const aiSummarySchema = z.object({
  headline: cap(AI_LIMITS.headlineMaxLength).refine((s) => s.length > 0),
  summary: cap(AI_LIMITS.textMaxLength).refine((s) => s.length > 0),
  key_findings: list,
  areas_for_improvement: list,
  recommendations: list,
  limitations: list,
});

function extractJson(text: string): unknown {
  let s = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fenced?.[1]) s = fenced[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Validate model output. Accepts an object or a JSON string (optionally in ```json fences).
 * Trims strings, caps lengths (headline 200, others 600) and list sizes (6). Returns null if invalid.
 */
export function parseAiSummary(raw: unknown): AiSummaryContent | null {
  const value = typeof raw === 'string' ? extractJson(raw) : raw;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = aiSummarySchema.safeParse(value);
  return r.success ? r.data : null;
}
