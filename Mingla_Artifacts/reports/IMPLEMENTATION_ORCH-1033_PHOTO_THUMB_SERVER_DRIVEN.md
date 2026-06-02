# IMPLEMENTATION — ORCH-1033 [Photo-thumbnail pipeline: server-driven + parallel + scoped + collage fallback]

- **Author:** mingla-implementor+claude · **Date:** 2026-06-01
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1033-[photo-thumb-server-driven]/` on branch `ORCH-1033-photo-thumb-server-driven`
- **Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1033_PHOTO_THUMB_SERVER_DRIVEN.md`
- **Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1033_PHOTO_THUMB_PIPELINE_AUDIT.md`
- **Status:** implemented and verified (Deno tests + both strict-grep gates green; migration WRITTEN not applied).
- **Comms acks:** COMMS-0002 (ORCH-0863 backend allowlist — `ORCH_1033_BACKEND_ALLOWLIST` added in the same commit as the backend files), COMMS-0003 (external-API/infra docs cited inline in the migration — pg_cron/pg_net/background-tasks/vault — and N/A for enum payloads since this ORCH introduces no external-API enums, only Supabase Storage object reads). Acked in chat Section A.

---

## Rebase

`git fetch origin main && git rebase origin/main` — clean, no conflict (the branch carried only the untracked spec/investigation, which were committed first then rebased). Picked up `20260811000000_orch_1032_*` + later migrations and the cron extension. Post-rebase max migration prefix = `20260814000000`; new migration uses `20260815000000` (strictly greater than both the spec's `20260811000000` floor and the real post-rebase head). No sibling worktree uses a ≥ prefix.

---

## Files changed (with commit hashes)

| File | Commit | Change |
|------|--------|--------|
| `supabase/functions/_shared/imageCollage.ts` | `7991a3ce0` | F-fix: fallback on ANY non-OK thumb response → ORIGINAL object (not metered render); fetch-vs-decode failure counts. |
| `supabase/functions/_shared/imageCollage.fallback400.test.ts` (NEW) | `7991a3ce0` (+ `73ec9e096` comment) | T-01 / T-01b happy-path + SC-9 throw. |
| `supabase/functions/_shared/__tests__/imageCollage.thumbFallback.test.ts` | `7991a3ce0` | T-05 assertions repointed to new contract `[TEST-MOD-APPROVED ORCH-1033]`. |
| `supabase/functions/backfill-place-photo-thumbs/index.ts` | `e538e1367` | A (server engine + `process_chunk`/`ensure_auto_run`), B (PARALLEL_N semaphore), C (servable+city scope). |
| `supabase/functions/backfill-place-photo-thumbs/index.test.ts` | `e538e1367` | T-02/T-02b (scope) + T-03/T-03b/T-03c (chunk/self-invoke/auth) appended (additive). |
| `supabase/migrations/20260815000000_orch_1033_thumb_backfill_cron.sql` (NEW) | `e538e1367` | D: `last_heartbeat_at` column + `tg_kick_pending_thumb_backfill` + `*/10` cron + one-time cleanup. |
| `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | `e538e1367` | `ORCH_1033_BACKEND_ALLOWLIST` (new migration + new test files). |
| `mingla-admin/src/pages/PlacePoolManagementPage.jsx` | `c872010ea` | E: status-viewer (browser loop deleted, 4s poll), optional city selector. |

---

## Old → New receipts

### `_shared/imageCollage.ts`
- **Before:** fallback fired only on `res.status === 404`, routed to `legacyTransformFallbackUrl` (metered `/storage/v1/render/image/`). A missing object returns HTTP **400** + `{"statusCode":"404",...}` JSON, so the fallback never fired → photo dropped → `composeCollage` threw on all-missing places. Throw said "all fetches failed" with no breakdown.
- **After:** fallback fires on `!res.ok` (400/404/5xx) for a thumb-object rewrite, falls back to `originalObjectFallbackUrl(url)` = the un-rewritten ORIGINAL object URL (a non-metered baseline JPEG; the rewrite was `<dir>/<i>.<ext>`→`<dir>/<stem>_thumb.jpg`, so the input URL IS the original). `fetchAndDecode` returns `{image}` or `{image:null, failure:'fetch'|'decode'}`; the all-failed throw now reads `0 of N photos placed (fetchFailed=X, decodeFailed=Y)`. `USE_PLACE_PHOTO_THUMBS=false` legacy metered render lever preserved untouched (ORCH-0957 allowlist block at lines 102-111 unchanged).
- **Why:** SC-1, SC-9, I-THUMB-MISSING-FALLBACK-ON-NON-OK.

