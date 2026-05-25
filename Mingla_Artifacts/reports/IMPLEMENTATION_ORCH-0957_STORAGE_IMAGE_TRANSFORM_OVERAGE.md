# IMPLEMENTATION — ORCH-0957 [Storage image transformation overage]

**Status:** implemented and verified locally  
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]`  
**Branch:** `0957-storage-image-transform-overage`  
**Implementation commit:** `1b32c3c0` (`ORCH-0957: stop metered place photo transforms`)  
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`  
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-0957_STORAGE_IMAGE_TRANSFORM_OVERAGE.md`

## Summary

ORCH-0957 Tier B is implemented. New and refreshed place-photo ingest writes 384x384 JPEG thumbnails into the existing `place-photos` bucket, the collage helper uses those thumbnail object URLs by default, and a new admin-authenticated `backfill-place-photo-thumbs` edge function can backfill historical rows without touching the metered Supabase Storage render endpoint. The old emergency controls remain: `DISABLE_PHOTO_URL_TRANSFORM=true` bypasses all URL rewriting, and `USE_PLACE_PHOTO_THUMBS=false` restores the legacy metered path from the single allowlisted fallback block.

## Spec §7 Traceability

| Step | Result | Evidence |
|---|---|---|
| 1. Migration | Implemented as `supabase/migrations/20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql`. Adds `place_pool.thumbs_backfilled_at`, partial pending index, and column comment. | Remote pre-flight probe returned `[]` for existing column. `supabase migration list --linked` from this worktree shows no remote-only rows after source reconciliation. |
| 2. `_shared/imageCollage.ts` | Default Supabase object URL rewrite now derives `<stem>_thumb.jpg` and keeps `/storage/v1/object/public/`. Legacy render behavior remains only under `USE_PLACE_PHOTO_THUMBS=false`. Optional 404 fallback is controlled by `THUMB_404_FALLBACK_TO_TRANSFORM`, default true. | `supabase/functions/_shared/imageCollage.ts`; `supabase/functions/_shared/imageCollage.test.ts` T-02/T-03/T-04. |
| 3. `_shared/photoStorageService.ts` | After original upload succeeds, ingest generates and uploads `<index>_thumb.jpg` as JPEG quality 80. Thumb failures warn and do not abort original upload. `thumbs_backfilled_at` is set only when every uploaded original also got a thumb, preserving T-08 retry semantics. | `supabase/functions/_shared/photoStorageService.ts`; `supabase/functions/_shared/photoStorageService.test.ts`. |
| 4. `backfill-place-photo-thumbs` | New admin-driven edge function added with `preview_run`, `create_run`, `run_next_batch`, `run_status`, `active_runs`, `pause_run`, `resume_run`, `cancel_run`, `retry_batch`, and `skip_batch`. It reuses `photo_backfill_runs` / `photo_backfill_batches`, stores no new bucket, and fetches originals only from object URLs. | `supabase/functions/backfill-place-photo-thumbs/index.ts`; `supabase/functions/backfill-place-photo-thumbs/index.test.ts` T-06/T-07. |
| 5. Redeploy consumers | No source change needed in `run-place-intelligence-trial`; it imports `_shared/imageCollage.ts`. `backfill-place-photos` imports `_shared/photoStorageService.ts`. | Orchestrator deploy required after merge for `backfill-place-photo-thumbs`, `run-place-intelligence-trial`, and `backfill-place-photos`. `rg` found these direct shared-helper consumers. |
| 6. CI strict-grep gate | Added ORCH-0957 strict-grep script and registered it in `strict-grep-mingla-business.yml`. | `.github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs`; `.github/workflows/strict-grep-mingla-business.yml`. |
| 7. ORCH-0863 allowlist | Added ORCH-0957 backend allowlist entries in the ORCH-0863 marketing gate in the same implementation commit. | `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs`; post-commit gate passed against 12 backend files changed. |
| 8. Backfill operation | Not run by implementor. Function is ready for orchestrator/operator invocation after migration + deploy. | Deploy/run commands below. |

## Migration Chain

New ORCH-0957 migration filename:

```text
supabase/migrations/20260727000001_orch_0957_place_pool_thumbs_backfilled_at.sql
```

Source-reconciled remote-only migrations copied into this worktree before creating the ORCH-0957 migration:

```text
supabase/migrations/20260725000002_orch_0950_expanded_scope_dashboard_coherence.sql
supabase/migrations/20260727000000_orch_0955_native_stripe_tax.sql
```

Remote column pre-flight probe:

```text
SELECT column_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='place_pool'
  AND column_name='thumbs_backfilled_at';

Result: []
```

`/Users/sethogieva/bin/supabase migration list --linked` from this worktree showed all remote versions have matching local files. The only local-only version is `20260727000001`, which is the ORCH-0957 migration to apply.

Operator migration command, copy-paste-ready:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]" && /Users/sethogieva/bin/supabase db push --linked
```

