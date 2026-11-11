import { unzipSync } from 'fflate';
import { excelSerialToISO, parseLooseDate } from './dates.js';
import { classifyPicagem, normHeader } from './picagemRows.js';

const decoder = new TextDecoder();
const FIELDS = {
  ref: 'ref',
  brand: 'brand',
  numpar: 'numPar',
  qtdpares: 'qtd',
  data1: 'date',
  newsection: 'section',
  cliente: 'cliente',
  op: 'op',
  tipo: 'tipo',
  tipoprod: 'tipoProd',
};

function pause() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function decodeXml(value) {
  if (!value || !value.includes('&')) return value;
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function entryName(name) {
  return name.replace(/\\/g, '/').replace(/^\//, '').toLowerCase();
}

function pick(files, wanted) {
  const target = wanted.toLowerCase();
  for (const key of Object.keys(files)) {
    if (entryName(key) === target) return files[key];
  }
  return null;
}

function textOf(files, name) {
  const bytes = pick(files, name);
  return bytes ? decoder.decode(bytes) : '';
}

function attr(source, name) {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(source);
  return match ? decodeXml(match[1]) : '';
}

function listSheets(workbookXml) {
  const sheets = [];
  const pattern = /<(?:[A-Za-z0-9]+:)?sheet\b([^>]*)\/?>/g;
  let match = pattern.exec(workbookXml);
  while (match) {
    const name = attr(match[1], 'name');
    const rid = attr(match[1], 'r:id') || attr(match[1], 'id');
    if (name && rid) sheets.push({ name, rid });
    match = pattern.exec(workbookXml);
  }
  return sheets;
}

function relationshipTarget(relsXml, id) {
  const pattern = /<(?:[A-Za-z0-9]+:)?Relationship\b([^>]*)\/?>/g;
  let match = pattern.exec(relsXml);
  while (match) {
    if (attr(match[1], 'Id') === id) return attr(match[1], 'Target');
    match = pattern.exec(relsXml);
  }
  return '';
}

function resolveTarget(target) {
  let path = decodeXml(target).replace(/\\/g, '/');
  if (path.startsWith('/')) path = path.slice(1);
  if (!path.startsWith('xl/')) path = `xl/${path.replace(/^\.\//, '')}`;
  const parts = [];
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function collectText(body) {
  let out = '';
  let cursor = 0;
  while (cursor < body.length) {
    const start = body.indexOf('<t', cursor);
    if (start < 0) break;
    const mark = body[start + 2];
    if (mark !== '>' && mark !== ' ' && mark !== '/' && mark !== '\n' && mark !== '\r' && mark !== '\t') {
      cursor = start + 2;
      continue;
    }
    if (mark === '/') {
      cursor = start + 3;
      continue;
    }
    const openEnd = body.indexOf('>', start);
    if (openEnd < 0) break;
    const close = body.indexOf('</t>', openEnd);
    if (close < 0) break;
    out += decodeXml(body.slice(openEnd + 1, close));
    cursor = close + 4;
  }
  return out;
}

function parseSharedStrings(xml) {
  const source = xml.includes('<rPh') || xml.includes(':rPh')
    ? xml.replace(/<(?:[A-Za-z0-9]+:)?rPh\b[\s\S]*?<\/(?:[A-Za-z0-9]+:)?rPh>/g, '')
    : xml;
  const strings = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<si', cursor);
    if (start < 0) break;
    const mark = source[start + 3];
    if (mark !== '>' && mark !== ' ' && mark !== '/') {
      cursor = start + 3;
      continue;
    }
    const openEnd = source.indexOf('>', start);
    if (openEnd < 0) break;
    if (source[openEnd - 1] === '/') {
      strings.push('');
      cursor = openEnd + 1;
      continue;
    }
    const close = source.indexOf('</si>', openEnd);
    if (close < 0) break;
    strings.push(collectText(source.slice(openEnd + 1, close)));
    cursor = close + 5;
  }
  return strings;
}

function columnIndex(letters) {
  let index = 0;
  for (let i = 0; i < letters.length; i += 1) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

function readCell(tag, body, strings) {
  const type = attr(tag, 't');
  if (type === 'inlineStr') return collectText(body);
  const open = body.indexOf('<v');
  if (open < 0) return null;
  const mark = body[open + 2];
  if (mark !== '>' && mark !== ' ' && mark !== '/') return null;
  if (mark === '/') return null;
  const openEnd = body.indexOf('>', open);
  const close = body.indexOf('</v>', openEnd);
  if (openEnd < 0 || close < 0) return null;
  const raw = decodeXml(body.slice(openEnd + 1, close)).trim();
  if (!raw) return null;
  if (type === 's') return strings[Number(raw)] ?? '';
  if (type === 'b') return raw === '1';
  if (type === 'str' || type === 'd' || type === 'inlineStr') return raw;
  const number = Number(raw);
  return Number.isFinite(number) ? number : raw;
}

function parseCells(inner, strings) {
  const values = [];
  let cursor = 0;
  let nextCol = 0;
  while (cursor < inner.length) {
    const start = inner.indexOf('<c', cursor);
    if (start < 0) break;
    const mark = inner[start + 2];
    if (mark !== ' ' && mark !== '>' && mark !== '/' && mark !== '\n' && mark !== '\r' && mark !== '\t') {
      cursor = start + 2;
      continue;
    }
    const tagEnd = inner.indexOf('>', start);
    if (tagEnd < 0) break;
    const tag = inner.slice(start, tagEnd + 1);
    let end = tagEnd + 1;
    let body = '';
    if (inner[tagEnd - 1] !== '/') {
      const close = inner.indexOf('</c>', tagEnd);
      if (close < 0) break;
      body = inner.slice(tagEnd + 1, close);
      end = close + 4;
    }
    const ref = /\br="([A-Z]+)/.exec(tag);
    const col = ref ? columnIndex(ref[1]) : nextCol;
    nextCol = col + 1;
    values[col] = readCell(tag, body, strings);
    cursor = end;
  }
  return values;
}

function sheetBounds(xml) {
  let open = xml.indexOf('<sheetData');
  if (open < 0) open = xml.indexOf(':sheetData');
  if (open < 0) return null;
  const start = xml.indexOf('>', open);
  if (start < 0) return null;
  const end = xml.indexOf('</sheetData>', start);
  return { start: start + 1, end: end < 0 ? xml.length : end };
}

async function parseSheet(xml, strings, onProgress, onBatch, yieldToMain) {
  const bounds = sheetBounds(xml);
  if (!bounds) throw new Error('A folha BD não tem dados.');
  const stats = {
    dataRows: 0,
    kept: 0,
    embalagem: 0,
    expedicao: 0,
    ignoredSection: 0,
    ignoredIncomplete: 0,
  };
  const kept = onBatch ? null : [];
  const batch = [];
  let header = null;
  let seen = 0;
  let sinceYield = 0;
  let cursor = bounds.start;
  const flush = async () => {
    if (!batch.length) return;
    const chunk = batch.splice(0, batch.length);
    if (onBatch) await onBatch(chunk);
    else {
      for (let i = 0; i < chunk.length; i += 1) kept.push(chunk[i]);
    }
  };
  while (cursor < bounds.end) {
    const rowStart = xml.indexOf('<row', cursor);
    if (rowStart < 0 || rowStart >= bounds.end) break;
    const mark = xml[rowStart + 4];
    if (mark !== ' ' && mark !== '>' && mark !== '/') {
      cursor = rowStart + 4;
      continue;
    }
    const tagEnd = xml.indexOf('>', rowStart);
    if (tagEnd < 0 || tagEnd >= bounds.end) break;
    let rowEnd = tagEnd + 1;
    let inner = '';
    if (xml[tagEnd - 1] !== '/') {
      rowEnd = xml.indexOf('</row>', tagEnd);
      if (rowEnd < 0) break;
      inner = xml.slice(tagEnd + 1, rowEnd);
      rowEnd += 6;
    }
    cursor = rowEnd;
    const cells = inner ? parseCells(inner, strings) : [];
    if (!header) {
      seen += 1;
      if (seen > 20) throw new Error('A folha BD não tem as colunas OP, NewSection, qtdPares e data1.');
      const norms = cells.map((value) => normHeader(value));
      if (norms.includes('op') && norms.includes('newsection') && norms.includes('qtdpares') && norms.includes('data1')) {
        header = {};
        norms.forEach((name, index) => {
          if (FIELDS[name]) header[FIELDS[name]] = index;
        });
      }
      continue;
    }
    if (!cells.length) continue;
    stats.dataRows += 1;
    const record = {
      ref: cells[header.ref],
      brand: cells[header.brand],
      numPar: cells[header.numPar],
      qtd: cells[header.qtd],
      date: cells[header.date],
      section: cells[header.section],
      cliente: cells[header.cliente],
      op: cells[header.op],
      tipo: cells[header.tipo],
      tipoProd: cells[header.tipoProd],
    };
    const classified = classifyPicagem(record);
    if (classified.kind === 'section') stats.ignoredSection += 1;
    else if (classified.kind === 'incomplete') stats.ignoredIncomplete += 1;
    else if (classified.kind === 'row') {
      batch.push(classified.row);
      stats.kept += 1;
      if (classified.row.section === 'emb') stats.embalagem += 1;
      else if (classified.row.section === 'exp') stats.expedicao += 1;
      if (batch.length >= 4000) await flush();
    }
    sinceYield += 1;
    if (yieldToMain && sinceYield >= 2500) {
      sinceYield = 0;
      const span = Math.max(1, bounds.end - bounds.start);
      const pct = 62 + Math.round(((cursor - bounds.start) / span) * 34);
      onProgress?.({ pct: Math.min(96, pct), phase: 'A filtrar picagens' });
      await pause();
    }
  }
  if (!header) throw new Error('A folha BD não tem as colunas OP, NewSection, qtdPares e data1.');
  await flush();
  return { rows: kept || [], stats };
}

function locateNamedSheet(workbookXml, relsXml, wanted, label) {
  const sheets = listSheets(workbookXml);
  if (!sheets.length) throw new Error('Este ficheiro não tem folhas.');
  const sheet = sheets.find((item) => item.name.trim().toLowerCase() === wanted);
  if (!sheet) {
    const names = sheets.map((item) => item.name).join(', ');
    throw new Error(`Folha ${label} não encontrada. Folhas neste ficheiro: ${names}.`);
  }
  const target = relationshipTarget(relsXml, sheet.rid);
  if (!target) throw new Error(`Não foi possível localizar a folha ${label} dentro do livro.`);
  return resolveTarget(target);
}

function locateSheet(workbookXml, relsXml) {
  return locateNamedSheet(workbookXml, relsXml, 'bd', 'BD');
}

const PLAN_COL = {
  op: 0,
  cliente: 1,
  linhaProd: 3,
  codFab: 4,
  marca: 5,
  shipDate: 6,
  obs: 9,
  quant: 14,
  ref: 15,
  gr: 17,
  e: 27,
  embalado: 28,
  porEmbalar: 30,
  expedido: 31,
  faltaExpedir: 33,
  faltaEmbalar: 50,
};

function planNumber(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'string' && value.trim().startsWith('#')) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function planText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text.startsWith('#')) return null;
  return text;
}

function planOp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value));
  const text = planText(value);
  return text || '';
}

