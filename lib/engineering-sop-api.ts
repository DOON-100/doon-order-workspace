import {z} from 'zod';
import {all,newId,now,type Entity,type Member,type State} from './domain';
import {AppError,audit,bucket,commit,json} from './store';
import {sha} from './workbooks';
import {canManageDrawings,canApproveDrawings,canReadDrawing,type EngineeringDrawing} from './engineering-drawings';
import {advanceSop,canCreateSopChange,canInstructDrawing,canReadSop,planSopObligation,publicSop,publicSopAttachment,sopActionSchema,sopCreateSchema,sopDay,sopId,sopRevision,sopText,type EngineeringSop,type SopAttachment,type SopUpload} from './engineering-sop';

function parse<T extends z.ZodTypeAny>(schema:T,value:unknown):z.output<T>{const r=schema.safeParse(value);if(!r.success)throw new AppError(r.error.issues.slice(0,4).map(i=>`${i.path.join('.')||'内容'}：${i.message}`).join('；'));return r.data;}
function record(s:State,m:Member,id:string){const r=all(s,'engineering_sop').find(r=>r.id===id) as EngineeringSop|undefined;if(!r||!canReadSop(s,m,r))throw new AppError('SOP任务不存在或没有访问该客户的权限。',403);return r;}
function drawing(s:State,m:Member,id:string){const d=all(s,'engineering_drawing').find(r=>r.id===id) as EngineeringDrawing|undefined;if(!d||!canReadDrawing(s,m,d))throw new AppError('工程需求不存在或不在授权客户范围内。',403);if(!d.customerId)throw new AppError('请先为工程需求明确绑定客户，再建立SOP任务。');return d;}
function current(r:EngineeringSop,v:number){if(r.version!==v)throw new AppError('SOP任务已被更新，请刷新核对，本次没有覆盖。',409);if(!r.isCurrent)throw new AppError('此义务已有后续版本，请处理当前最新任务。',409);if(r.status==='已取消')throw new AppError('此SOP任务已取消。',409);}
function manage(m:Member){if(!canManageDrawings(m))throw new AppError('只有工程成员或管理员可准备SOP及登记实际MES上传。',403);}
function currentOpen(r:EngineeringSop){if(r.status==='已确认')throw new AppError('已确认版本不可改写，请发出新改图指令或建立新任务。',409);}
function proof(s:State,r:EngineeringSop,id:string,purpose:SopAttachment['purpose']){const a=all(s,'engineering_sop_attachment').find(a=>a.id===id&&a.sopId===r.id&&a.customerId===r.customerId&&a.purpose===purpose) as SopAttachment|undefined;if(!a)throw new AppError('请选择当前任务所属的'+(purpose==='sop'?'SOP文件':'MES上传凭证')+'，不能复用其他任务或客户的附件。');return a;}
async function exists(a:SopAttachment){const file=await bucket().get(a.fileKey);if(!file)throw new AppError('附件原文件不可用，请重新上传后核对。',409);}
async function persist(s:State,m:Member,r:EngineeringSop,before:EngineeringSop,action:string,extra:Entity[]=[]){await commit(s.revision,[r,sopRevision(r,m,action),audit(m,r,before,action,'工程SOP与MES跟进'),...extra]);return json({ok:true,record:publicSop(s,m,r),item:publicSop(s,m,r)});}
function stable(v:any):any{return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)])):v;}
const digest=(v:unknown)=>sha(JSON.stringify(stable(v)));
function validateMesUrl(value:string){if(!value)return;let url:URL;try{url=new URL(value);}catch{throw new AppError('MES位置链接须为完整的HTTP或HTTPS地址。');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||[...url.searchParams.keys()].some(k=>/^(token|access_token|password|secret|api_key|signature)$/i.test(k)))throw new AppError('MES链接不能包含本地路径、账号密码或访问密钥。');}

