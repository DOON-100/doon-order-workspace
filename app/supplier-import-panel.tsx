'use client';
import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Upload} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {dateTime,request} from './ui';

type SourceRow={row:number;code:string;name:string};
type Conflict=SourceRow&{reason:string};
type Preview={previewId:string;fileName:string;total:number;candidateCount:number;existingCount:number;candidates:SourceRow[];conflicts:Conflict[]};
type Result={inserted:number;skipped:number;held:number};
type Source={id:string;batchId:string;row:number;code:string;name:string;status:string;reason:string;supplierId:string};
type Batch={id:string;filename:string;createdAt:string;completedAt:string};
type Diagnostic={readOnly:true;rows:unknown[];checkedAt:string};

/** A file is a point-in-time export; it cannot provide live ERP updates. */
export function SupplierImportPanel(){
 const cache=useQueryClient();
 const [open,setOpen]=useState(false),[showSources,setShowSources]=useState(false),[sourceId,setSourceId]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[result,setResult]=useState<Result|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [checking,setChecking]=useState(false),[diagnostic,setDiagnostic]=useState<Diagnostic|null>(null),[diagnosticError,setDiagnosticError]=useState('');
 const sources=useQuery<{batches:Batch[];sources:Source[]}>({queryKey:['supplier-import-sources'],queryFn:()=>request('supplier-import-sources'),enabled:showSources});
 const detail=useQuery<{source:{fields:{label:string;value:string}[]}}>({queryKey:['supplier-import-source',sourceId],queryFn:()=>request('supplier-import-source?id='+encodeURIComponent(sourceId)),enabled:showSources&&!!sourceId});
 const filtered=(sources.data?.sources||[]).filter(row=>[row.code,row.name,row.status,row.reason].join(' ').toLowerCase().includes(search.toLowerCase()));
 function reset(){setFile(null);setPreview(null);setResult(null);setError('');}
 async function inspect(){
  if(!file||busy)return;setBusy(true);setError('');
  try{const form=new FormData();form.set('file',file);setPreview(await request('supplier-import-preview',form));}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function commit(){
  if(!preview||busy||result)return;setBusy(true);setError('');
  try{const saved:Result=await request('supplier-import-commit',{previewId:preview.previewId});setResult(saved);await Promise.all([cache.invalidateQueries({queryKey:['workspace']}),cache.invalidateQueries({queryKey:['supplier-import-sources']})]);}
  catch(e){setError((e as Error).message+' 请先核查批次结果，再决定是否重试。');}finally{setBusy(false);}
 }
 async function checkConnection(){
  if(checking)return;setChecking(true);setDiagnostic(null);setDiagnosticError('');
  try{setDiagnostic(await request('kingdee-supplier-diagnostic'));}
  catch(e){setDiagnosticError((e as Error).message);}finally{setChecking(false);}
 }
 return <>
  <Button variant="outline" onClick={()=>{reset();setOpen(true);}}><Upload size={16}/>导入金蝶供应商表</Button>
  <Button variant="outline" onClick={()=>{setSourceId('');setSearch('');setPage(0);setShowSources(true);}}>导入记录与源字段</Button>
  <Button variant="outline" disabled={checking} onClick={()=>void checkConnection()}>{checking?'正在只读测试…':'测试金蝶供应商连接'}</Button>
  {diagnostic&&<p role="status">只读查询已响应，首批返回 {diagnostic.rows.length} 条（最多 10 条），测试时间 {dateTime(diagnostic.checkedAt)}。未导入档案，自动同步尚未接通。</p>}
  {diagnosticError&&<p className="error" role="alert">连接测试未完成：{diagnosticError}</p>}
  <Dialog open={open} onOpenChange={value=>{if(!busy){setOpen(value);if(!value)reset();}}}><DialogContent className="dialog-scroll sm:max-w-[850px]"><DialogHeader><DialogTitle>导入金蝶供应商档案</DialogTitle><DialogDescription>选择金蝶导出的供应商 Excel，先核对新增与冲突，再提交可安全新增的记录。</DialogDescription></DialogHeader>
   <p className="muted">Excel 是导出时的快照，文件未标明金蝶账套。金蝶新增供应商不会自动进入中台；实时同步尚未接通，需要重新导出并导入。</p>
   <label>选择金蝶供应商 Excel<input className="block mt-2" type="file" accept=".xlsx" aria-label="选择金蝶供应商表" disabled={busy||!!preview} onChange={e=>{setFile(e.target.files?.[0]||null);setError('');}}/></label>
   {!preview&&<Button disabled={!file||busy} onClick={()=>void inspect()}>{busy?'正在核对…':'读取并预览'}</Button>}
   {preview&&<section className="space-y-3"><h3>{preview.fileName}</h3><p>来源 {preview.total} 行 · 可新增 {preview.candidateCount} 条 · 已存在 {preview.existingCount} 条 · 待核查 {preview.conflicts.length} 条</p><p>已导入且编码和名称一致时跳过；名称或编码冲突保留待核查，不会自动关联或覆盖已有供应商资料。</p>
    {!!preview.candidates.length&&<div><b>可新增记录预览（最多 20 条）</b><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>源行</th><th>金蝶编码</th><th>供应商名称</th></tr></thead><tbody>{preview.candidates.map((row,index)=><tr key={index}><td>{row.row}</td><td>{row.code}</td><td>{row.name}</td></tr>)}</tbody></table></div></div>}
    {!!preview.conflicts.length&&<div><b>待核查记录</b><div className="overflow-auto max-h-64"><table className="w-full text-sm"><thead><tr><th>源行</th><th>金蝶编码</th><th>供应商名称</th><th>原因</th></tr></thead><tbody>{preview.conflicts.map((row,index)=><tr key={index}><td>{row.row}</td><td>{row.code}</td><td>{row.name}</td><td>{row.reason}</td></tr>)}</tbody></table></div></div>}
    {!result&&<Button disabled={busy} onClick={()=>void commit()}>{busy?'正在提交…':'确认保存导入结果'}</Button>}
   </section>}
   {error&&<p className="error" role="alert">{error}</p>}{result&&<p role="status">导入完成：新增 {result.inserted} 条，跳过 {result.skipped} 条，待核查 {result.held} 条。</p>}
  </DialogContent></Dialog>
  <Dialog open={showSources} onOpenChange={setShowSources}><DialogContent className="dialog-scroll sm:max-w-[950px]"><DialogHeader><DialogTitle>金蝶供应商导入记录</DialogTitle><DialogDescription>逐行查看来源与待核查原因；原始字段仅向采购 / PMC 和管理员开放。</DialogDescription></DialogHeader>
   {sources.isPending&&<p role="status">正在读取导入记录…</p>}{sources.isError&&<p className="error" role="alert">{(sources.error as Error).message}</p>}
   {sources.data&&<><label>搜索编码、名称或状态<input className="block mt-2" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></label><p>{filtered.length} 条来源记录 · 每页 30 条</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>来源文件 / 行</th><th>编码</th><th>名称</th><th>结果 / 原因</th><th>操作</th></tr></thead><tbody>{filtered.slice(page*30,page*30+30).map(row=><tr key={row.id}><td>{sources.data.batches.find(batch=>batch.id===row.batchId)?.filename||'来源批次'} / {row.row}</td><td>{row.code}</td><td>{row.name}</td><td>{({new:'已新增',skip:'已存在',conflict:'待核查'} as Record<string,string>)[row.status]||row.status} {row.reason}</td><td><Button variant="outline" size="sm" onClick={()=>setSourceId(row.id)}>查看原字段</Button></td></tr>)}</tbody></table></div><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page===0} onClick={()=>setPage(page-1)}>上一页</Button><Button variant="outline" size="sm" disabled={(page+1)*30>=filtered.length} onClick={()=>setPage(page+1)}>下一页</Button></div></>}
   {sourceId&&<section><h3>来源字段</h3>{detail.isPending&&<p>正在读取…</p>}{detail.isError&&<p className="error" role="alert">{(detail.error as Error).message}</p>}{detail.data&&<dl>{detail.data.source.fields.map((field,index)=><div key={index}><dt><b>{field.label}</b></dt><dd>{field.value||'—'}</dd></div>)}</dl>}</section>}
  </DialogContent></Dialog>
 </>;
}
