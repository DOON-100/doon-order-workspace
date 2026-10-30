'use client';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {ExcelTable,useExcelColumnFilters} from './excel-table';
import {request,dateTime} from './ui';
import {workbookFilterValue} from '@/lib/excel-workbook-filter-value';
import './outsourcing-workbook-panel.css';

type Sheet={name:string;state:string;dimension:string|null;formulaCells:number;rows:number;columns:number};
type Archive={id:string;title:string;filename:string;sha256:string;size:number;version:number;createdAt:string;sheets:Sheet[];viewMemberIds?:string[]};
type Catalog={canManage:boolean;archives:Archive[];members:{id:string;name:string;departments:string[]}[]};
type Cell={address:string;column:number;type:string;value:string|number|boolean|null;cachedValue:string|number|boolean|null;display:string;formula:string|null;rawFormula:string|null;numberFormat:string|null;cacheStatus:string;unknownReason:string|null};
type Row={row:number;hidden:boolean;cells:Cell[]};
type Query={archive:Archive;sheet:Sheet;headerRow:number;columns:{column:number;letter:string;label:string;hidden:boolean}[];rows:Row[];total:number;formulaCachesRecalculated:false;date1904:boolean};

function FieldQuery({data}:{data:Query}){
 const [showHidden,setShowHidden]=useState(false),[page,setPage]=useState(0),[selected,setSelected]=useState<Cell|null>(null);
 const columns=useMemo(()=>data.columns.filter(c=>showHidden||!c.hidden),[data.columns,showHidden]);
 const rows=useMemo(()=>data.rows.filter(row=>row.row>data.headerRow&&(showHidden||!row.hidden)),[data.rows,data.headerRow,showHidden]);
 const values=useCallback((row:Row)=>[row.row,...columns.map(c=>workbookFilterValue(row.cells.find(cell=>cell.column===c.column),data.date1904))],[columns,data.date1904]);
 const model=useExcelColumnFilters(rows,values);
 useEffect(()=>setPage(0),[model.filters,showHidden]);
 const last=Math.max(0,Math.ceil(model.rows.length/30)-1),current=Math.min(page,last);
 return <section className="owb-query"><p><strong>字段查询 · 保存时结果</strong>　{data.sheet.name}（{data.sheet.state==='visible'?'可见表':data.sheet.state==='hidden'?'原隐藏表':'原深度隐藏表'}）</p>
  <p className="muted">公式没有重新计算，外链没有刷新。此处按字段查询，原版式、打印及完整Excel操作请下载原件使用Excel／WPS打开。</p>
  <p className="muted">按值选择使用显示文字；数值条件使用未舍入原值，日期条件按原日期格式和日期系统识别。公式使用已保存结果，缺失缓存不会当作空白或零。</p>
  <label><input type="checkbox" checked={showHidden} onChange={e=>{setShowHidden(e.target.checked);model.clearFilters();setSelected(null);}}/> 显示原隐藏行／字段</label>
  <p>查询当前所选工作表全部已读取行，先筛选后分页。命中 {model.rows.length} / {rows.length} 行；原表 {data.total} 行含内容或公式。</p>
  <div className="owb-scroll"><ExcelTable filterModel={model} aria-label="外发工作簿字段查询"><thead><tr><th>原行号</th>{columns.map(c=><th key={c.column}>{c.letter} · {c.label}{c.hidden?'（隐藏）':''}</th>)}</tr></thead><tbody>{model.rows.slice(current*30,current*30+30).map(row=><tr key={row.row}><td>{row.row}{row.hidden?'（隐藏）':''}</td>{columns.map(c=>{const cell=row.cells.find(v=>v.column===c.column);return <td key={c.column}><button type="button" className="owb-cell" onClick={()=>setSelected(cell||null)} title={cell?.formula?'公式：'+cell.formula:cell?.address}>{cell?.display||'　'}{cell?.cacheStatus!=='not-formula'&&<sup>ƒ</sup>}</button></td>;})}</tr>)}{!model.rows.length&&<tr><td colSpan={columns.length+1}>没有匹配行。</td></tr>}</tbody></ExcelTable></div>
  <div className="owb-actions"><Button variant="outline" disabled={current===0} onClick={()=>setPage(current-1)}>上一页</Button><span>{current+1} / {last+1}</span><Button variant="outline" disabled={current>=last} onClick={()=>setPage(current+1)}>下一页</Button></div>
  {selected&&<section className="owb-cell-detail" aria-label="原单元格详情"><strong>{selected.address}</strong><Button variant="ghost" onClick={()=>setSelected(null)}>关闭</Button><dl><dt>显示值</dt><dd>{selected.display||'（空白）'}</dd><dt>原值</dt><dd>{JSON.stringify(selected.value)}</dd><dt>保存的公式结果</dt><dd>{JSON.stringify(selected.cachedValue)}</dd><dt>公式</dt><dd>{selected.formula||'无'}</dd><dt>原公式文本</dt><dd>{selected.rawFormula??'无'}</dd><dt>数字格式</dt><dd>{selected.numberFormat||'未指定'}</dd><dt>缓存／未知事项</dt><dd>{selected.cacheStatus} {selected.unknownReason||''}</dd></dl></section>}
 </section>;
}

