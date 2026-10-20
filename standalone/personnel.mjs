export const personnelTypes=['internal','external'];
export const personnelTypeLabels={internal:'内部员工',external:'外部人员'};

// Preserve legacy membership records. Suppliers are always external; all other
// legacy accounts retain the explicitly agreed internal default without a rewrite.
export function personnelTypeOf(member){
 if(!member||member.role==='supplier')return 'external';
 if(member.personnelType===undefined)return 'internal';
 return member.personnelType==='internal'?'internal':'external';
}
