import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const exec = promisify(execFile);
const repo = fileURLToPath(new URL('../../', import.meta.url));
const cli = path.join(repo, 'cli/dist/index.js');
const origin = 'http://127.0.0.1:8797';
const temporaryRoot = path.resolve(tmpdir());
const directory = await mkdtemp(path.join(temporaryRoot, 'doon-dsh-probe-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(DOON_|DSH_|DEEPSEEK_|OPENAI_|ANTHROPIC_|AZURE_OPENAI_)/i.test(key)));
env.DOON_CLI_HOME = directory;

async function call(args) {
  try {
    const {stdout} = await exec(process.execPath, [cli, ...args, '--json'], {
      env, cwd: directory, windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (typeof error.stdout !== 'string' || !error.stdout.trim()) throw error;
    const result = JSON.parse(error.stdout);
    assert.equal(result.ok, false);
    return result;
  }
}

try {
  const commands = await call(['commands']);
  assert.equal(commands.ok, true);
  assert(Array.isArray(commands.data));
  assert(commands.data.some(command => command.name === 'whoami'));
  const setup = await call(['setup', '--server', origin, '--allow-local-http']);
  assert.equal(setup.ok, true);
  const health = await fetch(origin + '/health', {redirect: 'error', signal: AbortSignal.timeout(8000)});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  const page = await fetch(origin + '/customer-projects', {redirect: 'error', signal: AbortSignal.timeout(8000)});
  assert.equal(page.status, 200);
  const html = await page.text();
  assert(html.includes('本地测试环境') && html.includes('服务器数据副本'));
  const identity = await call(['whoami']);
  assert.equal(identity.ok, false, 'Fresh test CLI home must not inherit employee credentials');
  assert.equal(identity.error?.code, 'AUTH_REQUIRED');
  console.log(JSON.stringify({
    ok: true, origin, commandCount: commands.data.length,
    health: 'passed', localTestMarker: 'passed', isolatedCliHome: 'passed',
    unauthenticatedCli: 'AUTH_REQUIRED',
    businessDataRead: false, businessWrites: false, authenticatedIntegration: 'not-tested',
  }, null, 2));
} finally {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), temporaryRoot);
  assert(path.basename(resolved).startsWith('doon-dsh-probe-'));
  await rm(resolved, {recursive: true, force: true});
}
