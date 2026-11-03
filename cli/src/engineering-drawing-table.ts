// Table values are projected without rewriting legacy records or exposing source columns.
export const drawingTypes=['改图','新款画图','印字资料','配件图','3D图','图纸确认，发图'];
export const drawingPeople=['邓铠','杨林峰','黄智翔'];
export const drawingTableColumns=[
 {header:'状态',field:'sheetStatus',values:['⌛️','❗❗'],completionAction:'approval-toggle'},
 {header:'客户编号',field:'customerCode'},
 {header:'画图类型',field:'drawingType'},
 {header:'需求发出时间',field:'requestedDate',format:'YYYY-MM-DD'},
 {header:'新款数量',field:'newCount',blank:null},
 {header:'改图数量',field:'revisionCount',blank:null},
 {header:'需求者',field:'requester',options:'references.requesters'},
 {header:'款号',field:'modelNo'},
 {header:'画图备注',field:'drawingNotes'},
 {header:'画图人员',field:'assignee',options:'references.assignees'},
 {header:'截止日期',field:'deadline',format:'YYYY-MM-DD'},
 {header:'完成日期',field:'completedDate',format:'YYYY-MM-DD'},
 {header:'老郑审批确认',field:'approval',action:'approval-toggle',inputField:'checked'},
];
export function drawingTableState(row:Record<string,any>){
 const sheetStatus=row.sheetStatus||(row.source?.rawColumns?.['状态']==='❗❗'?'❗❗':'⌛️');
 return {sheetStatus,displayStatus:row.approval==='通过'?'✅已完成':sheetStatus};
}
