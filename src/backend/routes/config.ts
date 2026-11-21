import { Hono } from 'hono';
import type { PublicConfig } from '@shared/api';
import type { AppEnv } from '../env';
import { isConfigured } from '../config';
import { ok } from '../utils/http';

export const configRoutes = new Hono<AppEnv>();

configRoutes.get('/health', (c) => ok(c, { ok: true, configured: isConfigured(c.get('config')) }));

configRoutes.get('/config', (c) => {
  const cfg = c.get('config');
  const dto: PublicConfig = {
    appEnv: cfg.appEnv,
    demoMode: cfg.demoMode,
    // The contract type has no "none"; with no store configured, report the least capable one
    // ('memory') and switch the store-dependent features off. 'supabase' only when it is configured.
    dataStore: cfg.dataStore === 'supabase' ? 'supabase' : 'memory',
    demoLoginEnabled: cfg.dataStore === 'memory' && isConfigured(cfg),
    under13RegistrationEnabled: cfg.allowUnder13,
    aiEnabled: cfg.dataStore !== 'none' && isConfigured(cfg) && !!c.env?.AI,
    suppressionThreshold: cfg.suppressionThreshold,
  };
  return ok(c, dto);
});
