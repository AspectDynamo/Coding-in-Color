import { useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { DemoBanner, ToastProvider } from '@frontend/components/ui';
import { ConfigProvider } from '@frontend/hooks/providers';
import { useConfig } from '@frontend/hooks/contexts';

function Shell() {
  const { config } = useConfig();
  const { pathname } = useLocation();
  const previous = useRef(pathname);

  // Focus management on route change: move focus to the page heading (or main landmark) so
  // keyboard and screen-reader users land at the top of the new page. A field the page focused
  // itself (autofocus) keeps focus.
  useEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    window.scrollTo(0, 0);
    const id = window.setTimeout(() => {
      const active = document.activeElement;
      // Something inside the page already took focus (autofocused field, a question heading
      // focused by the page itself): keep it.
      const main = document.getElementById('main');
      if (
        active instanceof HTMLElement &&
        main &&
        active !== main &&
        main.contains(active) &&
        (active.matches('input, textarea, select') || active.matches('h1, h2, [tabindex="-1"]'))
      )
        return;
      const target =
        document.querySelector<HTMLElement>('[data-page-heading]') ??
        document.getElementById('main');
      target?.focus({ preventScroll: true });
    }, 60);
    return () => window.clearTimeout(id);
  }, [pathname]);

  return (
    <>
      <a href="#main" className="sr-only-focusable btn fixed left-3 top-3 z-[70]">
        Skip to main content
      </a>
      {config?.dataStore === 'memory' && (
        <div className="no-print">
          <DemoBanner />
        </div>
      )}
      <Outlet />
    </>
  );
}

export function Root() {
  return (
    <ToastProvider>
      <ConfigProvider>
        <Shell />
      </ConfigProvider>
    </ToastProvider>
  );
}
