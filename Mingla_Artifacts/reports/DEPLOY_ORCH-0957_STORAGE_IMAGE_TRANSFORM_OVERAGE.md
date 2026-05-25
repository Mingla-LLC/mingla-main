# DEPLOY — ORCH-0957 [Storage image transformation overage]

**Status:** migration + edge functions deployed and verified on remote `gqnoajqerqhnvulmnyvv`
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]`
**Branch:** `0957-storage-image-transform-overage`
**Deploy date:** 2026-05-25
**Implementation commit under test:** `1b32c3c0` (per `IMPLEMENTATION_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`)

## 1. Migration apply (operator-executed)

Operator applied:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]" && /Users/sethogieva/bin/supabase db push --linked
```

CLI output (operator pasted back, 2026-05-25):

```
Initialising login role...
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql
 [Y/n] y
Applying migration 20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql...
Finished supabase db push.
```

No `--include-all` was required because remote-only drift (ORCH-0950 expanded-scope + ORCH-0955 native-stripe-tax) had been source-reconciled into the branch by the implementor before handoff.

## 2. Post-migration verification (read-only DB probes)

**Column existence:**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='place_pool' AND column_name='thumbs_backfilled_at';
```

Result:

```json
[{"column_name":"thumbs_backfilled_at","data_type":"timestamp with time zone","is_nullable":"YES"}]
```

**Partial index existence:**

```sql
SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='place_pool'
  AND indexname='place_pool_thumbs_backfill_pending_idx';
```

Result:

```json
[{"indexname":"place_pool_thumbs_backfill_pending_idx"}]
```

**Pending-backfill row count (SC-8 baseline):**

```sql
SELECT count(*) AS pending_thumbs FROM public.place_pool
WHERE thumbs_backfilled_at IS NULL
  AND stored_photo_urls IS NOT NULL
  AND array_length(stored_photo_urls, 1) > 0;
```

Result: `[{"pending_thumbs":18560}]`

This matches the investigation's pre-migration prediction of 18,547 within 0.07% (13 new places ingested over the past day expected). **SC-8 baseline established.** The count must decrement monotonically as the backfill runs.

## 3. Edge function deployments (orchestrator-executed)

All 3 functions deployed via local Supabase CLI v2.98.2:

| Function | Bundle size | Deploy result |
|---|---|---|
| `backfill-place-photo-thumbs` (NEW) | 115.4 kB | Deployed |
| `run-place-intelligence-trial` (helper consumer) | 173.1 kB | Deployed |
| `backfill-place-photos` (helper consumer) | 126 kB | Deployed |

Deploy commands:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]"
/Users/sethogieva/bin/supabase functions deploy backfill-place-photo-thumbs --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
/Users/sethogieva/bin/supabase functions deploy backfill-place-photos --project-ref gqnoajqerqhnvulmnyvv
```

`places-autocomplete` was mentioned as a possible redeploy candidate but the implementor's grep confirmed it does NOT import `_shared/photoStorageService.ts` or `_shared/imageCollage.ts` directly on this branch, so no redeploy needed. Defensive redeploy is available if any future check shows a transitive import.

## 4. Verify-first-call (per feedback_supabase_edge_deploy_verify_first_call.md)

One curl per deployed function. **Expected:** non-404 response (proves bundle is reachable). All three returned 401 with `UNAUTHORIZED_NO_AUTH_HEADER` — the correct auth-gate response for an unauthenticated POST, confirming the functions are deployed and serving requests.

```bash
curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Content-Type: application/json" -d '{}'
# HTTP 401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/run-place-intelligence-trial" \
  -H "Content-Type: application/json" -d '{}'
# HTTP 401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}

curl -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photos" \
  -H "Content-Type: application/json" -d '{}'
# HTTP 401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
```

All 3 verify-first-calls **PASS**. No silently-incomplete deploys; no 404 NOT_FOUND.

## 5. State of cost-control after deploy

Pre-existing behaviour up to deploy:
- Every collage composition triggered by `run-place-intelligence-trial` rewrote Supabase Storage URLs to `/storage/v1/render/image/...` (metered).
- Billing-period total at 2026-05-25 (19 days into the cycle): 9,168 unique origin images transformed.

