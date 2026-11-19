import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  { key: 'op', label: 'OP' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'ref', label: 'Ref.' },
  { key: 'marca', label: 'Marca' },
  { key: 'codFab', label: 'Cód. fab.' },
  { key: 'linhaProd', label: 'Linha' },
  { key: 'shipDate', label: 'Ship date' },
  { key: 'quant', label: 'Quant.' },
  { key: 'obs', label: 'Obs' },
  { key: 'gr', label: 'GR', title: 'Pares já expedidos antes' },
  { key: 'e', label: 'E', title: 'Pares embalados agora' },
  { key: 'embalado', label: 'Já embalado', title: 'Já embalado = E − GR' },
  { key: 'porEmbalar', label: 'Por embalar' },
  { key: 'expedido', label: 'Expedido' },
  { key: 'faltaExpedir', label: 'Falta expedir', title: 'max(0, objetivo de expedição − picagens EMB.Expedicao). Não entra o GR nem a coluna E' },
  { key: 'faltaEmbalar', label: 'Falta embalar', title: 'Objetivo menos as picagens EMB.Embalagem desta semana menos o já embalado, nunca abaixo de 0' },
  { key: 'picEmb', label: 'Pic. emb.' },
  { key: 'picExp', label: 'Pic. exp.' },
];

const BLANK_LABEL = '(em branco)';
const NUMBER_KEYS = new Set([
  'quant', 'obs', 'gr', 'e', 'embalado', 'porEmbalar', 'expedido',
  'faltaExpedir', 'faltaEmbalar', 'picEmb', 'picExp',
]);

function displayFilterValue(key, raw) {
  if (raw === '') return BLANK_LABEL;
  if (key === 'shipDate') return formatDateShort(raw);
  if (NUMBER_KEYS.has(key)) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      if (key === 'picEmb' || key === 'picExp') return formatPairs(n);
      return new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(n);
    }
  }
  return raw;
}

function compareFilterValues(key, a, b) {
  if (a === '' && b === '') return 0;
  if (a === '') return 1;
  if (b === '') return -1;
  if (NUMBER_KEYS.has(key)) {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  }
  return a.localeCompare(b, 'pt', { numeric: true, sensitivity: 'base' });
}

function passesColumnFilters(text, filters, exceptKey) {
  for (const column of DETAIL_COLUMNS) {
    if (column.key === exceptKey) continue;
    const allowed = filters[column.key];
    if (!allowed) continue;
    if (!allowed.has(text[column.key])) return false;
  }
  return true;
}

function coversAll(selected, universe) {
  if (selected.size < universe.size) return false;
  for (const value of universe) {
    if (!selected.has(value)) return false;
  }
  return true;
}

function filterChoices(items, filters, key) {
  const natural = new Set();
  for (const item of items) {
    if (!passesColumnFilters(item.text, filters, key)) continue;
    natural.add(item.text[key]);
  }
  const values = new Set(natural);
  const allowed = filters[key];
  if (allowed) {
    for (const value of allowed) values.add(value);
  }
  return {
    values: [...values].sort((a, b) => compareFilterValues(key, a, b)),
    natural,
  };
}

function matchesFilterQuery(key, raw, query) {
  const q = fold(query.trim());
  if (!q) return true;
  const label = fold(displayFilterValue(key, raw));
  if (label.includes(q)) return true;
  const compact = (value) => value.replace(/[\s\u00a0\u202f]/g, '');
  return compact(label).includes(compact(q));
}

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

function readFilterPosition(button) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  let left = rect.left;
  if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  const spaceAbove = rect.top - 12;
  const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
  const room = Math.max(160, openUp ? spaceAbove : spaceBelow);
  const listMax = Math.max(96, Math.min(240, room - 118));
  if (openUp) return { left, width, top: 'auto', bottom: window.innerHeight - rect.top + 4, listMax };
  return { left, width, top: rect.bottom + 4, bottom: 'auto', listMax };
}

function FilterIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path d="M1.5 2.5h13l-5 6.1V13l-3 1.1V8.6l-5-6.1z" fill="currentColor" />
    </svg>
  );
}

function ColumnFilter({ column, allowed, choice, universe, onChange }) {
  const listed = choice.values;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const allRef = useRef(null);
  const searchRef = useRef(null);
  const active = Boolean(allowed);
  const visible = listed.filter((value) => matchesFilterQuery(column.key, value, query));
  const isChecked = (value) => !allowed || allowed.has(value);
  const selectedCount = allowed ? listed.filter((value) => allowed.has(value)).length : listed.length;
  const allChecked = visible.length > 0 && visible.every(isChecked);
  const someChecked = visible.some(isChecked);
  const noneSelected = Boolean(allowed) && allowed.size === 0;

  function commit(next) {
    onChange(coversAll(next, universe) ? null : next);
  }

  function materialize() {
    return allowed ? new Set(allowed) : new Set(listed);
  }

  function onToggle(value) {
    const next = materialize();
    if (next.has(value)) next.delete(value);
    else next.add(value);
    commit(next);
  }

  function onToggleAll() {
    if (!visible.length) return;
    const next = materialize();
    if (allChecked) {
      for (const value of visible) next.delete(value);
    } else {
      for (const value of visible) next.add(value);
    }
    commit(next);
  }

  function place() {
    if (!btnRef.current) return;
    const next = readFilterPosition(btnRef.current);
    setPos((current) => {
      if (
        current
        && current.left === next.left
        && current.top === next.top
        && current.bottom === next.bottom
        && current.width === next.width
        && current.listMax === next.listMax
      ) return current;
      return next;
    });
  }

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    searchRef.current?.focus({ preventScroll: true });
    const onScroll = () => place();
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onPointer = (event) => {
      const target = event.target;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (allRef.current) allRef.current.indeterminate = someChecked && !allChecked;
  }, [someChecked, allChecked, open]);

  function toggleOpen() {
    if (open) {
      setOpen(false);
      return;
    }
    if (btnRef.current) setPos(readFilterPosition(btnRef.current));
    setQuery('');
    setOpen(true);
  }

  return (
    <div className="col-filter">
      <button
        type="button"
        ref={btnRef}
        className={active ? 'col-filter-btn is-on' : 'col-filter-btn'}
        aria-label={active ? `Filtrar ${column.label}. Filtro ativo.` : `Filtrar ${column.label}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={active ? 'Filtro ativo' : `Filtrar ${column.label}`}
        data-testid={`filtro-${column.key}`}
        data-active={active ? 'true' : 'false'}
        onClick={toggleOpen}
      >
        <FilterIcon />
      </button>
      {open && pos ? createPortal(
        <div
          ref={popRef}
          className="col-filter-pop"
          role="dialog"
          aria-label={`Filtrar ${column.label}`}
          data-filter-pop={column.key}
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width }}
        >
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Procurar"
            aria-label={`Procurar em ${column.label}`}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="col-filter-actions">
            <label>
              <input
                ref={allRef}
                type="checkbox"
                checked={allChecked}
                disabled={visible.length === 0}
                onChange={onToggleAll}
              />
              Selecionar tudo
            </label>
            <button type="button" onClick={() => onChange(new Set())} disabled={noneSelected}>
              Limpar
            </button>
          </div>
          <p className="col-filter-meta">
            {listed.length === 0 ? 'Sem valores' : `${selectedCount} de ${listed.length}`}
          </p>
          <div className="col-filter-list" style={{ maxHeight: pos.listMax }}>
            {visible.length === 0 ? (
              <p className="col-filter-empty">Nenhum valor</p>
            ) : visible.map((value) => {
              const orphan = Boolean(allowed?.has(value)) && !choice.natural.has(value);
              const label = displayFilterValue(column.key, value);
              return (
                <label key={`v:${value}`} className={orphan ? 'is-kept' : undefined} title={orphan ? 'Já não há linhas com este valor nos outros filtros. Continua selecionado.' : label}>
                  <input
                    type="checkbox"
                    checked={isChecked(value)}
                    data-value={value}
                    onChange={() => onToggle(value)}
                  />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

export function WeekView({ model, threshold, query, setQuery, today }) {
  const { planTotals: totals, emb, exp, inWeek } = model;
  const labels = dayLabels(model.range.days);
  const brands = model.breakdown.brands;
  const tipos = model.breakdown.tipos;
  const [colFilters, setColFilters] = useState({});
  const activeWeek = model.key;
  const [filtersWeek, setFiltersWeek] = useState(activeWeek);
  if (filtersWeek !== activeWeek) {
    setFiltersWeek(activeWeek);
    setColFilters({});
  }
  const needle = fold(query.trim());
  const rows = useMemo(
    () => [...inWeek].sort((a, b) => a.shipDate.localeCompare(b.shipDate) || Number(a.op) - Number(b.op)),
    [inWeek],
  );
  const searched = useMemo(
    () => (needle
      ? rows.filter((row) => fold([row.op, row.cliente, row.ref, row.marca, row.codFab].join(' ')).includes(needle))
      : rows),
    [rows, needle],
  );
  const prepared = useMemo(() => searched.map((row) => {
    const picEmb = model.hasPicagens ? emb.byOp.get(row.op) || 0 : null;
    const picExp = model.hasPicagens ? exp.byOp.get(row.op) || 0 : null;
    const text = {};
    for (const column of DETAIL_COLUMNS) text[column.key] = fieldText(row, column.key, picEmb, picExp);
    return { row, picEmb, picExp, text };
  }), [searched, model.hasPicagens, emb, exp]);
  const choices = useMemo(() => {
    const out = {};
    for (const column of DETAIL_COLUMNS) out[column.key] = filterChoices(prepared, colFilters, column.key);
    return out;
  }, [prepared, colFilters]);
  const universes = useMemo(() => {
    const out = {};
    for (const column of DETAIL_COLUMNS) out[column.key] = new Set();
    for (const item of prepared) {
      for (const column of DETAIL_COLUMNS) out[column.key].add(item.text[column.key]);
    }
    return out;
  }, [prepared]);
  const shown = useMemo(
    () => prepared.filter((item) => passesColumnFilters(item.text, colFilters, null)),
    [prepared, colFilters],
  );
  const anyFilter = DETAIL_COLUMNS.some((column) => colFilters[column.key]);
  const columnTotals = {};
  for (const [key] of TOTAL_FIELDS) {
    if ((key === 'picEmb' || key === 'picExp') && !model.hasPicagens) {
      columnTotals[key] = null;
      continue;
    }
    let sum = 0;
    for (const item of shown) {
      const row = item.row;
      if (key === 'picEmb') sum += item.picEmb || 0;
      else if (key === 'picExp') sum += item.picExp || 0;
      else if (key === 'embalado') sum += jaEmbaladoOf(row);
      else if (key === 'faltaEmbalar') sum += faltaEmbalarOf(row, item.picEmb);
      else if (key === 'faltaExpedir') sum += faltaExpedirOf(expedicaoObjetivo(row), item.picExp == null ? 0 : item.picExp);
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
          {anyFilter ? (
            <button type="button" className="ghost" data-testid="limpar-filtros" onClick={() => setColFilters({})}>
              Limpar filtros
            </button>
          ) : null}
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
                      <ColumnFilter
                        column={column}
                        allowed={colFilters[column.key] || null}
                        choice={choices[column.key]}
                        universe={universes[column.key]}
                        onChange={(next) => setColFilters((current) => {
                          const copy = { ...current };
                          if (next == null) delete copy[column.key];
                          else copy[column.key] = next;
                          return copy;
                        })}
                      />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td className="empty-row" colSpan={DETAIL_COLUMNS.length}>Nenhuma OP com os filtros escolhidos.</td>
                </tr>
              ) : null}
              {shown.map((item) => {
                const { row, picEmb, picExp } = item;
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
