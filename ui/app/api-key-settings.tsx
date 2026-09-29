'use client';

import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CredentialStatus = {
  mode: 'api' | 'subscription';
  effectiveMode: 'api' | 'subscription';
  personalTestingAvailable: boolean;
  subscription: {ready:boolean;error:string|null};
  configured: boolean;
  active: boolean;
  runnerError: string | null;
  updatedAt: string | null;
  keyId: string | null;
  runnerOnline: boolean;
  exchange: { algorithm:string;keyId:string;publicKey:string } | null;
};

function decodePem(pem: string) {
  const encoded = pem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function encodeBase64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function encryptApiKey(apiKey: string, publicKey: string) {
  const key = await crypto.subtle.importKey(
    'spki',
    decodePem(publicKey),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt'],
  );
  return encodeBase64(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, key, new TextEncoder().encode(apiKey)));
}

export default function ApiKeySettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const response = await fetch('/api/credentials', { cache: 'no-store' });
    const body = await response.json() as CredentialStatus & { error?:string };
    if (!response.ok) throw new Error(body.error ?? 'Could not load Claude key status');
    setStatus(body);
    return body;
  }

  useEffect(() => {
    let active = true;
    fetch('/api/credentials', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as CredentialStatus & { error?:string };
        if (!response.ok) throw new Error(body.error ?? 'Could not load Claude key status');
        if (active) setStatus(body);
      })
      .catch(failure => { if (active) setError((failure as Error).message); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (apiKey.length < 20 || apiKey.length > 400 || /\s/.test(apiKey)) {
      setError('Enter a valid Anthropic API key without spaces.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const current = await refresh();
      if (!current.runnerOnline || !current.exchange || current.exchange.algorithm !== 'RSA-OAEP-256') {
        throw new Error('The cloud runner must be online before adding a Claude key.');
      }
      const ciphertext = await encryptApiKey(apiKey, current.exchange.publicKey);
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: current.exchange.keyId, ciphertext }),
      });
      const body = await response.json() as { error?:string };
      if (!response.ok) throw new Error(body.error ?? 'Could not save the encrypted key');
      setApiKey('');
      setMessage('Claude key encrypted for the cloud runner.');
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/credentials', { method: 'DELETE' });
      const body = await response.json() as { error?:string };
      if (!response.ok) throw new Error(body.error ?? 'Could not remove the key');
      setMessage('Claude key removed. Research jobs are paused until another key is added.');
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function switchMode(mode:'api'|'subscription') {
    setBusy(true);setError('');setMessage('');
    try {
      const r=await fetch('/api/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode})});
      const b=await r.json() as {error?:string};if(!r.ok)throw Error(b.error);
      setMessage('Mode saved. The worker applies it after its current job finishes. Existing campaigns and schedules remain enabled.');
      await refresh();
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }

  return <section className="panel api-key-panel">
    <div className="credential-heading">
      <span className="connection-icon"><KeyRound size={20}/></span>
      <div><h2>Claude connection</h2><p className="muted">Choose the account used for research, emails and CRM extraction.</p></div>
      <Badge variant="outline">{status?.mode==='subscription' ? (status.effectiveMode!=='subscription'?'Switch pending':status.subscription.ready?'Subscription signed in':'Subscription login needed') : status?.active ? 'API active' : status?.configured ? 'Encrypted · connecting' : 'Not configured'}</Badge>
    </div>
    <label>Claude mode <select aria-label="Claude mode" disabled={busy||!status?.runnerOnline} value={status?.mode??'api'} onChange={e=>void switchMode(e.target.value as 'api'|'subscription')}><option value="api">Anthropic API key</option><option value="subscription" disabled={!status?.personalTestingAvailable}>Personal testing with Claude subscription</option></select></label>
    {status?.mode==='subscription'&&<p>Uses your own Claude Code login on the worker. Sign in there with <code>claude auth login</code> through Anthropic’s login flow. Subscription limits apply; there is no automatic API fallback. This shared pilot uses the selected mode for all jobs. {status.subscription.error}</p>}
    <Button type="button" variant="outline" disabled={busy} onClick={()=>void refresh().catch(e=>setError(e.message))}>Refresh connection</Button>
    <form onSubmit={save}>
      <label>Anthropic API key
        <Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} maxLength={400} />
      </label>
      <div className="credential-actions">
        <Button type="submit" disabled={busy || !status?.runnerOnline || apiKey.length < 20}>{busy ? 'Saving…' : 'Encrypt for runner'}</Button>
        {status?.configured && <Button type="button" variant="outline" disabled={busy} onClick={remove}>Remove key</Button>}
      </div>
    </form>
    <p className="credential-security"><ShieldCheck size={16}/>The browser encrypts this key to the runner. Signal Desk stores only ciphertext and never displays the key again.</p>
    {status?.configured && <small>Updated {status.updatedAt ? new Date(status.updatedAt).toLocaleString() : 'recently'}.</small>}
    {status?.runnerError && <div className="error" role="alert">{status.runnerError}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
