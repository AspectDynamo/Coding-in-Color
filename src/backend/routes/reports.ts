import { Hono, type Context } from 'hono';
import type { AiReportDto } from '@shared/api';
import { dashboardFiltersSchema, paginationQuery, summarizeBody } from '@shared/validation';
import type { AppEnv } from '../env';
import { requirePermission, requireStaff } from '../middleware/auth';
import {
  AI_SUMMARY_JSON_SCHEMA,
  PROMPT_VERSION,
  assertNoIdentifiers,
  buildAiPayload,
  buildSummaryMessages,
  buildTemplateSummary,
  checkNumbers,
  impactCsv,
  parseAiSummary,
  skillsCsv,
  suppressForExternal,
  type AiPayload,
} from '../analytics';
import { audit } from '../services/audit';
import { computeDashboard, scopeLabel } from '../services/dashboard';
import { enforceRateLimit } from '../services/rate-limit';
import { HttpError, notFound } from '../utils/errors';
import { idParam, ok, paged, parseBody, parseQuery } from '../utils/http';
import { errorSummary, log } from '../utils/logger';

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use('/admin/reports', requireStaff);
reportRoutes.use('/admin/reports/*', requireStaff);
reportRoutes.use('/admin/exports/*', requireStaff);

const AI_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('ai_timeout')), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Calls Workers AI; returns validated content or null (any failure). Never logs payloads or output. */
async function runModel(c: Context<AppEnv>, payload: AiPayload) {
  const ai = c.env?.AI;
  if (!ai || typeof ai.run !== 'function') return null;
  try {
    const out = await withTimeout(
      Promise.resolve(
        ai.run(c.get('config').aiModel, {
          messages: buildSummaryMessages(payload),
          response_format: { type: 'json_schema', json_schema: AI_SUMMARY_JSON_SCHEMA },
          max_tokens: 900,
        }),
      ),
      AI_TIMEOUT_MS,
    );
    const raw =
      out && typeof out === 'object' && 'response' in out
        ? (out as { response: unknown }).response
        : out;
    const content = parseAiSummary(raw);
    if (!content) log('warn', 'ai.invalid_output');
    return content;
  } catch (e) {
    log('error', 'ai.model_error', errorSummary(e));
    return null;
  }
}

reportRoutes.post('/admin/reports/summarize', requirePermission('reports.ai'), async (c) => {
  const staff = c.get('staff')!;
  const store = c.get('store');
  const cfg = c.get('config');
  await enforceRateLimit(c, 'AI_LIMITER', staff.id);
  const body = await parseBody(c, summarizeBody);

  const dashboard = await computeDashboard(c, body.filters);
  const label = await scopeLabel(store, body.filters);
  // Aggregate-only payload, built from the suppressed dashboard; verified free of identifiers.
  const payload = buildAiPayload(suppressForExternal(dashboard), {
    reportType: body.reportType,
    scopeLabel: label,
  });
  assertNoIdentifiers(payload);

  const content = await runModel(c, payload);
  if (content) {
    const validation = checkNumbers(content, payload);
    const dto = await store.insertAiReport({
      reportType: body.reportType,
      filters: body.filters,
      inputMetrics: payload as unknown as Record<string, unknown>,
      content: content as unknown as Record<string, unknown>,
      generationMode: 'ai',
      modelId: cfg.aiModel,
      promptVersion: PROMPT_VERSION,
      validation,
      createdBy: staff.id,
    });
    await audit(store, {
      actorType: 'staff',
      actorId: staff.id,
      action: 'report.generate',
      targetType: 'ai_report',
      targetId: dto.id,
      metadata: { reportType: body.reportType, mode: 'ai' },
    });
    return ok(c, dto);
  }

  const template = buildTemplateSummary(payload);
  const fallback: AiReportDto = await store.insertAiReport({
    reportType: body.reportType,
    filters: body.filters,
    inputMetrics: payload as unknown as Record<string, unknown>,
    content: template as unknown as Record<string, unknown>,
    generationMode: 'template',
    modelId: null,
    promptVersion: PROMPT_VERSION,
    validation: checkNumbers(template, payload),
    createdBy: staff.id,
  });
  await audit(store, {
    actorType: 'staff',
    actorId: staff.id,
    action: 'report.generate',
    targetType: 'ai_report',
    targetId: fallback.id,
    metadata: { reportType: body.reportType, mode: 'template' },
  });
  throw new HttpError(
    503,
    'ai_unavailable',
    'The AI summary is unavailable right now. A template summary is provided instead.',
    { fallback },
  );
});

reportRoutes.get('/admin/reports', requirePermission('reports.ai'), async (c) => {
  const q = parseQuery(c, paginationQuery);
  const page = await c.get('store').listAiReports({ ...q, savedOnly: true });
  return paged(c, page.items, page.total, q.limit, q.offset);
});

reportRoutes.post('/admin/reports/:id/save', requirePermission('reports.ai'), async (c) => {
  const store = c.get('store');
  const dto = await store.setAiReportSaved(idParam(c), true);
  if (!dto) throw notFound('Report not found.');
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'report.save',
    targetType: 'ai_report',
    targetId: dto.id,
  });
  return ok(c, dto);
});

reportRoutes.delete('/admin/reports/:id', requirePermission('reports.ai'), async (c) => {
  const store = c.get('store');
  const id = idParam(c);
  if (!(await store.deleteAiReport(id))) throw notFound('Report not found.');
  await audit(store, {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: 'report.delete',
    targetType: 'ai_report',
    targetId: id,
  });
  return ok(c, { ok: true });
});

async function csvExport(c: Context<AppEnv>, kind: 'impact' | 'skills'): Promise<Response> {
  const filters = parseQuery(c, dashboardFiltersSchema);
  // Exports are always the suppressed (external) view.
  const dashboard = suppressForExternal(await computeDashboard(c, filters));
  const csv = kind === 'impact' ? impactCsv(dashboard) : skillsCsv(dashboard);
  await audit(c.get('store'), {
    actorType: 'staff',
    actorId: c.get('staff')!.id,
    action: `export.${kind}_csv`,
    targetType: 'dashboard',
  });
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${kind}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

reportRoutes.get('/admin/exports/impact.csv', requirePermission('reports.export'), (c) =>
  csvExport(c, 'impact'),
);
reportRoutes.get('/admin/exports/skills.csv', requirePermission('reports.export'), (c) =>
  csvExport(c, 'skills'),
);
