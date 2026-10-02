import type { EChartsCoreOption } from 'echarts/core';

import type { NetworkData, NetworkEdge, NetworkNode } from '../data/schemas';
import { fmt, plural } from './format';
import { CATEGORICAL, COLOR } from './theme';

// The co-authorship network, as pure functions: filtering, highlighting, search matching
// and the "widen the slider for a hidden match" rule live here so they can be tested
// without a browser. NetworkCard.tsx is the thin React layer on top.

export type Positions = Map<string, [number, number]>;

export interface NetworkModel {
  data: NetworkData;
  /** authors, most prolific first */
  byPapers: NetworkNode[];
  rankOf: Map<string, number>;
  /** author -> co-author -> shared papers, over every link (not only the visible ones) */
  neighbors: Map<string, Map<string, number>>;
  maxPapers: number;
  /** author -> 1-based rank by degree centrality; tied authors share a rank */
  centralityRank: Map<string, number>;
}

export interface NetworkState {
  /** a link is shown only if the two authors share at least this many papers */
  minShared: number;
  /** only the N most prolific authors are candidates for display */
  topN: number;
  selected: string | null;
  /** where nodes currently sit, so a highlight can hold the layout still; null lets the layout move */
  pinned: Positions | null;
  /** the "authors shown" value to go back to when a search that widened it is cleared */
  topNBeforeSelect: number | null;
}

export interface GraphNode {
  id: string;
  name: string;
  x: number | undefined;
  y: number | undefined;
  fixed: boolean;
  symbolSize: number;
  value: number;
  /** degree centrality: the share of the other authors this one has co-authored with */
  degree: number;
  category: number;
  itemStyle: { color: string; opacity: number; borderColor: string; borderWidth: number };
  label: { show: boolean; fontWeight: number; color: string };
}

export interface GraphLink {
  source: string;
  target: string;
  value: number;
  lineStyle: { width: number; opacity: number; color: string };
}

