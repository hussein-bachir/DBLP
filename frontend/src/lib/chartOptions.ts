import type { EChartsCoreOption } from 'echarts/core';

import type { Profile, VenueCount } from '../api/types';
import { COLOR } from './theme';

const axisStyle = {
  axisLine: { lineStyle: { color: COLOR.hairline } },
  axisTick: { show: false },
  axisLabel: { color: COLOR.textSecondary, fontFamily: 'IBM Plex Mono' },
  splitLine: { lineStyle: { color: COLOR.hairline, type: 'dashed' as const } },
};

const tooltip = {
  trigger: 'axis' as const,
  axisPointer: { type: 'shadow' as const },
  backgroundColor: COLOR.card,
  borderColor: COLOR.hairline,
  textStyle: { color: COLOR.text, fontFamily: 'IBM Plex Sans' },
};

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
    grid: { left: 56, right: 24, top: 16, bottom: 28, containLabel: true },
    tooltip,
    xAxis: { type: 'category', data: years, ...axisStyle },
    yAxis: { type: 'value', minInterval: 1, ...axisStyle },
    series: [{ type: 'bar', data: years.map((year) => counts.get(year) ?? 0), barMaxWidth: 26, itemStyle: { color: COLOR.gold } }],
  };
}

/** The author's most frequent venues as horizontal bars, biggest at the top. */
export function venuesOption(venues: VenueCount[]): EChartsCoreOption {
  const rows = [...venues].reverse();
  return {
    grid: { left: 150, right: 24, top: 16, bottom: 28, containLabel: true },
    tooltip,
    xAxis: { type: 'value', minInterval: 1, ...axisStyle },
    yAxis: {
      type: 'category',
      data: rows.map((row) => row.venue),
      ...axisStyle,
      axisLabel: { ...axisStyle.axisLabel, fontSize: 11 },
    },
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
