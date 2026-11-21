#!/usr/bin/env node
// Fast route screenshots with a guard: fails a capture on console/page errors, blank pages,
// or horizontal overflow. One browser, one context per role (auth once via the API), bounded pool.
//
//   npm run shots -- --routes landing,admin-overview --viewports 1440
//   npm run shots -- --routes 'admin-*' --fold
//   npm run shots:preview            (build, vite preview on :4175, shoot, stop)
//   npm run shots -- --list
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = '/api/v1';
const TIMEOUT = 15000;
const PREVIEW_PORT = 4175;
const HEIGHTS = { 1440: 900, 1024: 768, 768: 1024, 390: 844 };
// Constructed stylesheet, not a <style> element: the production CSP (public/_headers) sets style-src 'self'
// and would block an inline <style> tag.
const MOTION_JS = `(() => { try { const css = '*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}';
  const s = new CSSStyleSheet(); s.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, s]; } catch (e) { /* older browser: motion stays on */ } })();`;

// Routes. role = which context they run in. path(ids) returns null when a needed id is missing.
const ROUTES = [
  { name: 'landing', role: 'public', path: () => '/' },
  { name: 'student-entry', role: 'public', path: () => '/s' },
  { name: 'staff-login', role: 'public', path: () => '/staff/login' },
  { name: 'notfound', role: 'public', path: () => '/nope' },
  { name: 'student-home', role: 'student', path: () => '/s/home' },
  {
    name: 'student-assess-intro',
    role: 'student',
    path: (i) => i.session && `/s/assess/${i.session}`,
  },
  { name: 'student-progress', role: 'student', path: () => '/s/progress' },
  { name: 'instructor-dashboard', role: 'instructor', path: () => '/instructor' },
  { name: 'instructor-session-new', role: 'instructor', path: () => '/instructor/sessions/new' },
  {
    name: 'instructor-session',
    role: 'instructor',
    path: (i) => i.session && `/instructor/sessions/${i.session}`,
  },
  {
    name: 'instructor-cohort',
    role: 'instructor',
    path: (i) => i.cohortId && `/instructor/cohorts/${i.cohortId}`,
  },
  { name: 'instructor-cards', role: 'instructor', path: () => '/instructor/cards' },
  { name: 'instructor-forbidden', role: 'instructor', path: () => '/admin/staff' },
  { name: 'admin-overview', role: 'admin', path: () => '/admin' },
  { name: 'admin-reports', role: 'admin', path: () => '/admin/reports' },
  {
    name: 'admin-reports-generated',
    role: 'admin',
    path: () => '/admin/reports',
    after: async (p) => {
      await p.getByRole('button', { name: 'Generate AI Impact Summary' }).click();
      await p.getByTestId('ai-report').waitFor();
    },
  },
  { name: 'admin-print', role: 'admin', path: () => '/admin/reports/print' },
  { name: 'admin-students', role: 'admin', path: () => '/admin/students' },
  {
    name: 'admin-student-detail',
    role: 'admin',
    path: (i) => i.studentId && `/admin/students/${i.studentId}`,
  },
  { name: 'admin-catalog', role: 'admin', path: () => '/admin/catalog' },
  { name: 'admin-assessments', role: 'admin', path: () => '/admin/assessments' },
  { name: 'admin-assessment-new', role: 'admin', path: () => '/admin/assessments/new' },
  {
    name: 'admin-assessment-preview',
    role: 'admin',
    path: () => '/admin/assessments/new',
    after: async (p) => {
      await p
        .getByRole('button', { name: /Preview/ })
        .or(p.getByRole('tab', { name: /Preview/ }))
        .or(p.getByRole('radio', { name: /Preview/ }))
        .first()
        .click();
    },
  },
  {
    name: 'admin-assessment-detail',
    role: 'admin',
    path: (i) => i.assessmentId && `/admin/assessments/${i.assessmentId}`,
  },
  { name: 'admin-consent', role: 'admin', path: () => '/admin/consent' },
  { name: 'owner-staff', role: 'owner', path: () => '/admin/staff' },
  { name: 'owner-audit', role: 'owner', path: () => '/admin/audit' },
  { name: 'analyst-overview', role: 'analyst', path: () => '/admin' },
  { name: 'analyst-reports', role: 'analyst', path: () => '/admin/reports' },
  { name: 'analyst-print', role: 'analyst', path: () => '/admin/reports/print' },
];
// Student walk-through (stateful: submits an assessment). Runs once per viewport on a fresh card.
const FLOW_NAMES = [
  'student-code-entry',
  'student-question-text',
  'student-question-likert',
  'student-question-debug',
  'student-question-code',
  'student-question-choice',
  'student-question-order',
  'student-question-code-full',
  'student-question-choice-full',
  'student-review',
  'student-submit-dialog',
  'student-done',
];

