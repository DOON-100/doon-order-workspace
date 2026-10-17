import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function attachmentDigest(directory){
 let names;try{names=await fs.readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return{available:false,count:0,sha256:null};throw error;}
 const rows=[];
 for(const entry of names.sort((a,b)=>a.name.localeCompare(b.name))){if(!entry.isFile())throw new Error('附件目录包含非常规文件，需人工检查');rows.push([entry.name,digest(await fs.readFile(path.join(directory,entry.name)))]);}
 return{available:true,count:rows.length,sha256:digest(JSON.stringify(rows))};
}
export async function captureSnapshot({source,output,sourceLabel='本机选定真实业务备份'}){
 source=path.resolve(source);output=path.resolve(output);
 if(source===path.join(output,'workspace.sqlite')||!output.toLowerCase().split(path.sep).includes('test-output'))throw new Error('快照必须保存在独立 test-output 新目录');
 await fs.access(source);await fs.mkdir(output,{recursive:false,mode:0o700});
 const before=await attachmentDigest(path.join(path.dirname(source),'files'));
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,path.join(output,'workspace.sqlite'));}finally{db.close();}
 const after=await attachmentDigest(path.join(path.dirname(source),'files'));
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('附件在快照期间变化，请重做快照；保留现场');
 const check=new DatabaseSync(path.join(output,'workspace.sqlite'),{readOnly:true});let counts;
 try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('快照完整性检查失败');counts=check.prepare('SELECT kind,COUNT(*) count FROM records GROUP BY kind ORDER BY kind').all();}finally{check.close();}
 const manifest={kind:'doon-agent-readonly-snapshot-v1',snapshotId:randomUUID(),capturedAt:new Date().toISOString(),sourceLabel,databaseSha256:digest(await fs.readFile(path.join(output,'workspace.sqlite'))),attachments:before,counts};
 await fs.writeFile(path.join(output,'snapshot-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [source,output]=process.argv.slice(2);if(!source||!output)throw new Error('用法：node snapshot.mjs <本机源SQLite> <test-output中的新目录>');
 const result=await captureSnapshot({source,output});console.log(JSON.stringify({snapshotId:result.snapshotId,capturedAt:result.capturedAt,databaseSha256:result.databaseSha256,attachments:result.attachments,counts:result.counts}));
}
