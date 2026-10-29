// Exercise the employee's CMD entry point without installing for the real user.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {inventory} from './package-windows.mjs';

if (process.platform !== 'win32') throw Error('Windows installer verification requires Windows');
const index = process.argv.indexOf('--package-root');
if (index < 0 || !process.argv[index + 1]) throw Error('Missing --package-root');
const source = path.resolve(process.argv[index + 1]);
assert.equal((await fs.lstat(source)).isSymbolicLink(), false);
const manifest = JSON.parse(await fs.readFile(path.join(source, 'release.json'), 'utf8'));
assert.deepEqual(await inventory(source), manifest.files);
const base = await fs.realpath(os.tmpdir());
const temporary = await fs.mkdtemp(path.join(base, 'doon-cli-installer-'));
const packageRoot = path.join(temporary, '中文安装包 with spaces');
const installRoot = path.join(temporary, '中文安装目标 with spaces');
const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const environment = {...process.env, LOCALAPPDATA: path.join(temporary, 'local-app-data'), DOON_CLI_HOME: path.join(temporary, 'synthetic-config')};
delete environment.NODE_PATH;
delete environment.NODE_OPTIONS;
// A PowerShell 7 host can put its incompatible modules ahead of Windows PS 5.1.
// Restrict only these child processes to Windows PowerShell's bundled modules.
for (const name of Object.keys(environment)) if (name.toLowerCase() === 'psmodulepath') delete environment[name];
environment.PSModulePath = path.join(path.dirname(shell), 'Modules');
const run = (command, extra = {}, restricted = false) => {
  const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', ...(restricted ? ['-ExecutionPolicy', 'Restricted'] : []), '-Command',
    "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $ErrorActionPreference = 'Stop'; " + command],
  {cwd: temporary, env: {...environment, ...extra}, windowsHide: true, encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024});
  if (result.error) throw result.error;
  assert.equal(result.signal, null, 'Installer process must terminate without an interactive pause');
  return result;
};
const snapshot = () => {
  const result = run("[ordered]@{ policies = @(Get-ExecutionPolicy -List | ForEach-Object { @{ scope = [string]$_.Scope; policy = [string]$_.ExecutionPolicy } }); userPath = [Environment]::GetEnvironmentVariable('Path', 'User') } | ConvertTo-Json -Depth 4 -Compress");
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
};
let before;
const runEntry = (entry, destination) => run(`
if ((Get-ExecutionPolicy) -ne 'Restricted') { throw 'Cannot establish process-only Restricted policy; check managed policy.' }
& $env:DOON_TEST_ENTRY -InstallRoot $env:DOON_TEST_INSTALL_ROOT -SkipPathUpdate
$Code = $LASTEXITCODE
if ((Get-ExecutionPolicy) -ne 'Restricted') { throw 'Installer changed the parent policy.' }
exit $Code
`, {DOON_TEST_ENTRY: entry, DOON_TEST_INSTALL_ROOT: destination}, true);
let summary;
try {
  before = snapshot();
  await fs.cp(source, packageRoot, {recursive: true});
  assert.deepEqual(await inventory(packageRoot), manifest.files);

  // Probe argument forwarding first. A broken wrapper must never reach the real
  // installer without -SkipPathUpdate; this probe cannot write the user's PATH.
  const probe = path.join(temporary, '入口参数探针 with spaces');
  await fs.mkdir(probe);
  const launcher = await fs.readFile(path.join(packageRoot, 'install.cmd'));
  await fs.writeFile(path.join(probe, 'install.cmd'), launcher);
  await fs.writeFile(path.join(probe, 'install.ps1'), `param([string]$InstallRoot, [switch]$SkipPathUpdate)
$ErrorActionPreference = 'Stop'
if ($InstallRoot -cne $env:DOON_TEST_INSTALL_ROOT -or -not $SkipPathUpdate) { throw 'Installer arguments were not forwarded.' }
if ((Get-ExecutionPolicy) -ne 'Bypass') { throw 'Installer child policy is not process-scoped Bypass.' }
Write-Output 'PASS installer arguments and child policy'
`);
  const forwarded = runEntry(path.join(probe, 'install.cmd'), installRoot);
  assert.equal(forwarded.status, 0, forwarded.stderr);
  assert.match(forwarded.stdout, /PASS installer arguments and child policy/);

  const blocked = run(`
if ((Get-ExecutionPolicy) -ne 'Restricted') { throw 'Cannot establish process-only Restricted policy.' }
try { & $env:DOON_TEST_ENTRY -InstallRoot $env:DOON_TEST_INSTALL_ROOT -SkipPathUpdate; exit 0 }
catch { [Console]::WriteLine($_.Exception.GetType().FullName); exit 71 }
`, {DOON_TEST_ENTRY: path.join(packageRoot, 'install.ps1'), DOON_TEST_INSTALL_ROOT: installRoot}, true);
  assert.equal(blocked.status, 71, 'Direct PS1 must reproduce the script-policy failure');
  assert.match(blocked.stdout, /PSSecurityException/);
  assert.equal(await fs.stat(installRoot).then(() => true, () => false), false);

  assert.deepEqual(await fs.readFile(path.join(packageRoot, 'install.cmd')), launcher);
  const installed = runEntry(path.join(packageRoot, 'install.cmd'), installRoot);
  assert.equal(installed.status, 0, installed.stderr);
  const releases = await fs.readdir(path.join(installRoot, 'programs'));
  assert.equal(releases.length, 1);
  assert.deepEqual(await inventory(path.join(installRoot, 'programs', releases[0])), manifest.files);
  const version = run('& $env:DOON_TEST_ENTRY --version; exit $LASTEXITCODE', {DOON_TEST_ENTRY: path.join(installRoot, 'bin/doon.cmd')});
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), manifest.version);

  const config = path.join(installRoot, 'config.json');
  const marker = '{"syntheticPreservationMarker":true}\n';
  await fs.writeFile(config, marker);
  const repeated = runEntry(path.join(packageRoot, 'install.cmd'), installRoot);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(await fs.readFile(config, 'utf8'), marker);

  await fs.appendFile(path.join(packageRoot, 'dist/index.js'), '\n// synthetic tamper\n');
  const rejectedRoot = path.join(temporary, 'must-not-install');
  const rejected = runEntry(path.join(packageRoot, 'install.cmd'), rejectedRoot);
  assert.notEqual(rejected.status, 0, 'CMD must preserve the installer failure exit code');
  assert.match(rejected.stderr, /Package integrity mismatch/);
  assert.equal(await fs.stat(rejectedRoot).then(() => true, () => false), false);
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(await inventory(source), manifest.files);
  assert.equal(await fs.stat(path.join(environment.LOCALAPPDATA, 'Doon/CLI')).then(() => true, () => false), false);
  summary = {schema: 'doon-cli-installer-acceptance-v1', version: manifest.version, restrictedPolicyReproduced: true,
    cmdEntryInstalled: true, chineseAndSpacePathsVerified: true, argumentsForwarded: true, repeatedInstallPreservedConfig: true,
    tamperRejectedWithFailureExitCode: true, persistentPoliciesUnchanged: true, userPathChanged: false,
    productionRequests: 0, syntheticOnly: true};
} finally {
  try {
    if (before) assert.deepEqual(snapshot(), before);
  } finally {
    assert.equal((await fs.lstat(temporary)).isSymbolicLink(), false);
    assert.equal(path.dirname(await fs.realpath(temporary)), base);
    assert(path.basename(temporary).startsWith('doon-cli-installer-'));
    await fs.rm(temporary, {recursive: true, force: true, maxRetries: 8, retryDelay: 250});
    assert.equal(await fs.stat(temporary).then(() => true, () => false), false);
  }
}
console.log(JSON.stringify({...summary, temporaryDirectoryRemoved: true}));
