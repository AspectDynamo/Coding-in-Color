/**
 * Deterministic SYNTHETIC demo dataset generator.
 *
 * Everything produced here is fictional: no real students, schools or staff. It is pure (no fs,
 * no Node APIs, no wall-clock, no Math.random) so it runs identically in the Cloudflare Worker,
 * in Node (scripts/generate-seed.ts) and in tests. Randomness comes from the seeded PRNG in
 * ./prng.ts, which is for SYNTHETIC DATA ONLY and never used for secrets.
 *
 * Generation order: catalogue -> staff -> cohorts/students/enrolment/consent -> question bank ->
 * sessions -> per-student ability model -> RESPONSES -> scoring -> attempts/skill scores. Scores are
 * derived from the generated responses by ./score.ts, never invented independently, so raw/max/
 * percentage, is_correct, earned points, skill scores and confidence are always consistent.
 */
import type {
  AgeBand,
  AssessmentStage,
  DeliveryMode,
  Difficulty,
  ProgramFormat,
  SkillCategory,
} from '../../shared/types';
import { CROCKFORD_ALPHABET, CURRENT_PRIVACY_NOTICE_VERSION } from '../../shared/constants';
import { FORMS, type FormDef, type QuestionDef } from './bank';
import { createRng, demoUuid, type Rng } from './prng';
import { scoreAttempt, type DemoResponse, type ScorableQuestion } from './score';
import type {
  AssessmentAttemptRow,
  AssessmentResponseRow,
  AssessmentRow,
  AssessmentSessionRow,
  AttemptSkillScoreRow,
  AuditLogRow,
  CohortRow,
  CohortStudentRow,
  ConsentRecordRow,
  CourseRow,
  DemoDataset,
  GuardianContactRow,
  ProgramRow,
  QuestionAnswerKeyRow,
  QuestionRow,
  StaffProgramAssignmentRow,
  StaffUserRow,
  StudentRow,
} from './types';

export const DEFAULT_DEMO_ANCHOR = '2026-11-15';
/** Version string used for the earlier (pre-November-2026) privacy notice in historic consent rows. */
const OLDER_NOTICE_VERSION = '2026-05-v1';

