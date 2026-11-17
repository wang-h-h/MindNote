const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const RUNTIME_MODULES = ['better-sqlite3', 'electron-squirrel-startup'];
// Keep Electron packaging isolated in a stable staging folder. NSIS creates
// the configurable-path installer separately via scripts/build-installer.mjs.
const STAGING_OUT = path.join(
  os.tmpdir(),
  `MindNote-build-${createHash('sha256').update(__dirname).digest('hex').slice(0, 10)}`,
);
const FINAL_OUT = path.join(__dirname, 'out');

// The renderer is bundled by Vite. Stage only main-process runtime dependencies
// as real directories: copying pnpm's virtual store would also copy development
// tools, and preserving its junctions would make the installed app nonportable.
async function stagePackage(name, from, destination, platform, arch, ancestors = new Set()) {
  const manifestPath = createRequire(path.join(from, 'package.json')).resolve(`${name}/package.json`);
  const source = path.dirname(manifestPath);
  const realSource = await fs.realpath(source);
  if (ancestors.has(realSource)) return;
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const target = path.join(destination, 'node_modules', name);
  await fs.cp(source, target, {
    recursive: true,
    dereference: true,
    filter: (file) => {
      const relative = path.relative(source, file).replaceAll('\\', '/');
      const first = relative.split('/')[0];
      if (['node_modules', '.git', 'test', 'tests', 'benchmark', 'build'].includes(first)) return false;
      // better-sqlite3 13 ships Node-API binaries; keep only the target binary.
      if (relative.startsWith('prebuilds/') && relative.endsWith('.node'))
        return relative === `prebuilds/${platform}-${arch}.node`;
      return true;
    },
  });
  const nextAncestors = new Set(ancestors).add(realSource);
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    await stagePackage(dependency, source, target, platform, arch, nextAncestors);
  }
}

module.exports = {
  outDir: STAGING_OUT,
  packagerConfig: {
    tmpdir: path.join(__dirname, '.local-data', 'electron-package-temp'),
    ...(process.env.MINDNOTE_ELECTRON_ZIP_DIR
      ? { electronZipDir: process.env.MINDNOTE_ELECTRON_ZIP_DIR }
      : {}),
    name: 'MindNote',
    executableName: 'MindNote',
    icon: './assets/icon.ico',
    asar: { unpack: '**/*.{node,dll}' },
    extraResource: ['./assets'],
    prune: false,
    ignore: (file) => {
      const first = file.replaceAll('\\', '/').replace(/^\//, '').split('/')[0];
      return (
        first !== '' &&
        !['dist', 'docs', 'package.json', 'README.md', 'THIRD_PARTY_NOTICES.md'].includes(first)
      );
    },
    win32metadata: {
      CompanyName: 'whh',
      FileDescription: 'MindNote',
      ProductName: 'MindNote',
    },
  },
  // Version 13 uses Node-API. Its shipped prebuild is compatible with Electron;
  // forcing a node-gyp rebuild would add an unnecessary compiler requirement.
  rebuildConfig: { ignoreModules: ['better-sqlite3'] },
  hooks: {
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      if (platform !== 'win32' || arch !== 'x64') throw new Error('MindNote 首版仅打包 Windows x64。');
      const root = __dirname;
      for (const dependency of RUNTIME_MODULES)
        await stagePackage(dependency, root, buildPath, platform, arch);
      const stagedPath = path.join(buildPath, 'package.json');
      const manifest = JSON.parse(await fs.readFile(stagedPath, 'utf8'));
      manifest.dependencies = Object.fromEntries(
        RUNTIME_MODULES.map((name) => [name, manifest.dependencies[name]]),
      );
      delete manifest.devDependencies;
      delete manifest.scripts;
      await fs.writeFile(stagedPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await fs.access(path.join(buildPath, 'node_modules/better-sqlite3/prebuilds/win32-x64.node'));
    },
    postPackage: async (_config, { outputPaths }) => {
      for (const source of outputPaths) {
        await fs.cp(source, path.join(FINAL_OUT, path.basename(source)), { recursive: true, force: true });
      }
    },
    postMake: async (_config, results) => {
      for (const result of results) {
        const destination = path.join(FINAL_OUT, 'make', 'squirrel.windows', result.arch);
        await fs.mkdir(destination, { recursive: true });
        result.artifacts = await Promise.all(
          result.artifacts.map(async (source) => {
            const target = path.join(destination, path.basename(source));
            await fs.copyFile(source, target);
            return target;
          }),
        );
      }
      return results;
    },
  },
  makers: [],
};
