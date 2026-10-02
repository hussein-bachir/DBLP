import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { Link } from 'react-router-dom';
import remarkGfm from 'remark-gfm';

import { AskError, askStream } from '../api/ask';
import { describeError } from '../api/client';
import { useAskStatus } from '../api/hooks';
import type { AskStatus, SourcePaper } from '../api/types';
import { NameWithTag } from '../components/NameWithTag';
import { askReducer, initialAskState } from '../lib/askState';
import { linkCitations, sourceAnchor } from '../lib/citations';
import { plural, recordUrl } from '../lib/format';
import { SITE_TITLE } from '../lib/site';

export const EXAMPLES = [
  'How many papers with "large language model" in the title were published each year since 2019?',
  'Which venues publish the most papers on graph neural networks?',
  'Show me recent papers on federated learning in healthcare.',
  'Who has published the most papers about quantum computing since 2020?',
  'Where does Hussein Hazimeh publish, and who are his co-authors?',
];

const MAX_QUESTION = 1000;

function scrollToHash(event: MouseEvent<HTMLAnchorElement>) {
  const id = event.currentTarget.getAttribute('href')?.slice(1);
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  event.preventDefault(); // scroll without adding a history entry for every citation clicked
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.remove('is-flashed');
  void target.offsetWidth; // restart the highlight animation
  target.classList.add('is-flashed');
}

