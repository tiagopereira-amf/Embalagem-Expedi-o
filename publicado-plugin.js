import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(root, 'publicado-dados.json');
const PUBLIC_FILE = join(root, 'public', 'semana-publicada.json');
const PLAN_FILE = join(root, 'src', 'data', 'plan.json');
const INDEX_HTML = join(root, 'index.html');

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
