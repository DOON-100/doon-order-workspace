'use client';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {Table,TableHeader,TableBody,TableRow,TableHead,TableCell} from '@/components/ui/table';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ClipboardList} from 'lucide-react';
export {Input,Label};
export type Act=(action:string,body:any)=>Promise<any>;
export function Choice({label,value,onChange,options,disabled=false}:{label:string;value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];disabled?:boolean}){return <Select value={value||'__empty'} onValueChange={v=>onChange(v==='__empty'?'':v)} disabled={disabled}><SelectTrigger aria-label={label} className="w-full min-w-32"><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value||'__empty'} value={o.value||'__empty'}>{o.label}</SelectItem>)}</SelectContent></Select>;}
export function Field({label,children,wide=false}:{label:string;children:React.ReactNode;wide?:boolean}){return <div className={'field'+(wide?' wide':'')}><Label>{label}</Label>{children}</div>;}
export function Empty({title='暂无数据',detail='导入工作表后，数据将在这里汇总。',children}:{title?:string;detail?:string;children?:React.ReactNode}){return <div className="empty"><span className="empty-icon"><ClipboardList size={29}/></span><h3>{title}</h3><p>{detail}</p>{children}</div>;}
export function Grid({headers,rows}:{headers:string[];rows:React.ReactNode[][]}){return <Table><TableHeader><TableRow>{headers.map((h,i)=><TableHead key={i}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.length?rows.map((r,i)=><TableRow key={i}>{r.map((v,j)=><TableCell key={j}>{v??'—'}</TableCell>)}</TableRow>):<TableRow><TableCell colSpan={headers.length}><Empty/></TableCell></TableRow>}</TableBody></Table>;}
export async function request(action:string,body?:unknown):Promise<any>{const response=await fetch('/api/workspace/'+action,{method:body===undefined?'GET':'POST',headers:body instanceof FormData?undefined:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});const result:any=await response.json();if(!response.ok)throw new Error(result.error||'操作未完成');return result;}
export function dateTime(value:string){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';}