const markdownComponents: Components = {
  a: ({ href, children }) =>
    href?.startsWith('#') ? (
      <a href={href} className="cite" onClick={scrollToHash}>
        {children}
      </a>
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
};

function Notices({ status }: { status: AskStatus }) {
  return (
    <>
      {!status.keyword_search && (
        <p className="ask-notice is-error">
          The title index hasn{'’'}t been built yet. In the backend folder run <code>python build_title_index.py</code> (about a minute).
        </p>
      )}
      {status.providers.length === 0 && (
        <p className="ask-notice is-error">
          No language model is configured. Copy <code>backend/.env.example</code> to <code>backend/.env</code> and add a free API key (Groq, Mistral,
          Gemini or OpenRouter), or start Ollama, then reload.
        </p>
      )}
      {status.keyword_search && !status.semantic_search && (
        <p className="ask-notice">
          {status.semantic_error ?? 'Keyword search only: topic questions match title words, not meaning.'} Building the title vectors (
          <code>python build_title_vectors.py</code>) adds meaning-based search.
        </p>
      )}
      {status.semantic_search && status.semantic_min_year !== null && (
        <p className="ask-notice">
          Meaning-based search covers papers from {status.semantic_min_year} on; older papers are found by keywords only.
        </p>
      )}
    </>
  );
}

function SourceItem({ source }: { source: SourcePaper }) {
  const kind = source.type === 'article' ? 'journal article' : 'conference paper';
  const more = source.n_authors - source.authors.length;
  return (
    <li id={sourceAnchor(source.ref)}>
      <span className="source-ref">{source.ref}</span>
      <div>
        <a href={recordUrl(source.key)} target="_blank" rel="noopener noreferrer">
          {source.title || '(untitled)'}
        </a>
        <div className="pub-meta">{[source.year ?? 'year n/a', source.venue, kind].join(' · ')}</div>
        {source.authors.length > 0 && (
          <div className="pub-meta">
            {source.authors.map((author, i) => (
              <span key={author.id}>
                {i > 0 && ', '}
                <Link to={`/author/${author.id}`}>
                  <NameWithTag name={author.name} />
                </Link>
              </span>
            ))}
            {more > 0 && ` and ${plural(more, 'other')}`}
          </div>
        )}
      </div>
    </li>
  );
}

export default function AskPage() {
  const status = useAskStatus();
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const [question, setQuestion] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = `Ask · ${SITE_TITLE}`;
    return () => {
      document.title = SITE_TITLE;
      controller.current?.abort(); // leaving the page stops the answer (the server stops too)
    };
  }, []);

  const providers = useMemo(() => status.data?.providers ?? [], [status.data]);
  const chosen = providers.find((p) => p.id === provider) ?? providers.find((p) => p.id === status.data?.default_provider) ?? providers[0];
  const asking = state.phase === 'asking';
  const canAsk = !asking && question.trim().length > 0 && chosen !== undefined && status.data?.keyword_search === true;

  async function ask(text: string) {
    if (!chosen) return;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    dispatch({ type: 'start', question: text });
    try {
      await askStream(
        { question: text, provider: chosen.id, model: model.trim() || null },
        (event) => dispatch({ type: 'event', event }),
        abort.signal,
      );
      if (!abort.signal.aborted) dispatch({ type: 'fail', message: 'The answer stopped before it was finished. Try again.' });
    } catch (error) {
      if (abort.signal.aborted) return;
      dispatch({ type: 'fail', message: error instanceof AskError ? error.message : 'Something went wrong.' });
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (canAsk) void ask(question.trim());
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  }

  function stop(event: MouseEvent<HTMLButtonElement>) {
    // Stopping re-renders the button as Ask (type="submit") while the click is still being
    // handled; without this the browser then submits the form and asks the question again.
    event.preventDefault();
    controller.current?.abort();
    dispatch({ type: 'stop' });
  }

  const known = useMemo(() => new Set(state.sources.map((s) => s.ref)), [state.sources]);
  // while streaming, the sources aren't known yet: show citations as typed, link them once done
  const answer = state.phase === 'done' ? linkCitations(state.answer, known) : state.answer;

  return (
    <section className="profile ask">
      <div className="profile-head">
        <div>
          <p className="profile-kicker">Ask the data</p>
          <h1>Questions about the publication record</h1>
          <p className="profile-sub">
            A language model answers by searching and counting the DBLP index: every title, year, venue and author, 1936 to today. It sees no
            abstracts, citations or affiliations, and every paper it mentions is listed below with a link to dblp.org.
          </p>
        </div>
      </div>

      {status.error && <p className="ask-notice is-error">{describeError(status.error)}</p>}
      {status.data && <Notices status={status.data} />}

      <form className="ask-form" onSubmit={submit}>
        <label htmlFor="ask-question" className="visually-hidden">
          Your question
        </label>
        <textarea
          id="ask-question"
          rows={3}
          maxLength={MAX_QUESTION}
          placeholder="e.g. Which venues publish the most papers on graph neural networks?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="ask-controls">
          <label>
            Model provider
            <select
              value={chosen?.id ?? ''}
              disabled={providers.length === 0 || asking}
              onChange={(e) => {
                setProvider(e.target.value);
                setModel('');
              }}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Model
            <input
              list="ask-models"
              value={model}
              placeholder={chosen?.default_model ?? ''}
              disabled={!chosen || asking}
              maxLength={120}
              onChange={(e) => setModel(e.target.value)}
            />
            <datalist id="ask-models">
              {chosen?.models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          {/* separate keys: never the same DOM element (see stop()) */}
          {asking ? (
            <button key="stop" type="button" onClick={stop}>
              Stop
            </button>
          ) : (
            <button key="ask" type="submit" disabled={!canAsk}>
              Ask
            </button>
          )}
        </div>
      </form>

      {state.phase === 'idle' && (
        <div className="ask-examples">
          <p className="profile-count">Try one of these:</p>
          <ul className="chips">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button type="button" onClick={() => setQuestion(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.phase !== 'idle' && (
        <div className="ask-result">
          <p className="ask-question">{state.question}</p>
          {state.steps.length > 0 && (
            <ol className="ask-steps" aria-label="What the model looked up">
              {state.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          <div className="ask-answer" aria-live="polite" aria-busy={asking}>
            {answer ? (
              <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {answer}
              </Markdown>
            ) : (
              asking && <p className="profile-note">Thinking{'…'}</p>
            )}
          </div>
          {state.phase === 'error' && (
            <p className="ask-notice is-error" role="alert">
              {state.error}
            </p>
          )}
          {state.phase === 'stopped' && <p className="profile-note">Stopped.</p>}
          {state.answeredBy && (
            <p className="profile-count">
              Answered by {state.answeredBy.model}
              {state.answeredBy.provider && ` (${state.answeredBy.provider})`} after {plural(state.answeredBy.toolCalls, 'lookup')}. Language
              models can misread their tool results: check the figures against the sources.
            </p>
          )}
          {state.authors.length > 0 && (
            <section className="profile-panel">
              <h3>Researchers mentioned</h3>
              <ul className="chips">
                {state.authors.map((author) => (
                  <li key={author.id}>
                    <Link to={`/author/${author.id}`}>
                      <NameWithTag name={author.name} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {state.sources.length > 0 && (
            <section className="profile-panel">
              <h3>
                Sources <span className="profile-count">({plural(state.sources.length, 'paper')} cited)</span>
              </h3>
              <ol className="pubs ask-sources">
                {state.sources.map((source) => (
                  <SourceItem key={source.ref} source={source} />
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
