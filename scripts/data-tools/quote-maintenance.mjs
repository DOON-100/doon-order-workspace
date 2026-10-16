// Explicit server-side maintenance. Never invoked during application startup.
// Configs, reports and snapshots are private data, not source-control inputs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync,backup} from 'node:sqlite';
import {check,hash,fingerprint,equal,normalize,omit,totalExtras,regularFile,fileHashes,parseOptions,loadConfig,mediaIdentity,MaintenanceError} from './lib/quote-maintenance-core.mjs';

const readRows = db => db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();
// Deliberately excludes passwords, sessions, login state and all secret columns.
const readAccounts = db => db.prepare('SELECT id,username,member_id,must_change,created_at FROM local_accounts ORDER BY id').all();
const within = (parent,child) => { const relative=path.relative(parent,child); return relative === '' || !relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative); };
let reportPath,report,checkpointDir,runtime,transactionOpen=false,committed=false;
const createdFiles=new Map(),temporaryFiles=new Set();
async function main() {
  const options=parseOptions(process.argv.slice(2));
  const configPath=path.resolve(options['--config']), buildDir=path.resolve(options['--build']), dataDir=path.resolve(options['--data']);
  const candidateReport=path.resolve(options['--report']), mode=options['--apply']?'apply':'rehearsal';
  check(!within(dataDir,candidateReport) && !within(buildDir,candidateReport) && candidateReport !== configPath && candidateReport !== path.resolve(options['--preflight'] || configPath), 'REPORT_MUST_BE_SEPARATE');
  try { await fs.lstat(candidateReport); throw new MaintenanceError('REPORT_ALREADY_EXISTS'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const {config,configHash}=await loadConfig(configPath);
  for(const directory of [dataDir,path.join(dataDir,'files'),buildDir]) { const stat=await fs.lstat(directory); check(stat.isDirectory() && !stat.isSymbolicLink(),'EXPECTED_EXISTING_DIRECTORY'); }
  for(const filename of [path.join(dataDir,'workspace.sqlite'),path.join(buildDir,'runtime.mjs'),path.join(buildDir,'workspace-api.mjs')]) await regularFile(filename);
  // Read-only validation must happen before importing runtime (which can create a DB).
  const original=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
  try {
    check(Object.values(original.prepare('PRAGMA integrity_check').get())[0]==='ok','DATABASE_INTEGRITY_FAILED');
    check(readRows(original).length > 0 && readAccounts(original).length > 0,'EMPTY_OR_UNINITIALIZED_DATABASE');
  } finally { original.close(); }
  const ownDirectory=path.dirname(fileURLToPath(import.meta.url));
  const input={schemaVersion:1,operation:config.operation,configHash,
    scriptHash:hash(await fs.readFile(fileURLToPath(import.meta.url))),
    helperHash:hash(await fs.readFile(path.join(ownDirectory,'lib/quote-maintenance-core.mjs'))),
    bundleHash:hash(await fs.readFile(path.join(buildDir,'workspace-api.mjs'))),runtimeHash:hash(await fs.readFile(path.join(buildDir,'runtime.mjs'))),
    dataDir:await fs.realpath(dataDir),buildDir:await fs.realpath(buildDir),nodeVersion:process.version,
    attachments:config.operation==='create'?config.prepared.map(item=>({source:item.source.sha256,media:item.media.map(entry=>entry.sha256)})):[],
  };
  if(mode==='apply') {
    await regularFile(path.resolve(options['--preflight']));
    const preflight=JSON.parse(await fs.readFile(path.resolve(options['--preflight']),'utf8'));
    check(preflight.mode==='rehearsal' && preflight.success===true && preflight.preserved===true && preflight.accessVerified===true && equal(preflight.input,input),'PREFLIGHT_BINDING_MISMATCH');
    const age=Date.now()-Date.parse(preflight.at);
    check(age>=0 && age<24*3600*1000,'PREFLIGHT_EXPIRED');
  }
  await fs.mkdir(path.dirname(candidateReport),{recursive:true});
  // Check real parents as well, so a symlinked report directory cannot enter live data.
  const realReport=path.join(await fs.realpath(path.dirname(candidateReport)),path.basename(candidateReport));
  check(!within(input.dataDir,realReport) && !within(input.buildDir,realReport),'REPORT_MUST_BE_SEPARATE');
  const checkpointRoot=path.join(path.dirname(realReport),'checkpoints'),configDirectory=await fs.realpath(path.dirname(configPath));
  check(!within(input.dataDir,checkpointRoot) && !within(input.buildDir,checkpointRoot) && !within(configDirectory,checkpointRoot),'CHECKPOINT_MUST_BE_SEPARATE');
  try { await fs.mkdir(checkpointRoot); } catch(error) { if(error.code !== 'EEXIST') throw error; }
  const rootStat=await fs.lstat(checkpointRoot);
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink() && await fs.realpath(checkpointRoot)===checkpointRoot,'UNSAFE_CHECKPOINT_DIRECTORY');
  reportPath=candidateReport;
  const at=new Date().toISOString();
  report={schemaVersion:1,mode,at,input,success:false,preserved:false,accessVerified:false};
  checkpointDir=path.join(checkpointRoot,`${mode}-${randomUUID()}`);
  await fs.mkdir(checkpointDir);
  const checkpointStat=await fs.lstat(checkpointDir);
  check(checkpointStat.isDirectory() && !checkpointStat.isSymbolicLink() && await fs.realpath(checkpointDir)===checkpointDir,'UNSAFE_CHECKPOINT_DIRECTORY');
  const snapshotSource=new DatabaseSync(path.join(dataDir,'workspace.sqlite'),{readOnly:true});
  try { await backup(snapshotSource,path.join(checkpointDir,'workspace.sqlite')); } finally { snapshotSource.close(); }
  await fs.cp(path.join(dataDir,'files'),path.join(checkpointDir,'files'),{recursive:true,errorOnExist:true,force:false});
  await fs.mkdir(path.join(checkpointDir,'code'));
  for(const name of ['runtime.mjs','workspace-api.mjs']) await fs.copyFile(path.join(buildDir,name),path.join(checkpointDir,'code',name));
  const snapshot=new DatabaseSync(path.join(checkpointDir,'workspace.sqlite'),{readOnly:true});
  let baseline,accounts;
  try { check(Object.values(snapshot.prepare('PRAGMA integrity_check').get())[0]==='ok','SNAPSHOT_INTEGRITY_FAILED'); baseline=readRows(snapshot); accounts=readAccounts(snapshot); } finally { snapshot.close(); }
  const originalFiles=await fileHashes(path.join(checkpointDir,'files'));
  await fs.writeFile(path.join(checkpointDir,'manifest.json'),JSON.stringify({schemaVersion:1,at,input,recordCount:baseline.length,recordsHash:fingerprint(baseline),accountIdentityHash:fingerprint(accounts),attachmentCount:Object.keys(originalFiles).length,attachmentsHash:fingerprint(originalFiles)},null,2),{flag:'wx'});
  const targetData=mode==='apply'?dataDir:checkpointDir;
  process.env.DOON_DATA_DIR=targetData;
  check(hash(await fs.readFile(path.join(buildDir,'runtime.mjs')))===input.runtimeHash && hash(await fs.readFile(path.join(buildDir,'workspace-api.mjs')))===input.bundleHash,'BUILD_CHANGED_DURING_SNAPSHOT');
  runtime=await import(pathToFileURL(path.join(buildDir,'runtime.mjs')).href);
  const api=await import(pathToFileURL(path.join(buildDir,'workspace-api.mjs')).href);
  check(path.resolve(runtime.dataDir)===path.resolve(targetData),'RUNTIME_TARGET_MISMATCH');
  const savedBatch=runtime.env.DB.batch,savedPut=runtime.env.BUCKET.put;
  const initial=baseline.map(row=>JSON.parse(row.data)),baselineIds=new Set(baseline.map(row=>row.id));
  const getEntities=()=>readRows(runtime.db).map(row=>JSON.parse(row.data));
  const getQuote=id=>getEntities().find(value=>value.kind==='customer_quote' && value.id===id);
  const updatedId=config.operation==='update-fees'?config.update.before.id:null;
  const createdQuoteIds=new Set(),createdMediaIds=new Set();
  function verifyPreserved(updated=false) {
    const current=new Map(readRows(runtime.db).map(row=>[row.id,row]));
    for(const row of baseline) if(!(updated && row.id===updatedId)) check(equal(current.get(row.id),row),'ORIGINAL_RECORD_CHANGED');
    check(equal(readAccounts(runtime.db),accounts),'ACCOUNT_IDENTITY_CHANGED');
  }
  async function verifyFiles() {
    const actual=await fileHashes(path.join(targetData,'files'));
    for(const [name,digest] of Object.entries(originalFiles)) check(actual[name]===digest,'ORIGINAL_ATTACHMENT_CHANGED');
    for(const [name,digest] of createdFiles) check(actual[name]===digest,'CREATED_ATTACHMENT_CHANGED');
    check(Object.keys(actual).length===Object.keys(originalFiles).length+createdFiles.size,'UNEXPECTED_ATTACHMENT');
    return actual;
  }
  function identity(username) {
    const matches=accounts.filter(account=>account.username.toLowerCase()===username.toLowerCase());
    check(matches.length===1,'ACCOUNT_NOT_UNIQUE');
    const member=initial.find(value=>value.kind==='member' && value.id===matches[0].member_id);
    check(member?.active && member.userId===matches[0].id,'ACCOUNT_MEMBER_MISMATCH');
    return member;
  }
  const actor=identity(config.actor.username);
  check(actor.role==='admin' && actor.owner,'OWNER_MAINTENANCE_REQUIRED');
  const readers=[actor,...config.readers.map(reader=>identity(reader.username))].filter((member,i,all)=>all.findIndex(value=>value.id===member.id)===i);
  const customer=initial.find(value=>value.kind==='customer_account' && value.id===config.customer.id);
  check(customer?.active && Object.entries(config.customer).every(([key,value])=>customer[key]===value),'EXISTING_CUSTOMER_MISMATCH');
  for(const expected of config.preconditions||[]) {
    const record=initial.find(value=>value.id===expected.id && value.kind===expected.kind);
    check(record && fingerprint(record)===expected.sha256,'RECORD_PRECONDITION_CHANGED');
  }
  async function request(member,action,body,params={}) {
    const method=body===undefined?'GET':'POST';
    const url=new URL(`http://maintenance.invalid/api/workspace/${action}`);
    for(const [key,value] of Object.entries(params)) url.searchParams.set(key,String(value));
    const req=new Request(url,{method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
    const response=await runtime.context.run({identity:{userId:member.userId,email:member.email,displayName:member.name,fullName:member.name}},()=>api[method](req,{params:Promise.resolve({action})}));
    check(response.ok,'BUSINESS_API_REJECTED'); // Never include API error bodies or business values in reports.
    return response;
  }
  const call=async(...args)=>(await request(...args)).json();
  const accessBefore=new Map();
  const observedAccess=view=>{
    const account=view.customers.find(value=>value.id===customer.id);
    return {canUse:!!view.canUse,canRead:!!account,canWrite:!!account?.canWrite,canSeeInternal:!!account?.canSeeInternal,canSeeReviewDetails:!!account?.canSeeReviewDetails};
  };
  async function verifyAccess(quote,media,sourceHash) {
    // Original pricing workbooks can contain internal costs; only the owner reads them.
    const sourceResponse=await request(actor,'customer-quote-file',undefined,{id:quote.id});
    check(hash(Buffer.from(await sourceResponse.arrayBuffer()))===sourceHash,'SOURCE_DOWNLOAD_MISMATCH');
    for(const member of readers) {
      const response=await call(member,'customer-quotes'),previous=accessBefore.get(member.id);
      check(equal(observedAccess(response),previous),'ACCOUNT_ACCESS_CHANGED');
      const view=response.quotes.find(value=>value.id===quote.id);
      if(!previous.canRead) { check(!view,'UNEXPECTED_QUOTE_ACCESS'); continue; }
      check(view && !!view.canEdit===previous.canWrite && view.status==='draft' && view.version===quote.version && view.customerAccountId===customer.id,'QUOTE_ACCESS_FAILED');
      check(view.lines.length===quote.lines.length && view.lines.every((line,i)=>['id','model','unitPrice','quantity','toolingFee'].every(key=>equal(line[key],quote.lines[i][key]))),'PUBLIC_QUOTE_MISMATCH');
      check(equal(view.customerCharges||[],quote.customerCharges||[]),'PUBLIC_CHARGES_MISMATCH');
      check(Array.isArray(view.media) && view.media.length===media.length && media.every(item=>view.media.some(entry=>entry.id===item.id)),'PUBLIC_MEDIA_MISMATCH');
      for(const item of media) { const response=await request(member,'customer-quote-media-file',undefined,{id:item.id}); check(hash(Buffer.from(await response.arrayBuffer()))===item.sha256,'MEDIA_DOWNLOAD_MISMATCH'); }
    }
  }
  let expectedRevisionCount=0,expectedAttachmentCount=0;
  try {
    runtime.db.exec('BEGIN IMMEDIATE'); transactionOpen=true;
    check(equal(readRows(runtime.db),baseline) && equal(readAccounts(runtime.db),accounts),'DATABASE_CHANGED_AFTER_SNAPSHOT');
    check(equal(await fileHashes(path.join(targetData,'files')),originalFiles),'ATTACHMENTS_CHANGED_AFTER_SNAPSHOT');
    runtime.env.DB.batch=async statements=>{
      const name=`maintenance_${randomUUID().replaceAll('-','')}`;
      runtime.db.exec(`SAVEPOINT ${name}`);
      try { const values=statements.map(statement=>runtime.db.prepare(statement.sql).run(...statement.args)); runtime.db.exec(`RELEASE ${name}`); return values; }
      catch(error) { runtime.db.exec(`ROLLBACK TO ${name}`); runtime.db.exec(`RELEASE ${name}`); throw error; }
    };
    runtime.env.BUCKET.put=async(key,value)=>{
      check(config.operation==='create','UPDATE_ATTACHMENT_WRITE_FORBIDDEN');
      const name=hash(String(key)),bytes=Buffer.from(value),target=path.join(targetData,'files',name),temporary=target+'.'+randomUUID()+'.tmp';
      check(!Object.hasOwn(originalFiles,name) && !createdFiles.has(name),'IMMUTABLE_ATTACHMENT_EXISTS');
      temporaryFiles.add(temporary);
      await fs.writeFile(temporary,bytes,{flag:'wx'});
      await fs.link(temporary,target); // Exclusive creation: never replace an existing attachment.
      createdFiles.set(name,hash(bytes));
      await fs.unlink(temporary); temporaryFiles.delete(temporary);
    };
    for(const member of readers) {
      const view=await call(member,'customer-quotes');
      accessBefore.set(member.id,observedAccess(view));
      if(member.id===actor.id) check(accessBefore.get(member.id).canWrite,'CUSTOMER_WRITE_ACCESS_FAILED');
    }
    if(config.operation==='create') {
      for(const item of config.prepared) {
        const matches=getEntities().filter(value=>value.kind==='customer_quote' && value.quoteNo===item.payload.quoteNo);
        check(matches.length<=1,'EXISTING_QUOTE_NOT_UNIQUE');
        let quote=matches[0];
        if(quote) {
          check(quote.status==='draft' && equal(normalize(quote),item.payload) && quote.sourceHash===item.source.sha256 && quote.sourceFileKey,'EXISTING_QUOTE_CONFLICT');
        } else {
          const saved=await call(actor,'customer-quote-save',item.payload);
          quote=getQuote(saved.quote.id);
          check(quote?.status==='draft' && quote.version===1 && equal(normalize(quote),item.payload),'CREATED_PAYLOAD_MISMATCH');
          createdQuoteIds.add(quote.id);
          const form=new FormData(); form.set('quoteId',quote.id); form.set('version',String(quote.version)); form.set('file',new File([item.source.bytes],item.source.filename,{type:item.source.mime}));
          await call(actor,'customer-quote-upload',form); quote=getQuote(quote.id);
          check(quote.version===2,'SOURCE_VERSION_MISMATCH');
          for(const entry of item.media) {
            const version=quote.version,upload=new FormData(); upload.set('quoteId',quote.id); upload.set('quoteVersion',String(version)); upload.set('lineId',entry.lineId); upload.set('category',entry.category); upload.set('file',new File([entry.bytes],entry.filename,{type:entry.mime}));
            const answer=await call(actor,'customer-quote-media-upload',upload);
            check(!answer.alreadyPresent,'UNEXPECTED_EXISTING_MEDIA'); createdMediaIds.add(answer.media.id);
            quote=getQuote(quote.id); check(quote.version===version+1,'MEDIA_VERSION_MISMATCH');
          }
          expectedRevisionCount+=item.media.length+2;
          expectedAttachmentCount+=item.media.length+1;
        }
        check(quote.status==='draft' && equal(normalize(quote),item.payload) && quote.sourceHash===item.source.sha256 && quote.sourceFilename===item.source.filename,'FINAL_PAYLOAD_MISMATCH');
        const media=getEntities().filter(value=>value.kind==='customer_quote_media' && value.quoteId===quote.id);
        check(media.length===item.media.length && equal(media.map(mediaIdentity).sort(),item.media.map(mediaIdentity).sort()) && equal([...(quote.mediaIds||[])].sort(),media.map(value=>value.id).sort()),'STORED_MEDIA_MISMATCH');
        for(const entry of item.media) {
          const stored=media.find(value=>mediaIdentity(value)===mediaIdentity(entry));
          check(stored.customerAccountId===customer.id && stored.supplement===false && stored.quoteVersion<=quote.version && stored.size===entry.bytes.length && stored.contentType===entry.mime,'MEDIA_METADATA_MISMATCH');
        }
        await verifyAccess(quote,media,item.source.sha256);
      }
    } else {
      const {before,payload}=config.update;
      check(equal(getQuote(before.id),before),'QUOTE_VERSION_OR_CONTENT_CHANGED');
      for(const member of readers) {
        const quote=(await call(member,'customer-quotes')).quotes.find(value=>value.id===before.id),access=accessBefore.get(member.id);
        check(access.canRead ? quote && !!quote.canEdit===access.canWrite && quote.version===before.version : !quote,'UPDATE_ACCESS_FAILED');
      }
      await call(actor,'customer-quote-save',{id:before.id,version:before.version,...payload});
      const quote=getQuote(before.id),expected={...before,...payload,version:before.version+1};
      check(equal(omit(quote,['updatedAt','updatedBy','updatedById']),omit(expected,['updatedAt','updatedBy','updatedById'])) && equal(normalize(quote),payload),'UPDATED_PAYLOAD_MISMATCH');
      check(Math.abs(totalExtras(quote)-config.update.expectedExtraTotal)<1e-8,'SAVED_EXTRA_TOTAL_MISMATCH');
      const media=getEntities().filter(value=>value.kind==='customer_quote_media' && before.mediaIds.includes(value.id));
      check(media.length===before.mediaIds.length,'EXISTING_MEDIA_MISSING');
      await verifyAccess(quote,media,before.sourceHash); expectedRevisionCount=1;
    }
    verifyPreserved(config.operation==='update-fees'); await verifyFiles();
    check(createdFiles.size===expectedAttachmentCount,'ATTACHMENT_COUNT_MISMATCH');
    const added=readRows(runtime.db).filter(row=>!baselineIds.has(row.id));
    const targets=new Set([...createdQuoteIds,...createdMediaIds,...(updatedId?[updatedId]:[])]);
    for(const row of added) {
      const value=JSON.parse(row.data);
      check(row.kind==='customer_quote' && createdQuoteIds.has(value.id) || row.kind==='customer_quote_media' && createdMediaIds.has(value.id) && createdQuoteIds.has(value.quoteId) || row.kind==='customer_quote_revision' && (createdQuoteIds.has(value.quoteId) || value.quoteId===updatedId) || row.kind==='audit' && targets.has(value.targetId) && value.actorId===actor.id,'UNEXPECTED_ADDED_RECORD');
    }
    check(added.filter(row=>row.kind==='customer_quote_revision').length===expectedRevisionCount,'REVISION_COUNT_MISMATCH');
    if(updatedId) {
      check(added.length===2,'UPDATE_ADDED_RECORD_COUNT');
      const revision=added.filter(row=>row.kind==='customer_quote_revision').map(row=>JSON.parse(row.data))[0];
      check(revision.version===config.update.before.version+1 && equal(revision.snapshot,getQuote(updatedId)),'UPDATE_REVISION_MISMATCH');
    }
    check(Object.values(runtime.db.prepare('PRAGMA integrity_check').get())[0]==='ok','FINAL_DATABASE_INTEGRITY_FAILED');
    report={...report,accessVerified:true,preserved:true,recordCountBefore:baseline.length,originalRecordsHash:fingerprint(baseline),originalAttachmentCount:Object.keys(originalFiles).length,originalAttachmentsHash:fingerprint(originalFiles),createdQuoteCount:createdQuoteIds.size,updatedQuoteCount:updatedId?1:0,createdAttachmentCount:createdFiles.size,recordsAdded:added.reduce((counts,row)=>(counts[row.kind]=(counts[row.kind]||0)+1,counts),{}),finalRecordsHash:fingerprint(readRows(runtime.db)),integrity:'ok'};
    runtime.db.exec('COMMIT'); transactionOpen=false; committed=true; report.success=true;
  } catch(error) {
    if(transactionOpen) { runtime.db.exec('ROLLBACK'); transactionOpen=false; }
    for(const [name,digest] of createdFiles) {
      const target=path.join(targetData,'files',name);
      check(hash(await fs.readFile(target))===digest,'ROLLBACK_ATTACHMENT_CHANGED');
      await fs.unlink(target);
    }
    createdFiles.clear();
    for(const target of temporaryFiles) { await fs.rm(target,{force:true}); }
    temporaryFiles.clear();
    verifyPreserved(false); await verifyFiles(); report.preserved=true; report.transactionRolledBack=true;
    throw error;
  } finally {
    runtime.env.DB.batch=savedBatch; runtime.env.BUCKET.put=savedPut;
    runtime.db.close(); runtime=null;
  }
}
try { await main(); }
catch(error) {
  const errorCode=error instanceof MaintenanceError?error.code:'MAINTENANCE_FAILED';
  if(runtime) { try { if(transactionOpen) runtime.db.exec('ROLLBACK'); runtime.db.close(); } catch {} }
  report={...report,success:false,errorCode,committed};
  process.exitCode=1;
}
if(reportPath) {
  try { await fs.writeFile(reportPath,JSON.stringify({...report,checkpointDir},null,2),{flag:'wx'}); }
  catch { report={...report,success:false,errorCode:'REPORT_WRITE_FAILED',committed}; process.exitCode=1; }
}
console.log(JSON.stringify({success:report?.success===true,mode:report?.mode,preserved:report?.preserved===true,createdQuoteCount:report?.createdQuoteCount,updatedQuoteCount:report?.updatedQuoteCount,createdAttachmentCount:report?.createdAttachmentCount,errorCode:report?.errorCode,committed}));
