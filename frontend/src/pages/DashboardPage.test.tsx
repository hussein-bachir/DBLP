import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ChartData } from '../data/schemas';
import { fmt } from '../lib/format';
import { jsonResponse, realChartData, renderWithProviders, stubChartData } from '../test/utils';
import DashboardPage from './DashboardPage';

// jsdom has no canvas: the mock exposes the option each chart was given, so tests can check the data it would draw.
vi.mock('../components/EChart', () => ({
  EChart: ({ ariaLabel, option }: { ariaLabel: string; option: unknown }) => (
    <div role="img" aria-label={ariaLabel} data-option={JSON.stringify(option)} />
  ),
}));

const TITLES = [
  'Publications per Year',
  'Articles vs. Conference Papers',
  'Most Prolific Authors',
  'Top Venues',
  'Authors per Paper',
  'Average Team Size Over Time',
  'Author Productivity (log scale)',
  'Distinct Venues per Year',
  'Most Common Title Words',
  'Topic Prevalence in Titles',
  'Venue Growth by Subfield',
];

type Series = Array<{ data: unknown[] }>;
function optionOf(title: string) {
  return JSON.parse(screen.getByRole('img', { name: title }).getAttribute('data-option') ?? '{}') as {
    series: Series;
    xAxis?: { data: unknown[] };
    yAxis?: { data: unknown[] };
  };
}

describe('DashboardPage', () => {
  it('draws all twelve charts (eleven cards and the network) from the real data files', async () => {
    stubChartData();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('img', { name: TITLES[0] });
    for (const title of TITLES) {
      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('img', { name: title })).toBeInTheDocument();
    }
    expect(await screen.findByRole('heading', { name: 'Co-authorship Network' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /Co-authorship network/ })).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(TITLES.length + 1);
  });

  it('shows the headline numbers and says exactly what the data covers', async () => {
    stubChartData();
    renderWithProviders(<DashboardPage />);
    const overview = realChartData('overview.json') as ChartData<'overview'>;

    await within(document.body).findByText(fmt(overview.total_records), { selector: '.stat-value' });
    const strip = document.querySelector('.stat-strip') as HTMLElement;
    expect(within(strip).getByText('Distinct authors').nextElementSibling).toHaveTextContent(fmt(overview.distinct_authors));
    expect(within(strip).getByText('Year range').nextElementSibling).toHaveTextContent(`${overview.year_min}–${overview.year_max}`);
    const lede = document.querySelector('.lede') as HTMLElement;
    expect(lede).toHaveTextContent(`from ${overview.year_min} through ${overview.year_max}`);
    expect(lede).toHaveTextContent(`${fmt(overview.excluded_records)} records dated after ${overview.year_max} are left out`);
  });

  it('feeds each chart the data from its own file', async () => {
    stubChartData();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('img', { name: 'Top Venues' });

    const perYear = realChartData('publications_per_year.json') as ChartData<'publicationsPerYear'>;
    const pubs = optionOf('Publications per Year');
    expect(pubs.xAxis?.data).toEqual(perYear.map((r) => r.year));
    expect(pubs.series[0]?.data).toEqual(perYear.map((r) => r.count));

    // the biggest bar is drawn last (the top), and there are 20 bars
    const topAuthors = optionOf('Most Prolific Authors');
    expect(topAuthors.series[0]?.data).toHaveLength(20);
    const values = topAuthors.series[0]?.data as number[];
    expect([...values].sort((a, b) => a - b)).toEqual(values);

    const topics = realChartData('topic_trends.json') as ChartData<'topicTrends'>;
    expect(optionOf('Topic Prevalence in Titles').series).toHaveLength(Object.keys(topics.series).length);
  });

  it('opens the ratio charts at 1970 but the publications chart on the whole range', async () => {
    stubChartData();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('img', { name: 'Publications per Year' });
    const zoomStart = (title: string) =>
      (JSON.parse(screen.getByRole('img', { name: title }).getAttribute('data-option') ?? '{}') as { dataZoom: Array<{ startValue: number }> })
        .dataZoom[0]?.startValue;
    const years = (realChartData('publications_per_year.json') as ChartData<'publicationsPerYear'>).map((r) => r.year);
    expect(zoomStart('Publications per Year')).toBe(0);
    expect(zoomStart('Average Team Size Over Time')).toBe(years.indexOf(1970));
    expect(zoomStart('Topic Prevalence in Titles')).toBe(years.indexOf(1970));
  });

  it('shows a loading state until the data arrives', async () => {
    const never = () => new Promise<Response>(() => {});
    stubChartData({ 'top_authors.json': never });
    renderWithProviders(<DashboardPage />);
    const card = (await screen.findByRole('heading', { name: 'Most Prolific Authors' })).closest('section') as HTMLElement;
    expect(within(card).getByRole('status')).toHaveTextContent('Loading');
    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
  });

  it('confines a missing data file to its own card and says how to regenerate it', async () => {
    stubChartData({ 'top_authors.json': () => jsonResponse({ error: 'nope' }, 404) });
    renderWithProviders(<DashboardPage />);
    const card = (await screen.findByRole('heading', { name: 'Most Prolific Authors' })).closest('section') as HTMLElement;
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('top_authors.json');
    expect(alert).toHaveTextContent('build_chart_data.py');
    // every other chart still drew: the other ten cards plus the network
    await screen.findByRole('img', { name: /Co-authorship network/ });
    expect(screen.getAllByRole('img')).toHaveLength(TITLES.length);
  });

  it('rejects a data file with the wrong shape instead of drawing a broken chart', async () => {
    const bad = { years: [1970, 1971, 1972], series: { neural: [1, 2] } }; // one value short
    stubChartData({ 'topic_trends.json': () => jsonResponse(bad) });
    renderWithProviders(<DashboardPage />);
    const card = (await screen.findByRole('heading', { name: 'Topic Prevalence in Titles' })).closest('section') as HTMLElement;
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('topic_trends.json');
    expect(alert).toHaveTextContent('expected shape');
    expect(within(card).queryByRole('img')).not.toBeInTheDocument();
  });

  it('sets the page title', async () => {
    stubChartData();
    renderWithProviders(<DashboardPage />);
    await screen.findByRole('img', { name: 'Top Venues' });
    expect(document.title).toBe('A Field in Motion · DBLP');
  });
});
