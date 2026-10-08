import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// Isolated synthetic fixtures only. No production DB, JSON, mapping or account
// secret is read. The CLI is always pointed at an explicit temporary data dir.
export async function runIvyMigrationCases({pass=console.log}={}){
 const root=process.cwd();await fs.mkdir(path.join(root,'test-output'),{recursive:true});
 const tmp=await fs.mkdtemp(path.join(root,'test-output','ivy-migration-cases-'));
 const bundle=path.join(tmp,'adapter.mjs');
 await build({entryPoints:[path.join(root,'lib/service-ivy-import.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
 const {prepareIvyMigration}=await import(pathToFileURL(bundle).href);
 const clone=value=>structuredClone(value),sha=value=>createHash('sha256').update(value).digest('hex');
 const actor={id:'ivy_fixture_admin',kind:'member',role:'admin',active:true,name:'Synthetic migration administrator',email:'ivy-admin@test.invalid',customers:[]};
 const account=(id,name)=>({id,kind:'customer_account',customer:name,customerCode:'',version:3,active:true,salesName:'',serviceName:'Synthetic service',pmcName:''});
 const state={revision:10,records:[actor,account('target_a','Synthetic A'),account('target_b','Synthetic B'),{id:'old_business',kind:'order',customer:'Synthetic A',quantity:100,notes:'Must remain byte-for-byte unchanged'}]};
 const source={customers:[{id:'source_a',name:'Synthetic A',email:'a@test.invalid',extraLegacy:{values:['must','remain']}},{id:'source_b',name:'Synthetic B',phone:'synthetic phone'}],projects:[],orders:[],samples:[],shipments:[],payments:[],tasks:[],waitingItems:[{id:'wait_a',customerId:'source_a',what:'Synthetic unspecified waiting',owner:'',resolved:false,nextFollowUp:'2026-10-20',legacyAttachment:{note:'Retain unmapped source properties'}},{id:'wait_b',customerId:'source_b',what:'Synthetic completed task',owner:'factory',resolved:true}]};
 const mapping={instanceId:'synthetic-ivy-instance',customerBindings:[{sourceId:'source_a',targetId:'target_a',targetVersion:3,confirmedCustomerCode:'SYN-A'},{sourceId:'source_b',targetId:'target_b',targetVersion:3,confirmedCustomerCode:'SYN-B'}],waitingForOverrides:{wait_a:'jennifer'}};
 const original=clone({state,source,mapping});
 const plan=await prepareIvyMigration(state,source,mapping,actor);
 assert.deepEqual({state,source,mapping},original,'Preview must not mutate inputs.');
 assert.deepEqual(plan.counts,{customers:2,waitingItems:2,newRecords:4,skipped:0});
 assert.equal(plan.additions.length,12);
 const records=plan.additions.filter(row=>row.kind==='service_record');
 assert.equal(records.find(row=>row.source.id==='wait_a').waitingFor,'jennifer');
 assert.equal(records.find(row=>row.source.id==='wait_b').status,'done');
 assert.deepEqual(records.find(row=>row.source.id==='source_a').source.original,source.customers[0]);
 assert.deepEqual(records.find(row=>row.source.id==='wait_a').source.original,source.waitingItems[0]);
 assert.equal(plan.planHash,(await prepareIvyMigration(state,source,mapping,actor)).planHash);
 assert.notEqual(plan.planHash,(await prepareIvyMigration({...state,revision:11},source,mapping,actor)).planHash);
 const changedState=clone(state);changedState.records.at(-1).notes='changed without revision';
 assert.notEqual(plan.planHash,(await prepareIvyMigration(changedState,source,mapping,actor)).planHash);
 assert.notEqual(plan.planHash,(await prepareIvyMigration(state,source,mapping,{...actor,id:'another_admin'})).planHash);
 pass('Ivy迁入预览零写入、保留未知原字段；计划绑定完整旧数据、版本及确认管理员');

 const migrated={revision:11,records:[...clone(state.records),...clone(plan.additions)]};
 const again=await prepareIvyMigration(migrated,source,mapping,actor);
 assert.equal(again.additions.length,0);assert.equal(again.counts.skipped,4);
 migrated.records.find(row=>row.kind==='service_record'&&row.source.id==='wait_a').title='A later employee edit';
 assert.equal((await prepareIvyMigration(migrated,source,mapping,actor)).additions.length,0,'A rerun must preserve subsequent employee edits.');
 const changedSource=clone(source);changedSource.waitingItems[0].what='Changed source text';
 await assert.rejects(prepareIvyMigration(migrated,changedSource,mapping,actor),/已迁入/);
 const changedOverride=clone(mapping);changedOverride.waitingForOverrides.wait_a='factory';
 await assert.rejects(prepareIvyMigration(migrated,source,changedOverride,actor),/已迁入/);
 const changedBinding=clone(mapping);changedBinding.customerBindings.reverse();
 changedBinding.customerBindings[0].targetId='target_a';changedBinding.customerBindings[1].targetId='target_b';
 await assert.rejects(prepareIvyMigration(migrated,source,changedBinding,actor));
 pass('Ivy重复迁入幂等并保留后续人工编辑，来源、等待对象或客户映射改变均拒绝覆盖');

 for(const table of ['projects','orders','samples','shipments','payments','tasks']){
  const data=clone(source);data[table].push({id:'nonempty_'+table});await assert.rejects(prepareIvyMigration(state,data,mapping,actor),/不能忽略/);
 }
 await assert.rejects(prepareIvyMigration(state,{...source,unknownStore:[{id:'unknown'}]},mapping,actor));
 await assert.rejects(prepareIvyMigration(state,{...source,unknownEmptyStore:[]},mapping,actor));
 const missing=clone(source);delete missing.tasks;await assert.rejects(prepareIvyMigration(state,missing,mapping,actor));
 const duplicate=clone(source);duplicate.waitingItems.push(clone(duplicate.waitingItems[0]));await assert.rejects(prepareIvyMigration(state,duplicate,mapping,actor),/重复 ID/);
 const badReference=clone(source);badReference.waitingItems[0].customerId='missing';await assert.rejects(prepareIvyMigration(state,badReference,mapping,actor),/未能匹配客户/);
 const badBoolean=clone(source);badBoolean.waitingItems[0].resolved='true';await assert.rejects(prepareIvyMigration(state,badBoolean,mapping,actor));
 const noOverride={...mapping,waitingForOverrides:{}};await assert.rejects(prepareIvyMigration(state,source,noOverride,actor),/等待对象未确认/);
 const staleMap=clone(mapping);staleMap.customerBindings[0].targetVersion=2;await assert.rejects(prepareIvyMigration(state,source,staleMap,actor),/已变化/);
 const withProfile={...state,records:[...state.records,{id:'existing_profile',kind:'service_record',type:'customer_profile',customerId:'target_a',details:{phone:'keep'}}]};
 await assert.rejects(prepareIvyMigration(withProfile,source,mapping,actor),/已有联系档案/);
 const orphanHistory={...state,records:[...state.records,clone(plan.additions.find(row=>row.kind==='service_revision'))]};
 await assert.rejects(prepareIvyMigration(orphanHistory,source,mapping,actor),/历史编号已存在/);
 const sameBatchCode=clone(mapping);sameBatchCode.customerBindings[1].confirmedCustomerCode='syn-a';await assert.rejects(prepareIvyMigration(state,source,sameBatchCode,actor),/编码已属于/);
 const codeCollision=clone(state);codeCollision.records[2].customerCode='syn-a';await assert.rejects(prepareIvyMigration(codeCollision,source,mapping,actor),/编码已属于/);
 const profileCollision={...state,records:[...state.records,account('other_target','Other synthetic'),{id:'other_profile',kind:'service_record',type:'customer_profile',customerId:'other_target',source:{confirmedCustomerCode:'ＳＹＮ－Ａ'}}]};
 await assert.rejects(prepareIvyMigration(profileCollision,source,mapping,actor),/编码已属于/);
 await assert.rejects(prepareIvyMigration(state,source,mapping,{...actor,role:'sales'}),/仅管理员/);
 pass('Ivy未知表、重复ID、孤立引用、非法字段、未确认等待对象、已有档案与跨客户编码冲突全部中止迁入');

 const dataDir=path.join(tmp,'data'),files=path.join(dataDir,'files');await fs.mkdir(files,{recursive:true});
 const fileKey='synthetic-immutable-document',fileBytes=Buffer.from('Synthetic immutable attachment only');
 await fs.writeFile(path.join(files,sha(fileKey)),fileBytes);
 const storedState=clone(state);storedState.records.push({id:'old_attachment',kind:'attachment',fileKey,filename:'synthetic.txt'});
 const databasePath=path.join(dataDir,'workspace.sqlite'),db=new DatabaseSync(databasePath);
 db.exec('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE workspace_revision(id TEXT PRIMARY KEY,revision INTEGER NOT NULL); INSERT INTO workspace_revision VALUES(\'main\',10); CREATE TABLE unrelated_business(id TEXT PRIMARY KEY,note TEXT); INSERT INTO unrelated_business VALUES(\'existing\',\'preserve unrelated table\');');
 for(const row of storedState.records)db.prepare('INSERT INTO records VALUES(?,?,?)').run(row.id,row.kind,JSON.stringify(row));
 const exactRows=db.prepare('SELECT id,kind,data FROM records ORDER BY id').all();db.close();
 const sourcePath=path.join(tmp,'source.json'),mappingPath=path.join(tmp,'mapping.json');
 const sourceBytes=Buffer.from(JSON.stringify(source,null,2)),mappingBytes=Buffer.from(JSON.stringify(mapping,null,2));
 await fs.writeFile(sourcePath,sourceBytes);await fs.writeFile(mappingPath,mappingBytes);
 const baseArgs=[path.join(root,'standalone/import-ivy-service.mjs'),'--backup',sourcePath,'--mapping',mappingPath,'--actor-id',actor.id];
 const invokeFor=(directory,extra)=>JSON.parse(execFileSync(process.execPath,[...baseArgs,...extra],{cwd:root,env:{...process.env,DOON_DATA_DIR:directory},encoding:'utf8',timeout:60000,stdio:['ignore','pipe','pipe']}));
 const invoke=extra=>invokeFor(dataDir,extra);
 const readDb=fn=>{const connection=new DatabaseSync(databasePath,{readOnly:true});try{return fn(connection);}finally{connection.close();}};
 const preview=invoke([]);assert.equal(preview.mode,'preview');assert.equal(preview.counts.newRecords,4);
 assert.deepEqual(readDb(connection=>connection.prepare('SELECT id,kind,data FROM records ORDER BY id').all()),exactRows);
 assert.equal(readDb(connection=>connection.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision),10);
 assert.throws(()=>invoke(['--apply','--plan-hash','0'.repeat(64)]));
 assert.deepEqual(readDb(connection=>connection.prepare('SELECT id,kind,data FROM records ORDER BY id').all()),exactRows);
 const changeDb=new DatabaseSync(databasePath);changeDb.prepare("UPDATE workspace_revision SET revision=11 WHERE id='main'").run();changeDb.close();
 assert.throws(()=>invoke(['--apply','--plan-hash',preview.planHash]));
 const current=invoke([]),applied=invoke(['--apply','--plan-hash',current.planHash]);
 assert.equal(applied.mode,'applied');assert.equal(applied.preservedRecords,exactRows.length);assert.equal(applied.verifiedFiles,1);
 for(const before of exactRows)assert.deepEqual(readDb(connection=>connection.prepare('SELECT id,kind,data FROM records WHERE id=?').get(before.id)),before);
 assert.equal(readDb(connection=>connection.prepare('SELECT note FROM unrelated_business').get().note),'preserve unrelated table');
 assert.equal(readDb(connection=>connection.prepare('SELECT COUNT(*) AS n FROM records').get().n),exactRows.length+12);
 assert.equal(readDb(connection=>connection.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision),12);
 assert.deepEqual(await fs.readFile(path.join(files,sha(fileKey))),fileBytes);
 const snapshot=new DatabaseSync(path.join(applied.backupFolder,'workspace.sqlite'),{readOnly:true});
 try{assert.deepEqual(snapshot.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),exactRows);assert.equal(Object.values(snapshot.prepare('PRAGMA integrity_check').get())[0],'ok');}finally{snapshot.close();}
 assert.deepEqual(await fs.readFile(path.join(applied.backupFolder,'ivy-source-original.json')),sourceBytes);
 assert.deepEqual(await fs.readFile(path.join(applied.backupFolder,'ivy-mapping-original.json')),mappingBytes);
 assert.deepEqual(await fs.readFile(path.join(applied.backupFolder,'files',sha(fileKey))),fileBytes);
 const prepared=JSON.parse(await fs.readFile(path.join(applied.backupFolder,'import-prepared.json'),'utf8'));
 assert.equal(prepared.planHash,current.planHash);assert.equal(prepared.sourceSha256,sha(sourceBytes));assert.equal(prepared.mappingSha256,sha(mappingBytes));
 const againPreview=invoke([]),noop=invoke(['--apply','--plan-hash',againPreview.planHash]);assert.equal(noop.mode,'no-op');assert.equal(noop.counts.skipped,4);
 assert.equal(readDb(connection=>connection.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision),12);
 pass('Ivy CLI合成数据库默认只预览，过期计划拒绝写入，在线快照及原JSON/映射/附件校验备份后仅INSERT；全部旧数据字节不变，重复迁入不增版本');

 const brokenDir=path.join(tmp,'missing-file-data');await fs.mkdir(path.join(brokenDir,'files'),{recursive:true});
 await fs.copyFile(path.join(applied.backupFolder,'workspace.sqlite'),path.join(brokenDir,'workspace.sqlite'));
 const brokenPreview=invokeFor(brokenDir,[]);
 assert.throws(()=>invokeFor(brokenDir,['--apply','--plan-hash',brokenPreview.planHash]),error=>String(error.stderr).includes('历史记录引用的附件缺失'));
 const brokenDb=new DatabaseSync(path.join(brokenDir,'workspace.sqlite'),{readOnly:true});
 try{assert.deepEqual(brokenDb.prepare('SELECT id,kind,data FROM records ORDER BY id').all(),exactRows);assert.equal(brokenDb.prepare("SELECT revision FROM workspace_revision WHERE id='main'").get().revision,11);}finally{brokenDb.close();}
 pass('Ivy迁入前历史附件缺失会中止写入，旧记录及工作空间版本均保持不变');
}
