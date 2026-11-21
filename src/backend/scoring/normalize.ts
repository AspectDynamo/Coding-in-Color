/**
 * Short-logic answer normalization: trim, strip one pair of surrounding quotes, collapse internal
 * whitespace, and (unless caseSensitive) lowercase. Numeric answers are compared numerically.
 */
const QUOTE_PAIRS: [string, string][] = [
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
  ['“', '”'],
  ['‘', '’'],
];

const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function normalizeText(input: string, caseSensitive: boolean): string {
  let s = input.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(1, -1);
      break;
    }
  }
  s = s.trim().replace(/\s+/g, ' ');
  return caseSensitive ? s : s.toLowerCase();
}

function asNumber(normalized: string): number | null {
  if (!NUMERIC.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export function shortAnswerMatches(
  response: string,
  accepted: string[],
  caseSensitive: boolean,
): boolean {
  const r = normalizeText(response, caseSensitive);
  if (r === '') return false;
  const rn = asNumber(r);
  for (const a of accepted) {
    const an = normalizeText(a, caseSensitive);
    if (an === r) return true;
    if (rn !== null) {
      const n = asNumber(an);
      if (n !== null && n === rn) return true;
    }
  }
  return false;
}
