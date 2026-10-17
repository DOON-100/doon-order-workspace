'use client';
import {useState} from 'react';
import {ArrowUpRight,Search} from 'lucide-react';
import {existingBusinessTools} from '@/lib/handoff-navigation';
import type {Data} from './workspace';
import {Input,Empty} from './ui';
import {FixedDataToolsPanel} from './fixed-data-tools-panel';

export function BusinessToolsPanel({data,onNavigate,maintenanceAvailable}:{data:Data;onNavigate:(view:string)=>void;maintenanceAvailable:boolean}){
 const [search,setSearch]=useState('');
 const entries=existingBusinessTools.filter(x=>(!['customer-quotes','customer-price-archive'].includes(x.id)||data.customerQuoteAccess===true)&&(x.id!=='maintenance'||maintenanceAvailable&&['admin','programmer'].includes(data.me.role))&&(!search||[x.label,x.detail,x.group].join(' ').includes(search.trim())));
 return <div className="handoff-tools"><header className="handoff-page-head"><div><h2>业务工具</h2><p>订单、生产、导入和历史记录的操作入口。</p></div><label className="search"><Search size={16}/><Input aria-label="搜索业务工具" value={search} onChange={e=>setSearch(e.target.value)} placeholder="名称或用途"/></label></header><FixedDataToolsPanel data={data}/>{entries.length?[...new Set(entries.map(x=>x.group))].map(group=><section key={group}><h3>{group}</h3><div className="handoff-tool-grid">{entries.filter(x=>x.group===group).map(x=><button key={x.id} onClick={()=>onNavigate(x.id)}><span><b>{x.label}</b><ArrowUpRight size={16}/></span><small>{x.detail}</small></button>)}</div></section>):<Empty title="没有匹配的业务工具" detail="请调整搜索关键词。"/>}</div>;
}
