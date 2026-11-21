import { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import clsx from 'clsx';
import type { DashboardFilters, FilterOptions } from '@shared/api';
import { ASSESSMENT_STAGES, SKILL_CATEGORIES, SKILL_LABELS } from '@shared/types';
import { Button, Input, Select } from '@frontend/components/ui';
import { FILTER_KEYS, type FilterKey } from '@frontend/lib/filters';
import { STAGE_LABELS } from '@frontend/lib/format';

const MORE_KEYS = ['instructorId', 'stage', 'skill'] as const;

/**
 * The scope of every number on the page. Five primary filters (program, course, cohort, dates)
 * sit in one ruled row with room for their values; lead instructor, stage and skill live behind
 * "More filters", which shows how many of them are applied. Below 768px the whole bar folds
 * into a "Filters (n)" disclosure. Filters live in the URL.
 */
export function FilterBar({
  filters,
  options,
  onChange,
  busy,
}: {
  filters: DashboardFilters;
  options: FilterOptions | undefined;
  onChange: (next: DashboardFilters) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const moreActive = MORE_KEYS.filter((k) => filters[k]).length;
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);
  const showMore = moreOpen;

  const set = (key: FilterKey, value: string) => {
    const next: Record<string, string | undefined> = { ...filters, [key]: value || undefined };
    // Dependent dropdowns: clear children that no longer belong to the parent.
    if (key === 'programId') {
      const course = options?.courses.find((c) => c.id === next.courseId);
      if (course && value && course.programId !== value) next.courseId = undefined;
      const cohort = options?.cohorts.find((c) => c.id === next.cohortId);
      if (cohort && value && cohort.programId !== value) next.cohortId = undefined;
    }
    if (key === 'courseId') {
      const cohort = options?.cohorts.find((c) => c.id === next.cohortId);
      if (cohort && value && cohort.courseId !== value) next.cohortId = undefined;
    }
    onChange(next as DashboardFilters);
  };
  const courses = (options?.courses ?? []).filter(
    (c) => !filters.programId || c.programId === filters.programId,
  );
  const cohorts = (options?.cohorts ?? []).filter(
    (c) =>
      (!filters.programId || c.programId === filters.programId) &&
      (!filters.courseId || c.courseId === filters.courseId),
  );
  const active = FILTER_KEYS.filter((k) => filters[k]).length;
  const dateError =
    filters.from && filters.to && filters.from > filters.to
      ? 'Start date is after the end date.'
      : null;

  return (
    <section aria-labelledby="filters-h" className="no-print border-y border-ink py-3">
      <div className="flex items-center justify-between gap-3 md:hidden">
        <h2 id="filters-h" className="contents">
          <button
            type="button"
            className="flex min-h-11 flex-1 items-center gap-2 text-left font-semibold"
            aria-expanded={open}
            aria-controls="filters-body"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown
              size={18}
              aria-hidden="true"
              className={clsx('transition-transform', open && 'rotate-180')}
            />
            Filters
            <span className="t-num font-normal text-ink-2">({active})</span>
          </button>
        </h2>
        {busy && <span className="t-caption">Updating…</span>}
      </div>

      <div id="filters-body" className={clsx('md:block', open ? 'mt-2 block' : 'hidden')}>
        {/* Primary row: 3 + 2 at desktop, 3 then 2 + actions at laptop/tablet. */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-6 xl:grid-cols-[repeat(3,minmax(0,1.25fr))_repeat(2,minmax(0,1fr))_auto]">
          <Select
            label="Program"
            inputSize="sm"
            wrapperClassName="col-span-2 xl:col-span-1"
            value={filters.programId ?? ''}
            onChange={(e) => set('programId', e.target.value)}
          >
            <option value="">All programs</option>
            {options?.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select
            label="Course"
            inputSize="sm"
            wrapperClassName="col-span-2 xl:col-span-1"
            value={filters.courseId ?? ''}
            onChange={(e) => set('courseId', e.target.value)}
          >
            <option value="">All courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            label="Cohort"
            inputSize="sm"
            wrapperClassName="col-span-2 xl:col-span-1"
            value={filters.cohortId ?? ''}
            onChange={(e) => set('cohortId', e.target.value)}
          >
            <option value="">All cohorts</option>
            {cohorts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label="From"
            type="date"
            inputSize="sm"
            wrapperClassName="md:col-span-2 xl:col-span-1"
            value={filters.from ?? ''}
            max={filters.to}
            onChange={(e) => set('from', e.target.value)}
          />
          <Input
            label="To"
            type="date"
            inputSize="sm"
            wrapperClassName="md:col-span-2 xl:col-span-1"
            value={filters.to ?? ''}
            min={filters.from}
            onChange={(e) => set('to', e.target.value)}
            error={dateError}
          />
          <div className="col-span-2 flex items-end gap-1 xl:col-span-1">
            <Button
              size="sm"
              aria-expanded={showMore}
              aria-controls="filters-more"
              onClick={() => setMoreOpen((v) => !v)}
              iconRight={
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  className={clsx('transition-transform', showMore && 'rotate-180')}
                />
              }
            >
              More filters ({moreActive})
            </Button>
            <Button
              size="sm"
              variant="quiet"
              icon={<RotateCcw size={14} aria-hidden="true" />}
              disabled={active === 0}
              onClick={() => onChange({})}
            >
              Reset
            </Button>
          </div>
        </div>

        <div
          id="filters-more"
          hidden={!showMore}
          className={clsx(
            'mt-3 grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-3 md:grid-cols-3',
            showMore && 'grid',
          )}
        >
          <Select
            label="Lead instructor"
            inputSize="sm"
            wrapperClassName="col-span-2 md:col-span-1"
            value={filters.instructorId ?? ''}
            onChange={(e) => set('instructorId', e.target.value)}
          >
            <option value="">All instructors</option>
            {options?.instructors.map((i) => (
              <option key={i.id} value={i.id}>
                {i.displayName}
              </option>
            ))}
          </Select>
          <Select
            label="Stage"
            inputSize="sm"
            value={filters.stage ?? ''}
            onChange={(e) => set('stage', e.target.value)}
            hint="Narrows completion counts and the trend only."
          >
            <option value="">All stages</option>
            {ASSESSMENT_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
          <Select
            label="Skill"
            inputSize="sm"
            value={filters.skill ?? ''}
            onChange={(e) => set('skill', e.target.value)}
            hint="Switches headline scores to this skill’s sub-score."
          >
            <option value="">Overall score</option>
            {(options?.skills ?? SKILL_CATEGORIES).map((s) => (
              <option key={s} value={s}>
                {SKILL_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {busy && (
        <p className="t-caption mt-2 hidden md:block" role="status">
          Updating…
        </p>
      )}
    </section>
  );
}