/* ------------------------------------------------------------------ */
/* date helpers (UTC, pure)                                            */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
const parseDate = (d: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new Error(`Invalid anchor date "${d}" (expected YYYY-MM-DD)`);
  const ms = Date.parse(`${d}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`Invalid anchor date "${d}"`);
  return ms;
};
const fmtDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number): string => fmtDate(parseDate(d) + n * DAY);
const daysBetween = (a: string, b: string): number =>
  Math.round((parseDate(b) - parseDate(a)) / DAY);
const isoZ = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
/** `date` at hh:mm UTC as an ISO timestamp. */
const at = (date: string, hh = 12, mm = 0): string =>
  isoZ(parseDate(date) + hh * 3_600_000 + mm * 60_000);

function seasonOf(date: string): string {
  const m = Number(date.slice(5, 7));
  const season = m === 12 || m <= 2 ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Fall';
  return `${season} ${date.slice(0, 4)}`;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`demo generator invariant: missing ${what}`);
  return v;
}

/* ------------------------------------------------------------------ */
/* static configuration                                                */
/* ------------------------------------------------------------------ */

type ProgramKey = 'k12' | 'camps' | 'ai';
type StaffKey = 'owner' | 'admin' | 'analyst' | 'instr1' | 'instr2' | 'instr3';

interface CohortCfg {
  key: string;
  program: ProgramKey;
  course: string;
  label: string;
  mode: DeliveryMode;
  /** Dates are given for the default anchor and shifted when another anchor is passed. */
  start: string;
  end: string;
  lead: StaffKey;
  family: string;
  preForm: 'A' | 'B';
  postForm: 'A' | 'B';
  retForm?: 'A' | 'B';
  size: number;
  /** Multiplies the modelled learning gain for this cohort (camps are intensive, remote is gentler). */
  gainScale: number;
  /** Shifts baseline ability (novice-heavy cohorts start lower). */
  baseShift: number;
  /** completed = full pre/post history; fresh_pre = active, PRE open; mid_post = active, POST open. */
  kind: 'completed' | 'fresh_pre' | 'mid_post';
  preDays: number;
  postLeadDays: number;
  postTailDays: number;
  retentionOffsetDays?: number;
  under13Rosters: number[];
  adultShare: number;
  returning?: { from: string[]; count: number };
  practice?: { students: number; repeats: number };
  preRate: number;
  postRate: number;
}

const COHORTS: CohortCfg[] = [
  {
    key: 'c1',
    program: 'k12',
    course: 'cs-fund',
    label: 'CS Fundamentals (Mesa)',
    mode: 'in_person',
    start: '2025-09-08',
    end: '2025-12-12',
    lead: 'instr1',
    family: 'cs-fundamentals',
    preForm: 'A',
    postForm: 'B',
    retForm: 'A',
    size: 22,
    gainScale: 1.0,
    baseShift: 0,
    kind: 'completed',
    preDays: 10,
    postLeadDays: 6,
    postTailDays: 3,
    retentionOffsetDays: 84,
    under13Rosters: [],
    adultShare: 0.05,
    practice: { students: 5, repeats: 2 },
    preRate: 0.97,
    postRate: 0.9,
  },
  {
    key: 'c3',
    program: 'k12',
    course: 'ct',
    label: 'Computational Thinking (Online)',
    mode: 'remote',
    start: '2025-10-06',
    end: '2026-01-23',
    lead: 'instr2',
    family: 'cs-fundamentals',
    preForm: 'B',
    postForm: 'A',
    retForm: 'B',
    size: 18,
    gainScale: 0.75,
    baseShift: 0.1,
    kind: 'completed',
    preDays: 10,
    postLeadDays: 7,
    postTailDays: 4,
    retentionOffsetDays: 84,
    under13Rosters: [],
    adultShare: 0.05,
    preRate: 0.95,
    postRate: 0.85,
  },
  {
    key: 'c6',
    program: 'ai',
    course: 'ai-lit',
    label: 'AI Literacy (Online)',
    mode: 'remote',
    start: '2026-01-12',
    end: '2026-03-27',
    lead: 'instr2',
    family: 'ai-literacy',
    preForm: 'A',
    postForm: 'B',
    retForm: 'A',
    size: 22,
    gainScale: 1.1,
    baseShift: 0.05,
    kind: 'completed',
    preDays: 10,
    postLeadDays: 6,
    postTailDays: 3,
    retentionOffsetDays: 84,
    under13Rosters: [],
    adultShare: 0.25,
    returning: { from: ['c1', 'c3'], count: 3 },
    preRate: 0.97,
    postRate: 0.9,
  },
  {
    key: 'c2',
    program: 'k12',
    course: 'cs-fund',
    label: 'CS Fundamentals (Phoenix, hybrid)',
    mode: 'hybrid',
    start: '2026-01-20',
    end: '2026-05-15',
    lead: 'instr1',
    family: 'cs-fundamentals',
    preForm: 'B',
    postForm: 'A',
    retForm: 'B',
    size: 22,
    gainScale: 1.05,
    baseShift: 0,
    kind: 'completed',
    preDays: 10,
    postLeadDays: 6,
    postTailDays: 3,
    retentionOffsetDays: 84,
    under13Rosters: [],
    adultShare: 0.05,
    returning: { from: ['c1'], count: 2 },
    practice: { students: 4, repeats: 1 },
    preRate: 0.97,
    postRate: 0.9,
  },
  {
    key: 'c4',
    program: 'camps',
    course: 'camp-py',
    label: 'Python Game Camp (Week 1)',
    mode: 'in_person',
    start: '2026-06-08',
    end: '2026-06-19',
    lead: 'instr3',
    family: 'cs-fundamentals',
    preForm: 'A',
    postForm: 'B',
    retForm: 'A',
    size: 20,
    gainScale: 1.35,
    baseShift: -0.2,
    kind: 'completed',
    preDays: 3,
    postLeadDays: 1,
    postTailDays: 2,
    retentionOffsetDays: 87,
    under13Rosters: [2, 7, 11, 16],
    adultShare: 0.05,
    practice: { students: 3, repeats: 0 },
    preRate: 0.98,
    postRate: 0.93,
  },
  {
    key: 'c5',
    program: 'camps',
    course: 'camp-py',
    label: 'Python Game Camp (Week 3)',
    mode: 'in_person',
    start: '2026-07-13',
    end: '2026-07-24',
    lead: 'instr3',
    family: 'workshop-quick',
    preForm: 'A',
    postForm: 'B',
    size: 16,
    gainScale: 1.1,
    baseShift: -0.1,
    kind: 'completed',
    preDays: 3,
    postLeadDays: 1,
    postTailDays: 2,
    under13Rosters: [3, 8, 13],
    adultShare: 0.05,
    preRate: 0.98,
    postRate: 0.93,
  },
  {
    key: 'c8',
    program: 'ai',
    course: 'ai-build',
    label: 'Building with AI (hybrid)',
    mode: 'hybrid',
    start: '2026-09-14',
    end: '2026-12-11',
    lead: 'instr1',
    family: 'ai-literacy',
    preForm: 'B',
    postForm: 'A',
    size: 20,
    gainScale: 1.0,
    baseShift: 0.1,
    kind: 'mid_post',
    preDays: 10,
    postLeadDays: 6,
    postTailDays: 3,
    under13Rosters: [],
    adultShare: 0.2,
    returning: { from: ['c2', 'c3', 'c6'], count: 8 },
    preRate: 0.95,
    postRate: 0.3,
  },
  {
    key: 'c7',
    program: 'k12',
    course: 'cs-fund',
    label: 'CS Fundamentals (Tempe, late start)',
    mode: 'in_person',
    start: '2026-11-09',
    end: '2027-03-26',
    lead: 'instr1',
    family: 'cs-fundamentals',
    preForm: 'A',
    postForm: 'B',
    size: 18,
    gainScale: 1.0,
    baseShift: 0,
    kind: 'fresh_pre',
    preDays: 10,
    postLeadDays: 6,
    postTailDays: 3,
    under13Rosters: [3],
    adultShare: 0.05,
    returning: { from: ['c1', 'c2'], count: 3 },
    preRate: 0.55,
    postRate: 0,
  },
];

/** Baseline skill strengths (logit offsets): loops and debugging start weakest. */
const SKILL_BASE: Record<SkillCategory, number> = {
  programming_fundamentals: 0,
  variables: 0.5,
  data_types: 0.3,
  conditionals: 0.1,
  loops: -0.7,
  functions: -0.2,
  debugging: -0.6,
  logic: -0.1,
  problem_solving: -0.2,
  code_comprehension: -0.3,
  computational_thinking: 0,
};
/** Modelled learning gains (logit): debugging gains most, loops least. */
const SKILL_GAIN: Record<SkillCategory, number> = {
  programming_fundamentals: 0.6,
  variables: 0.5,
  data_types: 0.5,
  conditionals: 0.7,
  loops: 0.35,
  functions: 0.8,
  debugging: 1.5,
  logic: 0.6,
  problem_solving: 0.6,
  code_comprehension: 0.8,
  computational_thinking: 0.7,
};
const GAIN_MULT = 1.75;
const DIFFICULTY_ADJ: Record<Difficulty, number> = { intro: 0, intermediate: 0.45, advanced: 0.9 };

/* ------------------------------------------------------------------ */
/* small generators                                                    */
/* ------------------------------------------------------------------ */

function randomChars(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += CROCKFORD_ALPHABET[rng.int(0, CROCKFORD_ALPHABET.length - 1)];
  return s;
}

/* ------------------------------------------------------------------ */
/* the generator                                                       */
/* ------------------------------------------------------------------ */

interface StudentSim {
  key: string;
  row: StudentRow;
  theta: number;
  skillOff: Record<SkillCategory, number>;
  confBias: number;
  cohorts: string[];
}

interface Enrollment {
  cfg: CohortCfg;
  student: StudentSim;
  roster: string;
  status: 'enrolled' | 'withdrawn';
  /** Head start (logit) for students returning from an earlier cohort. */
  thetaBonus: number;
  special?: 'fresh' | 'ready' | 'pending' | 'withdrawn';
}

interface FormRef {
  assessmentId: string;
  def: FormDef;
  questions: { id: string; def: QuestionDef }[];
  scorable: ScorableQuestion[];
}

export function generateDemoDataset(anchor: string = DEFAULT_DEMO_ANCHOR): DemoDataset {
  const nowMs = parseDate(anchor) + 17 * 3_600_000; // "now" in the demo world: anchor 17:00Z
  const shift = daysBetween(DEFAULT_DEMO_ANCHOR, anchor);
  const seed = `cic-demo-v1`;
  const rngFor = (...parts: string[]): Rng => createRng([seed, ...parts].join('|'));

  /* ---------------- programs & courses ---------------- */
  const programDefs: {
    key: ProgramKey;
    name: string;
    slug: string;
    format: ProgramFormat;
    description: string;
  }[] = [
    {
      key: 'k12',
      name: 'K-12 CS Pathways',
      slug: 'k12-cs-pathways',
      format: 'semester',
      description:
        'Semester-long computer science courses for middle and high school students (synthetic demo program).',
    },
    {
      key: 'camps',
      name: 'Summer Code Camps',
      slug: 'summer-code-camps',
      format: 'camp',
      description:
        'Multi-day summer camps where students build games and apps (synthetic demo program).',
    },
    {
      key: 'ai',
      name: 'AI Academy',
      slug: 'ai-academy',
      format: 'ai_academy',
      description:
        'Hands-on AI literacy and applied-AI courses for teens and adults (synthetic demo program).',
    },
  ];
  const programId = (k: ProgramKey): string => demoUuid('program', k);
  const programCreated = at(addDays('2025-07-01', shift), 15);
  const programs: ProgramRow[] = programDefs.map((p) => ({
    id: programId(p.key),
    name: p.name,
    slug: p.slug,
    description: p.description,
    format: p.format,
    status: 'active',
    created_at: programCreated,
    updated_at: programCreated,
  }));

  const courseDefs: { key: string; program: ProgramKey; name: string; description: string }[] = [
    {
      key: 'cs-fund',
      program: 'k12',
      name: 'CS Fundamentals with Python',
      description: 'Variables, conditionals, loops, functions and debugging in Python.',
    },
    {
      key: 'ct',
      program: 'k12',
      name: 'Computational Thinking & Logic',
      description: 'Decomposition, patterns, algorithms and logic, with Python practice.',
    },
    {
      key: 'camp-py',
      program: 'camps',
      name: 'Python Game Design Camp',
      description: 'Build small games while learning core programming ideas.',
    },
    {
      key: 'ai-lit',
      program: 'ai',
      name: 'AI Literacy for Teens',
      description: 'How AI systems learn, where they fail, and how to check their answers.',
    },
    {
      key: 'ai-build',
      program: 'ai',
      name: 'Building with AI Tools',
      description: 'Use and evaluate AI tools while building small projects.',
    },
  ];
  const courses: CourseRow[] = courseDefs.map((c) => ({
    id: demoUuid('course', c.key),
    program_id: programId(c.program),
    name: c.name,
    description: c.description,
    status: 'active',
    created_at: programCreated,
  }));
  const courseId = (k: string): string => demoUuid('course', k);

  /* ---------------- staff ---------------- */
  const staffDefs: {
    key: StaffKey;
    name: string;
    role: StaffUserRow['role'];
    programs: ProgramKey[];
  }[] = [
    { key: 'instr1', name: 'Demo Instructor', role: 'instructor', programs: ['k12', 'ai'] },
    { key: 'admin', name: 'Demo Admin', role: 'admin', programs: [] },
    { key: 'owner', name: 'Demo Owner', role: 'owner', programs: [] },
    { key: 'analyst', name: 'Demo Analyst', role: 'analyst', programs: [] },
    { key: 'instr2', name: 'Demo Instructor Two', role: 'instructor', programs: ['k12', 'ai'] },
    { key: 'instr3', name: 'Demo Instructor Three', role: 'instructor', programs: ['camps'] },
  ];
  const staffId = (k: StaffKey): string => demoUuid('staff', k);
  const staffCreated = at(addDays('2025-06-15', shift), 15);
  const staff: StaffUserRow[] = staffDefs.map((s, i) => ({
    id: staffId(s.key),
    auth_user_id: null,
    display_name: s.name,
    role: s.role,
    status: 'active',
    is_synthetic: true,
    created_at: staffCreated,
    last_login_at: at(addDays(anchor, -(i % 4)), 14 + i),
  }));
  const staffAssignments: StaffProgramAssignmentRow[] = staffDefs.flatMap((s) =>
    s.programs.map((p) => ({
      staff_id: staffId(s.key),
      program_id: programId(p),
      created_at: staffCreated,
    })),
  );

  /* ---------------- assessments / questions / keys ---------------- */
  const assessments: AssessmentRow[] = [];
  const questions: QuestionRow[] = [];
  const answerKeys: QuestionAnswerKeyRow[] = [];
  const formRefs = new Map<string, FormRef>();
  const assessmentCreated = at(addDays('2025-08-20', shift), 16);
  for (const form of FORMS) {
    const assessmentId = demoUuid('assessment', `${form.family}:${form.label}:v1`);
    const skills = [
      ...new Set(form.questions.filter((q) => q.type !== 'confidence_likert').map((q) => q.skill)),
    ];
    assessments.push({
      id: assessmentId,
      course_id: null,
      form_family: form.family,
      form_label: form.label,
      title: form.title,
      description: form.description,
      version: 1,
      difficulty: form.difficulty,
      estimated_minutes: form.estimatedMinutes,
      intended_stages: ['PRE', 'POST', 'RETENTION', 'PRACTICE'],
      skill_categories: skills,
      status: 'active',
      created_at: assessmentCreated,
    });
    const refs: FormRef['questions'] = [];
    form.questions.forEach((q, i) => {
      const id = demoUuid('question', `${form.family}:${form.label}:${i + 1}`);
      refs.push({ id, def: q });
      questions.push({
        id,
        assessment_id: assessmentId,
        question_type: q.type,
        prompt: q.prompt,
        config: q.config,
        skill_category: q.skill,
        difficulty: q.difficulty,
        points: q.points,
        display_order: i + 1,
      });
      if (q.key) answerKeys.push({ question_id: id, answer_key: q.key });
    });
    formRefs.set(`${form.family}:${form.label}`, {
      assessmentId,
      def: form,
      questions: refs,
      scorable: refs.map((r) => ({
        id: r.id,
        type: r.def.type,
        skill: r.def.skill,
        points: r.def.points,
        key: r.def.key,
      })),
    });
  }
  const formOf = (family: string, label: string): FormRef =>
    must(formRefs.get(`${family}:${label}`), `form ${family}:${label}`);

  /* ---------------- cohorts ---------------- */
  const cohortDates = new Map<string, { start: string; end: string }>();
  const cohorts: CohortRow[] = COHORTS.map((c) => {
    const start = addDays(c.start, shift);
    const end = addDays(c.end, shift);
    cohortDates.set(c.key, { start, end });
    const status: CohortRow['status'] =
      end < anchor ? 'completed' : start <= anchor ? 'active' : 'planned';
    return {
      id: demoUuid('cohort', c.key),
      program_id: programId(c.program),
      course_id: courseId(c.course),
      name: `${seasonOf(start)}: ${c.label}`,
      delivery_mode: c.mode,
      start_date: start,
      end_date: end,
      lead_instructor_id: staffId(c.lead),
      status,
      created_at: at(addDays(start, -45), 16),
    };
  });
  const cohortId = (k: string): string => demoUuid('cohort', k);
  const cohortRow = (k: string): CohortRow =>
    must(
      cohorts.find((c) => c.id === cohortId(k)),
      `cohort ${k}`,
    );

  /* ---------------- students & enrolment ---------------- */
  const students: StudentRow[] = [];
  const sims = new Map<string, StudentSim>();
  const enrollments: Enrollment[] = [];
  const usedPublic = new Set<string>();
  const usedDemoCodes = new Set<string>(['DEMA-FRSH-PRE0-2026', 'DEMA-RDY2-P0ST-2026']);
  const demoCodes = new Map<string, string>(); // student key -> code
  const label = (n: number): string => String(n).padStart(2, '0');

  const publicCodeFor = (key: string): string => {
    const rng = rngFor('public-code', key);
    for (;;) {
      const code = `S-${randomChars(rng, 6)}`;
      if (!usedPublic.has(code)) {
        usedPublic.add(code);
        return code;
      }
    }
  };
  const demoCodeFor = (key: string): string => {
    const rng = rngFor('demo-code', key);
    for (;;) {
      const raw = `DEMS${randomChars(rng, 12)}`;
      const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
      if (!usedDemoCodes.has(code)) {
        usedDemoCodes.add(code);
        return code;
      }
    }
  };

  function newStudent(
    key: string,
    ageBand: AgeBand,
    cohortStart: string,
    thetaBase: number,
  ): StudentSim {
    const rng = rngFor('student', key);
    const created = at(addDays(cohortStart, -7), 12, rng.int(0, 59));
    const skillOff = {} as Record<SkillCategory, number>;
    (Object.keys(SKILL_BASE) as SkillCategory[]).forEach((s) => {
      skillOff[s] = SKILL_BASE[s] + rng.normal(0, 0.35);
    });
    const row: StudentRow = {
      id: demoUuid('student', key),
      public_code: publicCodeFor(key),
      age_band: ageBand,
      status: 'active',
      is_synthetic: true,
      created_at: created,
      updated_at: created,
    };
    const sim: StudentSim = {
      key,
      row,
      theta: rng.normal(0.25 + thetaBase, 0.8),
      skillOff,
      confBias: rng.normal(0, 0.4),
      cohorts: [],
    };
    students.push(row);
    sims.set(key, sim);
    demoCodes.set(key, demoCodeFor(key));
    return sim;
  }

  const sortedCfgs = [...COHORTS].sort((a, b) => a.start.localeCompare(b.start));
  const rosterByCohort = new Map<string, Enrollment[]>();
  for (const cfg of sortedCfgs) {
    const dates = must(cohortDates.get(cfg.key), 'dates');
    const rng = rngFor('roster', cfg.key);
    const positions = Array.from({ length: cfg.size }, (_, i) => i + 1);
    const special = new Map<number, Enrollment['special']>();
    if (cfg.key === 'c7') {
      special.set(7, 'fresh');
      special.set(3, 'pending');
    }
    if (cfg.key === 'c8') special.set(11, 'ready');
    if (cfg.key === 'c2') special.set(15, 'withdrawn');

    // returning students occupy the last non-special positions
    const returningPicks: StudentSim[] = [];
    if (cfg.returning) {
      const pool: StudentSim[] = [];
      for (const fromKey of cfg.returning.from) {
        for (const e of rosterByCohort.get(fromKey) ?? []) {
          if (e.special || e.status !== 'enrolled') continue;
          if (e.student.row.age_band === 'UNDER_13' || e.student.row.status !== 'active') continue;
          pool.push(e.student);
        }
      }
      for (const s of rng.shuffle(pool)) {
        if (returningPicks.length >= cfg.returning.count) break;
        if (!returningPicks.includes(s)) returningPicks.push(s);
      }
    }
    const freePositions = positions.filter(
      (p) => !special.has(p) && !cfg.under13Rosters.includes(p),
    );
    const returningPositions = new Set(
      freePositions.slice(freePositions.length - returningPicks.length),
    );
    let ri = 0;

    const roster: Enrollment[] = [];
    for (const pos of positions) {
      const sp = special.get(pos);
      const under13 = cfg.under13Rosters.includes(pos) || sp === 'pending';
      let student: StudentSim;
      if (returningPositions.has(pos)) {
        student = must(returningPicks[ri++], 'returning student');
      } else {
        const age: AgeBand = under13
          ? 'UNDER_13'
          : rng.chance(cfg.adultShare)
            ? 'AGE_18_PLUS'
            : 'AGE_13_17';
        student = newStudent(`${cfg.key}-${label(pos)}`, age, dates.start, cfg.baseShift);
      }
      student.cohorts.push(cfg.key);
      if (sp === 'pending') student.row.status = 'pending_consent';
      if (sp === 'withdrawn') student.row.status = 'withdrawn';
      roster.push({
        cfg,
        student,
        roster: label(pos),
        status: sp === 'withdrawn' ? 'withdrawn' : 'enrolled',
        // a returning student carries a small head start from the earlier course
        thetaBonus: returningPositions.has(pos) ? 0.3 : 0,
        ...(sp ? { special: sp } : {}),
      });
    }
    rosterByCohort.set(cfg.key, roster);
    enrollments.push(...roster);
  }

  const cohortStudents: CohortStudentRow[] = enrollments.map((e) => ({
    id: demoUuid('cohort-student', `${e.cfg.key}:${e.roster}`),
    cohort_id: cohortId(e.cfg.key),
    student_id: e.student.row.id,
    roster_label: e.roster,
    enrolled_at: at(addDays(must(cohortDates.get(e.cfg.key), 'dates').start, -3), 12),
    status: e.status,
  }));

  /* ---------------- consent (under-13) ---------------- */
  const consentRecords: ConsentRecordRow[] = [];
  const guardianContacts: GuardianContactRow[] = [];
  let guardianN = 0;
  for (const e of enrollments) {
    if (e.student.row.age_band !== 'UNDER_13') continue;
    const dates = must(cohortDates.get(e.cfg.key), 'dates');
    const pending = e.special === 'pending';
    const recId = demoUuid('consent', e.student.key);
    consentRecords.push({
      id: recId,
      student_id: e.student.row.id,
      consent_status: pending ? 'pending' : 'granted',
      verification_method: pending
        ? null
        : e.roster === '02' || e.roster === '03'
          ? 'signed_form'
          : 'in_person',
      notice_version: pending ? CURRENT_PRIVACY_NOTICE_VERSION : OLDER_NOTICE_VERSION,
      consent_timestamp: pending ? null : at(addDays(dates.start, -10), 17),
      withdrawal_timestamp: null,
      recorded_by: staffId('admin'),
      created_at: at(addDays(dates.start, -10), 17),
    });
    guardianN += 1;
    const method = guardianN % 3 === 1 ? 'paper' : guardianN % 3 === 2 ? 'email' : 'phone';
    guardianContacts.push({
      id: demoUuid('guardian', e.student.key),
      consent_record_id: recId,
      contact_method: method,
      contact_value:
        method === 'paper'
          ? `paper-form-ref-${String(guardianN).padStart(4, '0')}`
          : method === 'email'
            ? `guardian-demo-${String(guardianN).padStart(2, '0')}@example.invalid`
            : '555-0100',
      created_at: at(addDays(dates.start, -10), 17),
    });
  }

  /* ---------------- sessions ---------------- */
  const sessions: AssessmentSessionRow[] = [];
  interface SessionInfo {
    row: AssessmentSessionRow;
    winStart: string;
    nDays: number;
    limitMs: number;
  }
  const sessionInfo = new Map<string, SessionInfo>(); // `${cohort}:${stage}`
  const stageTitle: Record<AssessmentStage, string> = {
    PRE: 'Pre-assessment',
    POST: 'Post-assessment',
    RETENTION: 'Retention check',
    PRACTICE: 'Practice',
  };
  function addSession(
    cfg: CohortCfg,
    stage: AssessmentStage,
    formLabel: string,
    winStart: string,
    nDays: number,
    status: AssessmentSessionRow['status'],
    openEnded: boolean,
  ): SessionInfo {
    const cohort = cohortRow(cfg.key);
    const form = formOf(cfg.family, formLabel);
    const row: AssessmentSessionRow = {
      id: demoUuid('session', `${cfg.key}:${stage}`),
      cohort_id: cohort.id,
      assessment_id: form.assessmentId,
      stage,
      title: `${cohort.name} — ${stageTitle[stage]}`,
      starts_at: at(winStart, 14),
      ends_at: openEnded ? null : at(addDays(winStart, nDays), 14),
      status,
      created_by: staffId(cfg.lead),
      created_at: at(addDays(winStart, -1), 20),
    };
    sessions.push(row);
    const info: SessionInfo = {
      row,
      winStart,
      nDays,
      limitMs: openEnded
        ? nowMs - 2 * 3_600_000
        : parseDate(addDays(winStart, nDays)) + 14 * 3_600_000 - 60_000,
    };
    sessionInfo.set(`${cfg.key}:${stage}`, info);
    return info;
  }

  for (const cfg of COHORTS) {
    const { start, end } = must(cohortDates.get(cfg.key), 'dates');
    // PRE
    if (cfg.kind === 'fresh_pre') addSession(cfg, 'PRE', cfg.preForm, start, 0, 'open', true);
    else addSession(cfg, 'PRE', cfg.preForm, start, cfg.preDays, 'closed', false);
    // POST
    if (cfg.kind === 'completed') {
      addSession(
        cfg,
        'POST',
        cfg.postForm,
        addDays(end, -cfg.postLeadDays),
        cfg.postLeadDays + cfg.postTailDays,
        'closed',
        false,
      );
    } else if (cfg.kind === 'mid_post') {
      addSession(cfg, 'POST', cfg.postForm, addDays(anchor, -6), 0, 'open', true);
    } else {
      // late-start cohort: POST is scheduled for the end of the course
      const info = addSession(
        cfg,
        'POST',
        cfg.postForm,
        addDays(end, -cfg.postLeadDays),
        cfg.postLeadDays + cfg.postTailDays,
        'scheduled',
        false,
      );
      info.row.created_at = at(addDays(start, 0), 15);
    }
    // RETENTION
    if (cfg.retForm && cfg.retentionOffsetDays !== undefined) {
      addSession(
        cfg,
        'RETENTION',
        cfg.retForm,
        addDays(end, cfg.retentionOffsetDays),
        14,
        'closed',
        false,
      );
    }
    // PRACTICE (closed, mid-course, form A of the family)
    if (cfg.practice) {
      const mid = addDays(start, Math.floor(daysBetween(start, end) / 2));
      addSession(cfg, 'PRACTICE', 'A', mid, 5, 'closed', false);
    }
  }

  /* ---------------- attempts ---------------- */
  const attempts: AssessmentAttemptRow[] = [];
  const responses: AssessmentResponseRow[] = [];
  const skillScores: AttemptSkillScoreRow[] = [];

  function instantIn(rng: Rng, info: SessionInfo): number {
    const days = Math.max(
      1,
      info.nDays || Math.max(1, Math.floor((info.limitMs - parseDate(info.winStart)) / DAY) + 1),
    );
    const day = rng.int(0, days - 1);
    let ms =
      parseDate(info.winStart) +
      day * DAY +
      rng.int(15, 21) * 3_600_000 +
      rng.int(0, 59) * 60_000 +
      rng.int(0, 59) * 1000;
    if (ms > info.limitMs) ms = info.limitMs - rng.int(1, 600) * 60_000 - rng.int(0, 59) * 1000;
    if (ms < parseDate(info.winStart) + 14 * 3_600_000 + 60_000)
      ms = parseDate(info.winStart) + 14 * 3_600_000 + 60_000 + rng.int(0, 3600) * 1000;
    return Math.floor(ms / 1000) * 1000;
  }

  function answerQuestion(q: QuestionDef, p: number, rng: Rng): DemoResponse {
    if (rng.chance(q.type === 'short_logic' ? 0.05 : 0.02)) return { kind: 'skipped' };
    const correct = rng.chance(p);
    const key = q.key ?? {};
    const optionIds = ((q.config['options'] as { id: string }[] | undefined) ?? []).map(
      (o) => o.id,
    );
    switch (q.type) {
      case 'multiple_choice':
      case 'code_comprehension':
      case 'predict_output': {
        const right = key['correctOptionId'] as string;
        return {
          kind: 'single',
          optionId: correct ? right : rng.pick(optionIds.filter((o) => o !== right)),
        };
      }
      case 'multiple_select': {
        const right = key['correctOptionIds'] as string[];
        if (correct)
          return { kind: 'multi', optionIds: optionIds.filter((o) => right.includes(o)) };
        for (let tries = 0; tries < 20; tries++) {
          const picked = optionIds.filter((o) => rng.chance(right.includes(o) ? 0.5 : 0.35));
          const identical =
            picked.length === right.length && picked.every((o) => right.includes(o));
          if (picked.length > 0 && !identical) return { kind: 'multi', optionIds: picked };
        }
        return {
          kind: 'multi',
          optionIds: optionIds.filter((o) => !right.includes(o)).slice(0, 1),
        };
      }
      case 'debugging': {
        const bug = key['bugLine'] as number;
        if (correct) return { kind: 'line', line: bug };
        const lines = ((q.config['code'] as string) ?? '').split('\n');
        const candidates = lines
          .map((t, i) => ({ t, n: i + 1 }))
          .filter((l) => l.t.trim() !== '' && l.n !== bug)
          .map((l) => l.n);
        return { kind: 'line', line: rng.pick(candidates) };
      }
      case 'ordering': {
        const right = key['correctOrder'] as string[];
        if (correct) return { kind: 'order', itemIds: right.slice() };
        for (let tries = 0; tries < 20; tries++) {
          const s = rng.shuffle(right);
          if (s.some((id, i) => id !== right[i])) return { kind: 'order', itemIds: s };
        }
        return { kind: 'order', itemIds: right.slice().reverse() };
      }
      case 'short_logic': {
        const accepted = key['acceptedAnswers'] as string[];
        if (correct)
          return {
            kind: 'text',
            text: rng.chance(0.85) ? (accepted[0] as string) : ` ${rng.pick(accepted)} `,
          };
        return { kind: 'text', text: rng.pick(q.wrongAnswers ?? ['0']) };
      }
      default:
        return { kind: 'skipped' };
    }
  }

  interface AbilityPlan {
    pre: Record<SkillCategory, number>;
    post: Record<SkillCategory, number>;
    m: number;
  }

  function planFor(e: Enrollment): AbilityPlan {
    const rng = rngFor('plan', e.cfg.key, e.student.key);
    const roll = rng.next();
    let m: number;
    if (roll < 0.68) m = clamp(rng.normal(1.1, 0.35), 0.5, 2);
    else if (roll < 0.84) m = rng.normal(0, 0.1);
    else m = -(0.5 + rng.next() * 0.7);
    const pre = {} as Record<SkillCategory, number>;
    const post = {} as Record<SkillCategory, number>;
    (Object.keys(SKILL_BASE) as SkillCategory[]).forEach((s) => {
      pre[s] = e.student.theta + e.thetaBonus + e.student.skillOff[s];
      post[s] = pre[s] + SKILL_GAIN[s] * GAIN_MULT * e.cfg.gainScale * m + rng.normal(0, 0.3);
    });
    return { pre, post, m };
  }

  function makeAttempt(
    e: Enrollment,
    plan: AbilityPlan,
    stage: AssessmentStage,
    formLabel: string,
    info: SessionInfo,
    submitMs: number,
    tag: string,
  ): void {
    const form = formOf(e.cfg.family, formLabel);
    const rng = rngFor('attempt', e.cfg.key, e.student.key, stage, tag);
    const noiseRng = rngFor('ability-noise', e.cfg.key, e.student.key, stage, tag);
    const answers = new Map<string, DemoResponse>();
    let autoItems = 0;
    let likertItems = 0;
    for (const ref of form.questions) {
      const q = ref.def;
      const skill = q.skill;
      const preA = plan.pre[skill];
      const postA = plan.post[skill];
      const ability =
        stage === 'PRE'
          ? preA
          : stage === 'POST'
            ? postA
            : stage === 'RETENTION'
              ? preA + (postA - preA) * 0.75 + noiseRng.normal(0, 0.2)
              : preA + (postA - preA) * 0.35;
      if (q.type === 'confidence_likert') {
        likertItems += 1;
        const lift =
          stage === 'POST'
            ? 0.35 + 0.35 * Math.max(plan.m, 0)
            : stage === 'RETENTION'
              ? 0.3
              : stage === 'PRACTICE'
                ? 0.1
                : 0;
        const v = clamp(
          Math.round(
            2.7 +
              0.45 * (e.student.theta + e.thetaBonus) +
              e.student.confBias +
              lift +
              rng.normal(0, 0.7),
          ),
          1,
          5,
        );
        answers.set(ref.id, rng.chance(0.02) ? { kind: 'skipped' } : { kind: 'likert', value: v });
      } else {
        autoItems += 1;
        const p = clamp(
          sigmoid(ability - DIFFICULTY_ADJ[q.difficulty] + noiseRng.normal(0, 0.15)),
          0.03,
          0.97,
        );
        answers.set(ref.id, answerQuestion(q, p, rng));
      }
    }
    const scored = scoreAttempt(form.scorable, answers);
    let duration = 15 + rng.int(5, 35);
    for (let i = 0; i < autoItems; i++) duration += clamp(rng.normal(22, 6), 8, 45);
    duration += likertItems * rng.int(5, 12);
    if (stage === 'POST') duration *= 0.92;
    const durationSeconds = Math.round(clamp(duration, 90, 540));
    const attemptId = demoUuid('attempt', `${e.cfg.key}:${e.student.key}:${stage}:${tag}`);
    const cohort = cohortRow(e.cfg.key);
    attempts.push({
      id: attemptId,
      student_id: e.student.row.id,
      assessment_session_id: info.row.id,
      assessment_id: form.assessmentId,
      assessment_version: 1,
      cohort_id: cohort.id,
      stage,
      status: 'submitted',
      raw_score: scored.raw,
      max_score: scored.max,
      percentage_score: scored.percentage,
      self_reported_confidence: scored.confidence,
      started_at: isoZ(submitMs - durationSeconds * 1000),
      submitted_at: isoZ(submitMs),
      duration_seconds: durationSeconds,
      created_at: isoZ(submitMs - durationSeconds * 1000),
    });
    for (const r of scored.responses) {
      responses.push({
        id: demoUuid('response', `${attemptId}:${r.question_id}`),
        attempt_id: attemptId,
        question_id: r.question_id,
        response_data: r.response_data as unknown as Record<string, unknown>,
        is_correct: r.is_correct,
        earned_points: r.earned_points,
        max_points: r.max_points,
        submitted_at: isoZ(submitMs),
      });
    }
    for (const s of scored.skills) {
      skillScores.push({
        attempt_id: attemptId,
        skill_category: s.skill_category,
        earned_points: s.earned_points,
        max_points: s.max_points,
      });
    }
  }

  for (const cfg of sortedCfgs) {
    const roster = must(rosterByCohort.get(cfg.key), 'roster');
    const preInfo = must(sessionInfo.get(`${cfg.key}:PRE`), 'pre session');
    const postInfo = sessionInfo.get(`${cfg.key}:POST`);
    const retInfo = sessionInfo.get(`${cfg.key}:RETENTION`);
    const pracInfo = sessionInfo.get(`${cfg.key}:PRACTICE`);
    const plans = new Map<string, AbilityPlan>();
    const hadPre: Enrollment[] = [];
    let inProgressLeft = cfg.kind === 'fresh_pre' ? 2 : 0;

    for (const e of roster) {
      if (e.special === 'pending' || e.special === 'fresh') continue; // never took anything
      const rng = rngFor('attendance', cfg.key, e.student.key);
      const plan = planFor(e);
      plans.set(e.student.key, plan);

      let hasPre: boolean;
      let hasPost: boolean;
      if (e.special === 'withdrawn') {
        hasPre = true;
        hasPost = false;
      } else if (e.special === 'ready') {
        hasPre = true;
        hasPost = false;
      } else {
        const late = cfg.kind === 'completed' && rng.chance(0.04);
        hasPre = !late && rng.chance(cfg.preRate);
        hasPost =
          cfg.kind === 'fresh_pre'
            ? false
            : late
              ? rng.chance(0.7)
              : hasPre && rng.chance(cfg.postRate);
      }
      const hasRet = Boolean(retInfo && cfg.kind === 'completed' && hasPost && rng.chance(0.6));

      if (hasPre) {
        makeAttempt(e, plan, 'PRE', cfg.preForm, preInfo, instantIn(rng, preInfo), '1');
        if (e.special !== 'withdrawn') hadPre.push(e);
      } else if (inProgressLeft > 0 && cfg.kind === 'fresh_pre') {
        inProgressLeft -= 1;
        const startedMs = nowMs - rng.int(4, 25) * 60_000;
        attempts.push({
          id: demoUuid('attempt', `${cfg.key}:${e.student.key}:PRE:in-progress`),
          student_id: e.student.row.id,
          assessment_session_id: preInfo.row.id,
          assessment_id: preInfo.row.assessment_id,
          assessment_version: 1,
          cohort_id: preInfo.row.cohort_id,
          stage: 'PRE',
          status: 'in_progress',
          raw_score: null,
          max_score: null,
          percentage_score: null,
          self_reported_confidence: null,
          started_at: isoZ(startedMs),
          submitted_at: null,
          duration_seconds: null,
          created_at: isoZ(startedMs),
        });
      }
      if (hasPost && postInfo)
        makeAttempt(e, plan, 'POST', cfg.postForm, postInfo, instantIn(rng, postInfo), '1');
      if (hasRet && retInfo && cfg.retForm)
        makeAttempt(e, plan, 'RETENTION', cfg.retForm, retInfo, instantIn(rng, retInfo), '1');
    }

    if (cfg.practice && pracInfo) {
      const rng = rngFor('practice', cfg.key);
      const chosen = hadPre.slice(0, cfg.practice.students);
      chosen.forEach((e, idx) => {
        const plan = must(plans.get(e.student.key), 'plan');
        const first = instantIn(rng, pracInfo);
        makeAttempt(e, plan, 'PRACTICE', 'A', pracInfo, first, '1');
        if (idx < cfg.practice!.repeats)
          makeAttempt(e, plan, 'PRACTICE', 'A', pracInfo, first + rng.int(20, 180) * 60_000, '2');
      });
    }
  }
  // stable, readable ordering
  attempts.sort((a, b) =>
    a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : a.id < b.id ? -1 : 1,
  );

  /* ---------------- audit log ---------------- */
  const audit: { at: string; row: Omit<AuditLogRow, 'id' | 'created_at'> }[] = [];
  for (const cfg of COHORTS) {
    const { start } = must(cohortDates.get(cfg.key), 'dates');
    const roster = must(rosterByCohort.get(cfg.key), 'roster');
    const bands = new Map<AgeBand, number>();
    for (const e of roster)
      bands.set(e.student.row.age_band, (bands.get(e.student.row.age_band) ?? 0) + 1);
    for (const [band, count] of bands) {
      audit.push({
        at: at(addDays(start, -5), 18, 30),
        row: {
          actor_type: 'staff',
          actor_id: staffId(cfg.lead),
          action: 'credential.issue',
          target_type: 'cohort',
          target_id: cohortId(cfg.key),
          metadata: { count, ageBand: band },
        },
      });
    }
  }
  for (const s of sessions) {
    const stage = s.stage;
    audit.push({
      at: s.created_at,
      row: {
        actor_type: 'staff',
        actor_id: s.created_by,
        action: 'session.create',
        target_type: 'assessment_session',
        target_id: s.id,
        metadata: { stage, status: s.status === 'scheduled' ? 'scheduled' : 'open' },
      },
    });
    if (s.status === 'closed' && s.ends_at) {
      audit.push({
        at: s.ends_at,
        row: {
          actor_type: 'staff',
          actor_id: s.created_by,
          action: 'session.update',
          target_type: 'assessment_session',
          target_id: s.id,
          metadata: { stage, status: 'closed' },
        },
      });
    }
  }
  for (const rec of consentRecords) {
    audit.push({
      at: rec.created_at,
      row: {
        actor_type: 'staff',
        actor_id: rec.recorded_by,
        action: 'consent.record',
        target_type: 'student',
        target_id: rec.student_id,
        metadata: { consentStatus: rec.consent_status, noticeVersion: rec.notice_version },
      },
    });
  }
  audit.push({
    at: at(addDays(anchor, -3), 16),
    row: {
      actor_type: 'staff',
      actor_id: staffId('analyst'),
      action: 'export.csv',
      target_type: 'impact_report',
      target_id: null,
      metadata: { suppressionThreshold: 10, format: 'csv' },
    },
  });
  audit.push({
    at: at(addDays(anchor, -1), 15),
    row: {
      actor_type: 'staff',
      actor_id: staffId('admin'),
      action: 'catalog.update',
      target_type: 'cohort',
      target_id: cohortId('c7'),
      metadata: { field: 'status', to: 'active' },
    },
  });
  audit.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const auditLog: AuditLogRow[] = audit
    .filter((a) => a.at <= isoZ(nowMs))
    .map((a, i) => ({ id: demoUuid('audit', String(i)), created_at: a.at, ...a.row }));

  /* ---------------- demo credentials ---------------- */
  const demoCredentials: DemoDataset['demoCredentials'] = [];
  const seen = new Set<string>();
  const fresh = enrollments.find((e) => e.special === 'fresh');
  const ready = enrollments.find((e) => e.special === 'ready');
  if (fresh) {
    demoCredentials.push({
      studentId: fresh.student.row.id,
      code: 'DEMA-FRSH-PRE0-2026',
      label: 'Presenter — fresh pre-assessment',
    });
    seen.add(fresh.student.key);
  }
  if (ready) {
    demoCredentials.push({
      studentId: ready.student.row.id,
      code: 'DEMA-RDY2-P0ST-2026',
      label: 'Presenter — ready for post',
    });
    seen.add(ready.student.key);
  }
  for (const e of enrollments) {
    if (seen.has(e.student.key)) continue;
    seen.add(e.student.key);
    demoCredentials.push({
      studentId: e.student.row.id,
      code: must(demoCodes.get(e.student.key), 'demo code'),
      label: `${cohortRow(e.cfg.key).name} — seat ${e.roster}`,
    });
  }

  return {
    programs,
    courses,
    cohorts,
    staff,
    staffAssignments,
    students,
    cohortStudents,
    consentRecords,
    guardianContacts,
    assessments,
    questions,
    answerKeys,
    sessions,
    attempts,
    responses,
    skillScores,
    auditLog,
    demoCredentials,
  };
}
