'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input,Field,Choice,type Act} from './ui';
import type {Data} from './workspace';

export function SupplierAccounts({data,act}:{data:Data;act:Act}){
 const [form,setForm]=useState({username:'',name:'',password:'',supplierId:''}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 if(data.me.role!=='admin')return null;
 const suppliers=(data.suppliers||[]).filter(v=>v.active!==false);
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{
  const response=await fetch('/api/auth/accounts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...form,role:'supplier'})});
  const result=await response.json() as {error?:string};if(!response.ok)throw new Error(result.error||'供应商账号未创建。');
  setMessage(`已创建 ${form.username}，请将初始密码单独交给本人。首次登录必须修改密码。`);setForm({...form,username:'',name:'',password:''});await act('enroll',{});
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="panel section-pad"><h2 className="section-title">创建供应商填报账号</h2><p className="subtitle">每人独立账号，绑定一家供应商，只访问公司发布给该供应商的成品外发任务。</p>
 {!suppliers.length&&<p className="note">请先到“供应商收货 → 供应商资料”建立供应商档案。</p>}
 {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="success">{message}</p>}
 <form className="form-grid mt-4" onSubmit={save}>
  <Field label="所属供应商"><Choice label="供应商账号所属供应商" value={form.supplierId} onChange={v=>setForm({...form,supplierId:v})} options={[{value:'',label:'请选择有效供应商'},...suppliers.map(v=>({value:v.id,label:v.name}))]}/></Field>
  <Field label="登录账号"><Input aria-label="供应商登录账号" required autoComplete="off" placeholder="例如 jinbo_report" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></Field>
  <Field label="填报人姓名"><Input aria-label="供应商填报人姓名" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></Field>
  <Field label="初始密码（至少12位）"><Input aria-label="供应商初始密码" required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></Field>
  <Button disabled={busy||!form.supplierId} type="submit">{busy?'正在创建…':'创建供应商账号'}</Button>
 </form><p className="note mt-4">手机入口：<a className="text-link" href="/supplier-portal">供应商填报工作台</a>。账号停用和密码重置可在本页下方办理；供应商归属保持固定。</p></section>;
}
