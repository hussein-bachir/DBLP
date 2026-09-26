import type { EChartsCoreOption } from 'echarts/core';

import type { Profile, VenueCount } from '../../api/types';
import { COLOR } from '../theme';
import { axis, baseGrid, tooltip } from './common';

/** Papers per year as bars, with the years that have no papers shown as zero. */
export function yearsOption(perYear: Profile['per_year']): EChartsCoreOption {
  const counts = new Map(perYear);
  const first = perYear[0]?.[0];
  const last = perYear[perYear.length - 1]?.[0];
  const years: number[] = [];
  if (first !== undefined && last !== undefined) {
    for (let year = first; year <= last; year++) years.push(year);
  }
  return {
    grid: baseGrid({ top: 16, bottom: 28 }),
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
    xAxis: axis({ type: 'category', data: years }),
    yAxis: axis({ type: 'value', minInterval: 1 }),
    series: [{ type: 'bar', data: years.map((year) => counts.get(year) ?? 0), barMaxWidth: 26, itemStyle: { color: COLOR.gold } }],
  };
}

/** The author's most frequent venues as horizontal bars, biggest at the top. */
export function venuesOption(venues: VenueCount[]): EChartsCoreOption {
  const rows = [...venues].reverse();
  return {
    grid: baseGrid({ left: 150, top: 16, bottom: 28 }),
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
    xAxis: axis({ type: 'value', minInterval: 1 }),
    yAxis: axis({ type: 'category', data: rows.map((row) => row.venue), axisLabel: { fontSize: 11 } }),
    series: [
      {
        type: 'bar',
        data: rows.map((row) => row.count),
        barMaxWidth: 16,
        itemStyle: { color: COLOR.verdigris, borderRadius: [0, 3, 3, 0] },
      },
    ],
  };
}
