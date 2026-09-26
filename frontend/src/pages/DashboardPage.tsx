import { useEffect } from 'react';

import { DataChart } from '../components/DataChart';
import { NetworkCard } from '../components/NetworkCard';
import { StatStrip } from '../components/StatStrip';
import type { ChartData } from '../data/schemas';
import {
  authorProductivityOption,
  coauthorDistributionOption,
  hbarOption,
  multiLineOption,
  publicationsPerYearOption,
  teamSizeOption,
  typeDistributionOption,
  venuesPerYearOption,
} from '../lib/charts/dashboard';
import { SITE_TITLE } from '../lib/site';
import { COLOR } from '../lib/theme';

// Module-level so each card gets the same function every render (the chart only redraws when its data changes).
const buildTopAuthors = (rows: ChartData<'topAuthors'>) => hbarOption(rows.map((r) => ({ label: r.name, value: r.count })), COLOR.gold);
const buildTopVenues = (rows: ChartData<'topVenues'>) => hbarOption(rows.map((r) => ({ label: r.venue, value: r.count })), COLOR.verdigris);
const buildTitleWords = (rows: ChartData<'titleWords'>) => hbarOption(rows.map((r) => ({ label: r.word, value: r.count })), COLOR.slate);
const buildTopicTrends = (data: ChartData<'topicTrends'>) => multiLineOption(data, '% of titles');
const buildVenueComparison = (data: ChartData<'venueComparison'>) => multiLineOption(data, 'papers');

export default function DashboardPage() {
  useEffect(() => {
    document.title = `${SITE_TITLE} · DBLP`;
  }, []);

  return (
    <>
      <StatStrip />
      <div className="cards">
        <DataChart
          dataKey="publicationsPerYear"
          title="Publications per Year"
          note="Records per calendar year, article + inproceedings combined. Drag the slider to zoom."
          build={publicationsPerYearOption}
          height={340}
        />
        <DataChart
          dataKey="typeDistribution"
          title="Articles vs. Conference Papers"
          note="Share of journal articles vs. inproceedings records."
          build={typeDistributionOption}
          height={340}
        />
        <DataChart
          dataKey="topAuthors"
          title="Most Prolific Authors"
          note="Top 20 authors by all-time paper count."
          build={buildTopAuthors}
          height={460}
        />
        <DataChart
          dataKey="topVenues"
          title="Top Venues"
          note="Top 20 venues by all-time paper count (DBLP key prefix). journals/corr is DBLP's mirror of arXiv preprints, about 10% of all records, which is why it dwarfs everything else."
          build={buildTopVenues}
          height={460}
        />
        <DataChart
          dataKey="coauthorDistribution"
          title="Authors per Paper"
          note="Distribution of team size, 1–20 co-authors."
          build={coauthorDistributionOption}
          height={280}
        />
        <DataChart
          dataKey="avgTeamSize"
          title="Average Team Size Over Time"
          note="Mean number of authors per paper, by year. Opens at 1970 — earlier years have too few records for a stable average; drag the slider to see them."
          build={teamSizeOption}
          height={280}
        />
        <DataChart
          dataKey="authorProductivity"
          title="Author Productivity (log scale)"
          note="How many authors published 1 paper vs. 20+."
          build={authorProductivityOption}
          height={280}
        />
        <DataChart
          dataKey="venuesPerYear"
          title="Distinct Venues per Year"
          note="Count of unique venues publishing each year. Opens at 1970; drag the slider for earlier years."
          build={venuesPerYearOption}
          height={280}
        />
        <DataChart
          dataKey="titleWords"
          title="Most Common Title Words"
          note="Top 30 words in paper titles, stopwords removed."
          build={buildTitleWords}
          height={560}
          wide
        />
        <DataChart
          dataKey="topicTrends"
          title="Topic Prevalence in Titles"
          note="Share of that year's titles mentioning each keyword — normalized so the lines track topical interest, not dataset growth. Opens at 1970; drag the slider for earlier years."
          build={buildTopicTrends}
          height={560}
          wide
        />
        <DataChart
          dataKey="venueComparison"
          title="Venue Growth by Subfield"
          note="Raw paper counts for five representative venues across CV, NLP, control theory, IR, and remote sensing. Opens at 1970; drag the slider for earlier years. The Remote Sensing drop to zero in 2025 is an indexing gap — DBLP has no 2025 records for that journal yet — not a real decline."
          build={buildVenueComparison}
          height={560}
          wide
        />
        <NetworkCard />
      </div>
    </>
  );
}
