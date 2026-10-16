import {useEffect,useRef,useState} from 'react';
import {Grid,Choice,Field} from '../app/ui';
import {Button} from '../components/ui/button';

type Event={id:string;createdAt:string;username:string;action:string;actor:string;ip:string;source:string;reason:string};
const reasons:Record<string,string>={invalid_credentials:'凭据无效、账号不可用或入口不匹配',invalid_input:'输入格式无效',rate_limited:'登录尝试次数过多'};
export function AuthHistoryPanel({accounts}:{accounts:{username:string}[]}){
 const [username,setUsername]=useState(''),[events,setEvents]=useState<Event[]>([]),[next,setNext]=useState<string|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const sequence=useRef(0);
 async function load(before?:string){
  const request=++sequence.current;setLoading(true);setError('');
  try{
   const query=new URLSearchParams({username,limit:'50',...(before?{before}:{})}),response=await fetch('/api/auth/history?'+query),result=await response.json() as {events:Event[];nextBefore:string|null;error?:string};
   if(!response.ok)throw new Error(result.error||'登录历史读取失败。');
   if(request!==sequence.current)return;
   setEvents(prior=>before?[...prior,...result.events]:result.events);setNext(result.nextBefore);
  }catch(e){if(request===sequence.current)setError((e as Error).message);}finally{if(request===sequence.current)setLoading(false);}
 }
 useEffect(()=>{setEvents([]);setNext(null);load();return()=>{sequence.current++;};},[username]);
 return <section className="panel section-pad" aria-label="账号登录历史"><h2 className="section-title">账号登录历史</h2><p className="subtitle">记录功能上线后的登录成功、登录失败及主动退出。登录成功仍可能需要首次改密；未认证的尝试不代表账号本人操作。</p><div className="toolbar"><Field label="筛选登录账号"><Choice label="筛选登录账号" value={username} onChange={setUsername} options={[{value:'',label:'全部账号（含未知账号尝试）'},...accounts.map(a=>({value:a.username,label:a.username}))]}/></Field><Button variant="outline" disabled={loading} onClick={()=>load()}>刷新登录历史</Button></div>{error&&<p role="alert" className="error">{error}</p>}<p role="status" className="note">{loading?'正在读取登录历史…':`已显示 ${events.length} 条记录`}</p><Grid headers={['北京时间','登录账号','事件','身份','来源 IP','入口','失败说明']} rows={events.map(e=>[new Date(e.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}),e.username||'未提供有效账号',e.action,e.actor||'—',e.ip||'—',e.source,reasons[e.reason]||'—'])}/>{!loading&&!error&&!events.length&&<p className="note">当前范围暂无登录记录。</p>}{next&&<Button variant="outline" disabled={loading} onClick={()=>load(next)}>加载更早登录记录</Button>}<p className="note mt-4">仅管理员可查看。不保存密码、Cookie 或会话令牌；浏览器关闭、会话到期和强制失效不等同于主动退出。</p></section>;
}
