'use client';
import type {ReactNode} from 'react';
import {departmentTabs,handoffNavigation,workspaceDepartment,departmentNavigationContext,type WorkspaceNavigationContext,type WorkspaceNavigate} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
const summaries:Record<string,string>={service:'从客户订单进入资料、部门交接和后续执行。','order-confirmations':'客户 PO、订单确认和 PI 对应同一笔业务。','engineering-materials':'需求接收、工程发布、客户确认和生产采用分别留痕。','production-orders':'从客服制单到 PMC 接收、备料、排期和各部门工序。','production-shipments':'登记实际完成批次和本次出库数量，衔接物流制单。','logistics-waybills':'按实际出货批次核对装箱、运输和签收资料。','finance-documents':'按客户、订单、项目和币种核对付款资料与结算。'};
export function DepartmentFrame({view,context,data,onNavigate,children}:{view:string;context:WorkspaceNavigationContext;data:Data;onNavigate:WorkspaceNavigate;children:ReactNode}){
 const group=workspaceDepartment(view),tabs=departmentTabs[group];
 if(!tabs||group==='settings')return <>{children}</>;
 const title=handoffNavigation.find(x=>x.id===group)?.label||'文本与单据处理';
 const visible=tabs.filter(t=>!['customer-quotes','customer-price-archive'].includes(t.view)||data.customerQuoteAccess===true);
 return <div className="department-workspace" data-department={group}><header className="handoff-page-head"><div><h2>{title}</h2><p>{summaries[group]||'从资料准备、内容核对到版本留存。'}</p></div></header>{visible.length>1&&<nav className="department-tabs" aria-label={title+'操作阶段'}>{visible.map(t=><button key={t.view} aria-current={view===t.view?'page':undefined} onClick={()=>{if(t.view!==view)onNavigate(t.view,departmentNavigationContext(context));}}><span>{t.label}</span><small>{t.phase}</small></button>)}</nav>}<div className="department-body">{children}</div></div>;
}
