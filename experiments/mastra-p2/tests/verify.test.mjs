import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {verifyRun} from '../verify.mjs';

// Entirely synthetic evidence: no API, SDK, credentials, or live-run files.
async function evidence(t,{prior=false}={}) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'doon-mastra-p2-'));
  t.after(async()=>{
    const root=await realpath(directory),temporary=await realpath(os.tmpdir());
    assert.equal(path.dirname(root),temporary);assert.match(path.basename(root),/^doon-mastra-p2-[A-Za-z0-9]+$/);
    await rm(root,{recursive:true});
  });
  const marker={application:'doon-mastra-p2',syntheticOnly:true,budgetCny:5};
  const summary={status:'passed',budgetCny:5,startedAt:'2026-01-01T00:00:00Z',finishedAt:'2026-01-01T00:00:01Z',phases:[]};
  const ledger={budgetCny:5,chargedUpperCny:prior?1.375:0.375,entries:[]};
  if(prior)ledger.entries.push({caseId:'prior-attempt',chargedCny:1,state:'network-error'});
  for(const thinking of ['enabled','disabled'])for(const scenario of ['generate','stream','approve','decline']) {
    const caseId=`synthetic-${thinking}-${scenario}`,approval=['approve','decline'].includes(scenario);
    const common={caseId,thinking,status:'passed',assertionsPassed:true};
    if(approval) {
      summary.phases.push({...common,mode:'suspend',finishReason:'suspended',effects:0,pid:101,runId:caseId,toolCallId:'synthetic-tool'});
      summary.phases.push({...common,mode:scenario,finishReason:'stop',effects:scenario==='approve'?1:0,pid:102,resumedRunId:caseId,resumedToolCallId:'synthetic-tool'});
    } else summary.phases.push({...common,mode:scenario,finishReason:'stop',effects:0,readCalls:1});
    for(let step=0;step<2;step++)ledger.entries.push({
      caseId,thinking,stream:scenario==='stream',chargedCny:step?0.03125:0.015625,httpStatus:200,state:'complete',usageKnown:true,
      usage:{inputTokens:10,outputTokens:5,cacheHitTokens:0},durationMs:100,
      responseReasoning:thinking==='enabled'?{characters:9,sha256:'synthetic-hash-'+caseId}:null,
      requestReasoning:thinking==='enabled'&&step?[{sha256:'synthetic-hash-'+caseId}]:[],
    });
  }
  async function save() {
    for(const [name,value]of Object.entries({run:marker,summary,budget:ledger}))await writeFile(path.join(directory,name+'.json'),JSON.stringify(value));
  }
  await save();return {directory,marker,summary,ledger,save};
}

test('verification distinguishes current-attempt tokens/cost from prior reservations and reports wire modes',async t=>{
  const {directory}=await evidence(t,{prior:true});
  const result=await verifyRun(directory);
  assert.equal(result.providerRequests,16);assert.equal(result.priorProviderRequests,1);
  assert.equal(result.inputTokens,160);assert.equal(result.outputTokens,80);
  assert.equal(result.currentAttemptEstimatedPeakUncachedCny,0.375);assert.equal(result.cumulativeChargedUpperCny,1.375);
  assert.deepEqual(result.httpModeRequests,{json:12,sse:4});
  assert.deepEqual(JSON.parse(await readFile(path.join(directory,'verification.json'),'utf8')),result);
});

test('verification rejects mismatched summary/ledger budget and corrupted accumulated cost',async t=>{
  const c=await evidence(t);
  c.summary.budgetCny=10;await c.save();await assert.rejects(verifyRun(c.directory),/P2_SUMMARY_BUDGET_MISMATCH/);
  c.summary.budgetCny=5;c.ledger.budgetCny=10;await c.save();await assert.rejects(verifyRun(c.directory),/P2_LEDGER_BUDGET_MISMATCH/);
  c.ledger.budgetCny=5;c.ledger.chargedUpperCny=0;await c.save();await assert.rejects(verifyRun(c.directory));
});

test('verification rejects missing reasoning replay or same-process resume evidence',async t=>{
  const c=await evidence(t);
  const replay=c.ledger.entries[1].requestReasoning;
  c.ledger.entries[1].requestReasoning=[];await c.save();await assert.rejects(verifyRun(c.directory));
  c.ledger.entries[1].requestReasoning=replay;
  const resumed=c.summary.phases.find(item=>item.mode==='approve');resumed.pid=101;
  await c.save();await assert.rejects(verifyRun(c.directory));
});