No `--include-all` is required because the remote-only drift was source-reconciled before handoff.

## Verification

Passed:

```bash
/Users/sethogieva/.deno/bin/deno check supabase/functions/_shared/imageCollage.ts supabase/functions/_shared/photoStorageService.ts supabase/functions/backfill-place-photo-thumbs/index.ts
/Users/sethogieva/.deno/bin/deno test --allow-net --allow-env supabase/functions/_shared/imageCollage.test.ts supabase/functions/_shared/photoStorageService.test.ts supabase/functions/backfill-place-photo-thumbs/index.test.ts
node .github/scripts/strict-grep/orch-0957-no-metered-place-photo-reads.mjs
node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs
/Users/sethogieva/bin/supabase migration list --linked
```

Test result summary:

```text
Deno tests: 17 passed, 0 failed
ORCH-0957 strict-grep: PASS
ORCH-0863 C7 backend allowlist gate: PASS against 12 backend files changed
Migration list: PASS; no remote-only rows after reconciliation
```

T-04 fails-on-revert proof:

```text
Commit under test: 1b32c3c0
Method: temporary git worktree at HEAD, then checkout HEAD^ version of supabase/functions/_shared/imageCollage.ts while keeping the new T-04 test.
Command: /Users/sethogieva/.deno/bin/deno test --allow-net --allow-env supabase/functions/_shared/imageCollage.test.ts
Expected result: FAIL
Observed result: FAIL, 4 failing tests including "transform — ORCH-0957 cost-control contract avoids metered URL by default".
T-04 failure reason: reverted helper returned a render URL instead of an object thumbnail URL.
Cleanup: temporary worktree removed with git worktree remove --force.
```

## Success Criteria Mapping

| SC | Status | Notes |
|---|---|---|
| SC-1 | Locally covered | Unit-level ingest test proves original + thumb upload and `thumbs_backfilled_at` when thumb succeeds. Runtime Google Places invocation remains tester/orchestrator gate. |
| SC-2 | Passed | `imageCollage.test.ts` default Supabase URL tests assert `_thumb.jpg`, object endpoint, and no sizing params. |
| SC-3 | Passed | Legacy mode test asserts `USE_PLACE_PHOTO_THUMBS=false` restores old shape. |
| SC-4 | Passed | Backfill T-06 spies outbound fetches and asserts all URLs are object endpoint URLs and none use render fallback. |
| SC-5 | Deferred | Operator dashboard eyeball at billing-day +14 per spec. |
| SC-6 | Deferred | Tester runtime 16-photo compose stress check after deploy. |
| SC-7 | Partially implemented | 404 fallback is implemented and defaults true. Tester should verify live missing-thumb behavior with both fallback settings. |
| SC-8 | Pending operator DB push | Migration is ready; tester verifies remote column/index and pending-row count after operator applies. |

## Deploy Notes

After the operator applies the migration, orchestrator should deploy:

```bash
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]" && /Users/sethogieva/bin/supabase functions deploy backfill-place-photo-thumbs --project-ref gqnoajqerqhnvulmnyvv
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]" && /Users/sethogieva/bin/supabase functions deploy run-place-intelligence-trial --project-ref gqnoajqerqhnvulmnyvv
cd "/Users/sethogieva/Desktop/mingla-orchs/0957-[storage-image-transform-overage]" && /Users/sethogieva/bin/supabase functions deploy backfill-place-photos --project-ref gqnoajqerqhnvulmnyvv
```

`places-autocomplete` was named in the spec as a possible shared-helper redeploy, but repo grep found no direct import of `_shared/photoStorageService.ts` or `_shared/imageCollage.ts` from that function in this branch. Orchestrator can still redeploy it defensively if desired; the direct consumers are listed above.

Backfill curl shape after deploy:

```bash
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"action":"preview_run","batchSize":25}'
```

Then create and run:

```bash
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"action":"create_run","batchSize":25}'
```

Use the returned `runId`:

```bash
curl -sS -X POST "https://gqnoajqerqhnvulmnyvv.supabase.co/functions/v1/backfill-place-photo-thumbs" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"action":"run_next_batch","runId":"<RUN_ID>"}'
```

## Risks / Follow-ups

- The backfill function reuses `photo_backfill_runs` and `photo_backfill_batches` to honor the one-migration scope. Run labels are fixed to `ORCH-0957 place-photo thumbs` / `GLOBAL` unless provided.
- I intentionally set `thumbs_backfilled_at` only when ingest thumb generation succeeds for all uploaded originals. This resolves the spec tension between §3.3 and T-08; otherwise failed thumbs would be hidden from retry/backfill.
- SC-5 cannot be closed locally. Tester should record Supabase Storage Image Transformations at deploy +24h and billing-day +14.
- Investigation D-1 remains for orchestrator CLOSE: broaden the external API docs invariant to include metering/cost rules.
