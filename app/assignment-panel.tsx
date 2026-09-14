'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Choice,Field,request,type Act} from './ui';
import type {Data} from './workspace';
export function AssignmentPanel({data,act}:{data:Data;act:Act}){const [name,setName]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');if(!['admin','pmc'].includes(data.me.role))return null;
 async function save(){setBusy(true);setMessage('');let total=0;try{let count;do{const r=await request('ledger-assign',{ownerName:name,email});count=r.count;total+=count;}while(count===30);await act('enroll',{});setMessage(`已绑定 ${total} 条在制明细。`);}catch(e){setMessage((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel section-pad"><h2 className="section-title">把原表跟单员绑定到登录账号</h2><p className="subtitle">保留原表跟单员姓名，将负责的在制明细归入该账号的“我的订单”。部门工序权限在成员设置中单独分配。</p><div className="toolbar"><Field label="原表跟单员"><Choice label="原表跟单员绑定" value={name} onChange={setName} options={[{value:'',label:'选择跟单员'},...[...new Set(data.orders.map(o=>o.ledger?.ownerName).filter(Boolean) as string[])].map(v=>({value:v,label:v}))]}/></Field><Field label="登录账号"><Choice label="绑定登录账号" value={email} onChange={setEmail} options={[{value:'',label:'选择已添加成员'},...data.members.filter(m=>m.active).map(m=>({value:m.email,label:m.name+' · '+m.email}))]}/></Field><Button disabled={busy||!name||!email} onClick={save}>{busy?'正在绑定…':'绑定跟单订单'}</Button></div>{message&&<p role="status" className="note">{message}</p>}</section>;
}
