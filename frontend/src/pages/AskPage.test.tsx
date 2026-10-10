import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { AskEvent, SourcePaper } from '../api/types';
import { ASK_STATUS, eventStream, makeDiagnostics, jsonResponse, renderWithProviders, stubApi } from '../test/utils';
import AskPage, { EXAMPLES } from './AskPage';

const SOURCE: SourcePaper = {
  ref: 'P1',
  id: 10,
  key: 'journals/jhir/XuGSWBW21',
  title: 'Federated Learning for Healthcare Informatics.',
  year: 2021,
  venue: 'journals/jhir',
  type: 'article',
  authors: [
    { id: 7, name: 'Fei Wang 0001' },
    { id: 8, name: 'Jiang Bian' },
  ],
  n_authors: 6,
};

const ANSWER: AskEvent[] = [
  { type: 'status', text: 'Searching titles for “federated learning healthcare”' },
  { type: 'token', text: 'One survey stands out [P1]' },
  { type: 'token', text: ', and another [P9].' },
  { type: 'done', sources: [SOURCE], authors: [{ id: 7, name: 'Fei Wang 0001' }], provider: 'groq', model: 'llama-3.3-70b-versatile', tool_calls: 1, diagnostics: makeDiagnostics() },
];

const SUMMARY = 'hybrid search · 2 lookups · 6.1 s · 1,850 tokens · 1 made-up citation dropped';

function askRequests(fetchMock: ReturnType<typeof stubApi>): RequestInit[] {
  return fetchMock.mock.calls.filter(([input]) => String(input) === '/api/ask').map(([, init]) => init ?? {});
}

const askBodies = (fetchMock: ReturnType<typeof stubApi>) =>
  askRequests(fetchMock).map((init) => JSON.parse(String(init.body)) as Record<string, unknown>);

async function ask(question: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: 'Your question' }), question);
  await user.click(screen.getByRole('button', { name: 'Ask' }));
  return user;
}

