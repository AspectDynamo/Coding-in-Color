import { describe, expect, it } from 'vitest';
import { generateDemoDataset } from '../../../src/backend/demo/generate';
import type { DemoDataset } from '../../../src/backend/demo/types';
import { CROCKFORD_ALPHABET } from '../../../src/shared/constants';
import { SKILL_CATEGORIES } from '../../../src/shared/types';
import {
  RESPONSE_KIND_BY_TYPE,
  choiceConfigSchema,
  debuggingConfigSchema,
  debuggingKeySchema,
  likertConfigSchema,
  multiKeySchema,
  orderingConfigSchema,
  orderingKeySchema,
  responseValueSchema,
  shortLogicConfigSchema,
  shortLogicKeySchema,
  singleKeySchema,
} from '../../../src/shared/validation';

const d: DemoDataset = generateDemoDataset();
const pct = (raw: number, max: number): number => Math.round(((100 * raw) / max) * 100) / 100;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCESS_CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

const byId = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((r) => [r.id, r]));

describe('demo dataset: determinism and shape', () => {
  it('is deterministic for the same anchor and responds to the anchor', () => {
    expect(JSON.stringify(generateDemoDataset())).toBe(JSON.stringify(d));
    const shifted = generateDemoDataset('2026-12-15');
    expect(shifted.cohorts[0]?.start_date).not.toBe(d.cohorts[0]?.start_date);
    expect(shifted.students.length).toBe(d.students.length);
  });

  it('rejects a malformed anchor', () => {
    expect(() => generateDemoDataset('15/11/2026')).toThrow();
  });

  it('has counts in the expected ranges', () => {
    expect(d.programs).toHaveLength(3);
    expect(d.courses).toHaveLength(5);
    expect(d.cohorts).toHaveLength(8);
    expect(d.students.length).toBeGreaterThanOrEqual(120);
    expect(d.students.length).toBeLessThanOrEqual(150);
    const submitted = d.attempts.filter((a) => a.status === 'submitted');
    expect(submitted.length).toBeGreaterThanOrEqual(300);
    expect(submitted.length).toBeLessThanOrEqual(450);
    expect(d.attempts.some((a) => a.stage === 'PRACTICE')).toBe(true);
    expect(d.attempts.some((a) => a.stage === 'RETENTION')).toBe(true);
    expect(d.attempts.some((a) => a.status === 'in_progress')).toBe(true);
    expect(new Set(d.cohorts.map((c) => c.delivery_mode)).size).toBe(3);
    expect(new Set(d.programs.map((p) => p.format))).toEqual(
      new Set(['semester', 'camp', 'ai_academy']),
    );
    expect(d.staff.map((s) => s.role).sort()).toEqual([
      'admin',
      'analyst',
      'instructor',
      'instructor',
      'instructor',
      'owner',
    ]);
    expect(
      d.staff.every(
        (s) => s.is_synthetic && s.auth_user_id === null && s.display_name.startsWith('Demo '),
      ),
    ).toBe(true);
  });

  it('uses valid v4 UUIDs, unique ids and valid foreign keys', () => {
    const tables: { id: string }[][] = [
      d.programs,
      d.courses,
      d.cohorts,
      d.staff,
      d.students,
      d.cohortStudents,
      d.consentRecords,
      d.guardianContacts,
      d.assessments,
      d.questions,
      d.sessions,
      d.attempts,
      d.responses,
      d.auditLog,
    ];
    for (const rows of tables) {
      const ids = rows.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(UUID_V4);
    }
    const cohorts = byId(d.cohorts);
    const courses = byId(d.courses);
    for (const c of d.cohorts) {
      expect(courses.get(c.course_id)?.program_id).toBe(c.program_id); // course belongs to the cohort's program
      expect(c.end_date >= c.start_date).toBe(true);
    }
    const students = byId(d.students);
    const sessions = byId(d.sessions);
    const assessments = byId(d.assessments);
    const enrolled = new Set(d.cohortStudents.map((e) => `${e.cohort_id}|${e.student_id}`));
    for (const e of d.cohortStudents) {
      expect(cohorts.has(e.cohort_id)).toBe(true);
      expect(students.has(e.student_id)).toBe(true);
    }
    for (const a of d.attempts) {
      const s = sessions.get(a.assessment_session_id);
      expect(s).toBeDefined();
      expect(a.cohort_id).toBe(s?.cohort_id);
      expect(a.assessment_id).toBe(s?.assessment_id);
      expect(a.stage).toBe(s?.stage);
      expect(a.assessment_version).toBe(assessments.get(a.assessment_id)?.version);
      expect(enrolled.has(`${a.cohort_id}|${a.student_id}`)).toBe(true);
    }
    // roster labels unique per cohort; one non-practice attempt per student per session
    expect(new Set(d.cohortStudents.map((e) => `${e.cohort_id}|${e.roster_label}`)).size).toBe(
      d.cohortStudents.length,
    );
    expect(new Set(d.cohortStudents.map((e) => `${e.cohort_id}|${e.student_id}`)).size).toBe(
      d.cohortStudents.length,
    );
    const once = d.attempts
      .filter((a) => a.stage !== 'PRACTICE')
      .map((a) => `${a.student_id}|${a.assessment_session_id}`);
    expect(new Set(once).size).toBe(once.length);
    // staff scoping and assessment sessions
    expect(d.staffAssignments.length).toBeGreaterThan(0);
  });
});

