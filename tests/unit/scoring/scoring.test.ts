import { describe, expect, it } from 'vitest';
import {
  ResponseValidationError,
  ScoringError,
  normalizeText,
  scoreAttempt,
  scorers,
  toPublicQuestion,
  type ScoringQuestion,
} from '../../../src/backend/scoring';
import { QUESTION_TYPES } from '../../../src/shared/types';
import type { ResponseValue } from '../../../src/shared/validation';

const opts = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: String.fromCharCode(97 + i),
    label: `Option ${i + 1}`,
  }));

const mc = (id: string, over: Partial<ScoringQuestion> = {}): ScoringQuestion => ({
  id,
  type: 'multiple_choice',
  points: 1,
  skillCategory: 'variables',
  config: { options: opts(4) },
  answerKey: { correctOptionId: 'b' },
  ...over,
});
const ms = (id: string, over: Partial<ScoringQuestion> = {}): ScoringQuestion => ({
  id,
  type: 'multiple_select',
  points: 3,
  skillCategory: 'loops',
  config: { options: opts(5) },
  answerKey: { correctOptionIds: ['a', 'b', 'c'] },
  ...over,
});
const dbg = (id: string): ScoringQuestion => ({
  id,
  type: 'debugging',
  points: 2,
  skillCategory: 'debugging',
  config: { code: 'a = 1\nb = 2\nprint(a + c)' },
  answerKey: { bugLine: 3 },
});
const ord = (id: string): ScoringQuestion => ({
  id,
  type: 'ordering',
  points: 2,
  skillCategory: 'computational_thinking',
  config: { items: opts(4) },
  answerKey: { correctOrder: ['c', 'a', 'd', 'b'] },
});
const sl = (
  id: string,
  key: Record<string, unknown> = { acceptedAnswers: ['4'], caseSensitive: false },
): ScoringQuestion => ({
  id,
  type: 'short_logic',
  points: 1,
  skillCategory: 'logic',
  config: { maxLength: 40 },
  answerKey: key,
});
const lk = (id: string): ScoringQuestion => ({
  id,
  type: 'confidence_likert',
  points: 0,
  skillCategory: 'programming_fundamentals',
  config: {},
  answerKey: null,
});
const rb = (id: string): ScoringQuestion => ({
  id,
  type: 'project_rubric',
  points: 10,
  skillCategory: 'problem_solving',
  config: { criteria: [{ id: 'c1', label: 'Works', maxPoints: 10 }] },
  answerKey: null,
});

const single = (optionId: string): ResponseValue => ({ kind: 'single', optionId });
const multi = (...optionIds: string[]): ResponseValue => ({ kind: 'multi', optionIds });
const text = (t: string): ResponseValue => ({ kind: 'text', text: t });

const score = (questions: ScoringQuestion[], responses: Record<string, ResponseValue>) =>
  scoreAttempt({
    questions,
    responses: Object.entries(responses).map(([questionId, response]) => ({
      questionId,
      response,
    })),
  });

describe('scoreAttempt: single-choice types', () => {
  it.each(['multiple_choice', 'code_comprehension', 'predict_output'] as const)(
    '%s correct / wrong / skipped',
    (type) => {
      const q = mc('q1', { type });
      expect(score([q], { q1: single('b') })).toMatchObject({
        rawScore: 1,
        maxScore: 1,
        percentageScore: 100,
      });
      const wrong = score([q], { q1: single('a') });
      expect(wrong.rawScore).toBe(0);
      expect(wrong.responses[0]).toMatchObject({ isCorrect: false, earnedPoints: 0, maxPoints: 1 });
      const skipped = score([q], { q1: { kind: 'skipped' } });
      expect(skipped.responses[0]).toMatchObject({
        responseData: { kind: 'skipped' },
        isCorrect: false,
        earnedPoints: 0,
        maxPoints: 1,
      });
      expect(skipped.maxScore).toBe(1);
      expect(skipped.answeredCount).toBe(0);
    },
  );

  it('missing response becomes a skipped response that still counts toward max', () => {
    const r = score([mc('q1'), mc('q2')], { q1: single('b') });
    expect(r.maxScore).toBe(2);
    expect(r.rawScore).toBe(1);
    expect(r.percentageScore).toBe(50);
    expect(r.responses[1]).toMatchObject({
      questionId: 'q2',
      responseData: { kind: 'skipped' },
      earnedPoints: 0,
      maxPoints: 1,
    });
    expect(r.answeredCount).toBe(1);
  });

  it('rejects unknown option ids', () => {
    expect(() => score([mc('q1')], { q1: single('zzz') })).toThrow(ResponseValidationError);
  });

  it('respects question points', () => {
    expect(score([mc('q1', { points: 2.5 })], { q1: single('b') })).toMatchObject({
      rawScore: 2.5,
      maxScore: 2.5,
    });
  });
});

