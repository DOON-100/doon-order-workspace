const api='/studio/workflow-manager/api/proposals/';
const types={start:'开始',end:'结束',record:'读取触发记录',scan:'采购风险检查',filter:'筛选条目',branch:'条件分支',review:'人工审核',draft:'内部草稿',agent:'调用 Agent',summary:'汇总结果'};
const ports={next:'继续',yes:'满足',no:'不满足',approved:'通过',rejected:'拒绝'};
const roles={technical:'管理员或程序员',admin:'管理员',programmer:'程序员'};
const operators={eq:'等于',ne:'不等于',gt:'大于／晚于',gte:'大于等于',lt:'小于／早于',lte:'小于等于',contains:'包含',empty:'为空',notEmpty:'不为空',changed:'发生变化',unchanged:'没有变化',becameEmpty:'从有值变为空',becameSet:'从空变为有值'};
function conditionText(group,labels){if(!group.items.length)return'无额外筛选条件';return'（'+group.items.map(rule=>rule.mode?conditionText(rule,labels):(labels[rule.field]||rule.field)+' '+operators[rule.operator]+(rule.compare==='before'?' 修改前的值':rule.value!==undefined?' '+String(rule.value):'')).join(group.mode==='all'?' 且 ':' 或 ')+'）';}
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const svgEl=(tag,attributes={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;};
async function request(route,body){const response=await fetch(api+route,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),data=await response.json();if(!response.ok)throw new Error(data.error||'读取预览失败');return data;}
function graph(config){
 const nodes=new Map(config.nodes.map(n=>[n.id,n])),levels=new Map(),visit=id=>{if(levels.has(id))return levels.get(id);const incoming=config.edges.filter(e=>e.to===id);const rank=incoming.length?Math.max(...incoming.map(e=>visit(e.from)))+1:0;levels.set(id,rank);return rank;};
 for(const node of nodes.values())visit(node.id);
 const groups=new Map();for(const [id,rank]of levels){if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push(id);}
 const columns=Math.max(...[...groups.values()].map(ids=>ids.length)),width=Math.max(470,columns*240+100),positions=new Map();
 for(const [rank,ids]of groups)ids.forEach((id,i)=>positions.set(id,{x:(width-ids.length*240)/2+i*240+10,y:25+rank*100}));
 const height=120+Math.max(...levels.values())*100,svg=svgEl('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'工作流预览：'+config.nodes.map(n=>n.label).join('、')}),defs=svgEl('defs'),markerId='wp-arrow-'+crypto.randomUUID();
 const marker=svgEl('marker',{id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:6,markerHeight:6,orient:'auto-start-reverse'});marker.append(svgEl('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'#8b8b8b'}));defs.append(marker);svg.append(defs);
 for(const edge of config.edges){
  const from=positions.get(edge.from),to=positions.get(edge.to),split=['yes','approved'].includes(edge.port)?-44:['no','rejected'].includes(edge.port)?44:0,sx=from.x+110+split,sy=from.y+62,tx=to.x+110,ty=to.y,skip=levels.get(edge.to)-levels.get(edge.from)>1;
  const middle=(sy+ty)/2,outside=width-20;
  const d=skip?`M${sx},${sy} V${sy+17} H${outside} V${ty-18} H${tx} V${ty}`:`M${sx},${sy} C${sx},${middle} ${tx},${middle} ${tx},${ty}`;
  svg.append(svgEl('path',{d,class:'wp-edge','marker-end':`url(#${markerId})`}));
  if(edge.port!=='next'){const text=svgEl('text',{x:skip?outside-5:sx+(split<0?-8:8),y:skip?sy+36:sy+21,'text-anchor':skip||split<0?'end':'start',class:'wp-edge-label'});text.textContent=ports[edge.port];svg.append(text);}
 }
 for(const node of config.nodes){const p=positions.get(node.id),g=svgEl('g'),title=svgEl('title');title.textContent=node.label+' · '+types[node.type];g.append(title,svgEl('rect',{x:p.x,y:p.y,width:220,height:62,rx:11,class:'wp-node'+(node.type==='review'?' wp-review':'')}));const label=svgEl('text',{x:p.x+110,y:p.y+26,'text-anchor':'middle','font-size':13,'font-weight':550});label.textContent=node.label.length>16?node.label.slice(0,15)+'…':node.label;const type=svgEl('text',{x:p.x+110,y:p.y+46,'text-anchor':'middle','font-size':11});type.textContent=types[node.type];g.append(label,type);svg.append(g);}
 return svg;
}
function nodeDetail(node){const p=node.params;if(node.type==='review')return`审核标题：${p.title}\n审核范围：${roles[p.role]}${p.reviewerId?'；指定人员：'+p.reviewerId:''}；有效期：${p.maxAgeMinutes} 分钟\n${p.instructions||'核对后决定通过或拒绝。'}`;if(node.type==='agent')return`Agent：${p.agentId}\n${p.prompt}`;if(node.type==='summary')return p.title;if(node.type==='draft')return p.prefix||'生成内部草稿';if(node.type==='filter')return`欠数至少 ${p.minMissing}；供应商包含：${p.supplier||'不限'}`;if(node.type==='branch')return`${p.metric==='count'?'条目数':'欠数'} ${operators[p.operator]} ${p.threshold}`;return types[node.type];}
export async function renderWorkflowPreview(card,id){
 card.className='wp-card';card.setAttribute('aria-label','工作流预览');card.replaceChildren(el('p','正在读取流程预览…','wp-note'));
 try{
  let proposal=await request(id);const config=proposal.config,header=el('header');header.append(el('div','Agent 提案 · 请确认后保存','wp-eyebrow'),el('h3',config.name));if(config.description)header.append(el('p',config.description,'wp-note'));
  const trigger=config.nodes.find(n=>n.type==='start')?.params.trigger;header.append(el('p',!trigger||trigger.mode==='manual'?'触发方式：手动启动':`触发方式：${trigger.mode==='change'?'记录变化':'定时'} · ${proposal.sourceLabel||trigger.source}`,'wp-note'));
  const canvas=el('div',undefined,'wp-graph'),diagram=graph(config);diagram.style.maxWidth='390px';canvas.append(diagram);
  const details=el('details'),summary=el('summary','查看节点与触发条件');details.append(summary);
  if(trigger&&trigger.mode!=='manual'){const detail=el('div',undefined,'wp-detail'),labels=proposal.fieldLabels||{},scopeLabels={customerId:'客户',projectId:'项目',id:'记录',teamId:'业务小组'},scope=Object.entries(trigger.scope||{}).map(([key,value])=>scopeLabels[key]+'：'+value).join('；');detail.append(el('strong','触发条件'),el('p',`模块：${proposal.sourceLabel||trigger.source}\n数据对象：${trigger.dataset}\n范围：${scope||'当前登录人可见范围'}\n${trigger.mode==='schedule'?'每天 '+trigger.schedule.time+'（北京时间）':('发生'+trigger.events.map(e=>e==='created'?'新增':'修改').join('或'))}\n关注字段：${trigger.watchFields?.map(f=>labels[f]||f).join('、')||'全部可见字段'}（${trigger.watchMode==='all'?'全部变化':'任一变化'}）\n${conditionText(trigger.conditions,labels)}\n${trigger.transition==='enter'?'仅首次进入条件时触发':'每次满足条件时触发'}；按事件与记录去重，忽略工作流产生的变更。`));details.append(detail);}
  for(const node of config.nodes.filter(n=>!['start','end'].includes(n.type))){const detail=el('div',undefined,'wp-detail');detail.append(el('strong',node.label),el('p',nodeDetail(node)));details.append(detail);}
  const footer=el('footer'),status=el('p');status.setAttribute('role','status');const confirm=el('button','确认保存到 Workflows','wp-primary'),cancel=el('button','取消');confirm.type=cancel.type='button';
  const update=()=>{footer.replaceChildren(status);header.querySelector('.wp-eyebrow').textContent=proposal.status==='confirmed'?'Agent 提案 · 已确认保存':proposal.status==='cancelled'?'Agent 提案 · 已取消':'Agent 提案 · 请确认后保存';if(proposal.status==='confirmed'){status.textContent='已保存到 Workflows。打开工作流可继续编辑或发布。';const link=el('a','打开工作流','wp-link');link.href='/studio/workflow-manager/?edit='+encodeURIComponent(proposal.workflowId);footer.append(link);}else if(proposal.status==='cancelled'){status.textContent='已取消，本次预览没有创建工作流。';}else if(new Date(proposal.validUntil).getTime()<=Date.now()){status.textContent='预览已过期，请让 Agent 重新生成。';}else{status.textContent='确认前不会创建工作流。保存为草稿后，可在 Workflows 编辑与发布。';footer.append(confirm,cancel);}};
  const action=async type=>{confirm.disabled=cancel.disabled=true;status.removeAttribute('data-error');try{proposal=await request(id+'/'+type,{expectedVersionId:proposal.versionId});update();}catch(error){status.textContent=error.message;status.dataset.error='true';}finally{confirm.disabled=cancel.disabled=false;}};
  confirm.addEventListener('click',()=>action('confirm'));cancel.addEventListener('click',()=>action('cancel'));update();card.replaceChildren(header,canvas,details,footer);
 }catch(error){const message=el('p',error.message,'wp-note'),retry=el('button','重新读取');retry.addEventListener('click',()=>renderWorkflowPreview(card,id));card.replaceChildren(message,retry);}
}
const mounted=new WeakMap();
export function mountWorkflowPreviews(root){
 if(!/^\/studio\/agents\/[^/]+\//.test(location.pathname))return;
 for(const anchor of root.querySelectorAll('a[href]')){
  const url=new URL(anchor.href,location.origin),id=url.searchParams.get('id');
  if(url.origin!==location.origin||url.pathname!=='/studio/workflow-preview/'||!/^proposal-[\w-]+$/.test(id||''))continue;
  if(mounted.get(anchor)?.isConnected)continue;
  const card=el('section');mounted.set(anchor,card);(anchor.closest('p')||anchor).after(card);anchor.addEventListener('click',event=>{event.preventDefault();card.scrollIntoView({block:'nearest'});});void renderWorkflowPreview(card,id);
 }
}
if(location.pathname==='/studio/workflow-preview/'){
 const root=document.querySelector('#preview-root'),id=new URLSearchParams(location.search).get('id');if(root&&/^proposal-[\w-]+$/.test(id||'')){const card=el('section');root.append(card);void renderWorkflowPreview(card,id);}
}
