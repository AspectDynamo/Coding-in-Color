/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../../src/backend/config';
import type { Bindings } from '../../../src/backend/env';
import { findCredentialForCode, hashAccessCode } from '../../../src/backend/services/credentials';

const NEW = 'n'.repeat(40);
const OLD = 'o'.repeat(40);
const CODE = '0123456789ABCDEF';

/** Fake store: a map of hash -> key_version that records every lookup. */
function fakeStore(rows: Record<string, number>) {
  const lookups: string[] = [];
  const store = {
    async findCredentialByHash(hash: string) {
      lookups.push(hash);
      const v = rows[hash];
      return v === undefined
        ? null
        : ({
            credential: { id: 'c', key_version: v, credential_hash: hash },
            student: { id: 's' },
          } as any);
    },
  };
  return { store: store as any, lookups };
}

const cfg = (version: number, previous: string | null) => ({
  credentialPepper: NEW,
  credentialPepperPrevious: previous,
  keyVersion: version,
});

describe('config', () => {
  const base: Bindings = {
    SESSION_SECRET: 's'.repeat(40),
    CREDENTIAL_PEPPER: NEW,
    DEMO_MODE: 'true',
  };
  it('reads the optional previous pepper and key version', () => {
    const c = parseConfig({
      ...base,
      CREDENTIAL_PEPPER_PREVIOUS: OLD,
      CREDENTIAL_KEY_VERSION: '3',
    });
    expect(c.credentialPepperPrevious).toBe(OLD);
    expect(c.keyVersion).toBe(3);
  });
  it('is null when unset, blank or equal to the current pepper', () => {
    expect(parseConfig({ ...base }).credentialPepperPrevious).toBeNull();
    expect(
      parseConfig({ ...base, CREDENTIAL_PEPPER_PREVIOUS: '  ' }).credentialPepperPrevious,
    ).toBeNull();
    expect(
      parseConfig({ ...base, CREDENTIAL_PEPPER_PREVIOUS: NEW }).credentialPepperPrevious,
    ).toBeNull();
  });
  it('flags a too-short previous pepper without echoing it', () => {
    const c = parseConfig({ ...base, CREDENTIAL_PEPPER_PREVIOUS: 'short' });
    expect(c.problems.join(' ')).toMatch(/CREDENTIAL_PEPPER_PREVIOUS/);
    expect(c.problems.join(' ')).not.toContain('short');
  });
});

describe('findCredentialForCode', () => {
  it('finds current-pepper credentials, and still does both lookups', async () => {
    const cur = await hashAccessCode(CODE, NEW);
    const old = await hashAccessCode(CODE, OLD);
    const { store, lookups } = fakeStore({ [cur]: 2 });
    const found = await findCredentialForCode(store, CODE, cfg(2, OLD));
    expect(found?.credential.credential_hash).toBe(cur);
    expect(lookups.sort()).toEqual([cur, old].sort());
  });

  it('falls back to the previous pepper for credentials with a lower key_version', async () => {
    const old = await hashAccessCode(CODE, OLD);
    const { store } = fakeStore({ [old]: 1 });
    const found = await findCredentialForCode(store, CODE, cfg(2, OLD));
    expect(found?.credential.credential_hash).toBe(old);
  });

  it('rejects a previous-pepper hash whose key_version is not lower than the current one', async () => {
    const old = await hashAccessCode(CODE, OLD);
    expect(
      await findCredentialForCode(fakeStore({ [old]: 2 }).store, CODE, cfg(2, OLD)),
    ).toBeNull();
    expect(
      await findCredentialForCode(fakeStore({ [old]: 3 }).store, CODE, cfg(2, OLD)),
    ).toBeNull();
  });

  it('ignores previous-pepper credentials when no previous pepper is configured', async () => {
    const old = await hashAccessCode(CODE, OLD);
    const { store, lookups } = fakeStore({ [old]: 1 });
    expect(await findCredentialForCode(store, CODE, cfg(2, null))).toBeNull();
    expect(lookups).toHaveLength(1);
  });

  it('prefers the current-pepper match when both exist', async () => {
    const cur = await hashAccessCode(CODE, NEW);
    const old = await hashAccessCode(CODE, OLD);
    const found = await findCredentialForCode(
      fakeStore({ [cur]: 2, [old]: 1 }).store,
      CODE,
      cfg(2, OLD),
    );
    expect(found?.credential.credential_hash).toBe(cur);
  });

  it('returns null for an unknown code', async () => {
    expect(await findCredentialForCode(fakeStore({}).store, CODE, cfg(2, OLD))).toBeNull();
  });
});
