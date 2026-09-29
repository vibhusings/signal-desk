import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export type ClaudeMode = 'api' | 'subscription';
/** No API keys or OAuth tokens are forwarded in personal mode. Claude owns login. */
export function subscriptionEnv(): NodeJS.ProcessEnv {
 return {HOME:process.env.HOME,PATH:process.env.PATH,USER:process.env.USER};
}
export async function subscriptionStatus(bin:string):Promise<{ready:boolean;error:string|null}> {
 try {
  const {stdout}=await exec(bin,['auth','status','--json'],{env:subscriptionEnv(),timeout:15000,maxBuffer:16384});
  const status=JSON.parse(stdout);
  if(status.loggedIn===true&&status.authMethod==='claude.ai'&&status.subscriptionType)return {ready:true,error:null};
 } catch {}
 return {ready:false,error:'Sign in to Claude Code with your subscription on the worker using claude auth login, then refresh. An API login does not enable personal mode.'};
}
