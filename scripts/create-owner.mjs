// Bootstraps the first owner: invites the user through Supabase Auth (admin invite email) and inserts the
// matching staff_users row (role owner, status invited) with the service-role key.
//
//   node scripts/create-owner.mjs --email you@org.org --name "Display Name" [--force]
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment or .dev.vars (environment wins).
// Refuses when an owner already exists unless --force is passed. Never prints the service key.
// The invitee follows the emailed link to set a password; the first successful login moves the row from
// "invited" to "active".
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

function fail(msg) {
  console.error(`create-owner: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--email' || a === '--name') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) fail(`${a} needs a value`);
      args[a.slice(2)] = v;
    } else if (a.startsWith('--email=')) args.email = a.slice(8);
    else if (a.startsWith('--name=')) args.name = a.slice(7);
    else fail(`unknown argument ${a}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const email = (args.email ?? '').trim();
const name = (args.name ?? '').trim();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
  fail('--email must be a valid email address');
if (name.length < 1 || name.length > 80) fail('--name must be 1 to 80 characters');

const vars = { ...readVars(resolve(root, '.dev.vars')), ...process.env };
const baseUrl = (vars.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const key = (vars.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
if (!baseUrl || !key)
  fail('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (environment or .dev.vars)');
if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl))
  fail('SUPABASE_URL must be an https URL');

const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

/** fetch that never leaks headers; surfaces only status and Supabase's own error code/message. */
async function api(label, path, init) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } });
  } catch {
    fail(`${label}: could not reach Supabase`);
  }
  let json = null;
  const text = await res.text();
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = json?.error_code ?? json?.code ?? json?.msg ?? json?.message ?? '';
    fail(
      `${label} failed (HTTP ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ''})`,
    );
  }
  return json;
}

// 1. Refuse if an owner already exists.
const owners = await api('owner check', '/rest/v1/staff_users?role=eq.owner&select=id&limit=1', {
  method: 'GET',
});
if (Array.isArray(owners) && owners.length > 0 && !args.force)
  fail(
    'an owner already exists. Invite more staff from the admin UI, or pass --force to add another owner.',
  );

// 2. Invite through Supabase Auth (sends the invite email).
const invited = await api('invite', '/auth/v1/invite', {
  method: 'POST',
  body: JSON.stringify({ email }),
});
const authUserId = invited?.id;
if (typeof authUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(authUserId))
  fail('invite succeeded but returned no user id');

// 3. Matching staff row.
await api('staff_users insert', '/rest/v1/staff_users', {
  method: 'POST',
  headers: { Prefer: 'return=minimal' },
  body: JSON.stringify({
    auth_user_id: authUserId,
    display_name: name,
    role: 'owner',
    status: 'invited',
    is_synthetic: false,
  }),
});

console.log(`Invited ${email} as owner "${name}" (staff status: invited).`);
console.log('They should open the invitation email, set a password, then sign in at /staff/login.');
console.log(
  'With MFA required (production), the first sign-in walks them through authenticator setup.',
);
