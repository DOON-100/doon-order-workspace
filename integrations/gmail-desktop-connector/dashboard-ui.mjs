// Served by the existing Chatwoot gateway after middle-platform authentication.
export const gmailUi='('+function(){
 let panel,timer,busy=false,lastPath='';
 const credentials=()=>{try{const raw=document.cookie.split('; ').find(v=>v.startsWith('cw_d_session_info='));return raw?JSON.parse(decodeURIComponent(raw.split('=').slice(1).join('='))):null;}catch{return null;}};
 const element=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
 async function request(path,body){
  const auth=credentials();if(!auth)throw Error('请从邮箱页面重新进入 Chatwoot。');
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{...auth,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error('同步状态暂时不可用，请稍后重试。');
  return (response.headers.get('content-type')||'').includes('json')?response.json():null;
 }
 async function refresh(){
  if(busy||document.hidden)return;busy=true;
  try{
   const account=location.pathname.match(/\/accounts\/(\d+)/)?.[1];if(!account){panel?.remove();panel=null;return;}
   const conversation=location.pathname.match(/\/conversations\/(\d+)/)?.[1];
   const data=await request(`/api/v1/accounts/${account}/doon_gmail/status`+(conversation?'?conversation='+conversation:''));
   if(!data.enabled){panel?.remove();panel=null;return;}
   if(!panel){panel=element('aside','');panel.setAttribute('aria-label','Gmail 本机同步状态');panel.style.cssText='position:fixed;bottom:14px;right:18px;z-index:45;max-width:520px;border:1px solid #cad5e2;border-radius:8px;padding:10px 14px;background:#fff;color:#26364d;box-shadow:0 2px 12px #0002;font:13px/1.5 sans-serif';document.body.append(panel);}
   panel.replaceChildren(element('strong',data.online?'Gmail 本机连接器：在线':'Gmail 本机连接器：离线，等待电脑重连'));
   panel.append(element('div','实际收发邮箱：'+data.email));
   if(!data.synced_at)panel.append(element('div','首次同步尚未完成；历史范围：最近 30 天。'));
   if(data.conversation){
    panel.append(element('div',`Gmail 状态：${data.unread?'未读':'已读'} · ${data.archived?'已归档':'在收件箱'}${data.pending?' · '+data.pending+' 项操作待完成':''}`));
    if(data.uncertain)panel.append(element('div','有邮件的发送结果待核查；连接器正在查询“已发送”，不会自动重复发送。'));
    if(data.attachment_notes)panel.append(element('div','部分邮件附件较多，完整原件和全部附件保留在 original.eml 中。'));
    if(data.owner){
     const actions=element('div','');actions.style.cssText='display:flex;gap:8px;margin-top:5px';
     for(const [text,action,body] of [
      ['标为已读','update_last_seen',{}],['标为未读','unread',{}],
      [data.archived?'移回收件箱':'归档','toggle_status',{status:data.archived?'open':'resolved'}]
     ]){
      const button=element('button',text);button.type='button';button.style.cssText='border:1px solid #cbd5e1;border-radius:4px;padding:3px 8px;color:#175ddc;background:#fff;cursor:pointer';
      button.onclick=async()=>{button.disabled=true;try{await request(`/api/v1/accounts/${account}/conversations/${data.conversation}/${action}`,body);panel.append(element('div','操作已排队，电脑在线时同步到 Gmail。'));}catch(e){panel.append(element('div',e.message));}finally{button.disabled=false;}};
      actions.append(button);
     }
     panel.append(actions);
    }
   }
  }catch{if(panel){panel.replaceChildren(element('div','Gmail 状态暂时不可用；未修改邮件。'));}}
  finally{busy=false;lastPath=location.pathname;}
 }
 timer=setInterval(refresh,10000);setInterval(()=>{if(location.pathname!==lastPath)refresh();},1000);
 window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});refresh();
}.toString()+')();';
