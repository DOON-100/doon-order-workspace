'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import type {WorkspaceNavigate,WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import {ProcessWorkspacePanel} from './process-workspace-panel';
import {QuoteRequestPanel} from './quote-request-panel';

/** Keep existing process records available without converting their data or permissions. */
export function RfqWorkspacePanel(props:{data:Data;initialContext?:WorkspaceNavigationContext;onDirtyChange?:(dirty:boolean)=>void;onNavigate?:WorkspaceNavigate}){
 const legacyTarget=!!props.initialContext?.recordId?.startsWith('process_record');
 const [legacy,setLegacy]=useState(legacyTarget),dirty=useRef(false);
 const changed=useCallback((value:boolean)=>{dirty.current=value;props.onDirtyChange?.(value);},[props.onDirtyChange]);
 useEffect(()=>{setLegacy(legacyTarget);},[legacyTarget,props.initialContext?.recordId]);
 const switchTo=(value:boolean)=>{if(value===legacy)return;if(dirty.current&&!window.confirm('当前有未保存的内容，确定放弃并切换吗？'))return;changed(false);setLegacy(value);};
 const context={...props.initialContext,recordId:legacy===legacyTarget?props.initialContext?.recordId:undefined};
 return <><div className="process-actions" style={{marginBottom:16}} aria-label="询价评估工作区"><Button variant={legacy?'outline':'default'} onClick={()=>switchTo(false)}>报价需求表</Button><Button variant={legacy?'default':'outline'} onClick={()=>switchTo(true)}>原询价评估记录</Button></div>{legacy?<ProcessWorkspacePanel {...props} initialContext={context} onDirtyChange={changed}/>:<QuoteRequestPanel {...props} initialContext={context} onDirtyChange={changed}/>}</>;
}
