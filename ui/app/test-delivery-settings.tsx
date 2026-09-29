'use client';
import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

/** Route every newly approved campaign to one address the owner controls. */
export default function TestDeliverySettings() {
  const [saved, setSaved] = useState<string | null>(null), [value, setValue] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { fetch('/api/pipeline').then(r => r.json()).then((d: any) => { setSaved(d.demoRecipient ?? ''); setValue(d.demoRecipient ?? ''); }).catch(() => setError('Could not load test delivery settings.')); }, []);
  async function save(demoRecipient: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetch('/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', demoRecipient }) });
      const d: any = await r.json(); if (!r.ok) throw Error(d.error);
      setSaved(d.demoRecipient); setValue(d.demoRecipient);
      setNotice(d.demoRecipient ? `Newly approved emails will go to ${d.demoRecipient}.` : 'Test delivery is off. Newly approved emails go to the real contacts.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel api-key-panel">
    <div className="credential-heading"><span className="connection-icon"><FlaskConical size={20} /></span><div><h2>Test delivery</h2><p className="muted">Send approved outreach to your own inbox instead of the real contacts, so you can reply and watch meeting booking work.</p></div><Badge variant="outline">{saved === null ? 'Loading' : saved ? 'On' : 'Off'}</Badge></div>
    <form onSubmit={e => { e.preventDefault(); void save(value.trim()); }}>
      <label>Deliver all approved outreach to<Input type="email" placeholder="you@example.com" value={value} onChange={e => setValue(e.target.value)} /></label>
      <div className="credential-actions"><Button type="submit" disabled={busy || value.trim() === (saved ?? '')}>Save</Button>{saved && <Button type="button" variant="outline" disabled={busy} onClick={() => void save('')}>Turn off</Button>}</div>
    </form>
    <small>The address is fixed per contact when you approve. Turning this off later never redirects an existing test campaign to the real contact.</small>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
  </section>;
}
