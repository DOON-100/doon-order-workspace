import {request} from './ui';

// The board and editors share authorized responses for this account. Mutations
// explicitly recheck them; switching tabs does not download the same feed again.
export const engineeringDataKey=(memberId:string)=>['engineering-department-index',memberId] as const;
export function engineeringDataQuery<T>(memberId:string,action:'drawing-data'|'sop-data'){
 return {queryKey:[...engineeringDataKey(memberId),action],queryFn:({signal}:{signal:AbortSignal})=>request(action,undefined,{signal}) as Promise<T>,staleTime:Infinity,retry:false as const};
}
