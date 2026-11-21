import { Bot, FileText, ShieldCheck } from 'lucide-react';
import type { AiReportDto } from '@shared/api';
import { REPORT_TYPE_LABELS } from '@shared/types';
import { Badge, Notice } from '@frontend/components/ui';
import { fmtDateTime } from '@frontend/lib/format';

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="border-t border-rule pt-4">
      <h4 className="t-h4 mb-2">{title}</h4>
      <ol className="space-y-2 text-[0.9375rem] text-ink-2">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="t-num flex-none text-ink-3" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * A generated narrative. It always sits on the blue-ruled "AI sheet" with a persistent label
 * saying how it was written, so it can never be mistaken for the verified source metrics.
 */
export function ReportView({ report }: { report: AiReportDto }) {
  const c = report.content;
  const ai = report.generationMode === 'ai';
  return (
    <article className="ai-sheet space-y-5 p-4 sm:p-6" data-testid="ai-report">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="generation-mode">
          {ai ? (
            <span className="ai-label">
              <Bot size={14} aria-hidden="true" />
              AI-generated draft
            </span>
          ) : (
            <span className="ai-label !bg-ink">
              <FileText size={14} aria-hidden="true" />
              Template narrative (no AI)
            </span>
          )}
        </span>
        <Badge>{REPORT_TYPE_LABELS[report.reportType]}</Badge>
        {report.saved && <Badge tone="good">Saved</Badge>}
      </div>

      <p className="t-caption">
        {ai
          ? 'Drafted by an AI model from aggregate metrics only. Review before sharing — it is a draft, not a finding.'
          : 'Written by a fixed template from the same aggregate metrics, without AI. Used when the AI service is unavailable or switched off.'}
      </p>

      {!report.validation.passed && (
        <Notice
          tone="warn"
          role="alert"
          title="Number check: some figures couldn’t be traced to the data"
        >
          Verify or remove these before sharing:{' '}
          <span className="t-num font-semibold text-ink">
            {report.validation.unverifiedNumbers.join(', ') || 'unspecified'}
          </span>
        </Notice>
      )}
      {report.validation.passed && (
        <p className="t-small flex items-center gap-1.5 font-semibold text-green-ink">
          <ShieldCheck size={16} aria-hidden="true" />
          Number check passed: every figure in the text matches the data that was sent.
        </p>
      )}

      <div>
        <h3 className="t-h2">{c.headline}</h3>
        <p className="measure mt-3 whitespace-pre-line text-[1.0625rem] leading-relaxed text-ink">
          {c.summary}
        </p>
      </div>
      <List title="Key findings" items={c.key_findings} />
      <List title="Areas for improvement" items={c.areas_for_improvement} />
      <List title="Recommendations" items={c.recommendations} />
      <List title="Limitations" items={c.limitations} />

      <dl className="t-caption grid gap-x-6 gap-y-0.5 border-t border-rule pt-4 sm:grid-cols-[auto_1fr]">
        <dt className="font-semibold">Model</dt>
        <dd className="t-mono">{report.modelId ?? 'none (template)'}</dd>
        <dt className="font-semibold">Prompt version</dt>
        <dd className="t-mono">{report.promptVersion}</dd>
        <dt className="font-semibold">Created</dt>
        <dd>
          <span className="t-num">{fmtDateTime(report.createdAt)}</span>
          {report.createdBy ? ` by ${report.createdBy}` : ''}
        </dd>
      </dl>

      <details className="border border-rule bg-paper p-3">
        <summary className="flex min-h-8 items-center gap-2 text-sm font-semibold text-ink underline decoration-1 underline-offset-4">
          Show data sent to AI
        </summary>
        <p className="t-caption mt-2">
          This is the complete input: aggregate counts and averages only. No student IDs, codes,
          answers or histories. Groups smaller than the suppression threshold are removed before
          anything is sent.
        </p>
        <pre
          className="mt-3 max-h-80 overflow-auto border border-rule bg-sheet p-3 text-xs leading-relaxed text-ink-2"
          tabIndex={0}
        >
          {JSON.stringify(report.inputMetrics, null, 2)}
        </pre>
      </details>
    </article>
  );
}
