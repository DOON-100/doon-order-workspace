import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const checker = fileURLToPath(new URL('../scripts/check-public-repository.mjs', import.meta.url));
const temporaryParent = path.resolve(os.tmpdir());
const root = await fs.mkdtemp(path.join(temporaryParent, 'doon-public-repository-'));
const env = {...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0'};
const git = (...args) => execFileSync('git', args, {cwd: root, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
const run = (...args) => spawnSync(process.execPath, [checker, ...args], {cwd: root, env, encoding: 'utf8', windowsHide: true});
const write = async (name, content = 'SYNTHETIC_PRIVATE_CONTENT_NEVER_PRINT\n') => {
  await fs.mkdir(path.dirname(path.join(root, name)), {recursive: true});
  await fs.writeFile(path.join(root, name), content);
};
const output = result => result.stdout + result.stderr;

try {
  git('init', '--quiet');
  git('config', 'user.name', 'Synthetic public repository test');
  git('config', 'user.email', 'synthetic@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(root, 'empty-hooks'));
  await write('build/plugin.ts', 'export const synthetic = true;\n');
  await write('app/page.tsx', 'export const synthetic = true;\n');
  await write('encrypted-backups/README.md', 'Archived backup policy, without data.\n');
  await write('.gitignore', 'lan-data/\n*.enc\n.env*\n');
  git('add', '--', 'build/plugin.ts', 'app/page.tsx', 'encrypted-backups/README.md', '.gitignore');
  git('commit', '--quiet', '-m', 'Synthetic safe source tree');
  const safeCommit = git('rev-parse', 'HEAD').trim();
  assert.equal(run().status, 0, 'legitimate source and build plugin must remain allowed');
  assert.equal(run('--ref', safeCommit).status, 0, 'safe committed tree must pass');

  await write('lan-data/ignored.txt');
  await write('untracked.csv');
  assert.equal(run().status, 0, 'ignored and untracked working files are not inspected');

  const forbidden = [
    'lan-data/force-added.txt', 'lan-dist/server.mjs', 'private-data-tools/job.mjs',
    'test-output/result.json', 'nested/node_modules/example/index.js', '.codex/state.json',
    '.agents/state.json', '.sites-runtime/state.json', 'backup-keys/secret.txt',
    '.openai/hosting.local.json', 'deploy-tool/local-config.json',
    'encrypted-backups/snapshot/workspace.enc', 'encrypted-backups/snapshot/manifest.json',
    'keys/secret.key', 'keys/certificate.pem', 'keys/client.p12', 'keys/client.pfx',
    'data/workspace.sqlite', 'data/workspace.sqlite-wal', 'data/workspace.db-shm',
    '.env', '.env.production', 'config.env', 'archive.enc', 'original.xlsx', 'original.xls',
    'original.xlsm', 'original.xlsb', 'original.csv', 'original.tsv', 'attachment.pdf',
    'archive.zip', 'archive.tar', 'archive.tar.gz', 'backup.bak', 'database.dump',
    'originals-manifest.json', 'import-expectations.json', 'scripts/setup-jinbo-pilot.mjs',
    '协作修复说明-20260917.md',
  ];
  for (const name of forbidden) {
    await write(name);
    git('add', '--force', '--', name);
    const result = run();
    assert.equal(result.status, 1, 'must reject ' + name);
    assert(output(result).includes(JSON.stringify(name)), 'must identify blocked path');
    assert(!output(result).includes('SYNTHETIC_PRIVATE_CONTENT_NEVER_PRINT'), 'must never print file contents');
    git('reset', '--quiet', 'HEAD', '--', name);
  }

  git('add', '--force', '--', 'lan-data/force-added.txt');
  git('commit', '--quiet', '-m', 'Synthetic forbidden tree');
  const unsafeCommit = git('rev-parse', 'HEAD').trim();
  git('rm', '--cached', '--quiet', '--', 'lan-data/force-added.txt');
  assert.equal(run().status, 0, 'index reflects a staged removal');
  const unsafeTree = run('--ref', unsafeCommit);
  assert.equal(unsafeTree.status, 1, '--ref must inspect committed paths despite staged removal');
  assert(output(unsafeTree).includes('lan-data/force-added.txt'));
  assert.equal(run('--ref', safeCommit).status, 0, 'earlier safe tree remains independently checkable');
  assert.equal(run('--ref', 'missing-synthetic-ref').status, 2, 'invalid references fail closed');
  assert.equal(run('--unexpected').status, 2, 'invalid arguments fail closed');
  console.log(`PASS Public repository path guard: safe build source, ignored files, ${forbidden.length} blocked paths, index and committed-tree checks.`);
} finally {
  const target = path.resolve(root);
  assert.equal(path.dirname(target), temporaryParent, 'cleanup must stay in the test temporary parent');
  assert(path.basename(target).startsWith('doon-public-repository-'), 'cleanup must target this test directory');
  await fs.rm(target, {recursive: true, force: true});
}
