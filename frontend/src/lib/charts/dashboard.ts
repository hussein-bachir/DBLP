import type { EChartsCoreOption } from 'echarts/core';

import type { ChartData, YearSeries } from '../../data/schemas';
import { CATEGORICAL, COLOR } from '../theme';
import { abbrevNumber, axis, baseGrid, legend, tooltip, yearZoom } from './common';

// Ratio and average charts open here: earlier years have too few records for a stable share.
export const ZOOM_START_YEAR = 1970;

const TYPE_LABELS: Record<string, string> = { article: 'Journal article', inproceedings: 'Conference paper' };

export function publicationsPerYearOption(rows: ChartData<'publicationsPerYear'>): EChartsCoreOption {
  const years = rows.map((row) => row.year);
  return {
    grid: baseGrid({ bottom: 64 }),
    dataZoom: yearZoom(years, null),
    tooltip: tooltip({ trigger: 'axis' }),
    xAxis: axis({ type: 'category', data: years }),
    yAxis: axis({ type: 'value' }),
    series: [
      {
        type: 'line',
        data: rows.map((row) => row.count),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.gold, width: 2.5 },
        itemStyle: { color: COLOR.gold },
        areaStyle: { color: 'rgba(201,162,39,0.10)' },
      },
    ],
  };
}

export function typeDistributionOption(rows: ChartData<'typeDistribution'>): EChartsCoreOption {
  return {
    tooltip: tooltip({ trigger: 'item', formatter: '{b}: {c} ({d}%)' }),
    legend: legend({ bottom: 0 }),
    series: [
      {
        type: 'pie',
        radius: ['38%', '72%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: COLOR.card, borderWidth: 2 },
        // Outside labels ("Conference paper") get clipped at the canvas edge in a narrow
        // card, and the legend already names each slice, so show only the share inside the ring.
        label: {
          show: true,
          position: 'inside',
          formatter: (params: { percent: number }) => `${Math.round(params.percent)}%`,
          color: COLOR.ink,
          fontFamily: 'IBM Plex Mono',
          fontWeight: 600,
        },
        labelLine: { show: false },
        color: [COLOR.gold, COLOR.verdigris],
        data: rows.map((row) => ({ name: TYPE_LABELS[row.type] ?? row.type, value: row.count })),
      },
    ],
  };
}

/** Horizontal bars with the biggest value at the top (authors, venues, title words). */
export function hbarOption(rows: Array<{ label: string; value: number }>, color: string): EChartsCoreOption {
  const sorted = [...rows].sort((a, b) => a.value - b.value);
  return {
    grid: baseGrid({ left: 160 }),
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
    xAxis: axis({ type: 'value', axisLabel: { formatter: abbrevNumber } }),
    yAxis: axis({ type: 'category', data: sorted.map((row) => row.label), axisLabel: { fontSize: 11 } }),
    series: [
      {
        type: 'bar',
        data: sorted.map((row) => row.value),
        itemStyle: { color, borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 16,
      },
    ],
  };
}

export function coauthorDistributionOption(rows: ChartData<'coauthorDistribution'>): EChartsCoreOption {
  return {
    grid: baseGrid(),
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
    xAxis: axis({ type: 'category', data: rows.map((row) => row.n_authors), name: 'authors', nameTextStyle: { color: COLOR.textFaint } }),
    yAxis: axis({ type: 'value' }),
    series: [{ type: 'bar', data: rows.map((row) => row.count), itemStyle: { color: COLOR.verdigris } }],
  };
}

export function teamSizeOption(rows: ChartData<'avgTeamSize'>): EChartsCoreOption {
  const years = rows.map((row) => row.year);
  return {
    grid: baseGrid({ bottom: 64 }),
    dataZoom: yearZoom(years, ZOOM_START_YEAR),
    tooltip: tooltip({ trigger: 'axis' }),
    xAxis: axis({ type: 'category', data: years }),
    yAxis: axis({ type: 'value', scale: true }),
    series: [
      {
        type: 'line',
        data: rows.map((row) => row.avg_authors),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.rose, width: 2.5 },
        itemStyle: { color: COLOR.rose },
      },
    ],
  };
}

/** Log scale: a bucket with no authors is drawn as 1 (a log axis can't show 0). */
export function authorProductivityOption(rows: ChartData<'authorProductivity'>): EChartsCoreOption {
  return {
    grid: baseGrid(),
    tooltip: tooltip({ trigger: 'axis', axisPointer: { type: 'shadow' } }),
    xAxis: axis({ type: 'category', data: rows.map((row) => row.bucket), name: 'papers published' }),
    yAxis: axis({ type: 'log', name: 'authors (log)' }),
    series: [{ type: 'bar', data: rows.map((row) => Math.max(row.count, 1)), itemStyle: { color: COLOR.clay } }],
  };
}

export function venuesPerYearOption(rows: ChartData<'venuesPerYear'>): EChartsCoreOption {
  const years = rows.map((row) => row.year);
  return {
    grid: baseGrid({ bottom: 64 }),
    dataZoom: yearZoom(years, ZOOM_START_YEAR),
    tooltip: tooltip({ trigger: 'axis' }),
    xAxis: axis({ type: 'category', data: years }),
    yAxis: axis({ type: 'value' }),
    series: [
      {
        type: 'line',
        data: rows.map((row) => row.distinct_venues),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: COLOR.sage, width: 2.5 },
        itemStyle: { color: COLOR.sage },
      },
    ],
  };
}

/** One line per keyword/venue over the years (topic trends, venue comparison). */
export function multiLineOption(data: YearSeries, yName: string, startYear: number | null = ZOOM_START_YEAR): EChartsCoreOption {
  return {
    grid: baseGrid({ bottom: 64 }),
    dataZoom: yearZoom(data.years, startYear),
    tooltip: tooltip({ trigger: 'axis' }),
    legend: legend({ top: 0 }),
    color: [...CATEGORICAL],
    xAxis: axis({ type: 'category', data: data.years }),
    yAxis: axis({ type: 'value', name: yName, nameTextStyle: { color: COLOR.textFaint } }),
    series: Object.entries(data.series).map(([name, values], index) => ({
      name,
      type: 'line',
      data: values,
      smooth: true,
      showSymbol: false,
      // the palette has near-twin golds and greens; dash the later series so they
      // stay distinguishable where lines overlap
      lineStyle: { width: 2.25, type: index >= 6 ? 'dashed' : 'solid' },
    })),
  };
}
