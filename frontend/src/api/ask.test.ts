import { describe, expect, it, vi } from 'vitest';

import { eventStream, jsonResponse } from '../test/utils';
import { AskError, askStream, createSseParser } from './ask';
import type { AskEvent } from './types';

function parse(chunks: string[], end = true): string[] {
  const out: string[] = [];
  const parser = createSseParser((data) => out.push(data));
  chunks.forEach((chunk) => parser.feed(chunk));
  if (end) parser.end();
  return out;
}

describe('createSseParser', () => {
  it('splits a stream into events', () => {
    expect(parse(['data: {"a":1}\n\ndata: {"b":2}\n\n'])).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('reassembles an event split anywhere across chunks', () => {
    const whole = 'data: {"type":"token","text":"hé"}\n\n';
    for (let cut = 1; cut < whole.length; cut++) {
      expect(parse([whole.slice(0, cut), whole.slice(cut)])).toEqual(['{"type":"token","text":"hé"}']);
    }
  });

  it('ignores keep-alive comments', () => {
    expect(parse([': keep-alive\n\n', 'data: x\n\n'])).toEqual(['x']);
  });

  it('accepts CRLF line endings and "data:" without a space', () => {
    expect(parse(['data:x\r\n\r\n'])).toEqual(['x']);
  });

  it('holds an unterminated event until the stream ends', () => {
    expect(parse(['data: x'], false)).toEqual([]);
    expect(parse(['data: x'])).toEqual(['x']);
  });
});

async function collect(response: Response): Promise<AskEvent[]> {
  vi.stubGlobal('fetch', vi.fn(async () => response));
  const events: AskEvent[] = [];
  await askStream({ question: 'q' }, (event) => events.push(event));
  return events;
}

describe('askStream', () => {
  it('delivers validated events in order', async () => {
    const events = await collect(
      eventStream([
        { type: 'status', text: 'Searching' },
        { type: 'token', text: 'Hi' },
        { type: 'done', sources: [], authors: [], provider: 'groq', model: 'm', tool_calls: 1 },
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['status', 'token', 'done']);
  });

  it('decodes a multi-byte character split between network chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"type":"token","text":"é"}\n\n');
    const split = bytes.indexOf(0xc3) + 1; // between the two bytes of é
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const events = await collect(new Response(body, { headers: { 'content-type': 'text/event-stream' } }));
    expect(events).toEqual([{ type: 'token', text: 'é' }]);
  });

  it('posts the question as JSON', async () => {
    const fetchMock = vi.fn(async () => eventStream([]));
    vi.stubGlobal('fetch', fetchMock);
    await askStream({ question: 'q', provider: 'ollama', model: null }, () => undefined);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/ask');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ question: 'q', provider: 'ollama', model: null });
  });

  it("surfaces the server's error message for a rejected request", async () => {
    await expect(collect(jsonResponse({ error: 'No language model is configured.' }, 503))).rejects.toThrow('No language model is configured.');
  });

  it('rejects an event it does not understand', async () => {
    await expect(collect(eventStream([{ type: 'surprise' }]))).rejects.toBeInstanceOf(AskError);
  });

  it('reports an unreachable server', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(askStream({ question: 'q' }, () => undefined)).rejects.toThrow(/not reachable/);
  });
});
