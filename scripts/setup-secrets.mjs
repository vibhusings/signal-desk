#!/usr/bin/env node
// Generates the secrets that tie a Signal Desk site to its runner:
//   - an access code for signing in to the site (stored only as a SHA-256 hash on the site)
//   - a session-signing secret for the site
//   - a runner key shared by the site and the runner
// Writes them to .runtime/ (git-ignored, owner-only) and, with --push, stores the three
// site secrets in your Cloudflare Worker via wrangler.
//
//   node scripts/setup-secrets.mjs --url https://signal-desk.<you>.workers.dev [--push] [--force]
//
// Refuses to overwrite an existing setup unless --force is given, because replacing the
// runner key disconnects a running runner until its bridge-config.json is updated too.
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const url = value('--url');
if (!url || !/^https:\/\/[^\s/]+\/?$/.test(url)) {
  console.error('Usage: node scripts/setup-secrets.mjs --url https://<your-site-host> [--push] [--force]');
  process.exit(1);
}

const runtime = resolve(root, '.runtime');
const files = {
  bridge: resolve(runtime, 'bridge-config.json'),
  code: resolve(runtime, 'pilot-access-code.txt'),
  worker: resolve(runtime, 'worker-secrets.env'),
};
const existing = Object.values(files).filter((f) => existsSync(f));
if (existing.length && !flag('--force')) {
  console.error(`Refusing to overwrite an existing setup:\n  ${existing.join('\n  ')}\nRe-run with --force only if you intend to replace these secrets.`);
  process.exit(1);
}

const token = (bytes) => randomBytes(bytes).toString('base64url');
const accessCode = token(18);
const secrets = {
  OUTREACH_RUNNER_SECRET: token(32),
  PILOT_SESSION_SECRET: token(48),
  PILOT_ACCESS_CODE_SHA256: createHash('sha256').update(accessCode).digest('hex'),
};

mkdirSync(runtime, { recursive: true, mode: 0o700 });
chmodSync(runtime, 0o700);
const write = (path, text) => { writeFileSync(path, text, { mode: 0o600 }); chmodSync(path, 0o600); };
write(files.bridge, JSON.stringify({ url: url.replace(/\/$/, ''), runnerKey: secrets.OUTREACH_RUNNER_SECRET }, null, 2) + '\n');
write(files.code, accessCode + '\n');
write(files.worker, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');

console.log('Wrote (owner-only, git-ignored):');
console.log(`  ${files.bridge}   <- copy to the runner's .runtime/ folder`);
console.log(`  ${files.code}   <- the access code you sign in with`);
console.log(`  ${files.worker}   <- the three site secrets`);

if (!flag('--push')) {
  console.log('\nNext: store the site secrets in Cloudflare (from the ui/ folder):');
  for (const name of Object.keys(secrets)) console.log(`  npx wrangler secret put ${name} --config wrangler.cloudflare.jsonc`);
  console.log(`Paste each value from ${files.worker} when prompted, or re-run this script with --push --force.`);
  process.exit(0);
}

const ui = resolve(root, 'ui');
for (const [name, secret] of Object.entries(secrets)) {
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', name, '--config', 'wrangler.cloudflare.jsonc'], { cwd: ui, input: secret, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed to store ${name}:\n${(result.stderr || result.stdout || '').trim()}`);
    process.exit(1);
  }
  console.log(`Stored ${name} in the Cloudflare Worker.`);
}
console.log('\nDone. Sign in to the site with the access code in .runtime/pilot-access-code.txt.');
