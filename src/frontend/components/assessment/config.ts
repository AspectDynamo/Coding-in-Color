import type { PublicQuestion, ResponseValue } from '@shared/api';

/** Defensive readers for the public question config (shape defined in shared/validation.ts). */
export interface Option {
  id: string;
  label: string;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function options(v: unknown): Option[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((o) => {
    const id = str((o as Option | null)?.id);
    const label = str((o as Option | null)?.label);
    return id !== undefined && label !== undefined ? [{ id, label }] : [];
  });
}

export function readConfig(q: Pick<PublicQuestion, 'config'>) {
  const c = q.config ?? {};
  return {
    code: str(c.code),
    language: str(c.language),
    options: options(c.options),
    items: options(c.items),
    hint: str(c.hint),
    placeholder: str(c.placeholder),
    maxLength: typeof c.maxLength === 'number' ? c.maxLength : 40,
    minLabel: str(c.minLabel) ?? 'Not at all confident',
    maxLabel: str(c.maxLabel) ?? 'Very confident',
  };
}

/** A response counts as answered when it carries a real choice (not skipped / empty). */
export function isAnswered(r: ResponseValue | undefined): boolean {
  if (!r) return false;
  switch (r.kind) {
    case 'single':
      return r.optionId.length > 0;
    case 'multi':
      return r.optionIds.length > 0;
    case 'line':
      return r.line > 0;
    case 'order':
      return r.itemIds.length > 0;
    case 'text':
      return r.text.trim().length > 0;
    case 'likert':
      return r.value >= 1;
    default:
      return false;
  }
}
