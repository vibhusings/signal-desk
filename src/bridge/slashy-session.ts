import { renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decryptSlashyTokens, encryptSlashyTokens, type SlashyTokenBundle } from './envelope.js';
import { startSlashyProxy, type SlashyProxy } from './slashy-proxy.js';
import { refreshSlashyTokens, revokeSlashyTokens } from './slashy-tokens.js';

function writeAtomic(path: string, contents: string) {
  writeFileSync(path + '.tmp', contents, { mode: 0o600 });
  renameSync(path + '.tmp', path);
}

export type SlashyStatus = {
  connected: boolean;
  error: string | null;
};

export type SlashyRuntime = {
  status: () => SlashyStatus;
  ready: () => boolean;
  applyRecord: (record: { keyId: string; ciphertext: string; updatedAt: string } | null) => Promise<void>;
  close: () => Promise<void>;
};

export async function startSlashyRuntime(opts: {
  directory: string;
  privateKey: string;
  publicKey: string;
  keyId: string;
  required: boolean;
  persist: (ciphertext: string, clientId: string) => Promise<void>;
}): Promise<SlashyRuntime> {
  let tokens: SlashyTokenBundle | null = null;
  let updatedAt = '';
  let error: string | null = null;
  let refreshing: Promise<string> | null = null;
  const emptyPath = resolve(opts.directory, 'slashy-mcp-empty.json');
  const livePath = resolve(opts.directory, 'slashy-mcp.json');
  writeAtomic(emptyPath, JSON.stringify({ mcpServers: {} }));

  const proxy: SlashyProxy = await startSlashyProxy({
    getAccessToken: () => accessToken(false),
    refreshAccessToken: () => accessToken(true),
  });
  writeAtomic(livePath, JSON.stringify({ mcpServers: { slashy: { type: 'http', url: proxy.url } } }));
  applyConfig();

  function applyConfig() {
    if (tokens) process.env.SLASHY_MCP_CONFIG = livePath;
    else if (opts.required) process.env.SLASHY_MCP_CONFIG = emptyPath;
    else delete process.env.SLASHY_MCP_CONFIG;
  }

  async function accessToken(force: boolean) {
    if (!tokens) throw new Error('Slashy is not connected');
    if (!force && tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
    if (!refreshing) {
      const current = tokens;
      refreshing = refreshSlashyTokens(current)
        .then(async next => {
          tokens = next;
          error = null;
          try { await opts.persist(encryptSlashyTokens(opts.publicKey, opts.keyId, next), next.client_id); }
          catch { /* in-memory token still works until restart */ }
          return next.access_token;
        })
        .catch(failure => {
          tokens = null;
          error = 'Slashy session expired. Connect Slashy again in Settings.';
          applyConfig();
          throw failure;
        })
        .finally(() => { refreshing = null; });
    }
    return refreshing;
  }

  return {
    status: () => ({ connected: !!tokens, error }),
    ready: () => !!tokens,
    async applyRecord(record) {
      if (!record) {
        if (tokens) void revokeSlashyTokens(tokens);
        tokens = null;
        updatedAt = '';
        error = null;
        applyConfig();
        return;
      }
      if (record.updatedAt === updatedAt && tokens) return;
      updatedAt = record.updatedAt;
      try {
        if (record.keyId !== opts.keyId) throw new Error('Stored Slashy tokens target a different runner key');
        tokens = decryptSlashyTokens(opts.privateKey, record.ciphertext);
        error = null;
      } catch {
        tokens = null;
        error = 'Disconnect Slashy and connect it again.';
      }
      applyConfig();
    },
    async close() {
      await proxy.close();
    },
  };
}
