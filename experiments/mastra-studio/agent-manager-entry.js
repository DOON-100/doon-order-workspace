// Mount project-owned actions beside the native Agents view controls.
// Observe SPA renders rather than patching the packaged upstream Studio bundle.
let pending=false;
function mount(){
 pending=false;
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
const schedule=()=>{if(!pending){pending=true;requestAnimationFrame(mount);}};
new MutationObserver(schedule).observe(document.querySelector('#root'),{childList:true,subtree:true});
schedule();
