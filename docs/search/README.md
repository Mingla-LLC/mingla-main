# Search release operations

Mingla publishes search routes from explicit lifecycle owners. `search_ready` is the only indexable state; every other public state remains `noindex`, outside sitemaps, and outside global navigation. City promotion is atomic across the ten-city registry. Host public documents (brands, events and RSVPs, trips, experiences and verified venues) are promoted automatically: since #3197, a per-minute database reconciler marks every page that passes the public-search content floor `search_ready` and removes it again when it stops qualifying, asserting the review checklist by product policy (Seth, 2026-09-12) rather than by individual review. A row written by an operator still takes precedence for its page.

## Local and post-deployment sequence

1. Validate the fixed answer-engine corpus with `node scripts/search/answer-engine-benchmark.mjs`.
2. Validate the binding ten-tab contract with `node scripts/search/validate-workbook.mjs`, then export the expected `00_ROUTE_LEDGER` with `node scripts/search/export-route-ledger.mjs`.
3. After deployment, run `node scripts/search/verify-routes.mjs --origin=https://usemingla.com`. Results are synthetic user-agent probes, not evidence that a genuine crawler visited.
4. Export the ten import-safe workbook tabs with `node scripts/search/export-workbook.mjs --output=<empty-directory>`. The exact tabs are `00_ROUTE_LEDGER`, `01_GSC_SEARCH`, `02_GSC_INDEX`, `03_GSC_AI`, `04_BING_SEARCH_AI`, `05_GA4_OUTCOMES`, `06_AUTHORITY`, `07_BENCHMARK`, `08_INCIDENTS` and `09_COHORT_DECISIONS`.
5. Host public documents need no manual step (#3197). To hold a qualifying Host page out of search, or to record an independent review, run `promote-public-document.mjs --input=<receipt>` first without `--apply`; only an authorised operator may repeat with the exact digest confirmation. That operator row wins over the automatic policy until it is deleted.
6. Run `indexnow.mjs` without `--send`. Only after the verification key works on both origins may an authorised operator repeat with `--send` and the fresh body digest.

The IndexNow sender advances rows only after an accepted delivery. A rejected delivery records a typed error and keeps every row pending for retry. Delivered receipts are retained for at least 90 days. Neither tool prints credentials.

Search Console–GA4 linking, Bing ownership/import, GA4 custom dimensions and key events, genuine crawler-log verification, the live workbook/dashboard, and T0/28/56/90-day reviews are production account operations. They cannot be claimed from local code.
