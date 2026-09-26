import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { HAZIMEH_SEARCH, LocationDisplay, STATUS, callsTo, jsonResponse, renderWithProviders, stubApi } from '../test/utils';
import { SearchBox } from './SearchBox';

function renderBox() {
  return renderWithProviders(
    <>
      <SearchBox />
      <LocationDisplay />
    </>,
  );
}

describe('SearchBox', () => {
  it('shows how much is searchable before anything is typed', async () => {
    stubApi({ '/api/status': () => jsonResponse(STATUS) });
    renderBox();
    expect(await screen.findByText(/Searching 4,263,299 researchers across 8,423,776 DBLP records/)).toBeInTheDocument();
  });

  it('lists matches as you type and tells apart people who share a name', async () => {
    stubApi({ '/api/status': () => jsonResponse(STATUS), '/api/search': () => jsonResponse(HAZIMEH_SEARCH) });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'hussein hazimeh');

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('Hussein Hazimeh 0001');
    expect(within(options[0] as HTMLElement).getByText('0001')).toHaveClass('tag');
    expect(options[0]).toHaveTextContent('37 papers');
    expect(options[1]).toHaveTextContent('conf/icsca ×2');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByText(/2 matches/)).toBeInTheDocument();
  });

  it('waits for a pause in typing instead of querying on every keystroke', async () => {
    const fetchMock = stubApi({ '/api/status': () => jsonResponse(STATUS), '/api/search': () => jsonResponse(HAZIMEH_SEARCH) });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'hazimeh');
    await screen.findAllByRole('option');

    const searches = callsTo(fetchMock, '/api/search');
    expect(searches).toHaveLength(1);
    expect(searches[0]?.searchParams.get('q')).toBe('hazimeh');
  });

  it('does not query until there are enough letters', async () => {
    const fetchMock = stubApi({ '/api/status': () => jsonResponse(STATUS) });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'ha');
    expect(await screen.findByText('Type at least 3 letters of a name.')).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/search')).toHaveLength(0);
  });

  it('moves with the arrow keys and opens the chosen profile on Enter', async () => {
    stubApi({ '/api/status': () => jsonResponse(STATUS), '/api/search': () => jsonResponse(HAZIMEH_SEARCH) });
    renderBox();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'hussein hazimeh');
    await screen.findAllByRole('option');

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]?.id);

    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/author/1041880');
    expect(input).toHaveValue('Hussein Hazimeh 0002');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    // the search is finished, so the "use the arrow keys" advice goes away
    expect(await screen.findByText(/Searching 4,263,299 researchers/)).toBeInTheDocument();
    expect(screen.queryByText(/matches/)).not.toBeInTheDocument();
  });

  it('never opens a stale result: Enter right after typing waits for the new results, then opens the top match', async () => {
    const kanaan = {
      query: 'kanaan',
      corrected: null,
      hint: null,
      results: [{ id: 2468984, name: 'Hussein Kanaan', n_papers: 5, first_year: 2019, last_year: 2021, venues: [] }],
    };
    stubApi({
      '/api/status': () => jsonResponse(STATUS),
      '/api/search': async (url) => {
        if (url.searchParams.get('q') === 'kanaan') {
          await new Promise((resolve) => setTimeout(resolve, 150)); // the answer is slow to arrive
          return jsonResponse(kanaan);
        }
        return jsonResponse(HAZIMEH_SEARCH);
      },
    });
    renderBox();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'hazimeh');
    await screen.findAllByRole('option'); // the list now belongs to "hazimeh"

    await userEvent.clear(input);
    await userEvent.type(input, 'kanaan{Enter}');
    // the old Hazimeh list may still be on screen, but Enter must not have opened one of its people
    expect(screen.getByTestId('location')).toHaveTextContent('/');
    expect(screen.getByTestId('location')).not.toHaveTextContent('/author');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/author/2468984'));
    expect(input).toHaveValue('Hussein Kanaan');
  });

  it('cancels a queued Enter if the user keeps typing', async () => {
    stubApi({
      '/api/status': () => jsonResponse(STATUS),
      '/api/search': async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return jsonResponse({ query: 'x', corrected: null, hint: null, results: HAZIMEH_SEARCH.results });
      },
    });
    renderBox();
    const input = screen.getByRole('combobox');
    await userEvent.type(input, 'hazimeh{Enter}x');
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.getByTestId('location')).not.toHaveTextContent('/author');
  });

  it('wraps around at the ends of the list', async () => {
    stubApi({ '/api/status': () => jsonResponse(STATUS), '/api/search': () => jsonResponse(HAZIMEH_SEARCH) });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'hazimeh');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes the list on Escape', async () => {
    stubApi({ '/api/status': () => jsonResponse(STATUS), '/api/search': () => jsonResponse(HAZIMEH_SEARCH) });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'hazimeh');
    await screen.findAllByRole('option');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false');
  });

  it('says so when the typed spelling was corrected', async () => {
    stubApi({
      '/api/status': () => jsonResponse(STATUS),
      '/api/search': () => jsonResponse({ ...HAZIMEH_SEARCH, query: 'hussein kenaan', corrected: 'hussein kanaan' }),
    });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'hussein kenaan');
    expect(await screen.findByText(/No exact match for .hussein kenaan. .* closest names for .hussein kanaan./)).toBeInTheDocument();
    expect(await screen.findByText(/spelling corrected/)).toBeInTheDocument();
  });

  it('reports an empty result', async () => {
    stubApi({
      '/api/status': () => jsonResponse(STATUS),
      '/api/search': () => jsonResponse({ query: 'zzzqqq', results: [], corrected: null, hint: null }),
    });
    renderBox();
    await userEvent.type(screen.getByRole('combobox'), 'zzzqqq');
    expect(await screen.findByText(/No researcher found for .zzzqqq./)).toBeInTheDocument();
  });

  it('explains what to build when the index is missing', async () => {
    stubApi({ '/api/status': () => jsonResponse({ ready: false, error: 'not built' }, 503) });
    renderBox();
    await waitFor(() => expect(screen.getByText(/build_author_index\.py/)).toBeInTheDocument());
  });

  it('explains what to run when the server is not reachable', async () => {
    stubApi({ '/api/status': () => new Response('gateway down', { status: 502, headers: { 'content-type': 'text/plain' } }) });
    renderBox();
    await waitFor(() => expect(screen.getByText(/python server\.py/)).toBeInTheDocument());
  });
});
