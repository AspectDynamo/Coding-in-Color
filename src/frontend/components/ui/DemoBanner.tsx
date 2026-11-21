/** Shown whenever PublicConfig.dataStore === 'memory'. Yellow = attention; ink text (9.3:1). */
export function DemoBanner({ compact }: { compact?: boolean }) {
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 border-b border-ink bg-yellow px-4 py-1 text-center text-[0.8125rem] font-semibold text-ink"
      data-testid="demo-banner"
    >
      <span aria-hidden="true" className="h-2 w-2 flex-none bg-ink" />
      <span>
        Demo mode — synthetic data.{' '}
        {!compact && (
          <span className="font-normal">No real students. Resets when the server restarts.</span>
        )}
      </span>
    </div>
  );
}
