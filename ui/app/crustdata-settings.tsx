'use client';

import { encryptSlashyEnvelope } from '@/lib/slashy-envelope';
import { FormEvent, useEffect, useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type CredentialStatus = {
  configured: boolean;
  active: boolean;
  runnerError: string | null;
  updatedAt: string | null;
  keyId: string | null;
  runnerOnline: boolean;
  exchange: { algorithm:string;keyId:string;publicKey:string } | null;
};

export default function CrustdataSettings() {
  const [status, setStatus] = useState<CredentialStatus | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const response = await fetch('/api/crustdata', { cache: 'no-store' });
    const body = await response.json() as CredentialStatus & { error?:string };
    if (!response.ok) throw new Error(body.error ?? 'Could not load Crustdata key status');
    setStatus(body);
    return body;
  }

  useEffect(() => {
    let active = true;
    fetch('/api/crustdata', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json() as CredentialStatus & { error?:string };
        if (!response.ok) throw new Error(body.error ?? 'Could not load Crustdata key status');
        if (active) setStatus(body);
      })
      .catch(failure => { if (active) setError((failure as Error).message); });
    const timer = setInterval(() => { void refresh().catch(() => {}); }, 10000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (apiKey.length < 20 || apiKey.length > 4096 || /\s/.test(apiKey)) {
      setError('Enter a valid Crustdata API key without spaces.');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const current = await refresh();
      if (!current.runnerOnline || !current.exchange || current.exchange.algorithm !== 'RSA-OAEP-256') {
        throw new Error('The cloud runner must be online before adding a Crustdata key.');
      }
      const ciphertext = await encryptSlashyEnvelope(current.exchange.publicKey, current.exchange.keyId, apiKey);
      const response = await fetch('/api/crustdata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: current.exchange.keyId, ciphertext }),
      });
      const body = await response.json() as { error?:string };
      if (!response.ok) throw new Error(body.error ?? 'Could not save the encrypted key');
      setApiKey('');
      setMessage('Crustdata key encrypted for the cloud runner.');
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
      const response = await fetch('/api/crustdata', { method: 'DELETE' });
      const body = await response.json() as { error?:string };
      if (!response.ok) throw new Error(body.error ?? 'Could not remove the key');
      setMessage('Crustdata key removed. Future scans use web research only.');
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel api-key-panel">
    <div className="credential-heading">
      <span className="connection-icon"><KeyRound size={20}/></span>
      <div><h2>Crustdata API key</h2><p className="muted">Optional company discovery for Signals. Claude and Slashy are still required to investigate candidates.</p></div>
      <Badge variant="outline">{status?.active ? 'Key loaded' : status?.configured ? 'Encrypted · connecting' : 'Not configured'}</Badge>
    </div>
    <p>Each manual or scheduled scan makes at most one Crustdata company search, requesting up to 10 companies. This uses provider credits. No automatic pagination, enrichment calls, or Watcher subscriptions. Key loaded means decrypted; API access is checked when you run a scan.</p>
    <form onSubmit={save}>
      <label>Crustdata API key
        <Input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Paste your Crustdata API key" autoComplete="off" spellCheck={false} maxLength={4096} />
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
