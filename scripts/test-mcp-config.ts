import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slashyClaudeArgs } from '../src/send/mcp-config.js';

const previous = process.env.SLASHY_MCP_CONFIG;
const directory = mkdtempSync(join(tmpdir(), 'signal-desk-mcp-config-'));
try {
  delete process.env.SLASHY_MCP_CONFIG;
  assert.deepEqual(slashyClaudeArgs(), []);
  const missing = join(directory, 'missing.json');
  process.env.SLASHY_MCP_CONFIG = missing;
  assert.deepEqual(slashyClaudeArgs(), []);
  const config = join(directory, 'slashy-mcp.json');
  writeFileSync(config, JSON.stringify({ mcpServers: { slashy: { type: 'http', url: 'http://127.0.0.1:9/mcp' } } }));
  process.env.SLASHY_MCP_CONFIG = config;
  assert.deepEqual(slashyClaudeArgs(), ['--mcp-config', config, '--strict-mcp-config']);
  console.log('Claude Slashy MCP argv is present only when the runtime config file exists.');
} finally {
  if (previous === undefined) delete process.env.SLASHY_MCP_CONFIG;
  else process.env.SLASHY_MCP_CONFIG = previous;
  rmSync(directory, { recursive: true, force: true });
}
