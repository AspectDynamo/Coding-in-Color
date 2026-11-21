/**
 * Original geometric illustrations, built only from the brand mark's primitives
 * (square = baseline, circle = learner, bar = final measurement) plus the quarter circle.
 * Decorative: always aria-hidden. Used on landing/entry, completion and 404/403 only.
 */
const BLUE = '#315FA8';
const RED = '#D94335';
const YELLOW = '#E9BE43';
const INK = '#20201E';
const PAPER = '#FBF9F3';

/** Landing / access hero: the mark at poster scale, with a quarter circle and a short count. */
export function HeroFigure({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" aria-hidden="true" className={className}>
      <rect x="0" y="220" width="180" height="180" fill={BLUE} />
      <circle cx="150" cy="140" r="100" fill={YELLOW} />
      <rect x="290" y="0" width="110" height="400" fill={RED} />
      <path d="M180 400 A100 100 0 0 1 280 300 L280 400 Z" fill={INK} />
      {/* the count: three numbered squares, the third is "now" */}
      <g fontFamily="'IBM Plex Mono', monospace" fontSize="15" fontWeight="500" textAnchor="middle">
        <rect x="16" y="236" width="30" height="30" fill={INK} />
        <text x="31" y="256" fill={PAPER}>
          1
        </text>
        <rect x="52" y="236" width="30" height="30" fill={INK} />
        <text x="67" y="256" fill={PAPER}>
          2
        </text>
        <rect x="88" y="236" width="30" height="30" fill={PAPER} />
        <text x="103" y="256" fill={INK}>
          3
        </text>
      </g>
    </svg>
  );
}

/** Completion: every step filled, rising to the final red bar; the learner on top. */
export function DoneFigure({ className }: { className?: string }) {
  const steps = [0, 1, 2, 3, 4];
  return (
    <svg viewBox="0 0 400 240" aria-hidden="true" className={className}>
      {steps.map((i) => (
        <rect key={i} x={i * 56} y={200 - i * 28} width="48" height={40 + i * 28} fill={INK} />
      ))}
      <rect x="280" y="40" width="64" height="200" fill={RED} />
      <circle cx="312" cy="20" r="20" fill={YELLOW} />
      <path d="M352 240 A48 48 0 0 1 400 192 L400 240 Z" fill={BLUE} />
    </svg>
  );
}

/** 404 / 403: the primitives pulled apart — something is out of place. */
export function LostFigure({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden="true" className={className}>
      <rect x="0" y="140" width="100" height="100" fill="none" stroke={BLUE} strokeWidth="4" />
      <circle cx="170" cy="60" r="44" fill={YELLOW} />
      <rect x="196" y="120" width="44" height="120" fill={RED} />
      <path d="M100 240 A60 60 0 0 1 160 180 L160 240 Z" fill={INK} />
    </svg>
  );
}
