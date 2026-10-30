// Synthetic interactions only. No business data or network access.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {renderToStaticMarkup} from 'react-dom/server';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const output=path.resolve('test-output','supplier-catalog-ui-'+process.pid);await fs.mkdir(output,{recursive:true});
const H={slots:[],index:0,calls:[],team:'',actor:'synthetic-pmc',mode:'normal'};globalThis.__supplierCatalogUi=H;
const modules={
 react:`const H=globalThis.__supplierCatalogUi;export function useState(initial){const i=H.index++;if(!H.slots[i])H.slots[i]={value:typeof initial==='function'?initial():initial};return [H.slots[i].value,v=>{H.slots[i].value=typeof v==='function'?v(H.slots[i].value):v}]}export function useRef(initial){const i=H.index++;return H.slots[i]||(H.slots[i]={current:initial})}export function useEffect(){}export function useLayoutEffect(){}export const useMemo=fn=>fn();export const useCallback=fn=>fn;`,
 button:`export const Button='button';`,
 dialog:`export function Dialog({open,children}){return open?children:null}export const DialogContent='div',DialogHeader='div',DialogTitle='h2',DialogDescription='p';`,
 team:`export function getBusinessTeamScope(){return globalThis.__supplierCatalogUi.team}`,
 id:`export function clientId(){return '123e4567-e89b-42d3-a456-426614174000'}`,
 ui:`export const dateTime=v=>v;export async function request(action,body){const h=globalThis.__supplierCatalogUi;h.calls.push({action,body});if(action==='kingdee-supplier-catalog'){if(h.mode==='read-error')throw Error('无权查看');return {rows:[{id:'1',code:'A',name:'合成甲',firstSeen:'2026-10-30',groupName:null,taxRate:'0'}],lastSync:{inserted:1,existing:0,changed:1,total:1,completedAt:'2026-10-30'},issues:[{code:'B',name:'新名',previousCode:'A',previousName:'旧名',reason:'来源变更'}],autoEnabled:h.mode==='automatic',autoStatus:h.mode==='automatic'?{lastAttemptAt:'2026-10-30',lastResult:'started',lastSuccessAt:''}:null}}if(action==='kingdee-supplier-catalog-sync'){if(h.mode==='uncertain')throw Error('连接中断');return {inserted:1,existing:0,changed:1,total:1,completedAt:'2026-10-30'}}if(action.startsWith('kingdee-supplier-catalog-result'))return {status:'not-completed'};throw Error('unknown')}`
};
const outfile=path.join(output,'ui.mjs');await build({entryPoints:['app/kingdee-supplier-catalog-panel.tsx'],outfile,bundle:true,platform:'node',format:'esm',packages:'external',alias:{'@':process.cwd()},jsx:'automatic',plugins:[{name:'ui-stubs',setup(b){for(const [re,name] of [[/^react$/,'react'],[/components\/ui\/button$/,'button'],[/components\/ui\/dialog$/,'dialog'],[/lib\/client-id$/,'id'],[/^\.\/business-team-client$/,'team'],[/^\.\/ui$/,'ui']])b.onResolve({filter:re},()=>({path:name,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:modules[a.path],loader:'jsx'}));}}]});
const {KingdeeSupplierCatalogPanel}=await import(pathToFileURL(outfile).href);let tree;
function render(){H.index=0;tree=KingdeeSupplierCatalogPanel({actorId:H.actor});return renderToStaticMarkup(tree)}
function nodes(n=tree,out=[]){if(Array.isArray(n)){n.forEach(x=>nodes(x??null,out));return out}if(n&&typeof n==='object'){out.push(n);nodes(n.props?.children??null,out)}return out}
const button=label=>nodes().find(n=>n.type==='button'&&n.props.children===label);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
let html=render();assert.equal(H.calls.length,0);button('金蝶供应商档案').props.onClick();await tick();html=render();assert.deepEqual(H.calls.map(v=>v.action),['kingdee-supplier-catalog']);assert(html.includes('合成甲'));assert(html.includes('旧名'));assert(html.includes('未提供'));assert(html.includes('>0<'));assert(html.includes('手动更新'));assert(html.includes('自动同步未启用'));
H.mode='uncertain';button('手动更新金蝶档案').props.onClick();await tick();html=render();assert(html.includes('同步结果尚未确认'));assert.equal(H.calls.at(-1).body.requestId,'123e4567-e89b-42d3-a456-426614174000');
button('核查本次结果').props.onClick();await tick();html=render();assert(html.includes('暂未查到完成回执'));assert(H.calls.at(-1).action.endsWith('123e4567-e89b-42d3-a456-426614174000'));
H.mode='normal';button('使用同一编号重试').props.onClick();await tick();html=render();const writes=H.calls.filter(v=>v.action==='kingdee-supplier-catalog-sync');assert.equal(writes.length,2);assert.equal(writes[0].body.requestId,writes[1].body.requestId);assert(html.includes('本次新增 1 条'));
H.mode='automatic';button('刷新列表').props.onClick();await tick();html=render();assert(html.includes('自动同步已配置'));assert(html.includes('如长时间不更新请核查服务端'));
H.actor='another-user';html=render();assert(!html.includes('合成甲'));H.actor='synthetic-pmc';html=render();
H.mode='read-error';button('刷新列表').props.onClick();await tick();html=render();assert(html.includes('无权查看'));assert(!html.includes('合成甲'));
H.team='other';html=render();assert(button('金蝶供应商档案').props.disabled);assert(!html.includes('合成甲'));
delete globalThis.__supplierCatalogUi;console.log('PASS supplier catalog UI: explicit sync, uncertain-result receipt, same-id retry, scope and stale-data protection');
