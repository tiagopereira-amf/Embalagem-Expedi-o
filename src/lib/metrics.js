import { isoWeekParts, shiftWeek, weekKey, weekKeyOfISO, weekRange } from './dates.js';

export function num(value) {
  if (value == null || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function compliance(realizado, objetivo) {
  if (realizado == null || objetivo == null || objetivo <= 0) return null;
  return Math.min(100, (realizado / objetivo) * 100);
}

export function embalagemCounted(jaEmbalado, embaladoSemana, objetivo) {
  const goal = num(objetivo);
  const ja = Math.min(Math.max(0, num(jaEmbalado)), Math.max(0, goal));
  const semana = Math.min(Math.max(0, num(embaladoSemana)), Math.max(0, goal - ja));
  return { ja, semana, total: ja + semana };
}

export function jaEmbaladoOf(row) {
  return Math.max(0, num(row?.e) - num(row?.gr));
}

export function embalagemPercent(jaEmbalado, embaladoSemana, objetivo) {
  const goal = num(objetivo);
  if (goal <= 0) return 0;
  return ((num(jaEmbalado) + num(embaladoSemana)) / goal) * 100;
}

export function embalagemAggregatePercent(rows, semanaOf) {
  let ja = 0;
  let semana = 0;
  let objetivo = 0;
  for (const row of rows) {
    objetivo += expedicaoObjetivo(row);
    ja += jaEmbaladoOf(row);
    semana += semanaOf ? num(semanaOf(row)) : 0;
  }
  if (objetivo <= 0) return 0;
  return ((ja + semana) / objetivo) * 100;
}

export function embalagemExtraOp(picagens, objetivo, noPlano) {
  const qtd = Math.max(0, num(picagens));
  if (!noPlano) return qtd;
  return Math.max(0, qtd - num(objetivo));
}

export function expedicaoObjetivo(row) {
  if (!row) return 0;
  const raw = row.obs;
  if (raw != null && raw !== '') {
    const filled = Number(raw);
    if (Number.isFinite(filled)) return filled;
  }
  return Math.max(0, num(row.quant) - num(row.gr));
}

export function faltaEmbalarOf(row, embaladoSemana) {
  return Math.max(0, expedicaoObjetivo(row) - num(embaladoSemana) - jaEmbaladoOf(row));
}

export function faltaExpedirOf(objetivo, picagensExpedicao) {
  return Math.max(0, num(objetivo) - num(picagensExpedicao));
}

export function faltaExpedirPorOps(rows, picagensOf) {
  const goalByOp = new Map();
  for (const row of rows) {
    goalByOp.set(row.op, (goalByOp.get(row.op) || 0) + expedicaoObjetivo(row));
  }
  let total = 0;
  for (const [op, goal] of goalByOp) {
    total += faltaExpedirOf(goal, picagensOf ? picagensOf(op) : 0);
  }
  return total;
}

export function indexPicagens(rows) {
  const byWeek = new Map();
  const byOp = new Map();
  for (const row of rows) {
    const key = weekKeyOfISO(row.date);
    let list = byWeek.get(key);
    if (!list) {
      list = [];
      byWeek.set(key, list);
    }
    list.push(row);
    let agg = byOp.get(row.op);
    if (!agg) {
      agg = { emb: 0, exp: 0 };
      byOp.set(row.op, agg);
    }
    if (row.section === 'emb') agg.emb += num(row.qtd);
    else agg.exp += num(row.qtd);
  }
  return { byWeek, byOp, count: rows.length };
}

export function planInWeek(planRows, year, week) {
  return planRows.filter((row) => {
    if (!row.shipDate) return false;
    const parts = isoWeekParts(row.shipDate);
    return parts.year === year && parts.week === week;
  });
}

export function makeSizeOf(planRows, picIndex) {
  const quant = new Map();
  for (const row of planRows) {
    if (row.quant == null || row.quant === '') continue;
    const n = Number(row.quant);
    if (Number.isFinite(n)) quant.set(row.op, n);
  }
  return (op) => {
    if (quant.has(op)) return quant.get(op);
    const agg = picIndex?.byOp.get(op);
    if (!agg) return 0;
    return Math.max(agg.emb, agg.exp);
  };
}

export function sectionCompare(planRows, picWeekRows, section, hasPicagens, goalOf = expedicaoObjetivo) {
  const obsByOp = new Map();
  for (const row of planRows) obsByOp.set(row.op, (obsByOp.get(row.op) || 0) + goalOf(row));
  const objetivo = [...obsByOp.values()].reduce((sum, value) => sum + value, 0);
  const byOp = new Map();
  if (!hasPicagens) {
    return {
      objetivo,
      realizado: null,
      extra: null,
      extraAbove: null,
      extraOutside: null,
      falta: null,
      pct: null,
      byOp,
    };
  }
  for (const row of picWeekRows || []) {
    if (row.section !== section) continue;
    byOp.set(row.op, (byOp.get(row.op) || 0) + num(row.qtd));
  }
  let realizado = 0;
  let extraAbove = 0;
  let falta = 0;
  for (const [op, obs] of obsByOp) {
    const qtd = byOp.get(op) || 0;
    realizado += qtd;
    if (qtd > obs) extraAbove += qtd - obs;
    falta += Math.max(0, obs - qtd);
  }
  let extraOutside = 0;
  for (const [op, qtd] of byOp) {
    if (!obsByOp.has(op)) extraOutside += qtd;
  }
  return {
    objetivo,
    realizado,
    extra: extraAbove + extraOutside,
    extraAbove,
    extraOutside,
    falta,
    pct: compliance(realizado, objetivo),
    byOp,
  };
}

export function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + num(row[field]), 0);
}

