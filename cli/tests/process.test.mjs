import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporary, root} from './helpers.mjs';
const exec = promisify(execFile);
const binary = path.join(root, 'cli/dist/index.js');
async function invoke(args, env = {}) {
  const home = await temporary();
  try { return {code: 0, ...await exec(process.execPath, [binary, ...args], {windowsHide: true, env: {...process.env, DOON_CLI_HOME: home, ...env}})}; }
  catch (error) { return {code: error.code, stdout: error.stdout, stderr: error.stderr}; }
}

test('machine catalogs report implemented sales queries and keep other modules pending', async () => {
  const result = await invoke(['commands', '--json']); assert.equal(result.code, 0); assert.equal(result.stderr, '');
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.schema, 'doon-cli-output-v1'); assert(parsed.ok);
  assert.deepEqual(parsed.data.slice(0,7).map(row => row.name), ['setup', 'login', 'logout', 'whoami', 'doctor', 'commands', 'modules']);
  assert.equal(parsed.data.length, 102); assert(parsed.data.some(row => row.name === 'sales quotes version')); assert(parsed.data.some(row=>row.name==='service pi version'));assert(parsed.data.some(row=>row.name==='engineering ie-quotes version'));assert(parsed.data.some(row=>row.name==='purchasing purchases history'));assert(parsed.data.some(row=>row.name==='operations shipments history'));assert(parsed.data.some(row=>row.name==='finance records history'));
  const groups = JSON.parse((await invoke(['modules', '--json'])).stdout).data;
  assert.equal(groups.length, 11); assert.equal(groups.find(row => row.id === 'sales').status, 'partial');
  assert.equal(groups.find(row=>row.id==='service').status,'partial');
  assert.equal(groups.find(row=>row.id==='engineering').status,'partial');assert(['planning','purchasing','production','quality','warehouse','finance'].every(id=>groups.find(row=>row.id===id).status==='partial'));assert(groups.filter(row => !['sales','service','engineering','planning','purchasing','production','quality','warehouse','finance'].includes(row.id)).every(row => row.status === 'pending' && row.commands.length === 0));
  assert.equal(groups[0].label, '工作总览'); assert(!/[^\x00-\x7f]/.test(result.stdout));
});

test('sales argument validation and help work before login without accepting writes or fake filters', async () => {
  for (const args of [['sales','projects','list','--limit','0','--json'], ['sales','quotes','version','q1','0','--json'], ['sales','customers','save','--json'], ['sales','quotes','export-completed','--customer','c1','--output','new.xlsx','--json'], ['sales','customers','list','--mine','--json']]) {
    const result = await invoke(args); assert.equal(result.code, 2); assert.equal(JSON.parse(result.stdout).ok, false);
  }
  const help = await invoke(['sales','quotes','version','--help']); assert.equal(help.code, 0); assert(help.stdout.includes('<id> <version>'));
});

test('batch two argument errors reject unsupported writes and mismatched customer identity filters', async () => {
  for(const args of [['sales','orders','history','o1'],['sales','orders','list','--customer','c1'],['service','pi','list','--customer-code','C1'],['service','pi','confirm','pi1'],['service','documents','list','--type','engineering_quote'],['service','pi','version','pi1','0'],['sales','sources','export','s1']]){
    const result=await invoke([...args,'--json']);assert.equal(result.code,2);assert.equal(JSON.parse(result.stdout).error.code,'INVALID_ARGUMENT');
  }
  assert((await invoke(['service','pi','version','--help'])).stdout.includes('<id> <version>'));
});

test('escaped business output budget returns one error without partial business data', async () => {
  const script = `import {main} from ${JSON.stringify(new URL('../dist/program.js', import.meta.url).href)};process.exitCode=await main(['sales','customers','list','--json'],{sales:()=>({execute:async()=>({privateMarker:'DO_NOT_EMIT_PARTIAL',text:'中'.repeat(100000)})})});`;
  let result;try { await exec(process.execPath,['--input-type=module','-e',script],{windowsHide:true});assert.fail('Expected nonzero exit'); }
  catch(error) { result=error; }
  assert.equal(result.code,2);assert.equal(JSON.parse(result.stdout).error.code,'OUTPUT_TOO_LARGE');assert(!result.stdout.includes('DO_NOT_EMIT_PARTIAL'));assert.equal(result.stderr,'');
});

test('invalid commands/options and missing setup return structured nonzero errors without stack traces', async () => {
  for (const args of [['orders', 'list', '--json'], ['login', '--password', 'Never-Accept-This', '--json'], ['setup', '--server', 'http://public.test', '--json'], ['whoami', '--json']]) {
    const result = await invoke(args); assert.notEqual(result.code, 0);
    const parsed = JSON.parse(result.stdout); assert.equal(parsed.ok, false); assert(parsed.error.code); assert.equal(result.stderr, '');
    assert(!result.stdout.includes('Never-Accept-This')); assert(!result.stdout.includes(' at '));
  }
});

test('JSON help/version and invalid config-home remain machine readable', async () => {
  for (const args of [['--help', '--json'], ['--version', '--json']]) { const r = await invoke(args); assert.equal(r.code, 0); assert(JSON.parse(r.stdout).ok); }
  const result = await invoke(['whoami', '--json'], {DOON_CLI_HOME: 'relative'});
  assert.equal(JSON.parse(result.stdout).error.code, 'INVALID_CONFIG_HOME');
  assert.equal(result.code, 2);
});

test('setup writes only local connection metadata and rejects credentials in address', async () => {
  const home = await temporary();
  const valid = await invoke(['setup', '--server', 'https://employee.test', '--json'], {DOON_CLI_HOME: home}); assert.equal(valid.code, 0);
  assert.deepEqual(await fs.readdir(home), ['config.json']);
  const bad = await invoke(['setup', '--server', 'https://private:secret@employee.test', '--json']);
  assert.equal(JSON.parse(bad.stdout).error.code, 'INVALID_SERVER'); assert(!bad.stdout.includes('secret'));
});

test('noninteractive login rejects password injection without contacting server', {skip: process.platform !== 'win32'}, async () => {
  const home = await temporary();
  await invoke(['setup', '--server', 'https://must-not-be-contacted.invalid', '--json'], {DOON_CLI_HOME: home});
  const result = await invoke(['login', '--username', 'synthetic', '--json'], {DOON_CLI_HOME: home, DOON_PASSWORD: 'Synthetic-Not-An-Input!'});
  assert.equal(result.code, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'INTERACTIVE_LOGIN_REQUIRED');
  assert(!result.stdout.includes('Synthetic-Not-An-Input')); assert(!result.stderr.includes('Synthetic-Not-An-Input'));
});
