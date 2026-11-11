import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(root, 'publicado-dados.json');
const PUBLIC_FILE = join(root, 'public', 'semana-publicada.json');
const PLAN_FILE = join(root, 'src', 'data', 'plan.json');
const INDEX_HTML = join(root, 'index.html');
const CONFIG_FILE = join(root, 'ficheiros.local.json');
const BD_SCRIPT = join(root, 'scripts', 'atualizar-bd.ps1');

const localDesk = process.env.PUBLICAR_LOCAL === '1';
const publishToken = localDesk ? randomBytes(32).toString('hex') : '';

function readBody(req, limit = 80_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('size'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isLoopback(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function localWriteAllowed(req) {
  if (!localDesk || !publishToken || !isLoopback(req)) return false;
  return req.headers['x-publicar-token'] === publishToken;
}

async function sourceVersion() {
  const hash = createHash('sha1');
  async function walk(dir) {
    const names = await readdir(dir);
    names.sort();
    for (const name of names) {
      const path = join(dir, name);
      const info = await stat(path);
      if (info.isDirectory()) await walk(path);
      else {
        hash.update(path);
        hash.update(String(info.mtimeMs));
      }
    }
  }
  await walk(join(root, 'src'));
  return hash.digest('hex').slice(0, 12);
}

async function appHtml() {
  const version = await sourceVersion();
  const html = await readFile(INDEX_HTML, 'utf8');
  return html.replace('/src/main.jsx', `/src/main.jsx?v=${version}`);
}

async function readJsonFile(file) {
  const raw = await readFile(file, 'utf8');
  const data = JSON.parse(raw);
  if (!data?.at) return null;
  return data;
}

async function readPublished() {
  for (const file of [DATA_FILE, PUBLIC_FILE]) {
    try {
      const data = await readJsonFile(file);
      if (data) return data;
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return { published: false };
}

function assertData(data) {
  if (!data || typeof data !== 'object') throw new Error('json');
  if (!Number.isFinite(Number(data.year)) || !Number.isFinite(Number(data.week))) throw new Error('semana');
  if (!Array.isArray(data.planRows) || !Array.isArray(data.picagens)) throw new Error('dados');
  if (JSON.stringify(data).length > 80_000_000) throw new Error('size');
}

async function writeOne(file, body) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, body, 'utf8');
  try {
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function writeData(data) {
  const body = JSON.stringify(data);
  await writeOne(DATA_FILE, body);
  await writeOne(PUBLIC_FILE, body);
}

let bdRefresh = Promise.resolve();

function excelMessage(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (/access is denied|being used|locked|permission|partilhad|utilizado por outro|in use/i.test(text)) {
    return 'Feche o ficheiro BD no Excel. Ele está aberto e não pode ser atualizado.';
  }
  if (/não está neste caminho|em falta|não terminou a atualização/i.test(text)) return text.slice(0, 180);
  return 'Não foi possível abrir e atualizar o ficheiro BD no Excel.';
}

function assertBdPath(input) {
  const text = String(input || '').trim();
  if (!text || /[\0\r\n]/.test(text)) throw new Error('Indique o caminho completo do ficheiro BD.');
  const ext = extname(text).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xlsm') throw new Error('O ficheiro BD tem de ser .xlsx ou .xlsm.');
  if (!isAbsolute(text)) throw new Error('Use o caminho completo, por exemplo C:\\Dados\\picagens.xlsx.');
  return normalize(text);
}

async function readLocalConfig() {
  try {
    const data = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    throw error;
  }
}

async function savedBdPath() {
  const config = await readLocalConfig();
  if (!config.emb) return '';
  return assertBdPath(config.emb);
}

async function saveBdPath(input) {
  const filePath = assertBdPath(input);
  let info;
  try {
    info = await stat(filePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('Não encontrei o ficheiro BD nesse caminho.');
    throw new Error('Não foi possível abrir o ficheiro BD nesse caminho.');
  }
  if (!info.isFile()) throw new Error('O caminho do ficheiro BD não é um ficheiro.');
  const config = await readLocalConfig();
  config.emb = filePath;
  await writeOne(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`);
  return { path: filePath, name: basename(filePath) };
}

function refreshWithExcel(filePath) {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('A atualização do ficheiro BD em segundo plano usa o Excel e só corre no Windows.'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', BD_SCRIPT,
    ], {
      windowsHide: true,
      env: { ...process.env, EMBEXP_BD_PATH: filePath },
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('A atualização do ficheiro BD demorou demasiado e foi interrompida.'));
    }, 180000);
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-2000);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('Não foi possível abrir o Excel neste computador.'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(excelMessage(stderr)));
    });
  });
}

function refreshSavedBd() {
  const run = bdRefresh.then(async () => {
    const filePath = await savedBdPath();
    if (!filePath) throw new Error('Indique o caminho do ficheiro BD neste computador.');
    await refreshWithExcel(filePath);
    const info = await stat(filePath);
    return { ok: true, path: filePath, name: basename(filePath), size: info.size, mtimeMs: info.mtimeMs };
  }, async () => {
    const filePath = await savedBdPath();
    if (!filePath) throw new Error('Indique o caminho do ficheiro BD neste computador.');
    await refreshWithExcel(filePath);
    const info = await stat(filePath);
    return { ok: true, path: filePath, name: basename(filePath), size: info.size, mtimeMs: info.mtimeMs };
  });
  bdRefresh = run.then(() => undefined, () => undefined);
  return run;
}

function sendFile(res, filePath) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('cache-control', 'no-store');
  const stream = createReadStream(filePath);
  stream.on('error', () => {
    if (res.headersSent || res.writableEnded) return;
    sendJson(res, 404, { error: 'Não foi possível ler o ficheiro BD atualizado.' });
  });
  stream.pipe(res);
}

async function handleBd(req, res, path) {
  if (path === '/api/ficheiro-bd' && req.method === 'PUT') {
    const body = JSON.parse(await readBody(req, 8000));
    const saved = await saveBdPath(body?.path);
    sendJson(res, 200, saved);
    return;
  }
  if (path === '/api/ficheiro-bd/atualizar' && req.method === 'POST') {
    const saved = await refreshSavedBd();
    sendJson(res, 200, saved);
    return;
  }
  if (path === '/api/ficheiro-bd' && req.method === 'GET') {
    const filePath = await savedBdPath();
    if (!filePath) throw new Error('Indique o caminho do ficheiro BD neste computador.');
    sendFile(res, filePath);
    return;
  }
  res.statusCode = 404;
  res.end('');
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(payload));
}

export function publicadoPlugin() {
  return {
    name: 'publicado-app',
    transformIndexHtml: {
      handler(html, ctx) {
        let next = html;
        if (ctx.server && publishToken) {
          next = next.replace('</head>', `<meta name="publicar-local" content="${publishToken}" />\n</head>`);
        }
        if (!ctx.server) return next;
        return sourceVersion().then((version) => next.replace('/src/main.jsx', `/src/main.jsx?v=${version}`));
      },
    },
    async closeBundle() {
      const index = join(root, 'dist', 'index.html');
      const html = await readFile(index, 'utf8');
      await writeFile(join(root, 'dist', 'publicado.html'), html);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path === '/publicado.html') {
          appHtml()
            .then((html) => {
              res.setHeader('content-type', 'text/html; charset=utf-8');
              res.setHeader('cache-control', 'no-store, no-cache, must-revalidate');
              res.setHeader('pragma', 'no-cache');
              res.end(html);
            })
            .catch(() => next());
          return;
        }
        if (localDesk && path === '/api/plano-local') {
          if (req.method !== 'GET' || !isLoopback(req)) {
            sendJson(res, 404, { rows: [] });
            return;
          }
          readFile(PLAN_FILE, 'utf8')
            .then((raw) => {
              const data = JSON.parse(raw);
              sendJson(res, 200, { rows: Array.isArray(data?.rows) ? data.rows : [] });
            })
            .catch((error) => {
              if (error && error.code === 'ENOENT') {
                sendJson(res, 200, { rows: [] });
                return;
              }
              sendJson(res, 404, { rows: [] });
            });
          return;
        }
        if (localDesk && (path === '/api/ficheiro-bd' || path === '/api/ficheiro-bd/atualizar')) {
          if (!localWriteAllowed(req)) {
            res.statusCode = 404;
            res.end('');
            return;
          }
          handleBd(req, res, path).catch((error) => {
            if (res.headersSent || res.writableEnded) return;
            sendJson(res, 400, { ok: false, error: error?.message || 'Não foi possível atualizar o ficheiro BD.' });
          });
          return;
        }
        if (path !== '/api/publicar') return next();
        (async () => {
          if (req.method === 'GET') {
            const payload = await readPublished();
            sendJson(res, 200, payload);
            return;
          }
          if (req.method !== 'POST' || !localWriteAllowed(req)) {
            res.statusCode = 404;
            res.end('');
            return;
          }
          const data = JSON.parse(await readBody(req));
          assertData(data);
          const stored = {
            published: true,
            at: new Date().toISOString(),
            label: String(data.label || ''),
            year: Number(data.year),
            week: Number(data.week),
            planFromFile: Boolean(data.planFromFile),
            hasPicagens: Boolean(data.hasPicagens),
            planRows: data.planRows,
            picagens: data.picagens,
          };
          await writeData(stored);
          sendJson(res, 200, { published: true, at: stored.at, label: stored.label });
        })().catch(() => {
          if (res.headersSent || res.writableEnded) return;
          sendJson(res, 400, { published: false, error: 'Não foi possível gravar a semana.' });
        });
      });
    },
  };
}
