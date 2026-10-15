import {createHash} from 'node:crypto';
import {sourceDigest} from './policy.mjs';
import {draftForOrder} from './rules.mjs';

export function recordSuggestion({adapter,store,actorId,sourceId,sourceVersion,rule,runId}) {
  const actor=adapter.actor(actorId), order=adapter.getOrder(actorId,sourceId);
  if (order.version!==sourceVersion) throw new Error('订单版本已变化');
  const draft=draftForOrder(order);
  if (!draft || draft.rule!==rule) throw new Error('建议没有对应的来源依据');
  const digest=sourceDigest(order);
  const id='syn-suggestion-'+createHash('sha256').update(`${actorId}|${order.id}|${digest}|${rule}`).digest('hex').slice(0,24);
  const item={id,actorId,...draft,assigneeName:actor.name,status:'suggested',source:{id:order.id,version:order.version,orderNo:order.orderNo,customer:order.customer},sourceDigest:digest,createdAt:order.observedAt,runId};
  return {id,created:store.add(item)};
}
export function visibleSuggestions(adapter,store,actorId) {
  adapter.actor(actorId);
  const items=[];
  for(const row of store.list(actorId)) {
    let order;
    try {order=adapter.getOrder(actorId,row.source.id);} catch(error) {if(error.status===404 || error.statusCode===404)continue;throw error;}
    const {actorId:_actor,sourceDigest:storedDigest,rule:_rule,...dto}=row;
    if (order.version!==row.source.version || sourceDigest(order)!==storedDigest) {
      items.push({...dto,title:'来源已更新，需重新生成',reason:'',suggestedAction:'',status:'stale',source:{id:order.id,version:order.version,orderNo:order.orderNo,customer:order.customer}});
    } else items.push(dto);
  }
  return items;
}
