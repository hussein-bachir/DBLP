import { Link, Outlet, ScrollRestoration } from 'react-router-dom';

import { SearchBox } from './components/SearchBox';

export default function App() {
  return (
    <>
      <header className="masthead">
        <p className="eyebrow">DBLP {'·'} computer science publication record</p>
        <p className="site-title">
          <Link to="/">Researcher lookup</Link>
        </p>
        <SearchBox />
      </header>
      <main>
        <Outlet />
      </main>
      <footer>
        Data: the DBLP dump, indexed locally. Part of the dashboard {'—'} <a href="/">charts</a>.
      </footer>
      <ScrollRestoration />
    </>
  );
}
