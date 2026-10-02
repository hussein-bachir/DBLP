import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import App from './App';
import NotFoundPage from './pages/NotFoundPage';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// `basename` follows vite's `base`, so the app still routes correctly if it is ever served from a sub-path.
const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      HydrateFallback: () => <p className="profile-note">Loading{'…'}</p>,
      children: [
        {
          // both pages pull in ECharts, so they load as their own chunks
          index: true,
          lazy: async () => ({ Component: (await import('./pages/DashboardPage')).default }),
        },
        {
          path: 'author/:id',
          lazy: async () => ({ Component: (await import('./pages/AuthorPage')).default }),
        },
        {
          path: 'ask',
          lazy: async () => ({ Component: (await import('./pages/AskPage')).default }),
        },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
