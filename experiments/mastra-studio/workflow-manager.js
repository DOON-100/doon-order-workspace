const $=selector=>document.querySelector(selector),create=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
let data={workflows:[],catalog:[],agents:[]},current=null,selected=null,dirty=false,busy=false,reviews=[],reviewing=null,lastResult=null,creationId=null,pendingDecision=null,connecting=null,editingEdge=null;
const labels={start:'开始',end:'结束',scan:'采购风险检查',filter:'筛选条目',branch:'条件分支',review:'人工审核',draft:'内部草稿',agent:'调用 Agent',summary:'汇总结果'},ports={next:'下一步',yes:'满足条件',no:'不满足条件',approved:'通过',rejected:'拒绝'},statuses={pending:'待审核',deferred:'已暂缓',approved:'已通过',rejected:'已拒绝'};
const defaults={scan:{},filter:{minMissing:0,supplier:''},branch:{metric:'count',operator:'gte',threshold:1},review:{title:'核查审核',role:'technical',reviewerId:'',instructions:'核对本次证据与待执行内容后，填写审核意见。',maxAgeMinutes:30},draft:{prefix:''},agent:{agentId:'procurement',prompt:'请根据本次合成证据说明已核实事实与未知项，只生成内部建议。'},summary:{title:'核查摘要'}};
const outgoing=type=>type==='end'?[]:type==='branch'?['yes','no']:type==='review'?['approved','rejected']:['next'];
function status(text,error=false,selector='#page-status'){const e=$(selector);e.textContent=text;e.dataset.error=String(error);if(error&&selector==='#page-status'&&$('#new-dialog')?.open){$('#new-status').textContent=text;$('#new-status').dataset.error='true';}}
async function api(route,method='GET',body){const response=await fetch('/studio/workflow-manager/api/'+route,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});let result;try{result=await response.json();}catch{throw new Error('无法读取工作流，请检查登录状态。');}if(!response.ok)throw new Error(result.error||'操作未完成。');return result;}
function setBusy(value){busy=value;if(value)cancelConnection();for(const selector of ['#save-workflow','#publish-workflow','#test-workflow','#restore-version','#new-workflow','#reload-workflow','#new-node','#auto-layout'])$(selector).disabled=value||(!current&&selector!=='#new-workflow');for(const input of document.querySelectorAll('#design-view input,#design-view select,#design-view textarea,#new-dialog input,#new-dialog select,#new-dialog button[type=submit],.wm-connection-input,.wm-connection-output,#node-palette button,#remove-edge'))input.disabled=value;}
function markDirty(){dirty=true;$('#version-status').textContent=`v${current.versionNumber} · 有未保存修改`;status('有未保存修改；保存草稿后可以试运行，发布后才影响正式选择。');}
function view(name){for(const n of ['design','reviews','results'])$('#'+n+'-view').hidden=n!==name;for(const button of document.querySelectorAll('[data-view]'))button.setAttribute('aria-selected',String(button.dataset.view===name));if(name==='reviews')loadReviews().catch(e=>status(e.message,true));}
async function loadList(){data=await api('workflows');const actor=data.actor;$('#actor-status').textContent=actor?`${actor.synthetic?'合成审核身份':'当前登录'}：${actor.name||actor.id} · ${actor.role} · ID ${actor.id}`:'未提供审核身份';renderList();renderPalette();}
function renderList(){const list=$('#workflow-list'),search=$('#workflow-search').value.trim().toLowerCase();list.replaceChildren();for(const row of data.workflows.filter(w=>(w.name+' '+w.description).toLowerCase().includes(search))){const button=create('button');button.setAttribute('aria-current',String(current?.id===row.id));button.append(create('strong',row.name),create('small',`v${row.versionNumber} · ${row.publishedVersionId?'已发布':'未发布'}${row.hasDraft?' · 有草稿':''}`));button.addEventListener('click',()=>{if(!busy&&(!dirty||confirm('有未保存修改，是否放弃并切换工作流？')))open(row.id).catch(e=>status(e.message,true));});list.append(button);}}
function renderPalette(){const palette=$('#node-palette');palette.replaceChildren();for(const item of data.catalog){const button=create('button');button.append(create('strong','＋ '+item.label),create('span',item.description));button.addEventListener('click',()=>{if(busy||!current)return;addNode(item.type);$('#node-dialog').close();});palette.append(button);}}
async function open(id){current=await api('workflows/'+id);cancelConnection();dirty=false;selected=current.nodes[0]?.id;lastResult=null;$('#workflow-title').textContent=current.name;$('#workflow-name').value=current.name;$('#workflow-description').value=current.description;$('#version-status').textContent=`v${current.versionNumber} · ${current.publishedVersionId?'已有发布版本':'尚未发布'}${current.hasDraft?' · 当前为草稿':' · 当前版本已发布'}`;$('#open-native').href='/studio/workflows/'+encodeURIComponent(id);$('#open-native').hidden=!current.publishedVersionId;window.history.replaceState(null,'','/studio/workflow-manager/?edit='+encodeURIComponent(id));renderList();draw();inspect();await loadHistory();setBusy(false);status('点击「＋ 新建节点」添加步骤；连线时先点出口，再点目标输入点。');}
async function loadHistory(){const select=$('#history-version');select.replaceChildren();if(!current)return;const result=await api('workflows/'+current.id+'/versions');for(const version of result.versions){const option=create('option',`v${version.versionNumber} · ${version.message}`);option.value=version.id;select.append(option);}}
function config(){return{name:current.name,description:current.description,nodes:current.nodes,edges:current.edges};}
async function save(publish=false){if(!current||busy)return false;setBusy(true);try{let result=await api('workflows/'+current.id,'PATCH',{...config(),expectedVersionId:current.versionId});current={...current,...result};dirty=false;if(publish)current=await api('workflows/'+current.id+'/publish','POST',{expectedVersionId:current.versionId});await loadList();$('#workflow-title').textContent=current.name;$('#version-status').textContent=`v${current.versionNumber} · ${current.hasDraft?'草稿已保存':'当前版本已发布'}`;$('#open-native').hidden=!current.publishedVersionId;await loadHistory();status(publish?'已发布。后续新运行使用该版本，已暂停的旧审核不会自动获得批准。':'草稿已保存，已发布流程保持原样。');return true;}catch(e){status(e.message,true);return false;}finally{setBusy(false);draw();inspect();}}
function svg(tag,attrs={}){const element=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value] of Object.entries(attrs))element.setAttribute(key,String(value));return element;}
function connectionError(from,to,port){
 const source=current?.nodes.find(n=>n.id===from),target=current?.nodes.find(n=>n.id===to);
 if(!source||!target||!outgoing(source.type).includes(port))return '请选择有效节点和出口。';
 if(from===to)return '节点不能连接自己，请选择其他目标。';
 if(target.type==='start')return '开始节点没有输入，请选择其他目标。';
 const edges=current.edges.filter(e=>!(e.from===from&&e.port===port)),pending=[to],visited=new Set();
 while(pending.length){const id=pending.pop();if(id===from)return '这条连接会形成循环，请选择后续节点。';if(visited.has(id))continue;visited.add(id);pending.push(...edges.filter(e=>e.from===id).map(e=>e.to));}
 return '';
}
function connectionHint(message,error=false){const hint=$('#connection-hint');hint.textContent=message||'连线：点击节点底部的出口，再点击目标节点顶部的输入点。';hint.dataset.error=String(error);$('#cancel-connection').hidden=!connecting;}
function cancelConnection(){connecting=null;connectionHint();for(const e of document.querySelectorAll('.wm-node-group'))e.classList.remove('wm-target');for(const e of document.querySelectorAll('.wm-connection-output'))e.setAttribute('aria-pressed','false');}
function startConnection(from,port){
 if(busy)return;if(connecting?.from===from&&connecting.port===port){cancelConnection();return;}
 connecting={from,port};selected=from;draw();inspect();
 connectionHint(`正在连接「${current.nodes.find(n=>n.id===from).label} · ${ports[port]}」→ 点击目标输入点或目标节点；Esc 取消。`);
}
function connectTo(to){
 if(!connecting||busy)return;const {from,port}=connecting,error=connectionError(from,to,port);if(error){connectionHint(error,true);return;}
 const source=current.nodes.find(n=>n.id===from),target=current.nodes.find(n=>n.id===to),replaced=current.edges.some(e=>e.from===from&&e.port===port);
 current.edges=current.edges.filter(e=>!(e.from===from&&e.port===port));current.edges.push({from,to,port});cancelConnection();markDirty();draw();inspect();
 connectionHint(`已连接：${source.label} · ${ports[port]} → ${target.label}${replaced?'（已替换该出口的原连线）':''}。保存草稿后生效。`);
}
function manageEdge(edge){if(busy||connecting)return;editingEdge=edge;const a=current.nodes.find(n=>n.id===edge.from),b=current.nodes.find(n=>n.id===edge.to);$('#edge-description').textContent=`${a.label} · ${ports[edge.port]} → ${b.label}`;$('#edge-dialog').showModal();}
function drawEdges(){
 const edges=$('#workflow-edges');edges.replaceChildren();const defs=svg('defs'),marker=svg('marker',{id:'wm-arrow',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
 marker.append(svg('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#909090'}));defs.append(marker);edges.append(defs);if(!current)return;
 for(const edge of current.edges){
  const a=current.nodes.find(n=>n.id===edge.from),b=current.nodes.find(n=>n.id===edge.to);if(!a||!b)continue;
  const rejected=['rejected','no'].includes(edge.port),branched=edge.port!=='next',x1=a.x+(branched?(rejected?143:47):95),y1=a.y+108,x2=b.x+95,y2=b.y-3,mid=(y1+y2)/2,lane=Math.max(a.x,b.x)+280,detour=rejected&&Math.abs(y2-y1)>160;
  const path=svg('path',{d:detour?`M ${x1} ${y1} C ${lane} ${y1}, ${lane} ${y2-30}, ${x2} ${y2}`:`M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`,fill:'none',stroke:rejected?'#ae9898':'#909090','stroke-width':1.5,'marker-end':'url(#wm-arrow)'});edges.append(path);
  const hit=svg('path',{d:path.getAttribute('d'),fill:'none',stroke:'transparent','stroke-width':16,class:'wm-edge-hit',tabindex:0,role:'button','aria-label':`管理连线：${a.label} · ${ports[edge.port]} → ${b.label}`});hit.addEventListener('click',()=>manageEdge(edge));hit.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();manageEdge(edge);}});edges.append(hit);
  if(branched){const text=svg('text',{x:detour?lane-10:(x1+x2)/2+8,y:mid-5,fill:'#737373','font-size':11});text.textContent=ports[edge.port];edges.append(text);}
 }
}
function resizeCanvas(){if(!current)return;$('#workflow-canvas').style.width=Math.max(800,...current.nodes.map(n=>n.x+300))+'px';$('#workflow-canvas').style.height=Math.max(800,...current.nodes.map(n=>n.y+200))+'px';}
function draw(){
 const container=$('#workflow-nodes');container.replaceChildren();if(!current){drawEdges();return;}resizeCanvas();
 for(const n of current.nodes){
  const group=create('div',undefined,'wm-node-group');group.style.left=n.x+'px';group.style.top=n.y+'px';
  if(connecting&&!connectionError(connecting.from,n.id,connecting.port))group.classList.add('wm-target');
  const button=create('button',undefined,'wm-node');button.dataset.nodeId=n.id;button.dataset.type=n.type;button.dataset.state=lastResult?.result?.nodeStates?.[n.id]?.status||'';button.setAttribute('aria-pressed',String(selected===n.id));button.setAttribute('aria-label',n.label+'，'+labels[n.type]);button.append(create('span',labels[n.type]),create('strong',n.label));
  let dragged=false;
  button.addEventListener('click',()=>{if(dragged){dragged=false;return;}if(connecting){connectTo(n.id);return;}selected=n.id;for(const e of container.querySelectorAll('.wm-node'))e.setAttribute('aria-pressed',String(e===button));inspect();});
  const position=()=>{group.style.left=n.x+'px';group.style.top=n.y+'px';resizeCanvas();drawEdges();};
  button.addEventListener('keydown',event=>{const moves={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]};if(moves[event.key]&&!busy&&!connecting){event.preventDefault();const [x,y]=moves[event.key];n.x=Math.max(0,Math.min(3000,n.x+x));n.y=Math.max(0,Math.min(3000,n.y+y));position();markDirty();}});
  button.addEventListener('pointerdown',event=>{if(busy||connecting||event.button!==0)return;dragged=false;const startX=event.clientX,startY=event.clientY,x=n.x,y=n.y;let moved=false;button.setPointerCapture(event.pointerId);const move=e=>{const dx=e.clientX-startX,dy=e.clientY-startY;if(Math.abs(dx)+Math.abs(dy)>3)moved=true;if(!moved)return;n.x=Math.max(0,Math.min(3000,x+dx));n.y=Math.max(0,Math.min(3000,y+dy));position();};const end=()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);dragged=moved;if(moved)markDirty();};button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);});group.append(button);
  if(n.type!=='start'){const input=create('button','○ 输入','wm-connection-input');input.setAttribute('aria-label','连接到：'+n.label);input.disabled=busy;input.addEventListener('click',()=>{if(connecting)connectTo(n.id);else connectionHint('先点击来源节点底部的出口，再点击这里完成连线。');});group.append(input);}
  const outputs=outgoing(n.type);for(const [i,port] of outputs.entries()){const output=create('button',ports[port]+' ↓','wm-connection-output');output.dataset.port=port;output.style.left=(outputs.length===1?42:i*96)+'px';output.style.width=(outputs.length===1?106:94)+'px';output.disabled=busy;output.setAttribute('aria-label',`从「${n.label}」的「${ports[port]}」连线`);output.setAttribute('aria-pressed',String(connecting?.from===n.id&&connecting.port===port));output.addEventListener('click',()=>startConnection(n.id,port));group.append(output);}
  container.append(group);
 }drawEdges();
}
function freeNodePosition(){
 const scroll=$('#canvas-scroll'),columns=Math.max(1,Math.floor((scroll.clientWidth-40)/240)),free=(x,y)=>current.nodes.every(n=>Math.abs(n.x-x)>=215||Math.abs(n.y-y)>=140);
 for(let row=0;row<20;row++)for(let col=0;col<columns;col++){const x=Math.min(2800,scroll.scrollLeft+40+col*240),y=Math.min(2800,scroll.scrollTop+36+row*145);if(free(x,y))return{x,y};}
 for(let y=40;y<=2800;y+=145)for(let x=40;x<=2800;x+=240)if(free(x,y))return{x,y};
 return{x:2800,y:2800};
}
function addNode(type){if(!current||busy)return;if(current.nodes.length>=24){status('一个流程最多配置 24 个节点。',true);return;}const node={id:'n-'+crypto.randomUUID(),type,label:labels[type],...freeNodePosition(),params:structuredClone(defaults[type])};current.nodes.push(node);selected=node.id;markDirty();draw();inspect();$('#workflow-nodes').querySelector('[data-node-id="'+node.id+'"]').parentElement.scrollIntoView({block:'nearest',inline:'nearest'});connectionHint('已添加「'+node.label+'」。先连接前序节点的出口 → 此节点输入，再连接此节点的出口 → 后续节点输入。');}
function field(parent,label,value,onChange,{type='text',options,maxLength,help}={}){const wrapper=create('label'),title=create('span',label),input=create(options?'select':type==='textarea'?'textarea':'input');input.setAttribute('aria-label',label);input.disabled=busy;if(options){for(const [v,text] of options){const option=create('option',text);option.value=v;input.append(option);}}else if(type==='textarea'){input.rows=3;}else input.type=type;if(maxLength)input.maxLength=maxLength;input.value=String(value??'');input.addEventListener(options?'change':'input',()=>{if(onChange(type==='number'?Number(input.value):input.value)===false)return;markDirty();});wrapper.append(title,input);parent.append(wrapper);if(help)parent.append(create('p',help,'wm-help'));return input;}
function inspect(){const panel=$('#node-inspector');panel.replaceChildren();const node=current?.nodes.find(n=>n.id===selected);if(!node){panel.append(create('p','点击画布中的节点配置参数。'));return;}panel.append(create('h3','节点 · '+labels[node.type]));field(panel,'节点名称',node.label,value=>{node.label=value;draw();},{maxLength:80});
 if(outgoing(node.type).length){panel.append(create('h3','出口连接'),create('p','在画布点出口 → 点目标输入；也可在这里选择目标。','wm-help'));for(const port of outgoing(node.type)){let previous=current.edges.find(e=>e.from===node.id&&e.port===port)?.to||'';const input=field(panel,ports[port]+' → 目标节点',previous,to=>{const error=to?connectionError(node.id,to,port):'';if(error){input.value=previous;connectionHint(error,true);return false;}cancelConnection();current.edges=current.edges.filter(e=>!(e.from===node.id&&e.port===port));if(to)current.edges.push({from:node.id,to,port});previous=to;draw();},{options:[['','未连接'],...current.nodes.filter(n=>n.id!==node.id&&n.type!=='start').map(n=>[n.id,n.label])]});}}
 const p=node.params;
 if(node.type==='scan')panel.append(create('p','读取固定合成采购工具返回的条目。','wm-help'));
 if(node.type==='filter'){field(panel,'最小欠数',p.minMissing,v=>p.minMissing=v,{type:'number'});field(panel,'供应商包含文字',p.supplier,v=>p.supplier=v,{maxLength:160});}
 if(node.type==='branch'){field(panel,'判断字段',p.metric,v=>p.metric=v,{options:[['count','当前条目数'],['missing','当前条目的欠数合计']]});field(panel,'比较方式',p.operator,v=>p.operator=v,{options:[['gte','大于等于'],['gt','大于'],['eq','等于'],['lte','小于等于'],['lt','小于']]});field(panel,'比较值',p.threshold,v=>p.threshold=v,{type:'number'});}
 if(node.type==='draft')field(panel,'草稿开头文字',p.prefix,v=>p.prefix=v,{type:'textarea',maxLength:500,help:'只生成内部草稿，不执行发送。'});
 if(node.type==='summary')field(panel,'摘要标题',p.title,v=>p.title=v,{maxLength:160});
 if(node.type==='agent'){field(panel,'调用的 Agent',p.agentId,v=>p.agentId=v,{options:data.agents.map(a=>[a.id,a.name])});field(panel,'任务要求',p.prompt,v=>p.prompt=v,{type:'textarea',maxLength:4000,help:'调用所选岗位的已发布版本，沿用其模型与工具设置。'});}
 if(node.type==='review'){field(panel,'审核标题',p.title,v=>p.title=v,{maxLength:160});field(panel,'允许的审核角色',p.role,v=>p.role=v,{options:[['technical','管理员或程序员'],['admin','仅管理员'],['programmer','仅程序员']]});field(panel,'指定审核人 ID（可选）',p.reviewerId,v=>p.reviewerId=v,{maxLength:160,help:'留空按角色审核；填写后只允许该登录身份 ID 审核。'});field(panel,'审核说明',p.instructions,v=>p.instructions=v,{type:'textarea',maxLength:2000});field(panel,'审核有效期（分钟）',p.maxAgeMinutes,v=>p.maxAgeMinutes=v,{type:'number',help:'过期、暂缓或未处理都不会自动通过。'});}
 if(!['start','end'].includes(node.type)){const remove=create('button','移除此节点');remove.addEventListener('click',()=>{if(busy)return;current.nodes=current.nodes.filter(n=>n.id!==node.id);current.edges=current.edges.filter(e=>e.from!==node.id&&e.to!==node.id);selected=current.nodes[0]?.id;markDirty();draw();inspect();});panel.append(remove);}
}
function autoLayout(){if(!current||busy)return;const levels=new Map(),start=current.nodes.find(n=>n.type==='start');if(!start)return;levels.set(start.id,0);for(let i=0;i<current.nodes.length;i++)for(const edge of current.edges)if(levels.has(edge.from)&&edge.to!==start.id)levels.set(edge.to,Math.min(18,Math.max(levels.get(edge.to)||0,levels.get(edge.from)+1)));const used=new Map();for(const node of current.nodes){const level=levels.get(node.id)??0,index=used.get(level)||0;node.x=80+index*240;node.y=40+level*145;used.set(level,index+1);}markDirty();draw();}
async function runTest(){if(!current||busy)return;if(dirty&&!await save(false))return;setBusy(true);status('正在试运行已保存草稿…');try{lastResult=await api('workflows/'+current.id+'/test','POST',{expectedVersionId:current.versionId});$('#run-status').textContent=`运行 ${lastResult.runId} · ${lastResult.status==='suspended'?'已暂停，等待人工审核':lastResult.status==='success'?'已完成':lastResult.status}`;$('#run-result').textContent=JSON.stringify(lastResult,null,2);draw();await loadReviews();view(lastResult.status==='suspended'?'reviews':'results');status(lastResult.status==='suspended'?'流程已暂停，请打开人工审核任务。':'试运行已结束，详情见运行结果。');}catch(e){status(e.message,true);}finally{setBusy(false);}}
async function loadReviews(){const result=await api('reviews');reviews=result.reviews;$('#reviews-tab').textContent='人工审核'+(reviews.filter(r=>['pending','deferred'].includes(r.status)).length?' · '+reviews.filter(r=>['pending','deferred'].includes(r.status)).length:'');const list=$('#review-list');list.replaceChildren();if(!reviews.length)list.append(create('p','暂无审核任务。带人工审核节点的流程运行到此节点后，会在这里等待审核。'));for(const task of [...reviews].reverse()){const card=create('article',undefined,'wm-review-card'),text=create('div'),button=create('button','查看审核');text.append(create('h2',task.title),create('p',`${task.workflowName} · ${task.preview?'草稿试运行':'已发布运行'} · ${statuses[task.status]}${task.expired&&['pending','deferred'].includes(task.status)?' · 已过期':''}`),create('p',`运行 ${task.runId} · ${task.role==='technical'?'管理员或程序员':task.role==='admin'?'仅管理员':'仅程序员'}${task.reviewerId?' · 指定 '+task.reviewerId:''}`));button.addEventListener('click',()=>openReview(task));card.append(text,button);list.append(card);}}
function permitted(task){const actor=data.actor;return actor&&['admin','programmer'].includes(actor.role)&&(task.role==='technical'||task.role===actor.role)&&(!task.reviewerId||task.reviewerId===actor.id);}
function reviewButtons(){
 if(!reviewing)return;const task=reviewing,closed=['approved','rejected'].includes(task.status);
 for(const selector of ['#approve-review','#reject-review','#defer-review'])$(selector).disabled=busy||!permitted(task)||closed||task.expired;
 $('#review-comment').disabled=busy||!permitted(task)||closed||task.expired;
 const retry=$('#retry-review');retry.hidden=!closed||!!task.execution;retry.disabled=busy||!permitted(task)||task.expired||task.audit.at(-1)?.actor.id!==data.actor?.id;
}
function renderEvidence(payload){
 const section=$('#review-evidence');section.replaceChildren(create('h3','本次待审条目'));
 if(payload.orders.length){const wrapper=create('div',undefined,'wm-evidence-table'),table=create('table'),thead=create('thead'),head=create('tr');for(const title of ['记录 ID','物料','欠数','供应商','供应商复期','版本'])head.append(create('th',title));thead.append(head);table.append(thead);const body=create('tbody');for(const order of payload.orders){const row=create('tr');for(const key of ['orderId','material','missing','supplier','promisedDate','version'])row.append(create('td',String(order[key]??'未记录')));body.append(row);}table.append(body);wrapper.append(table);section.append(wrapper);}else section.append(create('p','本次快照中没有采购条目。','wm-muted'));
 section.append(create('h3','内部草稿与已有意见'));
 if(!payload.drafts.length&&!payload.messages.length)section.append(create('p','本次待审快照中没有内部草稿或其他意见。','wm-muted'));
 for(const draft of payload.drafts)section.append(create('div',draft.text,'wm-evidence-text'));
 for(const message of payload.messages)section.append(create('div',message.text||`前序审核：${statuses[message.decision]||message.decision}；${message.comment||''}`,'wm-evidence-text'));
}
function openReview(task){
 reviewing=task;$('#review-title').textContent=task.title;
 $('#review-context').textContent=`${task.workflowName} · ${statuses[task.status]} · ${task.preview?'草稿试运行':'已发布运行'}\n有效期至 ${new Date(task.validUntil).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})} · 内容指纹 ${task.payloadHash.slice(0,12)} · 版本 ${task.configVersionId.slice(-12)}`;
 $('#review-instructions').textContent=task.instructions;renderEvidence(task.payload);$('#review-payload').textContent=JSON.stringify(task.payload,null,2);$('#review-comment').value='';
 const audit=$('#review-audit');audit.replaceChildren();if(!task.audit.length)audit.append(create('p','尚无审核决定。','wm-muted'));
 for(const event of task.audit){const row=create('div',undefined,'wm-audit-entry');row.append(create('strong',`${event.actor.name} · ${{approve:'通过',reject:'拒绝',defer:'暂缓'}[event.action]} · ${new Date(event.at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`),create('p',event.comment));audit.append(row);}
 const closed=['approved','rejected'].includes(task.status);reviewButtons();
 status(!permitted(task)?'当前登录身份不在该节点的审核范围。':closed?task.execution?'该审核已有决定，记录保留。':'决定已记录，后续运行结果待核对；可使用原决定核对并恢复。':task.expired?'任务已过期，请重新试运行或发起新流程。':'请核对待审内容并填写意见。',false,'#review-status');
 if(!$('#review-dialog').open)$('#review-dialog').showModal();
}
async function decide(action,retry=false){
 if(!reviewing||busy)return;const previous=retry?reviewing.audit.at(-1):null,comment=previous?.comment||$('#review-comment').value.trim();
 if(!comment){status('请填写审核意见。',true,'#review-status');return;}
 if(!pendingDecision||pendingDecision.taskId!==reviewing.taskId||pendingDecision.body.action!==action||pendingDecision.body.comment!==comment)pendingDecision={taskId:reviewing.taskId,body:{action,comment,expectedVersionId:reviewing.versionId,requestId:previous?.requestId||crypto.randomUUID()}};
 busy=true;reviewButtons();
 try{
  const result=await api('reviews/'+reviewing.taskId+'/decision','POST',pendingDecision.body);pendingDecision=null;
  await loadReviews();openReview(reviews.find(r=>r.taskId===reviewing.taskId));
  status(action==='defer'?'已暂缓，流程继续等待审核。':`已记录${action==='approve'?'通过':'拒绝'}，后续运行状态：${result.execution?.status||'待核对'}。`,false,'#review-status');
  if(result.execution){lastResult=result.execution;draw();$('#run-status').textContent=`运行 ${result.execution.runId} · ${result.execution.status}`;$('#run-result').textContent=JSON.stringify(result.execution,null,2);}
 }catch(e){status(e.message,true,'#review-status');}finally{busy=false;setBusy(false);reviewButtons();}
}
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>view(button.dataset.view));
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>{if(!busy)$('#'+button.dataset.close).close();});
$('#workflow-search').addEventListener('input',renderList);$('#save-workflow').addEventListener('click',()=>save(false));$('#publish-workflow').addEventListener('click',()=>save(true));$('#test-workflow').addEventListener('click',runTest);$('#auto-layout').addEventListener('click',autoLayout);$('#workflow-name').addEventListener('input',e=>{if(current){current.name=e.target.value;markDirty();}});$('#workflow-description').addEventListener('input',e=>{if(current){current.description=e.target.value;markDirty();}});
$('#new-node').addEventListener('click',()=>{if(!current||busy)return;cancelConnection();$('#node-dialog').showModal();});
$('#cancel-connection').addEventListener('click',cancelConnection);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&connecting){event.preventDefault();cancelConnection();}});
$('#remove-edge').addEventListener('click',()=>{if(!current||busy||!editingEdge)return;current.edges=current.edges.filter(e=>e!==editingEdge);editingEdge=null;$('#edge-dialog').close();markDirty();draw();inspect();connectionHint('连线已移除。点击出口，再点击目标输入点可重新连接。');});
$('#reload-workflow').addEventListener('click',()=>{if(current&&(!dirty||confirm('放弃当前未保存修改，重新载入？')))open(current.id).catch(e=>status(e.message,true));});
$('#restore-version').addEventListener('click',async()=>{if(!current||busy)return;setBusy(true);try{const row=await api('workflows/'+current.id+'/restore','POST',{expectedVersionId:current.versionId,versionId:$('#history-version').value});await loadList();await open(row.id);status('历史版本已恢复为新草稿，尚未发布。');}catch(e){status(e.message,true);}finally{setBusy(false);}});
$('#new-workflow').addEventListener('click',()=>{creationId=crypto.randomUUID();$('#new-form').reset();status('',false,'#new-status');$('#new-dialog').showModal();});
$('#new-form').addEventListener('submit',async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget,reviewed=form.elements.template.value==='reviewed';const node=(id,type,label,x,y,params={})=>({id,type,label,x,y,params}),nodes=reviewed?[node('start','start','开始',80,40),node('scan','scan','采购风险检查',80,185),node('review','review','人工审核',80,330,structuredClone(defaults.review)),node('draft','draft','内部草稿',80,475,{prefix:''}),node('end','end','结束',80,620)]:[node('start','start','开始',80,40),node('end','end','结束',80,185)],edges=reviewed?[{from:'start',to:'scan',port:'next'},{from:'scan',to:'review',port:'next'},{from:'review',to:'draft',port:'approved'},{from:'review',to:'end',port:'rejected'},{from:'draft',to:'end',port:'next'}]:[{from:'start',to:'end',port:'next'}];setBusy(true);try{const row=await api('workflows','POST',{name:form.elements.name.value,description:'',nodes,edges,requestId:creationId});$('#new-dialog').close();await loadList();await open(row.id);view('design');}catch(e){status(e.message,true);}finally{setBusy(false);}});
$('#refresh-reviews').addEventListener('click',()=>loadReviews().catch(e=>status(e.message,true)));$('#show-review-results').addEventListener('click',()=>view('reviews'));$('#approve-review').addEventListener('click',()=>decide('approve'));$('#reject-review').addEventListener('click',()=>decide('reject'));$('#defer-review').addEventListener('click',()=>decide('defer'));
$('#retry-review').addEventListener('click',()=>decide(reviewing?.audit.at(-1)?.action,true));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
try{await loadList();const id=new URL(location.href).searchParams.get('edit')||data.workflows[0]?.id;if(id)await open(id);else setBusy(false);await loadReviews();}catch(e){status(e.message,true);}
