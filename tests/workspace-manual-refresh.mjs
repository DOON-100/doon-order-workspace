import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {QueryClient,QueryObserver,focusManager,onlineManager} from '@tanstack/react-query';
import fs from 'node:fs/promises';
await build({entryPoints:['app/workspace-query-policy.ts'],outfile:'test-output/workspace-query-policy.mjs',bundle:true,format:'esm',platform:'node'});
const {workspaceQueryPolicy,refreshWorkspaceQueries}=await import('../test-output/workspace-query-policy.mjs');
const client=new QueryClient({defaultOptions:{queries:workspaceQueryPolicy}});
let reads=0;
const query={queryKey:['synthetic-manual-list'],queryFn:async()=>({version:++reads})};
client.mount();
let stop;
try{
 await client.fetchQuery(query);
 const observer=new QueryObserver(client,query);stop=observer.subscribe(()=>{});
 focusManager.setFocused(false);focusManager.setFocused(true);
 onlineManager.setOnline(false);onlineManager.setOnline(true);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(reads,1,'Focus, reconnect and remount reuse the current snapshot');
 assert.equal(workspaceQueryPolicy.refetchInterval,false);
 await observer.refetch();assert.equal(reads,2,'Manual refresh retrieves the latest data');
 await client.invalidateQueries({queryKey:query.queryKey});assert.equal(reads,3,'Successful writes can still invalidate dependent reads');
}finally{stop?.();client.unmount();client.clear();focusManager.setFocused(undefined);onlineManager.setOnline(true);}
{
 const client=new QueryClient({defaultOptions:{queries:workspaceQueryPolicy}}),calls=[];
 const observe=(key,fn)=>{const observer=new QueryObserver(client,{queryKey:key,queryFn:fn});return observer.subscribe(()=>{});};
 let revision=1;
 const stopShared=observe(['workspace'],async()=>{calls.push('shared');return {revision};});
 let stopDetail=observe(['detail',1],async()=>{calls.push('detail-1');return {};});
 const stopList=observe(['unversioned-list'],async()=>{calls.push('list');return {};});
 await new Promise(resolve=>setTimeout(resolve,0));calls.length=0;
 revision=2;
 try{
  await refreshWorkspaceQueries(client,async()=>{
   stopDetail();
   stopDetail=observe(['detail',2],async()=>{calls.push('detail-2');await new Promise(resolve=>setTimeout(resolve,10));return {};});
  });
  assert.deepEqual(calls,['shared','detail-2','list'],'Refresh joins the new revision read, skips the old key and refreshes unversioned lists once');
 }finally{stopShared();stopDetail();stopList();client.clear();}
}
// Guard the boundaries of this cleanup: browser list polling stays disabled,
// while the fixed-tools clock may keep updating its local display.
for(const name of await fs.readdir('app')){
 if(!/\.(tsx|ts)$/.test(name))continue;
 const source=await fs.readFile('app/'+name,'utf8');
 assert(!/refetchInterval:\s*\d/.test(source),name+' reintroduced list polling');
 assert(!/addEventListener\(['"]focus['"]/.test(source),name+' reintroduced focus refresh');
 if(name!=='fixed-data-tools-panel.tsx')assert(!/setInterval\(/.test(source),name+' reintroduced a business read timer');
}
assert(!(await fs.readFile('app/workspace.tsx','utf8')).includes('prefetchWorkspacePages('),'Opening a page must not preload every navigation source');
console.log('PASS manual list reads: no focus/reconnect/polling/preload, cached remount, explicit refresh and write invalidation remain available');
