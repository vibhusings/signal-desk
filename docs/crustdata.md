# Crustdata company discovery

## User setup

Open Signal Desk → Settings → Crustdata API key. Paste your provider API key and
choose Encrypt for runner. Once the card says Key loaded, open Signals, save your
investment criteria and choose Scan now. Collection activity reports the Crustdata
request status and number of candidate companies. Key loaded means successful local
decryption, not verified provider permissions or credit balance.

Claude and Slashy are still required for source investigation. Crustdata supplies
candidate companies, not automatically approved signals. The researcher fetches
public supporting pages and validates events through the existing evidence checks.
Ranked search expresses sector, stage, geography and exclusions as a natural-language
query; it does not enforce them as exact database filters. Research must verify fit.

## Usage and limits

Each manual or scheduled scan with a connected key makes one indexed Company Search
request for at most ten companies. There is no pagination, automatic request retry,
additional enrichment call, or Watcher subscription. Saving a key makes no provider
request. Provider calls use credits; consult your plan before enabling recurring scans.
401/402/403/429, network and invalid-response failures appear in scan warnings, while
web research continues. A failed provider request makes coverage partial. Empty
results do not manufacture a signal. Removing the key disables Crustdata for future
scans; an in-progress request cannot be recalled.

## Credentials

The browser encrypts the key with AES-GCM and wraps its encryption key with the
runner's RSA public key. Cloudflare stores only the envelope in runner_crustdata,
scoped to the shared pilot owner. Only the runner decrypts it. Keys are not included
in model prompts, logs, or scan results. This pilot still has one shared workspace;
it does not provide independent accounts or separate keys per visitor.

## Integration

Uses POST https://api.crustdata.com/company/search with Bearer authorization and
x-api-version: 2025-11-01. Fields are restricted to company name, domain, description,
country and headcount. Live/enterprise endpoints and contact email enrichment are
not part of this release. An API key must have access to indexed Company Search.

Official contract: https://docs.crustdata.com/company-docs/search/introduction
Credential tests: ui/scripts/test-crustdata.mjs
Provider contract tests: scripts/test-crustdata.ts

No real Crustdata key was available during implementation. Provider behavior is
covered with fixtures; a live scan is needed after the user adds their key.
