/**
 * DemoStore Durable Object: hosts the ONE shared MemoryStore for demo deployments so every Worker
 * isolate sees the same students, attempts, submissions and AI reports. Reached through
 * createDurableDemoStore (demo-store-proxy.ts) via JS RPC. Synthetic data only.
 */
import { DurableObject } from 'cloudflare:workers';
import { parseConfig } from '../config';
import type { Bindings } from '../env';
import { MemoryStore } from './memory-store';
import { serializeError, type RpcResult } from './demo-store-proxy';

export class DemoStore extends DurableObject<Bindings> {
  private store: Promise<MemoryStore> | null = null;

  private getStore(): Promise<MemoryStore> {
    this.store ??= (async () => {
      const config = parseConfig(this.env);
      return MemoryStore.create(config.credentialPepper, config.keyVersion);
    })();
    return this.store;
  }

  async call(method: string, args: unknown[]): Promise<RpcResult> {
    try {
      if (method.startsWith('_') || method === 'constructor' || !Array.isArray(args)) {
        throw new Error('Unknown store method');
      }
      const store = (await this.getStore()) as unknown as Record<string, unknown>;
      const fn = store[method];
      if (typeof fn !== 'function') throw new Error('Unknown store method');
      return { ok: true, value: await fn.apply(store, args) };
    } catch (e) {
      return { ok: false, error: serializeError(e) };
    }
  }
}
