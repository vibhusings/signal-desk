import { env } from 'cloudflare:workers';
export function workspaceDb() {
  if (!env.DB) throw new Error('Research storage is unavailable');
  return env.DB;
}
