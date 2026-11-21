// Creates .dev.vars for local development if it does not exist. Never overwrites an existing file.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const target = resolve(root, '.dev.vars');
const example = resolve(root, '.dev.vars.example');

if (existsSync(target)) {
  console.log('.dev.vars already exists; leaving it unchanged.');
  process.exit(0);
}

const secret = () => randomBytes(32).toString('base64url');
let content = readFileSync(example, 'utf8');
content = content
  .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret()}`)
  .replace(/^CREDENTIAL_PEPPER=.*$/m, `CREDENTIAL_PEPPER=${secret()}`);

writeFileSync(target, content, { flag: 'wx' });
console.log('Created .dev.vars with generated SESSION_SECRET and CREDENTIAL_PEPPER.');
console.log('Supabase values are blank: the app will use the in-memory synthetic demo store.');
