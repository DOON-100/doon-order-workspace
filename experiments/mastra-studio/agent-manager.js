const $=selector=>document.querySelector(selector),dialog=$('#agent-dialog'),form=$('#agent-form');
let data={agents:[],tools:[]},editing=null,busy=false,creationKey=null;
const labels={inspectOverdue:'采购风险检查',draftFollowup:'内部跟进草稿',delegateProcurement:'委派采购 Agent'};
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
function status(text,error=false,scope='#page-status'){const e=$(scope);e.textContent=text;e.dataset.error=String(error);}
async function api(path='',method='GET',body){
 const response=await fetch('/studio/manage/api/agents'+path,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 let result;try{result=await response.json();}catch{throw new Error('暂时无法读取配置，请检查登录状态。');}
 if(!response.ok)throw new Error(result.error||'操作未完成，请重试。');return result;
}
function render(){
 const search=$('#agent-search').value.trim().toLocaleLowerCase(),list=$('#agent-list');list.replaceChildren();
 const filtered=data.agents.filter(agent=>(agent.name+' '+agent.description).toLocaleLowerCase().includes(search));
 for(const agent of filtered){
  const card=node('article',undefined,'am-card'),head=node('div',undefined,'am-card-header');
  head.append(node('h2',agent.name),node('span',agent.builtin?'现有岗位':'自建岗位','am-badge'));card.append(head);
  card.append(node('p',agent.description||'尚未填写职责简介','am-description'));
  card.append(node('p',`${agent.publishedVersionId?'已发布':'未发布'}${agent.hasDraft?' · 有草稿':''} · v${agent.versionNumber}`));
  card.append(node('p',agent.toolKeys.length?agent.toolKeys.map(key=>labels[key]||key).join(' · '):'未选择工具'));
  const actions=node('div',undefined,'am-card-actions'),edit=node('button','配置'),open=node('a','进入 Editor');
  edit.type='button';edit.addEventListener('click',()=>openForm(agent));open.href='/studio/agents/'+encodeURIComponent(agent.id)+'/editor';
  actions.append(edit,open);card.append(actions);list.append(card);
 }
 status(filtered.length?`共 ${data.agents.length} 个 Agent${search?'，找到 '+filtered.length+' 个匹配项':''}`:'没有匹配的 Agent，可以新建一个。');
}
async function load(){data=await api();$('#model-status').textContent=data.model.live?'当前模型：'+data.model.id:'离线模式 · 可配置岗位，真实业务回答需启用模型';render();}
function setBusy(value){busy=value;for(const b of form.querySelectorAll('button'))b.disabled=value;$('#new-agent').disabled=value;}
function fill(agent){
 editing=agent||null;form.reset();$('#dialog-title').textContent=agent?'配置 '+agent.name:'新建 Agent';
 for(const key of ['name','description','instructions'])form.elements.namedItem(key).value=agent?.[key]||'';
 const tools=$('#tool-options');tools.replaceChildren();
 for(const tool of data.tools){
  if(agent&&!agent.allowedToolKeys.includes(tool.key))continue;
  const label=node('label',undefined,'am-tool'),input=node('input'),text=node('span');input.type='checkbox';input.name='tools';input.value=tool.key;input.checked=agent?.toolKeys.includes(tool.key)||false;
  text.append(node('strong',labels[tool.key]||tool.key),node('small',tool.description));label.append(input,text);tools.append(label);
 }
 $('#open-editor').hidden=!agent;if(agent)$('#open-editor').href='/studio/agents/'+encodeURIComponent(agent.id)+'/editor';
 $('#history-section').hidden=!agent;$('#draft-state').textContent=agent?(agent.hasDraft?'当前为未发布草稿':'当前版本已发布'):'新 Agent 默认先保存为草稿';
 status('',false,'#form-status');
}
async function history(){
 if(!editing)return;const result=await api('/'+editing.id+'/versions'),select=$('#history-version');select.replaceChildren(node('option','选择历史版本'));select.firstChild.value='';
 for(const version of result.versions){const o=node('option',`v${version.versionNumber} · ${new Date(version.createdAt).toLocaleString('zh-CN')}`);o.value=version.id;select.append(o);}
}
async function openForm(agent,{focusPrompt=false}={}){creationKey=agent?null:crypto.randomUUID();fill(agent);dialog.showModal();try{await history();if(focusPrompt){const input=form.elements.namedItem('instructions');input.focus({preventScroll:true});input.scrollIntoView({block:'center'});}}catch(error){status(error.message,true,'#form-status');}}
function values(){return{name:form.elements.namedItem('name').value,description:form.elements.namedItem('description').value,instructions:form.elements.namedItem('instructions').value,toolKeys:Array.from(form.querySelectorAll('input[name=tools]:checked'),input=>input.value)};}
async function save(publish){
 if(busy||!form.reportValidity())return;setBusy(true);
 try{
  const body=values(),saved=editing?await api('/'+editing.id,'PATCH',{...body,expectedVersionId:editing.versionId}):await api('','POST',{...body,requestId:creationKey});
  editing=saved;
  const result=publish?await api('/'+saved.id+'/publish','POST',{versionId:saved.versionId,expectedVersionId:saved.versionId}):saved;
  fill(result);await history();await load();status(publish?'已发布，新的配置现在可以在 Studio 中使用。':'草稿已保存，发布前不会影响已发布的配置。',false,'#form-status');
 }catch(error){status(error.message,true,'#form-status');}
 finally{setBusy(false);}
}
$('#new-agent').addEventListener('click',()=>openForm(null));$('#close-dialog').addEventListener('click',()=>{if(!busy)dialog.close();});
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
form.addEventListener('submit',event=>{event.preventDefault();save(false);});$('#publish-agent').addEventListener('click',()=>save(true));
$('#agent-search').addEventListener('input',render);
$('#restore-version').addEventListener('click',async()=>{
 if(busy||!editing||!$('#history-version').value)return;setBusy(true);
 try{const result=await api('/'+editing.id+'/restore','POST',{versionId:$('#history-version').value,expectedVersionId:editing.versionId});fill(result);await history();await load();status('历史配置已恢复为新草稿，确认后再发布。',false,'#form-status');}catch(error){status(error.message,true,'#form-status');}finally{setBusy(false);}
});
try{
 await load();const params=new URL(location.href).searchParams,editId=params.get('edit');
 if(editId){const agent=data.agents.find(agent=>agent.id===editId);if(!agent)throw new Error('没有找到该 Agent，请从列表重新选择。');await openForm(agent,{focusPrompt:true});}
 else if(params.get('new')==='1')await openForm(null);
}catch(error){status(error.message,true);}
