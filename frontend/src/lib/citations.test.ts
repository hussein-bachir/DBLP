import { describe, expect, it } from 'vitest';

import { linkCitations, sourceAnchor } from './citations';

const known = new Set(['P1', 'P2', 'P4']);
const ZWSP = String.fromCharCode(0x200b); // zero-width space

describe('linkCitations', () => {
  it('turns a citation into a link to its source', () => {
    expect(linkCitations('Graphs are big [P1].', known)).toBe('Graphs are big [[P1](#source-P1)].');
  });

  it('links each ref of a grouped citation', () => {
    expect(linkCitations('See [P1, P4].', known)).toBe('See [[P1](#source-P1), [P4](#source-P4)].');
    expect(linkCitations('See [P1,P2].', known)).toBe('See [[P1](#source-P1), [P2](#source-P2)].');
  });

  it('drops refs that are not among the sources, keeping the rest of the group', () => {
    expect(linkCitations('See [P1, P9].', known)).toBe('See [[P1](#source-P1)].');
  });

  it('removes a citation of only unknown refs together with the space before it', () => {
    expect(linkCitations('arXiv leads [P7].\n- AAAI [P8], then', known)).toBe('arXiv leads.\n- AAAI, then');
  });

  it('accepts the 【P1】 brackets GPT-OSS models use', () => {
    expect(linkCitations('Healthcare【P1】 and more【P2, P9】.', known)).toBe(
      'Healthcare[[P1](#source-P1)] and more[[P2](#source-P2)].',
    );
  });

  it('accepts zero-width spaces inside the brackets (GPT-OSS writes "[\\u200BP1]")', () => {
    expect(linkCitations(`See [${ZWSP}P1] and [${ZWSP}P2,${ZWSP} P4${ZWSP}].`, known)).toBe(
      'See [[P1](#source-P1)] and [[P2](#source-P2), [P4](#source-P4)].',
    );
  });

  it('leaves other brackets and Markdown links alone', () => {
    const text = 'A [table] and [a link](https://dblp.org) and P1 without brackets.';
    expect(linkCitations(text, known)).toBe(text);
  });

  it('does not touch spacing elsewhere in the text', () => {
    expect(linkCitations('ratio : 2 [P2]', known)).toBe('ratio : 2 [[P2](#source-P2)]');
  });

  it('uses the same anchor as the source list', () => {
    expect(sourceAnchor('P12')).toBe('source-P12');
  });
});
