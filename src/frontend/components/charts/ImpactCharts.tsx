/**
 * Charts for the impact dashboard. Loaded only by lazy admin pages.
 * House style: baseline = blue outline, final = solid red, neutral = sage / ink; score axes are
 * always 0–100; hairline grid; mono ticks and direct labels; nothing decorative.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  ChangeDistributionBucket,
  ScoreDistributionBucket,
  SkillImpact,
  TrendPoint,
} from '@shared/api';
import { SKILL_LABELS, type AssessmentStage } from '@shared/types';
import { fmtMonth, fmtNum, fmtPts } from '@frontend/lib/format';
import { SERIES, changeBucketTone } from './chart-utils';

const AXIS = { stroke: SERIES.ink };
const TICK = { fill: SERIES.tick, fontSize: 12 };
const LABEL = { fill: SERIES.ink, fontSize: 11 };
const SCORE_TICKS = [0, 25, 50, 75, 100];
const CURSOR = { fill: 'rgb(32 32 30 / 0.06)' };

const axisTitle = (value: string, position: 'insideBottom' | 'insideLeft') =>
  position === 'insideBottom'
    ? { value, position, offset: -2, fill: SERIES.tick, fontSize: 12 }
    : { value, position, angle: -90, offset: 14, fill: SERIES.tick, fontSize: 12 };

interface TipEntry {
  name?: string | number;
  value?: number | string | null;
  color?: string;
  dataKey?: string | number;
}
function ChartTooltip({
  active,
  payload,
  label,
  unit,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TipEntry[];
  label?: string | number;
  unit: (key: string) => string;
  labelFormatter?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-ink px-3 py-2 font-sans text-[0.8125rem] text-paper">
      <p className="mb-1 font-semibold">{labelFormatter ? labelFormatter(String(label)) : label}</p>
      {payload.map((e) => (
        <p key={String(e.dataKey)} className="flex items-center gap-2">
          <span>{e.name}</span>
          <span className="t-num ml-auto pl-4">
            {e.value === null || e.value === undefined
              ? '—'
              : `${typeof e.value === 'number' ? fmtNum(e.value, unit(String(e.dataKey)) === '%' || !Number.isInteger(e.value) ? 1 : 0) : e.value}${unit(String(e.dataKey))}`}
          </span>
        </p>
      ))}
    </div>
  );
}

/**
 * Paired horizontal bars per skill on a fixed 0–100 scale, with direct mono labels and the
 * change in percentage points. Plain HTML/CSS: crisp at any width and stacks cleanly on phones.
 */
