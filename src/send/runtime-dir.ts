import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Override in tests. Production uses `.runtime` next to the process cwd. */
export function sendGuardDir() {
  const dir = resolve(process.env.SEND_GUARD_DIR ?? '.runtime');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
