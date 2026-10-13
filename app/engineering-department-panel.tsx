'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {Button} from '@/components/ui/button';
import {EngineeringDrawingPanel} from './engineering-drawing-panel';
import {EngineeringSopPanel} from './engineering-sop-panel';
import {EngineeringTaskBoard,type EngineeringTaskCard} from './engineering-task-board';
import {request} from './ui';
import type {Data} from './workspace';

export function EngineeringDepartmentPanel({data,onDirtyChange}:{data:Data;onDirtyChange?:(dirty:boolean)=>void}){
 const [tab,setTab]=useState<'board'|'drawing'|'sop'>('board'),[selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[drawings,setDrawings]=useState<any[]>([]),[sops,setSops]=useState<any[]>([]),[error,setError]=useState('');
 const reload=useCallback(async()=>{const [d,s]=await Promise.all([request('drawing-data'),request('sop-data')]);setDrawings(d.records||[]);setSops(s.records||[]);setError('');},[]);
 useEffect(()=>{if(tab!=='board')return;let alive=true;const load=()=>reload().catch(e=>{if(alive)setError(e.message);});void load();const timer=setInterval(load,30000);return()=>{alive=false;clearInterval(timer);};},[tab,reload]);
 const changed=useCallback((value:boolean)=>{setDirty(value);onDirtyChange?.(value);},[onDirtyChange]);
 const tasks=useMemo<EngineeringTaskCard[]>(()=>[...drawings.map(r=>({id:r.id,kind:'drawing' as const,title:r.modelNo||r.drawingType||'画图需求',customerCode:r.customerCode,category:r.drawingType||'画图需求',status:r.status,assignee:r.assignee||'',deadline:r.deadline||'',summary:r.requirement||r.drawingNotes||'',updatedAt:r.updatedAt,attention:r.status==='历史待核对'})),...sops.map(r=>{const d=drawings.find(d=>d.id===r.drawingRecordId);return {id:r.id,kind:'sop' as const,title:`${r.modelNo||d?.modelNo||'SOP'} · ${r.targetVersion||'版本待确认'}`,customerCode:d?.customerCode||'',category:r.isCurrent===false?'历史版本':r.status,status:r.isCurrent===false?'已替代':r.status,assignee:d?.assignee||'',deadline:'',summary:r.requirement||'',updatedAt:r.updatedAt,attention:r.isCurrent!==false&&r.status!=='已确认'&&r.status!=='已取消'};})],[drawings,sops]);
 const move=(next:typeof tab,id='')=>{if(next===tab&&id===selected)return;if(dirty&&!confirm('当前内容尚未保存，是否放弃并切换？'))return;changed(false);setSelected(id);setTab(next);};
 return <div className="space-y-5"><div className="flex gap-2 flex-wrap" role="group" aria-label="工程部门页面"><Button variant={tab==='board'?'default':'outline'} onClick={()=>move('board')}>工程管理看板</Button><Button variant={tab==='drawing'?'default':'outline'} onClick={()=>move('drawing')}>画图跟进表</Button><Button variant={tab==='sop'?'default':'outline'} onClick={()=>move('sop')}>MES 待上传 SOP</Button></div>
 {tab==='board'&&<>{error&&<p role="alert" className="error notice">{error}</p>}<EngineeringTaskBoard tasks={tasks} onOpen={task=>move(task.kind==='drawing'?'drawing':'sop',task.id)}/></>}
 {tab==='drawing'&&<EngineeringDrawingPanel key={'drawing:'+selected} data={data} initialRecordId={selected} onDirtyChange={changed}/>}
 {tab==='sop'&&<EngineeringSopPanel key={'sop:'+selected} data={data} initialSopId={selected} onDirtyChange={changed}/>}
 </div>;
}
