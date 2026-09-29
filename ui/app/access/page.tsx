'use client';

import { FormEvent, useState } from 'react';
import { Radar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function PilotAccessPage() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/pilot-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'Could not open the pilot workspace');
      window.location.replace('/');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <main className="access-page">
    <section className="access-card">
      <div className="brand access-brand"><span className="brand-icon"><Radar size={23}/></span>signal<span className="brand-light">desk</span></div>
      <div className="eyebrow">PRIVATE PILOT</div>
      <h1>Open your test workspace</h1>
      <p>Your research, Google connections, and outreach activity stay in this isolated pilot workspace.</p>
      <form onSubmit={submit}>
        <label>Access code
          <Input type="password" value={code} onChange={event => setCode(event.target.value)} minLength={8} maxLength={128} required autoComplete="current-password" autoFocus />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <Button type="submit" disabled={busy || code.length < 8}>{busy ? 'Opening…' : 'Open workspace'}</Button>
      </form>
      <small>Only use a code sent directly by the workspace owner.</small>
    </section>
  </main>;
}
