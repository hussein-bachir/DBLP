import { useQuery } from '@tanstack/react-query';

import { fetchChartData } from './client';
import type { ChartData, ChartDataKey } from './schemas';

/** One chart data file, fetched once and validated. The data is a fixed build product, so it never goes stale. */
export function useChartData<K extends ChartDataKey>(key: K) {
  return useQuery<ChartData<K>>({
    queryKey: ['chart-data', key],
    queryFn: ({ signal }) => fetchChartData(key, signal),
    staleTime: Infinity,
    retry: false, // a missing or malformed file won't fix itself
  });
}
