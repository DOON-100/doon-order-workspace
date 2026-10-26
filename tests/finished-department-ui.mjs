// Synthetic component-state and rendered-HTML regressions; no production data or network.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export async function testFinishedDepartmentUi({pass=name=>console.log('PASS '+name)}={}){
 const output=path.resolve('test-output','finished-department-ui-'+process.pid);
 await fs.mkdir(output,{recursive:true});
 const outfile=path.join(output,'ui.mjs'),hooks={slots:[],index:0};
 globalThis.__finishedDepartmentUiHooks=hooks;
 const modules={
  react:`const H=globalThis.__finishedDepartmentUiHooks;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v;}];}export function useMemo(fn){H.index++;return fn();}export function useEffect(){H.index++;}`,
  button:`export const Button='button';`,
  progress:`export const Progress='progress';`,
  textarea:`export const Textarea='textarea';`,
  icons:`export const Download='svg',ArrowUpRight='svg',AlertTriangle='svg',Archive='svg',CheckCircle2='svg',UploadCloud='svg',Save='svg';`,
  download:`export const BusinessTeamDownloadButton='a';`,
  access:`export function AccessNotice(){return null;}`,
  loss:`export function LossRecorder(){return null;}`,
  ui:`export const Input='input';export function Field({label,children}){return <label>{label}{children}</label>;}export function Choice(){return null;}export function Empty(){return null;}export function Grid({headers,rows}){return <table><thead><tr>{headers.map((h,i)=><th key={i}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>)}</tbody></table>;}export const dateTime=v=>v;export async function request(){throw Error('unexpected network request');}`
 };
 await build({entryPoints:['app/ledger-panels.tsx'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',plugins:[{name:'synthetic-finished-department-ui',setup(b){
  b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'synthetic-finished'}));
  b.onResolve({filter:/^lucide-react$/},()=>({path:'icons',namespace:'synthetic-finished'}));
  b.onResolve({filter:/components\/ui\/(button|progress|textarea)$/},a=>({path:a.path.split('/').at(-1),namespace:'synthetic-finished'}));
  for(const [name,file] of [['ui','ui'],['download','business-team-download'],['access','access-notice'],['loss','loss-panel']])b.onResolve({filter:new RegExp('^\\./'+file+'$')},()=>({path:name,namespace:'synthetic-finished'}));
  b.onLoad({filter:/.*/,namespace:'synthetic-finished'},a=>({contents:modules[a.path],loader:'jsx',resolveDir:process.cwd()}));
 }}]});
 const {DepartmentPanel,LedgerEditor}=await import(pathToFileURL(outfile).href);
 let tree,html;
 function reset(){hooks.slots=[];hooks.index=0;}
 function render(Component,props){hooks.index=0;tree=Component(props);html=renderToStaticMarkup(tree);return html;}
 function nodes(n=tree,out=[]){if(Array.isArray(n)){n.forEach(v=>nodes(v??null,out));return out;}if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out);nodes(n.props?.rows??null,out);}return out;}
 function text(n){if(n==null||typeof n==='boolean')return '';if(Array.isArray(n))return n.map(text).join('');if(typeof n==='string'||typeof n==='number')return String(n);return text(n.props?.children);}
 const button=label=>nodes().find(n=>n.type==='button'&&text(n)===label);
 const input=id=>nodes().find(n=>n.type==='input'&&n.props.id===id);
 const order=(id,factory='度昂',patch={})=>({id,kind:'order',version:4,source:'synthetic-ledger.xlsx',orderNo:id.toUpperCase(),customer:'合成客户',customerPO:'SYN-PO',drawing:'SYN-DRAWING',color:'SYN-C1',lens:'白片',quantity:100,ownerEmail:'synthetic-owner@test.invalid',sourceStatus:'',lifecycle:'active',extra:{},ledger:{sheet:'合成动态表',sourceRow:4,ownerName:'合成跟单员',columns:{A:factory,M:'100',BF:'100',BG:'2026-10-24',BI:'已核对合成收货凭据'}},...patch});
 const internal=order('synthetic-internal'),external=Array.from({length:4},(_,i)=>order('synthetic-external-'+(i+1),'合成外发工厂'));
 const hidden=[order('synthetic-archived','合成外发工厂',{lifecycle:'archived'}),order('synthetic-cancelled','合成外发工厂',{sourceStatus:'已取消'}),order('synthetic-standard','度昂',{ledger:undefined})];
 const finished={id:'synthetic-finished-clerk',name:'合成成品文员',email:'synthetic-finished@test.invalid',role:'clerk',departments:['finished'],customers:[],active:true};
 const data={me:finished,orders:[internal,...external,...hidden],losses:[],reports:[]};
 let opened;
 const panel={data,openOrder:o=>{opened=o;}};
 reset();render(DepartmentPanel,panel);
 for(const o of [internal,...external])assert.ok(html.includes(o.orderNo),'finished department must include '+o.orderNo);
 for(const o of hidden)assert.ok(!html.includes(o.orderNo),'non-active/non-ledger row must stay out of department list');
 assert.ok(html.includes('本厂生产'));assert.ok(html.includes('成品外发 · 合成外发工厂'));
 nodes().find(n=>n.props?.['aria-label']==='部门订单搜索').props.onChange({target:{value:external[2].orderNo.toLowerCase()}});
 render(DepartmentPanel,panel);assert.ok(html.includes(external[2].orderNo));assert.ok(!html.includes(external[0].orderNo));assert.ok(!html.includes(internal.orderNo));
 button('录入本部门').props.onClick();assert.equal(opened,external[2]);
 pass('成品部门包含本厂与外发原表订单，展示生产来源，搜索并打开同一明细');

 const multiPanel={...panel,data:{...data,me:{...finished,departments:['plating','finished']}}};
 reset();render(DepartmentPanel,multiPanel);assert.ok(html.includes(internal.orderNo));assert.ok(!html.includes(external[0].orderNo));
 button('成品文员').props.onClick();render(DepartmentPanel,multiPanel);assert.ok(html.includes(external[0].orderNo));
 button('电镀仓').props.onClick();render(DepartmentPanel,multiPanel);assert.ok(!html.includes(external[0].orderNo));
 pass('切换成品与电镀部门时，外发订单仅进入成品工序列表');

 const calls=[];let closed=0;
 const editor=(o=external[0],me=finished)=>({order:o,data:{...data,me},busy:false,act:async(action,payload)=>{calls.push({action,payload});return {ok:true};},onClose:()=>{closed++;}});
 function ready(props){reset();render(LedgerEditor,props);const reason=nodes().find(n=>n.type==='textarea'&&n.props['aria-label']==='工序修改依据');assert.ok(reason);reason.props.onChange({target:{value:'合成入仓凭据已核对'}});render(LedgerEditor,props);}
 let ep=editor();reset();render(LedgerEditor,ep);assert.equal(button('确认结单并归档').props.disabled,true);
 for(const c of ['BF','BG','BH','BI'])assert.ok(input('process-'+c),'finished clerk can maintain '+c);
 for(const c of ['AG','AL'])assert.ok(!input('process-'+c),'finished clerk cannot maintain '+c);
 assert.ok(nodes().some(n=>n.type==='a'&&n.props.href==='/finished-outsourcing?orderId='+encodeURIComponent(external[0].id)));
 ready(ep);assert.equal(button('确认结单并归档').props.disabled,false);
 nodes().find(n=>n.props?.['aria-label']==='实际结单日期').props.onChange({target:{value:'2026-10-25'}});render(LedgerEditor,ep);
 await button('确认结单并归档').props.onClick();assert.deepEqual(calls,[{action:'ledger-lifecycle',payload:{id:external[0].id,version:4,mode:'archived',reason:'合成入仓凭据已核对',closedDate:'2026-10-25'}}]);assert.equal(closed,1);
 ready(editor(internal));assert.equal(button('确认结单并归档').props.disabled,false);
 render(LedgerEditor,{...editor(internal),busy:true});assert.equal(button('确认结单并归档').props.disabled,true);
 pass('成品文员足量入仓且日期有效后可确认结单，本厂和外发沿用同一归档动作');

 for(const [quantity,BF,BG] of [[100,'99','2026-10-24'],[100,'101','2026-10-24'],[100,'-','2026-10-24'],[100,'bad','2026-10-24'],[100,'100',''],[100,'100','-'],[100,'100','2026-02-30'],[0,'0','2026-10-24']]){
  const o={...external[0],quantity,ledger:{...external[0].ledger,columns:{...external[0].ledger.columns,BF,BG}}};
  ready(editor(o));assert.equal(button('确认结单并归档').props.disabled,true,JSON.stringify({quantity,BF,BG}));
 }
 for(const me of [{...finished,departments:['plating']},{...finished,departments:[]}]){reset();render(LedgerEditor,editor(external[0],me));assert.ok(!button('确认结单并归档'));assert.ok(!input('process-BF'));}
 reset();render(LedgerEditor,editor({...external[0],lifecycle:'archived'}));assert.ok(!button('恢复到动态表'));assert.ok(!button('确认结单并归档'));
 pass('不足量、超量、无效数量或入仓日期禁止文员结单，普通文员与成品文员均不能越权恢复档案');

 ep=editor();ready(ep);let navigationPrevented=false;
 const supplierLink=()=>nodes().find(n=>n.type==='a'&&text(n)==='查看成品外发协作与排期总表');
 supplierLink().props.onClick({preventDefault(){navigationPrevented=true;}});assert.equal(navigationPrevented,false);
 input('process-BI').props.onChange({target:{value:'新合成入仓凭据待保存'}});render(LedgerEditor,ep);
 supplierLink().props.onClick({preventDefault(){navigationPrevented=true;}});assert.equal(navigationPrevented,true);
 render(LedgerEditor,ep);assert.ok(html.includes('请先保存本部门字段，再打开协作总表。'));assert.equal(input('process-BI').props.value,'新合成入仓凭据待保存');
 assert.equal(button('确认结单并归档').props.disabled,true);assert.ok(html.includes('请先保存本部门字段'));
 const before=calls.length;await button('确认结单并归档').props.onClick();assert.equal(calls.length,before);assert.equal(closed,1);
 render(LedgerEditor,ep);await button('保存本部门字段').props.onClick();assert.deepEqual(calls.at(-1),{action:'ledger-edit',payload:{id:external[0].id,version:4,patch:{BI:'新合成入仓凭据待保存'},reason:'合成入仓凭据已核对'}});assert.equal(closed,2);
 pass('未保存字段拦截归档和协作总表跳转并保留输入，保存仅提交本部门变更及原版本');
 delete globalThis.__finishedDepartmentUiHooks;
 return {passed:5,output};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await testFinishedDepartmentUi()));
