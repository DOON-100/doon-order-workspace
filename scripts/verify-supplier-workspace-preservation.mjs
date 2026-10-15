// Hash-only, read-only checkpoints around the first preview + commit of one source file.
// Run before the preview, and after its successful commit. Never import the application runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha,regularDirectory,privateOutput,openReadSnapshot,closeReadSnapshot,fingerprint} from './verify-planning-control-preservation.mjs';

const digest=value=>sha(JSON.stringify(value));
class PreservationError extends Error{}
const fail=message=>{throw new PreservationError(message);};
const importKind='kingdee_pending_import',snapshotKind='kingdee_pending_snapshot';

export async function supplierWorkspaceFingerprint(directory){
 const source=await regularDirectory(directory),db=openReadSnapshot(source);
 try{
  const base=await fingerprint(source,db),revisionRows=db.prepare('SELECT id,revision FROM workspace_revision ORDER BY id').all();
  const revision=revisionRows.find(row=>row.id==='main')?.revision;
  if(!Number.isSafeInteger(revision)||revision<0)fail('Invalid workspace revision.');
  const sources={};
  for(const row of db.prepare('SELECT id,kind,data FROM records WHERE kind IN (?,?) ORDER BY id').all(importKind,snapshotKind)){
   const value=JSON.parse(row.data);
   if(!/^[a-f0-9]{64}$/.test(value.hash||'')||!/^[a-f0-9]{64}$/.test(value.rowsHash||''))fail('A source record lacks valid integrity hashes.');
   // No source fields or filenames are written into the checkpoint or console output.
   sources[sha(row.id)]={kindHash:sha(row.kind),sourceHash:value.hash,rowsHash:value.rowsHash,
    filePathHash:sha(sha(String(value.fileKey))),rowsPathHash:sha(sha(String(value.rowsKey))),
    payloadHash:digest({headers:value.headers,metadata:value.metadata,hash:value.hash,rowsHash:value.rowsHash,rowsKey:value.rowsKey,fileKey:value.fileKey}),
    complete:row.kind===snapshotKind||value.status==='已完成',snapshotIdHash:sha(String(value.snapshotId||'')),
    committedRevision:row.kind===snapshotKind?value.committedRevision:null};
  }
  const guards=db.prepare('SELECT id,valid FROM transaction_guards ORDER BY id').all();
  return {...base,format:'supplier-workspace-preservation-v1',revision,otherRevisionsHash:digest(revisionRows.filter(row=>row.id!=='main')),guardsHash:digest(guards),sources};
 }finally{closeReadSnapshot(db);}
}

export function verifySupplierWorkspacePreservation(before,after,expectedHash){
 if(!/^[a-f0-9]{64}$/.test(expectedHash||''))fail('Expected SHA-256 is required.');
 if(before.format!=='supplier-workspace-preservation-v1'||after.format!==before.format)fail('Unsupported checkpoint format.');
 for(const key of ['accountsHash','accountCount','schemaHash','otherRevisionsHash','guardsHash'])if(before[key]!==after[key])fail('Protected '+key+' changed.');
 for(const [id,value] of Object.entries(before.records))if(digest(value)!==digest(after.records[id]))fail('An original record was changed or removed.');
 for(const [id,value] of Object.entries(before.files))if(value!==after.files[id])fail('An original attachment was changed or removed.');
 const importIdHash=sha(importKind+'_'+expectedHash),snapshotIdHash=sha(snapshotKind+'_'+expectedHash);
 const expectedIds=new Set([importIdHash,snapshotIdHash]),addedIds=Object.keys(after.records).filter(id=>!Object.hasOwn(before.records,id));
 const priorCount=[...expectedIds].filter(id=>Object.hasOwn(before.records,id)).length;
 if(priorCount===1)fail('Checkpoint must precede the initial preview, or follow an already completed sync.');
 if(addedIds.some(id=>!expectedIds.has(id))||addedIds.length!==(priorCount?0:2))fail('Unexpected records were added; only the expected source import and snapshot are allowed.');
 const job=after.sources[importIdHash],snapshot=after.sources[snapshotIdHash];
 if(!job||!snapshot||job.kindHash!==sha(importKind)||snapshot.kindHash!==sha(snapshotKind))fail('Expected source records are missing.');
 if(!job.complete||!snapshot.complete||job.snapshotIdHash!==snapshotIdHash)fail('The expected source import is not completed.');
 if(job.sourceHash!==expectedHash||snapshot.sourceHash!==expectedHash||job.payloadHash!==snapshot.payloadHash||job.rowsHash!==snapshot.rowsHash||!/^[a-f0-9]{64}$/.test(snapshot.rowsHash||''))fail('Source record hashes disagree.');
 const filePathHash=sha(sha('kingdee_pending_file_'+expectedHash)),rowsPathHash=sha(sha('kingdee_pending_rows_'+expectedHash));
 if([job,snapshot].some(value=>value.filePathHash!==filePathHash||value.rowsPathHash!==rowsPathHash))fail('Unexpected source attachment references.');
 if(after.files[filePathHash]!==expectedHash||after.files[rowsPathHash]!==snapshot.rowsHash)fail('Source attachments do not match their expected hashes.');
 const allowedFiles=new Set([filePathHash,rowsPathHash]),addedFiles=Object.keys(after.files).filter(id=>!Object.hasOwn(before.files,id));
 if(addedFiles.some(id=>!allowedFiles.has(id)))fail('Unexpected attachments were added.');
 const expectedRevisionDelta=priorCount?0:2;
 if(after.revision!==before.revision+expectedRevisionDelta||!priorCount&&snapshot.committedRevision!==after.revision)fail('Unexpected workspace revision change.');
 return {ok:true,oldRecordsPreserved:Object.keys(before.records).length,oldAttachmentsPreserved:Object.keys(before.files).length,accountsPreserved:after.accountCount,addedRecords:addedIds.length,addedAttachments:addedFiles.length,revisionDelta:expectedRevisionDelta,sourceHash:expectedHash,checkpointHash:digest(after)};
}

async function main(){
 const [mode,filename,expectedHash,...extra]=process.argv.slice(2);
 if(!['before','after'].includes(mode)||!filename||extra.length||mode==='before'&&expectedHash||mode==='after'&&!expectedHash)fail('Usage: before <test-output/supplier-workspace-preservation-*.json> | after <same-checkpoint> <expected-source-sha256>');
 const target=await privateOutput(filename,'supplier-workspace-preservation-');
 const current=await supplierWorkspaceFingerprint(path.resolve(process.env.DOON_DATA_DIR||'lan-data'));
 if(mode==='before'){
  await fs.writeFile(target,JSON.stringify({at:new Date().toISOString(),fingerprint:current}),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({mode,integrity:'ok',recordCount:Object.keys(current.records).length,fileCount:Object.keys(current.files).length,accountCount:current.accountCount,revision:current.revision,checkpointHash:digest(current)}));
 }else{
  const saved=JSON.parse(await fs.readFile(target,'utf8'));
  console.log(JSON.stringify({mode,integrity:'ok',...verifySupplierWorkspacePreservation(saved.fingerprint,current,expectedHash)}));
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error('Supplier preservation verification failed: '+(error instanceof PreservationError?error.message:'Could not verify the private checkpoint and source data.')+' No original data was changed by this check.');process.exitCode=1;});
