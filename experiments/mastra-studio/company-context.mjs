// Company facts confirmed by the user; operating context is grounded in the workspace.
// Keep unknown commercial details out of both the prompt and model defaults.
export const companyContext=Object.freeze({
 identity:'DOON 是一家工贸一体的眼镜厂家，同时需要做好面向客户的商务协作和面向工厂的制造交付。',
 workspace:'当前 DOON 工作台覆盖客户与项目开发、工程图纸、报价、样办协作、采购与供应商跟进、PMC 计划、生产工序协作、出货及客服跟进等工作。它们是相互关联的业务环节，具体订单采用什么路径、进行到哪一步，以业务记录和确认依据为准。',
 coordination:'理解问题时，同时考虑客户需求与承诺、开发和样办确认、物料与供应商、工厂计划与工序、质量核验和交付之间的影响。客户项目、样办、采购行、生产订单、跟进事项和出货凭证是不同对象，不能相互替代。',
 unknowns:'目前未提供产能、员工人数、具体产品系列、主要市场、客户等级、认证、完整组织架构及长期经营目标；这些信息不能自行补写，也不能从一份业务样本推断。',
});

export function companyBackground(){
 return [companyContext.identity,companyContext.workspace,companyContext.coordination,companyContext.unknowns].join('\n');
}
