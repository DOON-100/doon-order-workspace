'use client';

import {useEffect,useId,useRef,useState,type MouseEvent as ReactMouseEvent} from 'react';
import {Bot,ChevronDown,FolderOpen,type LucideIcon} from 'lucide-react';
import {Popover,PopoverContent,PopoverTrigger} from '@/components/ui/popover';
import {SidebarMenu,SidebarMenuButton,SidebarMenuItem} from '@/components/ui/sidebar';
import type {Member} from '@/lib/domain';
import type {WorkspaceNavigate,WorkspaceNavigationContext} from '@/lib/handoff-navigation';
import type {PlanningNavigationItem} from '@/lib/production-planning';
import {departmentWorkspaceNavigation,departmentWorkspaceNavigationContext,matchDepartmentWorkspaceNavigation} from '@/lib/department-workspace-navigation';
import './department-workspace-navigation.css';

type Props={items:readonly PlanningNavigationItem[];member?:Member;view:string;activeView:string;icons:Record<string,LucideIcon>;onNavigate:WorkspaceNavigate;context?:WorkspaceNavigationContext;collapsed?:boolean;agentStudioUrl?:string};

const HOVER_OPEN_DELAY=120,HOVER_CLOSE_DELAY=360;

// The collapsed rail is a launcher, not a dead end: hovering a department icon opens a
// floating panel with that department's pages, so switching pages never requires expanding
// the full sidebar first. This mirrors the inline-collapsed menu of mature admin shells.
export function DepartmentWorkspaceNavigation({items,member,view,activeView,icons,onNavigate,context={},collapsed=false,agentStudioUrl}:Props){
 const groups=departmentWorkspaceNavigation(items,member);
 const active=matchDepartmentWorkspaceNavigation(groups,view,context,activeView),activeDepartment=active?.department.id,activeItem=active?.item.id;
 const [expanded,setExpanded]=useState<Record<string,boolean>>(()=>({overview:true,...(activeDepartment?{[activeDepartment]:true}:{})}));
 const [openDepartment,setOpenDepartment]=useState<string|null>(null);
 const domPrefix=useId(),navigationRef=useRef<HTMLElement>(null),hoverTimer=useRef<ReturnType<typeof setTimeout>|null>(null),closeTimer=useRef<ReturnType<typeof setTimeout>|null>(null),flyoutRefs=useRef<Record<string,HTMLDivElement|null>>({});
 useEffect(()=>{if(activeDepartment)setExpanded(current=>current[activeDepartment]?current:{...current,[activeDepartment]:true});},[activeDepartment,activeItem]);
 useEffect(()=>{const selected=navigationRef.current?.querySelector<HTMLElement>('[aria-current="page"]');if(selected&&!selected.closest('[hidden]'))selected.scrollIntoView?.({block:'nearest'});},[activeItem,expanded]);
 useEffect(()=>()=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);if(closeTimer.current)clearTimeout(closeTimer.current);},[]);
 // Escape must close the panel even though the panel never takes focus (hover opens it, and
 // taking focus would steal it from whatever field the user is editing), so listen globally.
 useEffect(()=>{if(!collapsed)return;const onKeyDown=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;if(hoverTimer.current){clearTimeout(hoverTimer.current);hoverTimer.current=null;}if(closeTimer.current){clearTimeout(closeTimer.current);closeTimer.current=null;}const focused=document.activeElement;const groupId=Object.keys(flyoutRefs.current).find(id=>focused&&flyoutRefs.current[id]?.contains(focused));if(groupId)navigationRef.current?.querySelector<HTMLElement>(`[data-department-id="${groupId}"] .department-navigation-toggle`)?.focus();setOpenDepartment(null);};document.addEventListener('keydown',onKeyDown);return()=>document.removeEventListener('keydown',onKeyDown);},[collapsed]);
 // Hover opens the panel; the delay keeps a fast sweep across the icons from popping
 // unrelated panels. Open and close use separate timers so a pending close cannot cancel a
 // pending open while the pointer moves between two departments.
 const cancelClose=()=>{if(closeTimer.current){clearTimeout(closeTimer.current);closeTimer.current=null;}};
 const scheduleHover=(groupId:string|null,delay:number)=>{if(hoverTimer.current)clearTimeout(hoverTimer.current);if(groupId)cancelClose();hoverTimer.current=setTimeout(()=>{hoverTimer.current=null;setOpenDepartment(groupId);},delay);};
 const scheduleClose=(delay:number,owner?:string)=>{if(closeTimer.current)clearTimeout(closeTimer.current);closeTimer.current=setTimeout(()=>{closeTimer.current=null;setOpenDepartment(current=>owner&&current!==owner?current:null);},delay);};
 // The panel is portalled to <body>, so DOM containment cannot tell whether the pointer
 // travelled from an icon into the panel or away from it. Compare the element the pointer
 // is heading for instead: that keeps the panel open while the pointer crosses the gap.
 const isInsidePanel=(target:EventTarget|null)=>{if(!(target instanceof Node))return false;return Object.values(flyoutRefs.current).some(element=>element?.contains(target));};
 const focusFirstItem=(groupId:string)=>{setOpenDepartment(groupId);setTimeout(()=>{flyoutRefs.current[groupId]?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();},0);};
 // Leaving the rail as a whole is what closes the panel, not leaving a single icon: the
 // pointer travels from the icon across to the panel, and only a move off both ends means
 // the user is done with the menu.
 const leaveRail=(event:ReactMouseEvent)=>{if(isInsidePanel(event.relatedTarget))return;if(hoverTimer.current){clearTimeout(hoverTimer.current);hoverTimer.current=null;}scheduleClose(HOVER_CLOSE_DELAY);};
 return <nav className="department-workspace-navigation" aria-label="部门与工序导航" ref={navigationRef}
  onMouseLeave={collapsed?leaveRail:undefined}
  onMouseEnter={collapsed?()=>cancelClose():undefined}>
  <div className="department-navigation-intro"><span>部门与工序</span><small>按业务流转顺序</small></div>
  {/* Collapsed rail only: the brand logo is hidden at this width, so Agent Studio needs its
      own launcher above the department icons. The expanded rail keeps the logo entry. */}
  {collapsed&&agentStudioUrl&&<a className="department-navigation-studio" href={agentStudioUrl} target="_blank" rel="noopener noreferrer" title="打开 Agent Studio" aria-label="打开 Agent Studio（新标签页）"><Bot aria-hidden="true"/></a>}
  <SidebarMenu className="department-navigation-groups">{groups.map((group,index)=>{
   const isExpanded=!!expanded[group.id],isActive=group.id===activeDepartment,contentId=domPrefix+'-'+group.id,Icon=icons[group.icon]||FolderOpen;
   const toggle=<button type="button" className="department-navigation-toggle" data-active={isActive} aria-expanded={collapsed?openDepartment===group.id:isExpanded} aria-haspopup={collapsed?true:undefined} aria-controls={collapsed?domPrefix+'-flyout-'+group.id:contentId} aria-label={collapsed?group.label:(isExpanded?'收起':'展开')+group.label} title={collapsed?group.label:group.phase}
    onClick={()=>{if(collapsed)return;setExpanded(current=>({...current,[group.id]:!current[group.id]}));}}
    onMouseEnter={collapsed?()=>scheduleHover(group.id,HOVER_OPEN_DELAY):undefined}
    onKeyDown={event=>{
     if(collapsed){if(event.key==='ArrowDown'||event.key==='Enter'||event.key===' '){event.preventDefault();focusFirstItem(group.id);}return;}
     if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();setExpanded(current=>({...current,[group.id]:event.key==='ArrowRight'}));}
    }}>
    <Icon size={16} aria-hidden="true"/><span>{group.label}</span><small aria-hidden="true">{String(index+1).padStart(2,'0')}</small><ChevronDown size={15} aria-hidden="true"/>
   </button>;
   const children=<div id={contentId} className="department-navigation-children" hidden={!isExpanded}>
    <SidebarMenu>{group.children.map(item=>{const ChildIcon=icons[item.icon]||FolderOpen,isCurrent=item.id===activeItem;return <SidebarMenuItem className="nav-child" key={item.id}>
     <SidebarMenuButton className={'nav-item '+(isCurrent?'active':'')} aria-current={isCurrent?'page':undefined} data-nav-id={item.id} data-nav-view={item.view} data-nav-tab={item.context?.tab} onClick={()=>onNavigate(item.view,departmentWorkspaceNavigationContext(item,context))}>
      <ChildIcon size={15} aria-hidden="true"/><span>{item.label}</span>
     </SidebarMenuButton>
    </SidebarMenuItem>;})}</SidebarMenu>
   </div>;
   // Expanded rail: the group expands inline and lists its pages in place.
   if(!collapsed)return <SidebarMenuItem key={group.id} className="department-navigation-group" data-department-id={group.id}>{toggle}{children}</SidebarMenuItem>;
   // Collapsed rail: hovering (or activating) the icon opens the department's pages in a panel.
   return <SidebarMenuItem key={group.id} className="department-navigation-group" data-department-id={group.id}>
    <Popover open={openDepartment===group.id} onOpenChange={open=>{if(open)setOpenDepartment(group.id);else scheduleClose(HOVER_CLOSE_DELAY,group.id);}}>
     <PopoverTrigger asChild>{toggle}</PopoverTrigger>
     <PopoverContent id={domPrefix+'-flyout-'+group.id} role="menu" aria-label={group.label+'页面'} align="start" side="right" sideOffset={8} className="department-navigation-flyout"
      ref={element=>{flyoutRefs.current[group.id]=element;}}
      onOpenAutoFocus={event=>event.preventDefault()}
      onCloseAutoFocus={event=>event.preventDefault()}
      onMouseEnter={()=>{cancelClose();if(hoverTimer.current){clearTimeout(hoverTimer.current);hoverTimer.current=null;}}}
      onMouseLeave={(event:ReactMouseEvent)=>{if(isInsidePanel(event.relatedTarget))return;if(navigationRef.current?.contains(event.relatedTarget as Node))return;scheduleClose(HOVER_CLOSE_DELAY,group.id);}}>
      <div className="department-navigation-flyout-head">{group.label}</div>
      {group.children.map(item=>{const ChildIcon=icons[item.icon]||FolderOpen,isCurrent=item.id===activeItem;return <button key={item.id} type="button" role="menuitem" className="department-navigation-flyout-item" aria-current={isCurrent?'page':undefined} data-nav-id={item.id} data-nav-view={item.view} data-nav-tab={item.context?.tab}
        onClick={()=>{setOpenDepartment(null);onNavigate(item.view,departmentWorkspaceNavigationContext(item,context));}}>
       <ChildIcon size={15} aria-hidden="true"/><span>{item.label}</span>
      </button>;})}
     </PopoverContent>
    </Popover>
   </SidebarMenuItem>;
  })}</SidebarMenu>
 </nav>;
}