export function SkillComparisonChart({
  skills,
  threshold,
}: {
  skills: SkillImpact[];
  threshold: number;
}) {
  const w = (v: number | null) => `${Math.max(0, Math.min(100, v ?? 0))}%`;
  return (
    <div>
      <ul className="border-t border-ink">
        {skills.map((s) => (
          <li
            key={s.skill}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-b border-rule py-2.5 sm:grid-cols-[11rem_minmax(0,1fr)_5.5rem]"
          >
            <span className="text-sm font-semibold leading-tight text-ink">
              {SKILL_LABELS[s.skill]}
              {s.n < threshold ? ' *' : ''}
              <span className="t-caption t-num block font-normal">n = {s.n}</span>
            </span>
            <span className="tag-change justify-self-end sm:order-last">
              {fmtPts(s.averageChangePoints)}
            </span>
            <span className="col-span-2 flex items-center gap-2 sm:col-span-1">
              <span className="pair flex-1" aria-hidden="true">
                <span className="bar bar-pre block" style={{ width: w(s.averagePre) }} />
                <span className="bar bar-post block" style={{ width: w(s.averagePost) }} />
              </span>
              <span className="t-num grid w-11 flex-none gap-[3px] text-right text-xs leading-[0.625rem] text-ink">
                <span>
                  <span className="sr-only">Baseline </span>
                  {fmtNum(s.averagePre)}
                </span>
                <span>
                  <span className="sr-only">Final </span>
                  {fmtNum(s.averagePost)}
                </span>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div
        className="mt-1 grid sm:grid-cols-[11rem_minmax(0,1fr)_5.5rem] sm:gap-x-4"
        aria-hidden="true"
      >
        <span className="hidden sm:block" />
        <span className="t-num mr-[3.25rem] flex justify-between text-xs text-ink-3">
          {SCORE_TICKS.map((t) => (
            <span key={t}>{t}</span>
          ))}
        </span>
      </div>
      <p className="t-caption mt-1 sm:pl-[12rem]" aria-hidden="true">
        Average sub-score (%), axis 0–100
      </p>
    </div>
  );
}

const preBar = {
  fill: SERIES.preFill,
  stroke: SERIES.pre,
  strokeWidth: 2,
  isAnimationActive: false,
} as const;
const postBar = { fill: SERIES.post, isAnimationActive: false } as const;

export function ScoreDistributionChart({ data }: { data: ScoreDistributionBucket[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 18, right: 4, bottom: 16, left: 0 }}
          barGap={3}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis
            dataKey="bucket"
            tick={TICK}
            axisLine={AXIS}
            tickLine={false}
            label={axisTitle('Score band (%)', 'insideBottom')}
            height={44}
          />
          <YAxis
            allowDecimals={false}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            label={axisTitle('Students', 'insideLeft')}
          />
          <Tooltip
            cursor={CURSOR}
            content={
              <ChartTooltip unit={() => ' students'} labelFormatter={(l) => `Score ${l}%`} />
            }
          />
          <Bar dataKey="pre" name="Baseline (pre)" maxBarSize={30} {...preBar}>
            <LabelList dataKey="pre" position="top" {...LABEL} />
          </Bar>
          <Bar dataKey="post" name="Final (post)" maxBarSize={30} {...postBar}>
            <LabelList dataKey="post" position="top" {...LABEL} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChangeDistributionChart({ data }: { data: ChangeDistributionBucket[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 18, right: 4, bottom: 16, left: 0 }}
          barCategoryGap="16%"
        >
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis
            dataKey="bucket"
            tick={{ ...TICK, fontSize: 11 }}
            axisLine={AXIS}
            tickLine={false}
            interval={0}
            label={axisTitle('Change (percentage points)', 'insideBottom')}
            height={44}
          />
          <YAxis
            allowDecimals={false}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            label={axisTitle('Students', 'insideLeft')}
          />
          <Tooltip
            cursor={CURSOR}
            content={
              <ChartTooltip unit={() => ' students'} labelFormatter={(l) => `Change of ${l} pts`} />
            }
          />
          <Bar dataKey="count" name="Matched students" maxBarSize={48} isAnimationActive={false}>
            {data.map((d) => {
              const tone = changeBucketTone(d.bucket);
              return (
                <Cell
                  key={d.bucket}
                  fill={
                    tone === 'improved'
                      ? SERIES.post
                      : tone === 'declined'
                        ? SERIES.neutral
                        : SERIES.paper
                  }
                  stroke={tone === 'unchanged' ? SERIES.ink : undefined}
                  strokeWidth={tone === 'unchanged' ? 2 : 0}
                />
              );
            })}
            <LabelList dataKey="count" position="top" {...LABEL} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CompletionsTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 4, bottom: 4, left: 0 }}
          barGap={2}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis
            dataKey="period"
            tickFormatter={fmtMonth}
            tick={TICK}
            axisLine={AXIS}
            tickLine={false}
            minTickGap={12}
          />
          <YAxis
            allowDecimals={false}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            label={axisTitle('Completions', 'insideLeft')}
          />
          <Tooltip
            cursor={CURSOR}
            content={<ChartTooltip unit={() => ''} labelFormatter={fmtMonth} />}
          />
          <Bar dataKey="preCompletions" name="Pre completions" maxBarSize={20} {...preBar} />
          <Bar dataKey="postCompletions" name="Post completions" maxBarSize={20} {...postBar} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChangeTrendChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis
            dataKey="period"
            tickFormatter={fmtMonth}
            tick={TICK}
            axisLine={AXIS}
            tickLine={false}
            minTickGap={12}
          />
          {/* Always includes zero, so a small change is never stretched to look large. */}
          <YAxis
            domain={[
              (min: number) => Math.min(0, Math.floor(min)),
              (max: number) => Math.max(0, Math.ceil(max)),
            ]}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            label={axisTitle('Change (pts)', 'insideLeft')}
          />
          <ReferenceLine y={0} stroke={SERIES.ink} />
          <Tooltip
            content={
              <ChartTooltip
                unit={(k) => (k === 'averageChangePoints' ? ' pts' : '')}
                labelFormatter={fmtMonth}
              />
            }
          />
          <Line
            type="linear"
            dataKey="averageChangePoints"
            name="Average change"
            stroke={SERIES.ink}
            strokeWidth={2}
            dot={{ r: 4, fill: SERIES.post, stroke: SERIES.post }}
            activeDot={{ r: 6, fill: SERIES.post, stroke: SERIES.ink }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface HistoryPoint {
  label: string;
  score: number;
  /** Colours the point by the data-viz code: pre = blue outline, post = red, retention = sage. */
  stage?: AssessmentStage;
}

function StageDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: HistoryPoint }) {
  if (cx === undefined || cy === undefined) return null;
  const stage = payload?.stage;
  const style =
    stage === 'PRE'
      ? { fill: SERIES.preFill, stroke: SERIES.pre }
      : stage === 'POST'
        ? { fill: SERIES.post, stroke: SERIES.post }
        : stage === 'RETENTION'
          ? { fill: SERIES.neutral, stroke: SERIES.neutral }
          : { fill: SERIES.paper, stroke: SERIES.ink };
  return <rect x={cx - 6} y={cy - 6} width={12} height={12} strokeWidth={2} {...style} />;
}
export function StudentHistoryChart({ data }: { data: HistoryPoint[] }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 20, right: 24, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={SERIES.grid} />
          <XAxis
            dataKey="label"
            tick={TICK}
            axisLine={AXIS}
            tickLine={false}
            interval={0}
            padding={{ left: 32, right: 32 }}
          />
          <YAxis
            domain={[0, 100]}
            ticks={SCORE_TICKS}
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={44}
            label={axisTitle('Score (%)', 'insideLeft')}
          />
          <Tooltip content={<ChartTooltip unit={() => '%'} />} />
          <Line
            type="linear"
            dataKey="score"
            name="Score"
            stroke={SERIES.ink}
            strokeWidth={2}
            dot={(p: unknown) => {
              const d = p as { index?: number; cx?: number; cy?: number; payload?: HistoryPoint };
              return <StageDot key={d.index} cx={d.cx} cy={d.cy} payload={d.payload} />;
            }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="score"
              position="top"
              offset={10}
              formatter={(v: unknown) => (typeof v === 'number' ? fmtNum(v, 1) : '')}
              {...LABEL}
            />
          </Line>
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
