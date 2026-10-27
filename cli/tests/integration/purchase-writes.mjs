// W5 purchase handlers; one isolated synthetic source row, no ERP or production requests.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {StateStore,windowsCodec} from '../../dist/state.js';
import {FoundationService} from '../../dist/service.js';
import {PurchaseWriteService} from '../../dist/purchase-write.js';
import {purchaseWriteCommands} from '../../dist/purchase-write-catalog.js';
import {main} from '../../dist/program.js';

export async function verifyPurchaseWrites({services,dir,origin,env,root,pass,nativeCommands=process.platform==='win32'}){
 const development=!nativeCommands||process.argv.includes('--development-cli'),admin=services.admin_test.foundation.purchaseWrite(),denied=services.unassigned.foundation.purchaseWrite(),tested=new Set();
 const inputFile=path.join(dir,'w5-purchase-input.json'),input=async value=>{await fs.writeFile(inputFile,JSON.stringify(value));return inputFile;};
 const flag=process.argv.indexOf('--cli-root'),cliRoot=flag<0?path.join(root,'cli'):path.resolve(process.argv[flag+1]),binary=flag<0?process.execPath:path.join(cliRoot,'node.exe');
 if(development&&flag>=0)throw Error('Downloaded package acceptance requires native Windows command execution');
 let processState,processFoundation;
 if(!development){processState=new StateStore(path.join(dir,'w5-purchase-process'),windowsCodec);await processState.setup(origin,true);processFoundation=new FoundationService(processState);await processFoundation.login(async()=>({username:'admin_test',password:'Synthetic-Only-2026!'}));}
 const run=async args=>{
  const expected=purchaseWriteCommands.find(row=>row.name.split(' ').every((part,index)=>args[index]===part))?.name;assert(expected,'W5 purchase command must be registered');
  let value;
  if(development){let output='';const original=process.stdout.write;process.stdout.write=chunk=>{output+=String(chunk);return true;};try{const code=await main([...args,'--json'],services.admin_test.foundation);value=JSON.parse(output);assert.equal(code,0,'Synthetic W5 purchase command failed: '+args.slice(0,4).join(' ')+' '+output);}finally{process.stdout.write=original;}}
  else try{value=JSON.parse(execFileSync(binary,[path.join(cliRoot,'dist/index.js'),...args,'--json'],{env:{...env,DOON_CLI_HOME:processState.directory},encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024}));}catch(error){if(error.stdout)throw Error('Synthetic W5 purchase command failed: '+args.slice(0,4).join(' ')+' '+error.stdout);throw error;}
  assert.equal(value.ok,true);assert.equal(value.command,expected);tested.add(value.command);return value.data;
 };
 const id='w5-purchase',body=(fields={})=>({id,...fields}),event=(quantity,reference,extra={})=>body({quantity,date:'2026-10-27',reference,note:'Synthetic W5 purchase evidence',...extra});
 const action=async(type,fields,version,token=randomUUID())=>run(['purchasing','purchases','action','--type',type,'--input',await input(fields),...(type==='archive'?[]:['--version',String(version),'--request-id',token])]);
 try{
  for(const type of ['followup','opening','correction','receipt','return','replacement','archive']){const schema=await run(['purchasing','purchases','schema','--type',type]);assert(schema.fields);assert.equal(Object.hasOwn(schema.fields,'returnPending'),['opening','correction'].includes(type));}
  const before=(await run(['purchasing','purchases','form',id])).record;assert.equal(before.quantity,10);assert.equal(before.received,null);assert.equal(before.returnPending,null);assert.equal(before.balanceKnown,false);assert(!Object.hasOwn(before,'raw'));
  await assert.rejects(denied.form(id),{code:'NOT_IN_SCOPE'});await assert.rejects(denied.save(await input(body({followupNote:'Synthetic denied write'})),String(before.version)),{code:'FORBIDDEN'});pass();

  const followed=await run(['purchasing','purchases','save','--input',await input(body({promisedDate:'2026-11-01',followupNote:'Synthetic supplier reply'})),'--version',String(before.version)]);
  assert.equal(followed.record.promisedDate,'2026-11-01');assert.equal(followed.record.received,null);
  // The original endpoint merges unchanged fields from an earlier version; it is not an entire-row CAS.
  const merged=await admin.save(await input(body({expectedDate:'2026-11-02'})),String(before.version));assert.equal(merged.record.promisedDate,'2026-11-01');assert.equal(merged.record.followupNote,'Synthetic supplier reply');assert.equal(merged.record.expectedDate,'2026-11-02');
  await assert.rejects(admin.save(await input(body({promisedDate:'2026-11-03'})),String(before.version)),{code:'CONFLICT'});await assert.rejects(admin.save(await input(body()),String(merged.record.version)),{code:'INVALID_INPUT'});pass();

  const openingToken=randomUUID(),openingBody=event(0,'SYN-W5-OPEN',{returnPending:0}),openingFile=await input(openingBody),opened=await action('opening',openingBody,merged.record.version,openingToken);assert.equal(opened.record.received,0);assert.equal(opened.record.returnPending,0);assert.equal(opened.record.balanceKnown,true);
  // Preserve the exact original payload and version when querying a duplicate operation.
  await input(openingBody);const replayed=await admin.action('opening',openingFile,String(merged.record.version),openingToken);assert.equal(replayed.reused,true);assert.equal(replayed.record.version,opened.record.version);
  await assert.rejects(admin.action('opening',await input({...openingBody,quantity:1}),String(merged.record.version),openingToken),{code:'CONFLICT'});
  await assert.rejects(services.pmc_test.foundation.purchaseWrite().action('opening',await input(openingBody),String(merged.record.version),openingToken),{code:'CONFLICT'});
  await assert.rejects(denied.action('opening',await input(openingBody),String(merged.record.version),openingToken),{code:'FORBIDDEN'});
  await assert.rejects(admin.action('correction',await input(event(0,'SYN-W5-STALE')),String(merged.record.version),randomUUID()),{code:'CONFLICT'});
  await assert.rejects(admin.action('opening',await input(openingBody),String(opened.record.version),randomUUID()),{code:'CONFLICT'});pass();

  await assert.rejects(admin.action('correction',await input(event(null,'SYN-W5-NULL')),String(opened.record.version),randomUUID()),{code:'INVALID_INPUT'});
  await assert.rejects(admin.action('correction',await input(event(0.12345,'SYN-W5-PRECISION')),String(opened.record.version),randomUUID()),{code:'REQUEST_REJECTED'});
  const corrected=await action('correction',event(0.1234,'SYN-W5-CORRECT',{returnPending:0.0001}),opened.record.version);assert.equal(corrected.record.received,0.1234);assert.equal(corrected.record.returnPending,0.0001);
  const received=await action('receipt',event(9.8765,'SYN-W5-RECEIVE'),corrected.record.version);assert.equal(received.record.received,9.9999);assert.equal(received.record.returnPending,0.0001);
  // A normal receipt cannot consume the quantity reserved for an outstanding return.
  await assert.rejects(admin.action('receipt',await input(event(0.0001,'SYN-W5-NOT-REPLACEMENT')),String(received.record.version),randomUUID()),{code:'REQUEST_REJECTED'});
  const replaced=await action('replacement',event(0.0001,'SYN-W5-REPLACE'),received.record.version);assert.equal(replaced.record.received,10);assert.equal(replaced.record.returnPending,0);pass();

  const archiveBody={items:[{id,version:replaced.record.version}],date:'2026-10-27',note:'Synthetic W5 complete purchase archive'},archived=await action('archive',archiveBody);assert.equal(archived.count,1);assert.equal(archived.records[0].lifecycle,'archived');assert.equal(archived.records[0].completedDate,'2026-10-27');
  await assert.rejects(admin.save(await input(body({followupNote:'Cannot edit archived evidence'})),String(archived.records[0].version)),{code:'CONFLICT'});
  await assert.rejects(admin.action('archive',await input(archiveBody),String(archived.records[0].version)),{code:'INVALID_ARGUMENT'});
  await assert.rejects(admin.action('archive',await input(archiveBody),undefined,randomUUID()),{code:'INVALID_ARGUMENT'});pass();

  const returned=await action('return',event(0.25,'SYN-W5-RETURN'),archived.records[0].version);assert.equal(returned.record.received,9.75);assert.equal(returned.record.returnPending,0.25);assert.equal(returned.record.lifecycle,'active');assert.equal(returned.record.completedDate,'');assert.equal(returned.record.archivedAt,'');
  await assert.rejects(admin.action('archive',await input({items:[{id,version:returned.record.version}],date:'2026-10-27',note:'Synthetic unfilled purchase'})),{code:'REQUEST_REJECTED'});
  await assert.rejects(admin.action('return',await input(event(0.25,'SYN-W5-RETURN')),String(returned.record.version),randomUUID()),{code:'CONFLICT'});
  // The business commit can succeed while the connection loses its response. It must stay unknown
  // until the employee queries the source operation; the transport never retries it automatically.
  const finalBody=event(0.25,'SYN-W5-RETURN-REPLACE'),finalToken=randomUUID(),finalFile=await input(finalBody);let lostResponses=0;
  const responseLost=new PurchaseWriteService(services.admin_test.state,async(url,init)=>{const response=await fetch(url,init);if(new URL(url).pathname.endsWith('/purchase-receipt')){lostResponses++;await response.arrayBuffer();throw new TypeError('Synthetic response lost after commit');}return response;});
  await assert.rejects(responseLost.action('replacement',finalFile,String(returned.record.version),finalToken),error=>error.code==='CONNECTION_FAILED'&&error.details.outcomeUnknown===true);assert.equal(lostResponses,1);
  const final=await admin.action('replacement',finalFile,String(returned.record.version),finalToken);assert.equal(final.reused,true);assert.equal(final.record.received,10);assert.equal(final.record.returnPending,0);assert.equal(final.record.lifecycle,'active');
  // A readback failure also preserves an unknown outcome and provides no false success.
  let saved=false;const readbackLost=new PurchaseWriteService(services.admin_test.state,async(url,init)=>{const route=new URL(url).pathname;if(saved&&route.endsWith('/purchase-data'))return Response.json({error:'Synthetic readback outage'},{status:503});const response=await fetch(url,init);if(route.endsWith('/purchase-save'))saved=true;return response;});
  await assert.rejects(readbackLost.save(await input(body({nextFollowupDate:'2026-11-03'})),String(final.record.version)),error=>error.code==='READBACK_FAILED'&&error.details.outcomeUnknown===true);
  const verified=(await admin.form(id)).record;assert.equal(verified.nextFollowupDate,'2026-11-03');assert.equal(verified.version,final.record.version+1);pass();
  const mutable=new Set(['version','promisedDate','expectedDate','nextFollowupDate','followupNote','balanceKnown','received','returnPending','lifecycle','completedDate','archivedAt','archivedBy','archiveNote','updatedAt','updatedBy']);for(const key of Object.keys(before))if(!mutable.has(key))assert.deepEqual(final.record[key],before[key],'Preserve purchase source field '+key);
  const history=await services.admin_test.foundation.planning().execute('purchases','history',{},id);assert.equal(history.events.total,6);assert(history.events.rows.some(row=>row.type==='opening'&&row.quantity===0));assert(history.events.rows.some(row=>row.type==='return'&&row.quantity===0.25));pass();
  assert.deepEqual([...tested].sort(),purchaseWriteCommands.map(row=>row.name).sort());return [...tested];
 }finally{if(processFoundation)await processFoundation.logout();}
}
