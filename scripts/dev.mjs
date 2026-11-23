import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Windows cmd cannot run `PUBLICAR_LOCAL=1 vite`. Set the variable here, then start Vite.
const require = createRequire(import.meta.url);
const pkgPath = require.resolve('vite/package.json');
const bin = require(pkgPath).bin.vite;
const viteBin = join(dirname(pkgPath), bin);

const child = spawn(process.execPath, [viteBin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, PUBLICAR_LOCAL: '1' },
});

child.on('exit', (code) => {
  process.exit(code === null ? 1 : code);
});
