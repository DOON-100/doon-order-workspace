'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {EngineeringDrawingPanel,type DrawingData} from './engineering-drawing-panel';
import {EngineeringSopPanel,type SopData} from './engineering-sop-panel';
import {EngineeringTaskBoard,type EngineeringTaskCard} from './engineering-task-board';
import {engineeringDataQuery} from './engineering-data-query';
import type {Data} from './workspace';
import type {WorkspaceNavigationContext} from '@/lib/handoff-navigation';

export function EngineeringDepartmentPanel({data,onDirtyChange,initialContext={}}:{data:Data;onDirtyChange?:(dirty:boolean)=>void;initialContext?:WorkspaceNavigationContext}){
 const [tab,setTab]=useState<'board'|'drawing'|'sop'>('board'),[selected,setSelected]=useState(''),[dirty,setDirty]=useState(false),[error,setError]=useState('');
 const drawingQuery=useQuery(engineeringDataQuery<DrawingData>(data.me.id,'drawing-data'));
 const sopQuery=useQuery(engineeringDataQuery<SopData>(data.me.id,'sop-data'));
 const refetch=()=>Promise.all([drawingQuery.refetch(),sopQuery.refetch()]);
 // Recheck authorization without remounting a dirty editor. Each tab only waits
 // for the feeds it uses; a slow SOP read must not block the drawing table.
 const lastRevision=useRef(data.revision);
 useEffect(()=>{if(lastRevision.current!==data.revision){lastRevision.current=data.revision;void refetch();}},[data.me.id,data.revision]);
 const drawingData=drawingQuery.isError?undefined:drawingQuery.data,sopData=sopQuery.isError?undefined:sopQuery.data;
 const drawings=drawingData?.records||[],sops=sopData?.records||[],visible=!!drawingData&&!!sopData;
 const failed=drawingQuery.isError||sopQuery.isError,ready=tab==='drawing'?!!drawingData:visible;
 const changed=useCallback((value:boolean)=>{setDirty(value);onDirtyChange?.(value);},[onDirtyChange]);
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange]);
 const contextKey=JSON.stringify(initialContext),applied=useRef('');
 useEffect(()=>{
  if(applied.current===contextKey)return;
  if(dirty){setError('当前工程资料有未保存内容，请先保存或放弃，再定位另一记录。');return;}
  const id=initialContext.recordId;
  if(id&&!visible&&!drawings.some(r=>r.id===id))return;
  applied.current=contextKey;
  if(id){const drawing=drawings.find(r=>r.id===id),sop=sops.find(r=>r.id===id);if(!drawing&&!sop){setSelected('');setTab('board');setError('指定工程资料不存在或当前无权查看；未替换成其他记录。');return;}setSelected(id);setTab(sop?'sop':'drawing');setError('');}
  else if(['drawings','drawing','sop','board'].includes(initialContext.tab||'')){setSelected('');setTab(initialContext.tab==='sop'?'sop':initialContext.tab==='board'?'board':'drawing');setError('');}
 },[contextKey,drawingData,sopData,dirty]);
 const tasks=useMemo<EngineeringTaskCard[]>(()=>{const byId=new Map(drawings.map(d=>[d.id,d]));return [...drawings.map(r=>({id:r.id,kind:'drawing' as const,title:r.modelNo||r.drawingType||'画图需求',customerCode:r.customerCode,category:r.drawingType||'画图需求',status:r.status,assignee:r.assignee||'',deadline:r.deadline||'',summary:r.requirement||r.drawingNotes||'',updatedAt:r.updatedAt,attention:r.status==='历史待核对'||(r.sheetStatus||r.source?.rawColumns?.['状态'])==='❗❗'})),...sops.map(r=>{const d=byId.get(r.drawingRecordId);return {id:r.id,kind:'sop' as const,title:`${r.modelNo||d?.modelNo||'SOP'} · ${r.targetVersion||'版本待确认'}`,customerCode:d?.customerCode||'',category:r.isCurrent===false?'历史版本':r.status,status:r.isCurrent===false?'已替代':r.status,assignee:d?.assignee||'',deadline:'',summary:r.requirement||'',updatedAt:r.updatedAt,attention:r.isCurrent!==false&&r.status!=='已确认'&&r.status!=='已取消'};})];},[drawings,sops]);
 const move=(next:typeof tab,id='')=>{if(next===tab&&id===selected)return;if(dirty&&tab==='drawing'){setError('当前画图内容尚未保存，请等待保存完成或处理错误后再切换。');return;}if(dirty&&!confirm('当前内容尚未保存，是否放弃并切换？'))return;setError('');changed(false);setSelected(id);setTab(next);};
 const selectedAllowed=!selected||(tab==='drawing'?drawings:sops).some(r=>r.id===selected);
 return <div className="space-y-5"><div className="flex gap-2 flex-wrap" role="group" aria-label="工程部门页面"><Button variant={tab==='board'?'default':'outline'} onClick={()=>move('board')}>工程管理看板</Button><Button variant={tab==='drawing'?'default':'outline'} onClick={()=>move('drawing')}>画图跟进表</Button><Button variant={tab==='sop'?'default':'outline'} onClick={()=>move('sop')}>MES 待上传 SOP</Button></div>
 {error&&<p role="alert" className="error notice">{error}</p>}{failed&&<p className="error" role="alert">工程资料读取失败，对应列表与选定资料已隐藏。<Button variant="outline" onClick={()=>void refetch()}>重新读取工程资料</Button></p>}{!failed&&!ready&&<p>正在核对当前工程资料权限…</p>}{ready&&!selectedAllowed&&<p className="error" role="alert">选定工程资料已不在当前授权列表，内容已隐藏。</p>}
 {visible&&tab==='board'&&<EngineeringTaskBoard tasks={tasks} onOpen={task=>move(task.kind==='drawing'?'drawing':'sop',task.id)}/>}
 {drawingData&&selectedAllowed&&tab==='drawing'&&<EngineeringDrawingPanel key={'drawing:'+selected} data={data} initialRecordId={selected} initialData={drawingData} onDirtyChange={changed}/>}
 {visible&&selectedAllowed&&tab==='sop'&&<EngineeringSopPanel key={'sop:'+selected} data={data} initialSopId={selected} initialData={sopData} initialDrawings={drawings} onDirtyChange={changed}/>}
 </div>;
}
