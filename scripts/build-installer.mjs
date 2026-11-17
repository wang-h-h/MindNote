import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const appDir = resolve(root, 'out/MindNote-win32-x64');
const tool =
  process.env.MINDNOTE_NSIS_COMPILER || resolve(root, '.local-data/build-tools/nsis-3.13/makensis.exe');
try {
  await access(tool);
} catch {
  if (process.env.MINDNOTE_NSIS_COMPILER) throw new Error('MINDNOTE_NSIS_COMPILER 指定的编译器不存在。');
  const cache = resolve(root, '.local-data/build-tools');
  await mkdir(cache, { recursive: true });
  const archive = join(cache, 'nsis-3.13.zip');
  const expected = 'ba63dffc4410ee89193e1cb5a41989991bd77c61068da17e3156d136b7b0b3d8';
  let data;
  try {
    data = await readFile(archive);
  } catch {}
  if (!data || createHash('sha256').update(data).digest('hex') !== expected) {
    let url = 'https://downloads.sourceforge.net/project/nsis/NSIS%203/3.13/nsis-3.13.zip';
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`NSIS 下载失败：HTTP ${response.status}`);
      data = Buffer.from(await response.arrayBuffer());
      if (createHash('sha256').update(data).digest('hex') === expected) break;
      const next = data
        .toString('utf8')
        .match(/content="\d+;\s*url=([^"]+)"/i)?.[1]
        ?.replaceAll('&amp;', '&');
      if (
        !next ||
        new URL(next).protocol !== 'https:' ||
        !new URL(next).hostname.endsWith('.sourceforge.net')
      )
        break;
      url = next;
    }
    if (createHash('sha256').update(data).digest('hex') !== expected)
      throw new Error('NSIS 下载 SHA256 与官方发布值不一致，已停止。');
    await writeFile(archive, data);
  }
  await new Promise((done, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(root, 'scripts/expand-build-tool.ps1'),
        '-Archive',
        archive,
        '-Destination',
        cache,
      ],
      { stdio: 'inherit', windowsHide: true },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? done() : reject(new Error(`NSIS 解压失败 (${code})`))));
  });
  await access(tool);
}
await access(join(appDir, 'MindNote.exe'));
const output = resolve(root, 'out/make/nsis/x64');
const generated = resolve(root, '.local-data/installer');
await mkdir(output, { recursive: true });
await mkdir(generated, { recursive: true });
const escape = (value) => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
const files = [],
  directories = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(appDir, full);
    if (rel.split(/[\\/]/)[0].toLowerCase() === 'data') continue;
    if (entry.isDirectory()) {
      directories.push(rel);
      await walk(full);
    } else if (entry.isFile()) files.push(rel);
    else throw new Error(`打包目录含不支持的符号链接：${rel}`);
  }
}
await walk(appDir);
await writeFile(
  join(generated, 'uninstall-files.nsh'),
  [
    ...files.map((file) => `Delete "$INSTDIR\\${escape(file)}"`),
    ...directories.sort((a, b) => b.length - a.length).map((dir) => `RMDir "$INSTDIR\\${escape(dir)}"`),
  ].join('\n'),
);
const args = [
  '/INPUTCHARSET',
  'UTF8',
  '/OUTPUTCHARSET',
  'UTF8',
  '/V3',
  '/WX',
  `/DAPP_VERSION=${manifest.version}`,
  `/DAPP_DIR=${appDir}`,
  `/DOUT_FILE=${join(output, `MindNote-${manifest.version}-Setup.exe`)}`,
  `/DASSETS_DIR=${join(root, 'assets')}`,
  `/DGENERATED_DIR=${generated}`,
  join(root, 'scripts/mindnote-installer.nsi'),
];
const checkOnly = process.argv.includes('--check');
if (checkOnly) args.unshift('/PPO');
await new Promise((done, reject) => {
  const child = spawn(tool, args, {
    cwd: root,
    stdio: checkOnly ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    windowsHide: true,
  });
  let preprocessed = '';
  if (checkOnly)
    child.stdout.on('data', (chunk) => {
      preprocessed += chunk.toString();
    });
  child.on('error', reject);
  child.on('exit', async (code) => {
    if (code !== 0) {
      reject(new Error(`NSIS 编译失败 (${code})`));
      return;
    }
    if (checkOnly) await writeFile(join(generated, 'preprocessed.nsi'), preprocessed);
    done();
  });
});
console.log(
  checkOnly
    ? 'NSIS preprocessing check passed'
    : `Installer: ${join(output, `MindNote-${manifest.version}-Setup.exe`)}`,
);
