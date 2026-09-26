import { describe, expect, it } from 'vitest';

import { NetworkSchema } from '../data/schemas';
import type { NetworkData } from '../data/schemas';
import { realChartData } from '../test/utils';
import {
  buildGraph,
  describeNetwork,
  findAuthor,
  foldName,
  initialState,
  networkOption,
  prepareNetwork,
  readPositions,
  selectAuthor,
  setMinShared,
  setTopN,
} from './network';
import type { NetworkState } from './network';

// A - B (10), A - C (6), B - C (2), C - D (7), D - E (1), A - F (5)
const FIXTURE: NetworkData = {
  nodes: [
    { id: 'A', papers: 100, group: 0, degree: 0 },
    { id: 'B', papers: 80, group: 0, degree: 0 },
    { id: 'C', papers: 60, group: 1, degree: 0 },
    { id: 'D', papers: 40, group: 1, degree: 0 },
    { id: 'E', papers: 20, group: 2, degree: 0 },
    { id: 'F', papers: 10, group: -1, degree: 0 },
  ],
  edges: [
    { source: 'A', target: 'B', weight: 10 },
    { source: 'A', target: 'C', weight: 6 },
    { source: 'B', target: 'C', weight: 2 },
    { source: 'C', target: 'D', weight: 7 },
    { source: 'D', target: 'E', weight: 1 },
    { source: 'A', target: 'F', weight: 5 },
  ],
  n_communities: 3,
};
const model = prepareNetwork(FIXTURE);
const base: NetworkState = { minShared: 5, topN: 5, selected: null, pinned: null, topNBeforeSelect: null };
const ids = (view: { nodes: Array<{ id: string }> }) => view.nodes.map((n) => n.id);

describe('prepareNetwork', () => {
  it('ranks authors by papers and records every co-author both ways', () => {
    const shuffled = prepareNetwork({ ...FIXTURE, nodes: [...FIXTURE.nodes].reverse() });
    expect(shuffled.byPapers.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(shuffled.rankOf.get('C')).toBe(2);
    expect(shuffled.maxPapers).toBe(100);
    expect(model.neighbors.get('A')?.get('B')).toBe(10);
    expect(model.neighbors.get('B')?.get('A')).toBe(10);
    expect([...(model.neighbors.get('C')?.keys() ?? [])].sort()).toEqual(['A', 'B', 'D']);
  });
});

describe('initialState', () => {
  it('starts at 5 shared papers and the 100 most prolific authors, or all of them if fewer', () => {
    expect(initialState(model)).toMatchObject({ minShared: 5, topN: 6, selected: null, pinned: null });
    const big = prepareNetwork({ ...FIXTURE, nodes: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, papers: 150 - i, group: 0, degree: 0 })), edges: [] });
    expect(initialState(big).topN).toBe(100);
  });
});

