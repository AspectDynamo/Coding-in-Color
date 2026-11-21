/**
 * Worker environment + Hono context typing. `Env` (worker-configuration.d.ts) carries literal var
 * types for the checked-in wrangler vars; tests and other deployments pass arbitrary strings, so
 * the backend reads everything through this loose `Bindings` shape.
 */
import type { AppConfig } from './config';
import type { DemoStoreNamespace } from './repositories/demo-store-proxy';
import type { DataStore } from './repositories/types';
import type { StaffRole, Permission, AgeBand, StudentStatus } from '@shared/types';

export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
export interface AiBinding {
  run(model: string, input: unknown, options?: unknown): Promise<unknown>;
}

export interface Bindings {
  AI?: AiBinding;
  STUDENT_LOGIN_LIMITER?: RateLimitBinding;
  STAFF_LOGIN_LIMITER?: RateLimitBinding;
  AI_LIMITER?: RateLimitBinding;
  /** Durable Object namespace hosting the shared demo MemoryStore (demo config only). */
  DEMO_STORE?: DemoStoreNamespace;
  APP_ENV?: string;
  DEMO_MODE?: string;
  ALLOW_PUBLIC_DEMO?: string;
  AI_MODEL?: string;
  SUPPRESSION_THRESHOLD?: string;
  ALLOW_UNDER_13_REGISTRATION?: string;
  REQUIRE_ADMIN_MFA?: string;
  CREDENTIAL_KEY_VERSION?: string;
  ALLOWED_ORIGINS?: string;
  SESSION_SECRET?: string;
  CREDENTIAL_PEPPER?: string;
  /** Optional: the pepper before the last rotation. Sign-in also tries it for credentials with a lower key_version. */
  CREDENTIAL_PEPPER_PREVIOUS?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface StudentAuth {
  id: string;
  credentialId: string;
  publicCode: string;
  ageBand: AgeBand;
  status: StudentStatus;
}

export interface StaffAuth {
  id: string;
  displayName: string;
  role: StaffRole;
  permissions: Permission[];
  programIds: string[];
  isSynthetic: boolean;
}

export interface Variables {
  requestId: string;
  config: AppConfig;
  store: DataStore;
  csrfToken: string;
  student?: StudentAuth;
  staff?: StaffAuth;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
