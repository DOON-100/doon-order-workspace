'use client';
import {Component,type ReactNode} from 'react';
import {ShieldCheck,LockKeyhole,ArrowLeft,RefreshCw,TriangleAlert} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {roleLabels,type Member} from '@/lib/domain';

export function AccessNotice({me,title='权限受限',detail,onBack,compact=false}:{me:Member;title?:string;detail:string;onBack?:()=>void;compact?:boolean}){
 return <section className={'access-notice '+(compact?'compact':'')} role="status">
  <span className="access-icon" aria-hidden="true"><LockKeyhole size={compact?24:32}/></span>
  <div className="access-copy"><span className="access-badge"><ShieldCheck size={14}/>{roleLabels[me.role]}</span><h2>{title}</h2><p>{detail}</p><p className="access-help">如需调整，请联系管理员，在“成员与权限”中分配对应范围。</p>{onBack&&<Button variant="outline" onClick={onBack}><ArrowLeft size={16}/>返回订单总表</Button>}</div>
 </section>;
}

export class PanelBoundary extends Component<{children:ReactNode;onBack:()=>void},{failed:boolean}> {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){if(!this.state.failed)return this.props.children;
  return <section className="access-notice page-problem" role="alert"><span className="access-icon"><TriangleAlert size={32}/></span><div className="access-copy"><span className="access-badge">页面加载提醒</span><h2>这个页面暂时没有打开</h2><p>请重试；如果仍有问题，请将当前页面名称告知管理员。</p><div className="flex gap-3 mt-5"><Button onClick={()=>this.setState({failed:false})}><RefreshCw size={16}/>重试此页</Button><Button variant="outline" onClick={this.props.onBack}>返回订单总表</Button></div></div></section>;
 }
}
