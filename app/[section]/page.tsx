import Workspace from '../workspace';
import {getChatGPTUser,chatGPTSignInPath} from '../chatgpt-auth';
import {notFound} from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Section({params}:{params:Promise<{section:string}>}){const {section}=await params;if(!['sales','service','factory-orders','customers','pmc-handoff','pmc','dashboard','department','receiving','completed','mine','imports','mes','reports','members'].includes(section))notFound();const user=await getChatGPTUser();return <Workspace initialView={section} identity={user?{id:user.userId,name:user.displayName,email:user.email}:null} signInUrl={chatGPTSignInPath('/'+section)}/>;}
