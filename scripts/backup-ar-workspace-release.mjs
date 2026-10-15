// Consistent, private, fresh-destination backup. Source connection is read-only.
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const root=process.cwd(),source=path.resolve(process.env.DOON_RELEASE_BACKUP_SOURCE||'lan-data'),target=path.resolve(process.argv[2]||'');
assert.equal(source,path.join(root,'lan-data'),'Unexpected production backup source');
assert.equal(path.dirname(target),path.join(root,'test-output'),'Backup must remain in the private test-output directory');
assert(/^ar-workspace-data-backup-\d{8}-\d{6}(?:-\d+)?$/.test(path.basename(target)),'Unexpected backup destination');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(target); // Refuse to overwrite an existing backup.
const original=new DatabaseSync(path.join(source,'workspace.sqlite'),{readOnly:true});
try{await backup(original,path.join(target,'workspace.sqlite'));}finally{original.close();}
await fs.cp(path.join(source,'files'),path.join(target,'files'),{recursive:true,errorOnExist:true,force:false});
const copied=new DatabaseSync(path.join(target,'workspace.sqlite'),{readOnly:true});
let recordCount;
try{assert.equal(Object.values(copied.prepare('PRAGMA integrity_check').get())[0],'ok');recordCount=copied.prepare('SELECT COUNT(*) n FROM records').get().n;}finally{copied.close();}
let fileCount=0;
for(const entry of await fs.readdir(path.join(source,'files'),{withFileTypes:true})){
 assert(entry.isFile(),'Unexpected attachment subdirectory');
 assert.equal(sha(await fs.readFile(path.join(source,'files',entry.name))),sha(await fs.readFile(path.join(target,'files',entry.name))),'Attachment backup mismatch');
 fileCount++;
}
const result={at:new Date().toISOString(),folder:target,integrity:'ok',recordCount,fileCount,sourceReadOnly:true};
await fs.writeFile(path.join(target,'manifest.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