const { values: opts } = parseArgs({
  options: {
    help: { type: 'boolean', default: false },
    'base-url': { type: 'string', default: 'http://localhost:5173' },
    routes: { type: 'string' },
    viewports: { type: 'string', default: '1440,390' },
    out: { type: 'string', default: 'screenshots' },
    concurrency: { type: 'string', default: '6' },
    'full-page': { type: 'boolean', default: true },
    fold: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    list: { type: 'boolean', default: false },
  },
  strict: true,
});

const log = (...a) => process.stdout.write(`${a.join(' ')}\n`);
const ALL_NAMES = [...ROUTES.map((r) => r.name), ...FLOW_NAMES];

function selector(spec) {
  if (!spec) return () => true;
  const res = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const re = new RegExp(
        `^${p
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.')}$`,
      );
      if (!ALL_NAMES.some((n) => re.test(n)))
        throw new Error(`--routes: no route matches "${p}" (see --list)`);
      return re;
    });
  return (name) => res.some((re) => re.test(name));
}

function usage() {
  log(
    'Usage: node scripts/shots.mjs [--routes a,b,admin-*] [--viewports 1440,390] [--out dir] [--concurrency 6]',
  );
  log('       [--fold] [--preview] [--base-url http://localhost:5173] [--list]');
}

async function runPool(items, limit, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

// ---- preview mode -------------------------------------------------------------------------
let previewChild = null;
function stopPreview() {
  if (!previewChild) return Promise.resolve();
  const child = previewChild;
  previewChild = null;
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* gone */
      }
      resolve();
    }, 3000).unref();
  });
}
process.on('exit', () => {
  if (previewChild)
    try {
      process.kill(-previewChild.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
});

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)),
    );
  });
}