describe('AskPage', () => {
  it('offers the usable providers, with the default selected', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS) });
    renderWithProviders(<AskPage />);
    const select = await screen.findByRole('combobox', { name: 'Model provider' });
    await waitFor(() => expect(select).toHaveValue('groq'));
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Groq', 'Ollama (local)']);
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveAttribute('placeholder', 'llama-3.3-70b-versatile');
  });

  it('fills the question box from an example', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS) });
    renderWithProviders(<AskPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: EXAMPLES[1] }));
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue(EXAMPLES[1]);
  });

  it('streams the answer, links citations to the sources and drops made-up ones', async () => {
    const fetchMock = stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS), '/api/ask': () => eventStream(ANSWER) });
    renderWithProviders(<AskPage />);
    await ask('federated learning in healthcare?');

    expect(await screen.findByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'What the model looked up' })).toHaveTextContent('Searching titles for “federated learning healthcare”');

    const answer = screen.getByText(/One survey stands out/).closest('.ask-answer') as HTMLElement;
    expect(within(answer).getByRole('link', { name: 'P1' })).toHaveAttribute('href', '#source-P1');
    expect(answer).not.toHaveTextContent('P9');
    expect(answer).toHaveTextContent('One survey stands out [P1], and another.');

    const source = document.getElementById('source-P1') as HTMLElement;
    expect(within(source).getByRole('link', { name: SOURCE.title as string })).toHaveAttribute('href', 'https://dblp.org/rec/journals/jhir/XuGSWBW21');
    expect(within(source).getByRole('link', { name: 'Jiang Bian' })).toHaveAttribute('href', '/author/8');
    expect(source).toHaveTextContent('and 4 others');

    const mentioned = screen.getByRole('heading', { name: 'Researchers mentioned' }).parentElement as HTMLElement;
    expect(within(mentioned).getByRole('link')).toHaveAttribute('href', '/author/7');

    expect(askBodies(fetchMock)).toEqual([{ question: 'federated learning in healthcare?', provider: 'groq', model: null }]);
  });

  it('shows how the answer was produced, details closed until asked for', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS), '/api/ask': () => eventStream(ANSWER) });
    renderWithProviders(<AskPage />);
    await ask('federated learning in healthcare?');

    const details = (await screen.findByText(SUMMARY)).closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    await userEvent.setup().click(within(details).getByText('Details'));
    expect(details.open).toBe(true);
    expect(details).toHaveTextContent('llama-3.3-70b-versatile (groq)');
    expect(details).toHaveTextContent('Semantic search covers only 2024 on; older papers were found by keyword alone.');
    expect(details).toHaveTextContent('5 of 6 citations match papers the tools returned.');
    expect(details).toHaveTextContent('These are test-set figures, not a measurement of this answer.');
  });

  it('sends the chosen provider and model', async () => {
    const fetchMock = stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS), '/api/ask': () => eventStream(ANSWER) });
    renderWithProviders(<AskPage />);
    const user = userEvent.setup();
    await screen.findByRole('option', { name: 'Ollama (local)' }); // the list arrives with /api/ask/status
    await user.selectOptions(screen.getByRole('combobox', { name: 'Model provider' }), 'ollama');
    await user.type(screen.getByRole('combobox', { name: 'Model' }), 'llama3.1:8b');
    await ask('q');
    await screen.findByText(SUMMARY);
    expect(askBodies(fetchMock)[0]).toMatchObject({ provider: 'ollama', model: 'llama3.1:8b' });
  });

  it('shows a provider error such as a rate limit', async () => {
    stubApi({
      '/api/ask/status': () => jsonResponse(ASK_STATUS),
      '/api/ask': () => eventStream([{ type: 'error', message: "The provider's free-tier rate limit was hit; retry in about 20 s." }]),
    });
    renderWithProviders(<AskPage />);
    await ask('q');
    expect(await screen.findByRole('alert')).toHaveTextContent('rate limit was hit; retry in about 20 s');
  });

  it('says so when the stream ends without an answer', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse(ASK_STATUS), '/api/ask': () => eventStream([{ type: 'token', text: 'half' }]) });
    renderWithProviders(<AskPage />);
    await ask('q');
    expect(await screen.findByRole('alert')).toHaveTextContent('stopped before it was finished');
  });

  it('can stop an answer in progress', async () => {
    const fetchMock = stubApi({
      '/api/ask/status': () => jsonResponse(ASK_STATUS),
      '/api/ask': () => eventStream([{ type: 'token', text: 'Partial answer' }], { keepOpen: true }),
    });
    renderWithProviders(<AskPage />);
    await ask('q');
    expect(await screen.findByText('Partial answer')).toBeInTheDocument();
    // In a browser, React re-renders this button as the Ask submit button before the click's
    // default action runs, which re-submitted the form; jsdom renders later, so check the cause:
    // the click must cancel its default action.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      screen.getByRole('button', { name: 'Stop' }).dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(askRequests(fetchMock)[0]?.signal?.aborted).toBe(true); // the server sees the disconnect and stops
    // the click on Stop must not also submit the form (it once re-asked the question)
    expect(askRequests(fetchMock)).toHaveLength(1);
    expect(screen.queryByText('Partial answer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeEnabled();
  });

  it('explains how to configure a model when none is available', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse({ ...ASK_STATUS, providers: [], default_provider: null }) });
    renderWithProviders(<AskPage />);
    expect(await screen.findByText(/No language model is configured/)).toBeInTheDocument();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Your question' }), 'q');
    expect(screen.getByRole('button', { name: 'Ask' })).toBeDisabled();
  });

  it('tells the user to build the title index when it is missing', async () => {
    stubApi({ '/api/ask/status': () => jsonResponse({ ...ASK_STATUS, keyword_search: false }) });
    renderWithProviders(<AskPage />);
    expect(await screen.findByText(/python rag\/build_title_index\.py/)).toBeInTheDocument();
  });
});
