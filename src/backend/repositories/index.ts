import type { AppConfig } from '../config';
import type { Bindings } from '../env';
import { HttpError } from '../utils/errors';
import { createDurableDemoStore, type DemoStoreNamespace } from './demo-store-proxy';
import { getMemoryStore } from './memory-store';
import { getSupabaseStore } from './supabase-store';
import type { DataStore } from './types';

/**
 * Store selection (docs/architecture.md § 2):
 *  Supabase URL + service key → SupabaseStore; else DEMO_MODE=true → MemoryStore (in the DemoStore
 *  Durable Object when env.DEMO_STORE is bound, else per-isolate); else not configured.
 */
export async function getStore(env: Bindings, config: AppConfig): Promise<DataStore> {
  if (config.dataStore === 'supabase') return getSupabaseStore(config);
  if (config.dataStore === 'memory') {
    // Deployed/dev demo: one shared MemoryStore in a Durable Object. No binding (tests): local one.
    if (env.DEMO_STORE) return createDurableDemoStore(env.DEMO_STORE);
    return await getMemoryStore(config);
  }
  throw new HttpError(503, 'not_configured', 'This service is not configured yet.');
}

export type { DataStore } from './types';
export { resetMemoryStore } from './memory-store';
