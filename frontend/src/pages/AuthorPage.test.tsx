import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { PAGE_SIZE } from '../api/hooks';
import { LocationDisplay, callsTo, jsonResponse, makePapers, makeProfile, renderWithProviders, stubApi } from '../test/utils';
import AuthorPage from './AuthorPage';

// jsdom has no canvas; the charts' data is covered by chartOptions.test.ts
vi.mock('../components/EChart', () => ({
  EChart: ({ ariaLabel }: { ariaLabel: string }) => <div role="img" aria-label={ariaLabel} />,
}));

function renderAuthor(id: string | number) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/author/:id" element={<AuthorPage />} />
      </Routes>
      <LocationDisplay />
    </>,
    `/author/${id}`,
  );
}

describe('AuthorPage', () => {
  it('shows the profile: name, number tag, totals, charts and caveats', async () => {
    stubApi({ '/api/author': () => jsonResponse(makeProfile()) });
    renderAuthor(1041880);

    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Hussein Hazimeh 0002');
    expect(within(heading).getByText('0002')).toHaveClass('tag');
    expect(screen.getByText(/25 papers/, { selector: '.profile-sub' })).toHaveTextContent('2014–2026');
    expect(screen.getByText('Journal articles').nextElementSibling).toHaveTextContent('9');
    expect(screen.getByRole('img', { name: /Papers per year, 2014.2026/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Most frequent venues' })).toBeInTheDocument();
    expect(screen.getByText(/no affiliation data/)).toBeInTheDocument();
    expect(screen.getByText(/this is .0002./)).toBeInTheDocument();
    expect(screen.getByText(/2026 is still being indexed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open on DBLP' })).toHaveAttribute('href', 'https://dblp.org/search?q=Hussein%20Hazimeh');
    expect(document.title).toBe('Hussein Hazimeh · DBLP researcher lookup');
  });

  it('moves keyboard focus to the new profile heading', async () => {
    stubApi({ '/api/author': () => jsonResponse(makeProfile()) });
    renderAuthor(1041880);
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading).toHaveFocus();
  });

  it('links co-authors to their own profiles', async () => {
    stubApi({ '/api/author': () => jsonResponse(makeProfile()) });
    renderAuthor(1041880);
    const link = await screen.findByRole('link', { name: /Elena Mugellini/ });
    expect(link).toHaveAttribute('href', '/author/5');
    expect(link).toHaveTextContent('×10');
    expect(screen.getByRole('link', { name: /Rahul Mazumder/ })).toHaveTextContent('0001');

    await userEvent.click(link);
    expect(screen.getByTestId('location')).toHaveTextContent('/author/5');
  });

  it('links each publication to its dblp.org record, safely', async () => {
    stubApi({ '/api/author': () => jsonResponse(makeProfile({ papers: makePapers(1), n_papers: 1 })) });
    renderAuthor(1041880);
    const link = await screen.findByRole('link', { name: 'Paper number 0.' });
    expect(link).toHaveAttribute('href', 'https://dblp.org/rec/conf/test/Paper0');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('pages through a long publication list with "Show more"', async () => {
    const total = PAGE_SIZE + 10;
    const fetchMock = stubApi({
      '/api/author': () => jsonResponse(makeProfile({ n_papers: total, papers: makePapers(PAGE_SIZE) })),
      '/api/papers': (url) => {
        expect(url.searchParams.get('offset')).toBe(String(PAGE_SIZE));
        return jsonResponse({ papers: makePapers(10, PAGE_SIZE) });
      },
    });
    renderAuthor(1041880);

    await screen.findByRole('heading', { level: 1 });
    const list = document.querySelector<HTMLElement>('ol.pubs') as HTMLElement; // the co-author chips are a list too
    expect(within(list).getAllByRole('listitem')).toHaveLength(PAGE_SIZE);
    expect(screen.getByText(new RegExp(`showing ${PAGE_SIZE} of ${total}`))).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await screen.findByText(new RegExp(`showing ${total} of ${total}`));
    expect(within(list).getAllByRole('listitem')).toHaveLength(total);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/papers')).toHaveLength(1);
  });

  it('offers no "Show more" when everything is already shown', async () => {
    stubApi({ '/api/author': () => jsonResponse(makeProfile()) });
    renderAuthor(1041880);
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('says so for an unknown author', async () => {
    stubApi({ '/api/author': () => jsonResponse({ error: 'no such author' }, 404) });
    renderAuthor(999999999);
    expect(await screen.findByRole('heading', { name: 'No such researcher' })).toBeInTheDocument();
  });

  it('says so for a malformed address without calling the API', async () => {
    const fetchMock = stubApi({});
    renderAuthor('abc');
    expect(await screen.findByRole('heading', { name: 'No such researcher' })).toBeInTheDocument();
    expect(callsTo(fetchMock, '/api/author')).toHaveLength(0);
  });

  it('explains what to run when the server is down', async () => {
    stubApi({ '/api/author': () => new Response('bad gateway', { status: 502, headers: { 'content-type': 'text/plain' } }) });
    renderAuthor(1041880);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/python server\.py/);
  });
});
