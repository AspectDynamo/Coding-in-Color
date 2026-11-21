// Generates supabase/seed.sql from the synthetic demo dataset and loads it into DATABASE_URL.
// Refuses to run when APP_ENV=production. Demo/development databases only: the seed TRUNCATEs all
// application tables (and aborts if any non-synthetic student or staff row exists).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function readVars(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const vars = {
  ...readVars(resolve(root, '.dev.vars')),
  ...readVars(resolve(root, '.env')),
  ...process.env,
};

if ((vars.APP_ENV ?? '').toLowerCase() === 'production') {
  console.error('Refusing to seed synthetic demo data: APP_ENV=production.');
  process.exit(1);
}
if (!vars.DATABASE_URL) {
  console.error('DATABASE_URL is not set (environment, .env or .dev.vars).');
  process.exit(1);
}

const tsx = resolve(root, 'node_modules/.bin/tsx');
const gen = spawnSync(
  existsSync(tsx) ? tsx : 'npx',
  existsSync(tsx) ? ['scripts/generate-seed.ts'] : ['tsx', 'scripts/generate-seed.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  },
);
if (gen.status !== 0) process.exit(gen.status ?? 1);

const load = spawnSync(
  'psql',
  [
    '-X',
    '-q',
    '-v',
    'ON_ERROR_STOP=1',
    vars.DATABASE_URL,
    '-f',
    resolve(root, 'supabase/seed.sql'),
  ],
  {
    stdio: 'inherit',
  },
);
if (load.error) {
  console.error(
    load.error.code === 'ENOENT'
      ? 'psql not found on PATH. Install PostgreSQL client tools.'
      : String(load.error),
  );
  process.exit(1);
}
if (load.status !== 0) process.exit(load.status ?? 1);
console.log('Seeded synthetic demo data.');
