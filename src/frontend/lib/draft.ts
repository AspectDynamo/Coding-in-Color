import type { ResponseValue } from '@shared/api';

/**
 * Assessment drafts: answers only, in sessionStorage, keyed by attempt id.
 * Never credentials, codes or tokens. Cleared on submit.
 */
export type Answers = Record<string, ResponseValue>;
export interface Draft {
  v: 1;
  answers: Answers;
  index: number;
}

const key = (attemptId: string) => `cic:draft:${attemptId}`;

export function loadDraft(attemptId: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(key(attemptId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (d.v !== 1 || typeof d.answers !== 'object' || d.answers === null) return null;
    return { v: 1, answers: d.answers, index: typeof d.index === 'number' ? d.index : 0 };
  } catch {
    return null;
  }
}

export function saveDraft(attemptId: string, answers: Answers, index: number): void {
  try {
    window.sessionStorage.setItem(
      key(attemptId),
      JSON.stringify({ v: 1, answers, index } satisfies Draft),
    );
  } catch {
    /* storage full or blocked: the in-memory answers still work */
  }
}

export function clearDraft(attemptId: string): void {
  try {
    window.sessionStorage.removeItem(key(attemptId));
  } catch {
    /* ignore */
  }
}

export function clearAllDrafts(): void {
  try {
    const s = window.sessionStorage;
    for (let i = s.length - 1; i >= 0; i--) {
      const k = s.key(i);
      if (k?.startsWith('cic:draft:')) s.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}
