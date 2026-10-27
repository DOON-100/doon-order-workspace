import {build} from 'esbuild';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function testIeMaterialNames({pass}){
 const output=path.resolve('test-output','ie-material-names-'+process.pid);await fs.mkdir(output,{recursive:true});
 const store=`export class AppError extends Error{constructor(message,status=400){super(message);this.status=status}}
 export const json=value=>Response.json(value);
 export const audit=(m,target,before,action)=>({id:'audit_'+crypto.randomUUID(),kind:'audit',actorId:m.id,targetId:target.id,action});
 export async function commit(revision,records){const s=globalThis.__ieNamesState;if(s.revision!==revision)throw new AppError('conflict',409);for(const r of records){if(s.records.some(v=>v.id===r.id))throw Error('Name catalogs are append-only');s.records.push(r)}s.revision++}`;
 const outfile=path.join(output,'api.mjs');await build({stdin:{contents:"export * from './lib/ie-material-names-api';export * from './lib/ie-material-names';",resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'ie-names-store',setup(b){b.onResolve({filter:/^\.\/store$/},()=>({path:'store',namespace:'names'}));b.onLoad({filter:/.*/,namespace:'names'},()=>({contents:store}));}}]});
 const api=await import(pathToFileURL(outfile).href),member=(id,role)=>({id,kind:'member',role,name:id,userId:id,active:true,customers:[],email:id+'@test.invalid',createdAt:'2026-01-01'});
 const admin=member('name-admin','admin'),engineer=member('name-engineer','production'),reviewer=member('name-reviewer','production'),manager=member('name-manager','production');
 const preserved={id:'old-color-catalog',kind:'sales_color_field_catalog',version:2,catalog:{fields:[{id:'synthetic',labelZh:'合成旧名称'}]}},oldQuote={id:'old-quote',kind:'ie_quote',version:1,lines:[]};
 globalThis.__ieNamesState={revision:1,records:[admin,engineer,reviewer,manager,preserved,oldQuote,{id:'name-policy',kind:'ie_quote_policy',version:1,engineerMemberId:engineer.id,reviewerMemberId:reviewer.id,finalApproverMemberId:manager.id}]};
 const state=()=>structuredClone(globalThis.__ieNamesState),snapshot=()=>JSON.stringify(globalThis.__ieNamesState),get=(q='',m=engineer)=>api.ieMaterialNamesGet('ie-material-names',new URL('https://test.invalid/?q='+encodeURIComponent(q)),state(),m).json();
 const entry=(id,name,nameEn='')=>({id,code:'T'+id,name,nameEn,sourceSheet:'Synthetic',sourceRow:Number(id)+2});
 const catalog={sourceFilename:'synthetic-names.xlsx',sourceSha256:'a'.repeat(64),entries:[entry('1','合成圈料色','Synthetic Rim Color'),entry('2','合成钉色','Synthetic Rivet Color'),entry('3','合成针色','Synthetic Rivet Color'),entry('4','螺丝色1'),entry('5','螺丝色2'),...Array.from({length:24},(_,i)=>entry(String(i+10),'其他合成名称'+i))]};
 const payload=(version=0,data=catalog)=>({version,token:crypto.randomUUID(),catalog:data});
 const post=async(input,m=admin,s=state())=>(await api.ieMaterialNamesPost('ie-material-names-import',new Request('https://test.invalid/api',{method:'POST',body:JSON.stringify(input)}),s,m)).json();
 const deny=async(input,status,m=admin)=>{const before=snapshot();await assert.rejects(()=>post(input,m),e=>e.status===status);assert.equal(snapshot(),before);};
 assert.equal((await get()).total,0);const input=payload(),saved=await post(input),first=snapshot();assert.equal(saved.count,29);assert.equal((await post(input)).idempotent,true);assert.equal(snapshot(),first);
 assert.equal((await get()).items.length,29);assert.equal((await get()).total,29);assert.equal((await get('T1')).items[0].id,'1');assert.equal((await get('圈料')).items[0].name,'合成圈料色');assert.equal((await get('合成圈枓')).items[0].id,'1');assert.equal((await get('ＲＩＭ')).items[0].id,'1');
 assert.deepEqual((await get('Rivet')).items.map(v=>v.id),['2','3']);assert.deepEqual((await get('螺丝')).items.map(v=>v.name),['螺丝色1','螺丝色2']);assert.equal((await get('完全无关查询')).total,0);assert(!('basePrice' in (await get()).items[0]));
 pass('IE 名称资料：中英编码与模糊检索、同英文多候选、保留数字及原名、不推断单价');
 const partGet=(q='',m=engineer)=>api.ieMaterialNamesGet('ie-material-names',new URL('https://test.invalid/?kind=part&q='+encodeURIComponent(q)),state(),m).json();
 const parts=await partGet();assert.equal(parts.items.length,29);assert.equal(parts.items[0].name,'合成圈料');assert.equal(parts.items[0].sourceName,'合成圈料色');assert.equal(parts.items[0].nameUsage,'part-v1');assert.deepEqual((await partGet('螺丝')).items.map(v=>v.name),['螺丝1','螺丝2']);assert.equal((await partGet('合成圈料色')).items[0].name,'合成圈料');assert.equal((await get()).items[0].name,'合成圈料色');
 const partRef={catalogId:saved.id,catalogVersion:1,entryId:'1',nameUsage:'part-v1'},partFields={lines:[{materials:[{name:'合成圈料',nameReference:partRef}]}]};assert.equal(api.validateIeMaterialNameReferences(state(),partFields),null);assert.match(api.validateIeMaterialNameReferences(state(),{lines:[{materials:[{name:'合成圈料色',nameReference:partRef}]}]}),/不一致/);assert.match(api.validateIeMaterialNameReferences(state(),{lines:[{materials:[{name:'合成圈料',nameReference:{...partRef,nameUsage:undefined}}]}]}),/不一致/);
 const projectionSource={id:'synthetic-part-projection',kind:'ie_material_name_catalog',version:1,catalog:{...catalog,entries:['合成前框电镀色','合成饰件颜色','合成饰件色2','合成内饰件色','合成外饰件色','合成镜片编码','合成批次号','合成条形码','合成镜片CAT值','合成喷油色','合成脾丝印色','合成注塑色','LOGO色','其他','合成客供件','合成色号'].map((name,i)=>entry(String(i+1),name))}},sourceSnapshot=JSON.stringify(projectionSource),projected=api.materialPartChecklist(projectionSource);
 assert.deepEqual(projected.map(e=>e.name),['合成前框','合成饰件','合成饰件2','合成内饰件','合成外饰件','合成客供件']);assert.equal(JSON.stringify(projectionSource),sourceSnapshot);assert(projected.every(e=>e.sourceName&&e.nameUsage==='part-v1'&&!('basePrice'in e)&&!('usage'in e)));assert.deepEqual(api.materialPartChecklist(null),[]);
 assert.equal(api.ieMaterialNameReference.safeParse(partRef).success,true);assert.equal(api.ieMaterialNameReference.safeParse({...partRef,nameUsage:'unknown-rule'}).success,false);assert.throws(()=>api.ieMaterialNamesGet('ie-material-names',new URL('https://test.invalid/?kind=unknown'),state(),engineer),e=>e.status===400);assert.throws(()=>partGet('',member('outsider','viewer')),e=>e.status===403);
 const rejectedState={...state(),records:[...state().records,projectionSource]};assert.match(api.validateIeMaterialNameReferences(rejectedState,{lines:[{materials:[{name:'合成喷油',nameReference:{catalogId:projectionSource.id,catalogVersion:1,entryId:'10',nameUsage:'part-v1'}}]}]}),/不一致/);
 pass('IE配件清单：只读派生部位名、排除元数据/工艺/泛指、保留编号与内外区分、原名可检索且无价格推断；part-v1引用独立验证');
 const ref={catalogId:saved.id,catalogVersion:1,entryId:'1'},fields={lines:[{materials:[{name:'合成圈料色',nameReference:ref}]}]};assert.equal(api.validateIeMaterialNameReferences(state(),fields),null);
 assert.match(api.validateIeMaterialNameReferences(state(),{lines:[{materials:[{name:'手工改名',nameReference:ref}]}]}),/不一致/);assert.equal(api.validateIeMaterialNameReferences(state(),{lines:[{materials:[{name:'手工改名'}]}]}),null);
 const next=structuredClone(catalog);next.entries[0].name='修订名称';const saved2=await post(payload(1,next));assert.equal(saved2.version,2);assert.equal(api.validateIeMaterialNameReferences(state(),fields),null);assert.equal(api.validateIeMaterialNameReferences(state(),partFields),null);assert.equal((await get('T1')).items[0].name,'修订名称');
 assert.deepEqual(state().records.find(r=>r.id===preserved.id),preserved);assert.deepEqual(state().records.find(r=>r.id===oldQuote.id),oldQuote);
 pass('IE 名称资料：独立不可变版本、历史引用有效、手写需解除引用、旧字典及报价完整保留');
 await deny(payload(),409);await deny({...input,catalog:{...catalog,sourceFilename:'changed.xlsx'}},409);await deny(payload(2),403,engineer);await deny(payload(2),403,{...admin,active:false});await deny(payload(2),403,member('supplier','supplier'));
 for(const m of [member('outsider','viewer'),member('supplier','supplier'),{...admin,active:false}])assert.throws(()=>get('',m),e=>e.status===403);
 await deny(payload(2,{...catalog,entries:[catalog.entries[0],catalog.entries[0]]}),400);await deny(payload(2,{...catalog,entries:[{...catalog.entries[0],basePrice:2}]}),400);await deny(payload(2,{...catalog,sourceFilename:'C:/private.xlsx'}),400);
 const fullCatalog={...catalog,entries:Array.from({length:74},(_,i)=>entry(String(i+1),'合成材料'+(i+1)))};await post(payload(2,fullCatalog));assert.equal((await get()).items.length,74);assert.equal((await get()).total,74);
 pass('IE 名称下拉：空查询返回完整74项，旧名称无匹配不影响浏览全部');
 const stale=state();globalThis.__ieNamesState.revision++;await assert.rejects(()=>post(payload(3),admin,stale),e=>e.status===409);
 pass('IE 名称资料：权限、幂等、并发版本、重复编号及越界字段校验');
 delete globalThis.__ieNamesState;
}
