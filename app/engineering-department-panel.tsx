'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {EngineeringDrawingPanel} from './engineering-drawing-panel';
import {EngineeringSopPanel} from './engineering-sop-panel';
import {EngineeringTaskBoard,type EngineeringTaskCard} from './engineering-task-board';
import {request} from './ui';
import type {Data} from './workspace';
import type {WorkspaceNavigationContext} from '@/lib/handoff-navigation';

export function EngineeringDepartmentPanel({data,onDirtyChange,initialContext={}}:{data:Data;onDirtyChange?:(dirty:boolean)=>void;initialContext?:WorkspaceNavigationContext}){
 const [tab,setTab]=useState<'board'|'drawing'|'sop'>('board'),[selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const index=useQuery<{drawings:any[];sops:any[]}>({queryKey:['engineering-department-index',data.me.id],queryFn:async({signal})=>{const [d,s]=await Promise.all([request('drawing-data',undefined,{signal}),request('sop-data',undefined,{signal})]);return {drawings:d.records||[],sops:s.records||[]};},retry:false});
 // A changed shared revision rechecks this observer without remounting a dirty editor.
 // An authoritative denial or removal below immediately conceals the old selection.
 const lastRevision=useRef(data.revision);
 useEffect(()=>{if(lastRevision.current!==data.revision){lastRevision.current=data.revision;void index.refetch();}},[data.me.id,data.revision]);
 const visible=index.isError?undefined:index.data,drawings=visible?.drawings||[],sops=visible?.sops||[];
 const changed=useCallback((value:boolean)=>{setDirty(value);onDirtyChange?.(value);},[onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 const contextKey=JSON.stringify(initialContext),applied=useRef('');
 useEffect(()=>{
  if(applied.current===contextKey||!visible)return;
  if(dirty){setError('当前工程资料有未保存内容，请先保存或放弃，再定位另一记录。');return;}
  applied.current=contextKey;
  const id=initialContext.recordId;
  if(id){const drawing=drawings.find(r=>r.id===id),sop=sops.find(r=>r.id===id);if(!drawing&&!sop){setSelected('');setTab('board');setError('指定工程资料不存在或当前无权查看；未替换成其他记录。');return;}setSelected(id);setTab(sop?'sop':'drawing');setError('');}
  else if(['drawings','drawing','sop','board'].includes(initialContext.tab||'')){setSelected('');setTab(initialContext.tab==='sop'?'sop':initialContext.tab==='board'?'board':'drawing');setError('');}
 },[contextKey,visible,dirty]);
 const tasks=useMemo<EngineeringTaskCard[]>(()=>[...drawings.map(r=>({id:r.id,kind:'drawing' as const,title:r.modelNo||r.drawingType||'画图需求',customerCode:r.customerCode,category:r.drawingType||'画图需求',status:r.status,assignee:r.assignee||'',deadline:r.deadline||'',summary:r.requirement||r.drawingNotes||'',updatedAt:r.updatedAt,attention:r.status==='历史待核对'})),...sops.map(r=>{const d=drawings.find(d=>d.id===r.drawingRecordId);return {id:r.id,kind:'sop' as const,title:`${r.modelNo||d?.modelNo||'SOP'} · ${r.targetVersion||'版本待确认'}`,customerCode:d?.customerCode||'',category:r.isCurrent===false?'历史版本':r.status,status:r.isCurrent===false?'已替代':r.status,assignee:d?.assignee||'',deadline:'',summary:r.requirement||'',updatedAt:r.updatedAt,attention:r.isCurrent!==false&&r.status!=='已确认'&&r.status!=='已取消'};})],[drawings,sops]);
 const move=(next:typeof tab,id='')=>{if(next===tab&&id===selected)return;if(dirty&&!confirm('当前内容尚未保存，是否放弃并切换？'))return;changed(false);setSelected(id);setTab(next);};
 const selectedAllowed=!selected||(tab==='drawing'?drawings:sops).some(r=>r.id===selected);
 return <div className="space-y-5"><div className="flex gap-2 flex-wrap" role="group" aria-label="工程部门页面"><Button variant={tab==='board'?'default':'outline'} onClick={()=>move('board')}>工程管理看板</Button><Button variant={tab==='drawing'?'default':'outline'} onClick={()=>move('drawing')}>画图跟进表</Button><Button variant={tab==='sop'?'default':'outline'} onClick={()=>move('sop')}>MES 待上传 SOP</Button></div>
 {error&&<p role="alert" className="error notice">{error}</p>}{index.isError&&<p className="error" role="alert">工程权限读取失败，原列表与选定资料已隐藏。<Button variant="outline" onClick={()=>void index.refetch()}>重新读取工程资料</Button></p>}{!index.isError&&!visible&&<p>正在核对当前工程资料权限…</p>}{visible&&!selectedAllowed&&<p className="error" role="alert">选定工程资料已不在当前授权列表，内容已隐藏。</p>}
 {visible&&tab==='board'&&<EngineeringTaskBoard tasks={tasks} onOpen={task=>move(task.kind==='drawing'?'drawing':'sop',task.id)}/>}
 {visible&&selectedAllowed&&tab==='drawing'&&<EngineeringDrawingPanel key={'drawing:'+selected} data={data} initialRecordId={selected} onDirtyChange={changed}/>}
 {visible&&selectedAllowed&&tab==='sop'&&<EngineeringSopPanel key={'sop:'+selected} data={data} initialSopId={selected} onDirtyChange={changed}/>}
 </div>;
}
