// Build artifacts only; never reads employee configuration or deploys a server.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = path.resolve(root, '..');
const nodeVersion = '24.14.0';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (binary, args, cwd = root, env = process.env) => execFileSync(binary, args, {cwd, env, windowsHide: true, stdio: 'pipe', maxBuffer: 4 * 1024 * 1024});
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');

export async function inventory(folder) {
  const result = {};
  async function walk(dir, prefix = '') {
    for (const item of (await fs.readdir(dir, {withFileTypes: true})).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + item.name;
      if (relative === 'release.json') continue;
      if (item.isSymbolicLink()) throw Error('Package links forbidden');
      if (item.isDirectory()) await walk(path.join(dir, item.name), relative + '/');
      else if (item.isFile()) { const bytes = await fs.readFile(path.join(dir, item.name)); result[relative] = {bytes: bytes.length, sha256: hash(bytes)}; }
      else throw Error('Unsupported package entry');
    }
  }
  await walk(folder);
  return result;
}

async function download(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(120000), redirect: 'error'});
  if (!response.ok) throw Error('Cannot download official Node runtime');
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.version !== 'v' + nodeVersion) throw Error('Package on Windows x64 with Node ' + nodeVersion);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const commander = JSON.parse(await fs.readFile(path.join(root, 'node_modules/commander/package.json'), 'utf8'));
  if (commander.version !== pkg.dependencies.commander || Object.keys(commander.dependencies || {}).length) throw Error('Unexpected Commander runtime dependencies');
  const commit = run('git', ['rev-parse', 'HEAD'], repository).toString().trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw Error('Invalid source revision');
  const sourceDirty = !!run('git', ['status', '--porcelain', '--', 'cli', 'docs/cli-implementation-plan.md', 'docs/cli-execution-log.md', 'tsconfig.json', '.github/workflows/cli-ci.yml', 'README.md'], repository).toString().trim();
  const output = path.join(root, 'artifacts'); await fs.mkdir(output, {recursive: true});
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'doon-cli-package-'));
  const archiveName = `node-v${nodeVersion}-win-x64.zip`;
  const base = `https://nodejs.org/dist/v${nodeVersion}/`;
  const sums = (await download(base + 'SHASUMS256.txt')).toString('utf8');
  const expected = sums.split('\n').find(line => line.endsWith('  ' + archiveName))?.split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw Error('Official checksum missing');
  const cached = path.join(output, archiveName);
  let bytes = await fs.readFile(cached).catch(() => null);
  if (!bytes || hash(bytes) !== expected) { bytes = await download(base + archiveName); if (hash(bytes) !== expected) throw Error('Node archive integrity mismatch'); await fs.writeFile(cached, bytes); }
  const runtimeRoot = path.join(work, 'runtime');
  const expand = path.join(work, 'expand.ps1');
  await fs.writeFile(expand, "param([string]$Archive,[string]$Destination)\n$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination\n");
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', expand, '-Archive', cached, '-Destination', runtimeRoot]);
  const runtime = path.join(runtimeRoot, `node-v${nodeVersion}-win-x64`);
  const stage = path.join(work, 'package'); await fs.mkdir(stage);
  await fs.copyFile(path.join(runtime, 'node.exe'), path.join(stage, 'node.exe'));
  await fs.copyFile(path.join(runtime, 'LICENSE'), path.join(stage, 'NODE-LICENSE.txt'));
  const distFiles = ['business.js', 'catalog.js', 'client.js', 'engineering.js', 'finance.js', 'errors.js', 'index.js', 'operations.js', 'orders.js', 'planning.js', 'program.js', 'prompt.js', 'routes.js', 'sales.js', 'sales-write.js', 'service.js', 'state.js', 'write-input.js', 'write-operation.js'];
  const actualDist = Object.keys(await inventory(path.join(root, 'dist'))).sort();
  if (JSON.stringify(actualDist) !== JSON.stringify([...distFiles].sort())) throw Error('Unexpected CLI build files; rebuild into a clean dist directory');
  await fs.mkdir(path.join(stage, 'dist'));
  for (const filename of distFiles) await fs.copyFile(path.join(root, 'dist', filename), path.join(stage, 'dist', filename));
  // Exact source allowlist: no npmrc, local settings, tests, databases, or checkout copy.
  for (const filename of ['README.md', 'docs/commands.md', 'docs/agent-usage.md', 'docs/sales.md', 'docs/orders.md', 'docs/engineering.md', 'docs/planning.md', 'docs/operations.md', 'docs/finance.md']) {
    await fs.mkdir(path.dirname(path.join(stage, filename)), {recursive: true});
    if (filename === 'README.md') {
      const readme = (await fs.readFile(path.join(root, filename), 'utf8')).replaceAll('../docs/', 'https://github.com/DOON-100/doon-order-workspace/blob/main/docs/');
      await fs.writeFile(path.join(stage, filename), readme);
    } else await fs.copyFile(path.join(root, filename), path.join(stage, filename));
  }
  for (const filename of ['doon.cmd', 'install.cmd', 'install.ps1']) await fs.copyFile(path.join(root, 'windows', filename), path.join(stage, filename));
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({name: pkg.name, version: pkg.version, type: 'module', private: true}) + '\n');
  const dependency = path.join(stage, 'node_modules/commander'); await fs.mkdir(dependency, {recursive: true});
  for (const filename of ['index.js', 'package.json', 'LICENSE', 'package-support.json']) await fs.copyFile(path.join(root, 'node_modules/commander', filename), path.join(dependency, filename));
  await fs.cp(path.join(root, 'node_modules/commander/lib'), path.join(dependency, 'lib'), {recursive: true});
  const manifest = {format: 'doon-cli-windows-v1', version: pkg.version, commit, sourceDirty, platform: 'win32-x64', nodeVersion, nodeArchiveSha256: expected, builtAt: new Date().toISOString(), files: await inventory(stage)};
  await fs.writeFile(path.join(stage, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
  const name = `doon-cli-${pkg.version}-${commit.slice(0,12)}${sourceDirty ? '-dev' : ''}-windows-x64.zip`;
  const zip = path.join(work, name), extracted = path.join(work, 'extracted');
  const compress = path.join(work, 'compress.ps1');
  await fs.writeFile(compress, "param([string]$Stage,[string]$Archive)\n$ErrorActionPreference='Stop'\nCompress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Archive\n");
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', compress, '-Stage', stage, '-Archive', zip]);
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', expand, '-Archive', zip, '-Destination', extracted]);
  if (JSON.stringify(await inventory(extracted)) !== JSON.stringify(manifest.files)) throw Error('Extracted package integrity mismatch');
  const isolatedEnv = {...process.env, DOON_CLI_HOME: path.join(work, 'synthetic-config')};
  delete isolatedEnv.NODE_PATH;
  delete isolatedEnv.NODE_OPTIONS;
  const result = JSON.parse(run(path.join(extracted, 'node.exe'), [path.join(extracted, 'dist/index.js'), 'commands', '--json'], extracted, isolatedEnv));
  const {commands} = await import('../dist/catalog.js');
  if (!result.ok || result.command !== 'commands' || JSON.stringify(result.data.map(row => row.name)) !== JSON.stringify(commands.map(row => row.name))) throw Error('Relocated CLI command catalog is incomplete');
  if (run(path.join(extracted, 'node.exe'), [path.join(extracted, 'dist/index.js'), '--version'], extracted, isolatedEnv).toString().trim() !== pkg.version) throw Error('CLI and release versions disagree');
  const installed = path.join(work, 'installed');
  await fs.mkdir(installed);
  await fs.writeFile(path.join(installed, 'config.json'), '{"syntheticPreservationMarker":true}\n');
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(extracted, 'install.ps1'), '-InstallRoot', installed, '-SkipPathUpdate'], extracted, isolatedEnv);
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'scripts/test-installed.ps1'), '-InstallRoot', installed], extracted, isolatedEnv);
  run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(extracted, 'install.ps1'), '-InstallRoot', installed, '-SkipPathUpdate'], extracted, isolatedEnv);
  if (await fs.readFile(path.join(installed, 'config.json'), 'utf8') !== '{"syntheticPreservationMarker":true}\n') throw Error('Installer changed user configuration');
  const entry = path.join(extracted, 'dist/index.js'), original = await fs.readFile(entry);
  await fs.appendFile(entry, '\n// synthetic tamper\n');
  const rejectedInstall = path.join(work, 'must-not-install');
  let rejected = false;
  try { run(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(extracted, 'install.ps1'), '-InstallRoot', rejectedInstall, '-SkipPathUpdate'], extracted, isolatedEnv); }
  catch { rejected = true; }
  if (!rejected || await fs.stat(rejectedInstall).then(() => true, () => false)) throw Error('Tampered package was not rejected before install');
  await fs.writeFile(entry, original);
  await fs.copyFile(zip, path.join(output, name));
  await fs.copyFile(path.join(extracted, 'release.json'), path.join(output, 'release.json'));
  await fs.writeFile(path.join(output, 'SHA256SUMS'), `${hash(await fs.readFile(zip))}  ${name}\n`);
  console.log('PASS Windows package, extraction, isolated install, command entry and tamper rejection: ' + path.join(output, name));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
