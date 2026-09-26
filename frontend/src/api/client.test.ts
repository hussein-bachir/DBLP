import { describe, expect, it, vi } from 'vitest';

import { jsonResponse, STATUS } from '../test/utils';
import { ApiError, api, describeError } from './client';

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected the request to fail');
}

describe('api client', () => {
  it('returns the parsed body on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(STATUS)));
    await expect(api.status()).resolves.toEqual(STATUS);
  });

  it('encodes the query text', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ query: '', results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await api.search('mérouane & co');
    expect(fetchMock).toHaveBeenCalledWith('/api/search?q=m%C3%A9rouane%20%26%20co', { signal: undefined });
  });

  it.each([
    [503, { ready: false, error: 'not built' }, 'noindex'],
    [404, { error: 'no such author' }, 'notfound'],
    [422, { error: "invalid 'id'" }, 'invalid'],
    [500, { error: 'boom' }, 'server'],
  ])('maps HTTP %i to the %s kind', async (status, body, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(body, status)));
    const error = await failureOf(api.author(1));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe(kind);
  });

  it('treats a non-JSON answer (e.g. a static file server) as "unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<h1>404</h1>', { status: 404, headers: { 'content-type': 'text/html' } })));
    expect(((await failureOf(api.status())) as ApiError).kind).toBe('unavailable');
  });

  it('treats a network failure as "unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(((await failureOf(api.status())) as ApiError).kind).toBe('unavailable');
  });

  it('lets a cancelled request through untouched instead of reporting it as a failure', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('aborted', 'AbortError'))));
    const error = await failureOf(api.status(controller.signal));
    expect(error).not.toBeInstanceOf(ApiError);
  });
});

describe('describeError', () => {
  it('tells the user what to run', () => {
    expect(describeError(new ApiError('unavailable', 'x'))).toMatch(/python server\.py/);
    expect(describeError(new ApiError('noindex', 'x'))).toMatch(/build_author_index\.py/);
  });
});
