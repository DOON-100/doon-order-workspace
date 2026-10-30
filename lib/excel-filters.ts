/** Serializable read-only filters. Callers supply the complete authorized list before paging. */
export type ExcelCondition=
  | {kind:'text';operator:'contains'|'notContains'|'equals'|'notEquals'|'startsWith'|'endsWith';value:string}
  | {kind:'number';operator:'equals'|'notEquals'|'gt'|'gte'|'lt'|'lte'|'between';value:string;to?:string}
  | {kind:'date';operator:'equals'|'before'|'after'|'between';value:string;to?:string}
  | {kind:'blank';operator:'empty'|'notEmpty'};
export type ExcelColumnFilter=string[]|ExcelCondition;
export type ExcelFilters=Record<number,ExcelColumnFilter>;
export type ExcelFilterValue={excelFilterValue:true;display:string;raw:unknown;type:'text'|'number'|'date'|'boolean'|'blank'|'error'|'unknown'};
function typed(value:unknown):value is ExcelFilterValue{return !!value&&typeof value==='object'&&'excelFilterValue' in value&&value.excelFilterValue===true;}

export function normalizeExcelValue(value:unknown):string {
  if(typed(value))return normalizeExcelValue(value.display);
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.toISOString():'';
  return String(value??'').replace(/\s+/gu,' ').trim();
}

/** Reject labels, partial numeric strings and blank values instead of coercing them to zero. */
export function excelNumber(value:unknown):number|null {
  if(typed(value))return value.type==='number'&&typeof value.raw==='number'&&Number.isFinite(value.raw)?value.raw:null;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  const text=normalizeExcelValue(value);
  if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(text)&&!/^[+-]?\.\d+%?$/.test(text))return null;
  const number=Number(text.replace(/,/g,'').replace(/%$/,''))/(text.endsWith('%')?100:1);
  return Number.isFinite(number)?number:null;
}

/** Compare the displayed business date, not the browser's local timezone conversion. */
export function excelDate(value:unknown):number|null {
  if(typed(value))return value.type==='date'?excelDate(value.raw):null;
  const text=normalizeExcelValue(value),match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:$|[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$)/.exec(text);
  if(!match)return null;
  const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
  const stamp=new Date(0);stamp.setUTCHours(0,0,0,0);stamp.setUTCFullYear(year,month-1,day);
  if(stamp.getUTCFullYear()!==year||stamp.getUTCMonth()!==month-1||stamp.getUTCDate()!==day)return null;
  return stamp.getTime();
}

export function excelConditionError(condition:ExcelCondition):string {
  if(condition.kind==='blank')return '';
  if(condition.kind==='text')return normalizeExcelValue(condition.value)?'':'请输入筛选文字';
  const parse=condition.kind==='number'?excelNumber:excelDate;
  const first=parse(condition.value);
  if(first===null)return condition.kind==='number'?'请输入完整数值，可使用千分位或百分号':'请选择有效日期';
  if(condition.operator==='between'){
    const last=parse(condition.to);
    if(last===null)return condition.kind==='number'?'请输入区间上限':'请选择结束日期';
    if(first>last)return '起始值不能大于结束值';
  }
  return '';
}

export function matchesExcelColumn(value:unknown,filter:ExcelColumnFilter):boolean {
  const text=normalizeExcelValue(value);
  if(Array.isArray(filter))return filter.includes(text);
  if(excelConditionError(filter))return false;
  if(filter.kind==='blank'){const empty=typed(value)?value.type==='blank':text==='';return filter.operator==='empty'?empty:!empty;}
  if(filter.kind==='text'){
    const actual=text.toLocaleLowerCase(),expected=normalizeExcelValue(filter.value).toLocaleLowerCase();
    switch(filter.operator){
      case 'contains':return actual.includes(expected);
      case 'notContains':return !actual.includes(expected);
      case 'equals':return actual===expected;
      case 'notEquals':return actual!==expected;
      case 'startsWith':return actual.startsWith(expected);
      case 'endsWith':return actual.endsWith(expected);
    }
  }
  const parse=filter.kind==='number'?excelNumber:excelDate;
  const actual=parse(value),expected=parse(filter.value);
  if(actual===null||expected===null)return false;
  switch(filter.operator){
    case 'equals':return actual===expected;
    case 'notEquals':return actual!==expected;
    case 'gt':case 'after':return actual>expected;
    case 'gte':return actual>=expected;
    case 'lt':case 'before':return actual<expected;
    case 'lte':return actual<=expected;
    case 'between':{const last=parse(filter.to);return last!==null&&actual>=expected&&actual<=last;}
  }
}

export function matchesExcelFilters(values:unknown[],filters:ExcelFilters):boolean {
  return Object.entries(filters).every(([column,filter])=>matchesExcelColumn(values[Number(column)],filter));
}

export function describeExcelFilter(filter:ExcelColumnFilter):string {
  if(Array.isArray(filter))return filter.length?filter.map(value=>value||'（空白）').join('、'):'不选择任何值';
  if(filter.kind==='blank')return filter.operator==='empty'?'空白':'非空';
  const labels:Record<string,string>={contains:'包含',notContains:'不包含',equals:'等于',notEquals:'不等于',startsWith:'开头是',endsWith:'结尾是',gt:'大于',gte:'大于等于',lt:'小于',lte:'小于等于',before:'早于',after:'晚于',between:'区间'};
  return `${labels[filter.operator]} ${filter.value}${filter.operator==='between'?' 至 '+filter.to:''}`;
}
