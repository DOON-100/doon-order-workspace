// CI packaging only. This script never opens an existing business database or deploys.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyCustomerPriceBuildEvidence} from './customer-price-build-evidence.mjs';

const allowedRoots = new Set(['lan-dist', 'node_modules', 'package.json', 'package-lock.json']);
const distFiles = new Set(['workspace-api.mjs', 'agent-schedules.mjs', 'runtime.mjs', 'ie-mail.mjs', 'auth.mjs',
  'personnel.mjs', 'server.mjs', 'manage.mjs', 'supplier-gateway.mjs', 'employee-gateway.mjs',
  'supplier-catalog-worker.mjs', 'supplier-catalog-job.mjs', 'fixed-scheduler.mjs', 'fixed-schedule.mjs',
  'customer-price-build-evidence.json']);

export async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Exact root allowlist: never archive the checkout, test output, data, or local configuration.
export async function inventory(root) {
  root = await fs.realpath(root);
  const files = {};
  async function visit(folder, prefix = '') {
    for (const entry of (await fs.readdir(folder, {withFileTypes: true})).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix + entry.name;
      if (!prefix && relative === 'release.json') continue;
      if (!allowedRoots.has(relative.split('/')[0])) throw new Error('Unexpected package path: ' + relative);
      const filename = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(filename);
        if (!relative.startsWith('node_modules/') || path.isAbsolute(target) ||
            !inside(root, await fs.realpath(filename))) throw new Error('Unsafe package link: ' + relative);
        files[relative] = {type: 'symlink', target};
      } else if (entry.isDirectory()) {
        await visit(filename, relative + '/');
      } else if (entry.isFile()) {
        if (relative.startsWith('lan-dist/')) {
          const distPath = relative.slice('lan-dist/'.length);
          if (!distFiles.has(distPath) && !/^client\/(?:index\.html|assets\/[^/]+\.(?:js|css)|brand\/doon-eyewear-manufacturing\.jpg)$/.test(distPath)) {
            throw new Error('Unexpected runtime file: ' + relative);
          }
        }
        files[relative] = {type: 'file', bytes: (await fs.stat(filename)).size, sha256: await sha256(filename)};
      } else throw new Error('Unsupported package entry: ' + relative);
    }
  }
  await visit(root);
  return files;
}

export async function verifyPackage(root) {
  if (!(await fs.lstat(path.join(root, 'release.json'))).isFile()) throw new Error('Release manifest must be a regular file');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'release.json'), 'utf8'));
  if (manifest.format !== 'doon-native-release-v1' ||
      JSON.stringify(manifest.files) !== JSON.stringify(await inventory(root))) {
    throw new Error('Package integrity mismatch');
  }
  return manifest;
}

async function main() {
  if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Package on the Linux x64 CI runner');
  const root = process.cwd();
  const buildDir = path.resolve(process.env.DOON_BUILD_DIR || '');
  const testRoot = await fs.realpath(path.join(root, 'test-output'));
  if (!inside(testRoot, await fs.realpath(buildDir))) throw new Error('DOON_BUILD_DIR must be inside test-output');
  const evidence = await verifyCustomerPriceBuildEvidence(buildDir);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Invalid source commit');
  const changes = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {encoding: 'utf8'});
  if (changes.trim()) throw new Error('Packaging requires a clean checkout');
  const output = path.join(testRoot, 'native-release');
  await fs.mkdir(output); // Refuse stale artifacts from an earlier attempt.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-native-package-'));
  const stage = path.join(temporary, 'stage');
  const extracted = path.join(temporary, 'extracted');
  const run = (command, args, options = {}) => execFileSync(command, args, {cwd: root, stdio: 'inherit', ...options});
  try {
    await fs.mkdir(stage);
    await fs.cp(buildDir, path.join(stage, 'lan-dist'), {recursive: true});
    for (const filename of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(root, filename), path.join(stage, filename));
    await inventory(stage);
    // Install in a new directory outside the checkout: no developer's node_modules or npmrc is copied.
    run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: stage});
    const manifest = {
      format: 'doon-native-release-v1',
      commit,
      builtAt: new Date().toISOString(),
      platform: 'linux', architecture: 'x64', nodeVersion: process.version,
      runner: 'ubuntu-22.04',
      sourceBuildManifestSha256: evidence.manifestSha256,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      entrypoint: 'lan-dist/server.mjs',
      deploymentApproved: false,
      files: await inventory(stage),
    };
    await fs.writeFile(path.join(stage, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
    const archiveName = `doon-native-${commit}-linux-x64-node24.tar.gz`;
    const archive = path.join(output, archiveName);
    run('tar', ['-czf', archive, '-C', stage, '.']);
    await fs.mkdir(extracted);
    run('tar', ['-xzf', archive, '-C', extracted]);
    await verifyPackage(extracted);
    // Test the delivered bytes, relocated outside the checkout, with a synthetic DB and test port.
    run(process.execPath, ['standalone/test.mjs'], {env: {...process.env, DOON_BUILD_DIR: path.join(extracted, 'lan-dist')}});
    await verifyPackage(extracted);
    await fs.copyFile(path.join(stage, 'release.json'), path.join(output, 'release.json'));
    await fs.writeFile(path.join(output, 'SHA256SUMS'), `${await sha256(archive)}  ${archiveName}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,
      `## Validated native package\n\nCommit: \`${commit}\`\n\nLinux x64 / Ubuntu 22.04 / Node ${process.version}. Runtime dependencies included; Node itself is not included.\n\nThe extracted archive passed the synthetic HTTP tests. No deployment was performed. Main artifacts expire after 30 days.\n`);
    console.log('Validated package: ' + archiveName);
  } finally {
    const resolved = await fs.realpath(temporary);
    const tempRoot = await fs.realpath(os.tmpdir());
    if (!inside(tempRoot, resolved) || !path.basename(resolved).startsWith('doon-native-package-')) throw new Error('Unsafe cleanup path');
    await fs.rm(resolved, {recursive: true, force: true});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
