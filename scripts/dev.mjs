import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
await import('./build-main.mjs');
const project = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)) });
await vite.listen();
const devURL = vite.resolvedUrls?.local[0];
if (!devURL) {
  await vite.close();
  throw new Error('无法确定开发服务器地址。');
}
const child = spawn(electron, [project], {
  cwd: project,
  stdio: 'inherit',
  windowsHide: true,
  env: { ...process.env, MINDNOTE_DEV_URL: devURL },
});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child.exitCode === null) child.kill();
  await vite.close();
  process.exit(code);
}
child.on('close', (code) => {
  void close(code ?? 0);
});
child.on('error', (error) => {
  console.error(error);
  void close(1);
});
process.on('SIGINT', () => {
  void close();
});
process.on('SIGTERM', () => {
  void close();
});
