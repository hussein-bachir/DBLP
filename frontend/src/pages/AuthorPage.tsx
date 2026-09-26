import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError, describeError } from '../api/client';
import { useAuthor } from '../api/hooks';
import { AuthorProfile } from '../components/AuthorProfile';
import { splitName } from '../lib/format';
import { SITE_TITLE } from '../lib/site';

export default function AuthorPage() {
  const { id: raw } = useParams();
  const id = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : null;
  const author = useAuthor(id);
  const name = author.data?.name;

  useEffect(() => {
    document.title = name ? `${splitName(name).base} · ${SITE_TITLE}` : SITE_TITLE;
    return () => {
      document.title = SITE_TITLE;
    };
  }, [name]);

  if (id === null || (author.error instanceof ApiError && author.error.kind === 'notfound')) {
    return (
      <section className="profile">
        <h1>No such researcher</h1>
        <p className="profile-note">
          That address doesn{'’'}t match anyone in the index. <Link to="/">Search by name instead</Link>.
        </p>
      </section>
    );
  }
  if (author.error) {
    return (
      <section className="profile" role="alert">
        <h1>Couldn{'’'}t load this profile</h1>
        <p className="profile-note">{describeError(author.error)}</p>
      </section>
    );
  }
  if (!author.data) {
    return (
      <section className="profile" role="status">
        <p className="profile-note">Loading profile{'…'}</p>
      </section>
    );
  }
  return <AuthorProfile profile={author.data} />;
}
