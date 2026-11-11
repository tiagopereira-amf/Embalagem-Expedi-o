import { useEffect, useMemo, useRef, useState } from 'react';
import planFile from './data/plan.json';
import { AcumuladosView } from './components/AcumuladosView.jsx';
import { DailyView } from './components/DailyView.jsx';
import { HistoricoView } from './components/HistoricoView.jsx';
import { WeekView } from './components/WeekView.jsx';
import { formatDateLong, formatPctInput, isoWeekParts, latestWeekOf, lisbonTodayISO, shiftWeek } from './lib/dates.js';
import { isPublishedPage, loadPublished, savePublished } from './lib/publicar.js';
import { buildWeekModel, indexPicagens } from './lib/metrics.js';
import { clearPicagemFile, loadPicagemFiles, loadHistorico, loadThreshold, saveHistorico, savePicagemFile, saveThreshold } from './lib/storage.js';
import { readPicagens, readShipdate } from './lib/streamPicagens.js';

const TABS = [
  { id: 'semana', label: 'Resumo semanal', icon: 'M5 6.5h14v13H5zM8 4v4M16 4v4M5 10.5h14' },
  { id: 'diaria', label: 'Performance diária', icon: 'M5 19V10M10 19V5M15 19v-7M20 19V8' },
  { id: 'acumulados', label: 'Acumulados', icon: 'M4 16l5-5 4 3 7-8' },
  { id: 'historico', label: 'Histórico semanal', icon: 'M5 6h14M5 12h14M5 18h10' },
];

function formatHeading(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function NavIcon({ d }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const DISK_NOTE_DENIED = 'A permissão para ler o ficheiro no disco foi recusada. Carregue em «Atualizar do disco» para voltar a pedir.';
const DISK_NOTE_API = 'Este browser não relê o ficheiro no disco. A mostrar a cópia guardada.';
const EXCEL_TYPES = [
  {
    description: 'Livro Excel',
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
    },
  },
];

function emptySlot() {
  return { status: 'empty', name: '', phase: '', pct: 0, error: '', hash: '', rows: [], stats: null, restoring: false, note: '', disk: false };
}

function diskPickerAvailable() {
  return typeof window.showOpenFilePicker === 'function';
}

function restoreNote(slots) {
  const notes = [slots.emb.note, slots.plan.note].filter(Boolean);
  if (notes.includes(DISK_NOTE_DENIED)) return DISK_NOTE_DENIED;
  return notes[0] || '';
}

function fileForRestore(record) {
  const api = diskPickerAvailable();
  if (record.bytes == null) return { file: null, note: '', disk: Boolean(api && record.handle) };
  const file = new File([record.bytes], record.name || 'picagens.xlsx', { type: record.type || '' });
  if (!api) return { file, note: DISK_NOTE_API, disk: false };
  return { file, note: '', disk: true };
}

async function sha256(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseWithWorker(buffer, onProgress, onRows) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/picagens.worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('worker-timeout'));
    }, 5 * 60 * 1000);
    const finish = (error, result) => {
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress') onProgress(data);
      else if (data.type === 'rows') onRows(data.rows || []);
      else if (data.type === 'done') finish(null, data);
      else if (data.type === 'error') finish(new Error(data.message || 'erro na leitura'));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish(new Error(event?.message || 'worker-died'));
    };
    const copy = buffer.slice(0);
    worker.postMessage({ buffer: copy, fail: globalThis.__EMBEXP_FAIL_WORKER__ === true }, [copy]);
  });
}

function takeRows(target, rows) {
  for (let i = 0; i < rows.length; i += 1) target.push(rows[i]);
}

