// Observe failures without consuming responses, navigating, changing form values
// or retrying any Studio/model/business request.
(()=>{
 const original=window.fetch.bind(window);let banner,lastRequest=0,lastShown=0;
 function show(state,sequence){
  if(sequence<lastShown)return;lastShown=sequence;
  if(state==='verified'){banner?.remove();banner=null;return;}
  if(!banner){banner=document.createElement('aside');banner.id='doon-auth-status';banner.setAttribute('role','alert');banner.style.cssText='position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;max-width:min(720px,90vw);padding:14px 18px;background:#fff4db;color:#553600;border:1px solid #bd8620;border-radius:8px;box-shadow:0 4px 20px #0002;font:14px/1.6 system-ui';(document.body||document.documentElement).append(banner);}
  banner.replaceChildren();const text=document.createElement('span');
  text.textContent=state==='expired'?'登录已失效。请先保留当前输入，再重新登录。':state==='forbidden'?'当前账号无权访问此工作台。请保留当前输入并核对账号权限。':'登录状态验证暂时失败或超时，尚未确认登录失效。请保留当前输入，稍后手动重试；提交操作前先核对是否已保存。';
  banner.append(text);
  if(state==='expired'){const link=document.createElement('a');link.href='/login';link.textContent=' 打开登录页';link.target='_blank';link.rel='noopener';banner.append(link);}
  const close=document.createElement('button');close.type='button';close.textContent='关闭提示';close.style.marginLeft='12px';close.addEventListener('click',()=>{banner?.remove();banner=null;});banner.append(close);
 }
 window.fetch=async function(input,init){
  let watched=false;
  try{const url=new URL(typeof input==='string'||input instanceof URL?input:input.url,location.href);watched=url.origin===location.origin&&url.pathname.startsWith('/studio/');}catch{}
  const sequence=++lastRequest,response=await original(input,init);
  // A notification failure must never change the application's fetch result.
  try{if(watched){const state=response.headers.get('X-Doon-Auth-Status');if(['temporary','expired','forbidden','verified'].includes(state))show(state,sequence);}}catch{}
  return response;
 };
})();
