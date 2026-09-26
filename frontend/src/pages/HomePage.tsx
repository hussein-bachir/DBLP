export default function HomePage() {
  return (
    <section className="profile intro">
      <p className="profile-kicker">How it works</p>
      <h1>Find any researcher in DBLP</h1>
      <p className="profile-note">
        Type any part of a name above, in any word order and with or without accents. Close spellings are tried when
        nothing matches exactly, so a slip like {'“'}Kenaan{'”'} still finds {'“'}Kanaan{'”'}. Pick a
        result to see their papers per year, where they publish, their most frequent co-authors, and every publication.
      </p>
      <p className="profile-note">
        People who share a name are listed separately (DBLP marks them 0001, 0002, {'…'}). Each result shows paper
        counts, years and top venues so you can tell them apart. DBLP has no affiliation data, so those clues are how you
        confirm you have the right person.
      </p>
      <p className="profile-note">
        <a href="/">Back to the charts dashboard</a>
      </p>
    </section>
  );
}
