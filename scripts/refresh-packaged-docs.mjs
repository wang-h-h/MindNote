// Refresh documentation in an already verified, unsigned Windows package.
// Application bytes and unpacked dependencies must remain exactly unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const require = createRequire(path.join(root, 'package.json'));
const forgeRequire = createRequire(require.resolve('@electron-forge/cli/package.json'));
const coreRequire = createRequire(forgeRequire.resolve('@electron-forge/core'));
const packagerRequire = createRequire(coreRequire.resolve('@electron/packager'));
const asar = await import(pathToFileURL(packagerRequire.resolve('@electron/asar')).href);
const reseditRequire = createRequire(packagerRequire.resolve('resedit'));
const { NtExecutable, NtExecutableResource, calculateCheckSumForPE } = await import(
  pathToFileURL(reseditRequire.resolve('pe-library')).href
);
const appDir = path.join(root, 'out', 'MindNote-win32-x64');
const archive = path.join(appDir, 'resources', 'app.asar');
const executable = path.join(appDir, 'MindNote.exe');
const scratch = await fs.mkdtemp(path.join(root, '.local-data', 'package-docs-'));
const source = path.join(scratch, 'app');
const nextArchive = path.join(scratch, 'app.asar');
const nextExecutable = path.join(scratch, 'MindNote.exe');
const backupArchive = path.join(scratch, 'original-app.asar');
const backupExecutable = path.join(scratch, 'original-MindNote.exe');
const sha = (data) => createHash('sha256').update(data).digest('hex');
const hashFile = async (file) => sha(await fs.readFile(file));
const isDoc = (name) => name.startsWith('docs/') || ['README.md', 'THIRD_PARTY_NOTICES.md'].includes(name);
const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
const readEntry = (file, name) => asar.extractFile(file, path.normalize(name));
const statEntry = (file, name) => asar.statFile(file, path.normalize(name));

function filesInAsar(file) {
  return asar
    .listPackage(file)
    .map((name) => name.replaceAll('\\', '/').replace(/^\//, ''))
    .filter((name) => !('files' in statEntry(file, name)))
    .sort();
}
function integrityResource(bytes) {
  // Signed executables are intentionally rejected by the parser: changing
  // authenticated resources would invalidate their signature.
  const exe = NtExecutable.from(bytes);
  const entries = NtExecutableResource.from(exe).entries.filter(
    (entry) => entry.type === 'INTEGRITY' && entry.id === 'ELECTRONASAR',
  );
  assert.equal(entries.length, 1, 'Exactly one Electron ASAR integrity resource is required');
  const payload = Buffer.from(entries[0].bin);
  const items = JSON.parse(payload.toString('utf8'));
  const item = items.find((entry) => entry.file.replaceAll('\\', '/') === 'resources/app.asar');
  assert(item && item.alg === 'SHA256' && /^[a-f\d]{64}$/i.test(item.value));
  return { exe, payload, items, item };
}
async function allFiles(directory, relative = '') {
  const found = [];
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), 'Documentation must not contain filesystem links');
    const name = path.posix.join(relative.replaceAll('\\', '/'), entry.name);
    if (entry.isDirectory()) found.push(...(await allFiles(directory, name)));
    else found.push(name);
  }
  return found;
}

const oldBytes = await fs.readFile(executable);
const oldArchiveHash = await hashFile(archive);
const oldExeHash = sha(oldBytes);
const oldIntegrity = integrityResource(oldBytes);
assert.equal(oldIntegrity.item.value, sha(asar.getRawHeader(archive).headerString));
assert.equal(JSON.parse(readEntry(archive, 'package.json')).version, version);
await fs.copyFile(archive, backupArchive);
await fs.copyFile(executable, backupExecutable);
asar.extractAll(archive, source);

// Only remove the extracted documentation in this script's new staging folder.
const stagedDocs = path.resolve(source, 'docs');
const scratchPrefix = `${path.resolve(scratch)}${path.sep}`;
assert(stagedDocs.startsWith(scratchPrefix));
assert(path.resolve(scratch).startsWith(`${path.resolve(root, '.local-data')}${path.sep}`));
await fs.rm(stagedDocs, { recursive: true, force: true });
await fs.cp(path.join(root, 'docs'), stagedDocs, { recursive: true });
for (const name of ['README.md', 'THIRD_PARTY_NOTICES.md'])
  await fs.copyFile(path.join(root, name), path.join(source, name));
await asar.createPackageWithOptions(source, nextArchive, { unpack: '**/*.{node,dll}' });

