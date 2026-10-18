// Mount project-owned actions beside native Agent lists and prompt previews.
// Observe SPA renders rather than patching the packaged upstream Studio bundle.
let pending=false;
function mountList(){
 const existing=document.querySelector('.doon-agent-actions');
 const views=/^\/studio\/agents\/?$/.test(location.pathname)?document.querySelector('#root [aria-label="Agents view"]'):null;
 if(!views){existing?.remove();return;}
 if(existing?.parentElement===views.parentElement&&existing.nextElementSibling===views)return;
 existing?.remove();
 const actions=document.createElement('nav');actions.className='doon-agent-actions';actions.setAttribute('aria-label','Agent 配置');
 for(const [text,href,className] of [['管理 Agent','/studio/manage/','doon-agent-manage'],['＋ 新建 Agent','/studio/manage/?new=1','doon-agent-new']]){
  const link=document.createElement('a');link.textContent=text;link.href=href;link.className=className;actions.append(link);
 }
 views.before(actions);
}
function mountPrompt(){
 const agent=location.pathname.match(/^\/studio\/agents\/([\w-]+)(?:\/|$)/)?.[1];
 const title=agent?Array.from(document.querySelectorAll('#root h3')).find(e=>e.textContent==='System Prompt'):null;
 const existing=document.querySelector('.doon-prompt-edit');
 if(!title){existing?.remove();return;}
 const href='/studio/manage/?edit='+encodeURIComponent(agent);
 if(existing?.previousElementSibling===title){if(existing.getAttribute('href')!==href)existing.setAttribute('href',href);return;}
 existing?.remove();
 const link=document.createElement('a');link.className='doon-prompt-edit';link.href=href;link.textContent='修改提示词';
 title.after(link);
}
function mount(){pending=false;mountList();mountPrompt();}
const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(mount);}};
new MutationObserver(schedule).observe(document.querySelector('#root'),{childList:true,subtree:true});
schedule();