function addSplit(target, op, pairs, sizeOf, threshold, seen) {
  if (!seen.has(op)) {
    seen.add(op);
    if (sizeOf(op) < threshold) target.smallOps += 1;
    else target.largeOps += 1;
  }
  if (sizeOf(op) < threshold) target.smallPairs += pairs;
  else target.largePairs += pairs;
}

function emptySplit() {
  return { smallOps: 0, largeOps: 0, smallPairs: 0, largePairs: 0 };
}

export function splitPlanBySize(planRows, sizeOf, threshold) {
  const split = emptySplit();
  const seen = new Set();
  for (const row of planRows) addSplit(split, row.op, expedicaoObjetivo(row), sizeOf, threshold, seen);
  return split;
}

export function splitPicBySize(picRows, section, sizeOf, threshold) {
  const split = emptySplit();
  const seen = new Set();
  for (const row of picRows || []) {
    if (section && row.section !== section) continue;
    addSplit(split, row.op, num(row.qtd), sizeOf, threshold, seen);
  }
  return split;
}

export function cumulativeWeek(days, planRows, picRows, hasPicagens) {
  const obsByDay = new Map();
  for (const row of planRows) {
    obsByDay.set(row.shipDate, (obsByDay.get(row.shipDate) || 0) + expedicaoObjetivo(row));
  }
  const embByDay = new Map();
  const expByDay = new Map();
  if (hasPicagens) {
    for (const row of picRows || []) {
      const map = row.section === 'emb' ? embByDay : expByDay;
      map.set(row.date, (map.get(row.date) || 0) + num(row.qtd));
    }
  }
  let objetivo = 0;
  let embalado = 0;
  let expedido = 0;
  return days.map((date) => {
    objetivo += obsByDay.get(date) || 0;
    embalado += embByDay.get(date) || 0;
    expedido += expByDay.get(date) || 0;
    return {
      date,
      objetivo,
      embalado: hasPicagens ? embalado : null,
      expedido: hasPicagens ? expedido : null,
    };
  });
}

