'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import {BookOpen,ChevronDown,Copy,RefreshCw,Search} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {matchSalesColorField,type SalesColorCatalog,type SalesColorField} from '@/lib/sales-color-fields';
import {businessTeamFetch} from './business-team-client';
import {useBusinessTeamScope} from './business-team-context';
import {Input} from './ui';
import type {Data} from './workspace';
import './sales-color-fields-panel.css';

type ColorField=SalesColorField;
type CatalogResponse={catalog:SalesColorCatalog|null;version:number;canConfigure:boolean;error?:string};
type LoadedCatalog={revision:number;response:CatalogResponse};
const statusLabels={adopted:'已对应',pending:'保留候选',composite:'组合栏目'};
const normalize=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g,' ');
const fieldLabel=(field:ColorField)=>`${field.labelZh} / ${field.labelEn}`;
const pageSize=20;

export function SalesColorFieldsPanel({data}:{data:Data}){
 const teamId=useBusinessTeamScope()?.teamId||'';
 // Remount before rendering another account or team, including copy fallbacks.
 const scopeKey=JSON.stringify([data.me.id,data.me.role,teamId]);
 return <SalesColorFieldsLibrary key={scopeKey} revision={data.revision}/>;
}

function SalesColorFieldsLibrary({revision}:{revision:number}){
 const [expanded,setExpanded]=useState(false),[loaded,setLoaded]=useState<LoadedCatalog|null>(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const [query,setQuery]=useState(''),[profileId,setProfileId]=useState(''),[page,setPage]=useState(0),[copyNotice,setCopyNotice]=useState(''),[copyFallback,setCopyFallback]=useState('');
 const fallbackRef=useRef<HTMLTextAreaElement>(null),requestSequence=useRef(0),copySequence=useRef(0);
 const response=loaded?.revision===revision?loaded.response:null,catalog=response?.catalog||null,loading=expanded&&!response&&!error;

 useEffect(()=>{
  const sequence=++requestSequence.current;
  copySequence.current++;
  setLoaded(null);setError('');setCopyNotice('');setCopyFallback('');
  if(!expanded)return;
  const controller=new AbortController();
  void (async()=>{
   try{
    const result=await businessTeamFetch('/api/workspace/sales-color-fields-data',{cache:'no-store',signal:controller.signal});
    const value=await result.json() as CatalogResponse;
    if(!result.ok)throw new Error(value.error||(result.status===401?'登录已失效，请重新登录。':result.status===403?'当前账号无权查看销售颜色字段库。':'颜色字段库读取失败，请重试。'));
    if(value.catalog!==null&&(!value.catalog||value.catalog.schemaVersion!==1||!Array.isArray(value.catalog.fields)||!Array.isArray(value.catalog.profiles)))throw new Error('颜色字段库格式不完整，请联系维护人员核对配置。');
    if(!controller.signal.aborted&&sequence===requestSequence.current){
     setLoaded({revision,response:value});
     setProfileId(current=>value.catalog?.profiles.some(profile=>profile.id===current)?current:'');
    }
   }catch(cause){
    if(!controller.signal.aborted&&sequence===requestSequence.current)setError(cause instanceof Error?cause.message:'颜色字段库读取失败，请重试。');
   }
  })();
  return()=>{controller.abort();requestSequence.current++;copySequence.current++;};
 },[expanded,revision,retry]);

 useEffect(()=>{if(copyFallback){fallbackRef.current?.focus();fallbackRef.current?.select();}},[copyFallback]);
 const fieldsById=useMemo(()=>new Map(catalog?.fields.map(field=>[field.id,field])||[]),[catalog]);
 const profile=catalog?.profiles.find(item=>item.id===profileId);
 const search=normalize(query);
 const nameMatch=useMemo(()=>catalog&&search?matchSalesColorField(catalog,query,profileId?{profileId}:{}):null,[catalog,search,query,profileId]);
 const suggestedIds=new Set(nameMatch?.candidateFieldIds||[]);
 const matchingFields=(catalog?.fields||[]).filter(field=>!search||normalize(`${field.labelZh} ${field.labelEn}`).includes(search)||suggestedIds.has(field.id));
 const matchingSlots=(profile?.slots||[]).filter(slot=>!search||normalize([slot.sourceLabel,slot.sourceColumn,slot.qualifier,slot.fieldId&&fieldsById.has(slot.fieldId)?fieldLabel(fieldsById.get(slot.fieldId)!):'',...slot.candidateFieldIds.map(id=>fieldsById.get(id)).filter((field):field is ColorField=>!!field).map(fieldLabel)].join(' ')).includes(search)||nameMatch?.sourceSlotIds.includes(slot.id)||!!slot.fieldId&&suggestedIds.has(slot.fieldId)||slot.candidateFieldIds.some(id=>suggestedIds.has(id)));
 const total=profile?matchingSlots.length:matchingFields.length,pages=Math.max(1,Math.ceil(total/pageSize)),currentPage=Math.min(page,pages-1),start=currentPage*pageSize;

 const clearCopy=()=>{copySequence.current++;setCopyNotice('');setCopyFallback('');};
 const copy=async(text:string)=>{
  const sequence=++copySequence.current;
  setCopyNotice('');setCopyFallback('');
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');
   await navigator.clipboard.writeText(text);
   if(sequence===copySequence.current)setCopyNotice('标题已复制。');
  }catch{
   if(sequence===copySequence.current){setCopyFallback(text);setCopyNotice('浏览器未能自动复制。请在下方选中文本，使用 Ctrl+C 或系统复制操作。');}
  }
 };
 const copyButtons=(field:ColorField)=><div className="sales-color-fields-copy-actions"><Button type="button" size="sm" variant="outline" aria-label={`复制中文标题 ${field.labelZh}`} onClick={()=>void copy(field.labelZh)}>中文</Button><Button type="button" size="sm" variant="outline" aria-label={`复制英文标题 ${field.labelEn}`} onClick={()=>void copy(field.labelEn)}>英文</Button><Button type="button" size="sm" variant="outline" aria-label={`复制中英标题 ${field.labelZh}`} onClick={()=>void copy(fieldLabel(field))}><Copy size={13}/>中英</Button></div>;

 return <section className="panel mt-4 sales-color-fields" aria-label="销售颜色字段库" data-testid="sales-color-fields-panel">
  <button type="button" className="sales-color-fields-toggle" aria-expanded={expanded} aria-controls="sales-color-fields-content" onClick={()=>setExpanded(value=>!value)}>
   <BookOpen size={22}/><span><strong>销售颜色字段库</strong><small>查找标准中英标题，按客户与产品查看原栏目对应。原颜色值保持原样。</small></span><ChevronDown size={20} className={expanded?'is-expanded':''}/>
  </button>
  {expanded&&<div id="sales-color-fields-content" className="sales-color-fields-content">
   {loading&&<p role="status" className="sales-color-fields-empty">正在读取当前授权范围的字段库…</p>}
   {error&&<div role="alert" className="sales-color-fields-error"><p>{error}</p><Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>重新读取字段库</Button></div>}
   {response&&!catalog&&<div className="sales-color-fields-empty"><h4>尚未配置销售颜色字段库</h4><p>{response.canConfigure?'请由维护人员导入已确认的颜色字段字典与栏目对应配置。':'请联系维护人员配置已确认的颜色字段字典。'}</p><Button type="button" variant="outline" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>重新读取字段库</Button></div>}
   {catalog&&<>
    <div className="sales-color-fields-toolbar"><label><span>客户 / 产品模板</span><select aria-label="销售颜色字段客户产品模板" value={profileId} onChange={event=>{setProfileId(event.target.value);setPage(0);clearCopy();}}><option value="">全部标准字段</option>{catalog.profiles.map(item=><option key={item.id} value={item.id}>{[item.customer,item.productType,item.name].filter(Boolean).join(' · ')}</option>)}</select></label><label className="sales-color-fields-search"><span>搜索中英字段或原栏目</span><div><Search size={16}/><Input aria-label="搜索销售颜色字段" maxLength={300} value={query} placeholder="输入中文、英文或原栏目名称" onChange={event=>{setQuery(event.target.value);setPage(0);clearCopy();}}/></div></label><Button type="button" variant="outline" aria-label="刷新销售颜色字段库" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={16}/>刷新</Button></div>
    <p className="sales-color-fields-note">{catalog.title} · 字典版本 {catalog.dictionaryVersion} · 配置版本 {response?.version} · {catalog.fields.length} 个标准字段。模板选择仅用于查看对应关系。</p>
    {nameMatch&&<p className="sales-color-fields-note" role="status">{nameMatch.status==='matched'&&nameMatch.field?`名称已对应：${fieldLabel(nameMatch.field)}。`:nameMatch.basis==='dictionary-similar'?'找到近似名称候选，仅供查找；未自动采用为新对应关系。':nameMatch.status==='candidates'?'名称存在多个候选，请结合来源栏目与部位区分。':nameMatch.status==='composite'?'这是组合栏目，完整保留部件含义。':nameMatch.status==='pending'?'此原栏目仍保留候选，尚未确定对应字段。':'未找到已确认的名称对应；下表同时显示包含搜索词的结果。'} 表内状态来自已配置规则，搜索不会更改状态。</p>}
    {profile?<div className="sales-color-fields-profile-info"><strong>{profile.name}</strong><span>来源工作表：{profile.sourceSheet}</span><span>{profile.slots.filter(slot=>slot.status==='adopted').length} 个已对应 · {profile.slots.filter(slot=>slot.status==='pending').length} 个保留候选 · {profile.slots.filter(slot=>slot.status==='composite').length} 个组合栏目</span><p>同名字段按来源栏目和部位分别保留；候选尚未选定，组合栏目保持完整含义。</p></div>:!catalog.profiles.length&&<p className="sales-color-fields-note">当前授权范围暂无客户产品模板，可查询标准字段。</p>}
    {copyNotice&&<div className="sales-color-fields-copy-result" role="status"><p>{copyNotice}</p>{copyFallback&&<label>可手动复制的标题<textarea ref={fallbackRef} readOnly value={copyFallback} aria-label="手动复制销售颜色字段标题" onFocus={event=>event.target.select()}/></label>}</div>}
    <div className="sales-color-fields-table" tabIndex={0} aria-label={profile?'原栏目与标准颜色字段对应表':'标准颜色字段列表'}>
     {profile?<table><caption>{profile.name} · 栏目对应</caption><thead><tr><th>来源列 / 原标题</th><th>状态</th><th>标准中英标题 / 候选</th><th>部位与组合说明</th><th>复制标准标题</th></tr></thead><tbody>{matchingSlots.slice(start,start+pageSize).map(slot=>{
      const field=slot.fieldId?fieldsById.get(slot.fieldId):undefined;
      const candidates=slot.candidateFieldIds.map(id=>fieldsById.get(id)).filter((item):item is ColorField=>!!item);
      return <tr key={slot.id} data-status={slot.status}><td><small>{slot.sourceColumn} 列</small><strong>{slot.sourceLabel}</strong></td><td><span className={`sales-color-fields-status ${slot.status}`}>{statusLabels[slot.status]}</span></td><td>{slot.status==='adopted'&&field?<><strong>{field.labelZh}</strong><span>{field.labelEn}</span></>:<><small>{slot.status==='composite'?'组合相关标准字段':'待核对候选'}</small>{candidates.length?candidates.map(item=><div className="sales-color-fields-candidate" key={item.id}><strong>{item.labelZh}</strong><span>{item.labelEn}</span></div>):<span>保留原栏目，尚无明确对应</span>}</>}</td><td className="sales-color-fields-qualifier">{slot.qualifier||'—'}</td><td>{slot.status==='adopted'&&field?copyButtons(field):<span className="sales-color-fields-note">保留原栏目</span>}</td></tr>;
     })}{!matchingSlots.length&&<tr><td colSpan={5} className="sales-color-fields-empty">没有匹配的栏目，请调整搜索词。</td></tr>}</tbody></table>:<table><caption>标准颜色字段</caption><thead><tr><th>中文标准标题</th><th>英文标准标题</th><th>复制标题</th></tr></thead><tbody>{matchingFields.slice(start,start+pageSize).map(field=><tr key={field.id}><td><strong>{field.labelZh}</strong></td><td>{field.labelEn}</td><td>{copyButtons(field)}</td></tr>)}{!matchingFields.length&&<tr><td colSpan={3} className="sales-color-fields-empty">没有匹配的字段，请调整搜索词。</td></tr>}</tbody></table>}
    </div>
    <div className="sales-color-fields-pagination"><span>共 {total} {profile?'个栏目':'个字段'}{total?` · 显示 ${start+1}–${Math.min(start+pageSize,total)}`:''}</span><div><Button type="button" size="sm" variant="outline" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</Button><span>{currentPage+1} / {pages}</span><Button type="button" size="sm" variant="outline" disabled={currentPage>=pages-1} onClick={()=>setPage(currentPage+1)}>下一页</Button></div></div>
   </>}
  </div>}
 </section>;
}