describe('buildGraph: filtering', () => {
  it('hides weak links and the authors left with none', () => {
    const view = buildGraph(model, base);
    expect(ids(view)).toEqual(['A', 'B', 'C', 'D']); // E only has a 1-paper link; F is beyond the top 5
    expect(view.links.map((l) => `${l.source}-${l.target}`)).toEqual(['A-B', 'A-C', 'C-D']);
    expect(view.links.every((l) => l.value >= 5)).toBe(true);
  });

  it('shows more as the threshold drops', () => {
    const view = buildGraph(model, { ...base, minShared: 1 });
    expect(ids(view)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(view.links).toHaveLength(5); // A-F is outside the top 5
  });

  it('shows more authors as the "authors shown" limit grows', () => {
    const view = buildGraph(model, { ...base, topN: 6 });
    expect(ids(view)).toContain('F');
    expect(view.links).toHaveLength(4);
  });

  it('sizes nodes by papers relative to the busiest author', () => {
    const view = buildGraph(model, base);
    expect(view.nodes[0]?.symbolSize).toBeCloseTo(38); // 8 + 30 * sqrt(100/100)
    expect(view.nodes[2]?.symbolSize).toBeCloseTo(8 + 30 * Math.sqrt(0.6));
  });

  it('labels the 12 most prolific authors by default and no more', () => {
    const chain = prepareNetwork({
      nodes: Array.from({ length: 15 }, (_, i) => ({ id: `n${i}`, papers: 100 - i, group: 0, degree: 0 })),
      edges: Array.from({ length: 14 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}`, weight: 9 })),
      n_communities: 1,
    });
    const view = buildGraph(chain, { ...base, topN: 15 });
    expect(view.nodes).toHaveLength(15);
    expect(view.nodes.filter((n) => n.label.show)).toHaveLength(12);
  });

  it('copes with a "no community" group of -1', () => {
    const view = buildGraph(model, { ...base, topN: 6 });
    const f = view.nodes.find((n) => n.id === 'F');
    expect(f?.itemStyle.color).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe('buildGraph: highlighting', () => {
  it('always shows the highlighted author, even one with no visible link', () => {
    const view = buildGraph(model, { ...base, selected: 'E' });
    expect(ids(view)).toContain('E');
    const e = view.nodes.find((n) => n.id === 'E');
    expect(e?.itemStyle.borderWidth).toBe(3);
    expect(e?.label.show).toBe(true);
  });

  it('shows the co-authors normally and dims everyone else', () => {
    const view = buildGraph(model, { ...base, selected: 'D' });
    const byId = new Map(view.nodes.map((n) => [n.id, n]));
    expect(byId.get('D')?.itemStyle.opacity).toBe(1);
    expect(byId.get('C')?.itemStyle.opacity).toBe(1); // D's only visible co-author
    expect(byId.get('A')?.itemStyle.opacity).toBe(0.22);
    expect(byId.get('B')?.itemStyle.opacity).toBe(0.22);
    expect(byId.get('A')?.label.show).toBe(false);
    expect(byId.get('C')?.label.show).toBe(true);
  });

  it('draws the highlighted author’s links thicker and in gold, and fades the rest', () => {
    const view = buildGraph(model, { ...base, selected: 'D' });
    const cd = view.links.find((l) => l.source === 'C' && l.target === 'D');
    const ab = view.links.find((l) => l.source === 'A' && l.target === 'B');
    expect(cd?.lineStyle.opacity).toBe(0.85);
    expect(cd?.lineStyle.width).toBeCloseTo(0.6 + 0.7 + 1);
    expect(ab?.lineStyle.opacity).toBe(0.06);
    expect(ab?.lineStyle.width).toBeCloseTo(0.6 + 1.0);
    expect(cd?.lineStyle.color).not.toBe(ab?.lineStyle.color);
  });

  it('includes a highlighted author who is outside the "authors shown" limit', () => {
    const view = buildGraph(model, { ...base, selected: 'F' });
    expect(ids(view)).toContain('F');
    expect(view.links.some((l) => l.source === 'A' && l.target === 'F')).toBe(true);
  });
});

describe('buildGraph: holding the layout still', () => {
  it('pins exactly the nodes whose positions are known', () => {
    const view = buildGraph(model, { ...base, pinned: new Map([['A', [12, 34]]]) });
    const a = view.nodes.find((n) => n.id === 'A');
    const b = view.nodes.find((n) => n.id === 'B');
    expect(a).toMatchObject({ x: 12, y: 34, fixed: true });
    expect(b).toMatchObject({ x: undefined, y: undefined, fixed: false });
  });

  it('pins nothing without positions', () => {
    expect(buildGraph(model, base).nodes.every((n) => !n.fixed)).toBe(true);
  });
});

describe('state changes', () => {
  it('a slider change lets the layout move again', () => {
    const pinned = new Map<string, [number, number]>([['A', [1, 2]]]);
    expect(setMinShared({ ...base, pinned }, 3)).toMatchObject({ minShared: 3, pinned: null });
    expect(setTopN({ ...base, pinned }, 6)).toMatchObject({ topN: 6, pinned: null });
  });

  it('widens "authors shown" just enough for a hidden match, and puts it back when cleared', () => {
    const wide = prepareNetwork({ ...FIXTURE, nodes: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, papers: 150 - i, group: 0, degree: 0 })), edges: [] });
    const start = initialState(wide); // topN 100
    const picked = selectAuthor(wide, start, 'n129', null); // rank 129
    expect(picked).toMatchObject({ selected: 'n129', topN: 130, topNBeforeSelect: 100 });
    const cleared = selectAuthor(wide, picked, null, null);
    expect(cleared).toMatchObject({ selected: null, topN: 100, topNBeforeSelect: null });
  });

  it('does not touch the slider for a match that is already within it', () => {
    expect(selectAuthor(model, base, 'C', null)).toMatchObject({ selected: 'C', topN: 5, topNBeforeSelect: null });
  });

  it('never widens past the number of authors', () => {
    expect(selectAuthor(model, base, 'F', null).topN).toBe(6);
  });

  it('remembers only the first value across several searches, and forgets it if the slider is moved by hand', () => {
    const wide = prepareNetwork({ ...FIXTURE, nodes: Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, papers: 150 - i, group: 0, degree: 0 })), edges: [] });
    let state = selectAuthor(wide, initialState(wide), 'n120', null); // widens to 130
    state = selectAuthor(wide, state, 'n140', null); // widens again, still remembers 100
    expect(state).toMatchObject({ topN: 150, topNBeforeSelect: 100 });
    state = setTopN(state, 60);
    expect(selectAuthor(wide, state, null, null).topN).toBe(60); // the hand-set value stays
  });

  it('ignores an author who is not in the network', () => {
    expect(selectAuthor(model, base, 'Nobody', null)).toBe(base);
  });
});

describe('search matching', () => {
  const people = prepareNetwork({
    nodes: [
      { id: 'Dacheng Tao', papers: 300, group: 0, degree: 0 },
      { id: 'Dacheng Zhang', papers: 500, group: 0, degree: 0 },
      { id: 'Mérouane Debbah', papers: 200, group: 1, degree: 0 },
      { id: 'Wei Wang 0001', papers: 100, group: 1, degree: 0 },
    ],
    edges: [],
    n_communities: 2,
  });

  it('folds case and accents', () => {
    expect(foldName('MÉrouane')).toBe('merouane');
    expect(findAuthor(people, 'MEROUANE')).toBe('Mérouane Debbah');
  });

  it('prefers an exact name, then a name that starts with the text, then one that contains it', () => {
    expect(findAuthor(people, 'dacheng tao')).toBe('Dacheng Tao');
    expect(findAuthor(people, 'dacheng')).toBe('Dacheng Zhang'); // both start with it; the more prolific wins
    expect(findAuthor(people, 'debbah')).toBe('Mérouane Debbah');
  });

  it('finds nothing for text that matches nobody, or for blank text', () => {
    expect(findAuthor(people, 'zzz')).toBeNull();
    expect(findAuthor(people, '   ')).toBeNull();
  });
});

describe('describeNetwork', () => {
  it('reports what is showing', () => {
    const state = base;
    expect(describeNetwork(model, state, buildGraph(model, state))).toBe(
      'Showing 4 of 6 authors and 3 links. Links need at least 5 shared papers; authors with no remaining link are hidden.',
    );
  });

  it('uses the singular for a threshold of 1', () => {
    const state = { ...base, minShared: 1 };
    expect(describeNetwork(model, state, buildGraph(model, state))).toContain('Links need at least 1 shared paper;');
  });

  it('describes the highlighted author', () => {
    const state = { ...base, selected: 'C' };
    expect(describeNetwork(model, state, buildGraph(model, state))).toBe(
      'C — #3 most prolific, 60 papers, cluster 2. Co-authored with 3 of the other 5 authors (2 at ≥5 shared papers).',
    );
  });
});

describe('networkOption', () => {
  const view = buildGraph(model, base);
  type Series = { data: unknown[]; links: unknown[]; layout: string };
  const option = networkOption(view) as { series: Series[]; tooltip: { formatter: (p: unknown) => string } };

  it('draws the graph as a force layout with the nodes and links given', () => {
    expect(option.series[0]?.layout).toBe('force');
    expect(option.series[0]?.data).toBe(view.nodes);
    expect(option.series[0]?.links).toBe(view.links);
  });

  it('describes a node or a link in the tooltip, escaping names', () => {
    expect(option.tooltip.formatter({ dataType: 'node', data: { name: '<b>Ann & Bo</b>', value: 1234 } })).toBe('&lt;b&gt;Ann &amp; Bo&lt;/b&gt;: 1,234 papers');
    expect(option.tooltip.formatter({ dataType: 'edge', data: { source: 'A', target: 'B', value: 10 } })).toBe('A ↔ B: 10 shared papers');
  });
});

describe('readPositions', () => {
  it('reads each node’s layout position from the chart', () => {
    const names = ['A', 'B'];
    const at: Array<[number, number] | undefined> = [[1, 2], undefined];
    const chart = { getModel: () => ({ getSeriesByIndex: () => ({ getData: () => ({ count: () => 2, getName: (i: number) => names[i], getItemLayout: (i: number) => at[i] }) }) }) };
    expect([...readPositions(chart)]).toEqual([['A', [1, 2]]]);
  });

  it('returns nothing (so the layout just re-settles) if the chart is not what it expects', () => {
    expect(readPositions({})).toEqual(new Map());
    expect(readPositions(null)).toEqual(new Map());
  });
});

describe('the real network', () => {
  const real = prepareNetwork(NetworkSchema.parse(realChartData('coauthor_network.json')));

  it('at the default settings shows only strong links between connected authors, within the limit', () => {
    const state = initialState(real);
    const view = buildGraph(real, state);
    const shown = new Set(ids(view));
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.nodes.length).toBeLessThanOrEqual(state.topN);
    expect(view.links.every((l) => l.value >= state.minShared && shown.has(l.source) && shown.has(l.target))).toBe(true);
    const linked = new Set(view.links.flatMap((l) => [l.source, l.target]));
    expect(view.nodes.every((n) => linked.has(n.id))).toBe(true); // nobody drawn without a link
  });

  it('shows every author when nothing is filtered out', () => {
    const view = buildGraph(real, { ...initialState(real), minShared: 1, topN: real.byPapers.length });
    expect(view.nodes.length).toBeGreaterThan(buildGraph(real, initialState(real)).nodes.length);
  });
});
