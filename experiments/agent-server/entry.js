// Add the authorized Studio link without replacing the native platform application.
let allowed=false,checking=false;
function update(){
 const container=document.querySelector('.brand-logo');if(!container)return;
 const ours=container.querySelector('a[data-agent-studio-entry]');
 if(!allowed){if(ours)ours.replaceWith(...ours.childNodes);return;}
 if(ours||container.querySelector('a'))return;
 const image=container.querySelector('img');if(!image)return;
 const link=document.createElement('a');link.href='/studio/';link.target='_blank';link.rel='noopener noreferrer';link.title='打开 agent 工作台';link.setAttribute('aria-label','打开 agent 工作台（新标签页）');link.dataset.agentStudioEntry='1';link.style.cssText='display:inline-flex;line-height:0;max-width:100%;';image.replaceWith(link);link.append(image);
}
async function check(){
 if(checking)return;checking=true;
 try{const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store'});const user=response.ok?(await response.json()).user:null;allowed=!!user&&user.mustChange===false&&user.active!==false&&user.personnelType==='internal'&&['admin','pmc','production','clerk','sales','finance','programmer','viewer'].includes(user.role);}catch{allowed=false;}
 finally{checking=false;update();}
}
new MutationObserver(update).observe(document.body,{childList:true,subtree:true});check();
window.addEventListener('focus',check);setInterval(()=>{if(!document.hidden)check();},60000);
