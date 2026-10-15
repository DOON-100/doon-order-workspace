import {useRef,useState} from 'react';
import {Input,Field} from '../app/ui';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';

export type ResetAccount={id:string;username:string;name:string};

export function ResetPasswordDialog({account,onReset,onClose,onComplete}:{account:ResetAccount;onReset:(id:string,password:string)=>Promise<unknown>;onClose:()=>void;onComplete:()=>void}){
 const [password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const submitting=useRef(false);
 const mismatch=confirmation.length>0&&password!==confirmation;
 async function submit(e:React.FormEvent){
  e.preventDefault();
  if(submitting.current)return;
  if(password!==confirmation){setError('两次输入的密码不一致，请重新确认。');return;}
  submitting.current=true;setSaving(true);setError('');
  try{await onReset(account.id,password);onComplete();}
  catch(e){setError((e as Error).message);}
  finally{submitting.current=false;setSaving(false);}
 }
 return <Dialog open onOpenChange={open=>{if(!open&&!submitting.current)onClose();}}>
  <DialogContent showCloseButton={!saving}>
   <DialogHeader><DialogTitle>重置成员密码</DialogTitle><DialogDescription>正在为 {account.name}（{account.username}）设置新的初始密码。重置后该成员原登录将退出，下次登录需修改初始密码。</DialogDescription></DialogHeader>
   <form className="space-y-4" onSubmit={submit}>
    <Field label="新的初始密码（至少12位）"><Input autoFocus required type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-label="新的初始密码" disabled={saving} value={password} onChange={e=>{setPassword(e.target.value);setError('');}}/></Field>
    <Field label="再次输入初始密码"><Input required type="password" minLength={12} maxLength={128} autoComplete="new-password" aria-label="再次输入初始密码" aria-invalid={mismatch} aria-describedby={mismatch?'reset-password-mismatch':undefined} disabled={saving} value={confirmation} onChange={e=>{setConfirmation(e.target.value);setError('');}}/></Field>
    {mismatch&&<p id="reset-password-mismatch" role="alert" className="error">两次输入的密码不一致，请重新确认。</p>}
    {error&&!mismatch&&<p role="alert" className="error">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={saving} onClick={onClose}>取消</Button><Button type="submit" disabled={saving||!password||!confirmation||mismatch}>{saving?'正在重置…':'确认重置'}</Button></DialogFooter>
   </form>
  </DialogContent>
 </Dialog>;
}
