// Use only after writes are frozen for a release. All outputs remain private.
import {backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {regularDirectory,privateOutput,attachmentEntries,openReadSnapshot,closeReadSnapshot,fingerprint,sameFingerprint,summary} from './verify-planning-control-preservation.mjs';

async function main(){
 if(process.argv.length!==3)throw new Error('Usage: <test-output/planning-control-data-backup-*>');
 const source=await regularDirectory(path.resolve('lan-data'));
 const target=await privateOutput(process.argv[2],'planning-control-data-backup-');
 await fs.mkdir(target,{mode:0o700}); // Fail if any destination already exists.
 const db=openReadSnapshot(source);
 let before;
 try{
  before=await fingerprint(source,db);
  // The held read transaction pins the database view throughout backup and verification.
  await backup(db,path.join(target,'workspace.sqlite'));
  await fs.mkdir(path.join(target,'files'));
  for(const entry of await attachmentEntries(path.join(source,'files'))){
   const destination=path.join(target,'files',entry.name);
   await fs.mkdir(path.dirname(destination),{recursive:true});
   await fs.copyFile(path.join(source,'files',entry.name),destination,constants.COPYFILE_EXCL);
  }
  sameFingerprint(before,await fingerprint(source,db));
  sameFingerprint(before,await fingerprint(target));
 }finally{closeReadSnapshot(db);}
 // Also detect a writer that committed while the pinned read transaction was open.
 sameFingerprint(before,await fingerprint(source));
 const result={at:new Date().toISOString(),integrity:'ok',sourceReadOnly:true,consistent:true,...summary(before)};
 await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
 console.log(JSON.stringify(result));
}
main().catch(()=>{console.error('Consistent backup failed. The incomplete fresh destination is retained for diagnosis; no original data was changed.');process.exitCode=1;});
