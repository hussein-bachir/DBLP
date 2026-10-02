import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router-dom';

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
        <nav className="site-nav" aria-label="Sections">
          <NavLink to="/" end>
            Dashboard
          </NavLink>
          <NavLink to="/ask">Ask the data</NavLink>
        </nav>
        <SearchBox />
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        Built with ECharts. Data: the DBLP dump, parsed and aggregated offline (backend/build_chart_data.py); researcher search
        and Ask run on a local SQLite index; Ask's answers come from a language model you choose.
      </footer>
      <ScrollRestoration />
    </>
  );
}
