import { ButtonLink, useDocumentTitle } from '@frontend/components/ui';
import { LostFigure } from '@frontend/components/illustrations';

export default function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="rule-heavy grid gap-8 pt-6 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="t-figure text-[clamp(4rem,18vw,9rem)] text-ink">404</p>
          <h1 className="t-h2 mt-4" tabIndex={-1} data-page-heading>
            We can’t find that page
          </h1>
          <p className="t-lede mt-2">The link may be old, or the address may have a typo.</p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/" variant="primary">
              Go to the start page
            </ButtonLink>
            <ButtonLink to="/s">Student check-in</ButtonLink>
          </div>
        </div>
        <LostFigure className="order-first h-28 w-28 sm:order-none sm:h-48 sm:w-48" />
      </div>
    </main>
  );
}
