import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';

import App from './App';
import HomePage from './pages/HomePage';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

// The app lives under /app/ (vite `base`), so the router must strip that prefix.
const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <App />,
      HydrateFallback: () => <p className="profile-note">Loading{'…'}</p>,
      children: [
        { index: true, element: <HomePage /> },
        {
          // the profile page pulls in ECharts, so it is loaded only when first visited
          path: 'author/:id',
          lazy: async () => ({ Component: (await import('./pages/AuthorPage')).default }),
        },
        { path: '*', element: <HomePage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
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
