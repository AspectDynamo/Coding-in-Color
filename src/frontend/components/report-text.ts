import type { AiReportDto } from '@shared/api';
import { REPORT_TYPE_LABELS } from '@shared/types';
import { fmtDateTime } from '@frontend/lib/format';

/** Plain-text version for the clipboard. */
export function reportToText(r: AiReportDto): string {
  const c = r.content;
  const list = (title: string, items: string[]) =>
    items.length ? `\n${title}\n${items.map((i) => `• ${i}`).join('\n')}\n` : '';
  return [
    c.headline,
    '',
    c.summary,
    list('Key findings', c.key_findings),
    list('Areas for improvement', c.areas_for_improvement),
    list('Recommendations', c.recommendations),
    list('Limitations', c.limitations),
    `— ${REPORT_TYPE_LABELS[r.reportType]} · ${r.generationMode === 'ai' ? `AI-drafted (${r.modelId ?? 'model'})` : 'Template narrative (no AI)'} · ${fmtDateTime(r.createdAt)}`,
  ].join('\n');
}
