import {readFile,readdir,lstat} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {validateRun,writeRunJson,limits} from './transport.mjs';

// Provider errors and SDK logs may contain model data: retain safe summaries only.
const print=process.stdout.write.bind(process.stdout);
const discard=(_chunk,encoding,callback)=>{const cb=typeof encoding==='function'?encoding:callback;if(typeof cb==='function')queueMicrotask(cb);return true;};
process.stdout.write=discard;process.stderr.write=discard;
process.env.MASTRA_DEV='false';process.env.MASTRA_AUTO_REFRESH_PROVIDERS='false';process.env.MASTRA_OFFLINE='true';
const args=process.argv.slice(2),attemptId='p1-'+Date.now();
let budgetDirectory,sandbox,server,reader,writer,identity,report,stage='preflight';
try {
  assert(args.length===4&&args[0]==='--live'&&args[1]==='--synthetic'&&args[2]==='--budget-ledger','P1_EXPLICIT_FLAGS_REQUIRED');
  // Continuing requires an existing ledger. There is deliberately no fresh-budget option.
  budgetDirectory=await validateRun(args[3]);
  const before=JSON.parse(await readFile(path.join(budgetDirectory,'budget.json'),'utf8'));
  assert(before.entries.length>0&&before.chargedUpperCny<=before.budgetCny&&before.budgetCny<=10&&!before.budgetViolation);
  assert(before.entries.length+8<=limits.requests,'P1_INSUFFICIENT_REQUEST_ALLOWANCE');
  report={status:'running',attemptId,startedAt:new Date().toISOString(),synthetic:true,model:'deepseek-v4-pro',thinking:'enabled',
    priorProviderRequests:before.entries.length,priorChargedUpperCny:before.chargedUpperCny,ledgerBudgetCny:before.budgetCny,authorizedCumulativeLimitCny:10,runs:[]};
  await writeRunJson(budgetDirectory,attemptId+'.json',report);
  stage='setup';
  const [{createP2Model},{createSyntheticState},{createReadAdapter},{createSandbox,openSuggestionStore,sandboxDigest},
    {createProjectIdentity},{startReadonlyServer,syntheticSession},{generateSyntheticSuggestions}]=await Promise.all([
      import('./model.mjs'),import('../mastra-p1/fixtures.mjs'),import('../mastra-p1/policy.mjs'),import('../mastra-p1/sandbox.mjs'),
      import('../mastra-p1/project-auth.mjs'),import('../mastra-p1/server.mjs'),import('../mastra-p1/generate.mjs'),
    ]);
  const state=createSyntheticState(),sourceBefore=structuredClone(state),adapter=await createReadAdapter(state);
  sandbox=await createSandbox();reader=await openSuggestionStore(sandbox);writer=await openSuggestionStore(sandbox,{readOnly:false});
  const provision=await createProjectIdentity({state,adapter});identity=provision.identity;
  server=await startReadonlyServer({adapter,store:reader,identity});
  const key=process.env.DEEPSEEK_API_KEY;assert(key);
  for(const suffix of ['a','b']) {
    stage='generate-'+suffix;
    const actorId='syn-employee-'+suffix,credential=provision.credentials.find(item=>item.actorId===actorId);
    const sessionCookie=await syntheticSession(server.origin,{username:credential.username,password:credential.password});
    let auditedRequests=0;
    const caseId=attemptId+'-'+suffix;
    const {model,providerOptions}=await createP2Model({directory:budgetDirectory,thinking:'enabled',caseId,phase:'suggestions',requestAudit:body=>{
      const text=JSON.stringify(body);
      const forbidden=[key,sessionCookie,sessionCookie.slice(sessionCookie.indexOf('=')+1),'PRIVATE','@example.invalid',
        'syn-order-'+(suffix==='a'?'b':'a')+'-',suffix==='a'?'合成客户乙':'合成客户甲',
        ...provision.credentials.flatMap(item=>[item.username,item.password])];
      assert(forbidden.every(value=>!text.includes(value)),'P1_OUTBOUND_BOUNDARY_REJECTED');
      auditedRequests++;
    }});
    const result=await generateSyntheticSuggestions({origin:server.origin,adapter,store:writer,sessionCookie,resolveSession:server.resolveSession,
      model,providerOptions,modelId:'deepseek-v4-pro',runId:'syn-live-'+attemptId+'-'+suffix});
    stage='verify-api-'+suffix;
    assert.equal(result.created,2);assert.equal(result.selected,2);assert.equal(result.readCalls,1);
    const response=await fetch(server.origin+'/api/suggestions',{headers:{cookie:sessionCookie},redirect:'error'});
    assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.items.length,2);
    assert(data.items.every(item=>item.source.id.startsWith('syn-order-'+suffix+'-')&&item.status==='suggested'&&item.runId===result.runId));
    assert.equal((await fetch(server.origin+'/api/orders/syn-order-'+(suffix==='a'?'b':'a')+'-overdue',{headers:{cookie:sessionCookie},redirect:'error'})).status,404);
    report.runs.push({...result,caseId,auditedRequests,visibleSuggestions:data.items.length,crossCustomerStatus:404});
    await writeRunJson(budgetDirectory,attemptId+'.json',report);
  }
  assert.equal(reader.count(),4);assert.deepEqual(state,sourceBefore);
  stage='verify-evidence';
  report.suggestionDatabaseSha256=await sandboxDigest(sandbox);
  const ledger=JSON.parse(await readFile(path.join(budgetDirectory,'budget.json'),'utf8'));
  const entries=ledger.entries.slice(before.entries.length);
  assert(entries.length>=6&&entries.length<=8&&entries.every(item=>item.caseId.startsWith(attemptId)&&item.httpStatus===200&&item.usageKnown&&item.state==='complete'));
  assert(ledger.chargedUpperCny<=ledger.budgetCny&&ledger.chargedUpperCny<=10&&!ledger.budgetViolation);
  report.providerRequests=entries.length;report.totalProviderRequests=ledger.entries.length;
  report.inputTokens=entries.reduce((sum,item)=>sum+item.usage.inputTokens,0);report.outputTokens=entries.reduce((sum,item)=>sum+item.usage.outputTokens,0);
  report.currentEstimatedPeakUncachedCny=Math.ceil(entries.reduce((sum,item)=>sum+item.chargedCny,0)*1e6)/1e6;
  report.cumulativeChargedUpperCny=ledger.chargedUpperCny;
  report.reasoningHashRoundtrips=0;
  for(const run of report.runs) {
    const calls=entries.filter(item=>item.caseId===run.caseId);
    assert.equal(calls.length,run.auditedRequests);
    for(let index=1;index<calls.length;index++) {
      const prior=calls[index-1].responseReasoning;
      assert(prior?.characters>0&&calls[index].requestReasoning.some(item=>item.sha256===prior.sha256));
      report.reasoningHashRoundtrips++;
    }
  }
  // Inspect only newly-created synthetic files. Never copy credentials or snapshots.
  report.credentialFilesChecked=0;
  for(const name of await readdir(sandbox)) {
    const file=path.join(sandbox,name),stat=await lstat(file);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1);
    const bytes=await readFile(file);
    assert([key,...provision.credentials.flatMap(item=>[item.username,item.password])].every(value=>!bytes.includes(Buffer.from(value))));
    report.credentialFilesChecked++;
  }
  report.sourceUnchanged=true;report.status='passed';
} catch(error) {
  process.exitCode=1;
  report??={attemptId,synthetic:true};report.status='failed';report.failedStage=stage;
  report.errorCode=/^P1_[A-Z_]+$/.test(error?.message)?error.message:'P1_LIVE_VALIDATION_FAILED';
} finally {
  try {if(server)await server.close();else await identity?.close();writer?.close();reader?.close();}catch{process.exitCode=1;if(report){report.status='failed';report.errorCode='P1_CLEANUP_FAILED';}}
  if(report){report.finishedAt=new Date().toISOString();report.sandbox=sandbox??null;
    // A failed model run still costs money. Include all reservations, including
    // unknown usage, instead of reporting null/zero after partial completion.
    if(budgetDirectory)try {
      const ledger=JSON.parse(await readFile(path.join(budgetDirectory,'budget.json'),'utf8'));
      const entries=ledger.entries.filter(item=>item.caseId.startsWith(attemptId+'-'));
      report.providerRequests=entries.length;report.totalProviderRequests=ledger.entries.length;
      report.currentEstimatedPeakUncachedCny=Math.ceil(entries.reduce((sum,item)=>sum+item.chargedCny,0)*1e6)/1e6;
      report.cumulativeChargedUpperCny=ledger.chargedUpperCny;
      report.requestsWithoutKnownUsage=entries.filter(item=>!item.usageKnown).length;
    }catch{report.costVerificationUnavailable=true;}
    if(budgetDirectory)try{await writeRunJson(budgetDirectory,attemptId+'.json',report);}catch{process.exitCode=1;report.status='failed';report.errorCode='P1_REPORT_FAILED';}}
  print('P1_LIVE_RESULT '+JSON.stringify({status:report?.status??'failed',reportFile:budgetDirectory?path.join(budgetDirectory,attemptId+'.json'):null,sandbox:sandbox??null,
    providerRequests:report?.providerRequests??null,cumulativeChargedUpperCny:report?.cumulativeChargedUpperCny??null})+'\n');
}
