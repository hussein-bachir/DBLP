import type { PapersPage, Profile, SearchResponse, Status } from './types';

export type ApiErrorKind =
  | 'unavailable' // nothing answering with JSON: the server isn't running (or a proxy failed)
  | 'noindex' // the API is up but the author index hasn't been built (503)
  | 'notfound' // 404
  | 'invalid' // 422: the request was rejected
  | 'server'; // anything else

export class ApiError extends Error {
  readonly kind: ApiErrorKind;

  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal });
  } catch (error) {
    if (signal?.aborted) throw error; // a cancelled request is not a failure
    throw new ApiError('unavailable', 'server not reachable');
  }

  const isJson = (response.headers.get('content-type') ?? '').includes('json');
  if (!isJson) throw new ApiError('unavailable', 'no API at this address');

  const body: unknown = await response.json();
  if (response.ok) return body as T;

  const message = typeof body === 'object' && body !== null && 'error' in body ? String((body as { error: unknown }).error) : `HTTP ${response.status}`;
  if (response.status === 503) throw new ApiError('noindex', message);
  if (response.status === 404) throw new ApiError('notfound', message);
  if (response.status === 422) throw new ApiError('invalid', message);
  throw new ApiError('server', message);
}

export const api = {
  status: (signal?: AbortSignal) => request<Status>('/api/status', signal),
  search: (q: string, signal?: AbortSignal) => request<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, signal),
  author: (id: number, signal?: AbortSignal) => request<Profile>(`/api/author?id=${id}`, signal),
  papers: (id: number, offset: number, limit: number, signal?: AbortSignal) =>
    request<PapersPage>(`/api/papers?id=${id}&offset=${offset}&limit=${limit}`, signal),
};

/** User-facing wording for a failed request. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'unavailable':
        return 'Researcher search needs the backend server. In the backend folder run python server.py (the API must be reachable at /api).';
      case 'noindex':
        return "The author index hasn't been built yet. In the backend folder run python build_author_index.py (a few minutes), then restart server.py.";
      case 'notfound':
        return 'No researcher with that id.';
      default:
        return `Something went wrong: ${error.message}`;
    }
  }
  return 'Something went wrong.';
}
