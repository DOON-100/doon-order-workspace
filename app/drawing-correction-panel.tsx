'use client';
import {useEffect,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {Pencil,Save} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {canCorrectDrawing,type Order} from '@/lib/domain';
import {Field,Input,request,type Act} from './ui';
import type {Data} from './workspace';

export function DrawingCorrectionPanel({order:o,data,act,busy,onSelect,onEditingChange}:{order:Order;data:Data;act:Act;busy:boolean;onSelect:(o:Order)=>void;onEditingChange:(editing:boolean)=>void}){
 const cache=useQueryClient(),[editing,setEditing]=useState(false),[drawing,setDrawing]=useState(o.drawing),[reason,setReason]=useState(''),[error,setError]=useState(''),[running,setRunning]=useState(false),[reloadConfirm,setReloadConfirm]=useState(false);
 const latest=data.orders.find(row=>row.id===o.id),stale=!latest||latest.version!==o.version,allowed=canCorrectDrawing(data.me,o)&&!!latest&&canCorrectDrawing(data.me,latest),waiting=busy||running,changed=drawing.trim()!==o.drawing.trim(),valid=!!drawing.trim()&&drawing.trim().length<=120&&reason.trim().length>=3&&reason.trim().length<=1000;
 useEffect(()=>{onEditingChange(editing);},[editing,onEditingChange]);
 useEffect(()=>()=>onEditingChange(false),[onEditingChange]);
 function cancel(){setEditing(false);setDrawing(o.drawing);setReason('');setError('');setReloadConfirm(false);}
 async function save(){
  if(waiting||!allowed||stale||!changed||!valid)return;setRunning(true);setError('');
  try{const result=await act('drawing-correction',{id:o.id,version:o.version,drawing:drawing.trim(),reason:reason.trim()});setEditing(false);onEditingChange(false);onSelect(result.order);}
  catch(e){setError((e as Error).message);await cache.invalidateQueries({queryKey:['workspace']}).catch(()=>{});}
  finally{setRunning(false);}
 }
 async function reload(){
  if(waiting)return;setRunning(true);setError('');
  try{const next=await request('data') as Data;cache.setQueryData<Data>(['workspace'],next);const row=next.orders.find(item=>item.id===o.id);if(!row)throw new Error('此明细已不在你的授权范围内，未提交任何修改。');setEditing(false);onEditingChange(false);setReloadConfirm(false);onSelect(row);}
  catch(e){setError((e as Error).message);}finally{setRunning(false);}
 }
 if(!o.ledger)return null;
 return <section className="department-form mt-4" aria-label="原表图纸编号更正"><div className="panel-title"><div><h3>图纸编号（原表 J 列）</h3><p className="muted">当前编号：<b>{o.drawing||'未填写'}</b> · 原表第 {o.ledger.sourceRow} 行 · 明细版本 {o.version}</p></div>{allowed&&!editing&&<Button size="sm" variant="outline" disabled={waiting} onClick={()=>{setEditing(true);setError('');}}><Pencil size={14}/>修改图纸编号</Button>}</div>
  {editing&&<><p className="note mt-3">仅修改这一条明细，不修改同订单其他款式或颜色。明细编号不变；原始文件、历史报工、已发附件及修改前记录保留。请核实图纸后填写原因，再确认保存。</p><div className="form-grid mt-4"><Field label="原图纸编号"><Input aria-label="原图纸编号" readOnly value={o.drawing||'未填写'}/></Field><Field label="新图纸编号（必填）"><Input aria-label="新图纸编号" maxLength={120} value={drawing} disabled={waiting} onChange={e=>{setDrawing(e.target.value);setError('');}}/></Field><Field label="修改原因（必填，至少 3 个字）" wide><Textarea aria-label="图纸编号修改原因" maxLength={1000} value={reason} disabled={waiting} onChange={e=>{setReason(e.target.value);setError('');}} placeholder="例如：核对最新工程图，修正录入错误"/></Field></div>
   {stale&&<p className="error mt-3" role="alert">这条明细已发生更新，你的输入已保留，暂不能保存。{latest&&<>最新图纸编号：{latest.drawing||'未填写'}，版本 {latest.version}。</>}请重新核对最新明细，不会自动覆盖其他同事的修改。</p>}{!allowed&&<p className="error mt-3" role="alert">当前权限或订单状态已不允许更正图纸编号，未提交任何修改。</p>}
   {error&&<p className="error mt-3" role="alert">{error}</p>}
   <div className="toolbar"><Button disabled={waiting||!allowed||stale||!changed||!valid} onClick={()=>void save()}><Save size={16}/>{waiting?'正在处理…':'确认保存图纸编号'}</Button><Button variant="outline" disabled={waiting} onClick={cancel}>取消修改</Button>{(stale||!!error)&&<Button variant="outline" disabled={waiting} onClick={()=>setReloadConfirm(true)}>重新核对最新明细</Button>}</div>
   {reloadConfirm&&<div className="note" role="alert"><p>重新读取将放弃上方未保存的新图纸编号和修改原因，改为查看最新明细。是否继续？</p><div className="toolbar"><Button variant="outline" disabled={waiting} onClick={()=>setReloadConfirm(false)}>保留我的输入</Button><Button disabled={waiting} onClick={()=>void reload()}>确认放弃输入并读取最新明细</Button></div></div>}
   <p className="muted">修改期间请先保存或取消本次修改，再切换明细或关闭详情。</p>
  </>}
 </section>;
}
