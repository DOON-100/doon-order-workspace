const $=id=>document.getElementById(id),id=new URL(location.href).searchParams.get('id');
const purchase=location.pathname.startsWith('/studio/purchase-change/'),apiRoute='/studio/'+(purchase?'purchase':'process')+'-change/api';
const labels={type:'流程类型',id:'记录编号',version:'原记录版本',customerId:'关联客户',orderId:'关联订单',teamId:'业务小组',title:'事项名称',batch:'批次',ownerId:'执行负责人',responsibleId:'最终负责人',plannedDate:'计划日期',actualDate:'实际日期',status:'处理状态',inputBasis:'输入依据',inputVersion:'依据版本',outputEvidence:'结果证据',gateStatus:'关口判断',blocker:'阻塞原因',nextAction:'下一步',nextOwnerId:'下一步负责人',nextDueDate:'下一步期限',notes:'备注'};
let current=null,busy=false,uncertain=false;
const text=(tag,value,className)=>{const node=document.createElement(tag);node.textContent=value;if(className)node.className=className;return node;};
const empty=value=>value===undefined||value===null||value==='';
const valueText=value=>empty(value)?'未填写':typeof value==='object'?JSON.stringify(value,null,2):current?.references?.[value]?current.references[value]+'（'+value+'）':String(value);
function message(value,error=false){$('message').textContent=value;$('message').className=error?'error':'';}
function buttons(){
 const pending=current?.status==='pending'&&!current.expired,blocked=!!current?.basis?.unknowns?.length||!!current?.basis?.conflicts?.length;
 $('confirm').disabled=busy||uncertain||!pending||blocked||!$('approved').checked;
 $('cancel').disabled=busy||uncertain||current?.status!=='pending';$('refresh').disabled=busy;
 $('approved').disabled=busy||uncertain||!pending||blocked;
}
function field(name,value,before,label,compare=true){
 const row=text('div','', 'field'),caption=text('div',label||current?.fieldLabels?.[name]||labels[name]||name,'field-name');
 const changed=compare&&(current.before?JSON.stringify(value)!==JSON.stringify(before):!empty(value));if(changed){row.classList.add('changed');caption.append(text('span',current.before?'修改':'新增','tag'));}
 const cell=text('div',valueText(value),'field-value');if(changed&&current.before)cell.append(text('div','原值：'+valueText(before),'old'));
 row.append(caption,cell);return row;
}
function render(result){
 current=result;$('approved').checked=false;$('title').textContent=result.label+(purchase?'':' · '+(result.payload.id?'修改记录':'新增记录'));
 for(const name of ['summary','changes','basis'])$(name).hidden=false;
 $('summary').replaceChildren(text('p','状态：'+({pending:'待本人确认',confirmed:'已保存',cancelled:'已取消'}[result.status]||'待核查')),text('p','确认截止：'+new Date(result.expiresAt).toLocaleString('zh-CN')));
 if(result.receipt)$('summary').append(text('p','保存记录：'+result.receipt.recordId+' · 第 '+result.receipt.version+' 版'),text('p','执行时间：'+new Date(result.receipt.confirmedAt).toLocaleString('zh-CN')));
 const rows=[],blank=[];
 const append=(name,value,before,label)=>(empty(value)&&empty(before)?blank:rows).push(field(name,value,before,label));
 if(purchase){
  rows.push(field('id',result.payload.id,result.payload.id,'采购明细',false),field('unit',result.before?.unit,result.before?.unit,'计量单位',false));
  for(const [name,value] of Object.entries(result.payload)){
   if(name==='operation'||name==='id')continue;
   if(name==='fields')for(const [key,item] of Object.entries(value))append(key,item,result.before?.[key]);
   else rows.push(field(name,value,value,undefined,false));
  }
  if(result.effects){
   rows.push(text('h3',result.status==='confirmed'?'本次保存后的数量与状态':'确认后预计的数量与状态'));
   const display=(key,value)=>key==='lifecycle'?({active:'跟进中',archived:'已存档'}[value]||value):value===null?'待核对':value;
   for(const [key,value] of Object.entries(result.effects.after))if(!['promisedDate','expectedDate','nextFollowupDate','followupNote'].includes(key))rows.push(field(key,display(key,value),display(key,result.effects.before[key])));
  }
 }else for(const [name,value] of Object.entries(result.payload)){
  if(name==='details')for(const [key,detail] of Object.entries(value))append(key,detail,result.before?.details?.[key],result.detailFields.find(item=>item.key===key)?.label);
  else append(name,name==='type'?result.label:value,name==='type'&&result.before?result.label:result.before?.[name]);
 }
 if(blank.length){const more=text('details','');more.append(text('summary','其他未填写字段（'+blank.length+'）'),...blank);rows.push(more);}
 $('fields').replaceChildren(...rows);
 $('changes').querySelector('h2').textContent=result.status==='confirmed'?'本次保存的内容':'将保存的内容';
 const evidence=result.basis.sources.map(source=>text('div',(result.fieldLabels?.[source.field]||labels[source.field]||source.field)+'：'+source.reference+'\n位置：'+source.location,'source'));
 for(const value of result.basis.unknowns)evidence.push(text('p','待核查：'+value,'warning'));
 for(const value of result.basis.conflicts)evidence.push(text('p','冲突：'+value,'warning'));
 evidence.push(text('p','来源说明由提案提供，请核对原始依据；系统校验不代替业务判断。','hint'));$('evidence').replaceChildren(...evidence);
 $('review').hidden=result.status!=='pending';
 if(result.status==='confirmed'){
  const verified=result.currentRecord?.id===result.receipt?.recordId&&result.currentRecord.version>=result.receipt.version;
  message(verified?'已保存，并已回读核对记录。'+(result.currentRecord.version>result.receipt.version?' 此记录之后又有更新，请以中台当前版本为准。':''):'已有执行回执，但当前记录尚未回读成功，请人工核查。',!verified);
 }else if(result.status==='cancelled')message('本次变更已取消，没有执行这份提案。');
 else if(result.expired)message('预览已过期，请回到对话重新核对并生成预览。',true);
 else if(result.basis.unknowns.length||result.basis.conflicts.length)message('存在待核查项或冲突，不能确认。请核实后重新生成预览。',true);
 else message('尚未修改业务。请核对下方内容，再决定确认或取消。');
 buttons();
}
async function request(body){
 const response=await fetch(apiRoute+(body?'':'?id='+encodeURIComponent(id)),{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw Error(result.error||'当前无法读取或处理此变更。');return result;
}
async function load(){
 busy=true;buttons();try{const result=await request();uncertain=false;render(result);}catch(error){uncertain=true;message(error.message,true);}finally{busy=false;buttons();}
}
async function submit(operation){
 if(busy||uncertain||!current||operation==='confirm'&&$('confirm').disabled)return;
 busy=true;buttons();
 try{
  const result=await request({operation,id,digest:current.digest,...(operation==='confirm'?{approved:true}:{})});
  if(result.status==='uncertain'){uncertain=true;message(result.message,true);}else render(result);
 }catch(error){uncertain=true;message(error.message+' 请先查询当前状态，系统不会自动重试。',true);}
 finally{busy=false;buttons();}
}
$('approved').addEventListener('change',buttons);$('confirm').addEventListener('click',()=>submit('confirm'));$('cancel').addEventListener('click',()=>submit('cancel'));$('refresh').addEventListener('click',load);
if(/^[a-f0-9-]{36}$/i.test(id||''))void load();else{message('预览链接无效。',true);buttons();}
