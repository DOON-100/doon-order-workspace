import {createDeepSeek} from '@ai-sdk/deepseek';
import {createGuardedFetch,validateRun} from './transport.mjs';

export async function createP2Model({directory,thinking,caseId,phase}) {
  for(const name of ['DOON_DATA_DIR','DOON_SERVER_MODE','DOON_EMPLOYEE_PUBLIC_ORIGIN','DOON_TLS_KEY'])if(process.env[name])throw new Error('P2_BUSINESS_ENV_REJECTED');
  await validateRun(directory);
  const apiKey=process.env.DEEPSEEK_API_KEY;
  if(!apiKey || apiKey.trim()!==apiKey)throw new Error('P2_KEY_MISSING_OR_INVALID');
  const provider=createDeepSeek({apiKey,baseURL:'https://api.deepseek.com',fetch:createGuardedFetch({directory,thinking,caseId,phase})});
  return {
    model:provider('deepseek-v4-pro'),
    providerOptions:{deepseek:{thinking:{type:thinking},...(thinking==='enabled'?{reasoningEffort:'high'}:{})}},
  };
}
