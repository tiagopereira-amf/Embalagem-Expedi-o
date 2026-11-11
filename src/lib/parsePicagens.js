import * as XLSXNS from 'xlsx/dist/xlsx.full.min.js';
import { classifyPicagem, normHeader } from './picagemRows.js';

const XLSX = XLSXNS.read ? XLSXNS : XLSXNS.default;

export { classifyPicagem, normHeader, normOp, sectionOf } from './picagemRows.js';

function findHeader(matrix) {
  const limit = Math.min(matrix.length, 20);
  for (let index = 0; index < limit; index += 1) {
    const norms = (matrix[index] || []).map(normHeader);
    if (norms.includes('op') && norms.includes('newsection') && norms.includes('qtdpares') && norms.includes('data1')) {
      return index;
    }
  }
  return -1;
}

export function parseMatrix(matrix, onProgress) {
  const headerIndex = findHeader(matrix);
  if (headerIndex < 0) {
    throw new Error('A folha BD não tem as colunas OP, NewSection, qtdPares e data1.');
  }
  const headers = (matrix[headerIndex] || []).map(normHeader);
  const col = (name) => headers.indexOf(name);
  const columns = {
    ref: col('ref'),
    brand: col('brand'),
    numPar: col('numpar'),
    qtd: col('qtdpares'),
    date: col('data1'),
    section: col('newsection'),
    cliente: col('cliente'),
    op: col('op'),
    tipo: col('tipo'),
    tipoProd: col('tipoprod'),
  };
  const rows = [];
  let ignoredSection = 0;
  let ignoredIncomplete = 0;
  const total = Math.max(1, matrix.length - headerIndex - 1);
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const source = matrix[index] || [];
    if (onProgress && (index - headerIndex) % 8000 === 0) {
      onProgress({
        pct: 45 + Math.round(((index - headerIndex) / total) * 50),
        phase: 'A filtrar picagens',
      });
    }
    const classified = classifyPicagem({
      ref: columns.ref >= 0 ? source[columns.ref] : '',
      brand: columns.brand >= 0 ? source[columns.brand] : '',
      numPar: columns.numPar >= 0 ? source[columns.numPar] : '',
      qtd: columns.qtd >= 0 ? source[columns.qtd] : null,
      date: columns.date >= 0 ? source[columns.date] : null,
      section: columns.section >= 0 ? source[columns.section] : null,
      cliente: columns.cliente >= 0 ? source[columns.cliente] : '',
      op: columns.op >= 0 ? source[columns.op] : null,
      tipo: columns.tipo >= 0 ? source[columns.tipo] : '',
      tipoProd: columns.tipoProd >= 0 ? source[columns.tipoProd] : '',
    });
    if (classified.kind === 'section') ignoredSection += 1;
    else if (classified.kind === 'incomplete') ignoredIncomplete += 1;
    else if (classified.kind === 'row') rows.push(classified.row);
  }
  const embalagem = rows.filter((row) => row.section === 'emb').length;
  const expedicao = rows.filter((row) => row.section === 'exp').length;
  return {
    rows,
    stats: {
      dataRows: total,
      kept: rows.length,
      embalagem,
      expedicao,
      ignoredSection,
      ignoredIncomplete,
    },
  };
}

function rangeFromCells(sheet) {
  let minR = Infinity;
  let minC = Infinity;
  let maxR = 0;
  let maxC = 0;
  let any = false;
  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33) continue;
    const cell = XLSX.utils.decode_cell(key);
    any = true;
    if (cell.r < minR) minR = cell.r;
    if (cell.c < minC) minC = cell.c;
    if (cell.r > maxR) maxR = cell.r;
    if (cell.c > maxC) maxC = cell.c;
  }
  if (!any) return null;
  return { s: { r: minR, c: minC }, e: { r: maxR, c: maxC } };
}

export function parseArrayBuffer(buffer, onProgress) {
  onProgress?.({ pct: 25, phase: 'A abrir o livro' });
  const preview = XLSX.read(buffer, { type: 'array', bookSheets: true });
  const sheetName = (preview.SheetNames || []).find((name) => String(name).trim().toLowerCase() === 'bd');
  if (!sheetName) {
    const found = (preview.SheetNames || []).join(', ') || '(nenhuma)';
    throw new Error(`Folha BD não encontrada. Folhas neste ficheiro: ${found}.`);
  }
  onProgress?.({ pct: 40, phase: 'A ler a folha BD' });
  const workbook = XLSX.read(buffer, {
    type: 'array',
    sheets: [sheetName],
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    cellHTML: false,
    sheetStubs: false,
  });
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) throw new Error('A folha BD está vazia.');
  const declared = XLSX.utils.decode_range(sheet['!ref']);
  const bloated = declared.e.c - declared.s.c > 64 || declared.e.r - declared.s.r > 400000;
  if (bloated) {
    const tight = rangeFromCells(sheet);
    if (tight) sheet['!ref'] = XLSX.utils.encode_range(tight);
  }
  onProgress?.({ pct: 60, phase: 'A filtrar picagens' });
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
  const parsed = parseMatrix(matrix, onProgress);
  onProgress?.({ pct: 100, phase: 'Pronto' });
  return { ...parsed, sheetName };
}