describe('scoreAttempt: multiple_select partial credit', () => {
  const q = ms('q1'); // correct a,b,c of 5, 3 points
  it.each([
    [['a', 'b', 'c'], 3, true],
    [['a', 'b'], 2, false],
    [['a'], 1, false],
    [['a', 'b', 'c', 'd'], 2, false], // (3-1)/3*3
    [['a', 'd'], 0, false], // (1-1) = 0
    [['d', 'e'], 0, false], // negative floored at 0
    [['a', 'b', 'd', 'e'], 0, false], // (2-2)/3
    [['a', 'b', 'c', 'd', 'e'], 1, false], // (3-2)/3*3
    [[], 0, false],
  ])('selection %j earns %d', (sel, earned, correct) => {
    const r = score([q], { q1: multi(...sel) });
    expect(r.rawScore).toBe(earned);
    expect(r.responses[0]!.isCorrect).toBe(correct);
    expect(r.maxScore).toBe(3);
  });

  it('rounds partial points to 2 dp', () => {
    const r = score([ms('q1', { points: 1 })], { q1: multi('a', 'b') });
    expect(r.rawScore).toBe(0.67);
    expect(r.percentageScore).toBe(67);
  });

  it('rejects unknown and duplicate option ids', () => {
    expect(() => score([q], { q1: multi('a', 'zzz') })).toThrow(ResponseValidationError);
    expect(() => score([q], { q1: multi('a', 'a') })).toThrow(/Duplicate/);
  });
});

describe('scoreAttempt: debugging, ordering, short_logic', () => {
  it('debugging: line equality', () => {
    expect(score([dbg('q1')], { q1: { kind: 'line', line: 3 } }).rawScore).toBe(2);
    expect(score([dbg('q1')], { q1: { kind: 'line', line: 2 } }).rawScore).toBe(0);
    expect(score([dbg('q1')], { q1: { kind: 'line', line: 99 } }).rawScore).toBe(0);
  });

  it('ordering: exact sequence only', () => {
    const q = ord('q1');
    expect(score([q], { q1: { kind: 'order', itemIds: ['c', 'a', 'd', 'b'] } }).rawScore).toBe(2);
    expect(score([q], { q1: { kind: 'order', itemIds: ['a', 'c', 'd', 'b'] } }).rawScore).toBe(0);
    expect(score([q], { q1: { kind: 'order', itemIds: ['c', 'a'] } }).rawScore).toBe(0);
    expect(() => score([q], { q1: { kind: 'order', itemIds: ['c', 'a', 'x', 'b'] } })).toThrow(
      ResponseValidationError,
    );
    expect(() => score([q], { q1: { kind: 'order', itemIds: ['c', 'c', 'd', 'b'] } })).toThrow(
      /Duplicate/,
    );
  });

  it('short_logic normalization', () => {
    const q = sl('q1', { acceptedAnswers: ['Hello World', '4'], caseSensitive: false });
    for (const t of [
      'hello world',
      '  HELLO   WORLD ',
      '"Hello World"',
      "'hello world'",
      '“Hello World”',
      '4',
      '4.0',
      '04',
      ' +4 ',
      '4.',
    ]) {
      expect(score([q], { q1: text(t) }).rawScore, t).toBe(1);
    }
    for (const t of ['hello', '5', '', 'helloworld', '4.1', '"4']) {
      expect(score([q], { q1: text(t) }).rawScore, t).toBe(0);
    }
  });

  it('short_logic caseSensitive', () => {
    const q = sl('q1', { acceptedAnswers: ['True'], caseSensitive: true });
    expect(score([q], { q1: text('True') }).rawScore).toBe(1);
    expect(score([q], { q1: text('true') }).rawScore).toBe(0);
    expect(score([q], { q1: text('  "True" ') }).rawScore).toBe(1);
  });

  it('empty text counts as unanswered', () => {
    const r = score([sl('q1')], { q1: text('   ') });
    expect(r.answeredCount).toBe(0);
    expect(r.rawScore).toBe(0);
  });

  it('normalizeText helper', () => {
    expect(normalizeText('  A   b ', false)).toBe('a b');
    expect(normalizeText('"A"', true)).toBe('A');
  });
});

