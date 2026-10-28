// Optional, bounded read load against the integration fixture only; no production probe.
import assert from 'node:assert/strict';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {SalesService} from '../../dist/sales.js';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

export async function prepareSyntheticCapacity({runtime,env,dir,records}){
 assert([0,1000,5000].includes(records));assert.equal(env.DOON_SYNTHETIC_ONLY,'1');assert(path.resolve(env.DOON_DATA_DIR).startsWith(path.resolve(dir)+path.sep));assert(path.resolve(runtime).startsWith(path.resolve(dir)+path.sep));if(!records)return;
 const script=path.join(runtime,'capacity-synthetic-seed.mjs');await fs.writeFile(script,`import {db,saveRecords} from './runtime.mjs';if(process.env.DOON_SYNTHETIC_ONLY!=='1')throw Error('Synthetic only');const source=JSON.parse(db.prepare('SELECT data FROM records WHERE id=?').get('p2').data),rows=Array.from({length:${records}},(_,i)=>({...source,id:'capacity_project_'+i,code:'CAPACITY_'+String(i).padStart(6,'0'),title:'Synthetic capacity project',description:'Synthetic fixture only'}));db.exec('BEGIN');try{for(const row of rows)if(db.prepare('SELECT id FROM records WHERE id=?').get(row.id))throw Error('Synthetic fixture ID collision');saveRecords(rows);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}db.close();`);
 execFileSync(process.execPath,[script],{env,windowsHide:true,stdio:'pipe'});
}

export async function verifySyntheticCapacity({services,origin,dir,env,records=0}){
 assert.equal(env.DOON_SYNTHETIC_ONLY,'1');assert(path.resolve(env.DOON_DATA_DIR).startsWith(path.resolve(dir)+path.sep));
 const url=new URL(origin);assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname));assert.notEqual(url.port,'8787');
 let gets=0,inFlight=0,peak=0;
 const transport=async(address,options)=>{const target=new URL(address);assert.equal(target.origin,origin);assert.equal(options.method,'GET');assert(['/api/workspace/customer-project-data'].includes(target.pathname));gets++;inFlight++;peak=Math.max(peak,inFlight);try{return await fetch(address,options);}finally{inFlight--;}};
 const clients=['sales_b','unassigned'].map(user=>new SalesService(services[user].state,transport)),expected=[];
 const totals=[];for(let i=0;i<clients.length;i++){const result=await clients[i].execute('projects','list',{limit:'100'}),rows=result.page.rows;if(i===0){assert.equal(result.page.total,records+1);assert(rows.every(row=>row.customerId==='c2'));if(!records)assert(rows.some(row=>row.id==='p2'));}assert(!rows.some(row=>row.id==='p1'));if(i===1)assert.equal(result.page.total,0);expected.push(rows.map(row=>row.id).sort());totals.push(result.page.total);}
 const stages=[];
 for(const concurrency of [1,4,8]){
  const durations=[],startGets=gets,start=performance.now();let next=0;peak=0;
  await Promise.all(Array.from({length:concurrency},async()=>{for(;;){const job=next++;if(job>=24)return;const clientIndex=job%2,at=performance.now(),value=await clients[clientIndex].execute('projects','list',{limit:'100'});assert.equal(value.page.total,totals[clientIndex]);assert.deepEqual(value.page.rows.map(row=>row.id).sort(),expected[clientIndex],'Concurrent project scope changed');durations.push(performance.now()-at);}}));
  const elapsed=performance.now()-start;durations.sort((a,b)=>a-b);const percentile=p=>Math.round(durations[Math.ceil(durations.length*p)-1]*100)/100;
  assert.equal(durations.length,24);assert.equal(gets-startGets,24);assert(peak<=concurrency);
  stages.push({concurrentLogicalReaders:concurrency,operations:24,httpGets:24,peakHttpRequests:peak,elapsedMs:Math.round(elapsed*100)/100,p50OperationMs:percentile(.5),p95OperationMs:percentile(.95),maxOperationMs:percentile(1),scopeMismatches:0,errors:0});
 }
 await assert.rejects(clients[0].execute('projects','show',{},'p1'),{code:'NOT_IN_SCOPE'});await assert.rejects(clients[1].execute('projects','show',{},'p2'),{code:'NOT_IN_SCOPE'});
 return {label:'测试环境，不含正式业务数据',syntheticAccounts:2,additionalSyntheticProjects:records,visibleProjectTotals:totals,load:'Scoped project directory reads through the real native server; not employee-count or production capacity certification',clientExecution:'in-process API clients, not concurrent Windows CLI startups',stages,httpGets:gets,businessWritesDuringReadLoad:0,productionRequests:0};
}
