// The house palette: ink navy, brass gold, verdigris,
// plus muted complements so the charts don't fall back to a default rainbow.
export const COLOR = {
  ink: '#12172B',
  card: '#1A2140',
  gold: '#C9A227',
  goldDim: '#8F7420',
  verdigris: '#5B8A82',
  rose: '#B76E79',
  slate: '#6B7A9E',
  clay: '#C97C5D',
  sage: '#8FA998',
  text: '#EDEAE0',
  textSecondary: '#9AA0B8',
  textFaint: '#6B7090',
  hairline: '#2A2F52',
} as const;

/** Qualitative palette for multi-series charts and the network's communities (13 clusters). */
export const CATEGORICAL: readonly string[] = [
  COLOR.gold,
  COLOR.verdigris,
  COLOR.rose,
  COLOR.slate,
  COLOR.clay,
  COLOR.sage,
  '#D9B85C',
  '#7CA39B',
  '#C98E96',
  '#8A97B8',
  '#DDA089',
  '#AEC2A8',
  '#A9863C',
];
