import { useMemo, useState } from 'react';
import { formatDateShort, formatPairs, formatPct, weekdayShort } from '../lib/dates.js';
import { GroupedBar, LineChart, dayLabels } from './Charts.jsx';
import { Metric } from './Metric.jsx';
import { compliance, embalagemPercent, expedicaoObjetivo, faltaEmbalarOf, faltaExpedirOf, jaEmbaladoOf, marcaTable, num } from '../lib/metrics.js';

function fold(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const DETAIL_COLUMNS = [
  { key: 'op', label: 'OP', filter: 'text' },
  { key: 'cliente', label: 'Cliente', filter: 'text' },
  { key: 'ref', label: 'Ref.', filter: 'text' },
  { key: 'marca', label: 'Marca', filter: 'select' },
  { key: 'codFab', label: 'Cód. fab.', filter: 'select' },
  { key: 'linhaProd', label: 'Linha', filter: 'select' },
  { key: 'shipDate', label: 'Ship date', filter: 'select' },
  { key: 'quant', label: 'Quant.', filter: 'text' },
  { key: 'obs', label: 'Obs', filter: 'text' },
  { key: 'gr', label: 'GR', filter: 'text', title: 'Pares já expedidos antes' },
  { key: 'e', label: 'E', filter: 'text', title: 'Pares embalados agora' },
  { key: 'embalado', label: 'Já embalado', filter: 'text', title: 'Já embalado = E − GR' },
  { key: 'porEmbalar', label: 'Por embalar', filter: 'text' },
  { key: 'expedido', label: 'Expedido', filter: 'text' },
  { key: 'faltaExpedir', label: 'Falta expedir', filter: 'text', title: 'max(0, objetivo de expedição − picagens EMB.Expedicao). Não entra o GR nem a coluna E' },
  { key: 'faltaEmbalar', label: 'Falta embalar', filter: 'text', title: 'Objetivo menos as picagens EMB.Embalagem desta semana menos o já embalado, nunca abaixo de 0' },
  { key: 'picEmb', label: 'Pic. emb.', filter: 'text' },
  { key: 'picExp', label: 'Pic. exp.', filter: 'text' },
];

function fieldText(row, key, picEmb, picExp) {
  if (key === 'picEmb') return picEmb == null ? '' : String(picEmb);
  if (key === 'picExp') return picExp == null ? '' : String(picExp);
  if (key === 'embalado') return String(jaEmbaladoOf(row));
  if (key === 'faltaEmbalar') return String(faltaEmbalarOf(row, picEmb));
  if (key === 'faltaExpedir') return String(faltaExpedirOf(expedicaoObjetivo(row), picExp));
  const value = row[key];
  if (value == null || value === '') return '';
  return String(value);
}

const TOTAL_FIELDS = [
  ['quant', 'Quant.'],
  ['obs', 'Obs'],
  ['gr', 'GR'],
  ['e', 'E'],
  ['embalado', 'Já embalado'],
  ['porEmbalar', 'Por embalar'],
  ['expedido', 'Expedido'],
  ['faltaExpedir', 'Falta expedir'],
  ['faltaEmbalar', 'Falta embalar'],
  ['picEmb', 'Pic. emb.'],
  ['picExp', 'Pic. exp.'],
];

function paceOf(realizado, objetivo) {
  if (realizado == null) return '';
  const done = num(realizado);
  const goal = num(objetivo);
  if (done <= 0) return 'none';
  if (goal <= 0 || done >= goal) return 'done';
  return 'part';
}

function cell(value, field) {
  const empty = value == null || value === '';
  return (
    <td data-field={field} data-value={empty ? '' : String(value)} className={typeof value === 'number' && value < 0 ? 'num neg' : 'num'}>
      {empty ? '—' : typeof value === 'number' ? new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(value) : value}
    </td>
  );
}

function PairQuantity({ value, objetivo, field, jaEmbalado }) {
  const empty = value == null || value === '';
  const goal = num(objetivo);
  const embalagem = field === 'picEmb';
  const pct = embalagem
    ? embalagemPercent(jaEmbalado, empty ? 0 : value, goal)
    : (empty ? null : compliance(num(value), goal));
  const pace = embalagem
    ? (pct <= 0 ? 'none' : pct >= 100 ? 'done' : 'part')
    : paceOf(empty ? null : value, objetivo);
  const pctText = pct == null ? '—' : formatPct(pct).replace(' %', '%');
  const title = embalagem
    ? '(já embalado + picagens EMB.Embalagem) ÷ objetivo. Se o objetivo é 0, a percentagem é 0'
    : (goal <= 0 ? 'Objetivo 0: a percentagem não se calcula' : 'realizado ÷ objetivo desta OP, no máximo 100%');
  return (
    <td data-field={field} data-value={empty ? '' : String(value)} data-pace={pace} className="num pair-cell">
      <span className={`pair-pct pace-${pace || 'empty'}`} title={title} data-pct={pct == null ? '' : String(pct)}>
        {pctText}
      </span>
      <span>{empty ? '—' : formatPairs(value)}</span>
    </td>
  );
}

function Figure({ id, label, value, hint, tone }) {
  const empty = value == null || value === '' || Number.isNaN(Number(value));
  return (
    <article className={`figure tone-${tone}`} data-metric={id} data-value={empty ? '' : String(value)}>
      <span>{label}</span>
      <strong>{empty ? '—' : formatPairs(value)}</strong>
      <em>{hint}</em>
    </article>
  );
}

function PctCard({ title, tone, pctId, pct, objetivo, realizado, realizadoLabel = 'realizado' }) {
  const emptyPct = pct == null || Number.isNaN(Number(pct));
  const emptyReal = realizado == null || Number.isNaN(Number(realizado));
  return (
    <article className={`pct-card tone-${tone}`}>
      <div>
        <span>{title}</span>
        <p>
          Objetivo {formatPairs(objetivo)}
          {' · '}
          {realizadoLabel} {emptyReal ? '—' : formatPairs(realizado)}
        </p>
      </div>
      <strong data-metric={pctId} data-value={emptyPct ? '' : String(pct)}>
        {emptyPct ? '—' : formatPct(pct).replace(' %', '%')}
      </strong>
    </article>
  );
}

function ExtraTable({ lines, pairsKey, totalId, total }) {
  const [open, setOpen] = useState(false);
  const rows = lines || [];
  const emptyTotal = total == null || Number.isNaN(Number(total));
  return (
    <div className={`extra-block ${open ? 'is-open' : 'is-closed'}`}>
      <div className="extra-head">
        <h3>Extra-plano</h3>
        <strong data-metric={totalId} data-value={emptyTotal ? '' : String(total)}>
          {emptyTotal ? '—' : `${formatPairs(total)} pares`}
        </strong>
        <button
          type="button"
          className="ghost extra-toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
      {open ? (
        lines == null ? (
          <p className="chart-empty">Aparece quando houver picagens: OPs fora do plano desta semana, ou quantidade acima do objetivo.</p>
        ) : rows.length === 0 ? (
          <p className="chart-empty">Nenhum par extra-plano nesta semana.</p>
        ) : (
          <>
            <div className="table-wrap short">
              <table>
                <thead>
                  <tr>
                    <th>OP</th>
                    <th>Cliente</th>
                    <th>Referência</th>
                    <th>Situação</th>
                    <th>Pares</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 12).map((line) => (
                    <tr key={line.op} data-extra={line.op}>
                      <td className="op">{line.op}</td>
                      <td className="clip" data-field="cliente" data-value={line.cliente || ''}>{line.cliente || '—'}</td>
                      <td className="op" data-field="ref" data-value={line.ref || ''}>{line.ref || '—'}</td>
                      <td>{line.fora ? 'Fora do plano' : 'Acima do objetivo'}</td>
                      {cell(line[pairsKey], pairsKey)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > 12 ? <p className="muted">A mostrar 12 de {rows.length} OPs.</p> : null}
          </>
        )
      ) : null}
    </div>
  );
}

function pctText(value) {
  return value == null ? '—' : formatPct(value).replace(' %', '%');
}

function MarcaRows({ lines }) {
  return lines.map((line) => (
    <tr key={line.marca} data-marca={line.marca} className={line.marca === 'Total' ? 'marca-total' : undefined}>
      <td>{line.marca}</td>
      <td className="num" data-field="objetivo-emb" data-value={line.objetivo == null ? '' : String(line.objetivo)}>{formatPairs(line.objetivo)}</td>
      <td className="num" data-field="pct-emb" data-value={line.embPct == null ? '' : String(line.embPct)}>{pctText(line.embPct)}</td>
      <td className="num" data-field="plano-emb" data-value={line.embIn == null ? '' : String(line.embIn)}>{line.embIn == null ? '—' : formatPairs(line.embIn)}</td>
      <td className="num" data-field="extra-emb" data-value={String(line.embExtra)}>{formatPairs(line.embExtra)}</td>
      <td className="num" data-field="objetivo-exp" data-value={line.objetivo == null ? '' : String(line.objetivo)}>{formatPairs(line.objetivo)}</td>
      <td className="num" data-field="falta-exp" data-value={line.faltaExpedir == null ? '' : String(line.faltaExpedir)}>{line.faltaExpedir == null ? '—' : formatPairs(line.faltaExpedir)}</td>
      <td className="num" data-field="pct-exp" data-value={line.expPct == null ? '' : String(line.expPct)}>{pctText(line.expPct)}</td>
      <td className="num" data-field="plano-exp" data-value={line.expIn == null ? '' : String(line.expIn)}>{line.expIn == null ? '—' : formatPairs(line.expIn)}</td>
      <td className="num" data-field="extra-exp" data-value={String(line.expExtra)}>{formatPairs(line.expExtra)}</td>
    </tr>
  ));
}

function MarcaBlock({ group }) {
  const rows = group.lines.length ? [...group.lines, group.total] : [];
  return (
    <section className="marca-panel" data-tipo={group.id}>
      <h3>{group.title}</h3>
      {rows.length === 0 ? (
        <p className="marca-empty">sem registos</p>
      ) : (
        <div className="table-wrap marca-wrap">
          <table className="marca-table">
            <thead>
              <tr>
                <th rowSpan={2}>Marca</th>
                <th className="group-emb" colSpan={4}>Embalagem</th>
                <th className="group-exp" colSpan={5}>Expedição</th>
              </tr>
              <tr>
                <th className="num group-emb">Objetivo</th>
                <th className="num group-emb">Percentagem</th>
                <th className="num group-emb">Pares no plano</th>
                <th className="num group-emb">Pares extra plano</th>
                <th className="num group-exp">Objetivo</th>
                <th className="num group-exp">Falta expedir</th>
                <th className="num group-exp">Percentagem</th>
                <th className="num group-exp">Pares no plano</th>
                <th className="num group-exp">Pares extra plano</th>
              </tr>
            </thead>
            <tbody>
              <MarcaRows lines={rows} />
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MarcaTable({ table }) {
  return (
    <div className="marca-stack" data-testid="tabela-marcas">
      <MarcaBlock group={table.calcado} />
      <MarcaBlock group={table.roupa} />
      <MarcaBlock group={table.outros} />
    </div>
  );
}

function SectionBlock({ title, tone, card, figures, extra }) {
  return (
    <section className={`block tone-${tone}`} data-section={tone}>
      <PctCard title={title} tone={tone} {...card} />
      <div className="figure-row">
        {figures.map((figure) => <Figure key={figure.id} tone={tone} {...figure} />)}
      </div>
      <ExtraTable {...extra} />
    </section>
  );
}

export function WeekView({ model, threshold, query, setQuery, today }) {
  const { planTotals: totals, emb, exp, inWeek } = model;
  const labels = dayLabels(model.range.days);
  const brands = model.breakdown.brands;
  const tipos = model.breakdown.tipos;
  const [colFilters, setColFilters] = useState({});
  const needle = fold(query.trim());
  const rows = [...inWeek].sort((a, b) => a.shipDate.localeCompare(b.shipDate) || Number(a.op) - Number(b.op));
  const searched = needle
    ? rows.filter((row) => fold([row.op, row.cliente, row.ref, row.marca, row.codFab].join(' ')).includes(needle))
    : rows;
  const selectOptions = useMemo(() => {
    const options = {};
    for (const column of DETAIL_COLUMNS) {
      if (column.filter !== 'select') continue;
      const values = new Set();
      let blank = false;
      for (const row of rows) {
        const text = fieldText(row, column.key, null, null);
        if (!text) blank = true;
        else values.add(text);
      }
      options[column.key] = {
        values: [...values].sort((a, b) => a.localeCompare(b, 'pt')),
        blank,
      };
    }
    return options;
  }, [rows]);
  const shown = searched.filter((row) => {
    const picEmb = model.hasPicagens ? emb.byOp.get(row.op) || 0 : null;
    const picExp = model.hasPicagens ? exp.byOp.get(row.op) || 0 : null;
    return DETAIL_COLUMNS.every((column) => {
      const filter = String(colFilters[column.key] || '').trim();
      if (!filter) return true;
      const text = fieldText(row, column.key, picEmb, picExp);
      if (column.filter === 'select') {
        if (filter === '__vazio__') return text === '';
        return text === filter;
      }
      return fold(text).includes(fold(filter));
    });
  });
  const columnTotals = {};
  for (const [key] of TOTAL_FIELDS) {
    if ((key === 'picEmb' || key === 'picExp') && !model.hasPicagens) {
      columnTotals[key] = null;
      continue;
    }
    let sum = 0;
    for (const row of shown) {
      if (key === 'picEmb') sum += emb.byOp.get(row.op) || 0;
      else if (key === 'picExp') sum += exp.byOp.get(row.op) || 0;
      else if (key === 'embalado') sum += jaEmbaladoOf(row);
      else if (key === 'faltaEmbalar') {
        const packed = model.hasPicagens ? emb.byOp.get(row.op) || 0 : 0;
        sum += faltaEmbalarOf(row, packed);
      }
      else if (key === 'faltaExpedir') {
        const shipped = model.hasPicagens ? exp.byOp.get(row.op) || 0 : 0;
        sum += faltaExpedirOf(expedicaoObjetivo(row), shipped);
      }
      else sum += num(row[key]);
    }
    columnTotals[key] = sum;
  }
  const embExtra = model.extra ? model.extra.filter((line) => line.embExtra > 0) : null;
  const embExtraTotal = embExtra ? embExtra.reduce((sum, line) => sum + line.embExtra, 0) : null;
  const expExtra = model.extra ? model.extra.filter((line) => line.expExtra > 0) : null;
  const marcas = useMemo(
    () => marcaTable(inWeek, model.picWeek, model.hasPicagens),
    [inWeek, model.picWeek, model.hasPicagens],
  );

  return (
    <section className="view">
      {!model.hasPicagens ? (
        <p className="empty-inline" data-testid="sem-picagens">
          Sem picagens. O expedido desta semana e o extra-plano ficam vazios. O plano e o já embalado continuam visíveis.
        </p>
      ) : null}

      <div className="week-split">
      <div className="section-stack">
      <SectionBlock
        title="Embalagem"
        tone="emb"
        card={{
          pctId: 'pct-emb',
          pct: emb.pct,
          objetivo: emb.objetivo,
          realizado: emb.realizado,
          realizadoLabel: 'esta semana (plano)',
        }}
        figures={[
          { id: 'objetivo', label: 'Objetivo de embalamento', value: emb.objetivo, hint: 'Obs, ou Quant − GR' },
          { id: 'falta-embalar', label: 'Falta embalar', value: totals.faltaEmbalar, hint: 'objetivo − picagens EMB.Embalagem − já embalado' },
          { id: 'ja-embalado', label: 'Já embalado', value: totals.embalado, hint: 'Já embalado = E − GR' },
          { id: 'realizado-emb', label: 'Embalado esta semana (plano)', value: emb.realizado, hint: 'picagens EMB.Embalagem das OP do plano' },
        ]}
        extra={{ lines: embExtra, pairsKey: 'embExtra', totalId: 'extra-emb', total: embExtraTotal }}
      />

      <SectionBlock
        title="Expedição"
        tone="exp"
        card={{
          pctId: 'pct-exp',
          pct: exp.pct,
          objetivo: exp.objetivo,
          realizado: exp.realizado,
        }}
        figures={[
          { id: 'objetivo-exp', label: 'Objetivo de expedição', value: exp.objetivo, hint: 'Soma por OP: Obs, ou Quant − GR se Obs está vazio' },
          { id: 'falta-expedir', label: 'Falta expedir', value: totals.faltaExpedir, hint: 'max(0, objetivo − picagens EMB.Expedicao)' },
          { id: 'ja-expedido', label: 'Já expedido', value: totals.expedido, hint: 'coluna Expedido do plano' },
          { id: 'realizado-exp', label: 'Expedido esta semana', value: exp.realizado, hint: 'picagens da semana' },
        ]}
        extra={{ lines: expExtra, pairsKey: 'expExtra', totalId: 'extra-exp', total: exp.extra }}
      />
      </div>
      <MarcaTable table={marcas} />
      </div>

      <p className="formula">
        Cumprimento de expedição = min(100, realizado ÷ objetivo × 100). O realizado soma as picagens da semana das OPs do plano e pode
        passar o objetivo; o que passa, e as OPs de fora, contam no extra-plano. Expedição, por OP: o objetivo é o Obs quando tem número e, se está vazio, Quant − GR; a falta expedir é max(0, esse objetivo − picagens EMB.Expedicao) e a soma é por OP. Nessa conta não entra o GR nem a coluna E. Embalagem, por OP: o objetivo é o Obs quando tem número e, se está vazio, Quant menos GR; o já embalado é max(0, E − GR); o embalado esta semana (plano) são as picagens EMB.Embalagem das OP do plano; a falta embalar é max(0, objetivo − essas picagens − já embalado). A percentagem é (já embalado + embalado esta semana) ÷ objetivo e é 0 quando o objetivo é 0. O extra-plano de embalagem soma as picagens EMB.Embalagem desta semana acima do objetivo, ou a OP inteira quando está fora do plano.
      </p>

      <div className="chart-grid">
        <div className="panel">
          <h3>Pares acumulados na semana</h3>
          <LineChart
            ariaLabel="Pares acumulados de objetivo, embalagem e expedição ao longo da semana"
            labels={labels}
            series={[
              { name: 'Objetivo', color: '#e06a00', values: model.cumulative.map((day) => day.objetivo) },
              ...(model.hasPicagens
                ? [
                    { name: 'Embalado', color: '#159447', values: model.cumulative.map((day) => day.embalado) },
                    { name: 'Expedido', color: '#1e4d7b', values: model.cumulative.map((day) => day.expedido) },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="panel">
          <h3>Por marca</h3>
          <GroupedBar
            ariaLabel="Pares da semana por marca: objetivo, embalado e expedido"
            categories={brands.map(([name]) => name)}
            series={[
              { name: 'Objetivo', color: '#e06a00', values: brands.map(([, value]) => value.objetivo) },
              ...(model.hasPicagens
                ? [
                    { name: 'Embalado', color: '#159447', values: brands.map(([, value]) => value.emb) },
                    { name: 'Expedido', color: '#1e4d7b', values: brands.map(([, value]) => value.exp) },
                  ]
                : []),
            ]}
          />
        </div>
        <div className="panel">
          <h3>Por tipo</h3>
          {tipos.length ? (
            <GroupedBar
              ariaLabel="Pares picados na semana por tipo"
              categories={tipos.map(([name]) => name)}
              series={[
                { name: 'Embalado', color: '#159447', values: tipos.map(([, value]) => value.emb) },
                { name: 'Expedido', color: '#1e4d7b', values: tipos.map(([, value]) => value.exp) },
              ]}
            />
          ) : (
            <p className="chart-empty">O tipo vem das picagens. Ainda não há ficheiro, por isso esta série fica vazia.</p>
          )}
        </div>
      </div>

      <h2>Tamanho de encomenda</h2>
      <p className="size-note">
        O tamanho da encomenda é o Quant do plano. Se a OP não estiver no plano, usa-se a maior soma de qtdPares
        entre embalagem e expedição, para não contar o mesmo par duas vezes. Pequena: inferior a {threshold}. Grande:{' '}
        {threshold} ou mais.
      </p>
      <div className="metrics compact">
        <Metric id="ops-pequenas" label="OPs pequenas" value={model.planSize.smallOps} hint={`Quant < ${threshold}`} />
        <Metric id="pares-pequenas" label="Objetivo das pequenas" value={model.planSize.smallPairs} hint="objetivo da OP" />
        <Metric id="ops-grandes" label="OPs grandes" value={model.planSize.largeOps} hint={`Quant ≥ ${threshold}`} />
        <Metric id="pares-grandes" label="Objetivo das grandes" value={model.planSize.largePairs} hint="objetivo da OP" />
        <Metric id="pic-emb-peq" label="Embalados pequenos" value={model.picSizeEmb?.smallPairs ?? null} hint="picagens da semana" tone="teal" />
        <Metric id="pic-emb-grd" label="Embalados grandes" value={model.picSizeEmb?.largePairs ?? null} hint="picagens da semana" tone="teal" />
        <Metric id="pic-exp-peq" label="Expedidos pequenos" value={model.picSizeExp?.smallPairs ?? null} hint="picagens da semana" tone="blue" />
        <Metric id="pic-exp-grd" label="Expedidos grandes" value={model.picSizeExp?.largePairs ?? null} hint="picagens da semana" tone="blue" />
      </div>

      <div className="panel table-panel">
        <div className="table-head">
          <h3>OPs com ShipDate nesta semana</h3>
          <label>
            Pesquisar
            <input
              value={query}
              data-testid="pesquisa"
              placeholder="OP, cliente, referência"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="muted">
            {shown.length} de {rows.length}. A pesquisa e os filtros do cabeçalho não alteram os cartões. A cor da linha segue o cumprimento de expedição.
          </span>
        </div>
        <div className="totals-strip" data-testid="totais-ops">
          <p>Totais das linhas filtradas</p>
          {TOTAL_FIELDS.map(([key, label]) => (
            <div key={key} data-total={key} data-value={columnTotals[key] == null ? '' : String(columnTotals[key])}>
              <em>{label}</em>
              <strong>{columnTotals[key] == null ? '—' : formatPairs(columnTotals[key])}</strong>
            </div>
          ))}
        </div>
        <div className="table-wrap">
          <table id="plano-tabela">
            <thead>
              <tr>
                {DETAIL_COLUMNS.map((column) => (
                  <th key={column.key} className={column.key === 'op' ? 'sticky' : undefined} title={column.title}>
                    <div className="col-head">
                      <span>{column.label}</span>
                      {column.filter === 'select' ? (
                        <select
                          aria-label={`Filtrar ${column.label}`}
                          value={colFilters[column.key] || ''}
                          onChange={(event) => setColFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                        >
                          <option value="">Todos</option>
                          {selectOptions[column.key]?.blank ? <option value="__vazio__">(em branco)</option> : null}
                          {selectOptions[column.key]?.values.map((value) => (
                            <option key={value} value={value}>
                              {column.key === 'shipDate' ? formatDateShort(value) : value}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={`Filtrar ${column.label}`}
                          placeholder="Filtrar"
                          value={colFilters[column.key] || ''}
                          onChange={(event) => setColFilters((current) => ({ ...current, [column.key]: event.target.value }))}
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => {
                const picEmb = model.hasPicagens ? emb.byOp.get(row.op) || 0 : null;
                const picExp = model.hasPicagens ? exp.byOp.get(row.op) || 0 : null;
                const goal = expedicaoObjetivo(row);
                const rowPace = paceOf(picExp, goal);
                const rowClass = [row.shipDate === today ? 'is-today' : '', rowPace ? `pace-${rowPace}` : ''].filter(Boolean).join(' ');
                return (
                  <tr key={row.op} data-op={row.op} data-pace={rowPace} className={rowClass || undefined}>
                    <td className="sticky op">{row.op}</td>
                    <td className="clip" title={row.cliente || ''}>{row.cliente || '—'}</td>
                    <td className="op">{row.ref || '—'}</td>
                    <td>{row.marca || '—'}</td>
                    <td>{row.codFab || '—'}</td>
                    <td>{row.linhaProd || '—'}</td>
                    <td className="num" title={weekdayShort(row.shipDate)}>
                      {formatDateShort(row.shipDate)}
                    </td>
                    {cell(row.quant, 'quant')}
                    {cell(row.obs, 'obs')}
                    {cell(row.gr, 'gr')}
                    {cell(row.e, 'e')}
                    {cell(jaEmbaladoOf(row), 'embalado')}
                    {cell(row.porEmbalar, 'porEmbalar')}
                    {cell(row.expedido, 'expedido')}
                    {cell(faltaExpedirOf(goal, picExp == null ? 0 : picExp), 'faltaExpedir')}
                    {cell(faltaEmbalarOf(row, picEmb), 'faltaEmbalar')}
                    <PairQuantity value={picEmb} objetivo={goal} field="picEmb" jaEmbalado={jaEmbaladoOf(row)} />
                    <PairQuantity value={picExp} objetivo={goal} field="picExp" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
