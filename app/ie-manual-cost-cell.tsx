'use client';
import type {IeAdjustmentCell,IeManualAdjustment} from '@/lib/ie-quote-calculation';
import type {NumberValue} from './ie-quote-panel';
export type IeDraftAdjustment=Omit<IeManualAdjustment,'value'>&{value:NumberValue};
export type IeAdjustmentChange=(target:string,value:NumberValue,reason:string,sourceSignature:string)=>void;
const display=(value:number|null|undefined)=>value==null?'待确认':value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:6});
export function IeManualCostCell({cell,adjustment,editable,onChange,label}:{cell?:IeAdjustmentCell;adjustment?:IeDraftAdjustment;editable:boolean;onChange:IeAdjustmentChange;label?:string}){
 if(!cell)return <span className="ieq-manual-unavailable">待确认</span>;
 const title=label||cell.label,manual=!!adjustment,update=(value:NumberValue,reason:string)=>onChange(cell.target,value,reason,cell.sourceSignature),reason=adjustment?.reason||'';
 return <div className={'ieq-manual-cell'+(manual?' adjusted':'')+(cell.stale?' stale':'')}><div className="ieq-manual-number"><input aria-label={title+'金额'} type="number" min="0" step="any" disabled={!editable} value={manual?adjustment.value??'':cell.effectiveValue??''} placeholder="待确认" onChange={event=>update(event.target.value,reason)}/>{manual&&editable&&<button type="button" aria-label={title+'恢复自动计算'} title="清除人工金额，恢复自动计算" onClick={()=>update(null,'')}>↺</button>}</div><small>{manual?'人工调整 · ':'自动 · '}{manual?'自动参考 '+display(cell.automaticValue):editable?'可手工改价':'只读'}</small>{manual&&<><textarea rows={1} maxLength={1000} aria-label={title+'人工调整原因'} disabled={!editable} value={reason} placeholder="必填：人工调整原因" onChange={event=>onChange(cell.target,adjustment.value,event.target.value,adjustment.sourceSignature)}/>{!reason.trim()&&<small className="pending">请填写调整原因</small>}{cell.stale&&<div className="ieq-manual-stale"><span>相关输入已变动，当前按自动值核算</span>{editable&&<button type="button" disabled={!reason.trim()} onClick={()=>update(adjustment.value,reason)}>核对后重新确认此金额</button>}</div>}</>}</div>;
}
