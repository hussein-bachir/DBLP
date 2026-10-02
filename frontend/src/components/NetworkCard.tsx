import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';

import { describeChartDataError } from '../data/client';
import { useChartData } from '../data/hooks';
import type { NetworkData } from '../data/schemas';
import {
  MAX_MIN_SHARED,
  TOP_N_STEP,
  buildGraph,
  describeNetwork,
  findAuthor,
  initialState,
  networkOption,
  prepareNetwork,
  readPositions,
  selectAuthor,
  setMinShared,
  setTopN,
} from '../lib/network';
import { EChart } from './EChart';
import type { ChartInstance } from './EChart';

const NETWORK_HEIGHT = 700;

function scrollToNetwork() {
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  document.getElementById('network')?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
}

/** The controls and the graph. Every decision (filtering, highlighting, search) is in lib/network.ts. */
function NetworkExplorer({ data }: { data: NetworkData }) {
  const id = useId();
  const model = useMemo(() => prepareNetwork(data), [data]);
  const [state, setState] = useState(() => initialState(model));
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const chart = useRef<ChartInstance | null>(null);
  const [params] = useSearchParams();
  const highlight = params.get('highlight');

  const view = useMemo(() => buildGraph(model, state), [model, state]);
  const option = useMemo(() => networkOption(view), [view]);
  const status = notice ?? describeNetwork(model, state, view);
  const total = model.byPapers.length;

  // Highlighting or clearing keeps every node where it is, so the layout doesn't reshuffle
  // while someone is trying to find a person; the sliders let it re-settle.
  function choose(author: string | null) {
    const pinned = chart.current ? readPositions(chart.current) : null;
    setState((current) => selectAuthor(model, current, author, pinned));
    setText(author ?? '');
    setNotice(null);
  }

  // arriving from a profile ("Highlight in network") selects that author once the graph is ready
  useEffect(() => {
    if (highlight && model.rankOf.has(highlight)) {
      setState((current) => selectAuthor(model, current, highlight, null));
      setText(highlight);
      setNotice(null);
      scrollToNetwork();
    }
  }, [highlight, model]);

  function onTextChange(value: string) {
    setText(value);
    setNotice(null);
    // picking a suggestion from the list fills in an exact name: select it straight away
    if (model.rankOf.has(value)) choose(value);
  }

  function submit() {
    if (!text.trim()) {
      choose(null);
      return;
    }
    const hit = findAuthor(model, text);
    if (hit) {
      choose(hit);
      return;
    }
    const pinned = chart.current ? readPositions(chart.current) : null;
    setState((current) => selectAuthor(model, current, null, pinned));
    setNotice(`No author matching “${text.trim()}” among the ${total} most prolific authors in this network.`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      choose(null);
    }
  }

  return (
    <>
      <div className="net-controls">
        <div className="net-search">
          <label htmlFor={`${id}-search`}>Highlight in this network</label>
          <div className="net-search-row">
            <input
              id={`${id}-search`}
              type="search"
              list={`${id}-authors`}
              placeholder="e.g. Dacheng Tao"
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(event) => onTextChange(event.target.value)}
              onKeyDown={onKeyDown}
            />
            {state.selected !== null && (
              <button type="button" onClick={() => choose(null)}>
                Clear
              </button>
            )}
          </div>
          <datalist id={`${id}-authors`}>
            {model.byPapers.map((node) => (
              <option key={node.id} value={node.id} />
            ))}
          </datalist>
        </div>
        <div className="net-slider">
          <label htmlFor={`${id}-min`}>
            Min. shared papers per link <output htmlFor={`${id}-min`}>{state.minShared}</output>
          </label>
          <input
            id={`${id}-min`}
            type="range"
            min={1}
            max={MAX_MIN_SHARED}
            step={1}
            value={state.minShared}
            onChange={(event) => setState((current) => setMinShared(current, Number(event.target.value)))}
          />
        </div>
        <div className="net-slider">
          <label htmlFor={`${id}-top`}>
            Authors shown <output htmlFor={`${id}-top`}>{state.topN}</output>
          </label>
          <input
            id={`${id}-top`}
            type="range"
            min={Math.min(2 * TOP_N_STEP, total)}
            max={total}
            step={TOP_N_STEP}
            value={state.topN}
            onChange={(event) => setState((current) => setTopN(current, Number(event.target.value)))}
          />
        </div>
      </div>
      <p className="net-status" aria-live="polite">
        {status}
      </p>
      <EChart
        option={option}
        height={NETWORK_HEIGHT}
        ariaLabel="Co-authorship network: each dot is an author, each line a shared paper count"
        replace={false}
        onChart={(instance) => {
          chart.current = instance;
        }}
      />
    </>
  );
}

export function NetworkCard() {
  const { data, error } = useChartData('network');
  return (
    <section className="card wide" id="network">
      <h2>Co-authorship Network</h2>
      <p className="note">
        The {data ? data.nodes.length : 150} most prolific authors of all time, linked when they share papers and colored by detected
        community. Highlight one of these authors and their co-authors, or use the sliders to thin out the links. Hover a node to isolate
        its neighbours; drag nodes and scroll to zoom. Degree centrality (in the tooltip and when highlighting) is the share of the other
        authors in this network someone has co-authored with at least once, whatever the sliders show. (To look up anyone in DBLP, use the
        search at the top of the page.)
      </p>
      {data ? (
        <NetworkExplorer data={data} />
      ) : error ? (
        <p className="chart-state is-error" role="alert" style={{ minHeight: NETWORK_HEIGHT }}>
          {describeChartDataError(error)}
        </p>
      ) : (
        <p className="chart-state" role="status" style={{ minHeight: NETWORK_HEIGHT }}>
          Loading{'…'}
        </p>
      )}
    </section>
  );
}