function planDate(value) {
  if (typeof value === 'number') return excelSerialToISO(value);
  return parseLooseDate(value);
}

function parseShipdateRows(xml, strings) {
  const bounds = sheetBounds(xml);
  if (!bounds) throw new Error('A folha SHIPDATE não tem dados.');
  const rows = [];
  let cursor = bounds.start;
  let sawRow = false;
  while (cursor < bounds.end) {
    const rowStart = xml.indexOf('<row', cursor);
    if (rowStart < 0 || rowStart >= bounds.end) break;
    const mark = xml[rowStart + 4];
    if (mark !== ' ' && mark !== '>' && mark !== '/') {
      cursor = rowStart + 4;
      continue;
    }
    const tagEnd = xml.indexOf('>', rowStart);
    if (tagEnd < 0 || tagEnd >= bounds.end) break;
    const tag = xml.slice(rowStart, tagEnd + 1);
    let rowEnd = tagEnd + 1;
    let inner = '';
    if (xml[tagEnd - 1] !== '/') {
      rowEnd = xml.indexOf('</row>', tagEnd);
      if (rowEnd < 0) break;
      inner = xml.slice(tagEnd + 1, rowEnd);
      rowEnd += 6;
    }
    cursor = rowEnd;
    const rowRef = /\br="(\d+)"/.exec(tag);
    const rowNumber = rowRef ? Number(rowRef[1]) : null;
    if (rowNumber === 1 || (rowNumber == null && !sawRow)) {
      sawRow = true;
      continue;
    }
    sawRow = true;
    const cells = inner ? parseCells(inner, strings) : [];
    const op = planOp(cells[PLAN_COL.op]);
    if (!op || op.toLowerCase() === 'op') continue;
    rows.push({
      op,
      cliente: planText(cells[PLAN_COL.cliente]),
      linhaProd: planText(cells[PLAN_COL.linhaProd]),
      codFab: planText(cells[PLAN_COL.codFab]),
      marca: planText(cells[PLAN_COL.marca]),
      shipDate: planDate(cells[PLAN_COL.shipDate]),
      obs: planNumber(cells[PLAN_COL.obs]),
      quant: planNumber(cells[PLAN_COL.quant]),
      ref: planText(cells[PLAN_COL.ref]),
      gr: planNumber(cells[PLAN_COL.gr]),
      e: planNumber(cells[PLAN_COL.e]),
      embalado: planNumber(cells[PLAN_COL.embalado]),
      porEmbalar: planNumber(cells[PLAN_COL.porEmbalar]),
      expedido: planNumber(cells[PLAN_COL.expedido]),
      faltaExpedir: planNumber(cells[PLAN_COL.faltaExpedir]),
      faltaEmbalar: planNumber(cells[PLAN_COL.faltaEmbalar]),
    });
  }
  if (!rows.length) throw new Error('A folha SHIPDATE não tem OPs.');
  return rows;
}

