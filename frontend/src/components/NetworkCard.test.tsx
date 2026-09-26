import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NetworkSchema } from '../data/schemas';
import { jsonResponse, realChartData, renderWithProviders, stubChartData } from '../test/utils';
import { NetworkCard } from './NetworkCard';

// A stand-in for ECharts: records the latest option and hands back a fake chart that knows where the nodes are.
const mocked = vi.hoisted(() => ({ option: null as unknown, chart: null as unknown }));
vi.mock('./EChart', async () => {
  const React = await import('react');
  return {
    EChart: ({ option, onChart }: { option: unknown; onChart?: (chart: unknown) => void }) => {
      mocked.option = option;
      React.useEffect(() => {
        onChart?.(mocked.chart);
        return () => onChart?.(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div role="img" aria-label="network" />;
    },
  };
});

const real = NetworkSchema.parse(realChartData('coauthor_network.json'));
const ranked = [...real.nodes].sort((a, b) => b.papers - a.papers).map((n) => n.id);

type DrawnNode = { id: string; fixed: boolean; x?: number; y?: number; itemStyle: { opacity: number; borderWidth: number } };
const drawn = () => (mocked.option as { series: Array<{ data: DrawnNode[] }> }).series[0]?.data ?? [];

function fakeChartWithEveryNodePlaced() {
  const names = real.nodes.map((n) => n.id);
  mocked.chart = {
    getModel: () => ({
      getSeriesByIndex: () => ({
        getData: () => ({
          count: () => names.length,
          getName: (i: number) => names[i],
          getItemLayout: (i: number) => [i, i * 2] as [number, number],
        }),
      }),
    }),
  };
}

async function renderCard(route = '/') {
  mocked.chart = null;
  stubChartData();
  renderWithProviders(<NetworkCard />, route);
  await screen.findByText(/^Showing \d+ of 150 authors/);
}

const search = () => screen.getByLabelText('Highlight in this network');
const minShared = () => screen.getByRole('slider', { name: /Min\. shared papers per link/ });
const authorsShown = () => screen.getByRole('slider', { name: /Authors shown/ });

describe('NetworkCard', () => {
  it('starts with the strong links between connected authors, and says what that means', async () => {
    await renderCard();
    expect(screen.getByText(/^Showing \d+ of 150 authors and [\d,]+ links\. Links need at least 5 shared papers; authors with no remaining link are hidden\.$/)).toBeInTheDocument();
    expect(minShared()).toHaveValue('5');
    expect(authorsShown()).toHaveValue('100');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
    expect(drawn().length).toBeGreaterThan(0);
    expect(drawn().every((node) => node.itemStyle.opacity === 1)).toBe(true); // nobody dimmed until someone is highlighted
  });

  it('highlights a searched author: ringed, everyone else who is not a co-author dimmed', async () => {
    await renderCard();
    await userEvent.type(search(), 'dacheng{Enter}');

    expect(await screen.findByText(/^Dacheng Tao — #\d+ most prolific/)).toBeInTheDocument();
    expect(search()).toHaveValue('Dacheng Tao');
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
    const selected = drawn().find((node) => node.id === 'Dacheng Tao');
    expect(selected?.itemStyle.borderWidth).toBe(3);
    expect(drawn().some((node) => node.itemStyle.opacity < 1)).toBe(true);
  });

  it('finds an author whatever the case or accents typed', async () => {
    await renderCard();
    await userEvent.type(search(), 'MEROUANE{Enter}');
    expect(await screen.findByText(/^Mérouane Debbah — #/)).toBeInTheDocument();
  });

  it('clears the highlight with Escape or the Clear button', async () => {
    await renderCard();
    await userEvent.type(search(), 'dacheng{Enter}');
    await screen.findByText(/^Dacheng Tao —/);

    await userEvent.type(search(), '{Escape}');
    expect(await screen.findByText(/^Showing \d+ of 150 authors/)).toBeInTheDocument();
    expect(search()).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    await userEvent.type(search(), 'dacheng{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(await screen.findByText(/^Showing \d+ of 150 authors/)).toBeInTheDocument();
  });

  it('says so when nobody matches', async () => {
    await renderCard();
    await userEvent.type(search(), 'zzzqqq{Enter}');
    expect(await screen.findByText(/No author matching .zzzqqq. among the 150 most prolific authors in this network/)).toBeInTheDocument();
  });

  it('selects straight away when a suggestion from the list is picked', async () => {
    await renderCard();
    const suggestions = document.querySelectorAll('datalist option');
    expect(suggestions).toHaveLength(150);
    fireEvent.change(search(), { target: { value: ranked[3] } }); // what choosing a suggestion does
    expect(await screen.findByText(new RegExp(`^${ranked[3]?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — #4 most prolific`))).toBeInTheDocument();
  });

  it('shows more links as the threshold slider drops, using the singular for 1', async () => {
    await renderCard();
    const before = drawn().length;
    fireEvent.change(minShared(), { target: { value: '1' } });
    expect(await screen.findByText(/Links need at least 1 shared paper;/)).toBeInTheDocument();
    expect(drawn().length).toBeGreaterThanOrEqual(before);
    expect(screen.getByText('1', { selector: 'output' })).toBeInTheDocument();
  });

  it('widens "authors shown" for a hidden match and puts it back when cleared', async () => {
    await renderCard();
    const hidden = ranked[129] as string; // beyond the default top 100
    fireEvent.change(search(), { target: { value: hidden } });
    await screen.findByText(new RegExp('#130 most prolific'));
    expect(authorsShown()).toHaveValue('130');
    expect(drawn().some((node) => node.id === hidden)).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(authorsShown()).toHaveValue('100');
  });

  it('keeps every node where it is when highlighting, but lets the layout move when a slider changes', async () => {
    fakeChartWithEveryNodePlaced();
    stubChartData();
    renderWithProviders(<NetworkCard />);
    await screen.findByText(/^Showing \d+ of 150 authors/);
    expect(drawn().every((node) => !node.fixed)).toBe(true);

    await userEvent.type(search(), 'dacheng{Enter}');
    await screen.findByText(/^Dacheng Tao —/);
    expect(drawn().length).toBeGreaterThan(0);
    expect(drawn().every((node) => node.fixed && node.x !== undefined && node.y !== undefined)).toBe(true);

    fireEvent.change(minShared(), { target: { value: '3' } });
    await screen.findByText(/at ≥3 shared papers\)/); // the highlighted author's line now counts links at the new threshold
    expect(drawn().every((node) => !node.fixed)).toBe(true);
  });

  it('arrives already highlighting the author named in the address (the profile’s "Highlight in network" link)', async () => {
    await renderCard('/?highlight=Dacheng%20Tao');
    expect(await screen.findByText(/^Dacheng Tao — #/)).toBeInTheDocument();
    expect(search()).toHaveValue('Dacheng Tao');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('ignores a highlight for someone who is not in the network', async () => {
    await renderCard('/?highlight=Nobody%20At%20All');
    expect(screen.getByText(/^Showing \d+ of 150 authors/)).toBeInTheDocument();
    expect(search()).toHaveValue('');
  });

  it('says how to regenerate the data if the file is missing', async () => {
    stubChartData({ 'coauthor_network.json': () => jsonResponse({ error: 'nope' }, 404) });
    renderWithProviders(<NetworkCard />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('coauthor_network.json');
    expect(alert).toHaveTextContent('build_chart_data.py');
    expect(within(alert.closest('section') as HTMLElement).queryByLabelText('Highlight in this network')).not.toBeInTheDocument();
  });
});
