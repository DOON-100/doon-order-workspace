import assert from 'node:assert/strict';
import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validateRun,writeRunJson} from './transport.mjs';

export async function verifyRun(directoryArg) {
const directory=await validateRun(directoryArg);
const marker=JSON.parse(await readFile(path.join(directory,'run.json'),'utf8'));
const summary=JSON.parse(await readFile(path.join(directory,'summary.json'),'utf8'));
const ledger=JSON.parse(await readFile(path.join(directory,'budget.json'),'utf8'));
const roundUp=value=>Math.ceil(value*1e6)/1e6;
assert.equal(summary.status,'passed');
assert.equal(summary.budgetCny,marker.budgetCny,'P2_SUMMARY_BUDGET_MISMATCH');
assert.equal(ledger.budgetCny,marker.budgetCny,'P2_LEDGER_BUDGET_MISMATCH');
assert(ledger.entries.every(entry=>Number.isFinite(entry.chargedCny)&&entry.chargedCny>=0));
assert.equal(ledger.chargedUpperCny,roundUp(ledger.entries.reduce((sum,entry)=>sum+entry.chargedCny,0)));
assert.equal(summary.phases.length,12);
assert(summary.phases.every(phase=>phase.status==='passed'&&phase.assertionsPassed));
assert(ledger.chargedUpperCny<=summary.budgetCny && !ledger.budgetViolation);
const cases=[...new Set(summary.phases.map(phase=>phase.caseId))];
assert.equal(cases.length,8);
const requests=ledger.entries.filter(entry=>cases.includes(entry.caseId));
assert.equal(requests.length,16);
assert(requests.every(entry=>entry.httpStatus===200&&entry.state==='complete'&&entry.usageKnown&&typeof entry.stream==='boolean'));
const expectedModes=['enabled','disabled'].flatMap(thinking=>['generate','stream','suspend','approve','suspend','decline'].map(mode=>thinking+':'+mode)).sort();
assert.deepEqual(summary.phases.map(phase=>phase.thinking+':'+phase.mode).sort(),expectedModes);
let reasoningRoundtrips=0,crossProcessDecisions=0;
for(const caseId of cases) {
  const entries=requests.filter(entry=>entry.caseId===caseId);
  assert.equal(entries.length,2);
  assert.equal(entries[0].thinking,entries[1].thinking);
  if(entries[0].thinking==='enabled') {
    assert(entries[0].responseReasoning?.characters>0);
    assert(entries[1].requestReasoning.some(item=>item.sha256===entries[0].responseReasoning.sha256));
    reasoningRoundtrips++;
  } else assert(entries.every(entry=>!entry.responseReasoning && !entry.requestReasoning.length));
  const phases=summary.phases.filter(phase=>phase.caseId===caseId);
  if(phases.length===2) {
    const [pending,resumed]=phases;
    assert.equal(pending.finishReason,'suspended');assert.equal(pending.effects,0);
    assert.equal(pending.mode,'suspend');assert(['approve','decline'].includes(resumed.mode));
    assert(Number.isInteger(pending.pid)&&pending.pid>0&&Number.isInteger(resumed.pid)&&resumed.pid>0);
    assert.notEqual(pending.pid,resumed.pid);
    assert.equal(resumed.resumedRunId,pending.runId);assert.equal(resumed.resumedToolCallId,pending.toolCallId);
    assert.equal(resumed.effects,resumed.mode==='approve'?1:0);
    assert.equal(resumed.finishReason,'stop');
    crossProcessDecisions++;
  } else {
    assert.equal(phases.length,1);assert(['generate','stream'].includes(phases[0].mode));
    assert.equal(phases[0].readCalls,1);assert.equal(phases[0].effects,0);assert.equal(phases[0].finishReason,'stop');
  }
}
assert.equal(reasoningRoundtrips,4);assert.equal(crossProcessDecisions,4);
// Optional local-only credential leak check; print neither values nor file bytes.
let credentialFilesChecked=0;
if(process.env.DEEPSEEK_API_KEY) {
  const key=Buffer.from(process.env.DEEPSEEK_API_KEY);
  for(const name of await readdir(directory)) {
    const file=path.join(directory,name),stat=await lstat(file);
    assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
    assert(!(await readFile(file)).includes(key),'P2_CREDENTIAL_LEAK_DETECTED');
    credentialFilesChecked++;
  }
}
const durations=requests.map(entry=>entry.durationMs).sort((a,b)=>a-b);
const result={
  status:'passed',model:'deepseek-v4-pro',provider:'DeepSeek official',workerPhases:12,scenarios:8,providerRequests:requests.length,
  usageScope:'current-attempt',httpModeRequests:{json:requests.filter(entry=>!entry.stream).length,sse:requests.filter(entry=>entry.stream).length},
  reasoningHashRoundtrips:reasoningRoundtrips,crossProcessDecisions,
  inputTokens:requests.reduce((sum,item)=>sum+item.usage.inputTokens,0),outputTokens:requests.reduce((sum,item)=>sum+item.usage.outputTokens,0),
  cacheHitTokens:requests.reduce((sum,item)=>sum+item.usage.cacheHitTokens,0),
  currentAttemptEstimatedPeakUncachedCny:roundUp(requests.reduce((sum,entry)=>sum+entry.chargedCny,0)),
  cumulativeChargedUpperCny:ledger.chargedUpperCny,priorProviderRequests:ledger.entries.length-requests.length,budgetCny:marker.budgetCny,
  requestMedianMs:(durations[7]+durations[8])/2,requestMaxMs:durations.at(-1),elapsedMs:Date.parse(summary.finishedAt)-Date.parse(summary.startedAt),
  credentialFilesChecked,approvalMode:'simulated-human-decisions',
};
await writeRunJson(directory,'verification.json',result);
return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await verifyRun(process.argv[2])));
}
