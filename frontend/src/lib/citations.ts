// The answer cites papers as [P3] or [P1, P4] (refs handed out by the backend's
// tools). Once the sources are known, those become links to the source list;
// a ref that isn't among the sources (the model made it up) is dropped rather
// than shown as if it were backed by a paper.

// Spaces, plus the zero-width characters GPT-OSS sometimes puts inside the brackets before P1.
const GAP = '[\\s\\u200B\\u200C\\u2060\\uFEFF]*';  // not U+200D (joiner): eslint flags it in a class
// GPT-OSS models also write 【P3】 instead of [P3]; both become the same [P3] link.
const CITATION = new RegExp(`[[【]${GAP}(P\\d+(?:${GAP},${GAP}P\\d+)*)${GAP}[\\]】]`, 'g');
const SEPARATOR = new RegExp(`${GAP},${GAP}`);
const REMOVED = String.fromCharCode(0xe000); // private-use character: marks a dropped citation

export const sourceAnchor = (ref: string) => `source-${ref}`;

/** Rewrite citations as Markdown links to `#source-P3`; refs not in `known` are removed. */
export function linkCitations(markdown: string, known: ReadonlySet<string>): string {
  return markdown
    .replace(CITATION, (_whole, group: string) => {
      const refs = group.split(SEPARATOR).filter((ref) => known.has(ref));
      if (refs.length === 0) return REMOVED;
      return '[' + refs.map((ref) => `[${ref}](#${sourceAnchor(ref)})`).join(', ') + ']';
    })
    .replace(new RegExp(`[ \\t]*${REMOVED}`, 'g'), ''); // also the space before it: "growth [P9]." -> "growth."
}
