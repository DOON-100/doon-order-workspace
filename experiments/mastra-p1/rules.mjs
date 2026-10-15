// Deterministic business facts; the mock model selects among these reviewable drafts.
export function draftForOrder(order,today='2026-10-15') {
  if (order.lifecycle==='archived') return null;
  if (!order.promisedDate || !order.promiseConfirmed) return {
    rule:'confirm-date',title:`核对 ${order.orderNo} 的回复交期`,
    reason:order.promisedDate?`当前回复交期为 ${order.promisedDate}，尚未确认。`:'当前订单尚未填写回复交期。',
    suggestedAction:'请负责人核对可承诺日期，再按现有业务流程处理。',
  };
  if (order.plannedDate && order.plannedDate>order.promisedDate) return {
    rule:'review-plan',title:`核对 ${order.orderNo} 的计划与交期`,
    reason:`预计完工日 ${order.plannedDate} 晚于回复交期 ${order.promisedDate}。`,
    suggestedAction:'请负责人核对排期差异与当前进度，确认是否需要跟进。',
  };
  if (order.promisedDate<today) return {
    rule:'review-past-date',title:`跟进 ${order.orderNo} 的当前进度`,
    reason:`回复交期 ${order.promisedDate} 已早于本次合成检查日期 ${today}。`,
    suggestedAction:'请负责人核对实际履约情况；此建议不代表已确认交付延误。',
  };
  return null;
}
