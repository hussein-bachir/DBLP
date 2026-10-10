import type { AskDiagnostics } from '../api/types';
import { fmt, plural } from './format';

// Wording for "how this answer was produced" under each Ask answer. Everything
// except the "Tested" row is measured on this answer; "Tested" repeats what
// backend/rag/eval.py measured on its test questions, and says so.

export interface DetailRow {
  label: string;
  lines: string[];
}

const SEARCH_NAMES: Record<string, string> = { hybrid: 'hybrid', keyword: 'keyword', semantic: 'semantic' };

/** "hybrid" when keyword and semantic search both ran, else the single method. */
export function searchMethod(methods: string[]): string | null {
  if (methods.includes('keyword') && methods.includes('semantic')) return 'hybrid';
  const named = methods.filter((m) => m in SEARCH_NAMES);
  return named.length === 1 ? (named[0] ?? null) : null;
}

export function seconds(s: number): string {
  return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
}

/** A candidate count that hit the search's cap is a lower bound: "200+". */
function capped(n: number, cap: number): string {
  return n >= cap ? `${fmt(cap)}+` : fmt(n);
}

/** One line, e.g. "hybrid search · 2 lookups · 6.1 s · 1,850 tokens". */
export function summaryLine(d: AskDiagnostics): string {
  if (d.declined) return `declined, not about the DBLP data · ${seconds(d.total_seconds)}`;
  const method = searchMethod(d.search.methods);
  const parts = [
    method ? `${method} search` : d.steps.length > 0 ? 'database lookups' : 'no lookups',
    plural(d.steps.length, 'lookup'),
    seconds(d.total_seconds),
  ];
  if (d.tokens) parts.push(`${fmt(d.tokens.prompt + d.tokens.completion)} tokens`);
  if (d.citations.dropped > 0) parts.push(`${plural(d.citations.dropped, 'made-up citation')} dropped`);
  if (d.guard_nudged) parts.push('retried with the data');
  return parts.join(' · ');
}

function coverageLine(d: AskDiagnostics): string | null {
  const from = d.search.semantic_min_year;
  switch (d.search.coverage) {
    case 'full':
      return from === null ? 'Semantic search covers every year.' : `Semantic search covers ${from} on, which includes all the years searched.`;
    case 'partial':
      return `Semantic search covers only ${from} on; older papers were found by keyword alone.`;
    case 'none':
      return from === null
        ? 'No semantic index is built, so papers were found by keyword alone.'
        : `Semantic search covers only ${from} on, so the years searched were matched by keyword alone.`;
    default:
      return null;
  }
}

function searchRow(d: AskDiagnostics): DetailRow {
  if (d.declined) return { label: 'Search', lines: ['None: the question was declined as not being about the DBLP data.'] };
  if (d.search.searches === 0) {
    return {
      label: 'Search',
      lines: [d.steps.length > 0 ? 'No paper search: the figures come straight from database counts and profiles.' : 'No lookups were made.'],
    };
  }
  const lines = [`Methods: ${d.search.methods.join(' + ')}.`];
  const cover = coverageLine(d);
  if (cover) lines.push(cover);
  for (const step of d.steps) {
    const s = step.search;
    if (!s) continue;
    const found = [`${capped(s.keyword_all, s.cap)} titles with every word`];
    if (s.keyword_any !== null) found.push(`${capped(s.keyword_any, s.cap)} with some words`); // null: not needed
    found.push(`${capped(s.semantic, s.cap)} close in meaning`);
    lines.push(`${step.summary}: ${fmt(s.shown)} shown, from ${found.slice(0, -1).join(', ')} and ${found.at(-1)}.`);
  }
  return { label: 'Search', lines };
}

function timingRow(d: AskDiagnostics): DetailRow {
  const lines = [
    `${seconds(d.total_seconds)} in total: language model ${seconds(d.model_seconds)} over ${plural(d.rounds, 'call')}, ` +
      `database and search ${seconds(d.tool_seconds)}.`,
  ];
  if (d.first_token_seconds !== null) lines.push(`First text after ${seconds(d.first_token_seconds)}.`);
  for (const step of d.steps) lines.push(`${step.summary}: ${seconds(step.seconds)}${step.error ? ` (failed: ${step.error})` : ''}`);
  return { label: 'Timing', lines };
}

function tokensRow(d: AskDiagnostics): DetailRow {
  return {
    label: 'Tokens',
    lines: [d.tokens ? `${fmt(d.tokens.prompt)} sent, ${fmt(d.tokens.completion)} generated.` : 'Not reported by this provider.'],
  };
}

function checksRow(d: AskDiagnostics): DetailRow {
  const c = d.citations;
  const lines: string[] = [];
  if (c.cited === 0) lines.push('No papers were cited.');
  else lines.push(`${c.valid} of ${plural(c.cited, 'citation')} match papers the tools returned.`);
  if (c.dropped > 0) lines.push(`${plural(c.dropped, 'citation')} the model made up ${c.dropped === 1 ? 'was' : 'were'} removed.`);
  if (d.guard_nudged) lines.push('The model first answered without looking anything up; that draft was discarded and it answered again from the data.');
  else if (d.retracted > 0) lines.push(`${plural(d.retracted, 'draft')} written before a lookup ${d.retracted === 1 ? 'was' : 'were'} replaced.`);
  return { label: 'Checks', lines };
}

function testedRow(d: AskDiagnostics): DetailRow {
  const lines = [
    'Data: counts and profiles are exact database queries, but they match title keywords only ' +
      '(synonyms are counted separately and arXiv preprints of published papers are included).',
  ];
  const t = d.tested;
  if (t === null) {
    lines.push('Search and model accuracy: not measured yet (run python rag/eval.py --answers).');
    return { label: 'Tested', lines };
  }
  if (t.search) {
    const years = t.search.min_year === null ? 'all years' : `papers from ${t.search.min_year} on`;
    lines.push(
      `Search: ${t.search.method} search found relevant papers for ${Math.round(t.search.precision * 100)}% of its top 20 results ` +
        `on ${t.search.queries ?? '?'} test queries (${years}, measured ${t.search.date ?? 'earlier'}).`,
    );
  }
  if (t.model) {
    lines.push(
      `Model: this model got ${t.model.correct} of ${t.model.total} test questions right (measured ${t.model.date ?? 'earlier'}); ` +
        'a small test set, and models can misread results, so check the sources.',
    );
  } else {
    lines.push('Model: this model has not been tested yet (run python rag/eval.py --answers with it).');
  }
  lines.push('These are test-set figures, not a measurement of this answer.');
  return { label: 'Tested', lines };
}

/** The rows of the "Details" panel, in display order. */
export function detailRows(d: AskDiagnostics): DetailRow[] {
  return [searchRow(d), timingRow(d), tokensRow(d), checksRow(d), testedRow(d)];
}
