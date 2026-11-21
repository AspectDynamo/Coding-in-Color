import type { AppConfig } from '../config';
import type { Bindings } from '../env';
import { HttpError } from '../utils/errors';
import { getMemoryStore } from './memory-store';
import { getSupabaseStore } from './supabase-store';
import type { DataStore } from './types';

/**
 * Store selection (docs/architecture.md § 2):
 *  Supabase URL + service key → SupabaseStore; else DEMO_MODE=true → MemoryStore; else not configured.
 */
export async function getStore(_env: Bindings, config: AppConfig): Promise<DataStore> {
  if (config.dataStore === 'supabase') return getSupabaseStore(config);
  if (config.dataStore === 'memory') return await getMemoryStore(config);
  throw new HttpError(503, 'not_configured', 'This service is not configured yet.');
}

export type { DataStore } from './types';
export { resetMemoryStore } from './memory-store';
