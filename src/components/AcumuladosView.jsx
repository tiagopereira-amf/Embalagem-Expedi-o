import { useMemo, useState } from 'react';
import { formatDateLong, formatMonth, formatPairs } from '../lib/dates.js';
import { buildAcumulados, stackedFrom } from '../lib/metrics.js';
import { StackedBar, seriesColor } from './Charts.jsx';

const DIMS = [
  { id: 'brand', label: 'Marca', names: 'brands' },
  { id: 'tipo', label: 'Tipo', names: 'tipos' },
  { id: 'tipoProd', label: 'Tipo prod', names: 'tipoProds' },
];

function paint(series) {
  return series.map((item, index) => ({ ...item, color: seriesColor(index, item.name) }));
}

export function AcumuladosView({ rows, hasPicagens, today }) {
  const [yearText, setYearText] = useState(() => today.slice(0, 4));
  const [dim, setDim] = useState('brand');
  const parsedYear = Number(yearText);
  const year = parsedYear >= 2000 && parsedYear <= 2100 ? parsedYear : Number(today.slice(0, 4));
  const model = useMemo(() => buildAcumulados(hasPicagens ? rows : [], year, today), [rows, hasPicagens, year, today]);
  const dimension = DIMS.find((item) => item.id === dim);
  const names = model[dimension.names] || [];
  const weekSeries = paint(stackedFrom(model.weeks, names, dim));
  const monthSeries = paint(stackedFrom(model.months, names, dim));
  const weekLabels = model.weeks.map((bucket) => bucket.key.slice(5));
  const monthLabels = model.months.map((bucket) => formatMonth(bucket.key));

  return (
    <section className="view">
      <div className="weekbar">
        <p>
          <strong>Expedição acumulada</strong>
          <span>
            {model.end
              ? `${formatDateLong(model.start)} – ${formatDateLong(model.end)}`
              : `1 de janeiro de ${year} ainda não chegou.`}
          </span>
        </p>
        <label className="limiar">
          Ano
          <input
            type="number"
            min="2000"
            max="2100"
            value={yearText}
            data-testid="ano"
            onChange={(event) => setYearText(event.target.value)}
          />
        </label>
      </div>
      <p className="size-note">
        Só entram picagens de expedição (EMB.Expedicao), com data1 entre 1 de janeiro do ano escolhido e hoje em Lisboa,
        ou 31 de dezembro se o ano já tiver fechado. Embalagem não entra nesta vista.
      </p>
      {!hasPicagens ? (
        <p className="empty-inline" data-testid="acumulados-vazio">
          Sem picagens. Os gráficos de expedição ficam vazios; não se inventam totais a partir do plano.
        </p>
      ) : model.empty ? (
        <p className="empty-inline">Os ficheiros não têm expedição neste intervalo.</p>
      ) : (
        <p className="size-note">
          Total no intervalo: <strong>{formatPairs(model.total)}</strong> pares.
        </p>
      )}

      {hasPicagens && !model.empty ? (
        <>
          <div className="segmented" role="tablist" aria-label="Dimensão dos acumulados">
            {DIMS.map((item) => (
              <button key={item.id} type="button" aria-selected={dim === item.id} onClick={() => setDim(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="chart-grid two">
            <div className="panel">
              <h3>Por semana · {dimension.label}</h3>
              <StackedBar
                ariaLabel={`Expedição semanal por ${dimension.label}`}
                categories={weekLabels}
                series={weekSeries}
                labelEvery={weekLabels.length > 20 ? 4 : 1}
              />
            </div>
            <div className="panel">
              <h3>Por mês · {dimension.label}</h3>
              <StackedBar ariaLabel={`Expedição mensal por ${dimension.label}`} categories={monthLabels} series={monthSeries} />
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Período</th>
                  {names.map((name) => (
                    <th key={name}>{name}</th>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {model.months.map((bucket) => (
                  <tr key={bucket.key}>
                    <td>{formatMonth(bucket.key)}</td>
                    {names.map((name) => (
                      <td key={name} className="num">
                        {formatPairs(bucket[dim].get(name) || 0)}
                      </td>
                    ))}
                    <td className="num">{formatPairs(bucket.total)}</td>
                  </tr>
                ))}
                {model.weeks.filter((bucket) => bucket.total).map((bucket) => (
                  <tr key={bucket.key}>
                    <td>{bucket.key}</td>
                    {names.map((name) => (
                      <td key={name} className="num">
                        {formatPairs(bucket[dim].get(name) || 0)}
                      </td>
                    ))}
                    <td className="num">{formatPairs(bucket.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
