import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <section className="profile">
      <h1>Page not found</h1>
      <p className="profile-note">
        There is nothing at this address. <Link to="/">Back to the dashboard</Link>, or search for a researcher above.
      </p>
    </section>
  );
}
