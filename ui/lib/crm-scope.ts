export type CrmScope = {
  emails: string[];
  domains: string[];
  companies: string[];
};

const GENERIC = new Set(['inc','llc','ltd','corp','co','the','and','group','labs','lab','ai','io']);

export function emptyCrmScope(): CrmScope {
  return { emails: [], domains: [], companies: [] };
}

export function crmScopeReady(scope?: CrmScope | null) {
  return !!scope && (scope.emails.length > 0 || scope.domains.length > 0 || scope.companies.length > 0);
}

export function normalizeCrmDomain(value: string) {
  let host = value.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]?.split(':')[0] ?? '';
  if (!host.includes('.') || host.endsWith('.local') || host === 'gmail.com' || host === 'googlemail.com' || host === 'outlook.com' || host === 'hotmail.com' || host === 'yahoo.com' || host === 'icloud.com') return '';
  return host;
}

export function normalizeCrmEmail(value: string) {
  const email = value.trim().toLowerCase();
  return /^\S+@\S+\.\S+$/.test(email) ? email : '';
}

export function normalizeCrmCompany(value: string) {
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < 3 || name.length > 80) return '';
  if (GENERIC.has(name.toLowerCase())) return '';
  return name;
}

export function addCrmScope(target: CrmScope, input: { email?: string; domain?: string; company?: string }) {
  const email = input.email ? normalizeCrmEmail(input.email) : '';
  const domain = input.domain ? normalizeCrmDomain(input.domain) : email.split('@')[1] ? normalizeCrmDomain(email.split('@')[1]) : '';
  const company = input.company ? normalizeCrmCompany(input.company) : '';
  if (email && !target.emails.includes(email)) target.emails.push(email);
  if (domain && !target.domains.includes(domain)) target.domains.push(domain);
  if (company && !target.companies.includes(company)) target.companies.push(company);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sourceMatchesCrmScope(source: {
  participants?: Array<{ email?: string }>;
  title?: string;
  text?: string;
  analysis?: { deals?: Array<{ company?: { value?: string } }>; applications?: Array<{ company?: { value?: string } }> };
}, scope?: CrmScope | null) {
  if (!crmScopeReady(scope)) return false;
  const emails = (source.participants ?? []).map(p => normalizeCrmEmail(p.email ?? '')).filter(Boolean);
  if (emails.some(email => scope!.emails.includes(email))) return true;
  if (emails.some(email => scope!.domains.includes(email.split('@')[1] ?? ''))) return true;
  const mentioned = [
    source.title ?? '',
    source.text ?? '',
    ...(source.analysis?.deals ?? []).map(d => d.company?.value ?? ''),
    ...(source.analysis?.applications ?? []).map(a => a.company?.value ?? ''),
  ].join('\n');
  return scope!.companies.some(name => new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(mentioned));
}

export function gmailCrmQuery(scope: CrmScope) {
  const terms = [
    ...scope.emails.slice(0, 20).map(email => `(from:${email} OR to:${email})`),
    ...scope.domains.slice(0, 20).map(domain => `(from:${domain} OR to:${domain})`),
    ...scope.companies.slice(0, 20).map(name => '"' + name.replace(/[^\p{L}\p{N} &.-]/gu, ' ').replace(/\s+/g, ' ').trim() + '"'),
  ];
  return terms.join(' OR ');
}