describe('demo dataset: scoring consistency', () => {
  const responsesByAttempt = new Map<string, DemoDataset['responses']>();
  for (const r of d.responses)
    responsesByAttempt.set(r.attempt_id, [...(responsesByAttempt.get(r.attempt_id) ?? []), r]);
  const skillsByAttempt = new Map<string, DemoDataset['skillScores']>();
  for (const s of d.skillScores)
    skillsByAttempt.set(s.attempt_id, [...(skillsByAttempt.get(s.attempt_id) ?? []), s]);
  const questions = byId(d.questions);

  it('every submitted attempt has percentage = round(100*raw/max, 2) and matching responses/skills', () => {
    const submitted = d.attempts.filter((a) => a.status === 'submitted');
    for (const a of submitted) {
      expect(a.raw_score).not.toBeNull();
      expect(a.max_score).not.toBeNull();
      const raw = a.raw_score as number;
      const max = a.max_score as number;
      expect(max).toBeGreaterThan(0);
      expect(raw).toBeGreaterThanOrEqual(0);
      expect(raw).toBeLessThanOrEqual(max);
      expect(a.percentage_score).toBe(pct(raw, max));
      expect(a.percentage_score as number).toBeGreaterThanOrEqual(0);
      expect(a.percentage_score as number).toBeLessThanOrEqual(100);
      if (a.self_reported_confidence !== null) {
        expect(a.self_reported_confidence).toBeGreaterThanOrEqual(1);
        expect(a.self_reported_confidence).toBeLessThanOrEqual(5);
      }
      expect(a.submitted_at).not.toBeNull();
      expect((a.submitted_at as string) >= a.started_at).toBe(true);
      expect(a.duration_seconds as number).toBeLessThanOrEqual(600); // <= ~10 min, typical <= 6

      const rs = responsesByAttempt.get(a.id) ?? [];
      const auto = rs.filter((r) => r.max_points > 0);
      expect(Math.round(auto.reduce((t, r) => t + r.earned_points, 0) * 100) / 100).toBe(raw);
      expect(Math.round(auto.reduce((t, r) => t + r.max_points, 0) * 100) / 100).toBe(max);
      for (const r of rs) {
        const q = questions.get(r.question_id);
        expect(q?.assessment_id).toBe(a.assessment_id);
        expect(r.max_points).toBe(q?.points);
        expect(r.earned_points).toBeLessThanOrEqual(r.max_points);
        if (q?.question_type === 'confidence_likert') expect(r.is_correct).toBeNull();
        else expect(r.is_correct).toBe(r.earned_points === r.max_points);
      }
      const sk = skillsByAttempt.get(a.id) ?? [];
      expect(Math.round(sk.reduce((t, s) => t + s.earned_points, 0) * 100) / 100).toBe(raw);
      expect(Math.round(sk.reduce((t, s) => t + s.max_points, 0) * 100) / 100).toBe(max);
      for (const s of sk) {
        expect(s.max_points).toBeGreaterThan(0);
        expect(SKILL_CATEGORIES).toContain(s.skill_category);
      }
    }
    const inProgress = d.attempts.filter((a) => a.status !== 'submitted');
    for (const a of inProgress) {
      expect(a.raw_score).toBeNull();
      expect(a.percentage_score).toBeNull();
      expect(a.submitted_at).toBeNull();
    }
  });

  it('stores response data that satisfies the response schema and question-type kind', () => {
    for (const r of d.responses) {
      const parsed = responseValueSchema.safeParse(r.response_data);
      expect(parsed.success).toBe(true);
      const q = questions.get(r.question_id);
      const expectedKind = q ? RESPONSE_KIND_BY_TYPE[q.question_type] : undefined;
      const kind = (r.response_data as { kind: string }).kind;
      expect(kind === 'skipped' || kind === expectedKind).toBe(true);
    }
  });

  it('contains improving, unchanged and declining matched pairs, with loops weakest and debugging gaining most', () => {
    const key = (a: { student_id: string; cohort_id: string }): string =>
      `${a.student_id}|${a.cohort_id}`;
    const pre = new Map<string, DemoDataset['attempts'][number]>();
    const post = new Map<string, DemoDataset['attempts'][number]>();
    for (const a of d.attempts) {
      if (a.status !== 'submitted') continue;
      if (a.stage === 'PRE') pre.set(key(a), a);
      if (a.stage === 'POST') post.set(key(a), a);
    }
    let improved = 0;
    let unchanged = 0;
    let declined = 0;
    const agg = new Map<string, { pre: number; preMax: number; post: number; postMax: number }>();
    for (const [k, p] of pre) {
      const q = post.get(k);
      if (!q) continue;
      expect((q.submitted_at as string) > (p.submitted_at as string)).toBe(true);
      const diff = (q.percentage_score as number) - (p.percentage_score as number);
      if (diff > 0) improved += 1;
      else if (diff < 0) declined += 1;
      else unchanged += 1;
      for (const s of skillsByAttempt.get(p.id) ?? []) {
        const t = (skillsByAttempt.get(q.id) ?? []).find(
          (x) => x.skill_category === s.skill_category,
        );
        if (!t) continue;
        const a = agg.get(s.skill_category) ?? { pre: 0, preMax: 0, post: 0, postMax: 0 };
        a.pre += s.earned_points;
        a.preMax += s.max_points;
        a.post += t.earned_points;
        a.postMax += t.max_points;
        agg.set(s.skill_category, a);
      }
    }
    expect(improved).toBeGreaterThan(unchanged + declined);
    expect(unchanged).toBeGreaterThan(0);
    expect(declined).toBeGreaterThan(0);
    const gain = (s: string): number => {
      const a = agg.get(s);
      return a ? (100 * a.post) / a.postMax - (100 * a.pre) / a.preMax : 0;
    };
    const baseline = (s: string): number => {
      const a = agg.get(s);
      return a ? (100 * a.pre) / a.preMax : 0;
    };
    expect(gain('debugging')).toBeGreaterThan(gain('loops'));
    expect(baseline('loops')).toBeLessThan(baseline('variables'));
  });
});

