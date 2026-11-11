import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(root, 'publicado-dados.json');
const INDEX_HTML = join(root, 'index.html');

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

async function readPublished() {
  try {
    const raw = await readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!data?.at) return { published: false };
    return data;
  } catch (error) {
    if (error && error.code === 'ENOENT') return { published: false };
    throw error;
  }
}

function assertData(data) {
  if (!data || typeof data !== 'object') throw new Error('json');
  if (!Number.isFinite(Number(data.year)) || !Number.isFinite(Number(data.week))) throw new Error('semana');
  if (!Array.isArray(data.planRows) || !Array.isArray(data.picagens)) throw new Error('dados');
  if (JSON.stringify(data).length > 80_000_000) throw new Error('size');
}

async function writeData(data) {
  await mkdir(dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(data), 'utf8');
  try {
    await rename(tmp, DATA_FILE);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

export function publicadoPlugin() {
  return {
    name: 'publicado-app',
    transformIndexHtml: {
      handler(html, ctx) {
        if (!ctx.server) return html;
        return sourceVersion().then((version) => html.replace('/src/main.jsx', `/src/main.jsx?v=${version}`));
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
        if (path !== '/api/publicar') return next();
        (async () => {
          if (req.method === 'GET') {
            const payload = await readPublished();
            res.setHeader('content-type', 'application/json; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(JSON.stringify(payload));
            return;
          }
          if (req.method !== 'POST') {
            res.statusCode = 405;
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
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ published: true, at: stored.at, label: stored.label }));
        })().catch(() => {
          if (res.headersSent || res.writableEnded) return;
          res.statusCode = 400;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ published: false, error: 'Não foi possível gravar a semana.' }));
        });
      });
    },
  };
}