export interface GraphView {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const DEFAULT_MIN_SHARED = 5;
export const DEFAULT_TOP_N = 100;
export const MAX_MIN_SHARED = 20;
export const TOP_N_STEP = 10;
const LABELED_BY_DEFAULT = 12;
const DIMMED_OPACITY = 0.22;

export function prepareNetwork(data: NetworkData): NetworkModel {
  const byPapers = [...data.nodes].sort((a, b) => b.papers - a.papers);
  const rankOf = new Map(byPapers.map((node, index) => [node.id, index]));
  const neighbors = new Map<string, Map<string, number>>();
  const link = (from: string, to: string, weight: number) => {
    const row = neighbors.get(from) ?? new Map<string, number>();
    row.set(to, weight);
    neighbors.set(from, row);
  };
  for (const edge of data.edges) {
    link(edge.source, edge.target, edge.weight);
    link(edge.target, edge.source, edge.weight);
  }
  const centralityRank = new Map(
    data.nodes.map((node) => [node.id, 1 + data.nodes.filter((other) => other.degree > node.degree).length]),
  );
  return { data, byPapers, rankOf, neighbors, maxPapers: byPapers[0]?.papers ?? 1, centralityRank };
}

/** Degree centrality as shown to people: two decimals ("0.43"). */
export function formatCentrality(degree: number): string {
  return degree.toFixed(2);
}

export function initialState(model: NetworkModel): NetworkState {
  return {
    minShared: DEFAULT_MIN_SHARED,
    topN: Math.min(DEFAULT_TOP_N, model.byPapers.length),
    selected: null,
    pinned: null,
    topNBeforeSelect: null,
  };
}

// ---------------------------------------------------------------- state changes

export function setMinShared(state: NetworkState, minShared: number): NetworkState {
  return { ...state, minShared, pinned: null };
}

/** Moving the slider by hand also forgets any value a search would have restored. */
export function setTopN(state: NetworkState, topN: number): NetworkState {
  return { ...state, topN, pinned: null, topNBeforeSelect: null };
}

/**
 * Highlight an author (or clear with null). If the author is ranked below the "authors shown"
 * slider it is widened just enough to include them (remembering the old value), and clearing
 * restores it. `pinned` holds the current node positions so the layout stays put.
 */
export function selectAuthor(model: NetworkModel, state: NetworkState, id: string | null, pinned: Positions | null): NetworkState {
  if (id === null) {
    return { ...state, selected: null, pinned, topN: state.topNBeforeSelect ?? state.topN, topNBeforeSelect: null };
  }
  const rank = model.rankOf.get(id);
  if (rank === undefined) return state;
  if (rank < state.topN) return { ...state, selected: id, pinned };
  const widened = Math.min(model.byPapers.length, Math.ceil((rank + 1) / TOP_N_STEP) * TOP_N_STEP);
  return { ...state, selected: id, pinned, topN: widened, topNBeforeSelect: state.topNBeforeSelect ?? state.topN };
}

// ---------------------------------------------------------------------- search

/** Lower-case and strip accents, so "merouane" finds "Mérouane". */
export function foldName(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The best author for what was typed: an exact name, else one starting with it, else one containing it. */
export function findAuthor(model: NetworkModel, query: string): string | null {
  const wanted = foldName(query.trim());
  if (!wanted) return null;
  const folded = model.byPapers.map((node) => ({ id: node.id, name: foldName(node.id) }));
  const hit =
    folded.find((row) => row.name === wanted) ?? folded.find((row) => row.name.startsWith(wanted)) ?? folded.find((row) => row.name.includes(wanted));
  return hit?.id ?? null;
}

// ----------------------------------------------------------------------- graph

function colorOf(group: number): string {
  const n = CATEGORICAL.length;
  return CATEGORICAL[((group % n) + n) % n] ?? COLOR.gold; // group can be -1 ("no community")
}

/**
 * What to draw. Most links are one- or two-paper collaborations, so hiding weak links (and the
 * authors left with none) is what separates the real research groups from a hairball. A
 * highlighted author is always drawn, with their co-authors labelled and everyone else dimmed.
 */
export function buildGraph(model: NetworkModel, state: NetworkState): GraphView {
  const { selected } = state;
  const candidates = new Set(model.byPapers.slice(0, state.topN).map((node) => node.id));
  if (selected) candidates.add(selected);

  const links: NetworkEdge[] = model.data.edges.filter(
    (edge) => edge.weight >= state.minShared && candidates.has(edge.source) && candidates.has(edge.target),
  );
  const linked = new Set(links.flatMap((edge) => [edge.source, edge.target]));
  const shown = model.byPapers.filter((node) => candidates.has(node.id) && (linked.has(node.id) || node.id === selected));

  const near = new Set<string>();
  if (selected) {
    near.add(selected);
    for (const edge of links) {
      if (edge.source === selected) near.add(edge.target);
      if (edge.target === selected) near.add(edge.source);
    }
  }

  const nodes: GraphNode[] = shown.map((node, index) => {
    const at = state.pinned?.get(node.id);
    const isSelected = node.id === selected;
    return {
      id: node.id,
      name: node.id,
      x: at?.[0],
      y: at?.[1],
      fixed: at !== undefined,
      symbolSize: 8 + 30 * Math.sqrt(node.papers / model.maxPapers),
      value: node.papers,
      degree: node.degree,
      category: node.group,
      itemStyle: {
        color: colorOf(node.group),
        opacity: selected && !near.has(node.id) ? DIMMED_OPACITY : 1,
        borderColor: COLOR.text,
        borderWidth: isSelected ? 3 : 0,
      },
      label: {
        show: selected ? near.has(node.id) : index < LABELED_BY_DEFAULT,
        fontWeight: isSelected ? 600 : 400,
        color: isSelected ? COLOR.text : COLOR.textSecondary,
      },
    };
  });

  const graphLinks: GraphLink[] = links.map((edge) => {
    const touches = selected !== null && (edge.source === selected || edge.target === selected);
    return {
      source: edge.source,
      target: edge.target,
      value: edge.weight,
      lineStyle: {
        width: 0.6 + Math.min(edge.weight, 20) * 0.1 + (touches ? 1 : 0),
        opacity: selected ? (touches ? 0.85 : 0.06) : 0.4,
        color: touches ? COLOR.gold : COLOR.textFaint,
      },
    };
  });

  return { nodes, links: graphLinks };
}

/** The sentence under the controls: what is showing, or who is highlighted. */
export function describeNetwork(model: NetworkModel, state: NetworkState, view: GraphView): string {
  const total = model.byPapers.length;
  const minShared = plural(state.minShared, 'shared paper');
  if (state.selected === null) {
    return `Showing ${view.nodes.length} of ${total} authors and ${fmt(view.links.length)} links. Links need at least ${minShared}; authors with no remaining link are hidden.`;
  }
  const rank = model.rankOf.get(state.selected) ?? 0;
  const author = model.byPapers[rank];
  const row = model.neighbors.get(state.selected) ?? new Map<string, number>();
  const strong = [...row.values()].filter((weight) => weight >= state.minShared).length;
  const centrality = `degree centrality ${formatCentrality(author?.degree ?? 0)} (#${model.centralityRank.get(state.selected) ?? 0} of ${total})`;
  return `${state.selected} — #${rank + 1} most prolific, ${fmt(author?.papers ?? 0)} papers, cluster ${(author?.group ?? 0) + 1}, ${centrality}. Co-authored with ${row.size} of the other ${total - 1} authors (${strong} at ≥${state.minShared} shared papers).`;
}

// --------------------------------------------------------------- ECharts option

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

interface TooltipParams {
  dataType: string;
  data: { name?: string; source?: string; target?: string; value: number; degree?: number };
}

export function networkOption(view: GraphView): EChartsCoreOption {
  return {
    tooltip: {
      backgroundColor: COLOR.card,
      borderColor: COLOR.hairline,
      textStyle: { color: COLOR.text, fontFamily: 'IBM Plex Sans' },
      formatter: (params: TooltipParams) => {
        const { data } = params;
        if (params.dataType === 'edge') {
          return `${escapeHtml(data.source ?? '')} ↔ ${escapeHtml(data.target ?? '')}: ${data.value} shared papers`;
        }
        const centrality = data.degree === undefined ? '' : ` · degree centrality ${formatCentrality(data.degree)}`;
        return `${escapeHtml(data.name ?? '')}: ${fmt(data.value)} papers${centrality}`;
      },
    },
    series: [
      {
        type: 'graph',
        layout: 'force',
        roam: true,
        draggable: true,
        force: { repulsion: 150, edgeLength: [30, 110], gravity: 0.2 },
        emphasis: { focus: 'adjacency', label: { show: true } },
        label: { show: false, position: 'right', color: COLOR.textSecondary, fontFamily: 'IBM Plex Mono', fontSize: 10 },
        edgeSymbol: ['none', 'none'],
        lineStyle: { color: COLOR.textFaint, curveness: 0.1 },
        data: view.nodes,
        links: view.links,
      },
    ],
  };
}

// ------------------------------------------------------------ reading the layout

interface LayoutSource {
  getModel(): {
    getSeriesByIndex(index: number): {
      getData(): { count(): number; getName(index: number): string; getItemLayout(index: number): [number, number] | undefined };
    };
  };
}

/**
 * Where the chart currently puts each node. ECharts has no public API for this, so it reads the
 * series data model; if that ever changes shape this returns an empty map and the layout simply
 * re-settles instead of being held still.
 */
export function readPositions(chart: unknown): Positions {
  const positions: Positions = new Map();
  try {
    const data = (chart as LayoutSource).getModel().getSeriesByIndex(0).getData();
    for (let i = 0; i < data.count(); i++) {
      const at = data.getItemLayout(i);
      if (at) positions.set(data.getName(i), [at[0], at[1]]);
    }
  } catch {
    /* fall through with whatever was read */
  }
  return positions;
}
