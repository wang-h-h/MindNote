import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
await build({
  absWorkingDir: project,
  entryPoints: ['src/main/main.ts', 'src/main/preload.ts'],
  outdir: 'dist/main',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'better-sqlite3', 'electron-squirrel-startup'],
  sourcemap: true,
});