export function brandTipoBreakdown(planRows, picRows, hasPicagens) {
  const brands = new Map();
  const tipos = new Map();
  const touch = (map, name) => {
    const key = (name || '').trim() || '(sem marca)';
    if (!map.has(key)) map.set(key, { objetivo: 0, emb: 0, exp: 0 });
    return map.get(key);
  };
  for (const row of planRows) touch(brands, row.marca).objetivo += expedicaoObjetivo(row);
  if (hasPicagens) {
    for (const row of picRows || []) {
      const brand = touch(brands, row.brand);
      const tipoName = (row.tipo || '').trim() || '(sem tipo)';
      if (!tipos.has(tipoName)) tipos.set(tipoName, { emb: 0, exp: 0 });
      const tipo = tipos.get(tipoName);
      if (row.section === 'emb') {
        brand.emb += num(row.qtd);
        tipo.emb += num(row.qtd);
      } else {
        brand.exp += num(row.qtd);
        tipo.exp += num(row.qtd);
      }
    }
  }
  return {
    brands: [...brands.entries()].sort((a, b) => b[1].objetivo + b[1].emb + b[1].exp - (a[1].objetivo + a[1].emb + a[1].exp)),
    tipos: [...tipos.entries()].sort((a, b) => b[1].emb + b[1].exp - (a[1].emb + a[1].exp)),
  };
}

function marcaLabel(value) {
  const trimmed = String(value || '').trim();
  return trimmed || 'Sem marca';
}

function isOnlineCliente(value) {
  return String(value || '').trim().toLowerCase() === 'internet (consumidor final)';
}

function marcaBucket(name, cliente) {
  const label = marcaLabel(name);
  if (label.toLowerCase() !== 'toworkfor') return { key: label.toLowerCase(), label, split: false };
  const bucket = isOnlineCliente(cliente) ? 'Toworkfor - Online' : 'Toworkfor';
  return { key: bucket.toLowerCase(), label: bucket, split: true };
}

export function articleType(ref) {
  const text = String(ref || '').trim().toLowerCase();
  if (text.startsWith('6') || text.startsWith('8') || text.startsWith('9')) return 'calcado';
  if (text.startsWith('1h') || text.startsWith('1u')) return 'roupa';
  return 'outros';
}

function finishMarcaGroup(slots, hasPicagens) {
  const lines = [...slots.values()]
    .filter((slot) => slot.hasPlan || slot.pairs > 0)
    .map((slot) => {
      const hasObjetivo = slot.hasPlan && slot.objetivo > 0;
      return {
        marca: slot.marca,
        objetivo: slot.hasPlan ? slot.objetivo : null,
        jaEmbalado: slot.jaEmbalado,
        semanaPlano: slot.semanaPlano,
        embIn: hasPicagens && hasObjetivo ? slot.embIn : null,
        embExtra: slot.embExtra,
        expIn: hasObjetivo ? slot.expIn : null,
        expExtra: slot.expExtra,
        expQty: slot.expQty,
        faltaExpedir: slot.hasPlan ? slot.faltaExpedir : null,
        embPct: slot.hasPlan ? embalagemPercent(slot.jaEmbalado, slot.semanaPlano, slot.objetivo) : null,
        expPct: slot.hasPlan && slot.expQty != null ? compliance(slot.expQty, slot.objetivo) : null,
      };
    })
    .sort((a, b) => a.marca.localeCompare(b.marca, 'pt'));
  const planned = lines.filter((line) => line.objetivo != null);
  const objetivo = planned.length ? planned.reduce((sum, line) => sum + line.objetivo, 0) : null;
  const expQty = hasPicagens ? lines.reduce((sum, line) => sum + line.expQty, 0) : null;
  const hasRoom = objetivo != null && objetivo > 0;
  const ja = lines.reduce((sum, line) => sum + line.jaEmbalado, 0);
  const semanaPlano = lines.reduce((sum, line) => sum + line.semanaPlano, 0);
  return {
    lines,
    total: lines.length ? {
      marca: 'Total',
      objetivo,
      jaEmbalado: ja,
      semanaPlano,
      embIn: hasPicagens && hasRoom ? lines.reduce((sum, line) => sum + (line.embIn || 0), 0) : null,
      embExtra: lines.reduce((sum, line) => sum + line.embExtra, 0),
      expIn: hasRoom ? lines.reduce((sum, line) => sum + (line.expIn || 0), 0) : null,
      expExtra: lines.reduce((sum, line) => sum + line.expExtra, 0),
      expQty,
      faltaExpedir: lines.reduce((sum, line) => sum + (line.faltaExpedir || 0), 0),
      embPct: objetivo == null ? null : embalagemPercent(ja, semanaPlano, objetivo),
      expPct: !hasRoom || expQty == null ? null : compliance(expQty, objetivo),
    } : null,
  };
}

