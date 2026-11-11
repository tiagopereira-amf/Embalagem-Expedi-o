import { readPicagens } from '../lib/streamPicagens.js';

self.onmessage = async (event) => {
  try {
    if (event.data?.fail) {
      self.postMessage({ type: 'error', message: 'O leitor em segundo plano terminou de forma inesperada.' });
      return;
    }
    const result = await readPicagens(
      event.data.buffer,
      (progress) => {
        self.postMessage({ type: 'progress', pct: progress.pct, phase: progress.phase });
      },
      (rows) => {
        self.postMessage({ type: 'rows', rows });
      },
    );
    self.postMessage({ type: 'done', stats: result.stats, sheetName: result.sheetName });
  } catch (error) {
    self.postMessage({ type: 'error', message: error?.message || 'Não foi possível ler o ficheiro.' });
  }
};
