/**
 * Proxy DataStore that forwards every method to the single DemoStore Durable Object (see
 * demo-store-do.ts), so all Worker isolates share one in-memory demo dataset. Workers RPC drops
 * custom error classes, so the DO returns a serialisable result envelope and this proxy re-throws
 * the same StoreError / HttpError classes the routes already handle.
 */
import { HttpError, StoreError, type StoreErrorCode } from '../utils/errors';
import type { DataStore } from './types';

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  status?: number;
  details?: unknown;
  headers?: Record<string, string>;
}
export type RpcResult = { ok: true; value: unknown } | { ok: false; error: SerializedError };

/** The slice of the DO stub the proxy needs (the real stub satisfies it via JS RPC). */
export interface DemoStoreStub {
  call(method: string, args: unknown[]): Promise<RpcResult>;
}
export interface DemoStoreNamespace {
  idFromName(name: string): unknown;
  get(id: never): DemoStoreStub;
}

export function serializeError(e: unknown): SerializedError {
  if (e instanceof HttpError) {
    return {
      name: 'HttpError',
      message: e.message,
      code: e.code,
      status: e.status,
      details: e.details,
      headers: e.headers,
    };
  }
  if (e instanceof StoreError) return { name: 'StoreError', message: e.message, code: e.code };
  const err = e as { name?: unknown; message?: unknown } | null;
  return {
    name: typeof err?.name === 'string' ? err.name : 'Error',
    message: typeof err?.message === 'string' ? err.message : 'Demo store failure',
  };
}

export function deserializeError(s: SerializedError): Error {
  if (s.name === 'StoreError') return new StoreError(s.code as StoreErrorCode, s.message);
  if (s.name === 'HttpError') {
    return new HttpError(
      s.status ?? 500,
      (s.code ?? 'internal') as ConstructorParameters<typeof HttpError>[1],
      s.message,
      s.details,
      s.headers,
    );
  }
  const err = new Error(s.message);
  err.name = s.name;
  return err;
}

export function createDurableDemoStore(namespace: DemoStoreNamespace): DataStore {
  const stub = () => namespace.get(namespace.idFromName('demo') as never);
  const methods = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  return new Proxy({ kind: 'memory' } as unknown as DataStore, {
    get(target, prop) {
      if (prop === 'kind') return 'memory';
      // Symbols and 'then' must stay undefined or `await getStore()` would treat us as a thenable.
      if (typeof prop !== 'string' || prop === 'then' || prop.startsWith('_')) return undefined;
      let fn = methods.get(prop);
      if (!fn) {
        fn = async (...args: unknown[]) => {
          const res = await stub().call(prop, args);
          if (res.ok) return res.value;
          throw deserializeError(res.error);
        };
        methods.set(prop, fn);
      }
      return fn;
    },
  });
}
