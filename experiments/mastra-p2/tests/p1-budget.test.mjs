import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, realpath, lstat, readdir, rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {rates, limits, validateRun} from '../transport.mjs';

const samePath=(left,right)=>process.platform==='win32'?left.toLowerCase()===right.toLowerCase():left===right;

async function removeNewDirectory(directory,temporaryRoot,prefix) {
  assert(samePath(path.dirname(directory),temporaryRoot));
  assert.match(path.basename(directory),new RegExp('^'+prefix+'[a-zA-Z0-9]+$'));
  const stat=await lstat(directory);
  assert(stat.isDirectory()&&!stat.isSymbolicLink());
  assert(samePath(await realpath(directory),directory));
  await rm(directory,{recursive:true,force:false});
}

async function runWithoutKey(t,{entries,budgetCny}) {
  const temporaryRoot=await realpath(os.tmpdir());
  const directory=await mkdtemp(path.join(temporaryRoot,'doon-mastra-p2-'));
  t.after(()=>removeNewDirectory(directory,temporaryRoot,'doon-mastra-p2-'));
  const marker={application:'doon-mastra-p2',syntheticOnly:true,budgetCny};
  // Prior requests with unknown usage retain their full reservations. They are
  // synthetic records, not copied from a live run or a provider response.
  const ledger={format:1,budgetCny,rates,entries:Array.from({length:entries},(_,index)=>({
    id:index+1,caseId:'synthetic-prior',phase:'initial',thinking:'enabled',stream:false,
    state:'network-error',reservedCny:0.125,chargedCny:0.125,usageKnown:false,
    requestReasoning:[],
  })),chargedUpperCny:entries*0.125};
  const markerBytes=JSON.stringify(marker)+'\n',ledgerBytes=JSON.stringify(ledger)+'\n';
  await writeFile(path.join(directory,'run.json'),markerBytes,{flag:'wx'});
  await writeFile(path.join(directory,'budget.json'),ledgerBytes,{flag:'wx'});
  assert.equal(await validateRun(directory),directory);

  const preexistingSandboxes=new Set((await readdir(temporaryRoot)).filter(name=>name.startsWith('doon-mastra-p1-')));
  const auditFile=path.join(directory,'offline-fetch-audit.json');
  const preload=`import {writeFileSync} from 'node:fs';
    let fetchCalls=0,keyChecks=0;
    process.env=new Proxy(process.env,{get(target,name){
      if(name==='DEEPSEEK_API_KEY'){keyChecks++;return undefined;}
      return Reflect.get(target,name);
    }});
    globalThis.fetch=async()=>{fetchCalls++;throw new Error('P1_TEST_NETWORK_FORBIDDEN');};
    process.once('exit',()=>writeFileSync(${JSON.stringify(auditFile)},JSON.stringify({fetchCalls,keyChecks}),{flag:'wx'}));`;
  const child=spawnSync(process.execPath,[
    '--import','data:text/javascript,'+encodeURIComponent(preload),
    fileURLToPath(new URL('../p1-live.mjs',import.meta.url)),
    '--live','--synthetic','--budget-ledger',directory,
  ],{
    encoding:'utf8',windowsHide:true,timeout:30_000,
    // No inherited environment, NODE_OPTIONS, API key, or --env-file. These
    // explicit temp paths keep every newly-created sandbox in the same root.
    env:{TEMP:temporaryRoot,TMP:temporaryRoot,TMPDIR:temporaryRoot},
  });
  assert.equal(child.error,undefined);
  assert.equal(child.signal,null);
  assert.equal(child.status,1);
  assert.equal(child.stderr,'');
  const lines=child.stdout.trim().split(/\r?\n/);
  assert.equal(lines.length,1);
  assert.match(lines[0],/^P1_LIVE_RESULT /);
  const result=JSON.parse(lines[0].slice('P1_LIVE_RESULT '.length));
  if(result.sandbox) {
    const sandbox=path.resolve(result.sandbox);
    assert(samePath(path.dirname(sandbox),temporaryRoot));
    assert.match(path.basename(sandbox),/^doon-mastra-p1-[a-zA-Z0-9]+$/);
    assert(!preexistingSandboxes.has(path.basename(sandbox)));
    assert.deepEqual(JSON.parse(await readFile(path.join(sandbox,'synthetic-sandbox.json'),'utf8')),
      {application:'doon-mastra-p1',format:1,syntheticOnly:true});
    // Only the newly-created child-process sandbox is eligible for cleanup.
    t.after(()=>removeNewDirectory(sandbox,temporaryRoot,'doon-mastra-p1-'));
  }
  assert(samePath(path.dirname(result.reportFile),directory));
  assert.match(path.basename(result.reportFile),/^p1-\d+\.json$/);
  const report=JSON.parse(await readFile(result.reportFile,'utf8'));
  assert.equal(result.status,'failed');
  assert.equal(result.providerRequests,0);
  assert.equal(result.cumulativeChargedUpperCny,ledger.chargedUpperCny);
  assert.equal(report.status,'failed');
  assert.equal(report.providerRequests,0);
  assert.equal(report.totalProviderRequests,entries);
  assert.equal(report.currentEstimatedPeakUncachedCny,0);
  assert.equal(report.cumulativeChargedUpperCny,ledger.chargedUpperCny);
  assert.equal(report.requestsWithoutKnownUsage,0);
  assert.equal(report.costVerificationUnavailable,undefined);
  const audit=JSON.parse(await readFile(auditFile,'utf8'));
  assert.equal(audit.fetchCalls,0);
  assert.equal(await readFile(path.join(directory,'run.json'),'utf8'),markerBytes);
  assert.equal(await readFile(path.join(directory,'budget.json'),'utf8'),ledgerBytes);
  assert.deepEqual((await readdir(directory)).sort(),[
    'budget.json','offline-fetch-audit.json',path.basename(result.reportFile),'run.json',
  ].sort());
  return {report,result,audit};
}

test('P1 refuses seventeen prior requests before setup and preserves cumulative reservations',async t=>{
  assert.equal(limits.requests,24);
  const {report,result,audit}=await runWithoutKey(t,{entries:17,budgetCny:10});
  assert.equal(audit.keyChecks,0);
  assert.equal(report.failedStage,'preflight');
  assert.equal(report.errorCode,'P1_INSUFFICIENT_REQUEST_ALLOWANCE');
  assert.equal(result.sandbox,null);
  assert.equal(report.sandbox,null);
});

test('P1 missing-key setup failure reports prior costs without resetting or increasing a five-yuan ledger',async t=>{
  const {report,result,audit}=await runWithoutKey(t,{entries:2,budgetCny:5});
  assert(audit.keyChecks>0,'Setup must reach the missing-key check, not fail at an earlier dependency or server step.');
  assert.equal(report.failedStage,'setup');
  assert.equal(report.errorCode,'P1_LIVE_VALIDATION_FAILED');
  assert.equal(report.priorProviderRequests,2);
  assert.equal(report.priorChargedUpperCny,0.25);
  assert.equal(report.ledgerBudgetCny,5);
  assert.equal(typeof result.sandbox,'string');
  assert.equal(report.sandbox,result.sandbox);
});
