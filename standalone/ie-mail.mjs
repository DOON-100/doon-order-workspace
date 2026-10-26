import {createHash} from 'node:crypto';

const email=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function baseUrl(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||['localhost','127.0.0.1','[::1]','0.0.0.0'].includes(u.hostname))return '';return u.origin;}catch{return '';}}
const safeEmail=value=>typeof value==='string'&&email.test(value)&&!/[\r\n\0]/.test(value)&&!/@(?:.*\.)?(?:local|invalid|localhost|example|test)$/i.test(value);
/** The SMTP endpoint and encryption mode are fixed to Tencent enterprise mail.
 * Browser requests never choose hosts, credentials, files, URLs or from headers.
 * The default instance is disabled unless the host owner configures every field. */
export function createIeMailAdapter(environment=process.env,dependencies={}){
 const from=String(environment.DOON_IE_MAIL_FROM||'').trim().toLowerCase(),password=String(environment.DOON_IE_MAIL_AUTH_CODE||''),workspaceBaseUrl=baseUrl(environment.DOON_IE_WORKSPACE_URL||''),enabled=environment.DOON_IE_MAIL_ENABLED==='1';
 const configured=enabled&&safeEmail(from)&&!!password&&!!workspaceBaseUrl;
 const createTransport=dependencies.createTransport|| (async options=>(await import('nodemailer')).default.createTransport(options));
 return {configured,from:safeEmail(from)?from:'',workspaceBaseUrl,async send(payload){
  if(!configured)return {status:'failed',message:'邮件通道未配置完整；未发送。'};
  const recipients=[...(payload.to||[]),...(payload.cc||[])],attachments=payload.attachments||[];
  if(!payload.to?.length||recipients.length>100||recipients.some(v=>!safeEmail(v))||new Set(recipients.map(v=>v.toLowerCase())).size!==recipients.length||typeof payload.subject!=='string'||/[\r\n\0]/.test(payload.subject)||payload.subject.length>500||typeof payload.body!=='string'||payload.body.length>100000||!/^[-a-zA-Z0-9_]{8,160}$/.test(payload.idempotencyKey||''))return {status:'failed',message:'邮件载荷未通过校验；未发送。'};
  if(attachments.length!==1||attachments.some(a=>!a||a.contentType!=='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||!(a.bytes instanceof Uint8Array)||a.bytes.byteLength===0||a.bytes.byteLength>15*1024*1024||sha(a.bytes)!==a.sha256||typeof a.filename!=='string'||!a.filename.toLowerCase().endsWith('.xlsx')||/[\\/\r\n\0]/.test(a.filename)))return {status:'failed',message:'工程报价附件未通过完整性校验；未发送。'};
  const id=sha(payload.idempotencyKey),messageId=`<ie-${id}@${from.split('@')[1]}>`;
  let transport;
  try{
   transport=await createTransport({host:'smtp.exmail.qq.com',port:465,secure:true,auth:{user:from,pass:password},tls:{minVersion:'TLSv1.2',rejectUnauthorized:true},connectionTimeout:15000,greetingTimeout:15000,socketTimeout:45000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
   const result=await transport.sendMail({from,to:payload.to,cc:payload.cc||[],subject:payload.subject,text:payload.body,messageId,envelope:{from,to:recipients},attachments:attachments.map(a=>({filename:a.filename,contentType:a.contentType,content:Buffer.from(a.bytes)})),disableFileAccess:true,disableUrlAccess:true});
   const accepted=new Set((result.accepted||[]).map(v=>String(v).toLowerCase())),rejected=result.rejected||[];
   if(!rejected.length&&recipients.every(v=>accepted.has(v.toLowerCase())))return {status:'sent',providerMessageId:messageId,message:'邮件服务器已接受全部收件人；不代表收件人已阅读。'};
   if(!accepted.size&&rejected.length===recipients.length)return {status:'failed',providerMessageId:messageId,message:'邮件服务器未接受收件人；请核对邮箱后重新预览。'};
   return {status:'unknown',providerMessageId:messageId,message:'仅部分收件人被服务器接受，请人工核查，禁止直接重复发送。'};
  }catch(error){
   // Auth/connection/greeting failures are known to precede SMTP DATA. Once
   // message transfer may have started, a timeout cannot prove non-delivery.
   const preSend=['EAUTH','EDNS','ECONNREFUSED','ETLS','EENVELOPE'].includes(error?.code)||['ECONNECTION','ETIMEDOUT'].includes(error?.code)&&['CONN','AUTH'].includes(error?.command);
   return {status:preSend?'failed':'unknown',providerMessageId:messageId,message:preSend?'连接、认证或收件地址验证失败；请由管理员检查邮件配置。':'发送结果不确定，请核查邮箱发信记录；系统不会自动重发。'};
  }finally{try{transport?.close?.();}catch{}}
 }};
}
