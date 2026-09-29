import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';

const prompt = readFileSync(process.argv[2], 'utf8');
mkdirSync('.spike', { recursive: true });
const file = `.spike/slashy-${Date.now()}.jsonl`;
console.log(`Raw events: ${file}`);
const child = spawn(process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`, [
  '-p', prompt, '--model', process.env.SEND_MODEL ?? 'claude-haiku-4-5',
  '--tools', 'ToolSearch', '--permission-mode', 'dontAsk', '--allowedTools', 'ToolSearch,mcp__slashy', '--output-format', 'stream-json', '--verbose',
], {
  env: { HOME: process.env.HOME, PATH: process.env.PATH, USER: process.env.USER,
    ...(process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
      : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let buffer = '';
child.stdout.on('data', data => {
  appendFileSync(file, data);
  buffer += data;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx); buffer = buffer.slice(idx + 1);
    try {
      const event = JSON.parse(line);
      for (const c of event.message?.content ?? []) {
        if (['tool_use', 'tool_result', 'text'].includes(c.type)) console.log(JSON.stringify(c));
      }
      if (event.type === 'result') console.log(JSON.stringify({ result: event.result, is_error: event.is_error }));
    } catch {}
  }
});
child.stderr.pipe(process.stderr);
const timer = setTimeout(() => { console.log('Diagnostic timeout; inspect raw results before retrying.'); child.kill('SIGKILL'); }, 120000);
child.on('exit', code => { clearTimeout(timer); process.exitCode = code ?? 1; });
