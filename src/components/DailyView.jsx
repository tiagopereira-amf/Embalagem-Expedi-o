import { formatDateShort, weekdayShort } from '../lib/dates.js';
import { GroupedBar, dayLabels } from './Charts.jsx';

function show(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(value);
}

export function DailyView({ model, threshold, today }) {
  const labels = dayLabels(model.range.days);
  return (
    <section className="view">
      <p className="size-note">
        No prazo: a data da picagem (data1) é anterior ou igual ao ShipDate da OP. O tamanho usa a mesma regra da semana
        (Quant, ou a maior soma de qtdPares se a OP não estiver no plano). Limiar atual: {threshold} pares.
      </p>
      {!model.hasPicagens ? (
        <p className="empty-inline">Sem picagens nesta semana. A grelha mostra os dias, mas os pares ficam por preencher.</p>
      ) : null}
      <div className="panel">
        <h3>Pares no prazo por dia</h3>
        {model.hasPicagens ? (
          <GroupedBar
            ariaLabel="Pares embalados e expedidos no prazo em cada dia da semana"
            categories={labels}
            series={[
              { name: 'Embalados no prazo', color: '#0f5c56', values: model.daily.map((day) => day.embOn || 0) },
              { name: 'Expedidos no prazo', color: '#1e4d7b', values: model.daily.map((day) => day.expOn || 0) },
            ]}
          />
        ) : (
          <p className="chart-empty">O gráfico de pares no prazo fica vazio até haver picagens. Um eixo a zero seria um realizado inventado.</p>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Dia</th>
              <th>Emb. no prazo</th>
              <th>Emb. fora</th>
              <th>Emb. sem plano</th>
              <th>Exp. no prazo</th>
              <th>Exp. fora</th>
              <th>Exp. sem plano</th>
              <th>Emb. peq.</th>
              <th>Emb. grandes</th>
              <th>Exp. peq.</th>
              <th>Exp. grandes</th>
              <th>OPs &lt; {threshold}</th>
              <th>OPs ≥ {threshold}</th>
            </tr>
          </thead>
          <tbody>
            {model.daily.map((day) => (
              <tr key={day.date} className={day.date === today ? 'is-today' : undefined} data-day={day.date}>
                <td>
                  {weekdayShort(day.date)} {formatDateShort(day.date)}
                </td>
                <td className="num" data-field="embOn">{show(day.embOn)}</td>
                <td className="num">{show(day.embLate)}</td>
                <td className="num">{show(day.embNone)}</td>
                <td className="num" data-field="expOn">{show(day.expOn)}</td>
                <td className="num">{show(day.expLate)}</td>
                <td className="num">{show(day.expNone)}</td>
                <td className="num">{show(day.embSmall)}</td>
                <td className="num">{show(day.embLarge)}</td>
                <td className="num">{show(day.expSmall)}</td>
                <td className="num">{show(day.expLarge)}</td>
                <td className="num" data-field="smallOps">{show(day.smallOps)}</td>
                <td className="num" data-field="largeOps">{show(day.largeOps)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
