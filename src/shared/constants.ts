/**
 * Shared constants: role → permission matrix, thresholds, scoring convention. Owned by the lead.
 */
import type { Permission, StaffRole } from './types';

export const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: [
    'dashboard.view',
    'students.view_individual',
    'students.manage',
    'catalog.manage',
    'sessions.manage',
    'credentials.issue',
    'consent.manage',
    'reports.export',
    'reports.ai',
    'staff.manage',
    'audit.view',
  ],
  admin: [
    'dashboard.view',
    'students.view_individual',
    'students.manage',
    'catalog.manage',
    'sessions.manage',
    'credentials.issue',
    'consent.manage',
    'reports.export',
    'reports.ai',
    'audit.view',
  ],
  // Analysts see aggregates only — never individual student records.
  analyst: ['dashboard.view', 'reports.export', 'reports.ai'],
  // Instructors are scoped to their assigned programs for sessions/credentials.
  instructor: ['sessions.manage', 'credentials.issue'],
};

/** Roles whose program scope is limited to staff_program_assignments. */
export const PROGRAM_SCOPED_ROLES: readonly StaffRole[] = ['instructor'];

export const DEFAULT_SUPPRESSION_THRESHOLD = 10;

export const STUDENT_SESSION_TTL_SECONDS = 4 * 60 * 60; // 4h
export const STAFF_SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h absolute

export const ACCESS_CODE_LENGTH = 16; // Crockford base32 chars ≈ 80 bits
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CURRENT_PRIVACY_NOTICE_VERSION = '2026-11-v1';

export const AI_PROMPT_VERSION = 'impact-summary-v1';

/**
 * Scoring convention (single source of truth — see docs/architecture.md § Scoring):
 *  - Auto-scored items earn 0..points. All-or-nothing, except multiple_select which earns
 *    points * max(0, (correctSelected − incorrectSelected) / totalCorrect).
 *  - Skipped/unanswered items earn 0 and still count toward max_score.
 *  - confidence_likert earns 0, is excluded from max_score, and feeds self_reported_confidence.
 *  - project_rubric is excluded from assessment scores entirely.
 *  - percentage_score = round(100 * raw_score / max_score, 2).
 *  - Skill sub-score % = round(100 * earned / max, 2) over that skill's auto-scored items.
 */
export const SCORE_DECIMALS = 2;

export const SCORE_BUCKETS = ['0-19', '20-39', '40-59', '60-79', '80-100'] as const;
export const CHANGE_BUCKETS = ['≤ -20', '-19 to -1', '0', '1 to 19', '20 to 39', '≥ 40'] as const;

export const STANDARD_LIMITATIONS = [
  'Results describe matched participants who completed both a pre- and post-assessment in the same cohort; students who missed either are not included.',
  'This is a pre/post design without a comparison group. Observed improvement is not, by itself, evidence that the program caused the change.',
  'Pre- and post-assessments use equivalent (not identical) forms designed to measure the same skills.',
  'Self-reported confidence is shown separately and is not a measure of knowledge or skill.',
] as const;
