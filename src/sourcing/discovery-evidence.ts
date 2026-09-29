/** Publication evidence is bound to the exact page successfully scraped. */
export class DiscoveryEvidence {
  private calls = new Map<string, { name: string; url?: string }>();
  private pages = new Map<string, string>();

  observe(event: any) {
    for (const block of event.message?.content ?? []) {
      if (block.type === 'tool_use') {
        this.calls.set(block.id, { name: block.name, url: block.input?.url });
      }
      if (block.type !== 'tool_result' || block.is_error) continue;
      const call = this.calls.get(block.tool_use_id);
      if (call?.name !== 'mcp__slashy__scrape_url' || !call.url) continue;
      const parts: string[] = [];
      for (const content of Array.isArray(block.content) ? block.content : []) {
        if (content.type !== 'text') continue;
        try {
          const result = JSON.parse(content.text);
          if (result.success === false || result.error) continue;
          // Only page-content fields, never echoed URLs or error descriptions.
          for (const field of ['content', 'text', 'markdown', 'html', 'body', 'result']) {
            if (typeof result[field] === 'string') parts.push(result[field]);
          }
        } catch { parts.push(content.text); }
      }
      const key = this.key(call.url);
      this.pages.set(key, (this.pages.get(key) ?? '') + '\n' + parts.join('\n'));
    }
  }

  private key(url: string): string {
    try { const u = new URL(url); u.hash = ''; return u.href; } catch { return url; }
  }

  sawVerbatim(email: string, url: string): boolean {
    const text = this.pages.get(this.key(url)) ?? '';
    const emails = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
    return emails.some(value => value.toLowerCase() === email.toLowerCase());
  }

  /** Origins of pages whose scrape completed successfully. */
  get fetchedOrigins(): string[] {
    const origins = new Set<string>();
    for (const page of this.pages.keys()) {
      try { origins.add(new URL(page).origin); } catch { /* ignore malformed tool URLs */ }
    }
    return [...origins];
  }

  get fetchedChars(): number {
    return [...this.pages.values()].reduce((sum, text) => sum + text.length, 0);
  }
}
