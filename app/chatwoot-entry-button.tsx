'use client';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight} from 'lucide-react';
import {Button} from '@/components/ui/button';

export function ChatwootEntryButton({identityKey}:{identityKey:string}){
 const availability=useQuery({queryKey:['chatwoot-entry',identityKey],queryFn:async({signal})=>{
  try{
   const response=await fetch('/chatwoot/status',{signal,cache:'no-store',redirect:'error'});
   if(!response.ok||!response.headers.get('content-type')?.includes('application/json'))return false;
   const result:unknown=await response.json();
   return typeof result==='object'&&result!==null&&'enabled' in result&&result.enabled===true;
  }catch{return false;}
 },retry:false});
 if(!availability.data)return null;
 return <Button asChild variant="outline"><a data-chatwoot-entry href="/chatwoot/enter" target="_blank" rel="noopener noreferrer" aria-label="进入 Chatwoot（新标签页）">进入 Chatwoot <ArrowUpRight size={16}/></a></Button>;
}
