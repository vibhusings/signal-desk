'use client';

import { useEffect, useState } from 'react';
import { Mail, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ResumeSettings from './resume-settings';

type SlashyStatus = {
  configured: boolean;
  active: boolean;
  runnerError: string | null;
  updatedAt: string | null;
  expectedInbox: string | null;
  senderName: string | null;
  runnerOnline: boolean;
  exchangeReady: boolean;
};

export default function SlashySettings() {
  const [status, setStatus] = useState<SlashyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const response = await fetch('/api/slashy', { cache: 'no-store' });
    const body = await response.json() as SlashyStatus & { error?: string };
    if (!response.ok) throw new Error(body.error ?? 'Could not load Slashy status');
    setStatus(body);
    return body;
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('slashy');
    if (result === 'connected') setMessage('Slashy connected. Research and calendar will use this account.');
    if (result === 'denied') setError('Slashy sign-in was cancelled.');
    if (result === 'error') setError('Slashy sign-in did not complete. Please try again.');
    if (result) {
      params.delete('slashy');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', next);
    }
    let active = true;
    const load = () => refresh().catch(failure => { if (active) setError((failure as Error).message); });
    load();
    const timer = setInterval(load, 8000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  async function disconnect() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch('/api/slashy', { method: 'DELETE' });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not disconnect Slashy');
      setMessage('Slashy disconnected. Connect again before research or sending.');
      await refresh();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inbox = status?.expectedInbox;
  const ready = !!status?.runnerOnline && !!status?.exchangeReady;

  return <><section className="panel api-key-panel">
    <div className="credential-heading">
      <span className="connection-icon"><Mail size={20}/></span>
      <div>
        <h2>Slashy email & calendar</h2>
        <p className="muted">Connect your own Slashy account. Google sign-in happens on Slashy’s site; Signal Desk never sees your email password.</p>
      </div>
      <Badge variant="outline">{status?.active ? 'Connected' : status?.configured ? 'Encrypted · connecting' : 'Not connected'}</Badge>
    </div>
    {inbox && <p className="muted">Use the Google account for <strong>{inbox}</strong>{status?.senderName ? ` (${status.senderName})` : ''}. That is the From address this workspace is configured to use; connecting a different mailbox will not match.</p>}
    <div className="credential-actions">
      <Button disabled={busy || !ready} onClick={() => { window.location.assign('/api/slashy/connect'); }}>
        {status?.configured ? 'Reconnect Slashy' : 'Connect Slashy'}
      </Button>
      {status?.configured && <Button type="button" variant="outline" disabled={busy} onClick={disconnect}>Disconnect</Button>}
    </div>
    {!ready && <p className="muted">The cloud runner must be online before Slashy can be connected.</p>}
    <p className="credential-security"><ShieldCheck size={16}/>Tokens are encrypted to the cloud runner. Signal Desk stores only ciphertext and never displays the Slashy session again.</p>
    {status?.configured && <small>Updated {status.updatedAt ? new Date(status.updatedAt).toLocaleString() : 'recently'}.</small>}
    {status?.runnerError && <div className="error" role="alert">{status.runnerError}</div>}
    {message && <div className="notice" role="status">{message}</div>}
    {error && <div className="error" role="alert">{error}</div>}
  </section><ResumeSettings/></>;
}
