# Signal Desk

A private startup research workspace with a signal inbox, company review, pipeline, and outreach drafts.

## Run locally

Install dependencies with `npm run install:ci`, then use `npm run dev`.
The preview provides a local test sign-in. Production identity is supplied by Sites.

Generate migrations with `npm run db:generate`. After building, apply pending SQL locally using the Wrangler configuration in `dist/server/wrangler.json` and persistence directory `.wrangler/state`.

## Data and integrations

Fictional demo records are clearly labeled and reset on reload. The saved workspace uses D1 and scopes every record to its authenticated owner. Example and local QA records are not seeded into production.

The Launch outreach screen connects to the local runner for contact discovery, Attio activation, follow-ups, reply checks and meeting scheduling. Sending requires recipient confirmation in the UI. Signals collects evidence from public web sources through the runner after users configure their thesis in the UI; it supports manual and scheduled scans. Investment signals use founder discovery and a separate investment email sequence. Airtable is not connected. See IMPLEMENTATION.md for boundaries and validation details.

## Checks

`npm run build` creates the Worker and browser bundle. `npx tsc --noEmit` checks types.

Browser checks covered mobile rendering, signal search, invalid WebMCP input, shortlisting, company creation, authenticated workspace access and persistence after reload.
