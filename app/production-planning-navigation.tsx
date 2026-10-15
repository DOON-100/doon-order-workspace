'use client';
import {useEffect,useState} from 'react';
import {ChevronDown,type LucideIcon} from 'lucide-react';
import {SidebarMenu,SidebarMenuItem,SidebarMenuButton} from '@/components/ui/sidebar';
import {isHandoffDocumentView,type WorkspaceNavigate} from '@/lib/handoff-navigation';
import {productionPlanningNavigation,isProductionPlanningView,PRODUCTION_PLANNING_ID,PRODUCTION_PLANNING_TITLE,type PlanningNavigationItem} from '@/lib/production-planning';
import type {Member} from '@/lib/domain';
import './production-planning-navigation.css';

export function ProductionPlanningNavigation({items,member,view,activeView,icons,onNavigate}:{items:readonly PlanningNavigationItem[];member?:Member;view:string;activeView:string;icons:Record<string,LucideIcon>;onNavigate:WorkspaceNavigate}){
 const [expanded,setExpanded]=useState(()=>isProductionPlanningView(view));
 useEffect(()=>{if(isProductionPlanningView(view))setExpanded(true);},[view]);
 const navigation=productionPlanningNavigation(items,member);
 const button=(item:PlanningNavigationItem)=>{const Icon=icons[item.icon];return <SidebarMenuButton className={'nav-item '+(activeView===item.id||view===item.id?'active':'')} aria-current={activeView===item.id||view===item.id?'page':undefined} data-nav-id={item.id} data-branch-active={item.id===PRODUCTION_PLANNING_ID?view!==PRODUCTION_PLANNING_ID&&isProductionPlanningView(view):item.id==='service'&&isHandoffDocumentView(view)} onClick={()=>onNavigate(item.id)}><Icon size={16}/><span>{item.label}</span></SidebarMenuButton>;};
 return <nav aria-label="中台主导航"><SidebarMenu>{navigation.map((item,index)=><SidebarMenuItem key={item.id} className={item.children?'production-planning-nav-parent':item.parent?'nav-child':undefined}>{(index===0||navigation[index-1].group!==item.group)&&<div className="upgrade-nav-label">{item.group}</div>}{item.children?<><div className="production-planning-nav-heading">{button(item)}<button type="button" className="production-planning-nav-toggle" aria-label={(expanded?'收起':'展开')+PRODUCTION_PLANNING_TITLE} aria-expanded={expanded} aria-controls="production-planning-spaces" onClick={()=>setExpanded(value=>!value)}><ChevronDown size={15}/></button></div><div id="production-planning-spaces" hidden={!expanded}><SidebarMenu>{item.children.map(child=><SidebarMenuItem className="nav-child" key={child.id}>{button(child)}</SidebarMenuItem>)}</SidebarMenu></div></>:button(item)}</SidebarMenuItem>)}</SidebarMenu></nav>;
}
