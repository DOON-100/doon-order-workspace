/** Per-browser, in-memory scheduling. Never caches writes, files or failed reads. */
type ReadJob={key:string;page:string;background:boolean;controller:AbortController;run:(signal:AbortSignal)=>Promise<Response>;resolve:(value:Response)=>void;reject:(reason:unknown)=>void;detach:()=>void;generation:number};
type WarmRead={response:Response;expires:number;bytes:number};
const cancelled=()=>new DOMException('请求已取消。','AbortError');

export class WorkspaceReadQueue{
 private waiting:ReadJob[]=[];
 private active=new Set<ReadJob>();
 private warm=new Map<string,WarmRead>();
 private timer:ReturnType<typeof setTimeout>|undefined;
 private lastForeground=0;
 private generation=0;
 private page='';
 private scope='';
 constructor(private quietMs=3000,private now=()=>Date.now(),private visible=()=>typeof document==='undefined'||document.visibilityState!=='hidden'){}
 setScope(scope:string){if(scope!==this.scope){this.scope=scope;this.clear();}}
 setPage(page:string){
  if(page===this.page)return;
  this.page=page;this.lastForeground=this.now();
  for(const job of [...this.waiting,...this.active])if(job.page!==page&&!['data','business-team-data'].some(action=>job.key.endsWith(':'+action)))job.controller.abort();
 }
 clear(){
  this.generation++;this.warm.clear();
  for(const job of [...this.waiting,...this.active])job.controller.abort();
 }
 invalidate(){this.generation++;this.warm.clear();for(const job of [...this.waiting,...this.active])if(job.background)job.controller.abort();}
 read(key:string,run:ReadJob['run'],options:{signal?:AbortSignal;background?:boolean;validate?:(saved:Response,signal:AbortSignal)=>Promise<boolean>}={}):Promise<Response>{
  if(options.signal?.aborted)return Promise.reject(cancelled());
  const background=!!options.background;
  if(!background){
   this.lastForeground=this.now();
   for(const job of [...this.waiting,...this.active])if(job.background)job.controller.abort();
   const saved=this.warm.get(key);this.warm.delete(key);
   if(saved&&saved.expires>this.now()){
    const original=run,generation=this.generation;
    run=async signal=>{
     const valid=options.validate?await options.validate(saved.response,signal):true;
     if(signal.aborted)throw cancelled();
     return valid&&generation===this.generation?saved.response:original(signal);
    };
   }
  }
  return new Promise((resolve,reject)=>{
   const controller=new AbortController(),job:ReadJob={key,page:this.page,background,controller,run,resolve,reject,detach:()=>{},generation:this.generation};
   const abort=()=>controller.abort();
   options.signal?.addEventListener('abort',abort,{once:true});
   job.detach=()=>options.signal?.removeEventListener('abort',abort);
   controller.signal.addEventListener('abort',()=>{
    const at=this.waiting.indexOf(job);if(at>=0){this.waiting.splice(at,1);job.detach();reject(cancelled());this.pump();}
   },{once:true});
   this.waiting.push(job);this.pump();
  });
 }
 private pump(){
  clearTimeout(this.timer);
  const foreground=this.waiting.filter(job=>!job.background);
  if(foreground.length){
   while(this.active.size<2){const next=this.waiting.find(job=>!job.background);if(!next)break;this.start(next);}
   return;
  }
  if(this.active.size||!this.waiting.length)return;
  const delay=Math.max(0,this.quietMs-(this.now()-this.lastForeground));
  if(delay||!this.visible()){this.timer=setTimeout(()=>this.pump(),Math.max(delay,1000));return;}
  this.start(this.waiting[0]);
 }
 private start(job:ReadJob){
  this.waiting.splice(this.waiting.indexOf(job),1);this.active.add(job);
  void (async()=>{
   try{
    const response=await job.run(job.controller.signal);
    // Keep the slot until the JSON body arrives, not just its response headers.
    const json=(response.headers.get('Content-Type')||'').includes('application/json');
    const bytes=json?await response.arrayBuffer():null;
    if(job.controller.signal.aborted)throw cancelled();
    const result=bytes?new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers}):response;
    if(job.background&&result.ok&&bytes&&bytes.byteLength<=750_000&&job.generation===this.generation){
     for(const [key,value] of this.warm)if(value.expires<=this.now())this.warm.delete(key);
     while(this.warm.size>=16||[...this.warm.values()].reduce((n,v)=>n+v.bytes,0)+bytes.byteLength>4_000_000)this.warm.delete(this.warm.keys().next().value!);
     this.warm.set(job.key,{response:result.clone(),expires:this.now()+300_000,bytes:bytes.byteLength});
    }
    job.resolve(result);
   }catch(error){job.reject(error);}
   finally{job.detach();this.active.delete(job);if(job.background)this.lastForeground=this.now();this.pump();}
  })();
 }
}

export const workspaceReadQueue=new WorkspaceReadQueue();
let revision:number|undefined;
export function setWorkspaceReadRevision(next:number){if(revision!==undefined&&revision!==next)workspaceReadQueue.invalidate();revision=next;}

export function workspaceFetch(input:RequestInfo|URL,init?:RequestInit,options?:{background?:boolean;unscoped?:boolean}):Promise<Response>{
 if(typeof window==='undefined')return fetch(input,init);
 const original=input instanceof Request?input:undefined;
 const method=(init?.method||original?.method||'GET').toUpperCase();
 let url:URL;try{url=new URL(original?.url||String(input),window.location.href);}catch{return fetch(input,init);}
 if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/workspace/'))return fetch(input,init);
 if(method!=='GET'){workspaceReadQueue.invalidate();return fetch(input,init);}
 const action=url.pathname.slice('/api/workspace/'.length)+url.search;
 if(/(?:file|download|export|template)(?:\?|$)/.test(action))return fetch(input,init);
 const headers=new Headers(init?.headers??original?.headers),key=(options?.unscoped?'unscoped:':headers.get('X-Workspace-Team')||'')+':'+action;
 return workspaceReadQueue.read(key,signal=>fetch(input,{...init,signal}),{signal:init?.signal||original?.signal,background:options?.background,validate:async(saved,signal)=>{
  const expected=saved.headers.get('X-Workspace-Revision');if(!expected)return false;
  const latest=await fetch('/api/workspace/read-version',{signal,credentials:init?.credentials||original?.credentials||'same-origin',cache:'no-store'});
  if(!latest.ok)return false;
  const value=await latest.json() as {revision:number};return String(value.revision)===expected;
 }});
}
