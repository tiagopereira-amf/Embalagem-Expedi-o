const TZ = 'Europe/Lisbon';

export function lisbonTodayISO(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function excelSerialToISO(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(n) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoWeekParts(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return { year: isoYear, week };
}

export function weekKey(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function weekKeyOfISO(isoDate) {
  const parts = isoWeekParts(isoDate);
  return weekKey(parts.year, parts.week);
}

export function latestWeekOf(dates) {
  let best = null;
  for (const iso of dates || []) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const parts = isoWeekParts(iso);
    if (!best || parts.year > best.year || (parts.year === best.year && parts.week > best.week)) best = parts;
  }
  return best;
}

export function weeksInYear(year) {
  return isoWeekParts(`${year}-12-28`).week;
}

export function weekRange(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (week - 1) * 7);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const dt = new Date(monday);
    dt.setUTCDate(monday.getUTCDate() + i);
    days.push(dt.toISOString().slice(0, 10));
  }
  return { start: days[0], end: days[6], days };
}

export function shiftWeek(year, week, delta) {
  let y = year;
  let w = week + delta;
  while (w < 1) {
    y -= 1;
    w += weeksInYear(y);
  }
  while (w > weeksInYear(y)) {
    w -= weeksInYear(y);
    y += 1;
  }
  return { year: y, week: w };
}

export function parseLooseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return excelSerialToISO(value);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    let match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (match) {
      const dd = match[1].padStart(2, '0');
      const mm = match[2].padStart(2, '0');
      const iso = `${match[3]}-${mm}-${dd}`;
      return isRealISO(iso) ? iso : null;
    }
    match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const iso = `${match[1]}-${match[2]}-${match[3]}`;
      return isRealISO(iso) ? iso : null;
    }
  }
  return null;
}

function isRealISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function formatDateShort(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateLong(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatMonth(isoMonth) {
  const [y, m] = isoMonth.split('-').map(Number);
  const label = new Intl.DateTimeFormat('pt-PT', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return label.replace('.', '');
}

export function weekdayShort(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-PT', { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

export function formatPairs(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  const digits = Math.abs(n - Math.round(n)) < 1e-6 ? 0 : 1;
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return `${new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n)} %`;
}

export function formatPctInput(value) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return new Intl.NumberFormat('pt-PT', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Number(value));
}
