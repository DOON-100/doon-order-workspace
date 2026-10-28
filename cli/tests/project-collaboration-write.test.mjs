import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectCollaborationWriteService,collaborationSteps,collaborationDepartments} from '../dist/project-collaboration-write.js';
import {store,session,root} from './helpers.mjs';

const body={projectId:'p1',stepKey:'drawings',department:'engineering',ownerId:'m1',title:'Synthetic task'},feed={tasks:[],members:[],canAssign:true,writeContract:'project-collaboration-version-token-v1'};
async function fixture(input=body){const state=await store();await state.setup('https://employee.test');await state.saveSession(session('https://employee.test'));const file=path.join(state.directory,'synthetic.json');await fs.writeFile(file,JSON.stringify(input));return {state,file};}

test('collaboration writes fail before POST on old servers and never retry an uncertain mutation',async()=>{
 const {state,file}=await fixture();let posts=0;
 const old=new ProjectCollaborationWriteService(state,async(_url,options)=>{if(options.method==='POST')posts++;return Response.json({...feed,writeContract:undefined});});
 await assert.rejects(old.save(file,'0',randomUUID()),{code:'SERVER_UPGRADE_REQUIRED'});assert.equal(posts,0);
 const lost=new ProjectCollaborationWriteService(state,async(_url,options)=>{if(options.method==='POST'){posts++;throw Error('Synthetic lost reply');}return Response.json(feed);});
 await assert.rejects(lost.save(file,'0',randomUUID()),e=>e.code==='CONNECTION_FAILED'&&e.details.outcomeUnknown===true&&e.details.retryable===false);assert.equal(posts,1);
});

test('bare success or a changed collaboration readback is uncertain, never successful',async()=>{
 const {state,file}=await fixture(),row={...body,id:'task1',kind:'customer_project_collaboration_task',version:1,history:[]};
 for(const malformed of [true,false]){let posts=0;const api=new ProjectCollaborationWriteService(state,async(_url,options)=>{if(options.method==='POST'){posts++;return Response.json(malformed?{ok:true}:{ok:true,item:row});}return Response.json({...feed,tasks:posts?[{...row,title:'Synthetic concurrent edit'}]:[]});});
  await assert.rejects(api.save(file,'0',randomUUID()),e=>e.code==='READBACK_FAILED'&&e.details.outcomeUnknown===true);assert.equal(posts,1);
 }
});

test('collaboration updates cannot silently clear omitted editable fields',async()=>{
 const {state,file}=await fixture({...body,id:'task1',reason:'Synthetic reason'});let requests=0;
 const api=new ProjectCollaborationWriteService(state,async()=>{requests++;throw Error('Should not request');});
 await assert.rejects(api.save(file,'1',randomUUID()),{code:'INVALID_INPUT'});assert.equal(requests,0);
});

test('collaboration options match native fixed enums',async()=>{
 const source=await fs.readFile(path.join(root,'lib/project-collaboration.ts'),'utf8');
 for(const [name,values]of [['collaborationStepKeys',collaborationSteps],['collaborationDepartments',collaborationDepartments]]){const match=source.match(new RegExp('export const '+name+'=(\\[[^;]+\\]) as const;'));assert(match);assert.deepEqual(JSON.parse(match[1].replaceAll("'",'"')),values);}
});
