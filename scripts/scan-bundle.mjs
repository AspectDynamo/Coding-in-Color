// Fails (exit 1) when the built client bundle (dist/client) contains a secret name or a secret value.
// Run after `npm run build`. Prints only which file and which check matched, never a secret value.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, process.argv[2] ?? 'dist/client');

const FORBIDDEN_NAMES = [
  'SESSION_SECRET',
  'CREDENTIAL_PEPPER',
  'SUPABASE_SERVICE_ROLE_KEY',
  'service_role',
];

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

if (!existsSync(dir)) {
  console.error(`scan-bundle: ${relative(root, dir)} not found. Run "npm run build" first.`);
  process.exit(1);
}

// Non-empty values from .dev.vars. Very short values (e.g. "1", "true") would match everywhere and
// are not secrets, so only values of 8+ characters are searched for; names are always checked.
const secretValues = Object.entries(readVars(resolve(root, '.dev.vars')))
  .filter(([, v]) => v.length >= 8)
  .map(([k, v]) => ({ name: k, value: v }));

function* walk(d) {
  for (const entry of readdirSync(d)) {
    const p = join(d, entry);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (st.isFile()) yield p;
  }
}

const findings = [];
let scanned = 0;
for (const file of walk(dir)) {
  const buf = readFileSync(file);
  // latin1 keeps a 1:1 byte mapping, so binary assets are scanned too without decode errors.
  const text = buf.toString('latin1');
  scanned++;
  for (const n of FORBIDDEN_NAMES)
    if (text.includes(n)) findings.push(`${relative(root, file)}: contains the name ${n}`);
  for (const { name, value } of secretValues) {
    if (text.includes(Buffer.from(value, 'utf8').toString('latin1')))
      findings.push(`${relative(root, file)}: contains the value of ${name} from .dev.vars`);
  }
}

if (findings.length) {
  console.error('scan-bundle: FAILED. Secrets must never reach the browser bundle.');
  for (const f of findings) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `scan-bundle: OK (${scanned} files in ${relative(root, dir)} checked; no secret names or values).`,
);
