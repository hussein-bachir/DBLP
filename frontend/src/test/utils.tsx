import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { vi } from 'vitest';

import type { AskDiagnostics, AskStatus, Paper, Profile, SearchResponse } from '../api/types';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A text/event-stream response carrying `events` as `data:` lines, one network chunk each. */
export function eventStream(events: unknown[], { keepOpen = false } = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}

`));
      if (!keepOpen) controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

type Handler = (url: URL) => Response | Promise<Response>;

/** Replace fetch with a table of handlers keyed by URL path, e.g. '/api/search'. */
export function stubApi(handlers: Record<string, Handler>) {
  // typed with `init` so tests can read back what was sent (method, body, signal)
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input) => {
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

export const ASK_STATUS: AskStatus = {
  keyword_search: true,
  semantic_search: false,
  semantic_papers: 0,
  semantic_min_year: null,
  semantic_error: null,
  providers: [
    { id: 'groq', label: 'Groq', default_model: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
    { id: 'ollama', label: 'Ollama (local)', default_model: 'qwen2.5:7b', models: ['qwen2.5:7b'] },
  ],
  default_provider: 'groq',
};

/** Diagnostics of a typical hybrid-search answer; `overrides` replace top-level fields. */
export function makeDiagnostics(overrides: Partial<AskDiagnostics> = {}): AskDiagnostics {
  return {
    total_seconds: 6.12,
    first_token_seconds: 0.81,
    model_seconds: 4.2,
    tool_seconds: 1.9,
    rounds: 2,
    tokens: { prompt: 1600, completion: 250 },
    steps: [
      {
        tool: 'search_papers',
        summary: 'Searching titles for “federated learning healthcare”',
        seconds: 1.4,
        results: 12,
        error: null,
        search: { methods: ['keyword', 'semantic'], keyword_all: 143, keyword_any: 200, semantic: 200, shown: 12, cap: 200, coverage: 'partial' },
      },
      { tool: 'topic_stats', summary: 'Counting titles containing “federated learning” by year', seconds: 0.5, results: 9, error: null, search: null },
    ],
    search: { searches: 1, methods: ['keyword', 'semantic'], coverage: 'partial', semantic_min_year: 2024 },
    citations: { cited: 6, valid: 5, dropped: 1 },
    guard_nudged: false,
    retracted: 0,
    declined: false,
    tested: {
      search: { method: 'hybrid', precision: 0.68, queries: 10, min_year: 2024, date: '2026-10-09' },
      model: { correct: 6, total: 6, date: '2026-10-09' },
    },
    ...overrides,
  };
}
