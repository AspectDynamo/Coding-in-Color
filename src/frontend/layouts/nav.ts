import type { Permission } from '@shared/types';
import type { StaffProfile } from '@shared/api';

export interface NavItem {
  to: string;
  label: string;
  permission: Permission;
  end?: boolean;
  section: 'Impact' | 'Teaching' | 'Manage';
}

export const NAV_ITEMS: NavItem[] = [
  {
    to: '/admin',
    label: 'Impact dashboard',
    permission: 'dashboard.view',
    end: true,
    section: 'Impact',
  },
  {
    to: '/admin/reports',
    label: 'AI reporting',
    permission: 'reports.ai',
    end: true,
    section: 'Impact',
  },
  {
    to: '/instructor',
    label: 'Sessions & cohorts',
    permission: 'sessions.manage',
    end: true,
    section: 'Teaching',
  },
  {
    to: '/instructor/cards',
    label: 'Access cards',
    permission: 'credentials.issue',
    section: 'Teaching',
  },
  {
    to: '/admin/students',
    label: 'Students',
    permission: 'students.view_individual',
    section: 'Manage',
  },
  {
    to: '/admin/consent',
    label: 'Consent',
    permission: 'consent.manage',
    section: 'Manage',
  },
  {
    to: '/admin/catalog',
    label: 'Programs & cohorts',
    permission: 'catalog.manage',
    section: 'Manage',
  },
  {
    to: '/admin/assessments',
    label: 'Assessments',
    permission: 'catalog.manage',
    section: 'Manage',
  },
  {
    to: '/admin/staff',
    label: 'Staff',
    permission: 'staff.manage',
    section: 'Manage',
  },
  {
    to: '/admin/audit',
    label: 'Audit log',
    permission: 'audit.view',
    section: 'Manage',
  },
];

/** Where a staff member lands after sign-in. */
export function homeFor(staff: Pick<StaffProfile, 'role' | 'permissions'>): string {
  if (staff.role === 'instructor' || !staff.permissions.includes('dashboard.view'))
    return '/instructor';
  return '/admin';
}
