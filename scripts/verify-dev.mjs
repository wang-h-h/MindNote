import { createServer } from 'vite';
import { _electron } from 'playwright';
import executablePath from 'electron';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const server = await createServer();
await server.listen();
let app;
const errors = [];
try {
  const env = {
    ...process.env,
    MINDNOTE_DEV_URL: server.resolvedUrls.local[0],
    MINDNOTE_TEST_MODE: '1',
    MINDNOTE_DATA_DIR: resolve(`.local-data/dev-check-${Date.now()}`),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await _electron.launch({ executablePath, args: ['.'], env });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: '新建事项', exact: true }).waitFor();
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  assert(csp.includes("'unsafe-inline'"));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log('Vite development UI loaded successfully with React refresh and no renderer errors.');
} finally {
  if (app) await app.close();
  await server.close();
}