export async function engineeringSopGet(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['sop-data','sop-history','sop-file'].includes(action))return null;
 if(action==='sop-data'){
  const records=(all(s,'engineering_sop') as EngineeringSop[]).filter(r=>canReadSop(s,m,r)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),ids=new Set(records.map(r=>r.id));
  return json({records:records.map(r=>publicSop(s,m,r)),attachments:(all(s,'engineering_sop_attachment') as SopAttachment[]).filter(a=>ids.has(a.sopId)&&a.customerId===records.find(r=>r.id===a.sopId)?.customerId).map(publicSopAttachment),uploads:all(s,'engineering_sop_upload').filter(a=>ids.has(a.sopId)&&a.customerId===records.find(r=>r.id===a.sopId)?.customerId),canCreateChange:canCreateSopChange(s,m),canManage:canManageDrawings(m),canApprove:canApproveDrawings(m)});
 }
 const id=new URL(req.url).searchParams.get('id')||'';
 if(action==='sop-history'){const r=record(s,m,id);return json({history:all(s,'engineering_sop_revision').filter(h=>h.sopId===r.id&&h.snapshot&&canReadSop(s,m,h.snapshot)).sort((a,b)=>b.version-a.version),attachments:(all(s,'engineering_sop_attachment') as SopAttachment[]).filter(a=>a.sopId===r.id&&a.customerId===r.customerId).map(publicSopAttachment),uploads:all(s,'engineering_sop_upload').filter(a=>a.sopId===r.id&&a.customerId===r.customerId)});}
 const a=all(s,'engineering_sop_attachment').find(a=>a.id===id) as SopAttachment|undefined;if(!a)throw new AppError('附件不存在或没有访问权限。',403);const r=record(s,m,a.sopId);if(a.customerId!==r.customerId)throw new AppError('附件客户归属不一致。',403);const file=await bucket().get(a.fileKey);if(!file)throw new AppError('附件原文件暂不可用。',404);
 return new Response(file.body,{headers:{'Content-Type':a.contentType,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}

export async function engineeringSopPost(action:string,req:Request,s:State,m:Member):Promise<Response|null>{
 if(!['sop-change','sop-create','sop-target','sop-attachment','sop-prepare','sop-mes-upload','sop-confirm','sop-cancel'].includes(action))return null;
 if(action==='sop-attachment')return attachment(s,m,await req.formData());
 const body=await req.json();
 if(['sop-change','sop-create'].includes(action)){
  const input=parse(sopCreateSchema,body),d=drawing(s,m,input.drawingRecordId);if(action==='sop-change'){if(!canInstructDrawing(s,m,d))throw new AppError('只有该客户明确绑定的业务/客服或管理员可以发出改图指令。',403);}else manage(m);
  if(d.status==='已取消')throw new AppError('工程需求已取消，请先明确恢复或建立新需求。',409);
  const key=`sop_mutation_${await digest({actorId:m.id,token:input.token})}`,fingerprint=await digest({action,input}),previous=s.records.find(r=>r.id===key);
  if(previous){if(previous.fingerprint!==fingerprint)throw new AppError('操作标识已用于不同的SOP指令。',409);const r=record(s,m,previous.sopId);return json({ok:true,idempotent:true,record:publicSop(s,m,r),item:publicSop(s,m,r)});}
  let plan:ReturnType<typeof planSopObligation>;try{plan=planSopObligation(s,m,d,input,action==='sop-change'?'change_instruction':'mes_upload');}catch(e){throw new AppError((e as Error).message,409);}
  await commit(s.revision,[...plan.updates,{id:key,kind:'engineering_sop_mutation',sopId:plan.record.id,actorId:m.id,fingerprint,createdAt:now()},audit(m,plan.record,null,action==='sop-change'?'发出改图指令':'建立SOP上传MES任务','工程SOP与MES跟进')]);return json({ok:true,record:publicSop(s,m,plan.record),item:publicSop(s,m,plan.record)});
 }
 if(action==='sop-target'){
  const input=parse(sopActionSchema.extend({targetVersion:z.string().trim().min(1).max(120),modelNo:sopText(3000),note:z.string().trim().min(1).max(6000)}).strict(),body),before=record(s,m,input.id);current(before,input.version);currentOpen(before);
  const d=drawing(s,m,before.drawingRecordId);if(!canInstructDrawing(s,m,d)&&!canManageDrawings(m))throw new AppError('没有补充目标版本的权限。',403);
  if(before.sopFileId||before.latestUploadId||before.targetVersion&&input.targetVersion!==before.targetVersion)throw new AppError('已明确目标版本不可换成另一版本，请发出新的改图指令。',409);
  if(before.modelNo&&input.modelNo&&input.modelNo!==before.modelNo)throw new AppError('已明确款号不可更换，请建立新任务。',409);
  const modelNo=before.modelNo||input.modelNo;if(!modelNo)throw new AppError('请先补齐款号。');
  const matches=(all(s,'engineering_sop') as EngineeringSop[]).filter(r=>r.id!==before.id&&r.drawingRecordId===before.drawingRecordId&&r.modelNo===modelNo);
  if(matches.some(r=>r.status==='已确认'&&r.targetVersion===input.targetVersion))throw new AppError('该款号的目标版本已确认，请使用新版本。',409);
  const currentMatches=matches.filter(r=>r.isCurrent),prior=currentMatches[0];
  if(currentMatches.length>1||prior&&(before.modelNo||prior.createdAt>before.createdAt))throw new AppError('该款号已有更新的当前任务，请核对后从现有任务继续。',409);
  const confirmed=matches.filter(r=>r.status==='已确认').sort((a,b)=>b.confirmedAt.localeCompare(a.confirmedAt))[0],extra:Entity[]=[];
  if(prior){const old={...advanceSop(prior,m),isCurrent:false,supersededBy:before.id};extra.push(old,sopRevision(old,m,'改图指令明确款号后替代当前义务'));}
  const r={...advanceSop(before,m),modelNo,targetVersion:input.targetVersion,targetNote:input.note,predecessorId:prior?.id||before.predecessorId,currentVersion:confirmed?.targetVersion||prior?.currentVersion||before.currentVersion};return persist(s,m,r,before,'补充SOP款号与目标版本',extra);
 }
 if(action==='sop-prepare'){
  manage(m);const input=parse(sopActionSchema.extend({fileId:sopId,preparedVersion:z.string().trim().min(1).max(120),note:sopText(6000)}).strict(),body),before=record(s,m,input.id);current(before,input.version);currentOpen(before);
  if(!['待更新SOP','待上传MES'].includes(before.status))throw new AppError('已有MES上传登记，请先由审图人员退回后按实际情况重新登记，不能改换原上传SOP。',409);
  if(!before.modelNo||!before.targetVersion)throw new AppError('款号和目标版本尚未明确。');if(input.preparedVersion!==before.targetVersion)throw new AppError('SOP文件版本必须与目标版本完全一致。');
  const file=proof(s,before,input.fileId,'sop');await exists(file);const r={...advanceSop(before,m),sopFileId:file.id,preparedVersion:input.preparedVersion,status:'待上传MES' as const,latestUploadId:'',confirmationNote:'',confirmedBy:'',confirmedAt:'',preparationNote:input.note};return persist(s,m,r,before,'新版本SOP文件准备完成，待实际上传MES');
 }
 if(action==='sop-mes-upload'){
  manage(m);const input=parse(sopActionSchema.extend({uploadedVersion:z.string().trim().min(1).max(120),uploadedAt:sopDay,mesReference:sopText(800),mesUrl:sopText(2000),actualUploader:z.string().trim().min(1).max(160),proofFileId:sopId,note:sopText(6000)}).strict(),body),before=record(s,m,input.id);current(before,input.version);currentOpen(before);
  if(before.status!=='待上传MES')throw new AppError('请先准备目标版本SOP，再登记实际MES上传。');
  if(!before.targetVersion||before.preparedVersion!==before.targetVersion||input.uploadedVersion!==before.targetVersion)throw new AppError('实际MES上传版本、SOP文件版本与目标版本必须完全一致。');
  if(!input.mesReference&&!input.mesUrl)throw new AppError('须填写实际MES记录号或位置链接。');validateMesUrl(input.mesUrl);
  if(input.uploadedAt>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}))throw new AppError('实际上传日期不能晚于今天。');
  const file=proof(s,before,before.sopFileId,'sop'),evidence=proof(s,before,input.proofFileId,'mes_evidence');if(file.hash===evidence.hash)throw new AppError('MES上传凭证不能是SOP原文件，请提供实际MES上传记录或页面的独立证明。');await exists(file);await exists(evidence);
  const upload:SopUpload={id:newId('sop_upload'),kind:'engineering_sop_upload',sopId:before.id,customerId:before.customerId,targetVersion:before.targetVersion,uploadedVersion:input.uploadedVersion,uploadedAt:input.uploadedAt,mesReference:input.mesReference,mesUrl:input.mesUrl,actualUploader:input.actualUploader,proofFileId:evidence.id,proofHash:evidence.hash,sopFileId:file.id,sopHash:file.hash,note:input.note,actorId:m.id,actor:m.name,createdAt:now(),method:'manual_evidence'};
  const r={...advanceSop(before,m),latestUploadId:upload.id,status:'待确认' as const,confirmationNote:'',confirmedBy:'',confirmedAt:''};return persist(s,m,r,before,'登记实际MES上传凭证（待独立确认）',[upload]);
 }
 if(action==='sop-confirm'){
  if(!canApproveDrawings(m))throw new AppError('只有明确授权的工程审图人员或管理员可以确认MES上传。',403);
  const input=parse(sopActionSchema.extend({decision:z.enum(['confirm','return']),note:z.string().trim().min(1).max(6000)}).strict(),body),before=record(s,m,input.id);current(before,input.version);currentOpen(before);
  if(before.status!=='待确认')throw new AppError('尚无待确认的实际MES上传记录，不能直接确认。');
  const upload=all(s,'engineering_sop_upload').find(u=>u.id===before.latestUploadId&&u.sopId===before.id&&u.customerId===before.customerId) as SopUpload|undefined;
  if(!upload)throw new AppError('实际MES上传记录不存在。',409);
  if(input.decision==='confirm'){
   if(upload.actorId===m.id)throw new AppError('上传登记人不能确认自己的MES上传，请另一名授权审图人员独立核对。',403);
   if(!before.targetVersion||upload.method!=='manual_evidence'||upload.targetVersion!==before.targetVersion||upload.uploadedVersion!==before.targetVersion||before.preparedVersion!==before.targetVersion||upload.sopFileId!==before.sopFileId||!upload.actualUploader||!upload.uploadedAt||!upload.mesReference&&!upload.mesUrl)throw new AppError('MES上传记录与当前目标版本不一致或凭证不完整。',409);
   const file=proof(s,before,before.sopFileId,'sop'),evidence=proof(s,before,upload.proofFileId,'mes_evidence');if(file.hash===evidence.hash||file.hash!==upload.sopHash||evidence.hash!==upload.proofHash)throw new AppError('SOP与MES独立凭证的内容标识异常，请重新核对。',409);await exists(file);await exists(evidence);
  }
  const r={...advanceSop(before,m),status:input.decision==='confirm'?'已确认' as const:'待上传MES' as const,currentVersion:input.decision==='confirm'?before.targetVersion:before.currentVersion,confirmationNote:input.note,confirmedBy:input.decision==='confirm'?m.id:'',confirmedAt:input.decision==='confirm'?now():''};
  const decision={id:newId('sop_confirmation'),kind:'engineering_sop_confirmation',sopId:r.id,customerId:r.customerId,uploadId:upload.id,targetVersion:r.targetVersion,decision:input.decision,note:input.note,actorId:m.id,actor:m.name,createdAt:now()};return persist(s,m,r,before,input.decision==='confirm'?'独立确认目标版本已实际上传MES':'退回MES上传登记',[decision]);
 }
 manage(m);const input=parse(sopActionSchema.extend({note:z.string().trim().min(1).max(6000)}).strict(),body),before=record(s,m,input.id);current(before,input.version);currentOpen(before);const r={...advanceSop(before,m),status:'已取消' as const,cancelNote:input.note};return persist(s,m,r,before,'取消SOP任务');
}

