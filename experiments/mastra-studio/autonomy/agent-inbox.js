// Shared workbench entry; no Studio access or model credentials are required.
const nativePlatform=new URL(import.meta.url).searchParams.get('platform')==='native';
const css=document.createElement('link');css.rel='stylesheet';css.href=nativePlatform?'/agent-workbench-inbox.css':'/agent-inbox.css';document.head.append(css);
let current=null,items=[],selected=null,dialog=null,busy=false,polling=false,lastError='';
const seen=new Set();
const originLabel=row=>row.originRole==='supervisor'?'总管助手':'采购助手';
const taskTitle=row=>row.payload.manualOnly?'人工接管确认':row.category==='coordination'?'协作安排确认':'采购跟进确认';
const sourceLabel=row=>{const facts=row.payload.evidence;return[facts?.customerOrder?'订单 '+facts.customerOrder:null,facts?.po?'采购单 '+facts.po:null,facts?.itemCode?'物料 '+facts.itemCode:null,'记录 '+row.sourceId].filter(Boolean).join(' · ');};
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
async function api(route,body){if(nativePlatform)route=route.replace('/api/agent-inbox','/api/agent-platform/inbox').replace('/inbox/decide','/decide');const response=await fetch(route,{method:body?'POST':'GET',credentials:'same-origin',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'请求失败'),{status:response.status});return data;}
function clear(){if(current)window.dispatchEvent(new CustomEvent('doon:personal-tasks:update',{detail:{actorId:current.identity,tasks:[]}}));document.querySelectorAll('[data-agent-inbox]').forEach(node=>node.remove());dialog?.remove();dialog=null;selected=null;current=null;items=[];}
function open(row){
 if(dialog?.open||busy)return;selected=structuredClone(row);dialog=el('dialog',undefined,'ai-dialog');dialog.setAttribute('aria-label',taskTitle(row));
 const title=el('h2',taskTitle(row));const reason=el('p',row.payload.reason);const proposal=el('pre',row.payload.proposal,'ai-proposal');
 title.tabIndex=-1;title.setAttribute('autofocus','');
 const origin=el('span','★ '+originLabel(row),'ai-origin');origin.title='由'+originLabel(row)+'发起，需要你确认后继续处理';
 const source=el('p',`${sourceLabel(row)} · 来源版本 ${row.payload.sourceVersion} · 方案版本 ${row.version}`,'ai-muted');
 const notice=el('p',row.payload.manualOnly?'已达到自动协调上限。确认仅记录由人工接管，不会自动恢复岗位任务或关闭业务事项。':row.category==='coordination'?'确认后恢复岗位核查，原采购方案仍需负责人审核；不会修改采购单或发送外部消息。':'审核仅确认内部跟进方案，不修改采购源单；实际齐货仍需后续收货证据。','ai-muted');
 const facts=row.payload.evidence;const evidence=el('p',facts?`服务端来源：订购 ${facts.quantity??'未知'} ${facts.unit||''}，已收 ${facts.received??'未知'}，未交 ${facts.balanceKnown?(facts.remaining??'未知'):'待核对'}（已包含退货缺口，其中退货待补 ${facts.returnPending??'未知'}）；供应商承诺日 ${facts.promisedDate||'未记录'}；来源截至 ${facts.sourceAsOf||'未知'}`:'请按对象和来源版本回到业务记录核验。','ai-proposal');
 const label=el('label','处理说明');const comment=el('textarea');comment.setAttribute('aria-label','人工处理说明');comment.rows=3;
 const draftKey=`agent-draft:${current.identity}:${row.id}:${row.payloadHash}`;comment.value=sessionStorage.getItem(draftKey)||'';comment.oninput=()=>sessionStorage.setItem(draftKey,comment.value);
 if(row.status!=='pending'){comment.value=row.decision?.comment||'';comment.readOnly=true;}
 const error=el('p','','ai-error'),buttons=el('div',undefined,'ai-actions');
 for(const [action,text]of row.status==='pending'?[['approve',row.payload.manualOnly?'确认人工接管':row.category==='coordination'?'确认协作安排':'同意内部跟进'],['return','退回补充'],['reject','拒绝']]:[]){
  const button=el('button',text);button.type='button';button.onclick=async()=>{
   if(busy)return;if(!comment.value.trim()){error.textContent='请填写核验依据或处理说明';return;}
   busy=true;for(const b of buttons.querySelectorAll('button'))b.disabled=true;
   try{await api('/api/agent-inbox/decide',{id:selected.id,version:selected.version,payloadHash:selected.payloadHash,action,comment:comment.value.trim(),requestId:crypto.randomUUID()});sessionStorage.removeItem(draftKey);dialog.close();dialog.remove();dialog=null;selected=null;await refresh();}
   catch(e){error.textContent=e.message;}finally{busy=false;for(const b of buttons.querySelectorAll('button'))b.disabled=false;}
  };buttons.append(button);
 }
 const later=el('button',row.status==='pending'?'稍后处理':'关闭');later.type='button';later.onclick=()=>{if(busy)return;dialog.close();dialog.remove();dialog=null;selected=null;};buttons.append(later);
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else{selected=null;setTimeout(()=>{dialog?.remove();dialog=null;},0);}});
 const content=el('div',undefined,'ai-dialog-content');content.append(source,evidence);
 if(row.category==='coordination'){const names={procurement:'采购助手',pmc:'PMC 助手',service:'客服助手'},plan=el('p',`恢复岗位：${names[row.payload.targetRole]||row.payload.targetRole}；核查目标：${row.payload.goal||'未填写'}`,'ai-proposal');content.append(plan);}
 content.append(reason,proposal,notice,label,comment,error);dialog.append(title,origin,content,buttons);document.body.append(dialog);dialog.showModal();
}
function updateAdminStatus(card){const status=card.querySelector('[data-agent-status]');if(!status)return;api('/api/agent-validation/status').then(data=>{const start=card.querySelector('[data-agent-start]');if(start)start.hidden=!!data.automaticBusinessEvents;status.textContent=`${data.modelLive?'DeepSeek 真实模型':'离线脚本验证'} · ${data.automaticBusinessEvents?'中台业务变化自动唤醒':'手动事件验证'} · 事项 ${data.cases.length} · ${data.tasks.map(task=>`${task.role}: ${task.state}`).join('；')||'等待事件'}`;}).catch(e=>{status.textContent=e.message;});}
function render(){
 if(!current)return;const header=document.querySelector('.topbar');if(header&&!header.querySelector('[data-agent-inbox]')){const button=el('button','待处理事项','ai-bell');button.dataset.agentInbox='bell';button.onclick=()=>{const row=items.find(item=>item.status==='pending');if(row)open(row);else{history.pushState({},'','/personal-tasks');location.reload();}};header.append(button);}
 const pending=items.filter(row=>row.status==='pending'),bell=document.querySelector('[data-agent-inbox="bell"]');if(bell)bell.textContent=`待处理事项 ${pending.length}`;
 window.dispatchEvent(new CustomEvent('doon:personal-tasks:update',{detail:{actorId:current.identity,tasks:items.map(row=>({id:row.id,title:taskTitle(row),originLabel:originLabel(row),sourceLabel:sourceLabel(row),description:row.status==='pending'?(row.escalatedAt?'等待本人处理 · 已超时升级，事项继续保留':row.category==='coordination'?'请确认岗位重新核查安排，原事项继续保留。':'请核验跟进方案，关闭提醒不会完成事项。'):(row.decision?.comment||'已保存处理结果'),status:row.status==='pending'?'pending':'done',statusLabel:row.status==='pending'?'待处理':row.status==='approved'?'已确认':row.status==='returned'?'已退回':'已拒绝'}))}}));
 const content=document.querySelector('main.content');if(!content||!location.pathname.includes('personal-tasks'))return;
 if(nativePlatform||current.role!=='admin'){content.querySelector('[data-agent-inbox="admin"]')?.remove();return;}
 let panel=content.querySelector('[data-agent-inbox="admin"]');
 if(!panel){
  panel=el('div',undefined,'ai-admin');panel.dataset.agentInbox='admin';panel.append(el('h3','后台 Agent 闭环验证'));
  const status=el('p','正在读取后台状态…');status.dataset.agentStatus='true';panel.append(status);
  const start=el('button','启动采购风险核查');start.dataset.agentStart='true';start.onclick=async()=>{try{await api('/api/agent-validation/start',{requestId:crypto.randomUUID()});await refresh();}catch(e){status.textContent=e.message;}};
  const receipt=el('button','登记合成齐货事件');receipt.onclick=async()=>{try{const data=await api('/api/agent-validation/status');await api('/api/agent-validation/receipt',{received:data.source.quantity,expectedVersion:data.source.version});await refresh();}catch(e){status.textContent=e.message;}};
  panel.append(start,receipt);content.append(panel);
 }
 updateAdminStatus(panel);
}
async function refresh(){
 if(polling||document.hidden)return;polling=true;
 try{
  const data=await api('/api/agent-inbox');if(current&&current.identity!==data.identity)clear();current={identity:data.identity,role:data.role};items=data.items;lastError='';render();
  const row=items.find(item=>item.status==='pending'&&!seen.has(current.identity+':'+item.id+':'+item.version));
  if(row&&!dialog?.open&&!document.activeElement?.matches('input,textarea,[contenteditable="true"]')){const key=current.identity+':'+row.id+':'+row.version;if(!sessionStorage.getItem('agent-popup:'+key)){seen.add(key);sessionStorage.setItem('agent-popup:'+key,'shown');open(row);}}
 }catch(e){lastError=e.message;if(e.status===401||e.status===403)clear();else{const bell=document.querySelector('[data-agent-inbox="bell"]');if(bell)bell.textContent='待处理事项 · 读取失败，事项仍保留';}}
 finally{polling=false;}
}
new MutationObserver(()=>{if(current&&!document.querySelector('[data-agent-inbox="bell"]'))render();}).observe(document.body,{childList:true,subtree:true});
window.addEventListener('doon:personal-tasks:ready',render);window.addEventListener('doon:personal-tasks:open',event=>{const row=items.find(item=>item.id===event.detail?.id);if(row)open(row);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('popstate',()=>{render();refresh();});setInterval(refresh,5000);refresh();
