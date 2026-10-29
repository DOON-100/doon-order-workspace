import {createHash} from 'node:crypto';

// Reuse the pinned OSS Studio composer (picker, paste, drag/drop, previews and
// draft recovery). Its sole file->message helper now uploads the original first.
// Fail closed after SDK changes instead of silently restoring unsupported files.
const originalSha='ce24cac9a5772fca86dfa28bdaacff00d412a54b0ddabd1e4ff5ca352c873181';
export function patchStudioDocumentUploads(source){
 const start=source.indexOf('gus=async e=>'),end=source.indexOf(',vus=',start);
 if(start<0||end<0||createHash('sha256').update(source.slice(start,end)).digest('hex')!==originalSha)throw Error('Pinned Studio attachment helper changed; review document integration');
 const replacement=`gus=async e=>{const n=t=>{if(typeof document==="undefined")return;document.getElementById("doon-attachment-notice")?.remove();const a=document.createElement("aside"),s=document.createElement("span"),b=document.createElement("button");a.id="doon-attachment-notice";a.setAttribute("role","alert");a.style.cssText="position:fixed;right:20px;bottom:20px;z-index:99999;max-width:480px;padding:16px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#111827;box-shadow:0 4px 18px #0003";s.textContent=t;b.textContent="关闭";b.style.cssText="margin-left:12px;text-decoration:underline";b.onclick=()=>a.remove();a.append(s,b);document.body.append(a)};try{if(e.isUrl||!e.file)throw new Error("请选择本机文件上传，不支持外部链接。");if(e.file.size>10485760)throw new Error("每个附件不能超过10 MiB。");const f=new FormData;f.set("file",e.file,e.name);const r=await fetch("/studio/documents/upload",{method:"POST",body:f,credentials:"same-origin"});const d=await r.json();if(!r.ok||typeof d.id!=="string"||!/^[a-f0-9-]{36}$/.test(d.id))throw new Error(d.error||"附件上传失败，请重试。");if(d.warnings?.length)n("附件提示："+d.warnings.join("；"));return{role:"user",content:[{type:"text",text:"\\n[DOON_ATTACHMENT:"+d.id+"]\\n"}]}}catch(t){n(t instanceof Error?t.message:"附件上传失败，请重试。");throw t}}`;
 return source.slice(0,start)+replacement+source.slice(end);
}
