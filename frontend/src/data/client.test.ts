import { describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '../test/utils';
import { ChartDataError, describeChartDataError, fetchChartData } from './client';

const OVERVIEW = { total_records: 10, excluded_records: 1, year_min: 2000, year_max: 2001, distinct_authors: 5, distinct_venues: 2 };

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the fetch to fail');
}

describe('fetchChartData', () => {
  it('returns validated data from public/data', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(OVERVIEW));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchChartData('overview')).resolves.toEqual(OVERVIEW);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/data\/overview\.json$/);
  });

  it('reports a missing file (404 or not JSON) as "missing"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>nope</h1>', { status: 404, headers: { 'content-type': 'text/html' } })));
    const error = (await failureOf(fetchChartData('overview'))) as ChartDataError;
    expect(error).toBeInstanceOf(ChartDataError);
    expect(error.kind).toBe('missing');
    expect(error.file).toBe('overview.json');
  });

  it('reports a network failure as "missing"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(((await failureOf(fetchChartData('overview'))) as ChartDataError).kind).toBe('missing');
  });

  it('reports the wrong shape as "invalid", naming the file and the problem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ...OVERVIEW, total_records: 'lots' })));
    const error = (await failureOf(fetchChartData('overview'))) as ChartDataError;
    expect(error.kind).toBe('invalid');
    expect(error.message).toContain('overview.json');
    expect(error.message).toContain('total_records');
  });

  it('lets a cancelled request through untouched', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))));
    expect(await failureOf(fetchChartData('overview', controller.signal))).not.toBeInstanceOf(ChartDataError);
  });

  it('tells the user how to regenerate the data', () => {
    expect(describeChartDataError(new ChartDataError('missing', 'x.json', 'HTTP 404'))).toMatch(/build_chart_data\.py/);
    expect(describeChartDataError(new ChartDataError('invalid', 'x.json', 'bad'))).toMatch(/expected shape/);
  });
});