function picagensByOp(picRows, section) {
  const byOp = new Map();
  for (const row of picRows || []) {
    if (row.section !== section) continue;
    byOp.set(row.op, (byOp.get(row.op) || 0) + num(row.qtd));
  }
  return byOp;
}

export function marcaTable(planRows, picRows, hasPicagens) {
  const groups = { calcado: new Map(), roupa: new Map(), outros: new Map() };
  const embByOp = hasPicagens ? picagensByOp(picRows, 'emb') : new Map();
  const expByOp = hasPicagens ? picagensByOp(picRows, 'exp') : new Map();
  const planOps = new Set(planRows.map((row) => row.op));
  const goalByOp = new Map();
  for (const row of planRows) goalByOp.set(row.op, (goalByOp.get(row.op) || 0) + expedicaoObjetivo(row));
  const faltaContada = new Set();
  const touch = (name, cliente, ref, fromPlan) => {
    const bucket = marcaBucket(name, cliente);
    const map = groups[articleType(ref)];
    let slot = map.get(bucket.key);
    if (!slot) {
      slot = {
        marca: bucket.label,
        hasPlan: false,
        objetivo: null,
        jaEmbalado: 0,
        semanaPlano: 0,
        embIn: 0,
        embExtra: 0,
        expIn: 0,
        expExtra: 0,
        expQty: hasPicagens ? 0 : null,
        faltaExpedir: 0,
        pairs: 0,
      };
      map.set(bucket.key, slot);
    } else if (fromPlan && !slot.hasPlan && !bucket.split) {
      slot.marca = bucket.label;
    }
    return slot;
  };
  for (const row of planRows) {
    const slot = touch(row.marca, row.cliente, row.ref, true);
    if (!slot.hasPlan) slot.objetivo = 0;
    slot.hasPlan = true;
    const goal = expedicaoObjetivo(row);
    const semanaEmb = hasPicagens ? (embByOp.get(row.op) || 0) : 0;
    const semanaExp = hasPicagens ? (expByOp.get(row.op) || 0) : 0;
    const expSplit = embalagemCounted(row.expedido, semanaExp, goal);
    slot.objetivo += goal;
    if (!faltaContada.has(row.op)) {
      faltaContada.add(row.op);
      slot.faltaExpedir += faltaExpedirOf(goalByOp.get(row.op), hasPicagens ? expByOp.get(row.op) : 0);
    }
    slot.jaEmbalado += jaEmbaladoOf(row);
    slot.semanaPlano += semanaEmb;
    slot.expIn += expSplit.total;
    slot.expExtra += Math.max(0, num(row.expedido)) + Math.max(0, semanaExp) - expSplit.total;
    slot.pairs += Math.max(0, num(row.e)) + Math.max(0, num(row.expedido));
  }
  const planByOp = new Map(planRows.map((row) => [row.op, row]));
  if (hasPicagens) {
    const fromPic = new Map();
    for (const row of picRows || []) {
      const known = fromPic.get(row.op) || { cliente: '', ref: '', brand: '' };
      if (!known.cliente && row.cliente) known.cliente = String(row.cliente).trim();
      if (!known.ref && row.ref) known.ref = String(row.ref).trim();
      if (!known.brand && row.brand) known.brand = String(row.brand).trim();
      fromPic.set(row.op, known);
    }
    for (const [op, semana] of embByOp) {
      if (semana <= 0) continue;
      const plan = planByOp.get(op);
      const pic = fromPic.get(op) || { cliente: '', ref: '', brand: '' };
      const goal = plan ? expedicaoObjetivo(plan) : 0;
      const extra = embalagemExtraOp(semana, goal, Boolean(plan));
      const inPlan = plan ? Math.min(Math.max(0, semana), Math.max(0, goal)) : 0;
      const slot = touch(plan?.marca || pic.brand, plan?.cliente || pic.cliente, plan?.ref || pic.ref, Boolean(plan));
      slot.embExtra += extra;
      slot.embIn += inPlan;
      if (!plan) slot.pairs += semana;
    }
    for (const row of picRows || []) {
      const qtd = num(row.qtd);
      if (qtd <= 0 || row.section !== 'exp') continue;
      const slot = touch(row.brand, row.cliente, row.ref, false);
      slot.expQty += qtd;
      if (planOps.has(row.op)) continue;
      slot.expExtra += qtd;
      slot.pairs += qtd;
    }
  }
  return {
    calcado: { id: 'calcado', title: 'Calçado', ...finishMarcaGroup(groups.calcado, hasPicagens) },
    roupa: { id: 'roupa', title: 'Roupa', ...finishMarcaGroup(groups.roupa, hasPicagens) },
    outros: { id: 'outros', title: 'Outros', ...finishMarcaGroup(groups.outros, hasPicagens) },
  };
}