export function App() {
  const today = useMemo(() => lisbonTodayISO(), []);
  const current = useMemo(() => isoWeekParts(today), [today]);
  const [year, setYear] = useState(current.year);
  const [week, setWeek] = useState(current.week);
  const [tab, setTab] = useState('semana');
  const [threshold, setThreshold] = useState(() => loadThreshold());
  const [historico, setHistorico] = useState(() => loadHistorico());
  const [histNote, setHistNote] = useState('');
  const [query, setQuery] = useState('');
  const [published, setPublished] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const publishingRef = useRef(false);
  const [slots, setSlots] = useState({ emb: emptySlot(), plan: emptySlot() });
  const slotsRef = useRef(slots);
  const pendingRef = useRef({ emb: false, plan: false });
  slotsRef.current = slots;
  if (!(slots.emb.restoring || slots.emb.status === 'reading' || slots.emb.status === 'parsing')) pendingRef.current.emb = false;
  if (!(slots.plan.restoring || slots.plan.status === 'reading' || slots.plan.status === 'parsing')) pendingRef.current.plan = false;
  const parseToken = useRef({ emb: 0, plan: 0 });
  const onFileRef = useRef(null);
  const diskHandles = useRef({ emb: null, plan: null });

  const merged = useMemo(() => {
    const rows = slots.emb.status === 'ready' && slots.emb.rows?.length ? slots.emb.rows : [];
    let embLines = 0;
    let expLines = 0;
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].section === 'emb') embLines += 1;
      else if (rows[i].section === 'exp') expLines += 1;
    }
    return {
      rows,
      hasPicagens: slots.emb.status === 'ready',
      embLines,
      expLines,
    };
  }, [slots.emb]);

  const planRows = slots.plan.status === 'ready' && slots.plan.rows?.length ? slots.plan.rows : planFile.rows;
  const picIndex = useMemo(() => indexPicagens(merged.rows), [merged.rows]);
  const model = useMemo(
    () => buildWeekModel({
      planRows,
      picIndex,
      year,
      week,
      threshold,
      hasPicagens: merged.hasPicagens,
    }),
    [planRows, picIndex, year, week, threshold, merged.hasPicagens],
  );

  function moveWeek(delta) {
    const next = shiftWeek(year, week, delta);
    setYear(next.year);
    setWeek(next.week);
  }

  function onThreshold(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return;
    setThreshold(n);
    saveThreshold(n);
  }

  function updateSlot(key, patch) {
    setSlots((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  async function onFile(key, file, options = {}) {
    if (!file) return;
    const persist = options.persist !== false;
    pendingRef.current[key] = true;
    const token = (parseToken.current[key] += 1);
    const current = () => parseToken.current[key] === token;
    if (options.handle) diskHandles.current[key] = options.handle;
    if (persist) savePicagemFile(key, file, options.handle || diskHandles.current[key] || null).catch(() => {});
    updateSlot(key, {
      status: 'reading',
      name: file.name,
      phase: persist ? 'A ler o ficheiro' : 'A repor o ficheiro',
      pct: persist ? 8 : 6,
      error: '',
      rows: [],
      stats: null,
      hash: '',
      restoring: !persist,
      note: options.note || '',
      disk: options.disk ?? diskPickerAvailable(),
    });
    try {
      if (!persist) {
        await new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0));
        });
        if (!current()) return;
      }
      const buffer = await file.arrayBuffer();
      if (!current()) return;
      updateSlot(key, { pct: 20, phase: 'A confirmar o ficheiro' });
      const hash = await sha256(buffer);
      if (!current()) return;
      if (key === 'plan') {
        updateSlot(key, { status: 'parsing', pct: 40, phase: 'A ler a folha SHIPDATE', hash });
        const plan = await readShipdate(buffer, (progress) => {
          if (!current()) return;
          updateSlot(key, { pct: progress.pct, phase: progress.phase, status: 'parsing' });
        });
        if (!current()) return;
        updateSlot(key, {
          status: 'ready',
          pct: 100,
          phase: 'Pronto',
          rows: plan.rows,
          stats: plan.stats,
          error: '',
          hash,
          restoring: false,
        });
        const latest = latestWeekOf(plan.rows.map((row) => row.shipDate));
        if (latest) {
          setYear(latest.year);
          setWeek(latest.week);
        }
        return;
      }
      updateSlot(key, { status: 'parsing', pct: 30, phase: 'A analisar a folha BD', hash });
      const collected = [];
      let onPage = false;
      const onProgress = (progress) => {
        if (!current()) return;
        const phase = onPage ? `A ler nesta página · ${progress.phase}` : progress.phase;
        updateSlot(key, { pct: progress.pct, phase, status: 'parsing' });
      };
      let result;
      let recovered = false;
      const forceMain = globalThis.__EMBEXP_FORCE_MAIN__ === true;
      if (!forceMain) {
        try {
          result = await parseWithWorker(buffer, onProgress, (rows) => takeRows(collected, rows));
        } catch {
          collected.length = 0;
          recovered = true;
          onPage = true;
          if (!current()) return;
          updateSlot(key, {
            status: 'parsing',
            pct: 32,
            recovered: true,
            phase: 'A ler nesta página · o leitor em segundo plano falhou',
          });
          result = await readPicagens(buffer, onProgress, (rows) => takeRows(collected, rows), { yieldToMain: true });
        }
      } else {
        recovered = true;
        onPage = true;
        result = await readPicagens(buffer, onProgress, (rows) => takeRows(collected, rows), { yieldToMain: true });
      }
      if (!current()) return;
      updateSlot(key, {
        status: 'ready',
        pct: 100,
        phase: 'Pronto',
        rows: collected,
        stats: result.stats,
        error: '',
        recovered,
        restoring: false,
      });
      const latest = latestWeekOf(collected.map((row) => row.date));
      if (latest) {
        setYear(latest.year);
        setWeek(latest.week);
      }
    } catch (error) {
      if (!current()) return;
      updateSlot(key, {
        status: 'error',
        error: error?.message || (key === 'plan'
          ? 'Não foi possível ler a folha SHIPDATE. Continua o plano incluído.'
          : 'Não foi possível ler o ficheiro. O plano SHIPDATE mantém-se.'),
        pct: 0,
        rows: [],
        stats: null,
        restoring: false,
      });
    }
  }

  onFileRef.current = onFile;

  async function pickDisk(key) {
    if (!diskPickerAvailable()) return;
    let handle;
    try {
      const handles = await window.showOpenFilePicker({ multiple: false, types: EXCEL_TYPES });
      handle = handles && handles[0];
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      return;
    }
    if (!handle) return;
    diskHandles.current[key] = handle;
    let file;
    try {
      file = await handle.getFile();
    } catch {
      return;
    }
    await onFile(key, file, { handle, note: '' });
  }

  async function refreshFromDisk(only) {
    const keys = ['emb', 'plan'].filter((key) => key === only && (slots[key].disk || diskHandles.current[key]));
    for (const key of keys) {
      const handle = diskHandles.current[key];
      const usable = handle && typeof handle.requestPermission === 'function' && typeof handle.getFile === 'function';
      if (!usable) {
        await pickDisk(key);
        continue;
      }
      try {
        const permission = await handle.requestPermission({ mode: 'read' });
        if (permission !== 'granted') {
          updateSlot(key, { note: DISK_NOTE_DENIED });
          continue;
        }
        let file;
        try {
          file = await handle.getFile();
        } catch (error) {
          if (error?.name === 'AbortError') return;
          await pickDisk(key);
          continue;
        }
        if (!file) {
          await pickDisk(key);
          continue;
        }
        await onFile(key, file, { handle, note: '' });
      } catch (error) {
        if (error?.name === 'AbortError') return;
        if (error?.name === 'NotAllowedError') {
          updateSlot(key, { note: DISK_NOTE_DENIED });
          continue;
        }
        await pickDisk(key);
      }
    }
  }

  useEffect(() => {
    if (isPublishedPage()) return undefined;
    let alive = true;
    (async () => {
      let saved;
      try {
        saved = await loadPicagemFiles();
      } catch {
        return;
      }
      if (!alive) return;
      const pending = [];
      for (const key of ['emb', 'plan']) {
        const record = saved[key];
        if (!record || (record.bytes == null && record.handle == null)) continue;
        updateSlot(key, {
          status: 'reading',
          name: record.name,
          phase: 'A repor o ficheiro',
          pct: 4,
          error: '',
          rows: [],
          stats: null,
          hash: '',
          restoring: true,
          note: '',
        });
        pending.push([key, record]);
      }
      if (!pending.length || !alive) return;
      await new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 0));
      });
      if (!alive) return;
      for (const [key, record] of pending) {
        if (!alive) return;
        const seen = parseToken.current[key];
        diskHandles.current[key] = record.handle || null;
        const chosen = fileForRestore(record);
        if (!alive || parseToken.current[key] !== seen) continue;
        if (!chosen?.file) {
          updateSlot(key, {
            ...emptySlot(),
            name: record.name || '',
            disk: chosen?.disk || false,
          });
          continue;
        }
        await onFileRef.current(key, chosen.file, { persist: false, note: chosen.note, disk: chosen.disk });
      }
    })();
    return () => {
      alive = false;
      parseToken.current.emb += 1;
      parseToken.current.plan += 1;
    };
  }, []);

  function clearSlot(key) {
    pendingRef.current[key] = false;
    parseToken.current[key] += 1;
    diskHandles.current[key] = null;
    updateSlot(key, emptySlot());
    clearPicagemFile(key).catch(() => {});
  }

  function updateHist(id, field, value) {
    setHistorico((current) => {
      const next = current.map((row) => (row.id === id ? { ...row, [field]: value } : row));
      saveHistorico(next);
      return next;
    });
  }

  function removeHist(id) {
    setHistorico((current) => {
      const next = current.filter((row) => row.id !== id);
      saveHistorico(next);
      return next;
    });
  }

  function gravarSemana() {
    const embText = model.emb.pct == null ? null : formatPctInput(model.emb.pct);
    const expText = model.exp.pct == null ? null : formatPctInput(model.exp.pct);
    setHistorico((current) => {
      const next = current.map((row) => ({ ...row }));
      let row = next.find((item) => item.semana === model.key);
      if (!row) {
        row = {
          id: crypto.randomUUID(),
          semana: model.key,
          embalagem: '',
          expedicao: '',
          afinado: '',
          observacao: '',
        };
        next.push(row);
      }
      if (embText != null) row.embalagem = embText;
      if (expText != null) row.expedicao = expText;
      next.sort((a, b) => b.semana.localeCompare(a.semana, 'pt'));
      saveHistorico(next);
      return next;
    });
    if (embText == null && expText == null) {
      setHistNote(`Semana ${model.key} aberta. Sem percentagem calculada: faltam picagens ou o objetivo é 0. As células de cumprimento que já existiam não foram alteradas.`);
    } else {
      setHistNote(`Semana ${model.key} gravada. O afinado e a observação, se já tinham texto, mantêm-se.`);
    }
    setTab('historico');
  }

  useEffect(() => {
    let cancel = false;
    loadPublished()
      .then((payload) => {
        if (cancel || !payload?.published) return;
        setPublished({ at: payload.at, label: payload.label });
        if (!isPublishedPage()) return;
        if (Number.isFinite(payload.year)) setYear(payload.year);
        if (Number.isFinite(payload.week)) setWeek(payload.week);
        if (payload.planFromFile && payload.planRows?.length) {
          updateSlot('plan', {
            status: 'ready',
            name: 'Semana publicada',
            phase: 'Pronto',
            pct: 100,
            error: '',
            rows: payload.planRows,
            stats: null,
            hash: '',
            restoring: false,
            note: '',
          });
        }
        if (payload.hasPicagens) {
          updateSlot('emb', {
            status: 'ready',
            name: 'Semana publicada',
            phase: 'Pronto',
            pct: 100,
            error: '',
            rows: payload.picagens || [],
            stats: null,
            hash: '',
            restoring: false,
            note: '',
          });
        }
      })
      .catch(() => {});
    return () => { cancel = true; };
  }, []);

  function workbookPending(slot) {
    return slot.restoring || slot.status === 'reading' || slot.status === 'parsing';
  }

  function readyToPublish() {
    const { emb, plan } = slotsRef.current;
    if (pendingRef.current.emb || pendingRef.current.plan) return false;
    if (workbookPending(emb) || workbookPending(plan)) return false;
    return true;
  }

  async function publishNow() {
    if (publishingRef.current || !readyToPublish()) return;
    const { emb, plan } = slotsRef.current;
    const planFromFile = plan.status === 'ready' && plan.rows?.length;
    const hasPicagens = emb.status === 'ready';
    publishingRef.current = true;
    setPublishing(true);
    setPublishError('');
    try {
      const payload = await savePublished({
        year,
        week,
        planFromFile: Boolean(planFromFile),
        hasPicagens,
        planRows: planFromFile ? plan.rows : planFile.rows,
        picagens: hasPicagens ? (emb.rows || []).map((row) => ({
          op: row.op,
          section: row.section,
          qtd: row.qtd,
          date: row.date,
          cliente: row.cliente || '',
          ref: row.ref || '',
          brand: row.brand || '',
        })) : [],
      });
      setPublished({ at: payload.at, label: payload.label });
    } catch {
      setPublishError('Não foi possível gravar a semana.');
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  function onPublish() {
    if (tab !== 'semana') setTab('semana');
    const started = performance.now();
    const attempt = () => {
      if (readyToPublish()) {
        publishNow();
        return;
      }
      if (performance.now() - started > 120000) {
        setPublishError('Não foi possível gravar a cópia.');
        return;
      }
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }

  const pageTitle = TABS.find((item) => item.id === tab)?.label || 'Embalagem e expedição';
  const picTotal = merged.embLines + merged.expLines;
  const chip = merged.hasPicagens
    ? `${picTotal.toLocaleString('pt-PT')} picagens`
    : 'Sem picagens';

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="mark" aria-hidden="true">E</span>
          <div>
            <strong>Embalagem</strong>
            <small>e expedição</small>
          </div>
        </div>
        <div className="who">
          <span className="avatar" aria-hidden="true">TP</span>
          <div>
            <strong>Tiago Pereira</strong>
            <small>Plano SHIPDATE</small>
          </div>
          <span className="role">Embalagem e expedição</span>
        </div>
        <nav className="nav" role="tablist" aria-label="Vistas">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={tab === item.id ? 'on' : ''}
              onClick={() => setTab(item.id)}
            >
              <NavIcon d={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="side-files">
          <Picker slot="emb" label="Ficheiro embalamento/expedição" hint="folha BD, com as duas secções" state={slots.emb} onFile={onFile} onPick={pickDisk} onRefresh={refreshFromDisk} onClear={() => clearSlot('emb')} />
          <Picker slot="plan" label="Ficheiro SHIPDATE" hint="folha SHIPDATE, substitui o plano incluído" state={slots.plan} onFile={onFile} onPick={pickDisk} onRefresh={refreshFromDisk} onClear={() => clearSlot('plan')} />
        </div>
      </aside>

      <div className="main">
      {isPublishedPage() ? (
        <p className="banner">Já embalado = E − GR. O balão chama-se «Embalado esta semana (plano)».{published?.label ? ` Actualizado ${published.label}.` : ''}</p>
      ) : null}
      <header className="topbar">
        <time dateTime={today}>{formatHeading(today)}</time>
        <div className="topbar-actions">
          <div className="publish">
            <button type="button" data-testid="publicar" onClick={onPublish} disabled={publishing}>
              {publishing ? 'A publicar…' : 'Publicar'}
            </button>
            <a className="publish-link" href="/publicado.html" data-testid="link-publicado">Abrir a cópia publicada</a>
            <span className="publish-hint">Publicar grava esta semana na página publicada.</span>
            {published ? (
              <time dateTime={published.at} data-testid="publicado-em">{published.label}</time>
            ) : null}
            {publishError ? <span className="publish-error" role="alert">{publishError}</span> : null}
          </div>
          <span className="chip" data-metric="ops" data-value={String(model.planTotals.ops)}>{chip}</span>
        </div>
      </header>

      {slots.emb.error || slots.plan.error ? (
        <p className="banner danger" role="alert">{slots.emb.error || slots.plan.error}</p>
      ) : null}
      {(slots.emb.restoring || slots.plan.restoring) && !merged.hasPicagens ? (
        <p className="banner" data-testid="repor-ficheiro">A repor o ficheiro</p>
      ) : restoreNote(slots) && !(slots.emb.error || slots.plan.error) ? (
        <p className="banner" data-testid="copia-guardada">{restoreNote(slots)}</p>
      ) : !merged.hasPicagens ? (
        <p className="banner">
          O plano já está visível. Para o realizado, escolha um .xlsx ou .xlsm com a folha BD. Se tiver EMB.Embalagem e EMB.Expedicao, basta um ficheiro.
        </p>
      ) : (
        <p className="banner ready">
          Picagens carregadas: {merged.embLines.toLocaleString('pt-PT')} linhas de embalagem e {merged.expLines.toLocaleString('pt-PT')} de expedição.
        </p>
      )}

      <div
        data-snapshot={tab === 'semana' ? 'semana' : undefined}
        data-plano={slots.plan.status === 'ready' && slots.plan.rows?.length ? 'ficheiro' : 'incluido'}
        data-picagens={merged.hasPicagens ? 'sim' : 'nao'}
      >
      <h1 className="page-title">{pageTitle}</h1>

      {tab !== 'acumulados' ? (
        <div className="filters">
          <button type="button" className="step" onClick={() => moveWeek(-1)} aria-label="Semana anterior">←</button>
          <label>
            Semana
            <input
              type="number"
              min="1"
              max="53"
              value={week}
              data-testid="semana"
              onChange={(event) => {
                const n = Number(event.target.value);
                if (n >= 1 && n <= 53) setWeek(n);
              }}
            />
          </label>
          <label>
            Ano
            <input
              type="number"
              value={year}
              data-testid="ano-semana"
              onChange={(event) => {
                const n = Number(event.target.value);
                if (n >= 2000 && n <= 2100) setYear(n);
              }}
            />
          </label>
          <label>
            Encomenda pequena abaixo de
            <input
              type="number"
              min="1"
              step="1"
              value={threshold}
              data-testid="limiar"
              onChange={(event) => onThreshold(event.target.value)}
            />
          </label>
          <button type="button" className="step" onClick={() => moveWeek(1)} aria-label="Semana seguinte">→</button>
          <span className="range">{formatDateLong(model.range.start)} – {formatDateLong(model.range.end)}</span>
          {week !== current.week || year !== current.year ? (
            <button type="button" className="ghost" onClick={() => { setYear(current.year); setWeek(current.week); }}>
              Semana atual
            </button>
          ) : null}
        </div>
      ) : null}

      {tab === 'semana' ? (
        <WeekView model={model} threshold={threshold} query={query} setQuery={setQuery} today={today} />
      ) : null}
      </div>
      {tab === 'diaria' ? <DailyView model={model} threshold={threshold} today={today} /> : null}
      {tab === 'acumulados' ? <AcumuladosView rows={merged.rows} hasPicagens={merged.hasPicagens} today={today} /> : null}
      {tab === 'historico' ? (
        <HistoricoView
          rows={historico}
          onChange={updateHist}
          onDelete={removeHist}
          onSave={gravarSemana}
          note={histNote}
          weekKey={model.key}
        />
      ) : null}
      </div>
    </div>
  );
}

function Picker({ slot, label, hint, state, onFile, onPick, onRefresh, onClear }) {
  const disk = diskPickerAvailable();
  return (
    <div className={`picker ${state.status}`} data-status={state.status} data-phase={state.phase || ''}>
      <span>{label}</span>
      {disk ? (
        <button type="button" className="choose" data-slot={slot} onClick={() => onPick(slot)}>
          Escolher ficheiro
        </button>
      ) : (
        <label className="choose">
          Escolher ficheiro
          <input
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
            data-slot={slot}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) onFile(slot, file);
            }}
          />
        </label>
      )}
      <small>{hint}</small>
      {state.name ? <strong className="file-name" data-testid={`nome-${slot}`}>{state.name}</strong> : <em className="file-none">Nenhum ficheiro escolhido</em>}
      {state.status === 'reading' || state.status === 'parsing' ? (
        <span className="progress" aria-live="polite">
          <i style={{ width: `${state.pct}%` }} />
          <em>{state.phase} · {state.pct}%</em>
        </span>
      ) : null}
      {state.status === 'ready' && state.stats ? (
        <em className="file-stats">
          {slot === 'plan'
            ? `${Number(state.stats.ops || 0).toLocaleString('pt-PT')} OPs na folha SHIPDATE`
            : `${state.stats.embalagem.toLocaleString('pt-PT')} embalagem · ${state.stats.expedicao.toLocaleString('pt-PT')} expedição · ${(state.stats.ignoredSection + state.stats.ignoredIncomplete).toLocaleString('pt-PT')} ignoradas`}
          {state.recovered ? ' · lido nesta página' : ''}
        </em>
      ) : null}
      {state.status === 'error' ? <em className="file-error">{state.error}</em> : null}
      {state.disk && state.status !== 'reading' && state.status !== 'parsing' ? (
        <button type="button" className="ghost" data-testid={`atualizar-${slot}`} onClick={() => onRefresh(slot)}>
          Atualizar do disco
        </button>
      ) : null}
      {state.status !== 'empty' ? (
        <button
          type="button"
          className="ghost"
          onClick={(event) => {
            event.preventDefault();
            onClear();
          }}
        >
          Limpar
        </button>
      ) : null}
    </div>
  );
}
