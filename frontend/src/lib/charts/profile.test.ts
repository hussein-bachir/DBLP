import { describe, expect, it } from 'vitest';

import { venuesOption, yearsOption } from './profile';

type Series = Array<{ data: number[] }>;
type Axis = { data: Array<number | string> };

describe('yearsOption', () => {
  it('fills the years with no papers so gaps show as zero', () => {
    const option = yearsOption([
      [2014, 1],
      [2017, 3],
    ]) as { xAxis: Axis; series: Series };
    expect(option.xAxis.data).toEqual([2014, 2015, 2016, 2017]);
    expect(option.series[0]?.data).toEqual([1, 0, 0, 3]);
  });

  it('handles an author with no dated papers', () => {
    const option = yearsOption([]) as { xAxis: Axis; series: Series };
    expect(option.xAxis.data).toEqual([]);
    expect(option.series[0]?.data).toEqual([]);
  });
});

describe('venuesOption', () => {
  it('reverses the list so the most frequent venue is drawn at the top', () => {
    const option = venuesOption([
      { venue: 'journals/corr', count: 18 },
      { venue: 'conf/icml', count: 3 },
    ]) as { yAxis: Axis; series: Series };
    expect(option.yAxis.data).toEqual(['conf/icml', 'journals/corr']);
    expect(option.series[0]?.data).toEqual([3, 18]);
  });
});
