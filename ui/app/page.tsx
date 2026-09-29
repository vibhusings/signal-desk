import Workspace from './workspace';
import { getChatGPTUser } from './chatgpt-auth';
import { pilotModeConfigured, pilotSessionValid } from '@/lib/pilot-auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
async function SignedInWorkspace() {
  const platformUser = await getChatGPTUser();
  const requestHeaders = await headers();
  const pilotUser = await pilotSessionValid(new Request('https://signal-desk.local/', { headers: requestHeaders }));
  if (pilotModeConfigured() ? !pilotUser : !platformUser) redirect('/access');
  return <Workspace />;
}
export default function Page() { return <SignedInWorkspace />; }
