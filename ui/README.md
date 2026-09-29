# Signal Desk web app

The website half of Signal Desk: signal inbox, pipeline, company review with per-contact
draft approval, CRM, and settings where each owner connects Claude, Slashy, Crustdata and
a résumé. It runs as a Cloudflare Worker with a D1 database. The background runner (repo
root) does the research, sending, reply checks, meeting booking and CRM work; the two talk
over `/api/runner`, authenticated by `OUTREACH_RUNNER_SECRET`.

**Setting up your own copy: follow [SETUP.md](../SETUP.md) in the repo root.**

## Commands

```bash
npm run install:ci      # install dependencies
npm run build           # build the Worker and browser bundle into dist/
npx tsc --noEmit        # type check
npm run test:signals    # signals, pipeline, sign-in, outreach links, credentials, Slashy
npm run test:crm        # CRM API and extraction checks
npx wrangler deploy --config wrangler.cloudflare.jsonc
```

## Sign-in

The site is protected by an access code. Two Worker secrets enable it:
`PILOT_ACCESS_CODE_SHA256` (SHA-256 hex of the code) and `PILOT_SESSION_SECRET`
(32+ characters). `node scripts/setup-secrets.mjs` in the repo root generates both.
A site without them admits nobody. Identity headers from a hosting platform are ignored
unless `TRUST_PLATFORM_IDENTITY=1` is set, which is only safe behind a platform that sets
and strips those headers itself.

For local development, put the same secrets in `ui/.dev.vars` (git-ignored).

## Data

D1 stores companies, signals, jobs, CRM sources and the runner's status snapshot. The
schema is in `drizzle/`; some tables are also created on first use. Every record is scoped
to the workspace owner. One site, one database and one runner make one workspace: give
each person their own install rather than sharing an access code.

See `IMPLEMENTATION.md` for design boundaries and validation notes.
