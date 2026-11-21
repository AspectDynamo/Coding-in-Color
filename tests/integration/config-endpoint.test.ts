import { beforeEach, describe, expect, it } from 'vitest';
import { Client, freshState, makeEnv } from './helpers';

beforeEach(freshState);

describe('GET /config', () => {
  it('memory demo store: demo login on, AI follows the binding', async () => {
    const c = new Client(makeEnv());
    const r = await c.get('/config');
    expect(r.body.data).toMatchObject({
      dataStore: 'memory',
      demoLoginEnabled: true,
      aiEnabled: false,
    });
    const withAi = new Client({ ...makeEnv(), AI: { run: async () => ({}) } });
    expect((await withAi.get('/config')).body.data.aiEnabled).toBe(true);
  });

  it('no store configured: does not claim supabase, and disables demo login and AI', async () => {
    const env = {
      ...makeEnv({ APP_ENV: 'production', DEMO_MODE: 'false' }),
      AI: { run: async () => ({}) },
    };
    const r = await new Client(env).get('/config');
    expect(r.body.data.dataStore).not.toBe('supabase');
    expect(r.body.data.demoLoginEnabled).toBe(false);
    expect(r.body.data.aiEnabled).toBe(false);
  });

  it('supabase configured: reports supabase, no demo login', async () => {
    const env = makeEnv({
      SUPABASE_URL: 'https://proj.supabase.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-key-for-tests-0123456789',
      SUPABASE_ANON_KEY: 'anon',
    });
    const r = await new Client(env).get('/config');
    expect(r.body.data).toMatchObject({ dataStore: 'supabase', demoLoginEnabled: false });
  });
});
