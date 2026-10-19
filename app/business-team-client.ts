'use client';
import {workspaceFetch} from './workspace-read-queue';

// This is a browser display scope. Every API keeps its existing authorization.
let selectedBusinessTeam='';

export function setBusinessTeamScope(teamId:string){
 if(typeof window!=='undefined')selectedBusinessTeam=teamId.trim();
}

export function getBusinessTeamScope(){
 return typeof window==='undefined'?'':selectedBusinessTeam;
}

export function businessTeamFetch(input:RequestInfo|URL,init?:RequestInit,options?:{background?:boolean}):Promise<Response>{
 const teamId=getBusinessTeamScope();
 if(!teamId||typeof window==='undefined')return workspaceFetch(input,init,options);
 const request=input instanceof Request?input:undefined;
 if((init?.method||request?.method||'GET').toUpperCase()!=='GET')return workspaceFetch(input,init,options);
 let url:URL;
 try{url=new URL(request?.url||String(input),window.location.href);}catch{return fetch(input,init);}
 if(url.origin!==window.location.origin||!url.pathname.startsWith('/api/workspace/'))return fetch(input,init);
 const headers=new Headers(init?.headers??request?.headers);
 headers.set('X-Workspace-Team',teamId);
 return workspaceFetch(input,{...init,headers},options);
}

/** Downloads use the same request scope as list reads; ordinary links cannot carry it. */
export async function downloadBusinessTeamFile(url:string,fallbackName:string){
 const response=await businessTeamFetch(url,{cache:'no-store'});
 if(!response.ok){
  const result=await response.json().catch(()=>null) as {error?:string}|null;
  throw new Error(result?.error||'导出失败，请刷新当前范围后重试。');
 }
 const objectUrl=URL.createObjectURL(await response.blob()),anchor=document.createElement('a');
 let filename=fallbackName;
 const encoded=response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
 const plain=response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/i)?.[1];
 try{filename=encoded?decodeURIComponent(encoded):plain||fallbackName;}catch{/* Keep a usable fallback name. */}
 anchor.href=objectUrl;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);
}
