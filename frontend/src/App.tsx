import { Link, Outlet, ScrollRestoration } from 'react-router-dom';

import { SearchBox } from './components/SearchBox';
import { SITE_TITLE } from './lib/site';

export default function App() {
  return (
    <>
      <header className="masthead">
        <p className="eyebrow">DBLP {'·'} computer science publication record</p>
        <p className="site-title">
          <Link to="/">{SITE_TITLE}</Link>
        </p>
        <SearchBox />
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        Built with ECharts. Data: the DBLP dump, parsed and aggregated offline (backend/build_chart_data.py); researcher search
        runs on a local SQLite index.
      </footer>
      <ScrollRestoration />
    </>
  );
}
