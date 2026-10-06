'use client';
import {useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Choice,Field,request,type Act} from './ui';
import {active} from '@/lib/ledger';
import type {Data} from './workspace';
export function AssignmentPanel({data,act}:{data:Data;act:Act}){
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 if(!['admin','pmc'].includes(data.me.role))return null;
 const matching=data.orders.filter(o=>active(o)&&o.ledger?.ownerName===name),bound=matching.filter(o=>o.ownerEmail===email).length,pending=matching.length-bound,transfers=matching.filter(o=>o.ownerEmail&&o.ownerEmail!==email).length;
 const account=data.members.find(m=>m.email===email),complete=!!name&&!!email&&matching.length>0&&pending===0;
 async function save(){
  setBusy(true);setMessage('');setError('');let updated=0;
  try{let result;do{result=await request('ledger-assign',{ownerName:name,email});updated+=result.count;setMessage(`本次已处理 ${updated} 条，正在核对绑定状态…`);}while(result.remaining>0);
   await act('enroll',{});
   setMessage(result.total===0?`${name} 当前没有可绑定的在制明细。`:updated?`本次绑定 ${updated} 条；${name} 的 ${result.bound} 条在制明细现已归入 ${email}。`:`${name} 的 ${result.bound} 条在制明细已全部绑定到 ${email}，无需重复绑定。`);
  }catch(e){setError(`${updated?`本次已有 ${updated} 条绑定成功。`:''}${(e as Error).message}`);setMessage('');}finally{setBusy(false);}
 }
 return <section className="panel section-pad"><h2 className="section-title">把原表跟单员绑定到登录账号</h2><p className="subtitle">保留原表跟单员姓名，将负责的在制明细归入该账号的“我的订单”。部门工序权限在成员设置中单独分配。</p>
  <div className="toolbar"><Field label="原表跟单员"><Choice label="原表跟单员绑定" value={name} disabled={busy} onChange={v=>{setName(v);setMessage('');setError('');}} options={[{value:'',label:'选择跟单员'},...[...new Set(data.orders.filter(active).map(o=>o.ledger?.ownerName).filter(Boolean) as string[])].map(v=>({value:v,label:v}))]}/></Field><Field label="登录账号"><Choice label="绑定登录账号" value={email} disabled={busy} onChange={v=>{setEmail(v);setMessage('');setError('');}} options={[{value:'',label:'选择已添加成员'},...data.members.filter(m=>m.active).map(m=>({value:m.email,label:m.name+' · '+m.email}))]}/></Field><Button disabled={busy||!name||!email||pending===0} onClick={save}>{busy?'正在绑定…':complete?'已全部绑定':pending>0&&email?`绑定 ${pending} 条明细`:'绑定跟单订单'}</Button></div>
  {name&&email&&<><div className="stat-strip" aria-label="跟单绑定统计"><span>原表在制明细 <b>{matching.length.toLocaleString()}</b></span><span>已绑定该账号 <b>{bound.toLocaleString()}</b></span><span>待绑定 / 调整 <b>{pending.toLocaleString()}</b></span></div>{complete?<p role="status" className="success flex items-center gap-2"><CheckCircle2 size={18}/>{name} 的 {bound.toLocaleString()} 条在制明细已全部绑定到 {account?.name||email}（{email}），无需重复操作。该员工登录后可在“我的订单”查看。</p>:matching.length===0?<p className="note">当前没有此跟单员的在制明细，已完成订单请到档案页查询。</p>:<p className="note">确认后将 {pending.toLocaleString()} 条明细归入 {account?.name||email} 的“我的订单”。{transfers>0&&`其中 ${transfers.toLocaleString()} 条目前属于其他账号，将调整负责人。`}</p>}</>}
  {message&&<p role="status" className="note mt-4">{message}</p>}{error&&<p role="alert" className="error mt-4">{error}</p>}
 </section>;
}
