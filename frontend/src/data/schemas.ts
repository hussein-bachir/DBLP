import { z } from 'zod';

// One schema per file that backend/build_chart_data.py writes to public/data/.
// They double as the TypeScript types (z.infer) and as a runtime check, so a
// change to the builder that the charts don't understand fails loudly with the
// file name instead of drawing a blank chart. schemas.test.ts validates the
// real committed files against them.

const count = z.number().int().nonnegative();
const year = z.number().int();

export const OverviewSchema = z.object({
  total_records: count,
  excluded_records: count,
  year_min: year,
  year_max: year,
  distinct_authors: count,
  distinct_venues: count,
});

export const PublicationsPerYearSchema = z.array(z.object({ year, count }));
export const TypeDistributionSchema = z.array(z.object({ type: z.string(), count }));
export const TopAuthorsSchema = z.array(z.object({ name: z.string(), count }));
export const CoauthorDistributionSchema = z.array(z.object({ n_authors: z.number().int().min(1), count }));
export const TopVenuesSchema = z.array(z.object({ venue: z.string(), count }));
export const AuthorProductivitySchema = z.array(z.object({ bucket: z.string(), count }));
export const AvgTeamSizeSchema = z.array(z.object({ year, avg_authors: z.number().nonnegative() }));
export const VenuesPerYearSchema = z.array(z.object({ year, distinct_venues: count }));
export const TitleWordsSchema = z.array(z.object({ word: z.string(), count }));

const YearSeriesSchema = z
  .object({
    years: z.array(year).min(1),
    series: z.record(z.string(), z.array(z.number())),
  })
  .refine((data) => Object.values(data.series).every((values) => values.length === data.years.length), {
    message: 'every series must have exactly one value per year',
  });
export const TopicTrendsSchema = YearSeriesSchema;
export const VenueComparisonSchema = YearSeriesSchema;

export const NetworkSchema = z
  .object({
    nodes: z.array(z.object({ id: z.string(), papers: count, group: z.number().int(), degree: z.number() })),
    edges: z.array(z.object({ source: z.string(), target: z.string(), weight: z.number().int().positive() })),
    n_communities: z.number().int().nonnegative(),
  })
  .refine(
    (data) => {
      const ids = new Set(data.nodes.map((node) => node.id));
      return data.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target));
    },
    { message: 'every edge must connect two known authors' },
  );

/** Every chart data file: its name under public/data/ and the schema it must satisfy. */
export const CHART_DATA = {
  overview: { file: 'overview.json', schema: OverviewSchema },
  publicationsPerYear: { file: 'publications_per_year.json', schema: PublicationsPerYearSchema },
  typeDistribution: { file: 'type_distribution.json', schema: TypeDistributionSchema },
  topAuthors: { file: 'top_authors.json', schema: TopAuthorsSchema },
  coauthorDistribution: { file: 'coauthor_distribution.json', schema: CoauthorDistributionSchema },
  topVenues: { file: 'top_venues.json', schema: TopVenuesSchema },
  authorProductivity: { file: 'author_productivity.json', schema: AuthorProductivitySchema },
  avgTeamSize: { file: 'avg_team_size_by_year.json', schema: AvgTeamSizeSchema },
  venuesPerYear: { file: 'venues_per_year.json', schema: VenuesPerYearSchema },
  titleWords: { file: 'top_title_words.json', schema: TitleWordsSchema },
  topicTrends: { file: 'topic_trends.json', schema: TopicTrendsSchema },
  venueComparison: { file: 'venue_comparison.json', schema: VenueComparisonSchema },
  network: { file: 'coauthor_network.json', schema: NetworkSchema },
} as const;

export type ChartDataKey = keyof typeof CHART_DATA;
export type ChartData<K extends ChartDataKey> = z.infer<(typeof CHART_DATA)[K]['schema']>;

export type Overview = ChartData<'overview'>;
export type NetworkData = ChartData<'network'>;
export type NetworkNode = NetworkData['nodes'][number];
export type NetworkEdge = NetworkData['edges'][number];
export type YearSeries = ChartData<'topicTrends'>;
