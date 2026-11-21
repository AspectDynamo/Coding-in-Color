import { describe, expect, it } from 'vitest';
import { isConfigured, parseConfig } from '../../../src/backend/config';
import type { Bindings } from '../../../src/backend/env';

const base = (o: Partial<Bindings> = {}): Bindings => ({
  SESSION_SECRET: 's'.repeat(40),
  CREDENTIAL_PEPPER: 'p'.repeat(40),
  ...o,
});

describe('production safety', () => {
  it('production without Supabase is not configured, even with DEMO_MODE=true', () => {
    const cfg = parseConfig(base({ APP_ENV: 'production', DEMO_MODE: 'true' }));
    expect(cfg.dataStore).toBe('none');
    expect(isConfigured(cfg)).toBe(false);
    expect(cfg.problems.join(' ')).toMatch(/production/i);
  });

  it('production with mistyped/missing Supabase secrets never falls back to memory', () => {
    const cfg = parseConfig(
      base({
        APP_ENV: 'production',
        DEMO_MODE: 'false',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: '',
      }),
    );
    expect(cfg.dataStore).toBe('none');
    expect(isConfigured(cfg)).toBe(false);
  });

  it('a public synthetic demo needs both DEMO_MODE=true and ALLOW_PUBLIC_DEMO=true', () => {
    expect(
      parseConfig(base({ APP_ENV: 'production', DEMO_MODE: 'true', ALLOW_PUBLIC_DEMO: 'false' }))
        .dataStore,
    ).toBe('none');
    expect(
      parseConfig(base({ APP_ENV: 'production', DEMO_MODE: 'false', ALLOW_PUBLIC_DEMO: 'true' }))
        .dataStore,
    ).toBe('none');
    const cfg = parseConfig(
      base({ APP_ENV: 'production', DEMO_MODE: 'true', ALLOW_PUBLIC_DEMO: 'true' }),
    );
    expect(cfg.dataStore).toBe('memory');
    expect(isConfigured(cfg)).toBe(true);
  });

  it('production with Supabase configured uses it', () => {
    const cfg = parseConfig(
      base({
        APP_ENV: 'production',
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      }),
    );
    expect(cfg.dataStore).toBe('supabase');
    expect(isConfigured(cfg)).toBe(true);
  });

  it('development keeps the zero-setup demo behaviour', () => {
    const cfg = parseConfig(base({ APP_ENV: 'development', DEMO_MODE: 'true' }));
    expect(cfg.dataStore).toBe('memory');
    expect(cfg.requireAdminMfa).toBe(false);
  });

  it('requireAdminMfa defaults to true in production unless explicitly "false"', () => {
    expect(parseConfig(base({ APP_ENV: 'production' })).requireAdminMfa).toBe(true);
    expect(
      parseConfig(base({ APP_ENV: 'production', REQUIRE_ADMIN_MFA: '' })).requireAdminMfa,
    ).toBe(true);
    expect(
      parseConfig(base({ APP_ENV: 'production', REQUIRE_ADMIN_MFA: 'false' })).requireAdminMfa,
    ).toBe(false);
    expect(
      parseConfig(base({ APP_ENV: 'development', REQUIRE_ADMIN_MFA: 'true' })).requireAdminMfa,
    ).toBe(true);
  });
});
