import test from 'node:test';
import assert from 'node:assert/strict';
import {UpdateService} from '../dist/update.js';
import {store,session} from './helpers.mjs';

test('update check uses the employee session and a fixed HTTPS route',async()=>{
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const release={format:'doon-cli-update-v1',version:'0.44.0',commit:'a'.repeat(40),file:'doon-cli-0.44.0-aaaaaaaaaaaa-windows-x64.zip',bytes:10,sha256:'b'.repeat(64),sourceDirty:false};
 const update=new UpdateService(state,async(url,options)=>{assert.equal(url,'https://employee.test/api/cli-update/latest');assert.equal(options.headers.Cookie,'doon_employee_session='+'X'.repeat(43));assert.equal(options.redirect,'manual');return Response.json(release);});
 assert.deepEqual(await update.check(),{installedVersion:'0.43.0',latestVersion:'0.44.0',updateAvailable:true,commit:release.commit});
});

test('update check rejects incomplete or dirty release manifests',async()=>{
 const state=await store();await state.setup('https://employee.test',false);await state.saveSession(session('https://employee.test'));
 const update=new UpdateService(state,async()=>Response.json({format:'doon-cli-update-v1',version:'0.44.0',sourceDirty:true}));
 await assert.rejects(update.check(),{code:'INVALID_RELEASE'});
});