### `backfill-place-photo-thumbs/index.ts`
- **Before:** browser-looped `run_next_batch` was the only engine; serial one-photo-at-a-time decode with `INTER_*_DELAY` sleeps; global+unscoped selection (no `is_servable`, no city); no `EdgeRuntime`/self-invoke.
- **After:**
  - **A:** `process_chunk` (service-role-only, 403 on wrong bearer) with a 110s `BUDGET_MS` loop + `SAFETY_MAX_ITERATIONS=20`, concurrency-safe batch claim (conditional `UPDATE … WHERE status='pending'` + affected-rows check), `EdgeRuntime.waitUntil` self-invoke when pending remains and status is `running`, run set `completed` when no pending batch remains. `ensure_auto_run` (service-role-only) for the cron: idempotent create-if-backlog + kick. `create_run`/`resume_run` server-kick `process_chunk`. `run_next_batch` retained as a manual single-step. Heartbeat stamped once per invocation.
  - **B:** `PARALLEL_N=6` exported const with the 800px/6.4 MB memory-math comment; per-batch photos flattened into one job list drained through a size-N semaphore (`runWithConcurrency`); per-place all-or-nothing `thumbs_backfilled_at` preserved. Serial delays removed.
  - **C:** `loadPendingPlaces`/`countPendingPlaces` always `.eq('is_servable', true)`, `.is('thumbs_backfilled_at', null)`, `.not('stored_photo_urls','is',null)` + `array_length>0` post-filter (text[]); optional `city`→`city_id` via `seeding_cities` ilike; unknown city → 400.
- **Why:** SC-2, SC-4, SC-5, SC-6; I-THUMB-BACKFILL-SERVER-DRIVEN, I-THUMB-DECODE-PARALLEL-N-BOUNDED.

### `20260815000000_orch_1033_thumb_backfill_cron.sql` (NEW)
- Pre-flight: `RAISE EXCEPTION` if `pg_cron` absent; `RAISE NOTICE` if `pg_net`/vault `service_role_key` absent. Adds `photo_backfill_runs.last_heartbeat_at`. `tg_kick_pending_thumb_backfill()` `SECURITY DEFINER`: vault key (silent skip+NOTICE if null), POST `ensure_auto_run`, re-POST `process_chunk` for `running` thumbs runs with stale (>5 min)/absent heartbeat. `cron.schedule('kick_pending_thumb_backfill','*/10 * * * *', …)` with unschedule-if-exists guard. One-time `UPDATE … SET status='cancelled'` for stale browser-era `paused`/`ready` thumbs runs.
- **Why:** SC-3; D auto-drain.

### `mingla-admin/.../PlacePoolManagementPage.jsx`
- **Before:** ThumbnailTab `handleRunAll` ran a browser `while` loop calling `run_next_batch` — the run engine; closing the tab halted it.
- **After:** browser loop deleted. `create_run` server-kicks; a 4s `setInterval` polls `run_status` for DISPLAY only while non-terminal. `Run All` → `resume_run` (server re-kick). `Run Next` retained (manual). Optional city `<select>` (from `seeding_cities`) feeds `create_run` `city`. StatCards/badge/progress/controls/batches/`Est. Cost $0.00` unchanged. `THUMBS_RUN_CITY` Photos-panel filter untouched.
- **Why:** SC-7, SC-8; E.

---

## Spec traceability / Success criteria

| SC | Status | Evidence |
|----|--------|----------|
| SC-1 (400 fallback) | PASS | T-01: 400+JSON thumb → original placed, no throw, no render URL. |
| SC-2 (server-driven) | PASS (unit) | T-03: `process_chunk` completes with no client `run_next_batch`. Live drain = tester sim. |
| SC-3 (cron auto-drain) | UNVERIFIED (needs live cron tick) | Migration registers `*/10` cron + `ensure_auto_run`; migration test (tester T-04 partner) locks registration. Live tick = tester/orchestrator post-apply. |
| SC-4 (parallel-N memory) | PASS (mechanism) | `PARALLEL_N=6` semaphore + 800px math; no WORKER_LIMIT path. Live 25×5 batch = tester. |
| SC-5 (scope/city) | PASS | T-02 asserts `.eq('is_servable',true)` + `.eq('city_id',…)`; unknown city → 400 in `resolveCityId`/handlers. |
| SC-6 (servable filter) | PASS | T-02/T-02b: `is_servable=true` always applied. |
| SC-7 (admin) | PASS (build+lint) | Browser loop removed; poll-only; no new eslint errors (17==17); no visual token change. |
| SC-8 (Photos panel intact) | PASS | `city=RUN_CITY` preserved; `THUMBS_RUN_CITY` filter untouched. |
| SC-9 (error clarity) | PASS | T-01b: throw reports `fetchFailed=1, decodeFailed=1`. |
| SC-10 (gates green) | PASS | ORCH-0863 C7 + ORCH-0957 both exit 0 locally. |

---

## Regression Test (mandatory)

