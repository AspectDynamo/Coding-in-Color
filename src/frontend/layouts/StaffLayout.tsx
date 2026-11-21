import { Suspense, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { Menu } from 'lucide-react';
import type { Permission } from '@shared/types';
import {
  Button,
  ButtonLink,
  Dialog,
  ErrorState,
  LoadingBlock,
  Skeleton,
  Wordmark,
  useDocumentTitle,
  useToast,
} from '@frontend/components/ui';
import { IssuedCardsProvider, StaffProvider } from '@frontend/hooks/providers';
import { useStaff } from '@frontend/hooks/contexts';
import { errorMessage } from '@frontend/services/api';
import { ROLE_LABELS } from '@frontend/lib/format';
import { LostFigure } from '@frontend/components/illustrations';
import { NAV_ITEMS, homeFor, type NavItem } from './nav';

/** Provides staff auth to /staff/login and every staff page. */
export function StaffArea() {
  return (
    <StaffProvider>
      <IssuedCardsProvider>
        <Outlet />
      </IssuedCardsProvider>
    </StaffProvider>
  );
}

function PageFallback() {
  return (
    <LoadingBlock label="Loading page…">
      <div className="rule-heavy space-y-6 pt-6">
        <Skeleton className="h-12 w-80 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <div className="grid gap-6 border-t border-rule pt-6 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
        <Skeleton lines={6} />
      </div>
    </LoadingBlock>
  );
}

const SECTIONS = ['Impact', 'Teaching', 'Manage'] as const;

/** Contents-page navigation: numbered text entries under three group heads. */
function IndexList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const ordered = SECTIONS.flatMap((section) => items.filter((i) => i.section === section));
  const numberOf = new Map(ordered.map((item, i) => [item.to, String(i + 1).padStart(2, '0')]));
  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => {
        const list = items.filter((i) => i.section === section);
        if (list.length === 0) return null;
        return (
          <div key={section}>
            <p className="index-group">{section}</p>
            <ul>
              {list.map((item) => {
                return (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className="index-link"
                      onClick={onNavigate}
                    >
                      <span className="index-no" aria-hidden="true">
                        {numberOf.get(item.to)}
                      </span>
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function StaffLayout() {
  const { staff, loading, error, retry, logout, can } = useStaff();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  if (loading) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl p-6">
        <PageFallback />
      </main>
    );
  }
  if (error) {
    return (
      <main id="main" tabIndex={-1} className="mx-auto max-w-xl p-6">
        <ErrorState
          title="We couldn’t check your sign-in"
          message={errorMessage(error)}
          onRetry={retry}
        />
      </main>
    );
  }
  if (!staff) {
    return (
      <Navigate to="/staff/login" replace state={{ from: location.pathname + location.search }} />
    );
  }

  const items = NAV_ITEMS.filter((i) => can(i.permission));
  // Instructors have one area, so the index collapses into a slim masthead and the sheet gets
  // the full width (their sessions table needs it).
  const masthead = items.every((i) => i.section === 'Teaching');
  const signOut = async () => {
    setSigningOut(true);
    await logout().catch(() => undefined);
    setSigningOut(false);
    toast.show('You’re signed out.');
    navigate('/staff/login', { replace: true });
  };

  const profile = (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold text-ink">{staff.displayName}</p>
      <p className="t-caption flex flex-wrap items-center gap-1.5">
        {ROLE_LABELS[staff.role]}
        {staff.isSynthetic && <span className="bg-yellow px-1 font-semibold text-ink">Demo</span>}
      </p>
    </div>
  );
  const home = (
    <Link to={homeFor(staff)} aria-label="Coding in Color Impact — home" className="inline-flex">
      <Wordmark size={28} />
    </Link>
  );
  const signOutButton = (
    <Button size="sm" onClick={() => void signOut()} loading={signingOut}>
      Sign out
    </Button>
  );

  return (
    <div
      className={masthead ? undefined : 'lg:grid lg:min-h-dvh lg:grid-cols-[13.5rem_minmax(0,1fr)]'}
    >
      {masthead ? (
        <div className="no-print hidden border-b border-ink lg:block">
          <div className="mx-auto flex max-w-[84rem] items-center gap-8 px-8 2xl:px-12">
            <div className="py-3">{home}</div>
            <nav aria-label="Main" className="flex flex-1 items-center gap-6 self-stretch">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className="mast-link self-stretch"
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="flex items-center gap-4 py-2">
              <div className="text-right">{profile}</div>
              {signOutButton}
            </div>
          </div>
        </div>
      ) : (
        <aside className="no-print hidden border-r border-ink lg:block">
          <div className="sticky top-0 flex h-dvh flex-col gap-8 overflow-y-auto py-5">
            <div className="px-3">{home}</div>
            <nav aria-label="Main" className="flex-1">
              <IndexList items={items} />
            </nav>
            <div className="space-y-3 border-t border-rule px-3 pt-4">
              {profile}
              {signOutButton}
            </div>
          </div>
        </aside>
      )}

      <div className="min-w-0">
        {/* Top bar below 1024px: mark + a button that opens the full-screen index. */}
        <div className="no-print sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-ink bg-paper px-4 py-2 sm:px-6 lg:hidden">
          {home}
          <Button
            size="sm"
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            icon={<Menu size={16} aria-hidden="true" />}
            onClick={() => setMenuOpen(true)}
          >
            Index
          </Button>
        </div>
        <Dialog open={menuOpen} onClose={() => setMenuOpen(false)} title="Index" size="full">
          <nav aria-label="Main" className="mb-8 mt-4">
            <IndexList items={items} onNavigate={() => setMenuOpen(false)} />
          </nav>
          <div className="flex items-center justify-between gap-4 border-t border-ink pt-4">
            {profile}
            {signOutButton}
          </div>
        </Dialog>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-[84rem] px-4 pb-20 pt-6 sm:px-6 lg:px-8 lg:pt-8 2xl:px-12"
        >
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/** UI convenience only — the API enforces permissions. Shows a friendly 403 page. */
export function Require({
  permission,
  children,
}: {
  permission: Permission | Permission[];
  children: ReactNode;
}) {
  const { can } = useStaff();
  const list = Array.isArray(permission) ? permission : [permission];
  if (!list.some((p) => can(p))) return <Forbidden />;
  return <>{children}</>;
}

export function Forbidden() {
  const { staff } = useStaff();
  useDocumentTitle('No access');
  return (
    <div
      className="rule-heavy grid max-w-4xl gap-8 pt-6 sm:grid-cols-[1fr_auto]"
      data-testid="forbidden-page"
    >
      <div>
        <p className="t-figure text-[clamp(4rem,14vw,7.5rem)] text-ink">403</p>
        <h1 className="t-h2 mt-4" tabIndex={-1} data-page-heading>
          This page isn’t part of your role
        </h1>
        <p className="t-lede mt-3">
          {staff ? `You’re signed in as ${ROLE_LABELS[staff.role].toLowerCase()}. ` : ''}
          Some areas — like individual student records — are limited to protect student privacy. If
          you need access, ask an owner of this workspace.
        </p>
        <div className="mt-6">
          <ButtonLink variant="primary" to={staff ? homeFor(staff) : '/'}>
            Go to my home page
          </ButtonLink>
        </div>
      </div>
      <LostFigure className="order-first h-28 w-28 sm:order-none sm:h-44 sm:w-44" />
    </div>
  );
}
