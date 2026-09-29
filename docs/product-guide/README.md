# Signal Desk product handbook

Source content: `content.py` generates `content.json`. `build.py` creates the illustrated Word handbook, three PNG workflow diagrams, the downloadable public copy, and the UI content JSON. Use the bundled document Python runtime (python-docx and Pillow). Diagram fonts use macOS Arial.

Outputs:
- `docs/exports/Signal-Desk-Product-Handbook.docx`
- `ui/app/guide/content.json`
- `ui/public/guide-assets/`

The public documentation route is `/guide`. It reads only the authored content and does not fetch workspace APIs. The rest of the app retains its access checks. Do not include credentials or private workspace data in this public guide.

After a content change: run content.py, run build.py, render the Word file with the Documents skill renderer and inspect every page. Build the UI and deploy using the existing Cloudflare configuration. Both formats share the same source; do not edit the generated JSON copies independently.

September 27, 2026: 12-page DOCX reviewed; desktop and mobile web layout inspected; chapter search tested; TypeScript and production build passed.
