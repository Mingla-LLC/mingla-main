# Search release operations

Mingla publishes search routes from explicit lifecycle owners. `search_ready` is the only indexable state; every other public state remains `noindex`, outside sitemaps, and outside global navigation. City promotion is atomic across the ten-city registry. Host public documents require an independent review receipt before promotion.

## Local and post-deployment sequence

1. Validate the fixed answer-engine corpus with `node scripts/search/answer-engine-benchmark.mjs`.
2. Export the expected route ledger with `node scripts/search/export-route-ledger.mjs`.
3. After deployment, run `node scripts/search/verify-routes.mjs --origin=https://usemingla.com`. Results are synthetic user-agent probes, not evidence that a genuine crawler visited.
4. Export the ten import-safe workbook tabs with `node scripts/search/export-workbook.mjs --output=<empty-directory>`.
5. Independently review each real Host public document. Run `promote-public-document.mjs --input=<receipt>` first without `--apply`; only an authorised operator may repeat with the exact digest confirmation.
6. Run `indexnow.mjs` without `--send`. Only after the verification key works on both origins may an authorised operator repeat with `--send` and the fresh body digest.

The IndexNow sender advances rows only after an accepted delivery. A rejected delivery records a typed error and keeps every row pending for retry. Delivered receipts are retained for at least 90 days. Neither tool prints credentials.

Search Console–GA4 linking, Bing ownership/import, GA4 custom dimensions and key events, genuine crawler-log verification, the live workbook/dashboard, and T0/28/56/90-day reviews are production account operations. They cannot be claimed from local code.