export function extraLines(planRows, embCompare, expCompare, picRows) {
  const planOps = new Map(planRows.map((row) => [row.op, row]));
  const fromPic = new Map();
  for (const row of picRows || []) {
    const slot = fromPic.get(row.op) || { cliente: '', ref: '' };
    if (!slot.cliente && row.cliente) slot.cliente = String(row.cliente).trim();
    if (!slot.ref && row.ref) slot.ref = String(row.ref).trim();
    fromPic.set(row.op, slot);
  }
  const ops = new Set([
    ...embCompare.byOp.keys(),
    ...expCompare.byOp.keys(),
  ]);
  const lines = [];
  for (const op of ops) {
    const plan = planOps.get(op);
    const pic = fromPic.get(op);
    const emb = embCompare.byOp.get(op) || 0;
    const exp = expCompare.byOp.get(op) || 0;
    const goal = plan ? expedicaoObjetivo(plan) : 0;
    const embExtra = embalagemExtraOp(emb, goal, Boolean(plan));
    const expExtra = plan ? Math.max(0, exp - goal) : exp;
    if (embExtra <= 0 && expExtra <= 0) continue;
    lines.push({
      op,
      cliente: plan?.cliente || pic?.cliente || '',
      ref: plan?.ref || pic?.ref || '',
      obs: plan ? plan.obs : null,
      emb,
      exp,
      embExtra,
      expExtra,
      fora: !plan,
    });
  }
  lines.sort((a, b) => b.embExtra + b.expExtra - (a.embExtra + a.expExtra));
  return lines;
}

function emptyDay() {
  return {
    embOn: 0,
    embLate: 0,
    embNone: 0,
    expOn: 0,
    expLate: 0,
    expNone: 0,
    embSmall: 0,
    embLarge: 0,
    expSmall: 0,
    expLarge: 0,
    ops: new Set(),
  };
}

export function dailyPerformance(planByOp, picRows, days, sizeOf, threshold, hasPicagens) {
  const byDay = new Map(days.map((day) => [day, emptyDay()]));
  if (hasPicagens) {
    for (const row of picRows || []) {
      const bucket = byDay.get(row.date);
      if (!bucket) continue;
      const ship = planByOp.get(row.op)?.shipDate || null;
      let timing = 'none';
      if (ship) timing = row.date <= ship ? 'on' : 'late';
      const small = sizeOf(row.op) < threshold;
      const qtd = num(row.qtd);
      if (row.section === 'emb') {
        if (timing === 'on') bucket.embOn += qtd;
        else if (timing === 'late') bucket.embLate += qtd;
        else bucket.embNone += qtd;
        if (small) bucket.embSmall += qtd;
        else bucket.embLarge += qtd;
      } else {
        if (timing === 'on') bucket.expOn += qtd;
        else if (timing === 'late') bucket.expLate += qtd;
        else bucket.expNone += qtd;
        if (small) bucket.expSmall += qtd;
        else bucket.expLarge += qtd;
      }
      bucket.ops.add(row.op);
    }
  }
  return days.map((date) => {
    const bucket = byDay.get(date);
    let smallOps = 0;
    let largeOps = 0;
    if (hasPicagens) {
      for (const op of bucket.ops) {
        if (sizeOf(op) < threshold) smallOps += 1;
        else largeOps += 1;
      }
    }
    return {
      date,
      embOn: hasPicagens ? bucket.embOn : null,
      embLate: hasPicagens ? bucket.embLate : null,
      embNone: hasPicagens ? bucket.embNone : null,
      expOn: hasPicagens ? bucket.expOn : null,
      expLate: hasPicagens ? bucket.expLate : null,
      expNone: hasPicagens ? bucket.expNone : null,
      embSmall: hasPicagens ? bucket.embSmall : null,
      embLarge: hasPicagens ? bucket.embLarge : null,
      expSmall: hasPicagens ? bucket.expSmall : null,
      expLarge: hasPicagens ? bucket.expLarge : null,
      smallOps: hasPicagens ? smallOps : null,
      largeOps: hasPicagens ? largeOps : null,
    };
  });
}

