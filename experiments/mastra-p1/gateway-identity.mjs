import {randomBytes} from 'node:crypto';
import {createProjectGatewayLab} from './project-gateway.mjs';
import {projectAuthSnapshot} from './project-auth.mjs';
import {assertIsolatedEnvironment} from './sandbox.mjs';

const cookieName='doon_employee_session', ttl=12*3_600_000, idleTtl=2*3_600_000;
const fail=(code,status=401)=>{throw Object.assign(new Error(code),{status});};
const snapshot=state=>JSON.stringify(projectAuthSnapshot(state));
function bodyOf(response) {
  if(response.status!==200)fail('GATEWAY_AUTH_REJECTED',[400,401,403,409,429].includes(response.status)?response.status:503);
  try{return JSON.parse(response.body);}catch{fail('GATEWAY_AUTH_PROTOCOL',503);}
}
function tokenOf(response) {
  bodyOf(response);
  const cookies=response.headers['set-cookie'];
  if(!Array.isArray(cookies)||cookies.length!==1)fail('GATEWAY_AUTH_COOKIE',503);
  const cookie=cookies[0],match=cookie.match(/^doon_employee_session=([A-Za-z0-9_-]{43});/);
  if(!match||!/; Secure(?:;|$)/i.test(cookie)||!/; HttpOnly(?:;|$)/i.test(cookie)||!/; SameSite=Strict(?:;|$)/i.test(cookie)||/; Domain=/i.test(cookie))fail('GATEWAY_AUTH_COOKIE',503);
  return match[1];
}

/**
 * Synthetic HTTP integration, never a configurable production SSO client.
 * Creates its own gateway/database; accepts no URL, database or port option.
 * P1 holds the employee token privately and revalidates the real session and
 * trusted member context on each use. No credential is sent to a model.
 */
export async function createGatewayIdentity(options={}) {
  if(!options||Object.keys(options).some(key=>!['state','adapter'].includes(key)))fail('GATEWAY_IDENTITY_CONFIGURATION',400);
  const {state,adapter}=options;
  assertIsolatedEnvironment();snapshot(state);
  if(typeof adapter?.actor!=='function')fail('GATEWAY_IDENTITY_CONFIGURATION',400);
  const lab=await createProjectGatewayLab({state}),sessions=new Map();
  let closed=false,closing,queue=Promise.resolve();
  const cookie=token=>({cookie:cookieName+'='+token});
  const serial=operation=>{
    if(closed)return Promise.reject(Object.assign(new Error('GATEWAY_IDENTITY_CLOSED'),{status:503}));
    const pending=queue.then(operation);queue=pending.catch(()=>{});return pending;
  };
  const logoutRemote=token=>lab.request('/api/auth/logout',{method:'POST',body:{},headers:cookie(token)}).then(bodyOf);
  async function actorFor(token,binding) {
    // The UI must expire its cached DTOs at the idle boundary as well. Start
    // before validation so neither network latency nor clock rounding extends it.
    const validationStartedAt=Date.now();
    const user=bodyOf(await lab.request('/api/auth/session',{headers:cookie(token)})).user;
    if(!user||user.mustChange||user.identity?.id!==binding.userId||user.username!==binding.username)fail('GATEWAY_SESSION_INVALID');
    const probe=bodyOf(await lab.request('/api/workspace/probe',{headers:cookie(token)}));
    if(probe.syntheticOnly!==true||probe.identityProbe!==true||probe.trustedIdentity!==true||probe.actor?.id!==binding.actorId)fail('GATEWAY_MEMBER_BINDING',503);
    const actor=adapter.actor(binding.actorId);
    if(actor.id!==probe.actor.id||actor.name!==probe.actor.name||actor.role!==probe.actor.role||actor.role!==user.role||user.identity.name!==actor.name)fail('GATEWAY_MEMBER_CHANGED',409);
    return {id:actor.id,name:actor.name,role:actor.role,sessionExpiresAt:Math.min(binding.expiresAt,validationStartedAt+idleTtl)};
  }
  try {
    const credentials=[];
    // Complete first-password change through the original route, not SQL edits.
    for(const item of lab.credentials) {
      const member=state.records.find(row=>row.kind==='member'&&row.id===item.actorId);
      if(!member?.active||member.role==='supplier')continue;
      const first=await lab.request('/api/auth/login',{method:'POST',body:{username:item.username,password:item.password}});
      if(bodyOf(first).user?.mustChange!==true)fail('GATEWAY_INITIAL_PASSWORD_REQUIRED',503);
      const initialToken=tokenOf(first),password='Syn-'+randomBytes(24).toString('base64url')+'-9a!';
      const changed=await lab.request('/api/auth/password',{method:'POST',body:{currentPassword:item.password,password},headers:cookie(initialToken)});
      await logoutRemote(tokenOf(changed));
      credentials.push(Object.freeze({actorId:item.actorId,userId:item.userId,username:item.username,password}));
    }
    const byUsername=new Map(credentials.map(item=>[item.username,item]));
    const identity=Object.freeze({
      sessionTtlMs:ttl,
      login(input) {return serial(async()=>{
        if(!input||Array.isArray(input)||Object.keys(input).sort().join(',')!=='password,username'||typeof input.username!=='string'||typeof input.password!=='string'||input.username.length>100||input.password.length>128)fail('GATEWAY_LOGIN_FIELDS',400);
        const before=snapshot(state);await lab.syncState();
        const issuedBefore=Date.now();
        const response=await lab.request('/api/auth/login',{method:'POST',body:input}),token=tokenOf(response);
        try {
          // Use the username verified and normalized by the original login route.
          const credential=byUsername.get(bodyOf(response).user?.username);if(!credential)fail('GATEWAY_ACCOUNT_BINDING');
          const binding={...credential,expiresAt:issuedBefore+ttl};
          const actor=await actorFor(token,binding);
          if(snapshot(state)!==before)fail('GATEWAY_SOURCE_CHANGED',409);
          // Keep only identity fields in the session registry, never passwords.
          sessions.set(token,{actorId:binding.actorId,userId:binding.userId,username:binding.username,expiresAt:binding.expiresAt});
          return {token,actor};
        } catch(error) {await logoutRemote(token);throw error;}
      });},
      resolveSession(token) {return serial(async()=>{
        const binding=sessions.get(token);
        if(!binding||binding.expiresAt<=Date.now())fail('GATEWAY_SESSION_INVALID');
        const before=snapshot(state);await lab.syncState();
        const actor=await actorFor(token,binding);
        if(snapshot(state)!==before)fail('GATEWAY_SOURCE_CHANGED',409);
        return actor;
      });},
      logout(token) {return serial(async()=>{if(!/^[A-Za-z0-9_-]{43}$/.test(token))fail('GATEWAY_SESSION_INVALID');await logoutRemote(token);sessions.delete(token);});},
      close() {if(!closing)closing=(async()=>{closed=true;await queue;sessions.clear();await lab.close();})();return closing;},
    });
    return {identity,credentials:Object.freeze(credentials),evidence:Object.freeze({...lab.evidence,implementation:'synthetic-project-gateway-http',persistentBridgeSessions:false})};
  } catch(error) {await lab.close();throw error;}
}
