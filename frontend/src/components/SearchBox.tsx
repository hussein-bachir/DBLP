import { useEffect, useId, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError } from '../api/client';
import { MIN_QUERY_CHARS, useSearch, useStatus } from '../api/hooks';
import type { SearchResponse, SearchResult } from '../api/types';
import { fmt, plural, yearSpan } from '../lib/format';
import { useDebouncedValue } from '../lib/useDebouncedValue';
import { NameWithTag } from './NameWithTag';

const DEBOUNCE_MS = 220;

function statusText(opts: {
  typed: string;
  debounced: string;
  fetching: boolean;
  error: unknown;
  data: SearchResponse | undefined;
  index: { authors: number; papers: number } | undefined;
  indexError: unknown;
}): string {
  const { typed, debounced, fetching, error, data, index, indexError } = opts;
  if (typed.length === 0) {
    if (index) return `Searching ${fmt(index.authors)} researchers across ${fmt(index.papers)} DBLP records. Small misspellings are forgiven.`;
    return indexError ? describeError(indexError) : '';
  }
  if (typed.length < MIN_QUERY_CHARS) return 'Type at least 3 letters of a name.';
  if (error) return describeError(error);
  if (typed !== debounced || fetching) return 'Searching…';
  if (!data) return '';
  if (data.hint) return data.hint;
  if (data.results.length === 0) return `No researcher found for “${debounced}”. Try fewer letters or another spelling.`;
  return `${plural(data.results.length, 'match', 'matches')}${data.corrected ? ' (spelling corrected)' : ''}. Use ↑ ↓ and Enter, or click a name.`;
}

/** The combobox pattern: the input keeps focus while arrow keys move a highlight through the listbox. */
export function SearchBox() {
  const navigate = useNavigate();
  const listId = useId();
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  // the highlighted row belongs to one result list; a new list starts back at the top
  const [highlight, setHighlight] = useState<{ list: SearchResponse | undefined; index: number }>({ list: undefined, index: 0 });

  const typed = value.trim();
  const [debounced, flush] = useDebouncedValue(typed, DEBOUNCE_MS);
  const search = useSearch(debounced);
  const index = useStatus();

  // Old results stay on screen while the next ones load, but they answer an earlier
  // query: only results for exactly what is typed now may be picked with Enter.
  const fresh = typed === debounced && !search.isPlaceholderData;
  const [enterQueued, setEnterQueued] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null); // the name filled in by picking a result

  const results: SearchResult[] = search.data?.results ?? [];
  const showList = open && typed.length >= MIN_QUERY_CHARS && results.length > 0;
  const active = highlight.list === search.data ? highlight.index : 0;
  const optionId = (i: number) => `${listId}-option-${i}`;
  const first = results[0];

  function choose(result: SearchResult) {
    setValue(result.name);
    setChosen(result.name);
    setOpen(false);
    setEnterQueued(false);
    void navigate(`/author/${result.id}`);
  }

  // Enter pressed before the results caught up: open the top match once they do.
  useEffect(() => {
    if (enterQueued && fresh && !search.isFetching) {
      setEnterQueued(false);
      if (first) {
        setValue(first.name);
        setChosen(first.name);
        setOpen(false);
        void navigate(`/author/${first.id}`);
      }
    }
  }, [enterQueued, fresh, search.isFetching, first, navigate]);

  function move(step: number) {
    setHighlight({ list: search.data, index: (active + step + results.length) % results.length });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && showList) {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp' && showList) {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = results[active];
      if (showList && fresh && picked) choose(picked);
      else if (typed.length >= MIN_QUERY_CHARS) {
        flush(); // don't wait out the debounce
        setOpen(true);
        setEnterQueued(true);
      }
    } else if (event.key === 'Escape' && open) {
      setOpen(false);
    }
  }

  // once someone is picked the search is finished: show the general hint, not "2 matches, use ↑ ↓"
  const picked = chosen !== null && chosen.trim() === typed;
  const status = statusText({
    typed: picked ? '' : typed,
    debounced,
    fetching: search.isFetching,
    error: typed.length >= MIN_QUERY_CHARS ? search.error : null,
    data: search.data,
    index: index.data,
    indexError: index.error,
  });
  const failed = (typed.length >= MIN_QUERY_CHARS && search.error) || (typed.length === 0 && index.error);

  return (
    <div className="author-search" role="search">
      <label htmlFor={`${listId}-input`}>Look up any researcher</label>
      <div className="author-search-box">
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(active) : undefined}
          placeholder="Type a name, e.g. Hussein Hazimeh"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
            setChosen(null);
            setEnterQueued(false); // typing more cancels a pending Enter
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Matching researchers" hidden={!showList}>
          {search.data?.corrected && (
            <li role="presentation" className="opt-note">
              No exact match for {'“'}
              {debounced}
              {'”'} {'—'} closest names for {'“'}
              {search.data.corrected}
              {'”'}:
            </li>
          )}
          {results.map((result, i) => (
            <li
              key={result.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              // mousedown would blur the input (closing the list) before the click lands
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(result)}
            >
              <div className="opt-name">
                <NameWithTag name={result.name} />
              </div>
              <div className="opt-meta">
                {plural(result.n_papers, 'paper')} {'·'} {yearSpan(result.first_year, result.last_year)}
                {result.venues.length > 0 && ` · ${result.venues.map((v) => `${v.venue} ×${v.count}`).join(', ')}`}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className={failed ? 'author-search-status is-error' : 'author-search-status'} aria-live="polite">
        {status}
      </p>
    </div>
  );
}
