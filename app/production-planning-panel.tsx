'use client';

import {useState} from 'react';
import {ArrowRight,ArrowUpRight,ClipboardList,Factory,AlertCircle,FileBarChart2,Search,X} from 'lucide-react';
import type {WorkspaceNavigate} from '@/lib/handoff-navigation';
import {PRODUCTION_PLANNING_TITLE,productionPlanningSpaces} from '@/lib/production-planning';
import type {Data} from './workspace';
import './production-planning.css';

const areas=[
 {name:'订单与排程',detail:'接收订单需求，安排生产计划，跟进负责的订单。',icon:ClipboardList},
 {name:'齐料与生产执行',detail:'串联收货、工序录入、成品外发与 MES 核对。',icon:Factory},
 {name:'异常与交付',detail:'跟进欠数、异常和损耗，查阅已完成订单。',icon:AlertCircle},
 {name:'数据与报表',detail:'维护原始表格，查看和导出业务报表。',icon:FileBarChart2},
] as const;

const relatedSpaces=[
 {id:'factory-orders',label:'中英内部订单',detail:'查看内部订单与生产要求'},
 {id:'production-orders',label:'生产单',detail:'核对生产单及关联资料'},
] as const;

export function ProductionPlanningPanel({data,onNavigate}:{data:Data;onNavigate:WorkspaceNavigate}){
 const [search,setSearch]=useState('');
 const term=search.trim().toLocaleLowerCase();
 const visibleSpaces=productionPlanningSpaces.filter(space=>!term||[space.label,space.detail,space.area].join(' ').toLocaleLowerCase().includes(term));

 return <section className="production-planning-panel" data-production-planning>
  <header className="production-planning-hero">
   <div className="production-planning-intro">
    <span className="production-planning-eyebrow">生产计划 · 一级工作空间</span>
    <h1>{PRODUCTION_PLANNING_TITLE}</h1>
    <p>从订单接收到排期、齐料、生产执行与交付，集中进入各项生产计划工作。</p>
    <button type="button" className="production-planning-primary" onClick={()=>onNavigate('pmc')}>
     进入 PMC 排期总表 <ArrowUpRight size={17} aria-hidden="true"/>
    </button>
   </div>
   <div className="production-planning-count">
    <span>已纳入二级工作空间</span>
    <strong>{productionPlanningSpaces.length}<small>个</small></strong>
    <p>按生产协作环节集中办理</p>
   </div>
  </header>

  <div className="production-planning-toolbar">
   <div className="production-planning-directory-title">
    <h2>二级工作空间</h2>
    <p aria-live="polite">{term?`找到 ${visibleSpaces.length} 个空间`:`共 ${productionPlanningSpaces.length} 个空间 · 按业务环节排列`}</p>
   </div>
   <label className="production-planning-search">
    <Search size={17} aria-hidden="true"/>
    <input type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索工作空间、职责" aria-label="查找二级工作空间"/>
    {search&&<button type="button" className="production-planning-clear" aria-label="清除工作空间搜索" onClick={()=>setSearch('')}><X size={15} aria-hidden="true"/></button>}
   </label>
  </div>

  <div className="production-planning-groups">
   {areas.map((area,index)=>{
    const spaces=visibleSpaces.filter(space=>space.area===area.name);
    if(!spaces.length)return null;
    const Icon=area.icon;
    return <section className="production-planning-group" key={area.name} aria-labelledby={`production-planning-area-${index}`}>
     <div className="production-planning-group-head">
      <span className="production-planning-group-icon"><Icon size={19} aria-hidden="true"/></span>
      <div><h2 id={`production-planning-area-${index}`}>{area.name}<span className="production-planning-group-count">{spaces.length}</span></h2><p>{area.detail}</p></div>
      <span className="production-planning-step" aria-hidden="true">0{index+1}</span>
     </div>
     <div className="production-planning-space-grid">
      {spaces.map(space=><button type="button" className="production-planning-space" key={space.id} data-space-id={space.id} aria-label={'进入'+space.label} onClick={()=>onNavigate(space.id)}>
       <span className="production-planning-space-title">{space.label}<ArrowUpRight size={17} aria-hidden="true"/></span>
       <span className="production-planning-space-detail">{space.detail}</span>
       <span className="production-planning-space-action">进入工作空间 <ArrowRight size={14} aria-hidden="true"/></span>
      </button>)}
     </div>
    </section>;
   })}
   {!visibleSpaces.length&&<div className="production-planning-empty">
    <Search size={24} aria-hidden="true"/>
    <h3>没有匹配的工作空间</h3>
    <p>试试“排期”“收货”或“报表”，也可以清除搜索查看全部入口。</p>
    <button type="button" className="production-planning-reset" onClick={()=>setSearch('')}>查看全部工作空间</button>
   </div>}
  </div>

  <aside className="production-planning-related" aria-label="关联单据入口">
   <div><h2>关联单据</h2><p>生产计划的订单与资料依据</p></div>
   <div className="production-planning-related-links">
    {relatedSpaces.map(space=><button type="button" key={space.id} data-related-space-id={space.id} aria-label={'进入'+space.label} onClick={()=>onNavigate(space.id)}>
     <span><strong>{space.label}</strong><small>{space.detail}</small></span><ArrowUpRight size={17} aria-hidden="true"/>
    </button>)}
   </div>
  </aside>
  <p className="production-planning-member">当前成员：{data.me.name} · 进入各工作空间办理对应事项</p>
 </section>;
}
