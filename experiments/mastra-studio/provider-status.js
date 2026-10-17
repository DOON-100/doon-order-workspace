const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const card=element('button',undefined,'ds-card');card.type='button';card.setAttribute('aria-label','DeepSeek 模型、余额和状态');card.setAttribute('aria-haspopup','dialog');
const dialog=element('dialog',undefined,'ds-dialog');dialog.setAttribute('aria-label','DeepSeek 接入详情');document.body.append(dialog);
let current=null,loading=false;
const money=balance=>balance?.infos.length?balance.infos.map(row=>`${row.currency==='CNY'?'¥':'$'}${row.total}`).join(' / '):'—';
const time=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚未查询';
function state(){
 if(!current)return{label:'正在查询',tone:'pending'};
 if(current.sessionExpired)return{label:'登录已失效',tone:'error'};
 if(current.status==='unconfigured')return{label:'未配置 API Key',tone:'pending'};
 const error=current.error||current.lastModelCall?.error;
 if(error)return{label:`${error.httpStatus?`HTTP ${error.httpStatus} · `:''}${error.title}`,tone:'error'};
 return current.balance?.available?{label:'余额接口正常',tone:'ok'}:{label:'余额不可用',tone:'error'};
}
function link(label,href){const node=element('a',label);node.href=href;node.target='_blank';node.rel='noreferrer noopener';return node;}
function render(){
 const status=state();card.dataset.tone=status.tone;card.replaceChildren();
 const title=element('span',undefined,'ds-title'),logo=element('img');logo.src='/studio/deepseek.svg';logo.alt='DeepSeek';logo.width=27;logo.height=22;
 title.append(logo,element('strong','DeepSeek'));card.append(title);
 card.append(element('span',current?.model?.live?`${current.model.provider==='DeepSeek'?'':current.model.provider+' / '}${current.model.id}`:'当前：合成脚本（DeepSeek 待启用）','ds-model'));
 card.append(element('span',`余额 ${money(current?.balance)}`,'ds-money'));
 card.append(element('span',`● ${status.label}`,'ds-state'));card.title=`DeepSeek · ${current?.model?.id||'查询中'} · 余额 ${money(current?.balance)} · ${status.label}`;
 if(dialog.open)renderDetails();
}
function renderDetails(){
 const focused=dialog.contains(document.activeElement)?document.activeElement:null,action=focused?.dataset.dsAction,href=focused?.tagName==='A'?focused.href:null;
 dialog.replaceChildren();
 const header=element('div',undefined,'ds-dialog-header'),close=element('button','关闭','ds-close');close.type='button';close.addEventListener('click',()=>dialog.close());
 close.dataset.dsAction='close';
 header.append(element('h2','DeepSeek 接入详情'),close);dialog.append(header);
 dialog.append(element('p',`当前模型：${current?.model?.provider||'—'} / ${current?.model?.id||'—'}`));
 dialog.append(element('p',`状态：${state().label}`));
 dialog.append(element('p',`余额查询时间：${time(current?.checkedAt)}${current?.cached?'（缓存）':''}`,'ds-muted'));
 if(current?.balance){
  for(const row of current.balance.infos){
   const block=element('div',undefined,'ds-balance');block.append(element('strong',`${row.currency} 可用余额 ${row.total}`),element('span',`充值余额 ${row.toppedUp} · 赠金余额 ${row.granted}`));dialog.append(block);
  }
  dialog.append(element('p','此余额属于 API Key 对应的 DeepSeek 账户；不同币种分别展示。','ds-muted'));
 }
 if(current?.status==='unconfigured')dialog.append(element('p','在服务端配置 DEEPSEEK_API_KEY 或 DEEPSEEK_API_KEY_FILE。页面不会接收或展示密钥。'));
 for(const [name,error] of [['余额接口',current?.error],['最近模型请求',current?.lastModelCall?.error]])if(error){
  const block=element('section',undefined,'ds-error');block.append(element('h3',`${name}：${error.httpStatus?`HTTP ${error.httpStatus} · `:''}${error.title}`));
  if(error.providerCode)block.append(element('p',`API error.code：${error.providerCode}`));if(error.providerType)block.append(element('p',`API error.type：${error.providerType}`));
  block.append(element('p',`原因：${error.cause}`),element('p',`处理建议：${error.action}`));
  if(!error.documented)block.append(element('p','此项为本系统诊断或未归类状态，未冒充官方错误码。','ds-muted'));
  if(name==='最近模型请求')block.append(element('p',`发生时间：${time(current.lastModelCall.checkedAt)}`,'ds-muted'));
  block.append(link('DeepSeek 官方错误码说明','https://api-docs.deepseek.com/zh-cn/quick_start/error_codes/'));dialog.append(block);
 }
 if(current?.lastModelCall?.ok)dialog.append(element('p',`最近模型 HTTP 请求成功：${time(current.lastModelCall.checkedAt)}。最终生成结果请查看对应运行轨迹。`,'ds-muted'));
 else if(current?.model?.live&&!current?.lastModelCall)dialog.append(element('p','已配置 DeepSeek 模型；尚无本进程的模型请求结果。余额查询成功不等于模型调用已验证。','ds-muted'));
 const footer=element('div',undefined,'ds-actions'),refresh=element('button',loading?'刷新中…':'刷新余额','ds-refresh');refresh.type='button';refresh.disabled=loading;refresh.addEventListener('click',()=>load(true));
 refresh.dataset.dsAction='refresh';
 footer.append(refresh,link('余额接口文档','https://api-docs.deepseek.com/zh-cn/api/get-user-balance/'));dialog.append(footer);
 dialog.append(element('p','余额正常结果缓存 60 秒，失败缓存 30 秒；手动刷新最短间隔 10 秒。仅查询余额不会发起模型生成。','ds-muted'));
 if(action)(dialog.querySelector(`[data-ds-action="${action}"]`)||close).focus({preventScroll:true});
 else if(href)Array.from(dialog.querySelectorAll('a')).find(node=>node.href===href)?.focus({preventScroll:true});
}
async function load(refresh=false){
 if(loading)return;loading=true;if(dialog.open)renderDetails();
 try{
  const agent=location.pathname.match(/\/studio\/agents\/([^/]+)/)?.[1]||'supervisor';
  const response=await fetch(`/studio/integrations/deepseek/${refresh?'refresh':'status'}?agent=${encodeURIComponent(agent)}`,{method:refresh?'POST':'GET',credentials:'same-origin',cache:'no-store',...(refresh?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});
  if(response.status===401||response.status===403){current={sessionExpired:true};if(dialog.open)dialog.close();}
  else{if(!response.ok)throw new Error('request failed');current=await response.json();}
 }catch{current={status:'error',model:current?.model,error:{title:'无法读取接入状态',cause:'本地状态服务暂不可用，未确认 DeepSeek 状态。',action:'检查本地服务与登录状态后刷新。',httpStatus:null,documented:false}};}
 finally{loading=false;render();}
}
card.addEventListener('click',()=>{renderDetails();dialog.showModal();});
dialog.addEventListener('click',event=>{if(event.target===dialog){const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();}});
const resize=new ResizeObserver(entries=>{card.classList.toggle('ds-compact',entries[0].contentRect.width<160);});
function mount(){const footer=document.querySelector('[data-slot="sidebar-footer"]'),meta=footer?.querySelector('[data-slot="sidebar-footer-meta"]');if(footer&&!footer.contains(card)){if(dialog.open)dialog.close();footer.insertBefore(card,meta||null);footer.insertBefore(dialog,meta||null);dialog.removeAttribute('aria-hidden');dialog.removeAttribute('data-base-ui-inert');resize.disconnect();resize.observe(footer);}}
new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});mount();render();load();
setInterval(()=>{if(!document.hidden)load();},15000);
