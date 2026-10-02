// The answer cites papers as [P3] or [P1, P4] (refs handed out by the backend's
// tools). Once the sources are known, those become links to the source list;
// a ref that isn't among the sources (the model made it up) is dropped rather
// than shown as if it were backed by a paper.

// GPT-OSS models write 【P3】 instead of [P3]; both become the same [P3] link
const CITATION = /[[【]\s*(P\d+(?:\s*,\s*P\d+)*)\s*[\]】]/g;
const REMOVED = ''; // a private-use character: marks a dropped citation, never in model output

export const sourceAnchor = (ref: string) => `source-${ref}`;

/** Rewrite citations as Markdown links to `#source-P3`; refs not in `known` are removed. */
export function linkCitations(markdown: string, known: ReadonlySet<string>): string {
  return markdown
    .replace(CITATION, (_whole, group: string) => {
      const refs = group.split(/\s*,\s*/).filter((ref) => known.has(ref));
      if (refs.length === 0) return REMOVED;
      return '[' + refs.map((ref) => `[${ref}](#${sourceAnchor(ref)})`).join(', ') + ']';
    })
    .replace(/[ \t]*/g, ''); // also the space before it: "growth [P9]." -> "growth."
}
