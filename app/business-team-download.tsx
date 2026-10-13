'use client';

import {useRef,useState,type ComponentProps} from 'react';
import {Button} from '@/components/ui/button';
import {downloadBusinessTeamFile} from './business-team-client';

type Props=Omit<ComponentProps<typeof Button>,'asChild'|'onClick'>&{href:string;filename?:string};

export function BusinessTeamDownloadButton({href,filename='导出.xlsx',children,disabled,...props}:Props){
 const running=useRef(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function download(){
  if(running.current)return;
  running.current=true;setBusy(true);setError('');
  try{await downloadBusinessTeamFile(href,filename);}catch(cause){setError(cause instanceof Error?cause.message:'导出失败，请重试。');}
  finally{running.current=false;setBusy(false);}
 }
 return <><Button {...props} disabled={disabled||busy} onClick={()=>void download()}>{busy?'正在导出…':children}</Button>{error&&<span className="error" role="alert">{error}</span>}</>;
}
