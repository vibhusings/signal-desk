import 'dotenv/config';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';

/**
 * Uploads a file to Slashy once and reports a file id that is confirmed usable.
 *
 * The confirmation matters. An earlier version reported the id returned by
 * `request_file_upload` — which only *reserves* an id and hands back a presigned URL
 * the bytes still have to be PUT to. Nothing was uploaded, the id looked fine, and the
 * failure only surfaced later as `attachments_prepared: 0` on a real send. So this
 * uploads and then verifies, and prints nothing usable unless the file is really there.
 */

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.doc': 'application/msword', '.txt': 'text/plain',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
// upload_file accepts up to 200KB inline, but that means carrying the whole base64
// blob through the model's prompt — which failed in practice and puts the bytes at the
// mercy of the model reproducing them exactly. The presigned URL path PUTs from here
// instead, so the file never passes through the model at all. Always prefer it.
const INLINE_LIMIT = 0;

const path = process.argv[2];
if (!path) {
  console.error('Usage: npm run upload:resume -- ~/path/to/resume.pdf');
  process.exit(1);
}
const abs = resolve(path);
if (!existsSync(abs)) {
  console.error(`No such file: ${abs}`);
  process.exit(1);
}

const size = statSync(abs).size;
const mime = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream';

function runClaude(prompt: string, tools: string): Promise<{ toolText: string; text: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.env.CLAUDE_BIN ?? `${process.env.HOME}/.local/bin/claude`,
      [
        '-p', prompt,
        '--model', process.env.SEND_MODEL ?? 'claude-haiku-4-5',
        '--allowedTools', tools,
        '--permission-mode', 'acceptEdits',
        '--output-format', 'stream-json', '--verbose',
      ],
      {
        env: {
          HOME: process.env.HOME ?? '',
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          USER: process.env.USER ?? '',
          ...(process.env.CLAUDE_CODE_OAUTH_TOKEN
            ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN }
            : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' }),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let toolText = '', text = '', buffer = '';
    child.stdout.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        try {
          const event = JSON.parse(line);
          for (const block of event.message?.content ?? []) {
            if (block.type === 'text') text += block.text;
            if (block.type === 'tool_result') {
              const cs = Array.isArray(block.content) ? block.content : [];
              for (const c of cs) if (c.type === 'text') toolText += '\n' + c.text;
              if (typeof block.content === 'string') toolText += '\n' + block.content;
            }
          }
        } catch { /* CLI noise */ }
      }
    });
    child.on('close', () => resolve({ toolText, text }));
  });
}

async function main() {
  console.log(`\n${abs}`);
  console.log(`  ${(size / 1024).toFixed(0)} KB, ${mime}\n`);

  let fileId: string | undefined;

  if (size <= INLINE_LIMIT) {
    // Small enough to hand over directly. Base64 is produced here rather than asking
    // the model to read the file, so the bytes never depend on its interpretation.
    const b64 = readFileSync(abs).toString('base64');
    console.log('  uploading inline...');
    const { toolText } = await runClaude(
      [
        `FIRST: call ToolSearch with query "mcp__slashy" to load the Slashy tool schemas. They are deferred and must be loaded before use.`,
        `Then call upload_file exactly once with these arguments:`,
        `  filename: ${basename(abs)}`,
        `  mime_type: ${mime}`,
        `  content_base64: the single-line base64 string below, verbatim and complete`,
        `Do not send email. Do not draft anything. Upload only, then reply DONE.`,
        ``,
        b64,
      ].join('\n'),
      'mcp__slashy__upload_file,ToolSearch',
    );
    fileId = toolText.match(/"file_id"\s*:\s*"([^"]+)"/)?.[1];
  } else {
    console.log('  requesting an upload URL...');
    const { toolText, text } = await runClaude(
      [
        `FIRST: call ToolSearch with query "mcp__slashy" to load the Slashy tool schemas.`,
        `Then call request_file_upload with filename "${basename(abs)}", mime_type "${mime}", size_bytes ${size}.`,
        `Print the full raw result. Do not send email. Reply DONE when finished.`,
      ].join('\n'),
      'mcp__slashy__request_file_upload,ToolSearch',
    );
    // Prefer the tool result, but fall back to the model's echoed output: the CLI does
    // not always surface tool_result blocks in the stream, and losing the URL here
    // means an upload that silently never happens.
    const both = `${toolText}\n${text}`;
    fileId = both.match(/"file_id"\s*:\s*"([^"]+)"/)?.[1];
    const uploadUrl = both.match(/"upload_url"\s*:\s*"([^"]+)"/)?.[1];
    if (!fileId || !uploadUrl) {
      console.error('  Could not get an upload URL. Raw result:\n', toolText.slice(0, 800));
      process.exit(1);
    }
    // The PUT happens here, not in the model — this is the step that was silently
    // skipped before, and the reason the attachment failed on a real send.
    // Multipart with a field named `file`, matching the `upload_form_field` and the
    // `curl -F` command the tool itself returns. A raw byte body is rejected.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(readFileSync(abs))], { type: mime }), basename(abs));
    const put = await fetch(uploadUrl, { method: 'PUT', body: form });
    if (!put.ok) {
      console.error(`  PUT failed -> ${put.status}: ${(await put.text()).slice(0, 300)}`);
      process.exit(1);
    }
    console.log('  bytes uploaded');
  }

  if (!fileId) {
    console.error('  No file_id returned. Upload did not happen.');
    process.exit(1);
  }

  console.log('  verifying...');
  const { toolText: status } = await runClaude(
    [
      `FIRST: call ToolSearch with query "mcp__slashy" to load the Slashy tool schemas.`,
      `Then call check_upload_status with file_id "${fileId}" and report the raw result. Reply DONE after.`,
    ].join('\n'),
    'mcp__slashy__check_upload_status,ToolSearch',
  );

  if (!/uploaded/i.test(status)) {
    console.error(`\n  NOT CONFIRMED — status was not "uploaded". Do not use this id.`);
    console.error(`  raw: ${status.trim().slice(0, 400)}\n`);
    process.exit(1);
  }

  console.log(`\n  \x1b[32mconfirmed uploaded\x1b[0m\n`);
  console.log(`Put this in .env:\n\n  RESUME_FILE_ID=${fileId}\n`);
}

main();
