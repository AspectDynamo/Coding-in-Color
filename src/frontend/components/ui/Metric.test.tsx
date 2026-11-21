import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Metric } from './Metric';
import { formatStat } from './stat-format';

afterEach(cleanup);

describe('formatStat', () => {
  it('labels percentage-point changes as pts, never %', () => {
    expect(formatStat(12.44, 'points')).toEqual({ text: '+12.4', unit: 'pts' });
    expect(formatStat(-3, 'points')).toEqual({ text: '−3.0', unit: 'pts' });
    expect(formatStat(0, 'points')).toEqual({ text: '0.0', unit: 'pts' });
  });
  it('labels relative change and shares as %', () => {
    expect(formatStat(30.12, 'relative')).toEqual({ text: '+30.1', unit: '%' });
    expect(formatStat(64.25, 'percent')).toEqual({ text: '64.3', unit: '%' });
    expect(formatStat(71, 'score')).toEqual({ text: '71.0', unit: '%' });
  });
  it('formats counts without decimals and null as a dash', () => {
    expect(formatStat(1234, 'count')).toEqual({ text: '1,234', unit: '' });
    expect(formatStat(null, 'points')).toEqual({ text: '—', unit: '' });
  });
});

describe('Metric', () => {
  it('shows value, pts unit and matched n', () => {
    render(<Metric label="Average change" value={15.26} unit="points" n={42} />);
    expect(screen.getByTestId('stat-value')).toHaveTextContent('+15.3');
    expect(screen.getByTestId('stat-unit')).toHaveTextContent('pts');
    expect(screen.getByTestId('stat-n')).toHaveTextContent('n = 42 matched');
  });
  it('shows % for relative change', () => {
    render(<Metric label="Relative change" value={37.5} unit="relative" n={42} />);
    expect(screen.getByTestId('stat-unit')).toHaveTextContent('%');
  });
  it('shows explanatory text instead of a number when the value is undefined', () => {
    render(
      <Metric
        label="Relative change"
        value={null}
        unit="relative"
        n={8}
        emptyText="Undefined (baseline 0)"
      />,
    );
    expect(screen.getByText('Undefined (baseline 0)')).toBeInTheDocument();
    expect(screen.queryByTestId('stat-unit')).toBeNull();
  });
  it('exposes help as an accessible tooltip button', () => {
    render(<Metric label="Match rate" value={80} unit="percent" help="Matched ÷ pre" />);
    expect(screen.getByRole('button', { name: 'About: Match rate' })).toHaveAccessibleDescription(
      'Matched ÷ pre',
    );
  });
});
