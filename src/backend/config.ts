/**
 * Typed configuration parsed from the Worker environment. Parsing never throws; problems are
 * collected so health/config endpoints keep working and data routes answer 503 not_configured.
 */
import { DEFAULT_SUPPRESSION_THRESHOLD } from '@shared/constants';
import type { Bindings } from './env';
import { log } from './utils/logger';

export interface AppConfig {
  appEnv: 'development' | 'production';
  demoMode: boolean;
  /** Which store the data routes will use; 'none' => 503 not_configured. */
  dataStore: 'memory' | 'supabase' | 'none';
  sessionSecret: string;
  credentialPepper: string;
  /** Pepper before the last rotation (null when not rotating). Only used to look up older credentials. */
  credentialPepperPrevious: string | null;
  keyVersion: number;
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  supabaseServiceKey: string | null;
  aiModel: string;
  suppressionThreshold: number;
  allowUnder13: boolean;
  requireAdminMfa: boolean;
  allowedOrigins: string[];
  /** Human-readable reasons data routes are unavailable (never contains secret values). */
  problems: string[];
}

const MIN_SECRET_LENGTH = 32;
const cache = new WeakMap<object, AppConfig>();
let warnedProductionDemo = false;
let warnedProductionStore = false;

function bool(v: string | undefined, dflt = false): boolean {
  if (v === undefined || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
}
function posInt(v: string | undefined, dflt: number): number {
  if (v === undefined || v.trim() === '') return dflt;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}
function nonEmpty(v: string | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function parseConfig(env: Bindings): AppConfig {
  const hit = cache.get(env);
  if (hit) return hit;

  const problems: string[] = [];
  const sessionSecret = env.SESSION_SECRET ?? '';
  const credentialPepper = env.CREDENTIAL_PEPPER ?? '';
  if (sessionSecret.length < MIN_SECRET_LENGTH)
    problems.push('SESSION_SECRET must be at least 32 characters');
  if (credentialPepper.length < MIN_SECRET_LENGTH)
    problems.push('CREDENTIAL_PEPPER must be at least 32 characters');

  const credentialPepperPrevious = nonEmpty(env.CREDENTIAL_PEPPER_PREVIOUS);
  if (credentialPepperPrevious && credentialPepperPrevious.length < MIN_SECRET_LENGTH)
    problems.push('CREDENTIAL_PEPPER_PREVIOUS must be at least 32 characters when set');

  const appEnv = env.APP_ENV === 'production' ? 'production' : 'development';
  const demoMode = bool(env.DEMO_MODE);
  const supabaseUrl = nonEmpty(env.SUPABASE_URL);
  const supabaseServiceKey = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);

  let dataStore: AppConfig['dataStore'] = 'none';
  if (supabaseUrl && supabaseServiceKey) dataStore = 'supabase';
  else if (appEnv === 'production' && !(demoMode && bool(env.ALLOW_PUBLIC_DEMO))) {
    // Never fall back silently to the synthetic memory store in production: missing or mistyped
    // Supabase secrets must surface as 503 not_configured. A public synthetic demo deploy has to
    // opt in explicitly with BOTH DEMO_MODE=true and ALLOW_PUBLIC_DEMO=true.
    problems.push(
      'APP_ENV=production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the in-memory demo store needs DEMO_MODE=true and ALLOW_PUBLIC_DEMO=true)',
    );
    if (!warnedProductionStore) {
      warnedProductionStore = true;
      log('error', 'config.production_store_missing', {
        note: 'APP_ENV=production but no Supabase store is configured and the public demo is not enabled; data routes will answer 503 not_configured',
      });
    }
  } else if (demoMode) {
    dataStore = 'memory';
    if (appEnv === 'production' && !warnedProductionDemo) {
      warnedProductionDemo = true;
      log('warn', 'config.production_demo_store', {
        note: 'APP_ENV=production is serving the in-memory SYNTHETIC demo store because DEMO_MODE and ALLOW_PUBLIC_DEMO are true',
      });
    }
  } else problems.push('No data store configured (set Supabase secrets or DEMO_MODE=true)');

  const cfg: AppConfig = {
    appEnv,
    demoMode,
    dataStore,
    sessionSecret,
    credentialPepper,
    // Identical to the current pepper would only duplicate the lookup.
    credentialPepperPrevious:
      credentialPepperPrevious && credentialPepperPrevious !== credentialPepper
        ? credentialPepperPrevious
        : null,
    keyVersion: posInt(env.CREDENTIAL_KEY_VERSION, 1),
    supabaseUrl: supabaseUrl ? supabaseUrl.replace(/\/+$/, '') : null,
    supabaseAnonKey: nonEmpty(env.SUPABASE_ANON_KEY),
    supabaseServiceKey,
    aiModel: nonEmpty(env.AI_MODEL) ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    suppressionThreshold: posInt(env.SUPPRESSION_THRESHOLD, DEFAULT_SUPPRESSION_THRESHOLD),
    allowUnder13: bool(env.ALLOW_UNDER_13_REGISTRATION),
    // Secure by default in production; only an explicit REQUIRE_ADMIN_MFA=false turns it off there.
    requireAdminMfa: bool(env.REQUIRE_ADMIN_MFA, appEnv === 'production'),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    problems,
  };
  cache.set(env, cfg);
  return cfg;
}

export function isConfigured(cfg: AppConfig): boolean {
  return cfg.problems.length === 0 && cfg.dataStore !== 'none';
}
