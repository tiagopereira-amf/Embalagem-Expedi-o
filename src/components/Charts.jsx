import { formatPairs, weekdayShort } from '../lib/dates.js';

const PALETTE = ['#0f5c56', '#1e4d7b', '#8a4b08', '#6b3fa0', '#8e2942', '#3f6212', '#0e7490', '#9a3412', '#3f3f46'];

export function seriesColor(index, name) {
  if (name === 'Outras') return '#8d887c';
  return PALETTE[index % PALETTE.length];
}

function maxOf(values) {
  let max = 0;
  for (let i = 0; i < values.length; i += 1) {
    const n = Number(values[i]) || 0;
    if (n > max) max = n;
  }
  return max;
}

function niceMax(value) {
  if (value <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(value));
  const n = value / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}

function ChartFrame({ ariaLabel, children, legend }) {
  return (
    <figure className="chart" role="img" aria-label={ariaLabel}>
      {children}
      {legend?.length ? (
        <figcaption className="legend">
          {legend.map((item) => (
            <span key={item.name}>
              <i style={{ background: item.color }} />
              {item.name}
            </span>
          ))}
        </figcaption>
      ) : null}
    </figure>
  );
}

export function LineChart({ labels, series, ariaLabel }) {
  const drawn = series.filter((item) => item.values.some((value) => value != null));
  if (!drawn.length) {
    return <p className="chart-empty">Sem série para desenhar.</p>;
  }
  const width = 680;
  const height = 220;
  const pad = { l: 52, r: 12, t: 14, b: 32 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(maxOf(drawn.flatMap((item) => item.values)));
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const step = labels.length > 1 ? innerW / (labels.length - 1) : 0;
  const xAt = (index) => pad.l + index * step;
  const yAt = (value) => pad.t + innerH - (value / max) * innerH;

  return (
    <ChartFrame ariaLabel={ariaLabel} legend={drawn.map((item) => ({ name: item.name, color: item.color }))}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        {ticks.map((tick) => {
          const value = max * tick;
          const y = yAt(value);
          return (
            <g key={tick}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} className="grid" />
              <text x={pad.l - 8} y={y + 3} textAnchor="end" className="tick">
                {formatPairs(value)}
              </text>
            </g>
          );
        })}
        {drawn.map((item) => {
          const points = item.values
            .map((value, index) => (value == null ? null : `${xAt(index)},${yAt(value)}`))
            .filter(Boolean)
            .join(' ');
          return <polyline key={item.name} points={points} fill="none" stroke={item.color} strokeWidth="2.25" />;
        })}
        {labels.map((label, index) => (
          <text key={label} x={xAt(index)} y={height - 10} textAnchor="middle" className="tick">
            {label}
          </text>
        ))}
      </svg>
    </ChartFrame>
  );
}

export function GroupedBar({ categories, series, ariaLabel }) {
  const drawn = series.filter((item) => item.values.length);
  if (!categories.length || !drawn.length) {
    return <p className="chart-empty">Sem valores nesta semana.</p>;
  }
  const width = Math.max(520, categories.length * drawn.length * 22 + 80);
  const height = 220;
  const pad = { l: 52, r: 12, t: 14, b: 48 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const max = niceMax(maxOf(drawn.flatMap((item) => item.values)));
  const groupW = innerW / categories.length;
  const barW = Math.min(18, (groupW * 0.8) / drawn.length);
  return (
    <ChartFrame ariaLabel={ariaLabel} legend={drawn.map((item) => ({ name: item.name, color: item.color }))}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        {[0, 0.5, 1].map((tick) => {
          const y = pad.t + innerH - tick * innerH;
          return (
            <g key={tick}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} className="grid" />
              <text x={pad.l - 8} y={y + 3} textAnchor="end" className="tick">
                {formatPairs(max * tick)}
              </text>
            </g>
          );
        })}
        {categories.map((category, index) => {
          const groupX = pad.l + index * groupW;
          return (
            <g key={category}>
              {drawn.map((item, seriesIndex) => {
                const value = item.values[index] || 0;
                const h = (value / max) * innerH;
                const x = groupX + (groupW - drawn.length * barW) / 2 + seriesIndex * barW;
                const y = pad.t + innerH - h;
                return (
                  <rect key={item.name} x={x} y={y} width={Math.max(barW - 2, 2)} height={h} fill={item.color}>
                    <title>{`${item.name} · ${category}: ${formatPairs(value)}`}</title>
                  </rect>
                );
              })}
              <text x={groupX + groupW / 2} y={height - 18} textAnchor="middle" className="tick">
                {category}
              </text>
            </g>
          );
        })}
      </svg>
    </ChartFrame>
  );
}

export function StackedBar({ categories, series, ariaLabel, labelEvery = 1 }) {
  const active = series.filter((item) => item.values.some((value) => value));
  if (!categories.length || !active.length) {
    return <p className="chart-empty">Sem expedição neste intervalo.</p>;
  }
  const width = Math.max(640, categories.length * 26 + 70);
  const height = 240;
  const pad = { l: 52, r: 8, t: 12, b: 42 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const totals = categories.map((_, index) => active.reduce((sum, item) => sum + (item.values[index] || 0), 0));
  const max = niceMax(Math.max(maxOf(totals), 1));
  const slot = innerW / categories.length;
  const barW = Math.max(4, Math.min(18, slot * 0.72));
  return (
    <ChartFrame ariaLabel={ariaLabel} legend={active.map((item) => ({ name: item.name, color: item.color }))}>
      <div className="chart-scroll">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="chart-svg wide">
          {[0, 0.5, 1].map((tick) => {
            const y = pad.t + innerH - tick * innerH;
            return (
              <g key={tick}>
                <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} className="grid" />
                <text x={pad.l - 8} y={y + 3} textAnchor="end" className="tick">
                  {formatPairs(max * tick)}
                </text>
              </g>
            );
          })}
          {categories.map((category, index) => {
            let y = pad.t + innerH;
            const x = pad.l + index * slot + (slot - barW) / 2;
            return (
              <g key={category}>
                {active.map((item) => {
                  const value = item.values[index] || 0;
                  const h = (value / max) * innerH;
                  y -= h;
                  return (
                    <rect key={item.name} x={x} y={y} width={barW} height={h} fill={item.color}>
                      <title>{`${item.name} · ${category}: ${formatPairs(value)}`}</title>
                    </rect>
                  );
                })}
                {index % labelEvery === 0 ? (
                  <text x={pad.l + index * slot + slot / 2} y={height - 14} textAnchor="middle" className="tick">
                    {category}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </ChartFrame>
  );
}

export function dayLabels(days) {
  return days.map((iso) => weekdayShort(iso).replace('.', ''));
}
