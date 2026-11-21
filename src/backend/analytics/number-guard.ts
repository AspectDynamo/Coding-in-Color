/**
 * Number guard: every number in an AI narrative must be traceable to the payload the model saw.
 *
 * Allowed numbers = every number in the payload (numeric values and digits inside strings such as
 * the period dates, scope label and limitations), each also at 0, 1 and 2 dp roundings, plus derived
 * outcome counts (percentage_* x matched_students / 100), plus the integers 0-10 (common prose such
 * as "two skills" / "3 findings") and the statistical constants 95 and 100. Signs are ignored
 * (compared by absolute value), so "-3.4" and "3.4 points lower" both verify against 3.4. "K-12" is
 * stripped before extraction (program name, not a data point).
 */
import type { AiSummaryContent } from '../../shared/api';
import type { AiPayload } from './ai-payload';

const NUMBER_RE = /\d[\d,]*(?:\.\d+)?|\.\d+/g;

function tokens(text: string): string[] {
  const cleaned = text.replace(/\bK-12\b/gi, ' ');
  return (cleaned.match(NUMBER_RE) ?? []).map((t) => t.replace(/,/g, '').replace(/\.$/, ''));
}

const key = (n: number) => String(Math.round(n * 1e6) / 1e6);

function addWithRoundings(set: Set<string>, n: number): void {
  const a = Math.abs(n);
  set.add(key(a));
  for (const dp of [0, 1, 2]) {
    const f = 10 ** dp;
    set.add(key(Math.round(a * f + 1e-9) / f));
  }
}

function collect(value: unknown, set: Set<string>): void {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) addWithRoundings(set, value);
  } else if (typeof value === 'string') {
    for (const t of tokens(value)) {
      const n = Number(t);
      if (Number.isFinite(n)) addWithRoundings(set, n);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v) => collect(v, set));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => collect(v, set));
  }
}

export function allowedNumbers(payload: AiPayload): Set<string> {
  const set = new Set<string>();
  collect(payload, set);
  for (let i = 0; i <= 10; i++) set.add(String(i));
  set.add('95');
  set.add('100');
  for (const pct of [
    payload.percentage_improving,
    payload.percentage_unchanged,
    payload.percentage_declining,
  ]) {
    if (pct !== null) addWithRoundings(set, (pct * payload.matched_students) / 100);
  }
  return set;
}

function collectText(c: AiSummaryContent): string[] {
  return [
    c.headline,
    c.summary,
    ...c.key_findings,
    ...c.areas_for_improvement,
    ...c.recommendations,
    ...c.limitations,
  ];
}

export function checkNumbers(
  content: AiSummaryContent,
  payload: AiPayload,
): { unverifiedNumbers: string[]; passed: boolean } {
  const allowed = allowedNumbers(payload);
  const bad = new Set<string>();
  for (const text of collectText(content)) {
    for (const t of tokens(text)) {
      const n = Number(t);
      if (!Number.isFinite(n)) continue;
      if (!allowed.has(key(Math.abs(n)))) bad.add(t);
    }
  }
  const unverifiedNumbers = [...bad];
  return { unverifiedNumbers, passed: unverifiedNumbers.length === 0 };
}
