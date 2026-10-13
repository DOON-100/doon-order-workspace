'use client';
import {FileText,ArrowUpRight,ShieldCheck} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Empty} from './ui';
import type {Data} from './workspace';
import './upgrade-workspace.css';

const documents=[
 {title:'销售报价',source:'工程报价与客户需求',check:'负责销售确认最终价格、币种与条款，保留已确认版本。',view:'customer-quotes',label:'客户报价',quote:true},
 {title:'PI 与项目费用',source:'客户正式订单、项目轮次与已确认报价',check:'在对应项目核对明细、数量和付款条件；项目费用不等于大货订单定金。',view:'customer-projects',label:'客户项目开发'},
 {title:'出货、Invoice 与装箱资料',source:'本批实际出货、有效 PI 与收货信息',check:'本批数量与整单应收分别核对；缺少箱数、重量、地址或来源时先补齐。',view:'service',label:'客服订单与出货'},
 {title:'应收与收款核实',source:'正式到账、分配、冲销与退款记录',check:'按客户、项目和币种核对。凭证上传不代表实际到账，内部核对不代表对客请款。',view:'customer-projects',label:'项目收款与费用'},
 {title:'工程图纸与版本',source:'工程部门发布、客户确认及生产采用记录',check:'保留原图与历史版本，分别核对工程发布、客户确认和生产采用状态。',view:'engineering-drawings',label:'工程画图部门'},
 {title:'内部订单与生产交接',source:'客户原文、中文工艺与 PMC 补充资料',check:'沿用客服确认、PMC 核对和下发流程，保留全部版本与交接记录。',view:'factory-orders',label:'中英内部订单'},
] as const;

export function DocumentCenterPanel({data,onNavigate}:{data:Data;onNavigate:(view:string)=>void}){
 return <div className="upgrade-space"><section className="panel section-pad upgrade-intro"><span className="upgrade-eyebrow">文本与单据</span><h2>从业务来源进入单据</h2><p>选定客户、项目或订单，在对应业务窗口核对来源、编辑和确认。既有模板、历史版本和附件继续保留。</p><div className="upgrade-info"><ShieldCheck size={18}/><span>按原有报价、项目和财务权限操作。邮件、WhatsApp 暂未接通。</span></div></section><section className="panel"><div className="upgrade-document-list">{documents.filter(item=>!('quote' in item)||data.customerQuoteAccess===true).map(item=><article key={item.title}><div className="upgrade-document-icon"><FileText size={22}/></div><div><h3>{item.title}</h3><p><strong>来源：</strong>{item.source}</p><p>{item.check}</p></div><Button variant="outline" onClick={()=>onNavigate(item.view)}>{item.label}<ArrowUpRight size={16}/></Button></article>)}</div></section><section className="panel section-pad"><h3>正式模板与来源核对</h3><p className="subtitle">客户报价模板和金蝶模板继续在原入口维护。其他单据须在对应业务中检查现有支持范围；未确认的模板与字段映射不会自动套用。</p><div className="row-actions mt-4"><Button variant="outline" onClick={()=>onNavigate('customers')}>客户档案与模板</Button><Button variant="outline" onClick={()=>onNavigate('business-rules')}>查看制单与审核规则</Button></div></section></div>;
}

export function ChannelPendingPanel({channel,onNavigate}:{channel:'邮箱'|'WhatsApp';onNavigate:(view:string)=>void}){
 return <section className="panel section-pad upgrade-space"><Empty title={`${channel}尚未接通`} detail="本期保留渠道入口，不读取账号、不收取新消息、不发送内容。已有邮件来源和沟通历史仍在客户项目中保留。"><div className="row-actions mt-4"><Button onClick={()=>onNavigate('communications')}>进入统一沟通</Button><Button variant="outline" onClick={()=>onNavigate('customer-projects')}>查看客户项目与历史跟进</Button></div></Empty></section>;
}