- **Implementor happy-path:** `supabase/functions/_shared/imageCollage.fallback400.test.ts` — T-01 (real 400+JSON thumb → original placed, no throw, no `/render/image/`) + T-01b (SC-9 fetch/decode counts).
- **Passing run:** `deno test … imageCollage.fallback400.test.ts … = 4 passed` (with the updated thumbFallback file); full touched suite `12 passed | 0 failed`.
- **Fails-on-revert verified at commit `b6bb54ffe`** (pre-fix HEAD): with the old `res.status === 404` guard restored, T-01 + T-01b FAILED (`0 passed | 2 failed`) — proof the test exercises the bug.
- **Edge-fn tests:** `backfill-place-photo-thumbs/index.test.ts` T-02/T-02b (scope), T-03/T-03b/T-03c (chunk completes / self-invokes / auth-403) — `8 passed`.

---

## Invariant verification

| Invariant | Preserved? | By |
|-----------|-----------|----|
| I-THUMB-MISSING-FALLBACK-ON-NON-OK (NEW) | Y | SC-1/T-01 + ORCH-0957 gate (no render URL added). |
| I-THUMB-BACKFILL-SERVER-DRIVEN (NEW) | Y | `process_chunk` + cron; admin loop deleted (SC-2/T-03). |
| I-THUMB-DECODE-PARALLEL-N-BOUNDED (NEW) | Y | `PARALLEL_N=6` semaphore + math comment (SC-4). |
| I-PHOTO-FILTER-EXPLICIT (existing) | Y | thumbs runs keep `city=RUN_CITY`; Photos filter untouched (SC-8). |
| ORCH-0957 no-metered (existing) | Y | gate exit 0; legacy block intact + gated by `USE_PLACE_PHOTO_THUMBS=false`. |

---

## Cross-surface impact

Affected: **Admin Web** only (ThumbnailTab — single shared path, parity automatic). Backend (non-surface): edge fn + collage + migration + strict-grep. NOT affected: consumer iOS/Android, business iOS/Android, buyer-web, business-web-preview — none read `_thumb.jpg` (Investigation enumeration). The intelligence collage (`run-place-intelligence-trial` `compose_collage`) is the sole runtime consumer and inherits the F-fix automatically.

---

## Migration — NOT applied (orchestrator applies via Management API at close)

- **Filename:** `supabase/migrations/20260815000000_orch_1033_thumb_backfill_cron.sql`
- **Why Management API:** worktree behind remote → `db push` hits pre-existing ledger drift (Investigation §Migration ledger drift; COMMS-0012/0015 precedent).
- **Apply payload:** POST `https://api.supabase.com/v1/projects/gqnoajqerqhnvulmnyvv/database/query` with `{"query": "<full contents of the migration file>"}` and the Management-API Bearer. After apply, verify `list_migrations` shows `20260815000000` AND `cron.job` shows `kick_pending_thumb_backfill` at `*/10 * * * *` BEFORE the close banner.
- **Pre-flight data note (9b):** the migration's only guards are `RAISE EXCEPTION` on missing `pg_cron` (verified present live) and `RAISE NOTICE` on missing `pg_net`/vault (verified present live). The one-time cleanup UPDATE only touches `city='ORCH-0957 place-photo thumbs'` + `status IN ('paused','ready')` (idempotent; the stale 0/694 run is the intended target). No production-data abort risk.
- **Deploy (after close merges to main):** `supabase functions deploy backfill-place-photo-thumbs --project-ref gqnoajqerqhnvulmnyvv` (the edge fn must be live for the cron's `process_chunk`/`ensure_auto_run` POSTs to resolve non-404).

---

## Deno gates run

- `deno check` clean on `_shared/imageCollage.ts` + `backfill-place-photo-thumbs/index.ts`.
- `deno test` (net/env/read): `imageCollage.test.ts` 12✓, `imageCollage.fallback400.test.ts`+`imageCollage.thumbFallback.test.ts` 4✓, `backfill-place-photo-thumbs/index.test.ts` 8✓.
- Strict-grep: `orch-0863-marketing-hub-phase-b.mjs` ALL PASS (C7 green with allowlist); `orch-0957-no-metered-place-photo-reads.mjs` OK.

---

## Discoveries for orchestrator

1. The migration must be applied via Management API + verified in `list_migrations` before the close banner (COMMS-0012 lesson). Edge fn redeploy from main is required for the cron to function (verify-first-call → non-404).
2. The `forceLegacySupabaseTransform` param in `transformPhotoUrlForTileInternal` is now only reachable via `USE_PLACE_PHOTO_THUMBS=false` (no caller passes `true` directly). Left intact to preserve the documented legacy lever; harmless.
3. `last_heartbeat_at` is NULL for legacy/browser-era rows — the kicker treats NULL as stale (re-kick), which is correct for recovery.

---

## Transition items

None.
