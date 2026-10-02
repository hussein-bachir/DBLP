import { describe, expect, it } from 'vitest';

import type { AskEvent } from '../api/types';
import { askReducer, initialAskState, type AskState } from './askState';

const asking = askReducer(initialAskState, { type: 'start', question: 'q?' });
const feed = (state: AskState, ...events: AskEvent[]) => events.reduce((s, event) => askReducer(s, { type: 'event', event }), state);

const DONE: AskEvent = { type: 'done', sources: [], authors: [{ id: 3, name: 'Ada' }], provider: 'groq', model: 'm', tool_calls: 2 };

describe('askReducer', () => {
  it('starts from a clean slate for each question', () => {
    const finished = feed(asking, { type: 'token', text: 'old' }, DONE);
    const next = askReducer(finished, { type: 'start', question: 'again?' });
    expect(next).toEqual({ ...initialAskState, phase: 'asking', question: 'again?' });
  });

  it('collects tool steps and streamed text', () => {
    const state = feed(asking, { type: 'status', text: 'Searching' }, { type: 'token', text: 'Hel' }, { type: 'token', text: 'lo' });
    expect(state.steps).toEqual(['Searching']);
    expect(state.answer).toBe('Hello');
  });

  it('drops preamble text when the model retracts it to call a tool', () => {
    const state = feed(asking, { type: 'token', text: '{"name": "topic_stats"}' }, { type: 'retract' }, { type: 'token', text: 'Answer' });
    expect(state.answer).toBe('Answer');
  });

  it('finishes with the sources, authors and who answered', () => {
    const state = feed(asking, { type: 'token', text: 'x' }, DONE);
    expect(state.phase).toBe('done');
    expect(state.authors).toEqual([{ id: 3, name: 'Ada' }]);
    expect(state.answeredBy).toEqual({ provider: 'groq', model: 'm', toolCalls: 2 });
  });

  it('reports an error event', () => {
    const state = feed(asking, { type: 'error', message: 'rate limited' });
    expect(state).toMatchObject({ phase: 'error', error: 'rate limited' });
  });

  it('ignores a late "fail" once the answer is done', () => {
    const done = feed(asking, DONE);
    expect(askReducer(done, { type: 'fail', message: 'stream ended' })).toBe(done);
  });

  it('ignores events that arrive after the user stopped', () => {
    const stopped = askReducer(feed(asking, { type: 'token', text: 'a' }), { type: 'stop' });
    expect(stopped.phase).toBe('stopped');
    expect(feed(stopped, { type: 'token', text: 'b' }, DONE)).toBe(stopped);
  });
});
