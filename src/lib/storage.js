const HIST_KEY = 'embexp.historico.v1';
const THRESH_KEY = 'embexp.limiar.v1';

export function loadThreshold() {
  try {
    const raw = localStorage.getItem(THRESH_KEY);
    if (raw == null || raw === '') return 20;
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) return 20;
    return n;
  } catch {
    return 20;
  }
}

export function saveThreshold(value) {
  try {
    localStorage.setItem(THRESH_KEY, String(value));
  } catch {
    /* o browser pode bloquear o armazenamento; a sessão continua */
  }
}

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || row.semana || crypto.randomUUID());
  return {
    id,
    semana: String(row.semana ?? ''),
    embalagem: row.embalagem == null ? '' : String(row.embalagem),
    expedicao: row.expedicao == null ? '' : String(row.expedicao),
    afinado: row.afinado == null ? '' : String(row.afinado),
    observacao: row.observacao == null ? '' : String(row.observacao),
  };
}

export function loadHistorico() {
  try {
    const raw = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map(normalizeRow).filter(Boolean);
  } catch {
    return [];
  }
}

export function saveHistorico(rows) {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(rows));
  } catch {
    /* igual ao limiar: falha silenciosa, o ecrã mantém o que está escrito */
  }
}

const FILE_DB = 'embexp.picagens.v1';
const FILE_STORE = 'ficheiros';
const FILE_SLOTS = ['emb', 'plan'];
const fileQueue = { emb: Promise.resolve(), plan: Promise.resolve() };

function enqueueFile(slot, job) {
  const run = fileQueue[slot].then(job, job);
  fileQueue[slot] = run.then(() => undefined, () => undefined);
  return run;
}

function openFileDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB'));
      return;
    }
    const request = indexedDB.open(FILE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB'));
  });
}

function finishRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB'));
  });
}

function writeRecord(slot, record) {
  return openFileDb().then((db) => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      try { db.close(); } catch { /* a ligação já fechou */ }
      if (error) reject(error);
      else resolve();
    };
    const tx = db.transaction(FILE_STORE, 'readwrite');
    tx.oncomplete = () => finish();
    tx.onerror = (event) => {
      event.preventDefault();
      finish(tx.error || new Error('indexedDB'));
    };
    tx.onabort = () => finish(tx.error || new Error('indexedDB'));
    try {
      tx.objectStore(FILE_STORE).put(record, slot);
    } catch (error) {
      try { tx.abort(); } catch { /* a transação já não aceita o registo */ }
      finish(error);
    }
  }));
}

export function savePicagemFile(slot, file, handle = null) {
  if (!FILE_SLOTS.includes(slot) || !file) return Promise.resolve();
  return enqueueFile(slot, async () => {
    const buffer = await file.arrayBuffer();
    const bytes = new File([buffer], file.name || 'picagens.xlsx', { type: file.type || '' });
    const record = {
      name: bytes.name,
      type: bytes.type || '',
      size: bytes.size || 0,
      bytes,
      handle: handle || null,
    };
    try {
      await writeRecord(slot, record);
    } catch (error) {
      if (!handle) throw error;
      await writeRecord(slot, { ...record, handle: null });
    }
  });
}

export function clearPicagemFile(slot) {
  if (!FILE_SLOTS.includes(slot)) return Promise.resolve();
  return enqueueFile(slot, async () => {
    const db = await openFileDb();
    try {
      const tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).delete(slot);
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('indexedDB'));
        tx.onabort = () => reject(tx.error || new Error('indexedDB'));
      });
    } finally {
      db.close();
    }
  });
}

export async function loadPicagemFiles() {
  const db = await openFileDb();
  try {
    const tx = db.transaction(FILE_STORE, 'readonly');
    const store = tx.objectStore(FILE_STORE);
    const records = await Promise.all(FILE_SLOTS.map(async (slot) => {
      const value = await finishRequest(store.get(slot));
      if (!value || (value.bytes == null && value.handle == null)) return null;
      return [slot, {
        name: String(value.name || 'picagens.xlsx'),
        type: String(value.type || ''),
        size: Number(value.size) || 0,
        bytes: value.bytes ?? null,
        handle: value.handle ?? null,
      }];
    }));
    return Object.fromEntries(records.filter(Boolean));
  } finally {
    db.close();
  }
}