describe('scoreAttempt: likert and rubric', () => {
  it('likert is excluded from max, has null correctness and feeds confidence', () => {
    const r = score([mc('q1'), lk('l1'), lk('l2')], {
      q1: single('b'),
      l1: { kind: 'likert', value: 4 },
      l2: { kind: 'likert', value: 5 },
    });
    expect(r.maxScore).toBe(1);
    expect(r.percentageScore).toBe(100);
    expect(r.selfReportedConfidence).toBe(4.5);
    expect(r.responses.find((x) => x.questionId === 'l1')).toMatchObject({
      isCorrect: null,
      earnedPoints: 0,
      maxPoints: 0,
    });
    expect(r.answeredCount).toBe(3);
  });

  it('skipped likert gives null confidence', () => {
    const r = score([mc('q1'), lk('l1')], { q1: single('b'), l1: { kind: 'skipped' } });
    expect(r.selfReportedConfidence).toBeNull();
    expect(r.responses.find((x) => x.questionId === 'l1')!.responseData).toEqual({
      kind: 'skipped',
    });
  });

  it('likert-only attempt scores 0 / 0', () => {
    const r = score([lk('l1')], { l1: { kind: 'likert', value: 3 } });
    expect(r).toMatchObject({
      rawScore: 0,
      maxScore: 0,
      percentageScore: 0,
      selfReportedConfidence: 3,
    });
  });

  it('project_rubric is excluded entirely and cannot be answered', () => {
    const r = score([mc('q1'), rb('r1')], { q1: single('b') });
    expect(r.maxScore).toBe(1);
    expect(r.responses.map((x) => x.questionId)).toEqual(['q1']);
    expect(r.skills.find((s) => s.skillCategory === 'problem_solving')).toBeUndefined();
    expect(() => score([rb('r1')], { r1: { kind: 'skipped' } })).toThrow(ResponseValidationError);
  });
});

describe('scoreAttempt: totals, skills, rounding', () => {
  it('aggregates skill sub-scores in SKILL_CATEGORIES order', () => {
    const qs = [ms('m1'), mc('c1'), dbg('d1'), mc('c2', { skillCategory: 'variables' })];
    const r = score(qs, {
      m1: multi('a', 'b'),
      c1: single('b'),
      d1: { kind: 'line', line: 1 },
      c2: single('a'),
    });
    expect(r.skills).toEqual([
      { skillCategory: 'variables', earnedPoints: 1, maxPoints: 2 },
      { skillCategory: 'loops', earnedPoints: 2, maxPoints: 3 },
      { skillCategory: 'debugging', earnedPoints: 0, maxPoints: 2 },
    ]);
    expect(r.rawScore).toBe(3);
    expect(r.maxScore).toBe(7);
    expect(r.percentageScore).toBe(42.86);
  });

  it('percentage rounds to 2 dp', () => {
    const qs = [mc('a'), mc('b'), mc('c')];
    expect(score(qs, { a: single('b') }).percentageScore).toBe(33.33);
    expect(score(qs, { a: single('b'), b: single('b') }).percentageScore).toBe(66.67);
  });

  it('max 0 gives percentage 0', () => {
    expect(scoreAttempt({ questions: [], responses: [] })).toMatchObject({
      rawScore: 0,
      maxScore: 0,
      percentageScore: 0,
      answeredCount: 0,
    });
  });
});

describe('scoreAttempt: validation errors', () => {
  it('unknown questionId', () => {
    try {
      score([mc('q1')], { nope: single('a') });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ResponseValidationError);
      expect((e as ResponseValidationError).questionId).toBe('nope');
      expect((e as ResponseValidationError).code).toBe('unknown_question');
    }
  });

  it('duplicate questionIds', () => {
    expect(() =>
      scoreAttempt({
        questions: [mc('q1')],
        responses: [
          { questionId: 'q1', response: single('a') },
          { questionId: 'q1', response: single('b') },
        ],
      }),
    ).toThrow(/Duplicate response/);
  });

  it('response kind mismatch carries questionId', () => {
    try {
      score([mc('q1')], { q1: multi('a') });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ResponseValidationError);
      expect((e as ResponseValidationError).code).toBe('kind_mismatch');
      expect((e as ResponseValidationError).questionId).toBe('q1');
    }
    expect(() => score([sl('q1')], { q1: single('a') })).toThrow(ResponseValidationError);
    expect(() => score([lk('l1')], { l1: text('x') })).toThrow(ResponseValidationError);
  });

  it('malformed response values are rejected', () => {
    expect(() => score([lk('l1')], { l1: { kind: 'likert', value: 9 } as ResponseValue })).toThrow(
      ResponseValidationError,
    );
    expect(() => score([mc('q1')], { q1: { kind: 'bogus' } as unknown as ResponseValue })).toThrow(
      ResponseValidationError,
    );
  });

  it('duplicate question ids in the assessment are a ScoringError', () => {
    expect(() => scoreAttempt({ questions: [mc('q1'), mc('q1')], responses: [] })).toThrow(
      ScoringError,
    );
  });
});

