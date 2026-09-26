import { CHART_DATA } from './schemas';
import type { ChartData, ChartDataKey } from './schemas';

export type ChartDataErrorKind = 'missing' | 'invalid';

export class ChartDataError extends Error {
  readonly kind: ChartDataErrorKind;
  readonly file: string;

  constructor(kind: ChartDataErrorKind, file: string, detail: string) {
    super(`${file}: ${detail}`);
    this.name = 'ChartDataError';
    this.kind = kind;
    this.file = file;
  }
}

/** Fetch one chart data file and check it against its schema. */
export async function fetchChartData<K extends ChartDataKey>(key: K, signal?: AbortSignal): Promise<ChartData<K>> {
  const { file, schema } = CHART_DATA[key];
  let response: Response;
  try {
    response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { signal });
  } catch (error) {
    if (signal?.aborted) throw error; // cancelled, not failed
    throw new ChartDataError('missing', file, 'could not be fetched');
  }
  if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) {
    throw new ChartDataError('missing', file, `HTTP ${response.status}`);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    throw new ChartDataError('invalid', file, `${issue?.message ?? 'unexpected shape'}${where}`);
  }
  return parsed.data as ChartData<K>;
}

/** User-facing wording for a failed chart data request. */
export function describeChartDataError(error: unknown): string {
  if (error instanceof ChartDataError) {
    return error.kind === 'missing'
      ? `Chart data (${error.file}) wasn't found. Generate it with python backend/build_chart_data.py.`
      : `Chart data (${error.file}) isn't in the expected shape (${error.message}). Regenerate it with python backend/build_chart_data.py, or update src/data/schemas.ts if the format changed on purpose.`;
  }
  return 'Something went wrong loading the chart data.';
}