async function loadNamedSheet(buffer, wanted, label) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const index = unzipSync(bytes, {
    filter(file) {
      const name = entryName(file.name);
      return name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels';
    },
  });
  const workbookXml = textOf(index, 'xl/workbook.xml');
  const relsXml = textOf(index, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml) throw new Error('Este ficheiro não parece um livro Excel (.xlsx ou .xlsm).');
  const sheetPath = locateNamedSheet(workbookXml, relsXml, wanted, label);
  const data = unzipSync(bytes, {
    filter(file) {
      const name = entryName(file.name);
      return name === sheetPath.toLowerCase() || name === 'xl/sharedstrings.xml';
    },
  });
  const sharedXml = textOf(data, 'xl/sharedStrings.xml');
  let sheetXml = textOf(data, sheetPath);
  if (!sheetXml) throw new Error(`Não foi possível abrir a folha ${label}.`);
  if (sheetXml.includes(':sheetData') && !sheetXml.includes('<sheetData')) {
    sheetXml = sheetXml.replace(/<(\/?)[A-Za-z0-9]+:/g, '<$1');
  }
  return { sheetXml, strings: sharedXml ? parseSharedStrings(sharedXml) : [] };
}

export async function readShipdate(buffer, onProgress) {
  onProgress?.({ pct: 40, phase: 'A ler a folha SHIPDATE' });
  const { sheetXml, strings } = await loadNamedSheet(buffer, 'shipdate', 'SHIPDATE');
  onProgress?.({ pct: 70, phase: 'A ler as OPs' });
  const rows = parseShipdateRows(sheetXml, strings);
  onProgress?.({ pct: 100, phase: 'Pronto' });
  return { rows, stats: { ops: rows.length } };
}

