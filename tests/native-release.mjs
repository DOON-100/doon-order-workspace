import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {inventory, verifyPackage} from '../scripts/package-native-release.mjs';

// npm ci accepts stale dev flags, but --omit=dev then silently drops a runtime dependency.
const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
for (const [name, range] of Object.entries(pkg.dependencies)) {
  assert.equal(lock.packages[''].dependencies[name], range, 'Stale dependency range: ' + name);
  const entry = lock.packages['node_modules/' + name];
  assert(entry && !entry.dev && !entry.devOptional, 'Runtime dependency omitted by production install: ' + name);
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-release-test-'));
try {
  await fs.mkdir(path.join(root, 'lan-dist'));
  await fs.writeFile(path.join(root, 'lan-dist/server.mjs'), '// Synthetic runtime only\n');
  const mailModule = path.join(root, 'lan-dist/ie-mail.mjs');
  const mailSource = 'export const configured = false; // Synthetic mail adapter; never sends\n';
  await fs.writeFile(mailModule, mailSource);
  for (const name of ['supplier-catalog-worker.mjs', 'supplier-catalog-scheduler.mjs']) await fs.writeFile(path.join(root, 'lan-dist', name), '// Synthetic supplier runtime\n');
  await fs.writeFile(path.join(root, 'package.json'), '{"private":true}\n');
  await fs.writeFile(path.join(root, 'release.json'), JSON.stringify({format: 'doon-native-release-v1', files: await inventory(root)}));
  const packaged = await verifyPackage(root);
  assert.equal(packaged.files['lan-dist/ie-mail.mjs'].type, 'file');
  for (const name of ['supplier-catalog-worker.mjs', 'supplier-catalog-scheduler.mjs']) {
    assert.equal(packaged.files['lan-dist/' + name].type, 'file');
    const filename = path.join(root, 'lan-dist', name);
    await fs.appendFile(filename, '// changed\n');
    await assert.rejects(verifyPackage(root), /integrity mismatch/);
    await fs.writeFile(filename, '// Synthetic supplier runtime\n');
  }
  await fs.appendFile(mailModule, '// changed\n');
  await assert.rejects(verifyPackage(root), /integrity mismatch/);
  await fs.unlink(mailModule);
  await assert.rejects(verifyPackage(root), /integrity mismatch/);
  await fs.writeFile(mailModule, mailSource);
  await verifyPackage(root);
  await fs.appendFile(path.join(root, 'lan-dist/server.mjs'), '// changed\n');
  await assert.rejects(verifyPackage(root), /integrity mismatch/);
  await fs.writeFile(path.join(root, 'lan-dist/server.mjs'), '// Synthetic runtime only\n');
  await fs.unlink(path.join(root, 'package.json'));
  await assert.rejects(verifyPackage(root), /integrity mismatch/);
  await fs.writeFile(path.join(root, 'package.json'), '{"private":true}\n');
  await fs.writeFile(path.join(root, 'lan-dist/auth.mjs'), '// unexpected extra file\n');
  await assert.rejects(verifyPackage(root), /integrity mismatch/);
  await fs.unlink(path.join(root, 'lan-dist/auth.mjs'));
  await verifyPackage(root);
  await fs.writeFile(path.join(root, '.env'), 'SYNTHETIC=not-a-secret');
  await assert.rejects(inventory(root), /Unexpected package path/);
  await fs.unlink(path.join(root, '.env'));
  await fs.mkdir(path.join(root, 'lan-data'));
  await assert.rejects(inventory(root), /Unexpected package path/);
  await fs.rmdir(path.join(root, 'lan-data'));
  await fs.writeFile(path.join(root, 'lan-dist/workspace.sqlite'), 'synthetic');
  await assert.rejects(inventory(root), /Unexpected runtime file/);
  await fs.unlink(path.join(root, 'lan-dist/workspace.sqlite'));
  if (process.platform !== 'win32') {
    await fs.mkdir(path.join(root, 'node_modules'));
    await fs.symlink('../../', path.join(root, 'node_modules/escape'));
    await assert.rejects(inventory(root), /Unsafe package link/);
    await fs.unlink(path.join(root, 'node_modules/escape'));
    await fs.symlink('../package.json', path.join(root, 'node_modules/safe'));
    assert.equal((await inventory(root))['node_modules/safe'].type, 'symlink');
  }
  console.log('PASS release hashes reject tampering; package allowlist excludes configuration, data and unsafe links');
} finally {
  const resolved = await fs.realpath(root), tempRoot = await fs.realpath(os.tmpdir());
  assert.equal(path.dirname(resolved), tempRoot);
  assert(path.basename(resolved).startsWith('doon-release-test-'));
  await fs.rm(resolved, {recursive: true, force: true});
}
