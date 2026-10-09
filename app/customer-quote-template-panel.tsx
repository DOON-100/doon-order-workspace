'use client';

import {useEffect,useRef,useState} from 'react';
import {Download,FileText,RefreshCw,UploadCloud} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {dateTime} from './ui';

export type QuoteTemplateBinding={id:string;title:string;brand:string;businessType:string;rowCount:number};
export type QuoteTemplateOutput={id:string;filename:string;sourceHash:string;uploaded:boolean;createdAt:string};
type QuoteTemplate=QuoteTemplateBinding&{itemCount?:number;sourceFilename?:string;sourceHash?:string;sha256?:string};
type TemplateQuote={id?:string;version?:number;customerAccountId:string|null;brand?:string;businessType?:string;status?:'draft'|'confirmed';templateBinding?:QuoteTemplateBinding;templateOutputs?:QuoteTemplateOutput[];canEdit?:boolean};
type Props={quote:TemplateQuote;scopeKey:string;dirty:boolean;busy:boolean;request:(action:string,body?:unknown)=>Promise<any>;execute:(action:string,body:unknown)=>Promise<any|null>;onPermissionError:(error:unknown)=>void};
const match=(value:string|undefined)=>String(value||'').trim();

export function CustomerQuoteTemplatePanel({quote,scopeKey,dirty,busy,request,execute,onPermissionError}:Props){
 const [templates,setTemplates]=useState<QuoteTemplate[]>([]),[canRegister,setCanRegister]=useState(false),[loading,setLoading]=useState(false),[selected,setSelected]=useState(''),[title,setTitle]=useState(''),[error,setError]=useState(''),[reload,setReload]=useState(0);
 const sequence=useRef(0),callbacks=useRef({onPermissionError});callbacks.current={onPermissionError};
 useEffect(()=>{let active=true;const token=++sequence.current;setTemplates([]);setCanRegister(false);setSelected('');setTitle('');setError('');
  if(!quote.customerAccountId){setLoading(false);return;}
  setLoading(true);
  void request('customer-quote-templates?customerAccountId='+encodeURIComponent(quote.customerAccountId)).then(result=>{if(!active||token!==sequence.current)return;setTemplates(result.templates||[]);setCanRegister(!!result.canRegister);}).catch(problem=>{if(!active||token!==sequence.current)return;setError(problem instanceof Error?problem.message:'客户模板读取失败。');if([401,403,404].includes((problem as {status?:number})?.status||0))callbacks.current.onPermissionError(problem);}).finally(()=>{if(active&&token===sequence.current)setLoading(false);});
  return()=>{active=false;sequence.current++;};
 },[scopeKey,quote.customerAccountId,request,reload]);
 const compatible=templates.filter(item=>match(item.brand)===match(quote.brand)&&match(item.businessType)===match(quote.businessType));
 const chosen=compatible.find(item=>item.id===selected);
 const configured=!!quote.customerAccountId&&!!quote.brand?.trim()&&!!quote.businessType?.trim();
 const apply=async()=>{
  if(!chosen||!quote.id||!quote.version||dirty||busy||!quote.canEdit)return;
  if(!window.confirm(`应用“${chosen.title}”会用模板中的 ${chosen.itemCount??chosen.rowCount} 个报价项目（对应原表 ${chosen.rowCount} 行）替换当前草稿产品行，并重新核对价格、币种及部件供货范围。当前已保存版本仍保留。确定应用吗？`))return;
  await execute('customer-quote-template-apply',{quoteId:quote.id,version:quote.version,templateId:chosen.id});
 };
 const register=async(file:File)=>{
  if(!configured||!canRegister||busy)return;
  if(!title.trim()){setError('请填写模板名称后再选择文件。');return;}
  if(!file.size||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.xlsx')){setError('请上传不超过 10 MB 的客户 XLSX 模板。');return;}
  setError('');const token=sequence.current,form=new FormData();form.set('customerAccountId',quote.customerAccountId!);form.set('brand',quote.brand!.trim());form.set('businessType',quote.businessType!.trim());form.set('title',title.trim());form.set('file',file);
  const result=await execute('customer-quote-template-register',form);if(result&&token===sequence.current)setReload(value=>value+1);
 };
 const archive=async(file:File)=>{
  if(!quote.id||!quote.version||quote.status!=='confirmed'||!quote.templateBinding||busy||dirty)return;
  if(!file.size||file.size>10*1024*1024||!file.name.toLowerCase().endsWith('.xlsx')){setError('实际对客文件须为不超过 10 MB 的 XLSX。');return;}
  setError('');const form=new FormData();form.set('quoteId',quote.id);form.set('quoteVersion',String(quote.version));form.set('file',file);await execute('customer-quote-template-archive',form);
 };
 return <section className="panel cq-template-panel cq-no-print" aria-label="客户特殊格式模板">
  <div className="cq-section-heading"><div><h3><FileText size={17}/>客户特殊格式模板</h3><p className="cq-help">客户原格式与中台报价数据关联，已确认版本自动归档到完成总表。</p></div><Button variant="outline" size="sm" disabled={busy||loading||!quote.customerAccountId} onClick={()=>setReload(value=>value+1)}><RefreshCw size={14}/>刷新模板</Button></div>
  {quote.templateBinding&&<div className="cq-template-binding"><b>已绑定：{quote.templateBinding.title}</b><span>{quote.templateBinding.brand} · {quote.templateBinding.businessType} · {quote.templateBinding.rowCount} 行</span></div>}
  {!configured?<p className="cq-help">请在报价基本资料中选择客户、填写品牌和业务类型。模板按这三项筛选。</p>:<div className="cq-template-select"><label className="cq-field"><span>选择当前客户／品牌／业务类型模板</span><select aria-label="选择客户报价模板" disabled={busy||loading||!quote.canEdit} value={chosen?selected:''} onChange={event=>setSelected(event.target.value)}><option value="">{loading?'正在读取模板…':'请选择模板'}</option>{compatible.map(item=><option key={item.id} value={item.id}>{item.title} · {item.itemCount??item.rowCount} 项／{item.rowCount} 原表行</option>)}</select></label>{quote.canEdit&&<Button variant="outline" disabled={busy||dirty||!quote.id||!chosen} onClick={()=>void apply()}>应用模板到草稿</Button>}</div>}
  {configured&&!loading&&!compatible.length&&<p className="cq-help">当前范围尚无模板。报价管理员可登记客户原文件，其他客户和品牌的模板不会混入。</p>}
  {quote.canEdit&&(!quote.id||dirty)&&<p className="cq-help">应用模板前请先保存草稿。应用后逐项复核价格、币种、左右件、供货阶段和计价方式。</p>}
  {canRegister&&<details className="cq-template-register"><summary>登记客户原模板</summary><p className="cq-help">保存原文件及表头结构，现有报价内容不会因登记自动改变。客户更新格式时登记一个新模板版本。</p><div className="cq-template-select"><label className="cq-field"><span>模板名称</span><input aria-label="客户模板名称" disabled={busy||!configured} maxLength={200} value={title} onChange={event=>setTitle(event.target.value)}/></label><label className={'cq-upload '+(busy||!configured||!title.trim()?'disabled':'')}><UploadCloud size={16}/>上传客户模板<input aria-label="上传客户模板" type="file" accept=".xlsx" disabled={busy||!configured||!title.trim()} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void register(file);}}/></label></div></details>}
  {quote.status==='confirmed'&&quote.id&&quote.templateBinding&&<div className="cq-template-confirmed"><p className="cq-help">从 R{quote.version} 已确认版本生成客户格式。归档实际对客文件会核对价格与本版本一致；价格变化请新建修订草稿，复核后重新确认。归档文件不代表已实际发送。</p><div className="cq-action-buttons"><Button variant="outline" disabled={busy||dirty} asChild><a href={'/api/workspace/customer-quote-template-export?quoteId='+encodeURIComponent(quote.id)+'&quoteVersion='+quote.version} onClick={event=>{if(busy||dirty)event.preventDefault();}}><Download size={16}/>下载客户格式 Excel</a></Button><label className={'cq-upload '+(busy||dirty?'disabled':'')}><UploadCloud size={16}/>归档实际对客 Excel<input aria-label="归档实际对客 Excel" type="file" accept=".xlsx" disabled={busy||dirty} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void archive(file);}}/></label></div><p className="cq-help">生成文件也按确认版本归档；下载后刷新报价列表，可查看成品文件记录。</p>{!!quote.templateOutputs?.length&&<ul className="cq-template-outputs">{quote.templateOutputs.map(output=><li key={output.id}><div><b>{output.filename}</b><small>{output.uploaded?'实际上传文件':'中台生成文件'} · {dateTime(output.createdAt)}</small></div><a href={'/api/workspace/customer-quote-template-output-file?id='+encodeURIComponent(output.id)}>下载归档文件</a></li>)}</ul>}</div>}
  {error&&<p className="error cq-message" role="alert">{error}</p>}
 </section>;
}
