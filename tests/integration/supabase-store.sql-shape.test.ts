/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SupabaseStore request-shape tests.
 *
 * There is no PostgREST available in CI, so `fetch` is mocked at the supabase-js boundary and we
 * assert the exact REST URLs / rpc bodies the store generates, the error-code -> domain-error mapping,
 * and output normalization (`+00:00` timestamps, string numerics). A static cross-check also compares
 * every `.from('t')` chain in supabase-store.ts (select lists, embeds, filters, insert/update keys,
 * rpc argument names) against the schema declared in supabase/migrations/0001_schema.sql.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SupabaseStore } from '../../src/backend/repositories/supabase-store';
import { StoreError } from '../../src/backend/utils/errors';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SERVICE_KEY = 'test-service-role-key';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SESSION = U(1);
const STUDENT = U(2);
const COHORT = U(3);
const ASSESSMENT = U(4);
const ATTEMPT = U(5);

interface Rec {
  method: string;
  url: URL;
  headers: Headers;
  body: any;
}
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function makeStore(handler: (rec: Rec, n: number) => Reply) {
  const calls: Rec[] = [];
  const fetchMock = async (input: any, init?: any): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)));
    const rec: Rec = {
      method: String(init?.method ?? 'GET').toUpperCase(),
      url,
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
    };
    calls.push(rec);
    const r = handler(rec, calls.length - 1);
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) },
    });
  };
  const store = new SupabaseStore('https://proj.supabase.co', SERVICE_KEY, {
    fetch: fetchMock as typeof fetch,
  });
  return { store, calls };
}

const path_ = (r: Rec) => r.url.pathname.replace('/rest/v1', '');
const attemptRow = (over: Record<string, unknown> = {}) => ({
  id: ATTEMPT,
  student_id: STUDENT,
  assessment_session_id: SESSION,
  assessment_id: ASSESSMENT,
  assessment_version: 1,
  cohort_id: COHORT,
  stage: 'PRE',
  status: 'in_progress',
  raw_score: null,
  max_score: null,
  percentage_score: null,
  self_reported_confidence: null,
  started_at: '2026-11-15T17:00:00+00:00',
  submitted_at: null,
  duration_seconds: null,
  created_at: '2026-11-15T17:00:00.123456+00:00',
  ...over,
});

