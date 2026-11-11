import { formatPairs, formatPct } from '../lib/dates.js';

export function Metric({ id, label, value, hint, tone = 'ink', kind = 'pairs' }) {
  const empty = value == null || Number.isNaN(Number(value));
  const text = empty ? '—' : kind === 'pct' ? formatPct(value) : formatPairs(value);
  return (
    <article className={`metric tone-${tone}`} data-metric={id} data-value={empty ? '' : String(value)}>
      <span>{label}</span>
      <strong>{text}</strong>
      {hint ? <em>{hint}</em> : null}
    </article>
  );
}