export function buildWeekModel({ planRows, picIndex, year, week, threshold, hasPicagens }) {
  const range = weekRange(year, week);
  const inWeek = planInWeek(planRows, year, week);
  const key = weekKey(year, week);
  const picWeek = hasPicagens ? picIndex.byWeek.get(key) || [] : null;
  const emb = sectionCompare(inWeek, picWeek, 'emb', hasPicagens);
  const exp = sectionCompare(inWeek, picWeek, 'exp', hasPicagens);
  if (!hasPicagens) emb.realizado = 0;
  emb.pct = embalagemAggregatePercent(inWeek, (row) => (hasPicagens ? emb.byOp.get(row.op) || 0 : 0));
  const sizeOf = makeSizeOf(planRows, hasPicagens ? picIndex : { byOp: new Map() });
  const planByOp = new Map(planRows.map((row) => [row.op, row]));
  return {
    key,
    range,
    inWeek,
    picWeek,
    emb,
    exp,
    hasPicagens,
    planTotals: {
      objetivo: inWeek.reduce((sum, row) => sum + expedicaoObjetivo(row), 0),
      embalado: inWeek.reduce((sum, row) => sum + jaEmbaladoOf(row), 0),
      expedido: sumField(inWeek, 'expedido'),
      faltaEmbalar: inWeek.reduce((sum, row) => sum + faltaEmbalarOf(row, hasPicagens ? emb.byOp.get(row.op) : 0), 0),
      faltaExpedir: faltaExpedirPorOps(inWeek, (op) => (hasPicagens ? exp.byOp.get(op) : 0)),
      porEmbalar: sumField(inWeek, 'porEmbalar'),
      gr: sumField(inWeek, 'gr'),
      e: sumField(inWeek, 'e'),
      ops: inWeek.length,
    },
    planSize: splitPlanBySize(inWeek, sizeOf, threshold),
    picSizeEmb: hasPicagens ? splitPicBySize(picWeek, 'emb', sizeOf, threshold) : null,
    picSizeExp: hasPicagens ? splitPicBySize(picWeek, 'exp', sizeOf, threshold) : null,
    cumulative: cumulativeWeek(range.days, inWeek, picWeek, hasPicagens),
    breakdown: brandTipoBreakdown(inWeek, picWeek, hasPicagens),
    extra: hasPicagens ? extraLines(inWeek, emb, exp, picWeek) : null,
    daily: dailyPerformance(planByOp, picWeek, range.days, sizeOf, threshold, hasPicagens),
  };
}

function monthKey(iso) {
  return iso.slice(0, 7);
}

function enumerateWeeks(start, end) {
  let cursor = isoWeekParts(start);
  const out = [];
  for (let i = 0; i < 60; i += 1) {
    const range = weekRange(cursor.year, cursor.week);
    if (range.end >= start && range.start <= end) {
      out.push({ key: weekKey(cursor.year, cursor.week), start: range.start, end: range.end });
    }
    if (range.start > end) break;
    if (range.end >= end && isoWeekParts(end).week === cursor.week && isoWeekParts(end).year === cursor.year) break;
    cursor = shiftWeek(cursor.year, cursor.week, 1);
  }
  return out;
}