describe('SupabaseStore request shapes (mocked fetch)', () => {
  it('credential lookup by hash: one filtered GET with an explicit FK hint, service-role headers, normalized output', async () => {
    const hash = 'a'.repeat(64);
    const { store, calls } = makeStore(() => ({
      body: [
        {
          id: U(9),
          student_id: STUDENT,
          credential_hash: hash,
          key_version: 1,
          created_by: null,
          created_at: '2026-01-01T00:00:00+00:00',
          revoked_at: null,
          revoked_reason: null,
          last_used_at: '2026-02-01T10:00:00.5+00:00',
          students: {
            id: STUDENT,
            public_code: 'S-ABC123',
            age_band: 'AGE_13_17',
            status: 'active',
            is_synthetic: false,
            created_at: '2026-01-01T00:00:00+00:00',
            updated_at: '2026-01-01T00:00:00+00:00',
          },
        },
      ],
    }));
    const found = await store.findCredentialByHash(hash);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.method).toBe('GET');
    expect(path_(c!)).toBe('/student_credentials');
    expect(c!.url.searchParams.get('credential_hash')).toBe(`eq.${hash}`);
    expect(c!.url.searchParams.get('select')).toBe(
      '*,students!student_credentials_student_id_fkey(*)',
    );
    expect(c!.headers.get('apikey')).toBe(SERVICE_KEY);
    expect(c!.headers.get('authorization')).toBe(`Bearer ${SERVICE_KEY}`);
    expect(found?.credential.credential_hash).toBe(hash);
    expect(found?.credential.last_used_at).toBe('2026-02-01T10:00:00.500Z');
    expect(found?.student.public_code).toBe('S-ABC123');
    expect(found?.student.created_at).toBe('2026-01-01T00:00:00.000Z');
    expect((found?.credential as any).students).toBeUndefined();
  });

  it('credential lookup: unknown hash -> null, malformed id never reaches the database', async () => {
    const { store, calls } = makeStore(() => ({ body: [] }));
    expect(await store.findCredentialByHash('f'.repeat(64))).toBeNull();
    expect(await store.getCredentialWithStudent("x' or 1=1 --")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  describe('startAttempt', () => {
    const session: any = { id: SESSION, cohort_id: COHORT, stage: 'PRE' };
    const assessment: any = { id: ASSESSMENT, version: 3 };

    it('reads the student+session attempts, then inserts exactly the FK-consistent columns', async () => {
      const { store, calls } = makeStore((r) =>
        r.method === 'GET'
          ? { body: [] }
          : { status: 201, body: attemptRow({ assessment_version: 3 }) },
      );
      const res = await store.startAttempt({ studentId: STUDENT, session, assessment });
      expect(res.created).toBe(true);
      expect(res.attempt.started_at).toBe('2026-11-15T17:00:00.000Z');
      expect(res.attempt.created_at).toBe('2026-11-15T17:00:00.123Z');
      const [get, post] = calls;
      expect(path_(get!)).toBe('/assessment_attempts');
      expect(get!.url.searchParams.get('student_id')).toBe(`eq.${STUDENT}`);
      expect(get!.url.searchParams.get('assessment_session_id')).toBe(`eq.${SESSION}`);
      expect(post!.method).toBe('POST');
      expect(post!.body).toEqual({
        student_id: STUDENT,
        assessment_session_id: SESSION,
        assessment_id: ASSESSMENT,
        assessment_version: 3,
        cohort_id: COHORT,
        stage: 'PRE',
        status: 'in_progress',
      });
    });

    it('is idempotent: an existing in-progress attempt is returned without inserting', async () => {
      const { store, calls } = makeStore(() => ({ body: [attemptRow()] }));
      const res = await store.startAttempt({ studentId: STUDENT, session, assessment });
      expect(res.created).toBe(false);
      expect(calls.every((c) => c.method === 'GET')).toBe(true);
    });

    it('an already submitted non-PRACTICE attempt -> StoreError(already_submitted) with no insert', async () => {
      const { store, calls } = makeStore(() => ({
        body: [
          attemptRow({
            status: 'submitted',
            raw_score: '1.00',
            max_score: '2.00',
            percentage_score: '50.00',
            submitted_at: '2026-11-15T17:05:00+00:00',
          }),
        ],
      }));
      await expect(
        store.startAttempt({ studentId: STUDENT, session, assessment }),
      ).rejects.toMatchObject({ name: 'StoreError', code: 'already_submitted' });
      expect(calls.some((c) => c.method === 'POST')).toBe(false);
    });

    it('23505 race: re-reads and returns the winner in-progress attempt', async () => {
      let gets = 0;
      const { store } = makeStore((r) => {
        if (r.method === 'GET') return { body: gets++ === 0 ? [] : [attemptRow()] };
        return {
          status: 409,
          body: {
            code: '23505',
            message: 'duplicate key value violates unique constraint',
            details: 'Key (student_id, ...)=(secret)',
          },
        };
      });
      const res = await store.startAttempt({ studentId: STUDENT, session, assessment });
      expect(res).toMatchObject({ created: false, attempt: { id: ATTEMPT } });
    });

    it('23505 race lost to a submit: already_submitted; PRACTICE re-inserts instead', async () => {
      let gets = 0;
      const submitted = attemptRow({
        status: 'submitted',
        raw_score: 1,
        max_score: 2,
        percentage_score: 50,
        submitted_at: '2026-11-15T17:05:00+00:00',
      });
      const lost = makeStore((r) =>
        r.method === 'GET'
          ? { body: gets++ === 0 ? [] : [submitted] }
          : { status: 409, body: { code: '23505' } },
      );
      await expect(
        lost.store.startAttempt({ studentId: STUDENT, session, assessment }),
      ).rejects.toBeInstanceOf(StoreError);

      let posts = 0;
      const practice = makeStore((r) => {
        if (r.method === 'GET') return { body: [submitted] };
        return posts++ === 0
          ? { status: 409, body: { code: '23505' } }
          : { status: 201, body: attemptRow({ stage: 'PRACTICE' }) };
      });
      const res = await practice.store.startAttempt({
        studentId: STUDENT,
        session: { ...session, stage: 'PRACTICE' },
        assessment,
      });
      expect(res.created).toBe(true);
    });

    it('other database errors (FK violation) surface as a generic error with no row data', async () => {
      const { store } = makeStore((r) =>
        r.method === 'GET'
          ? { body: [] }
          : {
              status: 409,
              body: {
                code: '23503',
                message: 'violates foreign key',
                details: 'Key (student_id)=(SECRET-VALUE) is not present',
              },
            },
      );
      const err = await store
        .startAttempt({ studentId: STUDENT, session, assessment })
        .catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(StoreError);
      expect(String(err.message)).toBe('db_error:attempt.start:23503:409');
      expect(String(err.message)).not.toContain('SECRET-VALUE');
    });
  });

  describe('submitAttempt rpc', () => {
    const input = {
      attemptId: ATTEMPT,
      studentId: STUDENT,
      rawScore: 2.5000000000000004,
      maxScore: 5,
      percentageScore: 50,
      selfReportedConfidence: null,
      durationSeconds: 41.6,
      responses: [
        {
          question_id: U(7),
          response_data: { kind: 'choice', optionId: 'a' },
          is_correct: true,
          earned_points: 0.1 + 0.2,
          max_points: 0.3,
        },
      ],
      skills: [{ skill_category: 'loops' as const, earned_points: 2.5, max_points: 5 }],
    };

    it('posts exactly the SQL argument names with scale-rounded numbers and normalizes the returned attempt', async () => {
      const { store, calls } = makeStore(() => ({
        body: attemptRow({
          status: 'submitted',
          raw_score: '2.50',
          max_score: '5.00',
          percentage_score: '50.00',
          self_reported_confidence: null,
          duration_seconds: 42,
          submitted_at: '2026-11-15T17:09:00+00:00',
        }),
      }));
      const out = await store.submitAttempt(input);
      const [c] = calls;
      expect(c!.method).toBe('POST');
      expect(path_(c!)).toBe('/rpc/submit_attempt');
      expect(Object.keys(c!.body).sort()).toEqual(
        [
          'p_attempt_id',
          'p_confidence',
          'p_duration',
          'p_max',
          'p_percentage',
          'p_raw',
          'p_responses',
          'p_skills',
          'p_student_id',
        ].sort(),
      );
      expect(c!.body).toMatchObject({
        p_attempt_id: ATTEMPT,
        p_student_id: STUDENT,
        p_raw: 2.5,
        p_max: 5,
        p_percentage: 50,
        p_confidence: null,
        p_duration: 42,
      });
      expect(c!.body.p_responses).toEqual([
        {
          question_id: U(7),
          response_data: { kind: 'choice', optionId: 'a' },
          is_correct: true,
          earned_points: 0.3,
          max_points: 0.3,
        },
      ]);
      expect(c!.body.p_skills).toEqual([
        { skill_category: 'loops', earned_points: 2.5, max_points: 5 },
      ]);
      expect(out.status).toBe('submitted');
      expect(out.raw_score).toBe(2.5);
      expect(out.percentage_score).toBe(50);
      expect(out.submitted_at).toBe('2026-11-15T17:09:00.000Z');
    });

    it.each([
      ['CI001', 'attempt_not_found'],
      ['CI002', 'already_submitted'],
      ['CI003', 'already_submitted'],
    ])(
      'SQLSTATE %s -> StoreError(%s), the same domain errors as MemoryStore',
      async (code, expected) => {
        const { store } = makeStore(() => ({ status: 400, body: { code, message: expected } }));
        await expect(store.submitAttempt(input)).rejects.toMatchObject({
          name: 'StoreError',
          code: expected,
        });
      },
    );

    it.each(['CI004', 'CI005', 'CI006', 'CI007', '23514'])(
      'SQLSTATE %s is a server fault, not a domain error',
      async (code) => {
        const { store } = makeStore(() => ({
          status: 400,
          body: { code, message: 'detail with raw answer data' },
        }));
        const err = await store.submitAttempt(input).catch((e) => e);
        expect(err).not.toBeInstanceOf(StoreError);
        expect(err.message).toBe(`db_error:attempt.submit:${code}:400`);
      },
    );
  });

  it('getMatchedPairs: rpc arg names, deterministic ordering, empty scope short-circuit, output normalization', async () => {
    const { store, calls } = makeStore(() => ({
      body: [
        {
          student_id: STUDENT,
          cohort_id: COHORT,
          program_id: U(10),
          course_id: U(11),
          form_family: 'loops-basics',
          pre_attempt_id: U(12),
          post_attempt_id: U(13),
          pre_percentage: '40.00',
          post_percentage: 75.5,
          pre_submitted_at: '2026-03-01T10:00:00+00:00',
          post_submitted_at: '2026-04-01T10:00:00.25+00:00',
          pre_confidence: '2.50',
          post_confidence: null,
          retention_attempt_id: null,
          retention_percentage: null,
          pre_skills: { loops: '50.00', variables: 25 },
          post_skills: {},
        },
      ],
    }));
    expect(await store.getMatchedPairs([], '2026-01-01', '2026-12-31')).toEqual([]);
    expect(calls).toHaveLength(0);
    // Non-uuid ids are dropped before they can reach the request.
    expect(await store.getMatchedPairs(['not-a-uuid', '1,2)'])).toEqual([]);
    expect(calls).toHaveLength(0);

    const rows = await store.getMatchedPairs([COHORT, COHORT], '2026-01-01', undefined);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c!.method).toBe('POST');
    expect(path_(c!)).toBe('/rpc/matched_pairs');
    expect(c!.body).toEqual({ p_cohort_ids: [COHORT], p_from: '2026-01-01', p_to: null });
    expect(c!.url.searchParams.get('order')).toBe('cohort_id.asc,student_id.asc,form_family.asc');
    expect(c!.url.searchParams.get('limit')).toBe('1000');
    expect(c!.url.searchParams.get('offset')).toBe('0');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pre_percentage: 40,
      post_percentage: 75.5,
      pre_confidence: 2.5,
      post_confidence: null,
      pre_submitted_at: '2026-03-01T10:00:00.000Z',
      post_submitted_at: '2026-04-01T10:00:00.250Z',
      pre_skills: { loops: 50, variables: 25 },
      post_skills: {},
      retention_attempt_id: null,
      retention_percentage: null,
    });
  });

  describe('listStudents search escaping', () => {
    const page = (rows: unknown[] = [], total = 0) => ({
      body: rows,
      headers: { 'content-range': `0-${Math.max(rows.length - 1, 0)}/${total}` },
    });

    it('prefix search is a parameterized LIKE on public_code with no wildcard characters; no or()/filter() strings', async () => {
      const { store, calls } = makeStore(() => page());
      await store.listStudents({ q: ' s-7k ', limit: 25, offset: 0 });
      const [c] = calls;
      expect(path_(c!)).toBe('/students');
      expect(c!.url.searchParams.get('public_code')).toBe('like.S-7K%');
      expect(c!.url.searchParams.get('or')).toBeNull();
      expect(c!.url.searchParams.get('order')).toBe('created_at.desc,public_code.asc');
      expect(c!.url.searchParams.get('limit')).toBe('25');
      expect(c!.url.searchParams.get('offset')).toBe('0');
      expect(c!.headers.get('prefer')).toContain('count=exact');
    });

    it.each([
      '%',
      '_',
      'S-%',
      'S_7',
      'a*b',
      'x,y',
      'S-7K.eq.1',
      'S-7K)',
      "S-7K' or 1=1",
      '\\',
      'é',
    ])(
      'wildcard / filter-syntax input %j cannot match any code and never reaches PostgREST',
      async (q) => {
        const { store, calls } = makeStore(() => page());
        expect(await store.listStudents({ q, limit: 25, offset: 0 })).toEqual({
          items: [],
          total: 0,
        });
        expect(calls).toHaveLength(0);
      },
    );

    it('cohort filter uses an inner embed with an explicit FK hint and an embedded-column filter', async () => {
      const { store, calls } = makeStore(() => page());
      await store.listStudents({ cohortId: COHORT, limit: 10, offset: 20 });
      const [c] = calls;
      expect(c!.url.searchParams.get('select')).toBe(
        '*,cohort_students!cohort_students_student_id_fkey!inner(cohort_id)',
      );
      expect(c!.url.searchParams.get('cohort_students.cohort_id')).toBe(`eq.${COHORT}`);
      expect(c!.url.searchParams.get('offset')).toBe('20');
      expect(c!.url.searchParams.get('limit')).toBe('10');
      expect((await store.listStudents({ cohortId: "x'y", limit: 10, offset: 0 })).items).toEqual(
        [],
      );
    });

    it('an offset past the end (PGRST103) is an empty page with the real total', async () => {
      const { store, calls } = makeStore((_r, n) =>
        n === 0
          ? {
              status: 416,
              body: { code: 'PGRST103', message: 'Requested range not satisfiable' },
              headers: { 'content-range': '*/7' },
            }
          : { body: [{ id: U(1) }], headers: { 'content-range': '0-0/7' } },
      );
      const out = await store.listStudents({ limit: 5, offset: 50 });
      expect(out).toEqual({ items: [], total: 7 });
      expect(calls[1]!.url.searchParams.get('limit')).toBe('1');
    });
  });

  it('reads that return more than the PostgREST row cap are paged with range()', async () => {
    const cohortRows = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ program_id: U(from + i) }));
    const { store, calls } = makeStore((r) => {
      if (path_(r) === '/courses') return { body: [] };
      if (path_(r) === '/programs') return { body: [] };
      return {
        body: r.url.searchParams.get('offset') === '0' ? cohortRows(1000, 1) : cohortRows(3, 5000),
      };
    });
    await store.listPrograms();
    const cohortCalls = calls.filter((c) => path_(c) === '/cohorts');
    expect(cohortCalls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1000']);
  });

  it('submitted-attempt window is [from 00:00Z, day after to 00:00Z) so the last millisecond of `to` is included', async () => {
    const { store, calls } = makeStore(() => ({
      body: [{ stage: 'POST', cohort_id: COHORT, submitted_at: '2026-04-30T23:59:59.9995+00:00' }],
    }));
    const out = await store.listSubmittedAttemptsInScope([COHORT], '2026-04-01', '2026-04-30');
    const sp = calls[0]!.url.searchParams;
    expect(sp.getAll('submitted_at')).toEqual([
      'gte.2026-04-01T00:00:00.000Z',
      'lt.2026-05-01T00:00:00.000Z',
    ]);
    expect(sp.get('stage')).toBe('neq.PRACTICE');
    expect(sp.get('cohort_id')).toBe(`in.(${COHORT})`);
    expect(out[0]!.submitted_at).toBe('2026-04-30T23:59:59.999Z');
    await expect(
      store.listSubmittedAttemptsInScope([COHORT], "2026-04-01'; drop", undefined),
    ).rejects.toThrow('db_error:analytics.attempts:22007');
  });

  it('analytics reads exclude withdrawn students via an inner embed filter; matched_pairs does too (0004)', async () => {
    const { store, calls } = makeStore(() => ({ body: [] }));
    await store.listSubmittedAttemptsInScope([COHORT]);
    await store.countStudentRecords([COHORT]);
    await store.listCohorts();
    for (const c of calls.filter((x) =>
      ['/assessment_attempts', '/cohort_students'].includes(path_(x)),
    )) {
      expect(c.url.searchParams.get('students.status')).toBe('neq.withdrawn');
      expect(c.url.searchParams.get('select')).toMatch(/students!\w+!inner\(/);
    }
    expect(calls.filter((x) => path_(x) === '/cohort_students')).toHaveLength(2);
    const sql = fs.readFileSync(
      path.join(ROOT, 'supabase/migrations/0004_exclude_withdrawn.sql'),
      'utf8',
    );
    expect(sql).toMatch(/join students st on st\.id = a\.student_id and st\.status <> 'withdrawn'/);
  });

  it('reissue_credential rpc: argument names, CI010 -> null', async () => {
    const seat = { roster_label: '04', students: { id: STUDENT, public_code: 'S-ABC123' } };
    const ok = makeStore((r) => (r.method === 'GET' ? { body: [seat] } : { body: { id: U(20) } }));
    const out = await ok.store.reissueCredential({
      cohortId: COHORT,
      rosterLabel: '04',
      newHash: 'b'.repeat(64),
      keyVersion: 2,
      staffId: U(21),
      reason: 'lost card',
    });
    expect(out).toEqual({ studentId: STUDENT, publicCode: 'S-ABC123', rosterLabel: '04' });
    const [seatCall, rpc] = ok.calls;
    expect(seatCall!.url.searchParams.get('select')).toBe(
      'roster_label,students!cohort_students_student_id_fkey!inner(id,public_code)',
    );
    expect(path_(rpc!)).toBe('/rpc/reissue_credential');
    expect(rpc!.body).toEqual({
      p_student_id: STUDENT,
      p_new_hash: 'b'.repeat(64),
      p_key_version: 2,
      p_staff_id: U(21),
      p_reason: 'lost card',
    });

    const gone = makeStore((r) =>
      r.method === 'GET'
        ? { body: [seat] }
        : { status: 400, body: { code: 'CI010', message: 'student_not_found' } },
    );
    expect(
      await gone.store.reissueCredential({
        cohortId: COHORT,
        rosterLabel: '04',
        newHash: 'c'.repeat(64),
        keyVersion: 1,
        staffId: U(21),
        reason: 'x',
      }),
    ).toBeNull();
  });

  it('delete student relies on FK cascades: one DELETE on students, and an unknown/repeated delete returns null', async () => {
    const { store, calls } = makeStore((r) => {
      if (r.method === 'GET')
        return {
          body: [
            {
              id: STUDENT,
              public_code: 'S-ABC123',
              age_band: 'AGE_13_17',
              status: 'active',
              is_synthetic: false,
              created_at: '2026-01-01T00:00:00+00:00',
              updated_at: '2026-01-01T00:00:00+00:00',
            },
          ],
        };
      return { body: [{ id: STUDENT }] };
    });
    expect(await store.deleteStudent(STUDENT)).toEqual({ publicCode: 'S-ABC123' });
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes.map((c) => `${c.method} ${path_(c)}`)).toEqual(['DELETE /students']);
    expect(await store.deleteStudent('nope')).toBeNull();
  });

  it('privacy: answer keys and guardian contact values are only read where documented', async () => {
    const ids = { id: U(30), assessment_id: ASSESSMENT, question_id: U(30) };
    const { store, calls } = makeStore((r) => {
      const p = path_(r);
      if (p === '/questions')
        return {
          body: [
            {
              ...ids,
              question_type: 'multiple_choice',
              prompt: 'p',
              config: {},
              skill_category: 'loops',
              difficulty: 'intro',
              points: '1.00',
              display_order: 0,
            },
          ],
        };
      if (p === '/assessments')
        return {
          body:
            r.method === 'GET'
              ? [
                  {
                    id: ASSESSMENT,
                    course_id: null,
                    form_family: 'f',
                    form_label: 'A',
                    title: 't',
                    description: '',
                    version: 1,
                    difficulty: 'intro',
                    estimated_minutes: 5,
                    intended_stages: ['PRE'],
                    skill_categories: ['loops'],
                    status: 'active',
                    created_at: '2026-01-01T00:00:00+00:00',
                    questions: [{ count: 1 }],
                  },
                ]
              : [],
        };
      if (p === '/question_answer_keys')
        return { body: [{ question_id: U(30), answer_key: { correctOptionId: 'a' } }] };
      if (p === '/consent_records') return { body: [], headers: { 'content-range': '*/0' } };
      return { body: [] };
    });
    await store.listQuestions(ASSESSMENT);
    await store.getAssessmentDetail(ASSESSMENT, false);
    await store.listAssessments();
    await store.listConsent({ limit: 10, offset: 0 });
    await store.listRoster(COHORT);
    expect(calls.some((c) => path_(c) === '/question_answer_keys')).toBe(false);

    await store.listQuestionsWithKeys(ASSESSMENT);
    await store.getAssessmentDetail(ASSESSMENT, true);
    expect(calls.filter((c) => path_(c) === '/question_answer_keys')).toHaveLength(2);

    for (const c of calls) {
      expect(c.url.toString()).not.toContain('contact_value');
      expect(c.url.searchParams.get('or')).toBeNull();
      expect(c.url.searchParams.get('and')).toBeNull();
    }
  });

  it('audit_log is only ever inserted into', async () => {
    const { store, calls } = makeStore(() => ({ status: 201, body: null }));
    await store.appendAudit({
      actorType: 'staff',
      actorId: U(40),
      action: 'student.delete',
      targetType: 'student',
      targetId: 'S-ABC123',
      metadata: { n: 1 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe('POST');
    expect(path_(calls[0]!)).toBe('/audit_log');
    expect(calls[0]!.body).toEqual({
      actor_type: 'staff',
      actor_id: U(40),
      action: 'student.delete',
      target_type: 'student',
      target_id: 'S-ABC123',
      metadata: { n: 1 },
    });
    const src = fs
      .readFileSync(path.join(ROOT, 'src/backend/repositories/supabase-store.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/from\('audit_log'\)\s*\.(update|delete|upsert)/);
    expect(src).not.toMatch(/\.or\(|\.filter\(\s*[`'"]/); // PostgREST or()/filter() strings are never built
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Static cross-check: supabase-store.ts vs. the CREATE TABLE statements in the migrations     */
/* ------------------------------------------------------------------------------------------ */

interface Fk {
  table: string;
  name: string;
  ref: string;
}
function parseSchema(sql: string) {
  const text = sql.replace(/--[^\n]*/g, '');
  const columns: Record<string, string[]> = {};
  const fks: Fk[] = [];
  const re = /create table (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const table = m[1]!;
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (depth > 0 && i < text.length) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    const body = text.slice(start, i - 1);
    const items: string[] = [];
    let d = 0;
    let cur = '';
    for (const ch of body) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) {
        items.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    columns[table] = [];
    for (const item of items) {
      const first = item.split(/\s+/)[0]!.toLowerCase();
      if (['constraint', 'primary', 'unique', 'check', 'foreign'].includes(first)) {
        const c = /constraint\s+(\w+)\s+foreign key\s*\([^)]*\)\s*references\s+(\w+)/i.exec(item);
        if (c) fks.push({ table, name: c[1]!, ref: c[2]! });
        continue;
      }
      columns[table]!.push(item.split(/\s+/)[0]!);
      const inline = /references\s+(\w+)\s*\(/i.exec(item);
      if (inline)
        fks.push({ table, name: `${table}_${item.split(/\s+/)[0]}_fkey`, ref: inline[1]! });
    }
  }
  return { columns, fks };
}

describe('supabase-store.ts matches the migrations schema (static cross-check)', () => {
  const migrations = path.join(ROOT, 'supabase/migrations');
  const schemaSql = fs.readFileSync(path.join(migrations, '0001_schema.sql'), 'utf8');
  // Functions are (re)defined across migrations (0004 replaces matched_pairs); read them all in order.
  const fnSql = fs
    .readdirSync(migrations)
    .filter((f) => /^\d+_.*\.sql$/.test(f) && f !== '0001_schema.sql')
    .sort()
    .map((f) => fs.readFileSync(path.join(migrations, f), 'utf8'))
    .join('\n');
  const { columns, fks } = parseSchema(schemaSql);
  const file = path.join(ROOT, 'src/backend/repositories/supabase-store.ts');
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);

  // rpc parameter names straight from the SQL
  const rpcParams: Record<string, string[]> = {};
  for (const m of fnSql.matchAll(/create or replace function (\w+)\(([\s\S]*?)\)\s*returns/g)) {
    rpcParams[m[1]!] = m[2]!
      .split(',')
      .map((p) => p.trim().split(/\s+/)[0]!)
      .filter(Boolean);
  }

  const FK_CONST: Record<string, string> = {};
  const walkTop = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && n.name.getText() === 'FK' && n.initializer) {
      const obj = (
        ts.isAsExpression(n.initializer) ? n.initializer.expression : n.initializer
      ) as ts.ObjectLiteralExpression;
      for (const p of obj.properties)
        if (ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer))
          FK_CONST[p.name.getText()] = p.initializer.text;
    }
    ts.forEachChild(n, walkTop);
  };
  walkTop(sf);

  const strOf = (n: ts.Node | undefined): string | null => {
    if (!n) return null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      for (const sp of n.templateSpans) {
        const mm = /^FK\.(\w+)$/.exec(sp.expression.getText());
        s += (mm ? FK_CONST[mm[1]!] : '\u0000') + sp.literal.text;
      }
      return s;
    }
    return null;
  };
  const splitTop = (s: string) => {
    const out: string[] = [];
    let d = 0;
    let cur = '';
    for (const ch of s) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) {
        out.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };

  const problems: string[] = [];
  const stats = { selects: 0, embeds: 0, filters: 0, writes: 0, rpcs: 0 };
  const lineOf = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const bad = (n: ts.Node, msg: string) => problems.push(`supabase-store.ts:${lineOf(n)} ${msg}`);
  const between = (a: string, b: string) =>
    fks.filter((f) => (f.table === a && f.ref === b) || (f.table === b && f.ref === a));

  function checkSelect(node: ts.Node, table: string, sel: string, embeds: Record<string, string>) {
    for (const item of splitTop(sel)) {
      const m = /^(?:(\w+):)?([\w*]+)((?:![\w]+)*)(?:\((.*)\))?$/s.exec(item);
      if (!m) {
        bad(node, `cannot parse select item "${item}"`);
        continue;
      }
      const [, alias, name, hints, inner] = m;
      if (name === '*') continue;
      if (inner === undefined) {
        if (!columns[table]!.includes(name!))
          bad(node, `${table}: column "${name}" does not exist`);
        continue;
      }
      stats.embeds++;
      embeds[alias || name!] = name!;
      if (!columns[name!]) {
        bad(node, `${table}: embedded table "${name}" does not exist`);
        continue;
      }
      const direct = between(table, name!);
      const hint = hints!.split('!').filter((h) => h && h !== 'inner')[0];
      if (!direct.length) bad(node, `${table} -> ${name}: no foreign key between the tables`);
      else if (!hint)
        bad(
          node,
          `${table} -> ${name}: embed needs an explicit !fk_name hint (PostgREST ambiguity)`,
        );
      else if (!direct.some((f) => f.name === hint))
        bad(
          node,
          `${table} -> ${name}: "${hint}" is not a foreign key between them (${direct.map((f) => f.name).join(', ')})`,
        );
      if (inner.trim() !== 'count') checkSelect(node, name!, inner, {});
    }
  }

  it('every select list, embed, filter, insert/update key and rpc argument exists in the schema', () => {
    const froms: { node: ts.CallExpression; table: string }[] = [];
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const name = n.expression.name.text;
        if (name === 'from' && n.arguments.length === 1) {
          const t = strOf(n.arguments[0]);
          if (t) {
            if (!columns[t]) bad(n, `unknown table "${t}"`);
            else froms.push({ node: n, table: t });
          }
        }
        if (name === 'rpc') {
          stats.rpcs++;
          const fn = strOf(n.arguments[0]) ?? '';
          const params = rpcParams[fn];
          const arg = n.arguments[1];
          if (!params) bad(n, `rpc "${fn}" does not exist in the migrations`);
          else if (arg && ts.isObjectLiteralExpression(arg)) {
            const given = arg.properties.map((p) => p.name!.getText());
            for (const g of given)
              if (!params.includes(g))
                bad(n, `rpc ${fn}: "${g}" is not a parameter (${params.join(', ')})`);
            for (const p of params)
              if (
                !given.includes(p) &&
                !(fn === 'matched_pairs' && (p === 'p_from' || p === 'p_to'))
              )
                bad(n, `rpc ${fn}: missing parameter ${p}`);
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);

    const FILTERS = new Set([
      'eq',
      'neq',
      'in',
      'is',
      'gte',
      'lte',
      'gt',
      'lt',
      'like',
      'ilike',
      'order',
    ]);
    for (const { node, table } of froms) {
      const chain: { name: string; call: ts.CallExpression }[] = [];
      let cur: ts.Node = node;
      while (
        cur.parent &&
        ts.isPropertyAccessExpression(cur.parent) &&
        cur.parent.parent &&
        ts.isCallExpression(cur.parent.parent)
      ) {
        cur = cur.parent.parent;
        chain.push({
          name: (cur as ts.CallExpression).expression.getText().split('.').pop()!,
          call: cur as ts.CallExpression,
        });
      }
      // `let q = <chain>; if (...) q = q.eq(...)` continuations inside the same function
      let top: ts.Node = cur;
      while (
        top.parent &&
        (ts.isConditionalExpression(top.parent) || ts.isParenthesizedExpression(top.parent))
      )
        top = top.parent;
      if (top.parent && ts.isVariableDeclaration(top.parent)) {
        const v = top.parent.name.getText();
        let fn: ts.Node | undefined = node;
        while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
        const scan = (n: ts.Node) => {
          if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
            let base: ts.Expression = n.expression.expression;
            while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression))
              base = base.expression.expression;
            if (ts.isIdentifier(base) && base.text === v && n.getStart() > node.getStart())
              chain.push({ name: n.expression.name.text, call: n });
          }
          ts.forEachChild(n, scan);
        };
        if (fn) scan(fn);
      }
      const embeds: Record<string, string> = {};
      chain.sort((a, b) => Number(b.name === 'select') - Number(a.name === 'select'));
      for (const { name, call } of chain) {
        const a0 = call.arguments[0];
        if (name === 'select') {
          stats.selects++;
          const s = strOf(a0);
          if (s === null || s.includes('\u0000')) bad(call, 'select() must be a static string');
          else checkSelect(call, table, s, embeds);
        } else if (FILTERS.has(name)) {
          stats.filters++;
          const c = strOf(a0);
          if (c === null) continue; // dynamic column names are validated by their union types (see credentialWithStudent)
          if (c.includes('.')) {
            const [emb, col] = c.split('.') as [string, string];
            const t = embeds[emb];
            if (!t) bad(call, `${name}('${c}'): embed "${emb}" is not selected`);
            else if (!columns[t]!.includes(col))
              bad(call, `${name}('${c}'): ${t} has no column ${col}`);
          } else if (!columns[table]!.includes(c))
            bad(call, `${table}.${name}('${c}'): no such column`);
        } else if (name === 'insert' || name === 'update') {
          stats.writes++;
          const objs = (n: ts.Node) => {
            if (ts.isObjectLiteralExpression(n)) {
              for (const p of n.properties) {
                if (
                  (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
                  !columns[table]!.includes(p.name.getText())
                )
                  bad(n, `${table}.${name}: column "${p.name.getText()}" does not exist`);
              }
              return;
            }
            ts.forEachChild(n, objs);
          };
          if (a0) objs(a0);
        }
      }
    }
    expect(problems).toEqual([]);
    // make sure the scan actually covered the file
    expect(stats.selects).toBeGreaterThan(60);
    expect(stats.embeds).toBeGreaterThan(10);
    expect(stats.filters).toBeGreaterThan(100);
    expect(stats.writes).toBeGreaterThan(20);
    expect(stats.rpcs).toBe(3);
  });

  it('never selects guardian contact values or interpolates strings into or()/filter()', () => {
    expect(source).not.toMatch(/\.select\(\s*[`'"][^`'"]*contact_value/);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.(or|filter|not)\(\s*[`'"]/);
  });
});
