import React, {Fragment, StrictMode, useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ExcelTable, useExcelColumnFilters} from '../app/excel-table';

type RecordRow = {id:string; customer:string; status:string; quantity:number; date:string};
const initialRecords:RecordRow[] = Array.from({length:65}, (_, index) => ({
  id:`SYNTHETIC-${String(index+1).padStart(3, '0')}`,
  customer:index===64?'末页客户':index%2?'合成乙':'合成甲',
  status:index%3?'进行中':'已完成',
  quantity:index,
  date:index%7?'2026-10-30':'',
}));

function Fixture(){
  const dialog=useRef<HTMLDialogElement>(null);
  const [records,setRecords]=useState(initialRecords);
  const [page,setPage]=useState(0);
  const [alternate,setAlternate]=useState(false);
  const [rawRows,setRawRows]=useState([
    {id:'raw-a',customer:'合成甲',status:'进行中',quantity:0},
    {id:'raw-b',customer:'合成乙',status:'已完成',quantity:20},
    {id:'raw-c',customer:'合成丙',status:'',quantity:30},
  ]);
  const [selected,setSelected]=useState<string[]>([]);
  const [eventCount,setEventCount]=useState(0);
  const [draft,setDraft]=useState('原始草稿');
  const [showRaw,setShowRaw]=useState(true);
  const model=useExcelColumnFilters(records,row=>alternate?[row.customer,row.id,row.quantity,row.status,row.date]:[row.id,row.customer,row.status,row.quantity,row.date]);
  useEffect(()=>setPage(0),[model.filters]);
  const pageCount=Math.max(1,Math.ceil(model.rows.length/10));
  const currentPage=Math.min(page,pageCount-1);
  return <main>
    <h1>Excel 表头筛选验收</h1>
    <p className="test-banner">测试环境，不含正式业务数据。所有记录均为合成示例；本页不会连接业务 API。</p>
    <section>
      <h2>全量筛选后分页 · 65 条合成记录</h2>
      <p>筛选“客户 = 末页客户”应找到第 65 条；筛选“数量 = 0”应保留零值。</p>
      <div className="fixture-actions">
        <button onClick={()=>setRecords(rows=>[...rows,{id:'SYNTHETIC-NEW',customer:'刷新客户',status:'进行中',quantity:99,date:''}])}>增加合成记录</button>
        <button onClick={()=>{model.clearFilters();setAlternate(value=>!value);}}>切换字段顺序</button>
      </div>
      <div className="fixture-scroll"><ExcelTable key={alternate?'alternate':'normal'} filterModel={model} aria-label="分页合成列表">
        <thead><tr>{(alternate?['客户','编号','数量','状态','日期']:['编号','客户','状态','数量','日期']).map(label=><th key={label}>{label}</th>)}</tr></thead>
        <tbody>{model.rows.slice(currentPage*10,(currentPage+1)*10).map(row=><tr key={row.id} data-record-id={row.id}>{(alternate?[row.customer,row.id,row.quantity,row.status,row.date]:[row.id,row.customer,row.status,row.quantity,row.date]).map((value,index)=><td key={index}>{value}</td>)}</tr>)}</tbody>
      </ExcelTable></div>
      <div className="fixture-actions"><output aria-label="分页计数">{model.rows.length} 条 · 第 {currentPage+1} / {pageCount} 页</output><button disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>上一页</button><button disabled={currentPage+1>=pageCount} onClick={()=>setPage(currentPage+1)}>下一页</button></div>
    </section>
    <section>
      <h2>原位筛选 · 编辑、选择及关联行保留</h2>
      <div className="fixture-actions"><button onClick={()=>setRawRows(rows=>[...rows,{id:'raw-new',customer:'新增合成',status:'进行中',quantity:40}])}>刷新原位列表</button><button onClick={()=>setShowRaw(value=>!value)}>切换原位表格显示</button><output aria-label="业务操作计数">业务操作 {eventCount} 次</output><output aria-label="已选记录">已选 {selected.join(',')||'无'}</output><output aria-label="草稿内容">草稿：{draft}</output></div>
      {showRaw&&<div className="fixture-scroll"><ExcelTable aria-label="原位合成列表"><thead><tr><th><input aria-label="原位全选占位" type="checkbox"/></th><th>客户</th><th>状态</th><th>数量</th><th>编辑备注</th><th>操作</th></tr></thead><tbody>{rawRows.map(row=><Fragment key={row.id}>
        <tr data-record-id={row.id}><td><input aria-label={'选择'+row.customer} type="checkbox" checked={selected.includes(row.id)} onChange={event=>setSelected(ids=>event.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/></td><td><b>{row.customer}</b></td><td>{row.status}</td><td>{row.quantity}</td><td>{row.id==='raw-a'?<input aria-label="合成甲备注" value={draft} onChange={event=>setDraft(event.target.value)}/>:<input aria-label={row.customer+'备注'} defaultValue={row.customer+'草稿'}/>}</td><td><button onClick={()=>setEventCount(value=>value+1)}>查看详情</button></td></tr>
        <tr className="business-followup-record-row" data-companion-id={row.id}><td colSpan={6}>附件与沟通：{row.customer} · 必须随主记录一起筛选</td></tr>
      </Fragment>)}</tbody><tfoot><tr><td colSpan={6}>汇总行保持原业务口径</td></tr></tfoot></ExcelTable></div>}
    </section>
    <section>
      <h2>合并表头及关联明细</h2>
      <div className="fixture-scroll"><ExcelTable aria-label="合并表头合成列表"><thead><tr><th rowSpan={2}>订单</th><th colSpan={2}>产品字段</th></tr><tr><th>颜色</th><th>材质</th></tr></thead><tbody>
        <tr><td rowSpan={2}>合成组合甲</td><td>红色</td><td>板材</td></tr><tr><td>蓝色</td><td>钛</td></tr>
        <tr><td>合成组合乙</td><td>黑色</td><td>不锈钢</td></tr>
      </tbody></ExcelTable></div>
    </section>
    <section><h2>原生弹窗与双层筛选表头</h2><button onClick={()=>dialog.current?.showModal()}>打开合成弹窗</button>
      <dialog ref={dialog} aria-label="合成表格弹窗"><h3>弹窗内表头筛选</h3><p>测试环境，不含正式业务数据</p><button onClick={()=>dialog.current?.close()}>关闭合成弹窗</button>
        <ExcelTable aria-label="弹窗合成列表"><thead><tr><th>弹窗客户</th><th>弹窗状态</th></tr><tr><td><input aria-label="原有客户搜索" placeholder="保留原有搜索"/></td><td><select aria-label="原有状态筛选"><option>全部</option><option>进行中</option></select></td></tr></thead><tbody><tr><td>弹窗甲</td><td>进行中</td></tr><tr><td>弹窗乙</td><td>已完成</td></tr></tbody></ExcelTable>
      </dialog>
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>);
