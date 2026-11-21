import { mkdirSync } from 'node:fs';
import type { FullConfig } from '@playwright/test';
import { AUTH_DIR, apiLogin, authFile, type DemoRole } from './helpers';

/**
 * Signs in once per demo role and saves the cookies. Tests that are not about the login screen
 * reuse these, which keeps the whole suite under the staff login rate limit (10 per minute).
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:5173';
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const role of ['instructor', 'admin'] satisfies DemoRole[]) {
    const ctx = await apiLogin(baseURL, role);
    await ctx.storageState({ path: authFile(role) });
    await ctx.dispose();
  }
}
