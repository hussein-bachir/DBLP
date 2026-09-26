import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { ApiError, api } from './client';

export const PAGE_SIZE = 50;
export const MIN_QUERY_CHARS = 3;

// Retrying only helps for transient failures; "server down" and "no index" won't fix themselves.
const retryTransient = (failures: number, error: Error) =>
  !(error instanceof ApiError) || error.kind === 'server' ? failures < 2 : false;

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: ({ signal }) => api.status(signal), staleTime: 60_000, retry: retryTransient });
}

export function useSearch(query: string) {
  return useQuery({
    queryKey: ['search', query],
    queryFn: ({ signal }) => api.search(query, signal), // the signal cancels a superseded keystroke's request
    enabled: query.length >= MIN_QUERY_CHARS,
    placeholderData: keepPreviousData, // keep the old list on screen while the next one loads
    staleTime: 5 * 60_000,
    retry: retryTransient,
  });
}

export function useAuthor(id: number | null) {
  return useQuery({
    queryKey: ['author', id],
    queryFn: ({ signal }) => api.author(id as number, signal),
    enabled: id !== null,
    staleTime: Infinity, // the dataset is a fixed dump
    retry: retryTransient,
  });
}

/** Pages after the first one; the first PAGE_SIZE papers arrive inside the profile itself. */
export function useMorePapers(id: number) {
  return useInfiniteQuery({
    queryKey: ['papers', id],
    queryFn: ({ pageParam, signal }) => api.papers(id, pageParam, PAGE_SIZE, signal),
    initialPageParam: PAGE_SIZE,
    getNextPageParam: (last, _all, lastOffset) => (last.papers.length < PAGE_SIZE ? undefined : lastOffset + PAGE_SIZE),
    enabled: false, // only fetched when the user asks for more
    staleTime: Infinity,
  });
}
