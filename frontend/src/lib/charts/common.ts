import { COLOR } from '../theme';

/** Grid with room for axis labels; pass overrides such as { bottom: 64 } when a slider needs space. */
export function baseGrid(overrides: Record<string, unknown> = {}) {
  return { left: 56, right: 24, top: 28, bottom: 36, containLabel: true, ...overrides };
}

const axisBase = {
  axisLine: { lineStyle: { color: COLOR.hairline } },
  axisTick: { show: false },
  axisLabel: { color: COLOR.textSecondary, fontFamily: 'IBM Plex Mono' },
  splitLine: { lineStyle: { color: COLOR.hairline, type: 'dashed' as const } },
};

/** An axis in the house style; `extra.axisLabel` is merged into the default label style, not swapped for it. */
export function axis(extra: { axisLabel?: Record<string, unknown>; [key: string]: unknown } = {}) {
  const { axisLabel, ...rest } = extra;
  return { ...axisBase, ...rest, axisLabel: { ...axisBase.axisLabel, ...axisLabel } };
}

export function tooltip(extra: Record<string, unknown> = {}) {
  return {
    backgroundColor: COLOR.card,
    borderColor: COLOR.hairline,
    textStyle: { color: COLOR.text, fontFamily: 'IBM Plex Sans' },
    ...extra,
  };
}

export function legend(extra: Record<string, unknown> = {}) {
  return { textStyle: { color: COLOR.textSecondary, fontFamily: 'IBM Plex Sans' }, ...extra };
}

/** 5000 -> "5k", so value-axis labels don't overlap in narrow cards. */
export function abbrevNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    const thousands = value / 1000;
    return `${Number.isInteger(thousands) ? thousands.toFixed(0) : thousands.toFixed(1)}k`;
  }
  return String(value);
}

/**
 * Drag/scroll plus slider zoom over a category axis of years. The data covers every
 * year, but shares and averages are noisy in the sparse early decades, so ratio-style
 * charts open at `startYear` and the slider reaches back further.
 */
export function yearZoom(years: readonly number[], startYear: number | null) {
  const found = startYear === null ? 0 : years.findIndex((y) => y >= startYear);
  const startValue = found === -1 ? 0 : found; // a start year beyond the data shows everything
  const endValue = Math.max(years.length - 1, 0);
  return [
    { type: 'inside', startValue, endValue },
    {
      type: 'slider',
      startValue,
      endValue,
      height: 18,
      bottom: 6,
      borderColor: COLOR.hairline,
      backgroundColor: 'rgba(255,255,255,0.03)',
      fillerColor: 'rgba(201,162,39,0.18)',
      handleStyle: { color: COLOR.gold, borderColor: COLOR.gold },
      moveHandleStyle: { color: COLOR.goldDim },
      dataBackground: { lineStyle: { color: COLOR.hairline }, areaStyle: { color: 'rgba(255,255,255,0.04)' } },
      textStyle: { color: COLOR.textFaint, fontFamily: 'IBM Plex Mono' },
    },
  ];
}
