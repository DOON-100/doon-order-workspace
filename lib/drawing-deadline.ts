/** Business days after the written request date. Monday–Saturday count; Sunday is skipped. */
export function drawingDeadline(drawingType:string,requestedDate:string):string{
 if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate))throw new Error('无效的需求发出时间。');
 const cursor=new Date(requestedDate+'T00:00:00Z');
 if(!Number.isFinite(cursor.getTime())||cursor.toISOString().slice(0,10)!==requestedDate)throw new Error('无效的需求发出时间。');
 let remaining=drawingType.trim()==='新款画图'?7:3;
 while(remaining){cursor.setUTCDate(cursor.getUTCDate()+1);if(cursor.getUTCDay()!==0)remaining--;}
 return cursor.toISOString().slice(0,10);
}
