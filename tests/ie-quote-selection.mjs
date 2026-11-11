// Deferred synthetic reads exercise the actual saved-version switch without a server or database.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const panel=await readFile(new URL('../app/ie-quote-panel.tsx',import.meta.url),'utf8');
const start=panel.indexOf(' const switchSavedVersion=async('),end=panel.indexOf(' const savePolicy=',start);
assert.ok(start>0&&end>start,'saved-version switching helper must exist');
const code=ts.transpileModule(panel.slice(start,end)+'\nglobalThis.__switch=switchSavedVersion;', {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
function environment(){
 const requests=[],writes=[],errors=[];
 const quote={id:'synthetic-quote-A',version:2,status:'draft',notes:'original draft'};
 const context={draft:quote,busy:false,current:{current:{draft:quote,dirty:false}},identity:{current:'synthetic-member'},editorAlive:{current:true},selectionSequence:{current:1},versionRequestSequence:{current:0},requestSequence:{current:0},team:'synthetic-team',section:'documents',encodeURIComponent,Error,
  leave:()=>true,getBusinessTeamScope:()=>context.team,
  ieRequest:path=>new Promise((resolve,reject)=>requests.push({path,resolve,reject})),
  setBusy:value=>{context.busy=value;},setError:()=>{},setSection:value=>{context.section=value;},
  put:(value,historical)=>{writes.push({quote:value,historical});context.selectionSequence.current++;context.current.current.draft=value;context.draft=value;},
  actionError:error=>errors.push(error)
 };
 vm.createContext(context);vm.runInContext(code,context);
 return {context,requests,writes,errors,switchVersion:version=>context.__switch(version)};
}
{
 const e=environment(),pending=e.switchVersion();assert.equal(e.context.busy,true);assert.equal(e.requests[0].path,'ie-quote?id=synthetic-quote-A');
 await e.switchVersion(1);assert.equal(e.requests.length,1,'busy guard blocks a second selection');
 e.context.selectionSequence.current++;e.context.current.current={draft:{id:'synthetic-quote-B',version:7,notes:'unsaved B'},dirty:true};
 e.requests[0].resolve({quote:{id:'synthetic-quote-A',version:3}});await pending;
 assert.equal(e.writes.length,0);assert.equal(e.context.current.current.draft.notes,'unsaved B');assert.equal(e.context.busy,false);
 console.log('PASS returning to current locks selection and ignores a late prior quote without overwriting another draft');
}
{
 const e=environment(),pending=e.switchVersion();e.context.selectionSequence.current++;
 e.requests[0].reject(Object.assign(new Error('synthetic revoked prior quote'),{status:403}));await pending;
 assert.equal(e.errors.length,0);assert.equal(e.writes.length,0);
 console.log('PASS stale authorization errors do not clear a newer quote selection');
}
{
 for(const revoke of [e=>{e.context.team='another-team';},e=>{e.context.identity.current='another-member';},e=>{e.context.current.current.dirty=true;},e=>{e.context.current.current.draft={...e.context.current.current.draft,notes:'changed same quote'};},e=>{e.context.editorAlive.current=false;}]){
  const e=environment(),pending=e.switchVersion(1);revoke(e);e.requests[0].resolve({quote:{id:'synthetic-quote-A',version:1}});await pending;assert.equal(e.writes.length,0);assert.equal(e.errors.length,0);
 }
 console.log('PASS changed identity, team, dirty state, draft content and unmount all withdraw pending version results');
}
{
 const e=environment(),pending=e.switchVersion(1);e.requests[0].resolve({quote:{id:'synthetic-quote-A',version:1}});await pending;
 assert.equal(e.writes.length,1);assert.equal(e.writes[0].historical,true);assert.equal(e.context.section,'history');assert.equal(e.context.busy,false);
 const current=environment(),read=current.switchVersion();current.requests[0].resolve({quote:{id:'synthetic-quote-A',version:3}});await read;
 assert.equal(current.writes.length,1);assert.equal(current.writes[0].historical,false);assert.equal(current.context.section,'documents');assert.equal(current.context.busy,false);
 console.log('PASS normal current and historical reads preserve the original record and release the busy lock');
}
{
 for(const result of [{id:'wrong-quote',version:1},{id:'synthetic-quote-A',version:9}]){
  const e=environment(),pending=e.switchVersion(1);e.requests[0].resolve({quote:result});await pending;assert.equal(e.writes.length,0);assert.equal(e.errors.length,1);assert.equal(e.context.busy,false);
 }
 console.log('PASS mismatched quote or historical version never replaces the selected record');
}
