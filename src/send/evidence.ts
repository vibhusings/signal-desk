import type { SendResult } from '../types.js';

/** Interpret only matched Slashy tool responses, never model narration. */
export class SendEvidence {
  private calls = new Map<string, string>();
  result?: SendResult;
  observe(event: any) {
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use') this.calls.set(block.id, block.name);
      if (block.type !== 'tool_result' || this.calls.get(block.tool_use_id) !== 'mcp__slashy__send_email') continue;
      for (const content of Array.isArray(block.content) ? block.content : []) {
        if (content.type !== 'text') continue;
        try {
          const raw = JSON.parse(content.text);
          if (!block.is_error && raw.success === true && ['queued', 'sent', 'delivered'].includes(raw.delivery_status)) {
            const threadId = /^[0-9a-f]{16}$/.test(raw.thread_id ?? '') ? raw.thread_id : undefined;
            const messageId = typeof raw.message_id === 'string' && /^<[^<>\s]+@[^<>\s]+>$/.test(raw.message_id)
              ? raw.message_id : undefined;
            const subject = typeof raw.subject === 'string' && raw.subject.trim() && raw.subject.length <= 500
              ? raw.subject : undefined;
            this.result = { ok: true, threadId, messageId, subject };
          }
        } catch { /* Unrecognized results remain ambiguous. */ }
      }
    }
  }
}