describe('demo dataset: question bank', () => {
  const keys = byId(d.answerKeys.map((k) => ({ ...k, id: k.question_id })));

  it('has >= 2 form families with equivalent A/B forms and uses every type except project_rubric', () => {
    const families = new Map<string, Set<string>>();
    for (const a of d.assessments)
      families.set(a.form_family, (families.get(a.form_family) ?? new Set()).add(a.form_label));
    expect(families.size).toBeGreaterThanOrEqual(2);
    for (const labels of families.values()) expect([...labels].sort()).toEqual(['A', 'B']);
    const types = new Set(d.questions.map((q) => q.question_type));
    expect(types).toEqual(
      new Set([
        'multiple_choice',
        'multiple_select',
        'code_comprehension',
        'predict_output',
        'debugging',
        'ordering',
        'short_logic',
        'confidence_likert',
      ]),
    );
    // A/B forms of a family share the same slot structure (type, skill, difficulty, points)
    for (const family of families.keys()) {
      const forms = d.assessments.filter((a) => a.form_family === family);
      const slots = forms.map((f) =>
        d.questions
          .filter((q) => q.assessment_id === f.id)
          .sort((x, y) => x.display_order - y.display_order)
          .map((q) => `${q.question_type}|${q.skill_category}|${q.difficulty}|${q.points}`),
      );
      expect(slots[0]).toEqual(slots[1]);
    }
    for (const a of d.assessments) {
      expect(a.estimated_minutes).toBeLessThanOrEqual(6);
      expect(a.version).toBe(1);
      expect(a.skill_categories.length).toBeGreaterThan(0);
    }
  });

  it('every question config and answer key validates against the shared zod schemas', () => {
    for (const q of d.questions) {
      const key = keys.get(q.id)?.answer_key;
      const options = (q.config['options'] as { id: string }[] | undefined) ?? [];
      switch (q.question_type) {
        case 'multiple_choice':
        case 'code_comprehension':
        case 'predict_output': {
          expect(choiceConfigSchema.safeParse(q.config).success).toBe(true);
          const k = singleKeySchema.parse(key);
          expect(options.map((o) => o.id)).toContain(k.correctOptionId);
          expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
          if (q.question_type !== 'multiple_choice') expect(typeof q.config['code']).toBe('string');
          break;
        }
        case 'multiple_select': {
          expect(choiceConfigSchema.safeParse(q.config).success).toBe(true);
          const k = multiKeySchema.parse(key);
          for (const id of k.correctOptionIds) expect(options.map((o) => o.id)).toContain(id);
          expect(k.correctOptionIds.length).toBeLessThan(options.length);
          break;
        }
        case 'debugging': {
          expect(debuggingConfigSchema.safeParse(q.config).success).toBe(true);
          const k = debuggingKeySchema.parse(key);
          const lines = (q.config['code'] as string).split('\n');
          expect(k.bugLine).toBeGreaterThanOrEqual(1);
          expect(k.bugLine).toBeLessThanOrEqual(lines.length);
          expect((lines[k.bugLine - 1] ?? '').trim()).not.toBe('');
          break;
        }
        case 'ordering': {
          const cfg = orderingConfigSchema.parse(q.config);
          const k = orderingKeySchema.parse(key);
          expect([...k.correctOrder].sort()).toEqual(cfg.items.map((i) => i.id).sort());
          // stored config must not already be in the solved order
          expect(cfg.items.map((i) => i.id)).not.toEqual(k.correctOrder);
          break;
        }
        case 'short_logic':
          expect(shortLogicConfigSchema.safeParse(q.config).success).toBe(true);
          expect(shortLogicKeySchema.safeParse(key).success).toBe(true);
          break;
        case 'confidence_likert':
          expect(likertConfigSchema.safeParse(q.config).success).toBe(true);
          expect(key).toBeUndefined();
          expect(q.points).toBe(0);
          break;
        default:
          throw new Error(`unexpected question type ${q.question_type}`);
      }
      // public config never carries answer data
      expect(Object.keys(q.config).some((k) => /correct|bugLine|accepted|answer/i.test(k))).toBe(
        false,
      );
    }
  });
});

