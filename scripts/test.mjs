import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
const watch = process.argv.includes('--watch');
const child = spawn(
  electron,
  [
    fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
    ...(watch ? [] : ['run']),
    ...process.argv.slice(2).filter((a) => a !== '--watch'),
  ],
  {
    stdio: 'inherit',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  },
);
child.on('error', (e) => {
  console.error(e);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
