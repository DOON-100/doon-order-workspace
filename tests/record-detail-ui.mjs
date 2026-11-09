// Synthetic component events and SSR: no browser, business server, or persistent records.
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output','record-detail-ui-'+process.pid);await fs.mkdir(output,{recursive:true});
const H={slots:[],index:0,calls:[],react:React};globalThis.__recordDetailUi=H;
const stubs={
 react:`const H=globalThis.__recordDetailUi;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,next=>{H.slots[i].value=typeof next==='function'?next(H.slots[i].value):next}]}export function useRef(initial){const i=H.index++;return H.slots[i]||(H.slots[i]={current:initial})}export function useEffect(){}export const useMemo=fn=>fn(),useCallback=fn=>fn;export const {Children,cloneElement,isValidElement}=H.react;`,
 button:`export const Button='button';`,
 dialog:`export function Dialog({open,children}){return open?<div role="dialog">{children}</div>:null}export const DialogContent='section',DialogDescription='p',DialogHeader='header',DialogTitle='h2';`,
 alert:`export function AlertDialog({open,children}){return open?<div>{children}</div>:null}export const AlertDialogContent='div',AlertDialogHeader='header',AlertDialogTitle='h2',AlertDialogDescription='p',AlertDialogFooter='footer',AlertDialogCancel='button',AlertDialogAction='button';`,
 select:`export const Select='div',SelectContent='div',SelectGroup='div',SelectItem='div',SelectLabel='label',SelectTrigger='button',SelectValue='span';`,
 popover:`export function Popover({children}){return <div>{children}</div>}export const PopoverContent=Popover,PopoverTrigger=Popover;`,
 calendar:`export const Calendar='div';`,locale:`export const zhCN={};`,
 table:`export function ExcelTable({children,className,style}){return <table className={className} style={style}>{children}</table>}export const useExcelColumnFilters=records=>({rows:records,total:records.length,filters:{},clearFilters(){}});`,
 query:`export const useQueryClient=()=>({fetchQuery(){throw Error('No query allowed')},setQueryData(){throw Error('No mutation allowed')},invalidateQueries(){throw Error('No mutation allowed')}});`,
 dataQuery:`export const engineeringDataQuery=()=>({});`,
 ui:`export const dateTime=value=>value||'';export async function request(...args){globalThis.__recordDetailUi.calls.push(args);throw Error('No network allowed in read-only detail checks')}`,
 importPanel:`export function OutsourcingCatalogImportPanel(){return null}`,
 client:`export const clientId=()=> 'synthetic-id';`,
};
const routes=[[/^react$/,'react'],[/^@tanstack\/react-query$/,'query'],[/components\/ui\/button$/,'button'],[/components\/ui\/dialog$/,'dialog'],[/components\/ui\/alert-dialog$/,'alert'],[/components\/ui\/select$/,'select'],[/components\/ui\/popover$/,'popover'],[/components\/ui\/calendar$/,'calendar'],[/^react-day-picker\/locale$/,'locale'],[/^\.\/excel-table$/,'table'],[/^\.\/engineering-data-query$/,'dataQuery'],[/^\.\/ui$/,'ui'],[/^\.\/outsourcing-catalog-import-panel$/,'importPanel'],[/lib\/client-id$/,'client']];
await build({entryPoints:['app/outsourcing-catalog-panel.tsx','app/engineering-drawing-panel.tsx'],outdir:output,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'synthetic-detail-dependencies',setup(b){for(const [filter,name]of routes)b.onResolve({filter},()=>({path:name,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'jsx',resolveDir:process.cwd()}));}}]});
const catalogModule=await import(pathToFileURL(path.join(output,'outsourcing-catalog-panel.js')).href),drawingModule=await import(pathToFileURL(path.join(output,'engineering-drawing-panel.js')).href);
const original={type:'excel',filename:'synthetic.xlsx',sheet:'合成子表',row:2,sha256:'a'.repeat(64),hash:'a'.repeat(64),raw:{'含前导零编码':'001','明确零':0},rawColumns:{'含前导零编码':'001','明确零':0}};
const entry={id:'synthetic-catalog',kind:'outsourcing_catalog_entry',category:'type',version:1,identity:'synthetic',mappingStatus:'pending',sequence:'01',code:'001',name:'合成外发类型',ownerDepartment:'synthetic-dept',note:'长说明\n第二行',productFamily:'合成架型',processingObject:'合成部位',actions:['合成动作1','合成动作2'],statDepartment:'合成统计部门',statProcess:'合成工序',includeCost:'合成成本',originalEditor:'合成编辑人',costHistory:{'2026-01':'历史口径'},active:true,updatedAt:'2026-11-09T00:00:00Z',createdAt:'2026-11-01T00:00:00Z',updatedBy:'合成人员',reason:'合成说明',source:original,canEdit:false};
const drawing={id:'synthetic-drawing',version:1,customerId:'synthetic-customer',customerCode:'SYN-001',drawingType:'新款',requestedDate:'2026-11-09',newCount:0,revisionCount:null,requester:'合成需求者',modelNo:'SYN-MODEL',drawingNotes:'多行备注\n第二行',assigneeId:'',assignee:'合成人员',deadline:'',completedDate:'',approval:'待审核',status:'待分配',sheetStatus:'⌛️',upstreamDepartment:'合成上游',priority:'普通',requirement:'合成需求说明',downstream:'合成接收部门',deliveredDate:'',deliveryNote:'合成交接说明',updatedAt:'2026-11-09T00:00:00Z',updatedBy:'合成编辑人',source:original,canEdit:false,canManage:false};
function nodes(node,out=[]){if(Array.isArray(node)){node.forEach(n=>nodes(n,out));return out;}if(node&&typeof node==='object'){out.push(node);if(typeof node.type==='function')nodes(node.type(node.props),out);else nodes(node.props?.children,out);}return out;}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):Array.isArray(node)?node.map(text).join(''):node?.props?text(node.props.children):'';
let tree;
const button=label=>nodes(tree).find(n=>n.type==='button'&&text(n)===label);
const render=(component,props)=>{H.index=0;tree=component(props);return renderToStaticMarkup(tree);};
try{
 let html=renderToStaticMarkup(React.createElement(catalogModule.OutsourcingCatalogReadOnlyDetails,{entry,departmentName:()=> '合成部门'}));assert(html.includes('合成部门'));assert(html.includes('001'));assert(html.includes('历史口径'));assert(html.includes('明确零'));assert(!html.includes('<input'));assert(!html.includes('<form'));
 html=renderToStaticMarkup(React.createElement(drawingModule.DrawingReadOnlyDetails,{record:drawing}));assert.match(html,/<dt>新款数量<\/dt><dd>0<\/dd>/);assert.match(html,/<dt>改图数量<\/dt><dd>—<\/dd>/);assert(html.includes('合成交接说明'));assert(html.includes('合成子表'));assert(html.includes('001'));assert(!html.includes('<input'));assert(!html.includes('<form'));
 H.slots=[{value:{entries:[entry],settings:[],grants:[],departments:[{id:'synthetic-dept',name:'合成部门'}],members:[],permissions:{admin:false,maintainDepartments:[]}}}];
 const catalogProps={me:{id:'reader'},onDirtyChange(){}};render(catalogModule.OutsourcingCatalogPanel,catalogProps);assert(button('查看详情'));assert(!button('编辑'));button('查看详情').props.onClick();html=render(catalogModule.OutsourcingCatalogPanel,catalogProps);assert(html.includes('role="dialog"'));assert(html.includes('资料详情'));assert(html.includes('长说明'));button('关闭详情').props.onClick();html=render(catalogModule.OutsourcingCatalogPanel,catalogProps);assert(!html.includes('role="dialog"'));
 button('查看详情').props.onClick();html=render(catalogModule.OutsourcingCatalogPanel,{...catalogProps,me:{id:'another-reader'}});assert(!html.includes('role="dialog"'),'identity change clears details before effects');
 H.slots=[];const drawingProps={data:{me:{id:'reader'}},initialData:{records:[drawing],customers:[],members:[],requesters:[],events:[],canCreate:false,canManage:false,canApprove:false,canToggleApproval:false},onDirtyChange(){}};
 render(drawingModule.EngineeringDrawingPanel,drawingProps);assert(button('查看详情'));button('查看详情').props.onClick();html=render(drawingModule.EngineeringDrawingPanel,drawingProps);assert(html.includes('role="dialog"'));assert(html.includes('画图记录详情'));assert(html.includes('合成需求说明'));button('关闭详情').props.onClick();html=render(drawingModule.EngineeringDrawingPanel,drawingProps);assert(!html.includes('role="dialog"'));
 button('查看详情').props.onClick();html=render(drawingModule.EngineeringDrawingPanel,{...drawingProps,data:{me:{id:'another-reader'}}});assert(!html.includes('role="dialog"'),'identity change cannot retain prior drawing details');assert.equal(H.calls.length,0);
 console.log('PASS read-only catalog/drawing detail UI: full authorized fields and sources, zero/null, read-only entry, open/close, immediate identity isolation, no reads or writes triggered by detail actions. Browser not exercised.');
}finally{delete globalThis.__recordDetailUi;}