Post-deploy behaviour (effective immediately for NEW collage compositions):
- New collage compositions read from `<dir>/<i>_thumb.jpg` via the non-metered `/storage/v1/object/public/` endpoint **when** the thumb exists.
- For places where thumbs do NOT yet exist (the 18,560 pending rows from §2), the in-helper fallback (env `THUMB_404_FALLBACK_TO_TRANSFORM=true`, default) will re-fetch via the metered legacy endpoint for that single photo on first miss. Each pending place is touched at most once via this fallback before its thumbs land.
- New place ingestions via `places-autocomplete` → `downloadAndStorePhotos` now write both original + thumb at the same time and stamp `thumbs_backfilled_at = NOW()`, so they're "born backfilled" with zero billable transformations.

**Expected billing trajectory:**

- **Today through backfill complete:** still incurring transformations at roughly the pre-deploy rate (because the 18,560-place pending pool still triggers fallback transforms on each fresh collage), capped by the daily collage rate (~118 collages/day per investigation).
- **Once backfill completes:** ongoing transformations drop to ~0 because every collage source-photo is served from the pre-sized thumb via the non-metered endpoint.
- **Backfill execution:** awaits operator dispatch via `backfill-place-photo-thumbs` (admin auth required; curl shape in §6).

SC-5 verification window remains operator-eyeball at billing-day +14 per the SPEC.

## 6. Backfill ops runbook

Once tester completes SC-1 through SC-7 verification, operator can drive the historical backfill:

```bash
# Preview the pending pool
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" \
  -d '{"action":"preview_run","batchSize":25}'

# Create a run
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" \
  -d '{"action":"create_run","batchSize":25}'
# response includes runId

# Process batches (repeat)
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" -H "Content-Type: application/json" \
  -d '{"action":"run_next_batch","runId":"<RUN_ID>"}'
```

Estimated wall time: 18,560 places ÷ 25/batch ≈ 743 batches; at ~5 photos/sec processing → ~5 hours total full-speed; spread across 24 hours at operator pace is recommended.

## 7. Open items for tester

Per the SPEC §6 / §10:

- **SC-1 runtime:** trigger a fresh place ingest via `places-autocomplete`; verify both `<dir>/0.jpg` AND `<dir>/0_thumb.jpg` land in storage and `thumbs_backfilled_at` is non-NULL.
- **SC-6 runtime:** trigger `run-place-intelligence-trial compose_collage` against a 16-photo place after that place is backfilled; verify edge function logs show no `WORKER_RESOURCE_LIMIT 546` over 100 consecutive runs.
- **SC-7 runtime:** delete one thumb manually; trigger collage compose; verify fallback behavior under both `THUMB_404_FALLBACK_TO_TRANSFORM=true` (legacy transform once) and `=false` (black tile).
- **T-05 adversarial:** missing-thumb fallback path under both env settings.
- **T-09 memory:** runtime memory metric on 16-photo place using thumbs (<100 MB peak expected).
- **T-10 resumability:** pause/resume mid-batch with no duplicates and no orphaned thumbs.

## 8. Risks / known deviations

- Implementor's SPEC §3.3 vs T-08 tension resolved by setting `thumbs_backfilled_at` ONLY when ALL thumbs in a place succeed. Reviewed and APPROVED — partial-success would hide failed thumbs from retry.
- During the backfill window, the legacy transform endpoint is still hit once per pending place via the 404 fallback. This is expected and bounded (~18,560 max additional transforms over the backfill window, all of which would have happened anyway under the old behavior).
- `places-autocomplete` was not redeployed (no direct shared-helper import on this branch). If a future audit shows transitive import via another helper, redeploy is a one-liner.

## 9. Next handoff

After this report, dispatch Claude `mingla-tester` for the full 10-step TARGETED protocol against SC-1 through SC-8, with SC-5 deferred to billing-day +14. Then return to either orchestrator for CLOSE including D-1 invariant broadening (broaden `I-PROPOSED-EXTERNAL-API-DOCS-VERIFIED` to include "metering" alongside enums/payloads).
