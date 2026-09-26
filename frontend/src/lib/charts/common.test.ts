import { describe, expect, it } from 'vitest';

import { COLOR } from '../theme';
import { abbrevNumber, axis, baseGrid, yearZoom } from './common';

describe('abbrevNumber', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1k'],
    [5500, '5.5k'],
    [30000, '30k'],
    [-2000, '-2k'],
  ])('%d -> %s', (value, expected) => {
    expect(abbrevNumber(value)).toBe(expected);
  });
});

describe('axis', () => {
  it('merges a custom axisLabel into the house style instead of replacing it', () => {
    const result = axis({ type: 'category', axisLabel: { fontSize: 11 } });
    expect(result.axisLabel).toEqual({ color: COLOR.textSecondary, fontFamily: 'IBM Plex Mono', fontSize: 11 });
    expect(result.axisTick).toEqual({ show: false });
  });

  it('keeps the default label style when none is given', () => {
    expect(axis().axisLabel.color).toBe(COLOR.textSecondary);
  });
});

describe('baseGrid', () => {
  it('lets a chart with a zoom slider make room at the bottom', () => {
    expect(baseGrid()).toMatchObject({ left: 56, right: 24, top: 28, bottom: 36, containLabel: true });
    expect(baseGrid({ bottom: 64 }).bottom).toBe(64);
  });
});

describe('yearZoom', () => {
  const years = Array.from({ length: 90 }, (_, i) => 1936 + i); // 1936..2025

  it('opens on the whole range when no start year is given', () => {
    const [inside, slider] = yearZoom(years, null) as Array<{ startValue: number; endValue: number }>;
    expect(inside?.startValue).toBe(0);
    expect(slider?.startValue).toBe(0);
    expect(slider?.endValue).toBe(89);
  });

  it('opens at the index of the first year at or after the start year', () => {
    const [inside, slider] = yearZoom(years, 1970) as Array<{ startValue: number }>;
    expect(inside?.startValue).toBe(34); // 1970 - 1936
    expect(slider?.startValue).toBe(34);
  });

  it('starts at the first later year when the start year itself has no data', () => {
    const sparse = [1936, 1940, 1975, 1980];
    expect((yearZoom(sparse, 1970)[0] as { startValue: number }).startValue).toBe(2);
  });

  it('shows everything rather than nothing when the start year is beyond the data', () => {
    expect((yearZoom(years, 2100)[0] as { startValue: number }).startValue).toBe(0);
  });

  it('copes with an empty series', () => {
    expect((yearZoom([], 1970)[1] as { endValue: number }).endValue).toBe(0);
  });
});
