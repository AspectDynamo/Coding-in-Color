import { describe, expect, it } from 'vitest';
import { DemoStore } from '../../../src/backend/repositories/demo-store-do';
import { createDurableDemoStore } from '../../../src/backend/repositories/demo-store-proxy';
import { demoUuid } from '../../../src/backend/demo/prng';
import { MemoryStore } from '../../../src/backend/repositories/memory-store';
import { HttpError, StoreError } from '../../../src/backend/utils/errors';

const PEPPER = 'test-credential-pepper-0123456789abcdef-0123456789';

// Fake namespace: real DemoStore object, args/results cloned like Workers RPC.
function fakeNamespace() {
  const obj = new DemoStore({} as never, { CREDENTIAL_PEPPER: PEPPER, SESSION_SECRET: 'x'.repeat(40) });
  return {
    idFromName: (n: string) => n,
    get: () => ({
      call: async (m: string, a: unknown[]) =>
        structuredClone(await obj.call(m, structuredClone(a))),
    }),
  };
}

describe('durable demo store proxy', () => {
  it('round-trips calls, rebuilds domain errors, rejects bad names, answers kind locally', async () => {
    const store = createDurableDemoStore(fakeNamespace() as never);
    expect(store.kind).toBe('memory');
    expect(await Promise.resolve(store)).toBe(store); // not a thenable

    const programs = await store.listPrograms();
    expect(programs.length).toBeGreaterThan(0);

    await expect(store.getAttempt('00000000-0000-4000-8000-000000000000')).resolves.toBeNull();
    // Domain error: submitting an unknown attempt -> StoreError('attempt_not_found').
    const err = await store
      .submitAttempt({ attemptId: '00000000-0000-4000-8000-000000000000' } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StoreError);
    expect((err as StoreError).code).toBe('attempt_not_found');

    const ns = fakeNamespace();
    const raw = ns.get();
    for (const m of ['constructor', '_x', 'nope', 'd']) {
      const r = await raw.call(m, []);
      expect(r.ok).toBe(false);
    }
    const http = new HttpError(409, 'conflict', 'x');
    expect(http.status).toBe(409);
  });

  it('seeded credential ids are deterministic', async () => {
    const a = await MemoryStore.create(PEPPER, 1);
    const b = await MemoryStore.create(PEPPER, 1);
    const hash = (await import('../../../src/backend/services/credentials')).hashAccessCode;
    const h = await hash('DEMAFRSHPRE02026', PEPPER);
    const ca = await a.findCredentialByHash(h);
    const cb = await b.findCredentialByHash(h);
    expect(ca?.credential.id).toBe(cb?.credential.id);
    expect(ca?.credential.id).toBe(demoUuid('credential', ca!.student.id));
  });
});
