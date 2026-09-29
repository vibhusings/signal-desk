import { spawn } from 'node:child_process';
import type { OutreachRecord, SendResult } from '../types.js';
import type { Sender } from '../scheduler/run.js';
import { buildPrompt } from './prompt.js';
import { SendEvidence } from './evidence.js';
import { guardSend } from './guard.js';
import { slashyClaudeArgs } from './mcp-config.js';

export interface SlashyOptions {
  claudeBin: string;
  /** Pinned deliberately: composing a short email does not need a frontier model. */
  model: string;
  senderName: string;
  /** Exact connected Slashy inbox used as the sender. */
  inboxEmail?: string;
  timeoutMs: number;
  /** Preferred: from `claude setup-token`. Rides the subscription, not per-token billing. */
  oauthToken?: string;
  /** Fallback only, used when no subscription token is available. */
  apiKey?: string;
}

export function slashySender(o: SlashyOptions): Sender {
  return async (r: OutreachRecord, touch: number): Promise<SendResult> => {
    const blocked = guardSend(r, touch);
    if (blocked) return blocked;
    const prompt = buildPrompt(r, touch, o.senderName, o.inboxEmail);

    return new Promise<SendResult>((resolve) => {
      const child = spawn(
        o.claudeBin,
        [
          '-p', prompt,
          '--model', o.model,
          // ToolSearch is required, not optional: the mcp__slashy tools are deferred
          // and cannot be invoked until their schemas are loaded. Without it the model
          // flails — inventing reasons it "cannot call the tool", or hanging until the
          // timeout — which looked for a long time like a Slashy outage.
          '--allowedTools', 'mcp__slashy,ToolSearch',
          '--permission-mode', 'acceptEdits',
          '--output-format', 'stream-json', '--verbose',
          ...slashyClaudeArgs(),
        ],
        {
          // launchd-like env, plus exactly one auth credential. Anything not listed
          // here is not available to the subprocess, which keeps the send leg
          // reproducible and avoids leaking an interactive session's Keychain access.
          env: {
            HOME: process.env.HOME ?? '',
            PATH: process.env.PATH ?? '/usr/bin:/bin',
            USER: process.env.USER ?? '',
            // Precedence matches Claude Code's own: ANTHROPIC_API_KEY would outrank
            // CLAUDE_CODE_OAUTH_TOKEN if both were set, so only pass one.
            ...(o.oauthToken
              ? { CLAUDE_CODE_OAUTH_TOKEN: o.oauthToken }
              : o.apiKey
                ? { ANTHROPIC_API_KEY: o.apiKey }
                : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );

      let out = '', err = '', settled = false;
      let buffer = '';
      const evidence = new SendEvidence();
      const done = (res: SendResult) => { if (!settled) { settled = true; resolve(res); } };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        // A killed subprocess may or may not have sent. Never claim it didn't.
        done(evidence.result ?? { ok: false, error: `timed out after ${o.timeoutMs}ms` });
      }, o.timeoutMs);

      child.stdout.on('data', (d) => {
        out += d; buffer += d;
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            evidence.observe(event);
            for (const block of event.message?.content ?? []) {
              if (block.type === 'tool_use' || block.type === 'tool_result') {
                console.log(`[slashy ${r.id} touch ${touch}] ${JSON.stringify(block)}`);
              }
            }
          } catch {}
        }
      });
      child.stderr.on('data', (d) => (err += d));

      child.on('error', (e) => {
        clearTimeout(timer);
        // Failure to spawn means claude never ran, so nothing was sent.
        done({ ok: false, error: `spawn failed: ${e.message}`, definitelyNotSent: true });
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (evidence.result) return done(evidence.result);
        // Auth failures happen before any tool call, so nothing was sent.
        const combined = `${out}\n${err}`;
        done({
          ok: false,
          error: `exit ${code}, no confirmed send tool result: ${combined.trim().slice(-300)}`,
        });
      });
    });
  };
}
