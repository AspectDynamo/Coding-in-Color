import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { ButtonLink, Wordmark, useDocumentTitle } from '@frontend/components/ui';
import { HeroFigure } from '@frontend/components/illustrations';

const CHECK_IN_STEPS = [
  { t: 'Find your card', d: 'Your instructor hands you an access card.' },
  { t: 'Type or scan the code', d: 'Sixteen letters and numbers, or the QR code.' },
  { t: 'Answer the questions', d: 'One at a time. About six minutes.' },
];

/** Three numbered steps — the same numbered squares as the check-in's question count. */
export function Steps() {
  return (
    <ol className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
      {CHECK_IN_STEPS.map((s, i) => (
        <li key={s.t} className="rule-hair flex gap-3 pt-3">
          <span className="count-cell flex-none" data-state="answered" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <p className="font-semibold leading-snug text-ink">{s.t}</p>
            <p className="t-small text-ink-2">{s.d}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

const PRIVACY = [
  {
    t: 'No names or emails',
    d: 'Students use a pseudonymous access code. We never ask for a name, email or birthday.',
  },
  {
    t: 'A card, not an account',
    d: 'The code on the card is the key. Lost it? An instructor can issue a new one.',
  },
  {
    t: 'Group results only',
    d: 'Reports show group-level results. Small groups are hidden in anything shared outside staff.',
  },
];

export default function Landing() {
  useDocumentTitle('');
  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col px-4 pb-10 sm:px-6">
      <header className="flex min-h-14 items-center justify-between gap-4 py-3">
        <Wordmark size={28} />
        <Link to="/staff/login" className="link text-sm">
          Staff sign in
        </Link>
      </header>

      <main id="main" tabIndex={-1} className="flex-1">
        <section className="rule-heavy grid gap-x-6 gap-y-8 lg:grid-cols-12">
          <div className="pt-6 sm:pt-10 lg:col-span-7 lg:pb-4">
            <p className="t-meta">Learning check-ins</p>
            <h1 className="t-display mt-4" tabIndex={-1} data-page-heading>
              Show what you know.
            </h1>
            <p className="t-lede mt-5">
              A short check-in before and after each workshop, camp and course shows how your skills
              grow. No name, no email — just the card from your instructor.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
              <ButtonLink
                to="/s"
                variant="primary"
                size="lg"
                iconRight={<ArrowRight size={20} aria-hidden="true" />}
              >
                Start my check-in
              </ButtonLink>
              <p className="t-small text-ink-2">
                Instructor or administrator?{' '}
                <Link to="/staff/login" className="link">
                  Staff sign in
                </Link>
              </p>
            </div>
          </div>
          <div className="order-first lg:order-none lg:col-span-5">
            <HeroFigure className="ml-auto block h-40 w-40 sm:h-56 sm:w-56 lg:h-auto lg:w-full lg:max-w-md" />
          </div>
        </section>

        <section aria-labelledby="how-h" className="mt-10 lg:mt-14">
          <h2 id="how-h" className="t-h3 mb-4">
            How a check-in works
          </h2>
          <Steps />
        </section>

        <section aria-labelledby="privacy-h" className="rule-heavy mt-12 pt-5 lg:mt-16">
          <div className="grid gap-x-6 gap-y-5 lg:grid-cols-12">
            <h2 id="privacy-h" className="t-h3 lg:col-span-3">
              Private by design
            </h2>
            <ul className="grid gap-x-6 gap-y-5 sm:grid-cols-3 lg:col-span-9">
              {PRIVACY.map(({ t, d }) => (
                <li key={t}>
                  <h3 className="t-h4">{t}</h3>
                  <p className="t-small mt-1 text-ink-2">{d}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="t-caption rule-hair mt-12 pt-4">
        Coding in Color is an Arizona nonprofit expanding access to computer science and AI
        education.
      </footer>
    </div>
  );
}
