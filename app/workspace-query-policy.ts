import type {QueryClient} from '@tanstack/react-query';
// Business lists update on explicit refresh, changed query scope or a successful
// mutation's invalidation. Authentication and write-time validation stay separate.
export const workspaceQueryPolicy={
 retry:false,
 staleTime:Infinity,
 refetchInterval:false as const,
 refetchOnWindowFocus:false,
 refetchOnReconnect:false,
};

export async function refreshWorkspaceQueries(client:QueryClient,afterSharedRead:()=>Promise<void>){
 await client.invalidateQueries({refetchType:'none'});
 await client.refetchQueries({queryKey:['workspace'],exact:true,type:'active'},{cancelRefetch:false,throwOnError:true});
 // Give consumers time to select their new revision keys. Join any reads already
 // in flight rather than canceling them and issuing the same request twice.
 await afterSharedRead();
 await client.refetchQueries({type:'active',stale:true,predicate:query=>query.queryKey[0]!=='workspace'},{cancelRefetch:false});
}
