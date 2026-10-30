// Synthetic fixtures only; never points at lan-data or a running service.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {capturePreservation,comparePreservation,snapshot,verifyValidation,verifyStage} from '../scripts/verify-code-update.mjs';
import {captureCustomerPriceSourceHashes,writeCustomerPriceBuildEvidence} from '../scripts/customer-price-build-evidence.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await fs.mkdir(path.join(project,'test-output'),{recursive:true});
const root=await fs.mkdtemp(path.join(project,'test-output','code-update-test-'));
const data=path.join(root,'data');
await fs.mkdir(path.join(data,'files'),{recursive:true});
await fs.mkdir(path.join(data,'backups'));
const db=new DatabaseSync(path.join(data,'workspace.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,data TEXT);
CREATE TABLE local_accounts(id TEXT,username TEXT,member_id TEXT,password_hash TEXT,must_change INTEGER,created_at TEXT);
CREATE TABLE workspace_revision(id TEXT,revision INTEGER);
INSERT INTO records VALUES('synthetic-row','order','{"kind":"order","quantity":12}');
INSERT INTO local_accounts VALUES('synthetic-account','synthetic-username','synthetic-member','synthetic-secret-do-not-read',0,'2020-01-01');
INSERT INTO workspace_revision VALUES('main',2);`);
const attachment=path.join(data,'files','synthetic-attachment');
await fs.writeFile(attachment,'synthetic bytes');
let passed=0;
const before=await capturePreservation(data);
assert.equal(comparePreservation(before,await capturePreservation(data)).preserved,true);passed++;
const serialized=JSON.stringify(before);
for(const forbidden of ['synthetic-row','synthetic-username','synthetic-member','synthetic-secret-do-not-read','synthetic-attachment'])assert(!serialized.includes(forbidden));passed++;
db.prepare('UPDATE records SET data=?').run('{"kind":"order","quantity":13}');
assert.throws(()=>comparePreservation(before,{...before,records:{}}),/Business/);
assert.throws(()=>comparePreservation(before,{...before,accountsHash:'changed'}),/metadata/);
assert.throws(()=>comparePreservation(before,{...before,revisionHash:'changed'}),/revision/);
assert.throws(()=>comparePreservation(before,{...before,files:{}}),/Attachments/);passed++;
const changed=await capturePreservation(data);assert.throws(()=>comparePreservation(before,changed),/Business/);passed++;
db.prepare('UPDATE records SET data=?').run('{"kind":"order","quantity":12}');
db.prepare('INSERT INTO records VALUES(?,?,?)').run('another-synthetic-row','setting','{}');
assert.throws(()=>comparePreservation(before,{...before,records:{...before.records,added:{kind:'setting',hash:'x'}}}),/Business/);
const added=await capturePreservation(data);assert.throws(()=>comparePreservation(before,added),/Business/);passed++;
db.prepare('DELETE FROM records WHERE id=?').run('another-synthetic-row');
await fs.writeFile(attachment,'modified synthetic bytes');
assert.throws(()=>comparePreservation(before,{...before,files:{changed:'x'}}),/Attachments/);
const changedFile=await capturePreservation(data);assert.throws(()=>comparePreservation(before,changedFile),/Attachments/);passed++;
await fs.writeFile(attachment,'synthetic bytes');
const backed=await snapshot(data,path.join(data,'backups','online'));
assert.equal(backed.integrity,'ok');assert.equal(backed.records,1);
assert.equal(await fs.readFile(path.join(backed.folder,'files','synthetic-attachment'),'utf8'),'synthetic bytes');
assert.equal(comparePreservation(before,await capturePreservation(data)).preserved,true);passed++;
await assert.rejects(()=>snapshot(data,path.join(root,'outside')),/Backup destination/);
await assert.rejects(()=>snapshot(data,path.join(data,'backups','online')),/EEXIST/);passed++;
const manifestSha256='a'.repeat(64),receipt=path.join(root,'validation.json');
const checks=['business-tests','typescript','standalone','feature'].map(name=>({name,command:'synthetic check',completedAt:new Date().toISOString(),exitCode:0}));
await fs.writeFile(receipt,JSON.stringify({format:'doon-code-update-validation-v1',manifestSha256,checks}));
assert.equal((await verifyValidation(receipt,manifestSha256)).checks.length,4);
await assert.rejects(()=>verifyValidation(receipt,'b'.repeat(64)),/bind/);passed++;
checks[0].exitCode=1;
await fs.writeFile(receipt,JSON.stringify({format:'doon-code-update-validation-v1',manifestSha256,checks}));
await assert.rejects(()=>verifyValidation(receipt,manifestSha256),/Missing successful/);passed++;
await assert.rejects(()=>verifyStage(project,manifestSha256),/below this project test-output/);passed++;
// A synthetic build bound to an isolated source tree; no build or service is executed.
const source=path.join(root,'release-source'),stage=path.join(root,'release-build');
for(const folder of ['app','lib','components','build','public','scripts','standalone']){
 await fs.mkdir(path.join(source,folder),{recursive:true});
 await fs.writeFile(path.join(source,folder,'synthetic.txt'),'synthetic '+folder);
}
for(const name of ['package.json','tsconfig.json','postcss.config.mjs'])await fs.writeFile(path.join(source,name),'synthetic '+name);
await fs.mkdir(path.join(stage,'client'),{recursive:true});
for(const name of ['workspace-api.mjs','runtime.mjs','auth.mjs','server.mjs','manage.mjs','client/index.html'])await fs.writeFile(path.join(stage,name),'synthetic artifact '+name);
const sourceFile=path.join(source,'app','synthetic.txt'),artifactFile=path.join(stage,'server.mjs');
const originalDirectory=process.cwd();
async function writeEvidenceFrom(directory){
 try{process.chdir(directory);await writeCustomerPriceBuildEvidence(stage,await captureCustomerPriceSourceHashes());}
 finally{process.chdir(originalDirectory);}
 return createHash('sha256').update(await fs.readFile(path.join(stage,'customer-price-build-evidence.json'))).digest('hex');
}
const isolatedManifest=await writeEvidenceFrom(source);
assert.equal((await verifyStage(stage,isolatedManifest,source)).sourceRoot,source);
assert.equal(process.cwd(),originalDirectory);passed++;
// Default verification remains bound to the main checkout, regardless of caller cwd.
try{
 process.chdir(source);
 await assert.rejects(()=>verifyStage(stage,isolatedManifest),/Source or build changed/);
 assert.equal(process.cwd(),source);
}finally{process.chdir(originalDirectory);}
passed++;
await assert.rejects(()=>verifyStage(stage,'b'.repeat(64),source),/explicitly selected/);passed++;
await assert.rejects(()=>verifyStage(stage,isolatedManifest,path.dirname(project)),/Release source/);
await assert.rejects(()=>verifyStage(stage,isolatedManifest,path.join(project,'test-output')),/Release source/);passed++;
await fs.writeFile(sourceFile,'changed source');
await assert.rejects(()=>verifyStage(stage,isolatedManifest,source),/Source or build changed/);
assert.equal(process.cwd(),originalDirectory);
await fs.writeFile(sourceFile,'synthetic app');passed++;
await fs.writeFile(artifactFile,'changed artifact');
await assert.rejects(()=>verifyStage(stage,isolatedManifest,source),/Source or build changed/);
await fs.writeFile(artifactFile,'synthetic artifact server.mjs');passed++;
await fs.writeFile(path.join(source,'app','unexpected.txt'),'unrecorded source');
await assert.rejects(()=>verifyStage(stage,isolatedManifest,source),/Source or build changed/);
await fs.unlink(path.join(source,'app','unexpected.txt'));passed++;
const checkoutManifest=await writeEvidenceFrom(project);
assert.equal((await verifyStage(stage,checkoutManifest)).sourceRoot,project);passed++;
await writeEvidenceFrom(source);
const linkedSource=path.join(root,'linked-source'),linkedStage=path.join(root,'linked-stage');
await fs.symlink(source,linkedSource,process.platform==='win32'?'junction':'dir');
await fs.symlink(stage,linkedStage,process.platform==='win32'?'junction':'dir');
await assert.rejects(()=>verifyStage(stage,isolatedManifest,linkedSource),/without a link or junction/);
await assert.rejects(()=>verifyStage(linkedStage,isolatedManifest,source),/without a link or junction/);passed++;
// An intermediate junction must also fail, not only a linked final directory.
await assert.rejects(()=>verifyStage(path.join(linkedSource,'app'),isolatedManifest,source),/without a link or junction/);passed++;
await fs.symlink(path.join(source,'lib'),path.join(source,'app','linked-child'),process.platform==='win32'?'junction':'dir');
await assert.rejects(()=>verifyStage(stage,isolatedManifest,source),/Links are not allowed/);passed++;

db.close();
console.log(JSON.stringify({ok:true,passed,synthetic:true,productionTouched:false,folder:root}));
