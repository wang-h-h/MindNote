const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createRequire } = require('node:module');

const RUNTIME_MODULES = ['better-sqlite3', 'electron-squirrel-startup'];
const onMac = process.platform === 'darwin';
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
    icon: onMac ? './.local-data/mac-icon/icon.icns' : './assets/icon.ico',
    ...(onMac
      ? {
          appBundleId: 'com.whh.MindNote',
          appCategoryType: 'public.app-category.productivity',
          osxSign: {
            identity: '-',
            identityValidation: false,
            preAutoEntitlements: false,
            continueOnError: false,
            optionsForFile: () => ({
              timestamp: 'none',
              hardenedRuntime: false,
              entitlements: ['com.apple.security.cs.allow-jit'],
            }),
          },
        }
      : {}),
    // asar matches file globs against the absolute staging path. A hidden
    // component (our .local-data folder) prevents a globstar from matching.
    // A directory rule is relative to the app and independent of the host path.
    asar: onMac
      ? { unpackDir: 'node_modules/better-sqlite3/prebuilds' }
      : { unpack: '**/*.{node,dll}' },
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
    prePackage: async () => {
      if (onMac) await import('./scripts/build-mac-icon.mjs');
    },
    packageAfterCopy: async (_config, buildPath, _electronVersion, platform, arch) => {
      const supported =
        (platform === 'win32' && arch === 'x64') ||
        (platform === 'darwin' && onMac && ['arm64', 'x64'].includes(arch));
      if (!supported) throw new Error(`Unsupported packaging target: ${platform}-${arch}`);
      const root = __dirname;
      const modules = platform === 'darwin' ? ['better-sqlite3'] : RUNTIME_MODULES;
      for (const dependency of modules) await stagePackage(dependency, root, buildPath, platform, arch);
      const stagedPath = path.join(buildPath, 'package.json');
      const manifest = JSON.parse(await fs.readFile(stagedPath, 'utf8'));
      manifest.dependencies = Object.fromEntries(modules.map((name) => [name, manifest.dependencies[name]]));
      delete manifest.devDependencies;
      delete manifest.scripts;
      await fs.writeFile(stagedPath, `${JSON.stringify(manifest, null, 2)}\n`);
      await fs.access(
        path.join(buildPath, 'node_modules/better-sqlite3/prebuilds', `${platform}-${arch}.node`),
      );
    },
    postPackage: async (_config, { outputPaths }) => {
      for (const source of outputPaths) {
        await fs.cp(source, path.join(FINAL_OUT, path.basename(source)), {
          recursive: true,
          force: true,
          verbatimSymlinks: true,
        });
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
