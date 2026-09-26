import { describe, expect, it } from 'vitest';

import { dblpSearchUrl, fmt, plural, recordUrl, splitName, yearSpan } from './format';

describe('splitName', () => {
  it('separates the DBLP disambiguation number', () => {
    expect(splitName('Hussein Hazimeh 0002')).toEqual({ base: 'Hussein Hazimeh', tag: '0002' });
  });

  it('leaves ordinary names alone, including ones with other numbers', () => {
    expect(splitName('Kassem Danach')).toEqual({ base: 'Kassem Danach', tag: null });
    expect(splitName('R2 D2')).toEqual({ base: 'R2 D2', tag: null });
    expect(splitName('Someone 12345')).toEqual({ base: 'Someone 12345', tag: null });
  });
});

describe('formatting helpers', () => {
  it('formats counts', () => {
    expect(fmt(4263299)).toBe('4,263,299');
    expect(plural(1, 'paper')).toBe('1 paper');
    expect(plural(1500, 'paper')).toBe('1,500 papers');
    expect(plural(1, 'match', 'matches')).toBe('1 match');
    expect(plural(2, 'match', 'matches')).toBe('2 matches');
  });

  it('describes year spans', () => {
    expect(yearSpan(2014, 2026)).toBe('2014–2026');
    expect(yearSpan(2019, 2019)).toBe('2019');
    expect(yearSpan(null, null)).toBe('no dated papers');
  });

  it('builds dblp.org links with only the key encoded', () => {
    expect(recordUrl('journals/fgcs/TfailyGBHJZ26')).toBe('https://dblp.org/rec/journals/fgcs/TfailyGBHJZ26');
    expect(recordUrl('conf/x/A B?c')).toBe('https://dblp.org/rec/conf/x/A%20B%3Fc');
    expect(dblpSearchUrl('Hussein Hazimeh')).toBe('https://dblp.org/search?q=Hussein%20Hazimeh');
  });
});
