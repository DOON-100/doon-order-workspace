import {AppError,database} from './store';

// Login names come from the server's account directory, never from member names,
// request headers, or client-supplied candidate lists.
export async function drawingRequesters():Promise<string[]|null>{
 const db=database() as ReturnType<typeof database>&{drawingRequesters?:()=>string[]|Promise<string[]>};
 return db.drawingRequesters?await db.drawingRequesters():null;
}

export async function validateDrawingRequester(requester:string){
 if(!requester)return;
 const names=await drawingRequesters();
 if(names===null)throw new AppError('内部登录账号目录暂不可用，无法校验需求者，请稍后重试。',503);
 if(!names.includes(requester))throw new AppError('需求者账号无效：请填写系统内有效的内部登录账号名，不能填写姓名或自定义文字。');
}
