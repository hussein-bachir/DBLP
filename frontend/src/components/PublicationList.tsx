import { describeError } from '../api/client';
import { useMorePapers } from '../api/hooks';
import type { Paper, Profile } from '../api/types';
import { fmt, recordUrl } from '../lib/format';

function PublicationItem({ paper }: { paper: Paper }) {
  const kind = paper.type === 'article' ? 'journal article' : 'conference paper';
  return (
    <li>
      <a href={recordUrl(paper.key)} target="_blank" rel="noopener noreferrer">
        {paper.title || '(untitled)'}
      </a>
      <div className="pub-meta">{[paper.year ?? 'year n/a', paper.venue, kind].join(' · ')}</div>
    </li>
  );
}

/** The first page comes with the profile; "Show more" pulls the rest from /api/papers. */
export function PublicationList({ profile }: { profile: Profile }) {
  const more = useMorePapers(profile.id);
  const extra = more.data?.pages.flatMap((page) => page.papers) ?? [];
  const papers = [...profile.papers, ...extra];
  const canShowMore = papers.length < profile.n_papers && (more.data === undefined || more.hasNextPage);

  return (
    <section className="profile-panel">
      <h3>
        Publications{' '}
        <span className="profile-count">
          (showing {fmt(Math.min(papers.length, profile.n_papers))} of {fmt(profile.n_papers)}, newest first)
        </span>
      </h3>
      <ol className="pubs">
        {papers.map((paper) => (
          <PublicationItem key={paper.key} paper={paper} />
        ))}
      </ol>
      {more.error && <p className="author-search-status is-error">{describeError(more.error)}</p>}
      {canShowMore && (
        <button type="button" disabled={more.isFetchingNextPage} onClick={() => void more.fetchNextPage()}>
          {more.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </section>
  );
}