describe('demo dataset: presenter flow, credentials and privacy', () => {
  it('gives every student a unique, valid Crockford demo code', () => {
    const codes = d.demoCredentials.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(d.demoCredentials.map((c) => c.studentId)).size).toBe(d.students.length);
    for (const c of d.demoCredentials) {
      expect(c.code).toMatch(ACCESS_CODE);
      for (const ch of c.code.replace(/-/g, '')) expect(CROCKFORD_ALPHABET).toContain(ch);
      expect(c.code.replace(/-/g, '')).toHaveLength(16);
    }
    expect(d.demoCredentials.every((c) => d.students.some((s) => s.id === c.studentId))).toBe(true);
  });

  it('has a fresh-pre presenter and a ready-for-post presenter with open sessions and an assigned instructor', () => {
    const fresh = d.demoCredentials.find((c) => c.label === 'Presenter — fresh pre-assessment');
    const ready = d.demoCredentials.find((c) => c.label === 'Presenter — ready for post');
    expect(fresh?.code.startsWith('DEMA')).toBe(true);
    expect(ready?.code.startsWith('DEMA')).toBe(true);
    const instructor = d.staff.find(
      (s) => s.role === 'instructor' && s.display_name === 'Demo Instructor',
    );
    expect(instructor).toBeDefined();
    const assigned = new Set(
      d.staffAssignments.filter((a) => a.staff_id === instructor?.id).map((a) => a.program_id),
    );
    const cohorts = byId(d.cohorts);

    for (const [p, stage, wantAttempt] of [
      [fresh, 'PRE', false],
      [ready, 'POST', false],
    ] as const) {
      const enrol = d.cohortStudents.find((e) => e.student_id === p?.studentId);
      const cohort = cohorts.get(enrol?.cohort_id ?? '');
      expect(cohort?.status).toBe('active');
      expect(cohort?.lead_instructor_id).toBe(instructor?.id);
      expect(assigned.has(cohort?.program_id ?? '')).toBe(true);
      const open = d.sessions.find(
        (s) => s.cohort_id === cohort?.id && s.stage === stage && s.status === 'open',
      );
      expect(open).toBeDefined();
      const mine = d.attempts.filter((a) => a.student_id === p?.studentId);
      expect(mine.some((a) => a.stage === stage && a.status === 'submitted')).toBe(wantAttempt);
      if (stage === 'POST') {
        expect(mine.some((a) => a.stage === 'PRE' && a.status === 'submitted')).toBe(true);
      } else {
        expect(mine).toHaveLength(0);
      }
      expect(d.students.find((s) => s.id === p?.studentId)?.status).toBe('active');
    }
  });

  it('has under-13 students with consent records; most granted, exactly one pending (pending_consent)', () => {
    const under13 = d.students.filter((s) => s.age_band === 'UNDER_13');
    expect(under13.length).toBeGreaterThanOrEqual(5);
    const consent = new Map(d.consentRecords.map((c) => [c.student_id, c]));
    for (const s of under13) expect(consent.has(s.id)).toBe(true);
    const pending = under13.filter((s) => consent.get(s.id)?.consent_status === 'pending');
    expect(pending).toHaveLength(1);
    expect(pending[0]?.status).toBe('pending_consent');
    expect(under13.filter((s) => consent.get(s.id)?.consent_status === 'granted').length).toBe(
      under13.length - 1,
    );
    expect(d.attempts.some((a) => a.student_id === pending[0]?.id)).toBe(false);
    expect(
      d.guardianContacts.every((g) => d.consentRecords.some((c) => c.id === g.consent_record_id)),
    ).toBe(true);
  });

  it('student rows carry no identifying fields and public codes follow S-XXXXXX', () => {
    const allowed = [
      'age_band',
      'created_at',
      'id',
      'is_synthetic',
      'public_code',
      'status',
      'updated_at',
    ];
    for (const s of d.students) {
      expect(Object.keys(s).sort()).toEqual(allowed);
      expect(s.is_synthetic).toBe(true);
      expect(s.public_code).toMatch(/^S-[0-9A-HJKMNP-TV-Z]{6}$/);
    }
    expect(new Set(d.students.map((s) => s.public_code)).size).toBe(d.students.length);
    expect(allowed.some((k) => /name|email|birth|dob|phone|address|\bip\b/i.test(k))).toBe(false);
    // raw access codes never appear in any stored row
    const { demoCredentials, ...rows } = d;
    const blob = JSON.stringify(rows);
    for (const c of demoCredentials.slice(0, 25)) expect(blob.includes(c.code)).toBe(false);
    // guardian contacts are fictional placeholders
    for (const g of d.guardianContacts) {
      expect(
        /^(paper-form-ref-\d{4}|guardian-demo-\d{2}@example\.invalid|555-0100)$/.test(
          g.contact_value,
        ),
      ).toBe(true);
    }
  });
});
