import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';

import type { Profile } from '../api/types';
import { useChartData } from '../data/hooks';
import { venuesOption, yearsOption } from '../lib/charts/profile';
import { dblpSearchUrl, fmt, plural, splitName, yearSpan } from '../lib/format';
import { EChart } from './EChart';
import { NameWithTag } from './NameWithTag';
import { PublicationList } from './PublicationList';

function profileNote(profile: Profile): string {
  const { tag } = splitName(profile.name);
  let note =
    'From DBLP’s publication records only. DBLP has no affiliation data, so use the venues and co-authors below to check this is the person you mean.';
  if (tag) {
    note += ` DBLP keeps different people with the same name apart by number; this is “${tag}”, and the others appear as separate results.`;
  }
  if (profile.last_year !== null && profile.last_year >= 2026) note += ' 2026 is still being indexed, so recent counts are partial.';
  return note;
}

export function AuthorProfile({ profile }: { profile: Profile }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const years = useMemo(() => yearsOption(profile.per_year), [profile.per_year]);
  const venues = useMemo(() => venuesOption(profile.venues), [profile.venues]);
  const { base } = splitName(profile.name);
  // the network only holds the 150 most prolific authors; offer the shortcut to those who are in it
  const network = useChartData('network');
  const inNetwork = useMemo(() => network.data?.nodes.some((node) => node.id === profile.name) ?? false, [network.data, profile.name]);

  // a new profile is a new "page": move focus to its heading so screen readers announce it
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [profile.id]);

  const stats: Array<[string, number]> = [
    ['Papers', profile.n_papers],
    ['Journal articles', profile.n_articles],
    ['Conference papers', profile.n_inproceedings],
    ['Co-authors', profile.n_coauthors],
    ['Venues', profile.n_venues],
  ];

  return (
    <article className="profile" aria-labelledby="profile-name">
      <div className="profile-head">
        <div>
          <p className="profile-kicker">Researcher profile</p>
          <h1 id="profile-name" ref={heading} tabIndex={-1}>
            <NameWithTag name={profile.name} />
          </h1>
          <p className="profile-sub">
            {plural(profile.n_papers, 'paper')} {'·'} {yearSpan(profile.first_year, profile.last_year)} {'·'}{' '}
            {plural(profile.n_coauthors, 'co-author')}
          </p>
        </div>
        <div className="profile-actions">
          {inNetwork && (
            <Link to={{ pathname: '/', search: `?highlight=${encodeURIComponent(profile.name)}`, hash: '#network' }}>Highlight in network</Link>
          )}
          <a href={dblpSearchUrl(base)} target="_blank" rel="noopener noreferrer">
            Open on DBLP
          </a>
        </div>
      </div>

      <p className="profile-note">{profileNote(profile)}</p>

      <div className="profile-stats">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{fmt(value)}</div>
          </div>
        ))}
      </div>

      <div className="profile-grid">
        <section className="profile-panel">
          <h3>Papers per year</h3>
          <EChart option={years} height={280} ariaLabel={`Papers per year, ${yearSpan(profile.first_year, profile.last_year)}`} />
        </section>
        <section className="profile-panel">
          <h3>Where they publish</h3>
          <EChart option={venues} height={280} ariaLabel="Most frequent venues" />
        </section>
      </div>

      <section className="profile-panel">
        <h3>Most frequent co-authors</h3>
        <ul className="chips">
          {profile.coauthors.length === 0 && <li className="opt-note">No co-authors on record.</li>}
          {profile.coauthors.map((coauthor) => (
            <li key={coauthor.id}>
              <Link
                to={`/author/${coauthor.id}`}
                title={`${plural(coauthor.shared, 'shared paper')} — open this profile`}
              >
                <NameWithTag name={coauthor.name} />
                <span className="chip-n">{'×'}{coauthor.shared}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* remount per author so "show more" state never leaks between profiles */}
      <PublicationList key={profile.id} profile={profile} />
    </article>
  );
}