export function OutsourcingWorkbookPanel(){
 const cache=useQueryClient();
 const catalog=useQuery<Catalog>({queryKey:['outsourcing-workbooks'],queryFn:()=>request('outsourcing-workbooks')});
 const [archiveId,setArchiveId]=useState(''),[sheet,setSheet]=useState(''),[headerRow,setHeaderRow]=useState(0),[file,setFile]=useState<File|null>(null),[title,setTitle]=useState(''),[viewIds,setViewIds]=useState<string[]>([]),[accessIds,setAccessIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const chosen=catalog.data?.archives.find(a=>a.id===archiveId);
 const query=useQuery<Query>({queryKey:['outsourcing-workbook-sheet',archiveId,sheet,headerRow],queryFn:()=>request('outsourcing-workbook-sheet?id='+encodeURIComponent(archiveId)+'&sheet='+encodeURIComponent(sheet)+'&headerRow='+headerRow),enabled:!!chosen&&!!sheet&&!catalog.isError});
 useEffect(()=>{setAccessIds(chosen?.viewMemberIds||[]);},[chosen?.id,chosen?.version]);
 const toggle=(values:string[],id:string)=>values.includes(id)?values.filter(v=>v!==id):[...values,id];
 const select=(value:string)=>{setArchiveId(value);setSheet('');setHeaderRow(0);setError('');};
 async function upload(){if(!file||busy)return;setBusy(true);setError('');setNotice('');try{const form=new FormData();form.set('file',file);form.set('title',title.trim()||file.name);form.set('viewMemberIds',JSON.stringify(viewIds));const result=await request('outsourcing-workbook-upload',form);await cache.invalidateQueries({queryKey:['outsourcing-workbooks']});select(result.archive.id);setFile(null);setTitle('');setViewIds([]);setNotice(result.alreadyPresent?'该原件已归档，沿用原记录和查看授权。':'原件归档完成；尚未生成外发、回货、质检或生产记录。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function saveAccess(){if(!chosen||busy)return;setBusy(true);setError('');try{await request('outsourcing-workbook-access',{id:chosen.id,version:chosen.version,viewMemberIds:accessIds});await cache.invalidateQueries({queryKey:['outsourcing-workbooks']});setNotice('已保存本原件的查看授权。');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 if(catalog.isPending)return <p role="status">正在读取外发原工作簿…</p>;
 if(catalog.isError)return <p role="alert">{(catalog.error as Error).message}</p>;
 const data=catalog.data;
 return <section className="owb-panel"><h2>外发原工作簿</h2><p>完整保存上传的Excel原件，支持逐表字段查询及原件下载。默认仅管理员可看；共享基础资料不会自动开放这里的订单和价格。</p>
  <Button variant="outline" disabled={catalog.isFetching} onClick={()=>void cache.invalidateQueries({queryKey:['outsourcing-workbooks']})}>刷新原件列表</Button>
  {data.canManage&&<details className="owb-upload"><summary>归档原工作簿</summary><label>标题<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)} disabled={busy}/></label><label>原件（无宏.xlsx，最大10 MiB）<input type="file" accept=".xlsx" disabled={busy} onChange={e=>setFile(e.target.files?.[0]||null)}/></label><details><summary>指定可查看成员（不选则仅管理员）</summary>{data.members.map(m=><label className="owb-member" key={m.id}><input type="checkbox" disabled={busy} checked={viewIds.includes(m.id)} onChange={()=>setViewIds(toggle(viewIds,m.id))}/>{m.name}</label>)}</details><Button disabled={busy||!file} onClick={()=>void upload()}>{busy?'正在保存…':'保存原件归档'}</Button></details>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
  <label>选择工作簿<select aria-label="选择外发原工作簿" value={archiveId} onChange={e=>select(e.target.value)}><option value="">请选择</option>{data.archives.map(a=><option key={a.id} value={a.id}>{a.title} · {dateTime(a.createdAt)}</option>)}</select></label>
  {!data.archives.length&&<p>暂无当前账号可查看的外发工作簿。</p>}
  {chosen&&<><p>{chosen.filename} · {(chosen.size/1024).toFixed(1)} KiB · {chosen.sheets.length} 张工作表</p><p className="owb-hash">SHA-256：{chosen.sha256}</p><a className="owb-download" href={'/api/workspace/outsourcing-workbook-file?id='+encodeURIComponent(chosen.id)}>下载完整原件，用Excel／WPS打开</a>
   {data.canManage&&<details><summary>管理本原件查看成员</summary>{data.members.map(m=><label className="owb-member" key={m.id}><input type="checkbox" checked={accessIds.includes(m.id)} disabled={busy} onChange={()=>setAccessIds(toggle(accessIds,m.id))}/>{m.name}</label>)}<Button disabled={busy} onClick={()=>void saveAccess()}>保存查看授权</Button></details>}
   <div className="owb-actions"><label>工作表<select aria-label="选择原工作表" value={sheet} onChange={e=>{setSheet(e.target.value);setHeaderRow(0);}}><option value="">请选择</option>{chosen.sheets.map(s=><option key={s.name} value={s.name}>{s.name}{s.state==='visible'?'':'（原隐藏）'}</option>)}</select></label><label>表头行（0为按列字母）<input aria-label="原工作表表头行" type="number" min={0} max={chosen.sheets.find(s=>s.name===sheet)?.rows||0} value={headerRow} onChange={e=>setHeaderRow(Math.max(0,Number(e.target.value)||0))}/></label></div>
   {sheet&&query.isPending&&<p role="status">正在核验原件并读取完整工作表字段…</p>}{query.isError&&<p role="alert">{(query.error as Error).message}</p>}{query.data&&!query.isError&&sheet&&<FieldQuery key={archiveId+'|'+sheet+'|'+headerRow} data={query.data}/>}
  </>}
 </section>;
}
