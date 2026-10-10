import { z } from 'zod';

import type { AskEvent, AskRequest } from './types';

// POST /api/ask answers with server-sent events. EventSource can only GET, so
// the stream is read from fetch() and split into events here. Each `data:`
// payload is validated, so a backend change the page doesn't understand fails
// with a clear message instead of rendering garbage.

const authorRef = z.object({ id: z.number().int(), name: z.string() });

const sourcePaper = z.object({
  ref: z.string(),
  id: z.number().int(),
  key: z.string(),
  title: z.string().nullable(),
  year: z.number().int().nullable(),
  venue: z.string(),
  type: z.enum(['article', 'inproceedings']),
  authors: z.array(authorRef),
  n_authors: z.number().int(),
});

const count = z.number().int().nonnegative();
const coverage = z.enum(['full', 'partial', 'none']).nullable();

const searchStats = z.object({
  methods: z.array(z.string()),
  keyword_all: count,
  keyword_any: count.nullable(), // null: the some-words query wasn't needed
  semantic: count,
  shown: count,
  cap: count,
  coverage,
});

// How the answer was produced (see AskDiagnostics in backend/api.py).
const diagnostics = z.object({
  total_seconds: z.number(),
  first_token_seconds: z.number().nullable(),
  model_seconds: z.number(),
  tool_seconds: z.number(),
  rounds: count,
  tokens: z.object({ prompt: count, completion: count }).nullable(),
  steps: z.array(
    z.object({
      tool: z.string(),
      summary: z.string(),
      seconds: z.number(),
      results: count,
      error: z.string().nullable(),
      search: searchStats.nullable(),
    }),
  ),
  search: z.object({
    searches: count,
    methods: z.array(z.string()),
    coverage,
    semantic_min_year: z.number().int().nullable(),
  }),
  citations: z.object({ cited: count, valid: count, dropped: count }),
  guard_nudged: z.boolean(),
  retracted: count,
  declined: z.boolean(),
  tested: z
    .object({
      search: z
        .object({
          method: z.string(),
          precision: z.number(),
          queries: z.number().int().nullable(),
          min_year: z.number().int().nullable(),
          date: z.string().nullable(),
        })
        .nullable(),
      model: z.object({ correct: count, total: count, date: z.string().nullable() }).nullable(),
    })
    .nullable(),
});

export const AskEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), text: z.string() }),
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({ type: z.literal('retract') }),
  z.object({
    type: z.literal('done'),
    sources: z.array(sourcePaper),
    authors: z.array(authorRef),
    provider: z.string().nullable(),
    model: z.string(),
    tool_calls: z.number().int(),
    diagnostics,
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

// compile-time check that the runtime schema matches the generated API types
const _sameShape: (event: z.infer<typeof AskEventSchema>) => AskEvent = (event) => event;
void _sameShape;

/**
 * An incremental server-sent-events parser: feed it decoded text as it
 * arrives (events may be split anywhere across chunks) and it calls `onData`
 * with each complete event's data. Comment lines (": keep-alive") are ignored.
 */
export function createSseParser(onData: (data: string) => void) {
  let buffer = '';
  let data: string[] = [];

  function line(text: string) {
    if (text === '') {
      if (data.length > 0) onData(data.join('\n'));
      data = [];
    } else if (text.startsWith('data:')) {
      data.push(text.slice(text.startsWith('data: ') ? 6 : 5));
    } // comments (":") and other fields (event:, id:, retry:) are not used by this API
  }

  return {
    feed(chunk: string) {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';
      lines.forEach(line);
    },
    /** End of stream: dispatch a final event that wasn't followed by a blank line. */
    end() {
      if (buffer) line(buffer);
      buffer = '';
      line('');
    },
  };
}

export class AskError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AskError';
    this.status = status;
  }
}

/** Ask a question; `onEvent` gets each event as it streams in. Resolves when the stream ends. */
export async function askStream(request: AskRequest, onEvent: (event: AskEvent) => void, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AskError('The backend server is not reachable. In the backend folder run python server.py.');
  }

  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('text/event-stream')) {
    let message = `HTTP ${response.status}`;
    if (type.includes('json')) {
      const body: unknown = await response.json().catch(() => null);
      if (typeof body === 'object' && body !== null && 'error' in body) message = String((body as { error: unknown }).error);
    } else if (response.ok) {
      message = 'The server answered with something other than an event stream.';
    }
    throw new AskError(message, response.status);
  }
  if (!response.body) throw new AskError('The server sent an empty response.', response.status);

  const parser = createSseParser((data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new AskError('The server sent an event that is not JSON.');
    }
    const result = AskEventSchema.safeParse(parsed);
    if (!result.success) throw new AskError('The server sent an event this page does not understand.');
    onEvent(result.data);
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.feed(decoder.decode(value, { stream: true })); // stream: a character may be split across chunks
    }
    parser.feed(decoder.decode());
    parser.end();
  } catch (error) {
    void reader.cancel().catch(() => undefined); // close the connection; the server then stops working on it
    throw error;
  }
}