describe('scoreAttempt: malformed keys and configs throw ScoringError', () => {
  const cases: [string, ScoringQuestion][] = [
    ['missing key', mc('q1', { answerKey: null })],
    ['key not an option', mc('q1', { answerKey: { correctOptionId: 'zz' } })],
    ['wrong key shape', mc('q1', { answerKey: { correctOptionIds: ['a'] } })],
    ['bad config', mc('q1', { config: { options: [{ id: 'a', label: 'x' }] } })],
    [
      'duplicate option ids',
      mc('q1', {
        config: {
          options: [
            { id: 'a', label: 'x' },
            { id: 'a', label: 'y' },
          ],
        },
      }),
    ],
    ['multi key unknown option', ms('q1', { answerKey: { correctOptionIds: ['a', 'q'] } })],
    ['multi empty key', ms('q1', { answerKey: { correctOptionIds: [] } })],
    ['debugging bugLine out of range', { ...dbg('q1'), answerKey: { bugLine: 9 } }],
    ['ordering key not a permutation', { ...ord('q1'), answerKey: { correctOrder: ['a', 'b'] } }],
    ['ordering duplicate key', { ...ord('q1'), answerKey: { correctOrder: ['a', 'a', 'b', 'c'] } }],
    ['short_logic empty accepted', sl('q1', { acceptedAnswers: [] })],
    ['negative points', mc('q1', { points: -1 })],
  ];
  it.each(cases)('%s', (_name, q) => {
    expect(() => score([q], {})).toThrow(ScoringError);
  });

  it('is validated even when the student skipped the question', () => {
    expect(() => score([mc('ok'), mc('bad', { answerKey: null })], { ok: single('b') })).toThrow(
      ScoringError,
    );
  });
});

describe('scorer registry', () => {
  it('has an entry for every question type', () => {
    for (const t of QUESTION_TYPES) expect(scorers[t]).toBeDefined();
  });
});

describe('toPublicQuestion', () => {
  const base = {
    prompt: 'Order these',
    skillCategory: 'computational_thinking' as const,
    points: 2,
    order: 1,
  };

  it('never includes answer keys and strips stray config keys', () => {
    const q = toPublicQuestion(
      {
        id: 'q1',
        type: 'multiple_choice',
        prompt: 'p',
        skillCategory: 'variables',
        points: 1,
        order: 0,
        config: { options: opts(3), correctOptionId: 'b', answerKey: { x: 1 } },
        answerKey: { correctOptionId: 'b' },
      },
      { shuffleSeed: 's' },
    );
    expect(Object.keys(q).sort()).toEqual([
      'config',
      'id',
      'order',
      'points',
      'prompt',
      'skillCategory',
      'type',
    ]);
    const json = JSON.stringify(q);
    expect(json).not.toContain('correctOptionId');
    expect(json).not.toContain('answerKey');
    expect(q.config).toEqual({ options: opts(3) });
  });

  it('shuffles ordering items deterministically and differently from authored/correct order', () => {
    const items = opts(6);
    const src = {
      id: 'q1',
      type: 'ordering' as const,
      config: { items },
      answerKey: { correctOrder: items.map((i) => i.id) },
      ...base,
    };
    const a = toPublicQuestion(src, { shuffleSeed: 'attempt-1' });
    const b = toPublicQuestion(src, { shuffleSeed: 'attempt-1' });
    expect(a).toEqual(b);
    const ids = (a.config as { items: { id: string }[] }).items.map((i) => i.id);
    expect([...ids].sort()).toEqual(items.map((i) => i.id));
    expect(ids).not.toEqual(items.map((i) => i.id));
    const other = toPublicQuestion(src, { shuffleSeed: 'attempt-2' });
    const seeds = new Set([ids.join('')]);
    for (let i = 0; i < 10; i++)
      seeds.add(
        (
          toPublicQuestion(src, { shuffleSeed: `s${i}` }).config as { items: { id: string }[] }
        ).items
          .map((x) => x.id)
          .join(''),
      );
    expect(seeds.size).toBeGreaterThan(3);
    expect(other).toBeDefined();
    expect(JSON.stringify(a)).not.toContain('correctOrder');
  });

  it('throws ScoringError on malformed config', () => {
    expect(() =>
      toPublicQuestion(
        { id: 'q1', type: 'ordering', config: { items: [] }, ...base },
        { shuffleSeed: 's' },
      ),
    ).toThrow(ScoringError);
  });
});