async function attachment(s:State,m:Member,form:FormData){
 manage(m);const sopId=parse(z.string().min(1).max(800),form.get('sopId')),purpose=parse(z.enum(['sop','mes_evidence']),form.get('purpose')),r=record(s,m,sopId);if(!r.isCurrent||['已取消','已确认'].includes(r.status))throw new AppError('只能为当前未关闭的任务补充附件。',409);
 const file=form.get('file');if(!(file instanceof File)||!file.size||file.size>10*1024*1024)throw new AppError('请上传非空且不超过10MB的PDF、PNG或JPEG文件。');const bytes=await file.arrayBuffer(),u=new Uint8Array(bytes);
 const pdf=u.length>=5&&[37,80,68,70,45].every((v,i)=>u[i]===v),png=u.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>u[i]===v),jpeg=u.length>=3&&u[0]===255&&u[1]===216&&u[2]===255;
 if(!(pdf&&/\.pdf$/i.test(file.name)||png&&/\.png$/i.test(file.name)||jpeg&&/\.jpe?g$/i.test(file.name)))throw new AppError('文件扩展名与PDF、PNG或JPEG内容标识不一致。');
 const a:SopAttachment={id:newId('sop_file'),kind:'engineering_sop_attachment',sopId:r.id,customerId:r.customerId,purpose,filename:file.name.replace(/[\\/\r\n]/g,'_').slice(0,180),fileKey:newId('engineering_sop_object'),contentType:pdf?'application/pdf':png?'image/png':'image/jpeg',size:file.size,hash:await sha(bytes),actorId:m.id,createdAt:now()};
 await bucket().put(a.fileKey,bytes);await commit(s.revision,[a,audit(m,a,null,purpose==='sop'?'保存SOP附件（尚未上传MES）':'保存实际MES上传凭证附件','工程SOP与MES跟进')]);return json({ok:true,attachment:publicSopAttachment(a),item:publicSopAttachment(a)});
}