const oldFiles = filesInAsar(archive);
const newFiles = filesInAsar(nextArchive);
const preserved = oldFiles.filter((name) => !isDoc(name));
assert.deepEqual(
  newFiles.filter((name) => !isDoc(name)),
  preserved,
  'No application files added or removed',
);
const verifiedFiles = [];
const externalNativeFiles = [];
for (const name of preserved) {
  const before = readEntry(archive, name);
  const after = readEntry(nextArchive, name);
  assert.equal(sha(after), sha(before), `Application file changed: ${name}`);
  assert.equal(
    Boolean(statEntry(archive, name).unpacked),
    Boolean(statEntry(nextArchive, name).unpacked),
    name,
  );
  verifiedFiles.push({
    file: name,
    sha256: sha(after),
    unpacked: Boolean(statEntry(nextArchive, name).unpacked),
  });
  if (/\.(node|dll)$/i.test(name)) {
    const externalPath = path.join(appDir, 'resources', 'app.asar.unpacked', name);
    try {
      const externalHash = await hashFile(externalPath);
      assert.equal(externalHash, sha(before), `External native binary differs: ${name}`);
      externalNativeFiles.push({ file: name, sha256: externalHash });
    } catch (error) {
      if (error.code !== 'ENOENT' || statEntry(archive, name).unpacked) throw error;
    }
  }
}
for (const name of await allFiles(path.join(root, 'dist')))
  assert.equal(
    sha(readEntry(nextArchive, `dist/${name}`)),
    await hashFile(path.join(root, 'dist', name)),
    name,
  );
const docs = [
  ...(await allFiles(path.join(root, 'docs'))).map((name) => `docs/${name}`),
  'README.md',
  'THIRD_PARTY_NOTICES.md',
].sort();
assert.deepEqual(newFiles.filter(isDoc), docs);
for (const name of docs)
  assert.equal(sha(readEntry(nextArchive, name)), await hashFile(path.join(root, name)), name);

// Keep the executable byte-for-byte identical outside the existing, fixed-size
// integrity JSON resource and the optional PE checksum. This preserves icons,
// metadata, fuses and every executable section without rebuilding Electron.
oldIntegrity.item.value = sha(asar.getRawHeader(nextArchive).headerString);
const nextPayload = Buffer.from(JSON.stringify(oldIntegrity.items), 'utf8');
assert.equal(nextPayload.length, oldIntegrity.payload.length);
const payloadOffset = oldBytes.indexOf(oldIntegrity.payload);
assert(payloadOffset >= 0);
assert.equal(
  oldBytes.indexOf(oldIntegrity.payload, payloadOffset + 1),
  -1,
  'Resource bytes must have one unique location',
);
const nextBytes = Buffer.from(oldBytes);
nextPayload.copy(nextBytes, payloadOffset);
const checksumOffset = oldIntegrity.exe.dosHeader.newHeaderAddress + 88;
if (oldIntegrity.exe.newHeader.optionalHeader.checkSum !== 0) {
  const buffer = nextBytes.buffer.slice(nextBytes.byteOffset, nextBytes.byteOffset + nextBytes.length);
  nextBytes.writeUInt32LE(calculateCheckSumForPE(buffer, false), checksumOffset);
}
const masked = Buffer.from(nextBytes);
oldBytes.copy(masked, payloadOffset, payloadOffset, payloadOffset + oldIntegrity.payload.length);
oldBytes.copy(masked, checksumOffset, checksumOffset, checksumOffset + 4);
assert.equal(sha(masked), oldExeHash, 'Only integrity resource and PE checksum may change');
assert.equal(integrityResource(nextBytes).item.value, sha(asar.getRawHeader(nextArchive).headerString));
await fs.writeFile(nextExecutable, nextBytes);

const report = {
  version,
  backupDirectory: scratch,
  changedDocumentation: docs,
  applicationFilesUnchanged: verifiedFiles,
  externalNativeFilesUnchanged: externalNativeFiles,
  executableChangesRestrictedTo: ['INTEGRITY/ELECTRONASAR resource', 'PE checksum if present'],
  original: { asarSha256: oldArchiveHash, exeSha256: oldExeHash },
  updated: { asarSha256: await hashFile(nextArchive), exeSha256: sha(nextBytes) },
  asarHeaderSha256: oldIntegrity.item.value,
};
await fs.writeFile(path.join(scratch, 'prepared-report.json'), JSON.stringify(report, null, 2));
assert.equal(await hashFile(archive), oldArchiveHash, 'Package changed during preparation');
assert.equal(await hashFile(executable), oldExeHash, 'Executable changed during preparation');
try {
  await fs.copyFile(nextArchive, archive);
  await fs.copyFile(nextExecutable, executable);
  asar.uncache(archive);
  assert.equal(await hashFile(archive), report.updated.asarSha256);
  assert.equal(await hashFile(executable), report.updated.exeSha256);
  assert.equal(
    integrityResource(await fs.readFile(executable)).item.value,
    sha(asar.getRawHeader(archive).headerString),
  );
  for (const file of verifiedFiles) assert.equal(sha(readEntry(archive, file.file)), file.sha256, file.file);
  for (const file of externalNativeFiles)
    assert.equal(await hashFile(path.join(appDir, 'resources', 'app.asar.unpacked', file.file)), file.sha256);
} catch (error) {
  await fs.copyFile(backupArchive, archive);
  await fs.copyFile(backupExecutable, executable);
  asar.uncache(archive);
  assert.equal(await hashFile(archive), oldArchiveHash, 'ASAR rollback must succeed');
  assert.equal(await hashFile(executable), oldExeHash, 'EXE rollback must succeed');
  throw error;
}
report.ok = true;
await fs.writeFile(
  path.join(root, 'test-results', `package-docs-refresh-${version}.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      version,
      backupDirectory: scratch,
      unchangedApplicationFiles: verifiedFiles.length,
      updatedDocs: docs.length,
      ...report.updated,
      ok: true,
    },
    null,
    2,
  ),
);