async function startPreview() {
  await run('npm', ['run', 'build']);
  previewChild = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let exited = null;
  previewChild.on('exit', (code) => {
    exited = code;
  });
  const url = `http://localhost:${PREVIEW_PORT}/`;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (exited !== null) throw new Error(`vite preview exited early (code ${exited})`);
    try {
      const r = await fetch(url);
      if (r.ok || r.status < 500) return `http://localhost:${PREVIEW_PORT}`;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('vite preview did not answer within 60s');
}

// ---- capture helpers ----------------------------------------------------------------------
function instrument(page, problems) {
  page.setDefaultTimeout(TIMEOUT);
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    const url = msg.location()?.url ?? '';
    const status = /status of (\d{3})/.exec(text)?.[1];
    if (status === '401' && /\/api\/v1\/(student\/me|auth\/me)(\?|$)/.test(url)) return;
    if (status === '503' && /\/admin\/reports\/summarize/.test(url)) return;
    problems.push(`console error: ${text.slice(0, 200)}${url ? ` (${url})` : ''}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
}

async function gotoWithRetry(page, url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }); // one retry, navigation only
  }
}

async function waitQuiet(page, selectorToShow) {
  if (selectorToShow)
    await page.locator(selectorToShow).first().waitFor({ state: 'visible', timeout: TIMEOUT });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .skeleton'), null, {
    timeout: TIMEOUT,
  });
}

async function shoot(page, name, vp, fullPage, problems, dir) {
  const m = await page.evaluate(() => ({
    text: document.body ? document.body.innerText.trim().length : 0,
    overflow: document.documentElement.scrollWidth - window.innerWidth,
  }));
  if (m.text < 50) problems.push(`blank page: innerText ${m.text} chars`);
  if (m.overflow > 1)
    problems.push(`horizontal overflow: scrollWidth exceeds innerWidth by ${m.overflow}px`);
  await page.screenshot({ path: path.join(dir, `${name}-${vp.width}.png`), fullPage });
}

const result = (route, vp, t0, problems) => ({
  route,
  vp: vp.width,
  ms: Math.round(performance.now() - t0),
  problems,
});

// ---- main ---------------------------------------------------------------------------------
async function main() {
  if (opts.help) {
    usage();
    return 0;
  }
  if (opts.list) {
    log('Route names (role):');
    for (const r of ROUTES) log(`  ${r.name.padEnd(26)} ${r.role}`);
    log('Student flow (one fresh card per viewport):');
    for (const n of FLOW_NAMES) log(`  ${n}`);
    return 0;
  }

  const want = selector(opts.routes);
  const routes = ROUTES.filter((r) => want(r.name));
  const flowWanted = FLOW_NAMES.some((n) => want(n));
  if (!routes.length && !flowWanted) throw new Error('nothing selected (see --list)');
  const viewports = opts.viewports
    .split(',')
    .map((w) => Number(w.trim()))
    .filter(Boolean)
    .map((w) => ({ width: w, height: HEIGHTS[w] ?? 900 }));
  if (!viewports.length) throw new Error('--viewports is empty');
  const concurrency = Math.max(1, Number(opts.concurrency) || 6);
  const fullPage = opts['full-page'] && !opts.fold;
  const outDir = path.resolve(ROOT, opts.out);
  await mkdir(outDir, { recursive: true });

  const started = performance.now();
  let base = opts['base-url'];
  if (opts.preview) {
    log('preview: npm run build, then vite preview on :' + PREVIEW_PORT);
    base = await startPreview();
    log(`preview: serving at ${base}`);
  }

  const browser = await chromium.launch();
  const contexts = {};
  const ids = {};
  const results = [];
  try {
    const newContext = async (role) => {
      const ctx = await browser.newContext({ reducedMotion: 'reduce' });
      await ctx.addInitScript(MOTION_JS);
      contexts[role] = ctx;
      return ctx;
    };
    const csrfOf = async (ctx) =>
      (await ctx.storageState()).cookies.find((c) => c.name === 'cic_csrf')?.value ?? '';
    const loginStaff = async (ctx, role) => {
      await ctx.request.get(`${base}${API}/config`);
      const csrf = await csrfOf(ctx);
      const r = await ctx.request.post(`${base}${API}/auth/demo-login`, {
        data: { role },
        headers: { 'X-CSRF-Token': csrf, Origin: base },
      });
      if (!r.ok()) throw new Error(`demo-login ${role} -> ${r.status()}`);
    };
    const getData = async (ctx, p) => {
      const r = await ctx.request.get(`${base}${API}${p}`);
      if (!r.ok()) throw new Error(`GET ${p} -> ${r.status()}`);
      return (await r.json()).data;
    };
    const issueStudentCode = async () => {
      const ctx = contexts.instructor;
      const r = await ctx.request.post(`${base}${API}/instructor/student-credentials`, {
        data: { cohortId: ids.cohortId, count: 1, ageBand: 'AGE_13_17' },
        headers: { 'X-CSRF-Token': await csrfOf(ctx), Origin: base },
      });
      if (!r.ok())
        throw new Error(`student-credentials -> ${r.status()} ${(await r.text()).slice(0, 160)}`);
      return (await r.json()).data[0].accessCode;
    };
    const studentSignIn = async (page, code) => {
      await gotoWithRetry(page, `${base}/s`);
      await page.getByLabel('Access code').fill(code);
      await page.getByRole('button', { name: 'Let’s go' }).click();
      await page.waitForURL('**/s/home');
    };

    // Setup: contexts per role, auth once per role (API), discovery of ids, student session.
    const roles = new Set(routes.map((r) => r.role));
    if (flowWanted) {
      roles.add('student');
      roles.add('instructor');
    }
    if (roles.has('student')) roles.add('instructor'); // cards are issued by an instructor-level context
    roles.add('public');
    const staffRoles = [...roles].filter((r) => !['public', 'student'].includes(r));
    await Promise.all(['public', 'student'].filter((r) => roles.has(r)).map((r) => newContext(r)));
    await Promise.all(
      staffRoles.map(async (role) => {
        await newContext(role);
        await loginStaff(contexts[role], role);
      }),
    );

    if (contexts.instructor) {
      const sessions = await getData(contexts.instructor, '/instructor/assessment-sessions');
      const open =
        sessions.find((s) => s.status === 'open' && s.stage === 'PRE') ??
        sessions.find((s) => s.status === 'open');
      if (open) {
        ids.session = open.id;
        ids.cohortId = open.cohortId;
      }
    }
    const staff = contexts.admin ?? contexts.owner;
    if (staff) {
      const students = await getData(staff, '/admin/students?limit=100');
      const pick = students.find((s) => s.attemptCount >= 2) ?? students[0];
      if (pick) ids.studentId = pick.id;
      const assessments = await getData(staff, '/admin/assessments');
      if (assessments[0]) ids.assessmentId = assessments[0].id;
    }
    if (roles.has('student') && routes.some((r) => r.role === 'student')) {
      const page = await contexts.student.newPage();
      await page.setViewportSize(viewports[0]);
      await studentSignIn(page, await issueStudentCode());
      await page.close();
    }

    // Route captures: bounded pool across routes x viewports.
    const jobs = routes.flatMap((route) => viewports.map((vp) => ({ route, vp })));
    await runPool(jobs, concurrency, async ({ route, vp }) => {
      const t0 = performance.now();
      const problems = [];
      const p = route.path(ids);
      if (!p) {
        results.push(result(route.name, vp, t0, ['no id discovered for this route']));
        return;
      }
      const page = await contexts[route.role].newPage();
      instrument(page, problems);
      try {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await gotoWithRetry(page, base + p);
        if (route.after) await route.after(page);
        await waitQuiet(page, 'main');
        await shoot(page, route.name, vp, fullPage, problems, outDir);
      } catch (e) {
        problems.push(String(e.message).split('\n')[0].slice(0, 300));
        await page
          .screenshot({ path: path.join(outDir, `${route.name}-${vp.width}.png`), fullPage: false })
          .catch(() => {});
      } finally {
        await page.close().catch(() => {});
      }
      results.push(result(route.name, vp, t0, problems));
    });

    // Student walk-through: stateful, so sequential, one fresh card per viewport.
    if (flowWanted) {
      const ctx = contexts.student;
      for (const vp of viewports) {
        await ctx.clearCookies();
        const flowT0 = performance.now();
        const page = await ctx.newPage();
        const buf = [];
        instrument(page, buf);
        await page.setViewportSize({ width: vp.width, height: vp.height });
        const snap = async (name, wantFull = true) => {
          const t = performance.now();
          await waitQuiet(page, null);
          const problems = buf.splice(0);
          if (want(name)) await shoot(page, name, vp, wantFull && fullPage, problems, outDir);
          results.push(result(name, vp, t, problems));
        };
        try {
          if (!ids.session) throw new Error('no open assessment session to walk');
          await gotoWithRetry(page, `${base}/s`);
          await page.getByLabel('Access code').waitFor();
          await snap('student-code-entry', false);
          const code = await issueStudentCode();
          await page.getByLabel('Access code').fill(code);
          await page.getByRole('button', { name: 'Let’s go' }).click();
          await page.waitForURL('**/s/home');
          await gotoWithRetry(page, `${base}/s/assess/${ids.session}`);
          await waitQuiet(page, 'main');
          await page.getByRole('button', { name: /^(Start|Keep going)$/ }).click();
          const pos = page.getByTestId('question-position');
          await pos.waitFor();
          const total = Number(/of (\d+)/.exec(await pos.textContent())[1]);
          const seen = new Set();
          for (let i = 1; i <= total; i++) {
            await page.waitForFunction(
              (n) =>
                document
                  .querySelector('[data-testid=question-position]')
                  ?.textContent?.includes(`Question ${n} of`),
              i,
            );
            const main = page.locator('main');
            let kind = 'text';
            if (await main.getByTestId('likert-panel').count()) {
              kind = 'likert';
              await main.locator('label.likert-cell').nth(3).click();
            } else if (await main.locator('label.codeblock-line').count()) {
              kind = 'debug';
              await main.locator('label.codeblock-line').nth(1).click();
            } else if (await main.locator('label.option').count()) {
              kind = (await main.locator('pre').count()) ? 'code' : 'choice';
              await main.locator('label.option').nth(1).click();
            } else if (await main.getByRole('button', { name: /^Move .* down$/ }).count()) {
              kind = 'order';
              await main
                .getByRole('button', { name: /^Move .* down$/ })
                .first()
                .click();
            } else {
              await main.getByRole('textbox').fill('4');
            }
            if (!seen.has(kind)) {
              seen.add(kind);
              await snap(`student-question-${kind}`, false);
              if (kind === 'code' || kind === 'choice') await snap(`student-question-${kind}-full`);
            }
            await page
              .getByRole('button', { name: i === total ? 'Review' : 'Next', exact: true })
              .click();
          }
          await page.getByRole('heading', { name: 'Check your answers' }).waitFor();
          await snap('student-review');
          await page.getByRole('button', { name: 'Turn in my answers' }).click();
          await snap('student-submit-dialog', false);
          await page.getByRole('dialog').getByRole('button', { name: 'Yes, turn it in' }).click();
          await page.getByTestId('done-screen').waitFor();
          await snap('student-done');
        } catch (e) {
          results.push(
            result('student-flow', vp, flowT0, [
              ...buf.splice(0),
              String(e.message).split('\n')[0].slice(0, 300),
            ]),
          );
          await page
            .screenshot({ path: path.join(outDir, `student-flow-error-${vp.width}.png`) })
            .catch(() => {});
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    await stopPreview();
  }

  // Report.
  const rows = results.slice().sort((a, b) => a.route.localeCompare(b.route) || a.vp - b.vp);
  const failed = rows.filter((r) => r.problems.length);
  const wall = ((performance.now() - started) / 1000).toFixed(1);
  log('');
  log(`${'route'.padEnd(28)} ${'vp'.padEnd(5)} ${'ms'.padStart(6)}  status`);
  for (const r of rows) {
    log(
      `${r.route.padEnd(28)} ${String(r.vp).padEnd(5)} ${String(r.ms).padStart(6)}  ${r.problems.length ? 'FAIL' : 'ok'}`,
    );
  }
  for (const r of failed) {
    log(`\nFAIL ${r.route}-${r.vp}:`);
    for (const p of r.problems) log(`  - ${p}`);
  }
  const slow = rows
    .slice()
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5);
  log(
    `\n${rows.length} captures: ${rows.length - failed.length} ok, ${failed.length} failed. Wall time ${wall}s${opts.preview ? ' (preview mode, includes build)' : ''}.`,
  );
  log(`Slowest 5: ${slow.map((r) => `${r.route}-${r.vp} ${r.ms}ms`).join(', ')}`);
  log(`Output: ${outDir}`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((e) => {
    process.stderr.write(`shots: ${e.stack || e.message}\n`);
    process.exitCode = 1;
  });
