const host=document.querySelector('#schedules'),status=document.querySelector('#status'),labels={draft:'未发布',paused:'已暂停',active:'已启用',unavailable:'未接通调度',blocked:'当前权限不可用',expired:'授权到期，需重新启用','version-changed':'版本变化，需重新启用'};
const el=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
const format=time=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(time));
async function api(path='',body){const response=await fetch('/studio/workflow-manager/api/schedules'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),data=await response.json();if(!response.ok)throw new Error(data.error||'请求失败');return data;}
async function load(){
 try{const data=await api();status.textContent=data.message;host.replaceChildren();if(!data.schedules.length)host.append(el('p','尚无定时工作流。可在 Agent 对话中说明运行时间，预览并确认保存。'));
  for(const row of data.schedules){const card=el('article',undefined,'ws-row'),body=el('div'),title=el('h2',row.name);title.append(el('span',labels[row.state],'ws-state'));body.append(title,el('p',row.summary));
   body.append(el('p','读取对象：'+row.sourceLabel+' · '+row.datasetLabel,'ws-note'));
   if(row.requiresGrant)body.append(el('p','启用即授权后台按已发布流程的范围与条件只读运行，有效期 30 天；暂停可撤销。','ws-note'));
   if(row.nextRuns[0])body.append(el('p',(row.state==='active'?(Date.parse(row.nextRuns[0])<=Date.now()?'已到期，等待执行：':'下次执行：'):'计划时间：')+format(row.nextRuns[0])));
   body.append(el('p',row.state==='draft'?'草稿尚未发布，不会自动执行。':row.state==='unavailable'?'已保存时间，但本实例没有可用的后台调度器。':row.state==='version-changed'?'发布版本已改变，核对后重新启用。':row.state==='paused'?'已暂停自动触发。':'当日服务恢复后允许补跑一次；不补跑历史日期。','ws-note'));
   if(row.hasDraft)body.append(el('p','另有未发布修改，当前显示已发布版本的时间。','ws-note'));
   if(row.lastCheck)body.append(el('p','本日已检查：'+row.lastCheck.matched+' 条匹配记录，'+format(row.lastCheck.checkedAt),'ws-note'));
   if(row.expiresAt)body.append(el('p','后台只读授权有效至：'+format(row.expiresAt),'ws-note'));
   if(row.lastAttempt?.status==='blocked')body.append(el('p','最近检查未执行：'+({'limit-exceeded':'匹配超过处理上限，请缩小条件。','authorization-unavailable':'后台授权或读取权限失效，请核对后重新启用。','source-unavailable':'数据通道暂时不可用，后台将继续核对。'}[row.lastAttempt.error]||'等待核对。'),'ws-note'));
   if(row.lastAttempt?.status==='needs-attention')body.append(el('p','有运行结果待核对，请先查看运行记录。系统不会盲目重复执行。','ws-note'));
   const actions=el('div',undefined,'ws-actions'),edit=el('a','修改时间与流程','ws-link');edit.href=row.editUrl;actions.append(edit);
   const results=el('a','查看运行结果','ws-link');results.href=row.resultsUrl;actions.append(results);
   if(row.state==='blocked')body.append(el('p','数据权限已变化，后台会阻止执行；请核对权限或暂停任务。','ws-note'));
   if(row.state!=='draft'){const enable=!row.enabled,button=el('button',enable?'启用':'暂停');button.disabled=enable&&!row.canEnable;button.addEventListener('click',async()=>{button.disabled=true;try{await api('/'+row.id+'/state',{expectedVersionId:row.versionId,expectedControlVersionId:row.controlVersionId,enabled:enable});await load();}catch(error){status.textContent=error.message;button.disabled=false;}});actions.append(button);}
   card.append(body,actions);host.append(card);
  }
 }catch(error){status.textContent=error.message;}
}
document.querySelector('#refresh').addEventListener('click',load);void load();
