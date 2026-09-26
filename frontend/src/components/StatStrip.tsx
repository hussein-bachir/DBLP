import { describeChartDataError } from '../data/client';
import { useChartData } from '../data/hooks';
import { fmt } from '../lib/format';

/** The four headline numbers, and the sentence saying exactly what the dashboard covers. */
export function StatStrip() {
  const { data, error } = useChartData('overview');

  if (error) {
    return (
      <p className="chart-state is-error" role="alert">
        {describeChartDataError(error)}
      </p>
    );
  }
  if (!data) {
    return (
      <p className="chart-state" role="status">
        Loading{'…'}
      </p>
    );
  }

  const stats: Array<[string, string]> = [
    ['Records', fmt(data.total_records)],
    ['Distinct authors', fmt(data.distinct_authors)],
    ['Distinct venues', fmt(data.distinct_venues)],
    ['Year range', `${data.year_min}–${data.year_max}`],
  ];

  return (
    <>
      <p className="lede">
        Every article and conference paper in the DBLP dump from {data.year_min} through {data.year_max} ({fmt(data.total_records)}{' '}
        records). {fmt(data.excluded_records)} records dated after {data.year_max} are left out because DBLP is still indexing those
        years and they understate real output.
      </p>
      <div className="stat-strip">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value">{value}</div>
          </div>
        ))}
      </div>
    </>
  );
}
