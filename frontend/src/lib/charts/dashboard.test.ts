import { describe, expect, it } from 'vitest';

import { CATEGORICAL, COLOR } from '../theme';
import {
  ZOOM_START_YEAR,
  authorProductivityOption,
  coauthorDistributionOption,
  hbarOption,
  multiLineOption,
  publicationsPerYearOption,
  teamSizeOption,
  typeDistributionOption,
  venuesPerYearOption,
} from './dashboard';

type Series = Array<Record<string, unknown> & { data: unknown[] }>;
type Axis = { data?: unknown[]; type?: string; name?: string };
type Zoom = Array<{ type: string; startValue: number; endValue: number }>;
type Option = { xAxis: Axis; yAxis: Axis; series: Series; dataZoom?: Zoom; legend?: unknown; color?: string[] };

const asOption = (o: unknown) => o as Option;

const years = Array.from({ length: 90 }, (_, i) => 1936 + i);

describe('publicationsPerYearOption', () => {
  it('draws the counts against the years and shows the whole range', () => {
    const option = asOption(publicationsPerYearOption(years.map((year, i) => ({ year, count: i * 10 }))));
    expect(option.xAxis.data).toEqual(years);
    expect(option.series[0]?.data.slice(0, 3)).toEqual([0, 10, 20]);
    expect(option.dataZoom?.[0]?.startValue).toBe(0);
  });
});

describe('typeDistributionOption', () => {
  it('names the slices in words and falls back to the raw type for anything new', () => {
    const option = asOption(
      typeDistributionOption([
        { type: 'article', count: 4 },
        { type: 'inproceedings', count: 3 },
        { type: 'book', count: 1 },
      ]),
    );
    expect(option.series[0]?.data).toEqual([
      { name: 'Journal article', value: 4 },
      { name: 'Conference paper', value: 3 },
      { name: 'book', value: 1 },
    ]);
  });

  it('labels each slice with its whole-number share, drawn inside the ring', () => {
    const series = asOption(typeDistributionOption([{ type: 'article', count: 1 }])).series[0] as unknown as {
      label: { position: string; formatter: (p: { percent: number }) => string };
    };
    expect(series.label.position).toBe('inside');
    expect(series.label.formatter({ percent: 51.71 })).toBe('52%');
    expect(series.label.formatter({ percent: 48.29 })).toBe('48%');
  });
});

describe('hbarOption', () => {
  it('sorts ascending so the biggest bar is drawn at the top, keeping labels aligned with values', () => {
    const option = asOption(
      hbarOption(
        [
          { label: 'b', value: 30 },
          { label: 'a', value: 10 },
          { label: 'c', value: 20 },
        ],
        COLOR.gold,
      ),
    );
    expect(option.yAxis.data).toEqual(['a', 'c', 'b']);
    expect(option.series[0]?.data).toEqual([10, 20, 30]);
  });

  it('does not reorder the caller’s array', () => {
    const rows = [
      { label: 'b', value: 2 },
      { label: 'a', value: 1 },
    ];
    hbarOption(rows, COLOR.gold);
    expect(rows.map((r) => r.label)).toEqual(['b', 'a']);
  });
});

describe('coauthorDistributionOption', () => {
  it('puts the team sizes on the x axis', () => {
    const option = asOption(coauthorDistributionOption([{ n_authors: 1, count: 5 }, { n_authors: 2, count: 9 }]));
    expect(option.xAxis.data).toEqual([1, 2]);
    expect(option.xAxis.name).toBe('authors');
    expect(option.series[0]?.data).toEqual([5, 9]);
  });
});

describe('teamSizeOption / venuesPerYearOption', () => {
  it('open at 1970, with the slider reaching back to the first year', () => {
    const team = asOption(teamSizeOption(years.map((year) => ({ year, avg_authors: 2 }))));
    const venues = asOption(venuesPerYearOption(years.map((year) => ({ year, distinct_venues: 5 }))));
    expect(team.dataZoom?.[0]?.startValue).toBe(ZOOM_START_YEAR - 1936);
    expect(venues.dataZoom?.[1]?.startValue).toBe(ZOOM_START_YEAR - 1936);
    expect(team.xAxis.data?.[0]).toBe(1936);
  });

  it('lets the team-size axis start off zero so the trend is visible', () => {
    expect((asOption(teamSizeOption([{ year: 2000, avg_authors: 3 }])).yAxis as { scale?: boolean }).scale).toBe(true);
  });
});

describe('authorProductivityOption', () => {
  it('uses a log axis and draws an empty bucket as 1, since a log scale cannot show 0', () => {
    const option = asOption(
      authorProductivityOption([
        { bucket: '1', count: 924570 },
        { bucket: '20+', count: 0 },
      ]),
    );
    expect(option.yAxis.type).toBe('log');
    expect(option.series[0]?.data).toEqual([924570, 1]);
  });
});

describe('multiLineOption', () => {
  const data = {
    years: [1970, 1971, 1972],
    series: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`kw${i}`, [i, i + 1, i + 2]])),
  };

  it('draws one named line per series, in order, with the data untouched', () => {
    const option = asOption(multiLineOption(data, '% of titles'));
    expect(option.series.map((s) => s.name)).toEqual(Array.from({ length: 8 }, (_, i) => `kw${i}`));
    expect(option.series[3]?.data).toEqual([3, 4, 5]);
    expect(option.yAxis.name).toBe('% of titles');
    expect(option.color).toEqual([...CATEGORICAL]);
  });

  it('dashes the later series so near-twin palette colours stay distinguishable', () => {
    const option = asOption(multiLineOption(data, 'x'));
    const style = (i: number) => (option.series[i]?.lineStyle as { type: string }).type;
    expect([style(0), style(5), style(6), style(7)]).toEqual(['solid', 'solid', 'dashed', 'dashed']);
  });

  it('opens at 1970 by default and on the whole range when asked', () => {
    const wide = { years: years, series: { a: years.map(() => 1) } };
    expect(asOption(multiLineOption(wide, 'x')).dataZoom?.[0]?.startValue).toBe(34);
    expect(asOption(multiLineOption(wide, 'x', null)).dataZoom?.[0]?.startValue).toBe(0);
  });
});
