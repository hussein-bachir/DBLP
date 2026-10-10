import { describe, expect, it } from 'vitest';

import { makeDiagnostics } from '../test/utils';
import { detailRows, searchMethod, seconds, summaryLine } from './diagnostics';

const row = (label: string, d = makeDiagnostics()) => detailRows(d).find((r) => r.label === label)?.lines ?? [];

describe('searchMethod', () => {
  it('names the combination', () => {
    expect(searchMethod(['keyword', 'semantic'])).toBe('hybrid');
    expect(searchMethod(['keyword'])).toBe('keyword');
    expect(searchMethod(['filter'])).toBeNull();
    expect(searchMethod([])).toBeNull();
  });
});

describe('seconds', () => {
  it('keeps one decimal below ten seconds', () => {
    expect(seconds(0.81)).toBe('0.8 s');
    expect(seconds(47.2)).toBe('47 s');
  });
});

describe('summaryLine', () => {
  it('sums up the run', () => {
    expect(summaryLine(makeDiagnostics())).toBe('hybrid search · 2 lookups · 6.1 s · 1,850 tokens · 1 made-up citation dropped');
  });

  it('leaves tokens out when the provider does not report them, and flags a retry', () => {
    const d = makeDiagnostics({ tokens: null, citations: { cited: 5, valid: 5, dropped: 0 }, guard_nudged: true });
    expect(summaryLine(d)).toBe('hybrid search · 2 lookups · 6.1 s · retried with the data');
  });

  it('says when only database counts were used', () => {
    const d = makeDiagnostics({ search: { searches: 0, methods: [], coverage: null, semantic_min_year: 2024 } });
    expect(summaryLine(d)).toMatch(/^database lookups · 2 lookups/);
  });

  it('says when the question was declined', () => {
    const d = makeDiagnostics({ declined: true, steps: [], total_seconds: 3.04 });
    expect(summaryLine(d)).toBe('declined, not about the DBLP data · 3.0 s');
  });
});

describe('detailRows', () => {
  it('explains partial semantic coverage and shows capped counts as lower bounds', () => {
    const lines = row('Search');
    expect(lines).toContain('Semantic search covers only 2024 on; older papers were found by keyword alone.');
    expect(lines.join(' ')).toContain('12 shown, from 143 titles with every word, 200+ with some words and 200+ close in meaning');
  });

  it('leaves out the some-words count when that query was not needed', () => {
    const d = makeDiagnostics();
    d.steps[0] = { ...d.steps[0]!, search: { ...d.steps[0]!.search!, keyword_any: null } };
    expect(row('Search', d).join(' ')).toContain('12 shown, from 143 titles with every word and 200+ close in meaning.');
  });

  it('describes full and missing coverage', () => {
    const full = makeDiagnostics({ search: { searches: 1, methods: ['keyword', 'semantic'], coverage: 'full', semantic_min_year: 2024 } });
    expect(row('Search', full)).toContain('Semantic search covers 2024 on, which includes all the years searched.');
    const none = makeDiagnostics({ search: { searches: 1, methods: ['keyword'], coverage: 'none', semantic_min_year: null } });
    expect(row('Search', none)).toContain('No semantic index is built, so papers were found by keyword alone.');
  });

  it('splits the time between the model and the tools', () => {
    expect(row('Timing')[0]).toBe('6.1 s in total: language model 4.2 s over 2 calls, database and search 1.9 s.');
    expect(row('Timing')).toContain('First text after 0.8 s.');
  });

  it('reports a failed lookup', () => {
    const d = makeDiagnostics();
    d.steps[1] = { ...d.steps[1]!, error: 'this query took too long' };
    expect(row('Timing', d).at(-1)).toMatch(/\(failed: this query took too long\)$/);
  });

  it('says when tokens are not reported', () => {
    expect(row('Tokens', makeDiagnostics({ tokens: null }))).toEqual(['Not reported by this provider.']);
  });

  it('counts valid and made-up citations and explains the guard', () => {
    expect(row('Checks')).toEqual(['5 of 6 citations match papers the tools returned.', '1 citation the model made up was removed.']);
    const nudged = row('Checks', makeDiagnostics({ guard_nudged: true }));
    expect(nudged.at(-1)).toMatch(/first answered without looking anything up/);
  });

  it('keeps the data, search and model layers apart in Tested, labelled as test-set figures', () => {
    const lines = row('Tested');
    expect(lines[0]).toMatch(/^Data: counts and profiles are exact database queries/);
    expect(lines[1]).toBe(
      'Search: hybrid search found relevant papers for 68% of its top 20 results on 10 test queries (papers from 2024 on, measured 2026-10-09).',
    );
    expect(lines[2]).toMatch(/^Model: this model got 6 of 6 test questions right/);
    expect(lines.at(-1)).toBe('These are test-set figures, not a measurement of this answer.');
  });

  it('says what to run when nothing has been measured', () => {
    expect(row('Tested', makeDiagnostics({ tested: null }))[1]).toMatch(/not measured yet \(run python rag\/eval\.py --answers\)/);
    const untested = makeDiagnostics({ tested: { search: null, model: null } });
    expect(row('Tested', untested)).toContain('Model: this model has not been tested yet (run python rag/eval.py --answers with it).');
  });
});