export async function readPicagens(buffer, onProgress, onBatch, options = {}) {
  const yieldToMain = Boolean(options.yieldToMain);
  const breathe = async () => {
    if (yieldToMain) await pause();
  };
  onProgress?.({ pct: 34, phase: 'A descompactar o livro' });
  await breathe();
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const index = unzipSync(bytes, {
    filter(file) {
      const name = entryName(file.name);
      return name === 'xl/workbook.xml' || name === 'xl/_rels/workbook.xml.rels';
    },
  });
  const workbookXml = textOf(index, 'xl/workbook.xml');
  const relsXml = textOf(index, 'xl/_rels/workbook.xml.rels');
  if (!workbookXml) throw new Error('Este ficheiro não parece um livro Excel (.xlsx ou .xlsm).');
  const sheetPath = locateSheet(workbookXml, relsXml);
  onProgress?.({ pct: 46, phase: 'A ler a folha BD' });
  await breathe();
  const data = unzipSync(bytes, {
    filter(file) {
      const name = entryName(file.name);
      return name === sheetPath.toLowerCase() || name === 'xl/sharedstrings.xml';
    },
  });
  const sharedXml = textOf(data, 'xl/sharedStrings.xml');
  let sheetXml = textOf(data, sheetPath);
  if (!sheetXml) throw new Error('Não foi possível abrir a folha BD.');
  onProgress?.({ pct: 54, phase: 'A preparar os textos' });
  await breathe();
  const strings = sharedXml ? parseSharedStrings(sharedXml) : [];
  if (sheetXml.includes(':sheetData') && !sheetXml.includes('<sheetData')) {
    sheetXml = sheetXml.replace(/<(\/?)[A-Za-z0-9]+:/g, '<$1');
  }
  onProgress?.({ pct: 62, phase: 'A filtrar picagens' });
  await breathe();
  const parsed = await parseSheet(sheetXml, strings, onProgress, onBatch, yieldToMain);
  onProgress?.({ pct: 100, phase: 'Pronto' });
  return { sheetName: 'BD', stats: parsed.stats, rows: parsed.rows };
}
