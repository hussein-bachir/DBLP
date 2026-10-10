import type { AskDiagnostics, AskEvent, AuthorRef, SourcePaper } from '../api/types';

export type AskPhase = 'idle' | 'asking' | 'done' | 'stopped' | 'error';

export interface AskState {
  phase: AskPhase;
  question: string;
  answer: string; // Markdown, as streamed so far
  steps: string[]; // what the tools did, in order ("Searching titles for …")
  sources: SourcePaper[];
  authors: AuthorRef[];
  answeredBy: { provider: string | null; model: string; toolCalls: number; diagnostics: AskDiagnostics } | null;
  error: string | null;
}

export type AskAction =
  | { type: 'start'; question: string }
  | { type: 'event'; event: AskEvent }
  | { type: 'fail'; message: string }
  | { type: 'stop' };

export const initialAskState: AskState = {
  phase: 'idle',
  question: '',
  answer: '',
  steps: [],
  sources: [],
  authors: [],
  answeredBy: null,
  error: null,
};

export function askReducer(state: AskState, action: AskAction): AskState {
  switch (action.type) {
    case 'start':
      return { ...initialAskState, phase: 'asking', question: action.question };
    case 'stop':
      return state.phase === 'asking' ? { ...state, phase: 'stopped' } : state;
    case 'fail': // the request failed, or the stream ended without a done/error event
      return state.phase === 'asking' ? { ...state, phase: 'error', error: action.message } : state;
    case 'event':
      break;
  }
  if (state.phase !== 'asking') return state; // a late event after stop/finish changes nothing
  const event = action.event;
  switch (event.type) {
    case 'status':
      return { ...state, steps: [...state.steps, event.text] };
    case 'token':
      return { ...state, answer: state.answer + event.text };
    case 'retract': // the text so far was the model thinking aloud before a tool call
      return { ...state, answer: '' };
    case 'done':
      return {
        ...state,
        phase: 'done',
        sources: event.sources,
        authors: event.authors,
        answeredBy: { provider: event.provider, model: event.model, toolCalls: event.tool_calls, diagnostics: event.diagnostics },
      };
    case 'error':
      return { ...state, phase: 'error', error: event.message };
  }
}
