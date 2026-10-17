import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const token=readFileSync('/run/secrets/api_token','utf8').trim();
const endpoint='http://127.0.0.1:8798';
async function call(path,body){const response=await fetch(endpoint+path,{method:body?'POST':'GET',headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(response.status,200,path);return response.json();}
if(process.argv[2]==='before'){
 assert.equal((await fetch(endpoint+'/agent/run',{method:'POST',body:'{}'})).status,401);
 assert.equal((await fetch(endpoint+'/agent/run',{method:'POST',headers:{authorization:'Bearer '+token,origin:'https://example.invalid'},body:'{}'})).status,403);
 const agent=await call('/agent/run',{});assert.match(agent.text,/SYN-CLOUD-001/);assert.equal(agent.sent,false);
 const review=await call('/workflow/start',{});assert.equal(review.status,'suspended');
 const stored=await call('/verify/persistence',{threadId:agent.threadId,runId:review.runId});assert.ok(stored.messageCount>=2);assert.equal(stored.workflowStatus,'suspended');
 const metrics=await call('/observability');assert.equal(metrics.metricsSupported,true);assert.ok(metrics.metricCount>0);assert.ok(metrics.traceCount>0);assert.ok(metrics.aggregate.value>0);
 console.log(JSON.stringify({phase:'before',threadId:agent.threadId,runId:review.runId,...stored,...metrics}));
}else if(process.argv[2]==='after'){
 let text='';for await(const chunk of process.stdin)text+=chunk;
 const previous=JSON.parse(text);
 const stored=await call('/verify/persistence',previous);assert.ok(stored.messageCount>=2);assert.equal(stored.workflowStatus,'suspended');
 const standby=await call('/workflow/resume',{runId:previous.runId,decision:'standby'});assert.equal(standby.status,'suspended');
 const resumed=await call('/workflow/resume',{runId:previous.runId,decision:'approve'});assert.equal(resumed.status,'success');assert.equal(resumed.result.sent,false);
 const rejectedRun=await call('/workflow/start',{});
 const rejected=await call('/workflow/resume',{runId:rejectedRun.runId,decision:'reject'});assert.equal(rejected.status,'success');assert.equal(rejected.result.decision,'reject');
 const metrics=await call('/observability');assert.ok(metrics.metricCount>=previous.metricCount);assert.ok(metrics.aggregate.value>0);
 console.log(JSON.stringify({phase:'after',memoryPersisted:true,checkpointPersisted:true,standby:standby.status,approved:resumed.status,rejected:rejected.result.decision,...stored,...metrics}));
}else throw new Error('Use before or after');