function enumerateMonths(start, end) {
  const [y1, m1] = start.split('-').map(Number);
  const [y2, m2] = end.split('-').map(Number);
  const out = [];
  let y = y1;
  let m = m1;
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function buildAcumulados(picRows, year, todayISO) {
  const start = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (todayISO < start) {
    return { start, end: null, empty: true, reason: 'future', weeks: [], months: [], brands: [], tipos: [], tipoProds: [], total: 0 };
  }
  const end = todayISO < yearEnd ? todayISO : yearEnd;
  const rows = (picRows || []).filter((row) => row.section === 'exp' && row.date >= start && row.date <= end);
  const weekSlots = enumerateWeeks(start, end);
  const monthSlots = enumerateMonths(start, end);
  const brands = new Set();
  const tipos = new Set();
  const tipoProds = new Set();
  const weekMap = new Map(weekSlots.map((slot) => [slot.key, { key: slot.key, total: 0, brand: new Map(), tipo: new Map(), tipoProd: new Map() }]));
  const monthMap = new Map(monthSlots.map((key) => [key, { key, total: 0, brand: new Map(), tipo: new Map(), tipoProd: new Map() }]));

  const add = (bucket, field, name, qtd) => {
    const label = (name || '').trim() || '(sem valor)';
    bucket[field].set(label, (bucket[field].get(label) || 0) + qtd);
  };

  for (const row of rows) {
    const qtd = num(row.qtd);
    const wk = weekKeyOfISO(row.date);
    const mk = monthKey(row.date);
    const brand = (row.brand || '').trim() || '(sem marca)';
    const tipo = (row.tipo || '').trim() || '(sem tipo)';
    const tipoProd = (row.tipoProd || '').trim() || '(sem tipo prod)';
    brands.add(brand);
    tipos.add(tipo);
    tipoProds.add(tipoProd);
    const weekBucket = weekMap.get(wk);
    const monthBucket = monthMap.get(mk);
    if (weekBucket) {
      weekBucket.total += qtd;
      add(weekBucket, 'brand', brand, qtd);
      add(weekBucket, 'tipo', tipo, qtd);
      add(weekBucket, 'tipoProd', tipoProd, qtd);
    }
    if (monthBucket) {
      monthBucket.total += qtd;
      add(monthBucket, 'brand', brand, qtd);
      add(monthBucket, 'tipo', tipo, qtd);
      add(monthBucket, 'tipoProd', tipoProd, qtd);
    }
  }

  const sortNames = (setOf, rowsList, field) => {
    const totals = new Map();
    for (const name of setOf) totals.set(name, 0);
    for (const row of rowsList) {
      for (const [name, qtd] of row[field]) totals.set(name, (totals.get(name) || 0) + qtd);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt')).map(([name]) => name);
  };

  const weeks = [...weekMap.values()];
  const months = [...monthMap.values()];
  return {
    start,
    end,
    empty: rows.length === 0,
    reason: rows.length === 0 ? 'none' : '',
    total: rows.reduce((sum, row) => sum + num(row.qtd), 0),
    weeks,
    months,
    brands: sortNames(brands, weeks, 'brand'),
    tipos: sortNames(tipos, weeks, 'tipo'),
    tipoProds: sortNames(tipoProds, weeks, 'tipoProd'),
  };
}

export function stackedFrom(buckets, names, field, limit = 8) {
  const ranked = names.slice();
  const keep = ranked.length > limit ? ranked.slice(0, limit - 1) : ranked;
  const other = ranked.length > limit;
  const series = keep.map((name) => ({
    name,
    values: buckets.map((bucket) => bucket[field].get(name) || 0),
  }));
  if (other) {
    series.push({
      name: 'Outras',
      values: buckets.map((bucket) => {
        let sum = 0;
        for (const [name, qtd] of bucket[field]) {
          if (!keep.includes(name)) sum += qtd;
        }
        return sum;
      }),
    });
  }
  return series;
}
