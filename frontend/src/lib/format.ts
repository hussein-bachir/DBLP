export interface SplitName {
  base: string;
  tag: string | null;
}

/** DBLP tells apart people who share a name with a trailing 4-digit number ("Hussein Hazimeh 0002"). */
export function splitName(raw: string): SplitName {
  const match = /^(.*\S)\s+(\d{4})$/.exec(raw);
  return match ? { base: match[1] ?? raw, tag: match[2] ?? null } : { base: raw, tag: null };
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function plural(n: number, word: string, many: string = `${word}s`): string {
  return `${fmt(n)} ${n === 1 ? word : many}`;
}

export function yearSpan(first: number | null, last: number | null): string {
  if (first === null) return 'no dated papers';
  return first === last || last === null ? String(first) : `${first}–${last}`;
}

/** dblp.org's page for a record; the host is fixed, only the key is encoded. */
export function recordUrl(key: string): string {
  return 'https://dblp.org/rec/' + key.split('/').map(encodeURIComponent).join('/');
}

export function dblpSearchUrl(name: string): string {
  return 'https://dblp.org/search?q=' + encodeURIComponent(name);
}
