/** Entirely synthetic records. No application database or business files are read. */
export function createSyntheticState() {
  const at = '2026-10-15T00:00:00.000Z';
  const member = (id, name, role, customers, active = true) => ({
    id, kind: 'member', userId: id + '-user', email: id + '@example.invalid',
    name, role, customers, active, orderScope: 'assigned', createdAt: at,
    privateMarker: 'SYNTHETIC_MEMBER_PRIVATE',
  });
  const a = member('syn-employee-a', '合成员工甲', 'sales', ['合成客户甲']);
  const b = member('syn-employee-b', '合成员工乙', 'sales', ['合成客户乙']);
  const disabled = member('syn-disabled', '合成停用员工', 'sales', ['合成客户甲'], false);
  const supplier = {...member('syn-supplier', '合成供应商', 'supplier', ['合成客户甲']), supplierId: 'syn-supplier-company'};
  const customer = (suffix, owner) => ({
    id: 'syn-customer-' + suffix, kind: 'customer_account', customer: owner.customers[0],
    customerCode: 'SYN-' + suffix.toUpperCase(), salesName: owner.name, serviceName: '', pmcName: '',
    salesMemberIds: [owner.id], serviceMemberIds: [], quoteMemberIds: [],
    active: true, notes: 'SYNTHETIC_CUSTOMER_PRIVATE', version: 1,
    createdAt: at, updatedAt: at, updatedBy: 'synthetic-fixture',
  });
  const order = (suffix, owner, label, requestedDate, lifecycle = 'active') => ({
    id: `syn-order-${suffix}-${label}`, kind: 'order', version: 1,
    orderNo: `SYN-${suffix.toUpperCase()}-${label.toUpperCase()}`, customer: owner.customers[0],
    quantity: 120, requestedDate, plannedDate: label === 'overdue' ? '2026-10-09' : requestedDate ? '2026-10-25' : '',
    promisedDate: label === 'normal' || label === 'overdue' ? requestedDate : '',
    promiseConfirmed: label === 'normal' || label === 'overdue', stage: '生产中', lifecycle,
    ownerEmail: owner.email, customerPO: 'SYNTHETIC_PO_PRIVATE', drawing: 'SYNTHETIC_DRAWING_PRIVATE',
    color: '合成色', lens: '', batch: '', customerNote: 'SYNTHETIC_CUSTOMER_NOTE_PRIVATE',
    arrangement: '', notes: 'SYNTHETIC_ORDER_PRIVATE', sourceStatus: '',
    extra: {private: 'SYNTHETIC_EXTRA_PRIVATE'}, attachmentKey: 'SYNTHETIC_ATTACHMENT_KEY_PRIVATE',
    source: 'synthetic-only', createdAt: at, updatedAt: at, updatedBy: 'synthetic-fixture',
    ...(lifecycle === 'archived' ? {archivedAt: at, archiveReason: '合成已归档场景'} : {}),
  });
  const orders = [[a, 'a'], [b, 'b']].flatMap(([owner, suffix]) => [
    order(suffix, owner, 'normal', '2026-10-30'),
    order(suffix, owner, 'missing-date', ''),
    order(suffix, owner, 'overdue', '2026-10-10'),
    order(suffix, owner, 'archived', '2026-10-01', 'archived'),
  ]);
  return {revision: 1, records: [a, b, disabled, supplier, customer('a', a), customer('b', b), ...orders]};
}
