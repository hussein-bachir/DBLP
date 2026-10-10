import type { AskDiagnostics } from '../api/types';
import { detailRows, summaryLine } from '../lib/diagnostics';

/** "How this answer was produced": a summary line, and the full rows behind a native <details>. */
export function AnswerDetails({ diagnostics, model, provider }: { diagnostics: AskDiagnostics; model: string; provider: string | null }) {
  const rows = [{ label: 'Model', lines: [provider ? `${model} (${provider})` : model] }, ...detailRows(diagnostics)];
  return (
    <details className="ask-details">
      <summary>
        <span className="ask-details-line">{summaryLine(diagnostics)}</span>
        <span className="ask-details-toggle">Details</span>
      </summary>
      <dl>
        {rows.map((row) => (
          <div key={row.label} className="ask-details-row">
            <dt>{row.label}</dt>
            {row.lines.map((line, i) => (
              // two lookups can read the same, so index keys
              <dd key={i}>{line}</dd>
            ))}
          </div>
        ))}
      </dl>
    </details>
  );
}
