import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startSlashyProxy } from '../src/bridge/slashy-proxy.js';

const upstream = createServer((req, res) => {
  if (req.headers.authorization === 'Bearer expired') {
    res.writeHead(401, { 'WWW-Authenticate': 'Bearer' }).end('expired');
    return;
  }
  if (req.headers.authorization !== 'Bearer live-token') {
    res.writeHead(403).end('forbidden');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, path: req.url }));
});

await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('upstream did not bind');
const upstreamUrl = `http://127.0.0.1:${address.port}/mcp`;
let refreshed = 0;
const proxy = await startSlashyProxy({
  upstream: upstreamUrl,
  getAccessToken: async () => 'expired',
  refreshAccessToken: async () => { refreshed += 1; return 'live-token'; },
});
try {
  const response = await fetch(proxy.url, { method: 'POST', body: '{"jsonrpc":"2.0"}' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, path: '/mcp' });
  assert.equal(refreshed, 1);
  const denied = await fetch(proxy.url.replace('127.0.0.1', 'localhost').replace('/mcp', '/other'));
  assert.equal(denied.status, 404);
  console.log('Slashy localhost proxy injects Bearer tokens and retries once after 401.');
} finally {
  await proxy.close();
  await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
}
