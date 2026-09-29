#!/usr/bin/env node
// Stand-in for `claude -p` that emits stream-json tool events for the calls a prompt asks for.
// Behaviour is steered by a `mode` file in the working directory: alter | skip-last | (none).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
const prompt = process.argv[process.argv.indexOf('-p') + 1];
const mode = existsSync('mode') ? readFileSync('mode', 'utf8').trim() : '';
appendFileSync('processes.log', 'spawn\n');
let calls = [...prompt.matchAll(/\d+\. (mcp__slashy__\w+) with exactly: (\{.*\})$/gm)].map(m => [m[1], JSON.parse(m[2])]);
if (!calls.length) {
  const m = /call (mcp__slashy__\w+) exactly once with these exact arguments: (\{.*?\})\. Do not/.exec(prompt);
  calls = [[m[1], JSON.parse(m[2])]];
}
if (mode === 'skip-last' && calls.length > 1) calls = calls.slice(0, -1);
calls.forEach(([name, input], i) => {
  const args = mode === 'alter' ? { ...input, thread_id: 'ffffffffffffffff' } : input;
  const id = `t${i}`;
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: args }] } }));
  console.log(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: JSON.stringify({ success: true, served: args }) }] }] } }));
});
