import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const SLASHY_MCP_URL = 'https://slashy.ctrlcenter.ai/mcp';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailers', 'transfer-encoding', 'upgrade', 'host', 'authorization', 'content-length']);

export type SlashyProxy = {
  port: number;
  url: string;
  close: () => Promise<void>;
};

function loopback(address: string | undefined) {
  return address === '127.0.0.1' || address === '::1' || address === ':ffff:127.0.0.1';
}

function forwardHeaders(req: IncomingMessage, token: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  for (const [name, value] of Object.entries(req.headers)) {
    if (!value || HOP.has(name) || Array.isArray(value)) continue;
    headers[name] = value;
  }
  return headers;
}

async function readBody(req: IncomingMessage, limit = 2_000_000) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function startSlashyProxy(opts: {
  getAccessToken: () => Promise<string>;
  refreshAccessToken: () => Promise<string>;
  upstream?: string;
  port?: number;
}): Promise<SlashyProxy> {
  const upstream = opts.upstream ?? SLASHY_MCP_URL;
  const server = createServer((req, res) => { void handle(req, res); });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!loopback(req.socket.remoteAddress ?? undefined)) {
      res.writeHead(403).end();
      return;
    }
    const path = req.url?.split('?')[0] ?? '';
    if (path === '/health') {
      res.writeHead(204).end();
      return;
    }
    if (path !== '/mcp' && path !== '/mcp/') {
      res.writeHead(404).end();
      return;
    }
    try {
      const body = req.method === 'GET' || req.method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);
      const send = async (token: string) => fetch(upstream, {
        method: req.method,
        headers: forwardHeaders(req, token),
        body: body.length ? body : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
      });
      let token = await opts.getAccessToken();
      let upstreamRes = await send(token);
      if (upstreamRes.status === 401) {
        token = await opts.refreshAccessToken();
        upstreamRes = await send(token);
      }
      const out: Record<string, string> = {};
      for (const [name, value] of upstreamRes.headers) {
        if (!HOP.has(name.toLowerCase())) out[name] = value;
      }
      res.writeHead(upstreamRes.status, out);
      if (!upstreamRes.body) {
        res.end();
        return;
      }
      const reader = upstreamRes.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.write(value)) await new Promise<void>(resolve => res.once('drain', resolve));
      }
      res.end();
    } catch {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Slashy proxy did not bind a local port'));
        return;
      }
      resolve({
        port: address.port,
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((done, fail) => server.close(error => error ? fail(error) : done())),
      });
    });
  });
}
