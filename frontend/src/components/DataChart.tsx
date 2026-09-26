import type { EChartsCoreOption } from 'echarts/core';
import { useMemo } from 'react';

import { describeChartDataError } from '../data/client';
import { useChartData } from '../data/hooks';
import type { ChartData, ChartDataKey } from '../data/schemas';
import { EChart } from './EChart';

interface Props<K extends ChartDataKey> {
  dataKey: K;
  title: string;
  note: string;
  /** Turns the validated data into an ECharts option. Define it at module level so its identity is stable. */
  build: (data: ChartData<K>) => EChartsCoreOption;
  height: number;
  wide?: boolean;
}

/** One dashboard card: heading, note, and the chart, with its own loading and error states. */
export function DataChart<K extends ChartDataKey>({ dataKey, title, note, build, height, wide = false }: Props<K>) {
  const query = useChartData(dataKey);
  const option = useMemo(() => (query.data ? build(query.data) : null), [query.data, build]);

  return (
    <section className={wide ? 'card wide' : 'card'}>
      <h2>{title}</h2>
      <p className="note">{note}</p>
      {option ? (
        <EChart option={option} height={height} ariaLabel={title} />
      ) : query.error ? (
        <p className="chart-state is-error" role="alert" style={{ minHeight: height }}>
          {describeChartDataError(query.error)}
        </p>
      ) : (
        <p className="chart-state" role="status" style={{ minHeight: height }}>
          Loading{'…'}
        </p>
      )}
    </section>
  );
}
