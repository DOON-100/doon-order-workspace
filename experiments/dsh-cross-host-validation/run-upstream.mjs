import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const baseline = JSON.parse(await readFile(new URL('./baseline.json', import.meta.url), 'utf8'));
const source = process.argv[2];
const mode = process.argv[3] ?? 'unit';
assert(source && path.isAbsolute(source) && ['unit', 'composition'].includes(mode),
  'Usage: node run-upstream.mjs <absolute DSH checkout> [unit|composition]');
const suites = mode === 'composition' ? baseline.compositionSuites : baseline.suites;
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: source, encoding: 'utf8', windowsHide: true}).trim();
assert.equal(commit, baseline.commit, 'Review and update the pinned baseline before testing a different source revision');
const output = path.join(repo, 'test-output/dsh-cross-host-validation');
await mkdir(output, {recursive: true});
const temporaryRoot = path.resolve(tmpdir());
const home = await mkdtemp(path.join(temporaryRoot, 'doon-dsh-upstream-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(DOON_|DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_)/i.test(key)));
Object.assign(env, {DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1'});
const reportPath = path.join(output, mode + '-upstream.json');
await rm(reportPath, {force: true});
const args = [path.join(source, 'node_modules/vitest/vitest.mjs'), 'run', ...suites,
  ...(mode === 'composition' ? ['--config=vitest.e2e.config.ts', '--retry=0'] : []),
  '--maxWorkers=1', '--no-file-parallelism', '--reporter=json', '--outputFile=' + reportPath];

try {
  let log = '';
  const child = spawn(process.execPath, args, {cwd: source, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  const append = chunk => { log = (log + chunk.toString()).slice(-2 * 1024 * 1024); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  const status = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({code, signal}));
  });
  await writeFile(path.join(output, mode + '-upstream.log'), log);
  let report;
  try { report = JSON.parse(await readFile(reportPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const result = {
    commit, version: baseline.version, mode,
    tier: mode === 'composition' ? 'real-dsh-profile-processes-with-synthetic-models'
      : 'upstream-source-tests-with-synthetic-models',
    exitCode: status.code, signal: status.signal,
    passed: report?.numPassedTests ?? null, failed: report?.numFailedTests ?? null,
    pending: report?.numPendingTests ?? null,
    success: status.code === 0 && report?.success === true && report.numTotalTests > 0
      && report.numPassedTests === report.numTotalTests
      && report.numFailedTests === 0 && report.numPendingTests === 0
      && suites.every(suite => report.testResults?.some(file =>
        file.name.replaceAll('\\', '/').endsWith(suite))),
    independentEmployeeHosts: 'not-validated-by-these-tests',
    operatingSystemIsolation: 'not-tested', actualModel: 'not-tested',
  };
  await writeFile(path.join(output, mode + '-summary.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (!result.success) process.exitCode = 1;
} finally {
  const resolved = path.resolve(home);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert(path.basename(resolved).startsWith('doon-dsh-upstream-'));
  await rm(resolved, {recursive: true, force: true, maxRetries: 5, retryDelay: 100});
}
