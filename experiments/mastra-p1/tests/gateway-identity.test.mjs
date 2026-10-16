import test from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {createSyntheticState} from '../fixtures.mjs';
import {createReadAdapter} from '../policy.mjs';
import {createGatewayIdentity} from '../gateway-identity.mjs';
import {createSandbox,openSuggestionStore,removeSandbox} from '../sandbox.mjs';
import {startReadonlyServer,syntheticSession} from '../server.mjs';
import {generateSyntheticSuggestions} from '../generate.mjs';

test('P1 uses original employee HTTP login/session/logout routes for two synthetic suggestion batches', {timeout:60_000}, async t=>{
  const state=createSyntheticState(),before=structuredClone(state),adapter=await createReadAdapter(state);
  const provision=await createGatewayIdentity({state,adapter});
  let directory,reader,writer,server;
  t.after(async()=>{
    try{if(server)await server.close();else await provision.identity.close();}
    finally{reader?.close();writer?.close();if(directory)await removeSandbox(directory);}
    await assert.rejects(access(provision.evidence.directory),{code:'ENOENT'});
  });
  assert.equal(provision.evidence.implementation,'synthetic-project-gateway-http');
  assert.equal(provision.evidence.tlsTested,false);
  directory=await createSandbox();reader=await openSuggestionStore(directory);writer=await openSuggestionStore(directory,{readOnly:false});
  server=await startReadonlyServer({adapter,store:reader,identity:provision.identity});
  for(const suffix of ['a','b']) {
    const credential=provision.credentials.find(item=>item.actorId==='syn-employee-'+suffix);
    const sessionCookie=await syntheticSession(server.origin,{username:credential.username,password:credential.password});
    const actor=await server.resolveSession(sessionCookie);
    assert.equal(actor.id,credential.actorId);assert.notEqual(actor.id,credential.userId);
    assert(actor.sessionExpiresAt<=Date.now()+2*3_600_000,'cached DTOs expire by the real two-hour idle boundary');
    assert(actor.sessionExpiresAt>Date.now()+119*60_000);
    const result=await generateSyntheticSuggestions({origin:server.origin,adapter,store:writer,sessionCookie,resolveSession:server.resolveSession});
    assert.equal(result.created,2);assert.equal(result.readCalls,1);
    const denied=await fetch(server.origin+'/api/orders/syn-order-'+(suffix==='a'?'b':'a')+'-overdue',{headers:{cookie:sessionCookie}});
    assert.equal(denied.status,404);
    const response=await fetch(server.origin+'/api/logout',{method:'POST',headers:{origin:server.origin,cookie:sessionCookie,'content-type':'application/json'},body:'{}'});
    assert.equal(response.status,200);
    await assert.rejects(server.resolveSession(sessionCookie),{status:401});
  }
  assert.equal(reader.count(),4);assert.deepEqual(state,before);
});

test('gateway identity rejects caller identity overrides, wrong passwords, inactive membership and prior tokens', {timeout:30_000}, async t=>{
  const state=createSyntheticState(),adapter=await createReadAdapter(state),provision=await createGatewayIdentity({state,adapter});
  t.after(()=>provision.identity.close());
  const credential=provision.credentials.find(item=>item.actorId==='syn-employee-a');
  const input={username:credential.username,password:credential.password};
  await assert.rejects(provision.identity.login({...input,actorId:'syn-employee-b'}),{status:400});
  await assert.rejects(provision.identity.login({...input,password:'SYNTHETIC-WRONG-PASSWORD'}),{status:401});
  const {token}=await provision.identity.login({...input,username:'  '+input.username.toUpperCase()+'  '});
  assert.equal((await provision.identity.resolveSession(token)).id,'syn-employee-a');
  const member=state.records.find(item=>item.id==='syn-employee-a');member.active=false;
  await assert.rejects(provision.identity.resolveSession(token),{status:401});
  member.active=true;
  await assert.rejects(provision.identity.resolveSession(token),{status:401});
  await provision.identity.close();
  await assert.rejects(provision.identity.resolveSession(token),{status:503});
});

test('gateway identity has no configurable production origin/database/port',async()=>{
  for(const extra of [{origin:'http://127.0.0.1:8787'},{database:'business.sqlite'},{port:8787}]) {
    await assert.rejects(createGatewayIdentity(extra),{status:400});
  }
});
