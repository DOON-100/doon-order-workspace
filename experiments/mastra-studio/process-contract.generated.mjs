// Generated from committed middleware pure validation functions. Do not edit.
// Middleware commit: 35d441dbf250d28612e4b026f8d7fb932da0feb9
import { z } from 'zod';
export const clean = (x) => String(x ?? '').normalize('NFKC').trim();
export function strictDate(value, withTime = false) {
    const raw = clean(value);
    if (!raw)
        return '';
    const m = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?(?:\.\d+)?(?:Z|\+08:00)?$/);
    if (!m)
        throw new Error('日期格式应为 YYYY-MM-DD' + (withTime ? ' HH:mm:ss' : ''));
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    const test = new Date(Date.UTC(y, mo - 1, d));
    if (y < 2000 || y > 2100 || test.getUTCMonth() !== mo - 1 || test.getUTCDate() !== d || +(m[4] || 0) > 23 || +(m[5] || 0) > 59 || +(m[6] || 0) > 59)
        throw new Error('日期不存在或超出有效范围');
    const day = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (withTime && !m[4])
        throw new Error('报工时间必须包含时分秒');
    return withTime ? `${day} ${m[4].padStart(2, '0')}:${m[5].padStart(2, '0')}:${(m[6] || '0').padStart(2, '0')}` : day;
}
export const processKinds = ['rfq', 'sample', 'engineering-change', 'iqc', 'material-kit', 'warehouse', 'first-article', 'process-quality', 'outsourcing-quality', 'oqc', 'packaging', 'shipment-release', 'supplier-reconciliation', 'complaint'];
export const processStatuses = ['待处理', '进行中', '受阻', '待核实', '已完成', '已取消'];
export const processGateStatuses = ['待核实', '待检', '通过', '不通过', '不适用'];
const detail = (key, label, type = 'text') => ({ key, label, type });
const common = [detail('gateReason', '不适用或关口判断依据'), detail('documentRef', '单据引用')];
const inspection = [detail('inspectedQuantity', '检验数量', 'number'), detail('acceptedQuantity', '合格数量', 'number'), detail('rejectedQuantity', '不良数量', 'number'), detail('inspectionRef', '检验单引用'), detail('processName', '工序名称')];
export const processDetailFields = {
    rfq: [...common, detail('requirement', '客户要求'), detail('targetDelivery', '期望交期'), detail('quantity', '需求数量', 'number'), detail('currency', '币种'), detail('quoteRef', '报价引用')],
    sample: [...common, detail('sampleVersion', '样品版本'), detail('sampleQuantity', '样品数量', 'number'), detail('sampleResult', '样品结果'), detail('signoffRef', '签样凭证')],
    'engineering-change': [...common, detail('previousVersion', '原版本'), detail('newVersion', '新版本'), detail('changeReason', '变更原因'), detail('impactScope', '影响范围'), detail('approvalRef', '审批引用')],
    iqc: [...common, ...inspection, detail('supplierName', '供应商'), detail('lotNo', '来料批次')],
    'material-kit': [...common, detail('requiredQuantity', '需求数量', 'number'), detail('readyQuantity', '齐套数量', 'number'), detail('shortageNote', '缺料事项'), detail('materialListRef', '配料清单引用')],
    warehouse: [...common, detail('movementType', '流转类型'), detail('quantity', '流转数量', 'number'), detail('warehouseName', '仓库名称'), detail('sourceDocumentRef', '出入库单引用')],
    'first-article': [...common, ...inspection], 'process-quality': [...common, ...inspection],
    'outsourcing-quality': [...common, ...inspection, detail('supplierName', '供应商'), detail('lotNo', '外协批次')], oqc: [...common, ...inspection],
    packaging: [...common, detail('quantity', '包装数量', 'number'), detail('cartons', '箱数', 'number'), detail('packingSpec', '包装要求版本'), detail('packingListRef', '装箱单引用')],
    'shipment-release': [...common, detail('quantity', '出货数量', 'number'), detail('logisticsRef', '物流凭证'), detail('releaseRef', '实际放行单引用')],
    'supplier-reconciliation': [...common, detail('supplierName', '供应商'), detail('statementRef', '对账单引用'), detail('invoiceRef', '发票引用'), detail('currency', '币种'), detail('amount', '对账金额', 'number')],
    complaint: [...common, detail('complaintRef', '客诉引用'), detail('cause', '原因'), detail('correction', '纠正措施'), detail('verification', '验证结果'), detail('customerConfirmation', '客户确认')],
};
const text = (max = 3000) => z.string().trim().max(max).default('');
const day = z.string().trim().default('').superRefine((value, ctx) => { if (!value)
    return; try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || strictDate(value) !== value)
        throw new Error();
}
catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请使用有效日期 YYYY-MM-DD' });
} });
export const processSaveSchema = z.object({
    id: z.string().trim().min(1).max(160).optional(), version: z.number().int().positive().optional(), token: z.string().trim().min(8).max(160).optional(),
    type: z.enum(processKinds), customerId: text(160), orderId: text(160), teamId: text(160), title: z.string().trim().min(1, '请填写事项名称').max(240),
    batch: text(160), ownerId: text(160), responsibleId: text(160), plannedDate: day, actualDate: day, status: z.enum(processStatuses).default('待处理'),
    inputBasis: text(6000), inputVersion: text(240), outputEvidence: text(6000), gateStatus: z.enum(processGateStatuses).default('待核实'),
    blocker: text(6000), nextAction: text(3000), nextOwnerId: text(160), nextDueDate: day, notes: text(6000), details: z.record(z.unknown()).default({}),
}).strict();
export function processDetailsSchema(type) {
    const shape = {};
    for (const field of processDetailFields[type])
        shape[field.key] = field.type === 'number'
            ? (field.key === 'amount' ? z.number().finite().nonnegative().max(1000000000).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, '金额最多两位小数') : z.number().int().min(0).max(10000000)).optional()
            : text(field.key === 'currency' ? 12 : 3000);
    return z.object(shape).strict();
}
export function assertProcessCompletion(record) {
    const details = record.details;
    if (['iqc', 'first-article', 'process-quality', 'outsourcing-quality', 'oqc'].includes(record.type)) {
        const inspected = details.inspectedQuantity, accepted = details.acceptedQuantity, rejected = details.rejectedQuantity;
        if (typeof inspected === 'number' && typeof accepted === 'number' && typeof rejected === 'number' && accepted + rejected !== inspected)
            throw new Error('合格数量与不良数量之和必须等于检验数量。');
        if (typeof inspected === 'number' && [accepted, rejected].some(value => typeof value === 'number' && value > inspected))
            throw new Error('合格或不良数量不能超过检验数量。');
    }
    if (record.status === '受阻' && !record.blocker)
        throw new Error('受阻事项须填写阻塞原因。');
    if (record.gateStatus === '不适用' && !details.gateReason)
        throw new Error('关口不适用时须填写判断依据。');
    if (record.status !== '已完成')
        return;
    if (!record.actualDate || !record.outputEvidence || !record.ownerId || !record.responsibleId)
        throw new Error('完成前须填写实际完成日、结果证据、执行负责人及最终负责人。');
    if (record.blocker)
        throw new Error('仍有阻塞事项，不能标记已完成；请先核实并更新。');
    if (!['通过', '不适用'].includes(record.gateStatus))
        throw new Error('完成前须记录关口通过，或说明关口不适用的依据。');
    if (['iqc', 'first-article', 'process-quality', 'outsourcing-quality', 'oqc'].includes(record.type) && record.gateStatus === '通过'
        && ![details.inspectedQuantity, details.acceptedQuantity, details.rejectedQuantity].every(value => typeof value === 'number'))
        throw new Error('检验通过须填写检验、合格与不良数量。');
    if (record.type === 'material-kit' && record.gateStatus === '通过' && (typeof details.requiredQuantity !== 'number' || typeof details.readyQuantity !== 'number' || details.readyQuantity < details.requiredQuantity))
        throw new Error('齐料通过须填写需求数量与齐套数量，并确认已满足需求。');
    const required = { sample: ['sampleVersion', 'signoffRef'], 'engineering-change': ['newVersion', 'approvalRef', 'impactScope'], 'shipment-release': ['releaseRef'], complaint: ['cause', 'correction', 'verification'] };
    const missing = (required[record.type] || []).filter(key => !details[key]);
    if (missing.length)
        throw new Error('该流程完成前须填写：' + missing.map(key => processDetailFields[record.type].find(field => field.key === key)?.label || key).join('、') + '。');
}
