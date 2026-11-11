import { parseLooseDate } from './dates.js';

export function normHeader(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const EMB_SECTIONS = new Set(['embembalagem', 'embalagem']);
const EXP_SECTIONS = new Set(['embexpedicao', 'expedicao']);

export function sectionOf(value) {
  const text = normHeader(value);
  if (EXP_SECTIONS.has(text)) return 'exp';
  if (EMB_SECTIONS.has(text)) return 'emb';
  return null;
}

export function normOp(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = String(value).trim();
  if (/^\d+\.0+$/.test(text)) return text.replace(/\.0+$/, '');
  return text;
}

function parseQtd(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/\s/g, '').replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function cellText(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function classifyPicagem(record) {
  const section = sectionOf(record.section);
  const touched = [record.section, record.op, record.date, record.qtd, record.ref, record.brand]
    .some((value) => value != null && value !== '');
  if (!section) return { kind: touched ? 'section' : 'empty' };
  const op = normOp(record.op);
  const date = parseLooseDate(record.date);
  const qtd = parseQtd(record.qtd);
  if (!op || !date || qtd == null) return { kind: 'incomplete' };
  return {
    kind: 'row',
    row: {
      op,
      ref: cellText(record.ref),
      brand: cellText(record.brand),
      numPar: cellText(record.numPar),
      qtd,
      date,
      section,
      cliente: cellText(record.cliente),
      tipo: cellText(record.tipo),
      tipoProd: cellText(record.tipoProd),
    },
  };
}
