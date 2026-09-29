import { existsSync } from 'node:fs';

/** Extra Claude argv so subprocesses use the tester Slashy proxy instead of the operator MCP. */
export function slashyClaudeArgs(): string[] {
  const config = process.env.SLASHY_MCP_CONFIG;
  if (!config || !existsSync(config)) return [];
  return ['--mcp-config', config, '--strict-mcp-config'];
}
