import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import type { Paper, Profile, SearchResponse } from '../api/types';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

type Handler = (url: URL) => Response | Promise<Response>;

/** Replace fetch with a table of handlers keyed by URL path, e.g. '/api/search'. */
export function stubApi(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const handler = handlers[url.pathname];
    return handler ? handler(url) : jsonResponse({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// The real files backend/build_chart_data.py wrote, so dashboard tests run on real data.
const realChartFiles = import.meta.glob('../../public/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function realChartData(file: string): unknown {
  return realChartFiles[`../../public/data/${file}`];
}

/** Serve public/data/*.json from the real files; `overrides` (keyed by file name) replace individual responses. */
export function stubChartData(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const name = new URL(String(input), 'http://localhost').pathname.split('/').pop() ?? '';
    const override = overrides[name];
    if (override) return override();
    const data = realChartData(name);
    return data === undefined ? jsonResponse({ error: 'not found' }, 404) : jsonResponse(data);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function callsTo(fetchMock: ReturnType<typeof stubApi>, path: string): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input), 'http://localhost')).filter((url) => url.pathname === path);
}

export function LocationDisplay() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

export function renderWithProviders(ui: ReactElement, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

export const STATUS = { ready: true, authors: 4263299, papers: 8423776 };

export const HAZIMEH_SEARCH: SearchResponse = {
  query: 'hussein hazimeh',
  corrected: null,
  hint: null,
  results: [
    {
      id: 629736,
      name: 'Hussein Hazimeh 0001',
      n_papers: 37,
      first_year: 2015,
      last_year: 2026,
      venues: [{ venue: 'journals/corr', count: 18 }],
    },
    {
      id: 1041880,
      name: 'Hussein Hazimeh 0002',
      n_papers: 25,
      first_year: 2014,
      last_year: 2026,
      venues: [
        { venue: 'conf/icsca', count: 2 },
        { venue: 'conf/kes', count: 2 },
      ],
    },
  ],
};

export function makePapers(count: number, startAt = 0): Paper[] {
  return Array.from({ length: count }, (_, i) => ({
    key: `conf/test/Paper${startAt + i}`,
    title: `Paper number ${startAt + i}.`,
    year: 2026 - ((startAt + i) % 10),
    type: (startAt + i) % 2 === 0 ? 'article' : 'inproceedings',
    venue: 'conf/test',
  }));
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1041880,
    name: 'Hussein Hazimeh 0002',
    n_papers: 25,
    first_year: 2014,
    last_year: 2026,
    n_articles: 9,
    n_inproceedings: 16,
    n_coauthors: 44,
    n_venues: 20,
    per_year: [
      [2014, 1],
      [2016, 2],
    ],
    venues: [{ venue: 'conf/icsca', count: 2 }],
    coauthors: [
      { id: 5, name: 'Elena Mugellini', shared: 10 },
      { id: 6, name: 'Rahul Mazumder 0001', shared: 3 },
    ],
    papers: makePapers(25),
    ...overrides,
  };
}
