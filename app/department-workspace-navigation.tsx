'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {ChevronDown,FolderOpen,type LucideIcon} from 'lucide-react';
import {SidebarMenu,SidebarMenuButton,SidebarMenuItem} from '@/components/ui/sidebar';
import type {Member} from '@/lib/domain';
import type {WorkspaceNavigate,WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {PlanningNavigationItem} from '@/lib/production-planning';
import {departmentWorkspaceNavigation,departmentWorkspaceNavigationContext,matchDepartmentWorkspaceNavigation} from '@/lib/department-workspace-navigation';
import './department-workspace-navigation.css';

type Props={items:readonly PlanningNavigationItem[];member?:Member;view:string;activeView:string;icons:Record<string,LucideIcon>;onNavigate:WorkspaceNavigate;context?:WorkspaceNavigationContext};

export function DepartmentWorkspaceNavigation({items,member,view,activeView,icons,onNavigate,context={}}:Props){
 const groups=departmentWorkspaceNavigation(items,member);
 const active=matchDepartmentWorkspaceNavigation(groups,view,context,activeView),activeDepartment=active?.department.id,activeItem=active?.item.id;
 const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>({overview:true,...(activeDepartment?{[activeDepartment]:true}:{})}));
 const domPrefix=useId(),navigationRef=useRef<HTMLElement>(null);
 useEffect(()=>{if(activeDepartment)setExpanded(current=>current[activeDepartment]?current:{...current,[activeDepartment]:true});},[activeDepartment,activeItem]);
 useEffect(()=>{const selected=navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');if(selected&&!selected.closest('[hidden]'))selected.scrollIntoView?.({block:'nearest'});},[activeItem,expanded]);
 return <nav className="department-workspace-navigation" aria-label="部门与工序导航" ref={navigationRef}>
  <div className="department-navigation-intro"><span>部门与工序</span><small>按业务流转顺序</small></div>
  <SidebarMenu className="department-navigation-groups">{groups.map((group,index)=>{
   const isExpanded=!!expanded[group.id],isActive=group.id===activeDepartment,contentId=domPrefix+'-'+group.id,Icon=icons[group.icon]||FolderOpen;
   return <SidebarMenuItem key={group.id} className="department-navigation-group" data-department-id={group.id}>
    <button type="button" className="department-navigation-toggle" data-active={isActive} aria-expanded={isExpanded} aria-controls={contentId} aria-label={(isExpanded?'收起':'展开')+group.label} title={group.phase}
     onClick={()=>setExpanded(current=>({...current,[group.id]:!current[group.id]}))}
     onKeyDown={event=>{if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();setExpanded(current=>({...current,[group.id]:event.key==='ArrowRight'}));}}}>
     <Icon size={16} aria-hidden="true"/><span>{group.label}</span><small aria-hidden="true">{String(index+1).padStart(2,'0')}</small><ChevronDown size={15} aria-hidden="true"/>
    </button>
    <div id={contentId} className="department-navigation-children" hidden={!isExpanded}>
     <SidebarMenu>{group.children.map(item=>{const ChildIcon=icons[item.icon]||FolderOpen,isCurrent=item.id===activeItem;return <SidebarMenuItem className="nav-child" key={item.id}>
      <SidebarMenuButton className={'nav-item '+(isCurrent?'active':'')} aria-current={isCurrent?'page':undefined} data-nav-id={item.id} data-nav-view={item.view} data-nav-tab={item.context?.tab} onClick={()=>onNavigate(item.view,departmentWorkspaceNavigationContext(item,context))}>
       <ChildIcon size={15} aria-hidden="true"/><span>{item.label}</span>
      </SidebarMenuButton>
     </SidebarMenuItem>;})}</SidebarMenu>
    </div>
   </SidebarMenuItem>;
  })}</SidebarMenu>
 </nav>;
}
