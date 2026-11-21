// Applies supabase/migrations/*.sql in filename order to DATABASE_URL using `psql`, recording each
// applied file (with a SHA-256 checksum) in a `_migrations` table. Each file runs in a single
// transaction together with its bookkeeping row, so a failed migration leaves nothing half-applied.
//
// Alternative for Supabase projects: `supabase link` then `supabase db push` applies the same files
// with the Supabase CLI's own tracking (do not mix both trackers on one database).
//
// DATABASE_URL comes from the environment, then `.env`, then `.dev.vars`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const url = vars.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set (environment, .env or .dev.vars). Example: postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  );
  process.exit(1);
}

const baseArgs = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', url];

function psql(extra, opts = {}) {
  const res = spawnSync('psql', [...baseArgs, ...extra], { encoding: 'utf8', ...opts });
  if (res.error) {
    console.error(
      res.error.code === 'ENOENT'
        ? 'psql not found on PATH. Install PostgreSQL client tools.'
        : String(res.error),
    );
    process.exit(1);
  }
  return res;
}

const init = psql([
  '-c',
  `create table if not exists public._migrations (
     name text primary key,
     checksum text not null,
     applied_at timestamptz not null default now()
   );
   alter table public._migrations enable row level security;`,
]);
if (init.status !== 0) {
  console.error(init.stderr);
  process.exit(init.status ?? 1);
}

const applied = new Map();
const listed = psql(['-At', '-F', '|', '-c', 'select name, checksum from public._migrations']);
if (listed.status !== 0) {
  console.error(listed.stderr);
  process.exit(listed.status ?? 1);
}
for (const line of listed.stdout.split('\n')) {
  if (!line) continue;
  const [name, checksum] = line.split('|');
  applied.set(name, checksum);
}

const dir = resolve(root, 'supabase/migrations');
const files = readdirSync(dir)
  .filter((f) => /^[A-Za-z0-9._-]+\.sql$/.test(f))
  .sort();
let ran = 0;
for (const file of files) {
  const path = resolve(dir, file);
  const checksum = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (applied.has(file)) {
    if (applied.get(file) !== checksum) {
      console.error(
        `Migration ${file} was modified after being applied (checksum mismatch). Add a new migration instead.`,
      );
      process.exit(1);
    }
    console.log(`skip   ${file}`);
    continue;
  }
  console.log(`apply  ${file}`);
  // -1 runs every -f/-c below in ONE transaction.
  const res = psql([
    '-1',
    '-f',
    path,
    '-c',
    `insert into public._migrations (name, checksum) values ('${file}', '${checksum}')`,
  ]);
  if (res.status !== 0) {
    console.error(res.stderr);
    console.error(`Migration ${file} failed; its transaction was rolled back.`);
    process.exit(res.status ?? 1);
  }
  ran += 1;
}
console.log(ran === 0 ? 'Database is up to date.' : `Applied ${ran} migration(s).`);
