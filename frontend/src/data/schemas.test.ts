import { describe, expect, it } from 'vitest';

import { CHART_DATA, NetworkSchema, TopicTrendsSchema } from './schemas';
import type { ChartDataKey } from './schemas';

// The real files that backend/build_chart_data.py wrote, loaded at test time.
const files = import.meta.glob('../../public/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
const byName = new Map(Object.entries(files).map(([path, data]) => [path.split('/').pop() ?? path, data]));

describe('the committed chart data files', () => {
  it.each(Object.entries(CHART_DATA))('%s matches its schema', (_key, { file, schema }) => {
    expect(byName.has(file), `${file} is missing from public/data`).toBe(true);
    const result = schema.safeParse(byName.get(file));
    expect(result.success, result.success ? '' : `${file}: ${result.error.issues[0]?.message}`).toBe(true);
  });

  it('has no data file the app does not know about', () => {
    const known = new Set(Object.values(CHART_DATA).map((entry) => entry.file));
    const extra = [...byName.keys()].filter((name) => !known.has(name as never));
    expect(extra).toEqual([]);
  });

  it('is internally consistent (network sizes, the year range the overview claims)', () => {
    const network = NetworkSchema.parse(byName.get(CHART_DATA.network.file));
    expect(network.nodes).toHaveLength(150);
    const overview = CHART_DATA.overview.schema.parse(byName.get(CHART_DATA.overview.file));
    const years = CHART_DATA.publicationsPerYear.schema.parse(byName.get(CHART_DATA.publicationsPerYear.file));
    expect(years[0]?.year).toBe(overview.year_min);
    expect(years[years.length - 1]?.year).toBe(overview.year_max);
    expect(years.reduce((sum, row) => sum + row.count, 0)).toBe(overview.total_records);
  });
});

describe('schema strictness', () => {
  it('rejects a series with the wrong number of points', () => {
    const bad = { years: [2019, 2020, 2021], series: { neural: [1, 2] } };
    expect(TopicTrendsSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an edge that points at an author who is not a node', () => {
    const bad = {
      nodes: [{ id: 'A', papers: 1, group: 0, degree: 0.1 }],
      edges: [{ source: 'A', target: 'Ghost', weight: 2 }],
      n_communities: 1,
    };
    const result = NetworkSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects a missing field and a wrong type', () => {
    const overview = CHART_DATA.overview.schema;
    expect(overview.safeParse({ total_records: 10 }).success).toBe(false);
    expect(
      overview.safeParse({ total_records: '10', excluded_records: 0, year_min: 1, year_max: 2, distinct_authors: 1, distinct_venues: 1 }).success,
    ).toBe(false);
  });

  it('accepts the "no community" marker -1 the builder can emit', () => {
    const ok = { nodes: [{ id: 'A', papers: 1, group: -1, degree: 0 }], edges: [], n_communities: 0 };
    expect(NetworkSchema.safeParse(ok).success).toBe(true);
  });

  it('lists exactly the keys the app fetches', () => {
    const keys: ChartDataKey[] = Object.keys(CHART_DATA) as ChartDataKey[];
    expect(keys).toHaveLength(13);
  });
});
