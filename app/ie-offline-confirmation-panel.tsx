'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {dateTime} from './ui';
import {IE_OFFLINE_CONFIRMED_LABEL,isIeOfflineConfirmed,type IeOfflineConfirmation,type IeOfflineConfirmationAttachment} from './ie-quote-confirmation';
import './ie-offline-confirmation.css';

type ConfirmationQuote={id?:string;version?:number;status:string;offlineConfirmation?:IeOfflineConfirmation|null;canRegisterOfflineConfirmation?:boolean;offlineConfirmationAttachments?:IeOfflineConfirmationAttachment[]};
export function IeOfflineConfirmationPanel({quote,dirty,historical,disabled,onRegister,onDirtyChange}:{quote:ConfirmationQuote;dirty:boolean;historical:boolean;disabled:boolean;onRegister:(values:{attachmentId:string;evidence:string})=>Promise<void>;onDirtyChange:(dirty:boolean)=>void}){
 const [attachmentId,setAttachmentId]=useState(''),[evidence,setEvidence]=useState('');
 const confirmation=quote.offlineConfirmation,confirmed=isIeOfflineConfirmed(quote,dirty),attachments=quote.offlineConfirmationAttachments||[];
 useEffect(()=>{setAttachmentId('');setEvidence('');},[quote.id,quote.version,confirmation?.id]);
 useEffect(()=>{onDirtyChange(!!attachmentId||!!evidence.trim());},[attachmentId,evidence,onDirtyChange]);
 useEffect(()=>()=>onDirtyChange(false),[onDirtyChange]);
 const ready=!!quote.id&&!!quote.canRegisterOfflineConfirmation&&!confirmed&&!dirty&&!historical&&!disabled&&!!evidence.trim()&&attachments.some(item=>item.id===attachmentId);
 const register=async()=>{if(!ready)return;await onRegister({attachmentId,evidence:evidence.trim()});};
 if(!quote.id||!confirmation&&!quote.canRegisterOfflineConfirmation)return null;
 return <section className="ieq-offline-confirmation" aria-label="工程主管线下确认">
  <h3>{confirmed?IE_OFFLINE_CONFIRMED_LABEL:'工程主管线下确认登记'}</h3>
  {confirmed&&confirmation?<><p>本次确认对应工程报价 V{confirmation.quoteVersion}。继续修改并保存新版本后，原确认保留在历史记录，新版本需重新登记确认。</p><details><summary>查看确认依据和登记详情</summary><dl><dt>确认角色</dt><dd>工程主管（线下确认）</dd><dt>登记人</dt><dd>{confirmation.recordedBy}</dd><dt>登记时间</dt><dd>{dateTime(confirmation.recordedAt)}</dd><dt>报价内容校验值</dt><dd>{confirmation.contentSha256}</dd><dt>原件校验值</dt><dd>{confirmation.attachmentSha256}</dd><dt>确认依据</dt><dd className="ieq-offline-evidence">{confirmation.evidence}</dd></dl></details></>:<>
   {confirmation&&dirty&&<p role="status">当前填写已修改；原线下确认对应上次保存版本。保存新版本后请重新登记确认。</p>}
   {!historical&&quote.canRegisterOfflineConfirmation&&<><p>将工程主管已在线下确认的事实登记到当前保存版本。选择本报价已上传的最终 Excel 原件，并填写确认依据；系统记录本次登记账号与时间。</p>{!attachments.length&&<p className="ieq-help">请先在本报价的“附件与沟通”上传最终 Excel 原件，再重新读取报价。</p>}{dirty&&<p role="status">请先保存当前报价，再登记对应版本的线下确认。</p>}<fieldset disabled={disabled||dirty||historical}><label className="ieq-field"><span>最终 Excel 原件</span><select aria-label="线下确认最终Excel原件" value={attachmentId} onChange={event=>setAttachmentId(event.target.value)}><option value="">选择已关联的最终原件</option>{attachments.map(item=><option key={item.id} value={item.id}>{item.originalName} · {(item.size/1024/1024).toFixed(2)} MB</option>)}</select></label><label className="ieq-field"><span>主管已确认的依据</span><textarea aria-label="主管已确认的依据" rows={3} maxLength={4000} value={evidence} onChange={event=>setEvidence(event.target.value)} placeholder="记录已完成的线下确认及最终原件依据"/></label><Button type="button" disabled={!ready} onClick={()=>void register()}>登记主管已确认</Button></fieldset></>}
  </>}
 </section>;
}
