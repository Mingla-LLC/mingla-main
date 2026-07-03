# IMPLEMENTATION — META-ORCH-1270 PHASE 2 — Guardrails / safety net

Date: 2026-07-03 · Implementor: mingla-implementor (Claude)
Worktree: `~/Desktop/mingla-orchs/META-ORCH-1270-[bunny-migration]/` · Branch: `META-ORCH-1270-bunny-migration`
Builds on Phase 1 (`e19854b1c`). Contract: `Mingla_Artifacts/specs/SPEC_META-ORCH-1270_bunny_migration.md` §4 (Phase 2 only).

Status: **implemented and self-verified** (Deno `deno check` clean on all touched edge files; 23 new Phase-2 unit tests pass; all 4 required areas proven fails-on-revert; 0 Phase-1 / api-health regressions across 103 pre-existing tests). Nothing deployed, no secrets set, provider NOT flipped, no PR.

---

## 1. Summary (plain English)

Added the leak-proofing so a Bunny overage can never again kill the account, landing BEFORE the provider flip. Four guardrails: (1) every place a cover-video job dies now reclaims its Bunny asset — inline on supersede/cancel/replace plus a 6-hourly reaper cron that sweeps anything missed; (2) the delivered-video size cap (already enforced in Phase 1) is locked with a regression guard; (3) a Bunny storage/traffic usage alarm that ACTUALLY fires — including a distinct alert when the usage read itself goes blind (the exact way the old Cloudinary alarm stayed silent); (4) a pre-upload circuit-breaker that refuses new uploads once usage crosses a hard cap. Cloudinary behavior is byte-for-byte unchanged; all new knobs are env vars with documented defaults.

## 2. Files created / changed (commit `<PHASE2_HASH>`)

New:
- `supabase/functions/event-cover-video-reaper/index.ts` — cron-invoked reaper (pure `selectReapTargets` + `handleReaper`).
- `supabase/migrations/20261205000003_meta_orch_1270_reaper_and_alarm.sql` — `reaped_at` column + reaper partial index + `bunny` health seed + reaper cron.
- `supabase/functions/api-health-probe/__tests__/meta_orch_1270_bunny_usage_pct.test.ts` (8 tests)
- `supabase/functions/event-cover-video-reaper/__tests__/meta_orch_1270_reaper_selection.test.ts` (7 tests)
- `supabase/functions/event-cover-video-reaper/__tests__/meta_orch_1270_destroy_on_terminal.test.ts` (4 tests)
- `supabase/functions/event-cover-video-upload-intent/__tests__/meta_orch_1270_bunny_circuit_breaker.test.ts` (4 tests)

Modified:
- `supabase/functions/_shared/bunnyStream.ts` — `bunnyFetchLibraryUsage()` (account usage read) + pure `bunnyUsagePct()` + `bunnyAccountApiKey()`.
- `supabase/functions/api-health-probe/index.ts` — `probeBunny()`, registered `["bunny", probeBunny, null]`, env fallback for `bunny_usage_pct`, informational `webhookFreshness("bunny", …)`.
- `supabase/functions/api-health-probe/logic.ts` — `bunny_usage_pct` case in `evaluateBalanceForSignal` (incl. the null→warn `probe_unreadable` guard).
- `supabase/functions/event-cover-video-upload-intent/index.ts` — circuit-breaker (`checkBunnyCapacity`/`evaluateCapacityBreaker`/`readBunnyUsagePercent`) + supersede reaping (`reapSupersededBunnyAssets`).
- `supabase/functions/event-cover-video-cancel/index.ts` — cancel destroy routed through agnostic `destroyCoverVideoAsset` + `reaped_at` stamp.
- `supabase/functions/event-cover-video-apply/index.ts` — cover-replace reaping of the prior applied Bunny cover.
- `supabase/config.toml` — `[functions.event-cover-video-reaper] verify_jwt = false`.

## 3. Reaping — every orphan path now closed

| Terminal transition | Where | Behavior |
|---|---|---|
| **Supersede** (new upload cancels prior active) | `upload-intent` `reapSupersededBunnyAssets` | after the supersede UPDATE, SELECT the newly-cancelled `failure_code='superseded'` Bunny rows → `destroyCoverVideoAsset` each → stamp `reaped_at` on success |
| **Cancel** (explicit) | `event-cover-video-cancel` | swapped the direct `cloudinaryDestroy` for the agnostic `destroyCoverVideoAsset(job)` (Cloudinary still destroys its resolved public_id — behavior-preserving — Bunny now deletes the guid) + `reaped_at` on success |
| **Cover-replace** (published_manual / brand apply) | `event-cover-video-apply` `reapPriorAppliedBunnyCover` | before writing the new `cover_media_url`, find the PRIOR `status='applied'` Bunny job for the target (id≠self, un-reaped) → destroy + `reaped_at` |
| **Failure** (Bunny webhook) | `event-cover-video-webhook` (Phase 1, unchanged) | already calls `destroyCoverVideoAsset` on the failed / derivative-invalid branches; the reaper idempotently backstops `reaped_at` (see note) |
| **Backstop** | new `event-cover-video-reaper` cron (every 6h) | sweeps `{cancelled, failed}` + abandoned drafts (`source_uploaded`/`ready`, unapplied, >24h) with `source_asset_id NOT NULL AND reaped_at IS NULL`; destroy → stamp `reaped_at`; abandoned also flipped `failed:reaped_abandoned` |

- **Bunny-only by construction.** Inline supersede/replace reaping is gated on the row's `provider === 'bunny'`, and the reaper's candidate query + `selectReapTargets` require a non-null `source_asset_id` — which ONLY Bunny jobs carry (Cloudinary stores its id in `source_public_id`). So the active Cloudinary path is byte-for-byte unchanged; Cloudinary reaping stays out of scope until Phase 4 (per spec §4.1).
- **`reaped_at` guards double-delete;** a Bunny delete of an absent guid returns 404 → treated as ok → idempotent. On a destroy FAILURE `reaped_at` is left NULL so the next reaper run retries.
- **Webhook failure branch NOT re-touched** (honoring the hard guard "do not alter Phase-1 Bunny logic"): it already reaps in Phase 1; the reaper stamps `reaped_at` on the next run (one idempotent 404→ok round-trip, no leak).
- **Known residual (documented, in-scope-bounded):** an event `draft_auto` cover replaced via the webhook auto-apply leaves the PRIOR applied job at `status='applied'` (not caught by the reaper, which only sweeps cancelled/failed/abandoned). The task scoped cover-replace reaping to `event-cover-video-apply` (published_manual/brand) and forbade touching the Phase-1 webhook, so this is a deliberate boundary to close when Phase-1 webhook logic is next revisited.

## 4. Delivered-derivative byte cap (item 2)

Already enforced by Phase 1 §3.4: the webhook ready-path does `HEAD best.url` → `content-length` → `assertProcessedDerivative({ bytes … })` which rejects `bytes > FINAL_MAX_BYTES` (25 MB) → `failJob` (destroy + fail). Per the task ("do not duplicate the source cap; the delivered cap is here"), no code was duplicated; the invariant is left intact and backed by the existing Phase-1 webhook Finished test. A missing `content-length` coerces to 0 → still fails closed (`processed_size_invalid`).

## 5. Usage alarm that ACTUALLY fires + the null-guard fix (item 3)

- **`probeBunny()`** reads `GET https://api.bunny.net/videolibrary/{BUNNY_STREAM_LIBRARY_ID}` with `AccessKey: {BUNNY_ACCOUNT_API_KEY}`, computes `used_percent = max(storagePct, trafficPct)` against `BUNNY_STORAGE_CAP_BYTES` / `BUNNY_TRAFFIC_CAP_BYTES`. Registered as a Layer-B synthetic probe; `bunny_usage_pct` balance kind wired warn=`API_HEALTH_BUNNY_WARN_PCT` (60), crit=`API_HEALTH_BUNNY_CRIT_PCT` (85). Synthetic `down` iff `used_percent >= crit`.
- **VECTOR-D ROOT-CAUSE FIX (the alert must FIRE):** a non-numeric / failed usage read does NOT silently resolve to healthy.
  - config **ABSENT** (account key / library id / caps missing) → `status:"unknown"` (grey), `balanceLow:null`, NO alert — the correct pre-cutover state.
  - config **PRESENT but the read fails / is non-numeric** → `probeBunny` returns `status:"degraded"` + `detail.probe_unreadable=true`; `evaluateBalanceForSignal` case `bunny_usage_pct` returns `{balanceLow:true, severity:"warn", balanceText:"…probe_unreadable…"}` → a DISTINCT low-balance alert fires (never green). This is the exact silent-green failure mode that kept the Cloudinary alarm quiet.
- **Alert path reached + one-shot not skipped:** the `bunny` alert is a `balanceLow` signal → `decideBalanceTransition` → `runAlertStateMachine.trySend("balance_low", …)` → `sendOpsAlertEmail` (Resend), the SAME path all Class-A balance alarms use. The Phase-2 migration seeds BOTH the `api_health_services` `bunny` row (`monitoring_class='A'`, `depletion_signal.balance.kind='bunny_usage_pct'`, warn 60/crit 85) AND the `api_health_alert_state` `bunny` row — without the state row `runAlertStateMachine` `continue`s past it and the one-shot email is never sent (Vector-D failure #5).

## 6. Pre-upload circuit-breaker (item 4)

`upload-intent`, Bunny branch, BEFORE any `bunnyCreateVideo` (placed before supersede so a capacity refusal does not cancel the user's prior upload). Reads usage via `readBunnyUsagePercent`: (1) the freshest `api_health_checks` bunny synthetic row < 1h wins (zero Bunny calls — the hourly probe is the primary cache); (2) else a live `bunnyFetchLibraryUsage`, module-cached 60s so a burst of intents can't hammer Bunny's account API. `evaluateCapacityBreaker(used, hardCap)` decides against `EVENT_COVER_UPLOAD_HARD_CAP_PCT` (default 90). Blocked → `503 { error:"capacity_reached", detail:"…temporarily paused…" }`, no video signed.

- **FAIL-OPEN vs FAIL-CLOSED decision (explicit):** a usage-read FAILURE (null / unreadable) **FAILS OPEN** — `{blocked:false, reason:"usage_unreadable_fail_open"}`, logged loudly — because a Bunny read outage must NOT wedge ALL uploads permanently. Only a REAL numeric reading `>= hardCap` **FAILS CLOSED**. This is encoded in the pure `evaluateCapacityBreaker` (unit-tested) and matches the task's recommendation. The probe alarm (item 3) is the safety net that pages if the read is persistently blind, and the reaper (item 1) keeps storage bounded regardless.
- Deviation from spec §4.4 wording: the error code is `capacity_reached` (per the dispatch's explicit `{error:"capacity_reached"}`) rather than the spec draft's `media_unavailable`; HTTP is 503 (spec's fail-closed semantic). The client already surfaces an unknown edge error as a toast, so no client change is required; the optional `media_unavailable`→copy mapping in `processingErrorFromPayload` (spec §4.4) was left to the client-touching follow-up (this task scoped item 4 + VERIFY to edge files).

## 7. New env vars (Deno.env only, documented defaults)

| Var | Default | Used by |
|---|---|---|
| `BUNNY_ACCOUNT_API_KEY` | — (config-absent → grey) | `bunnyFetchLibraryUsage` (account usage read) |
| `BUNNY_STORAGE_CAP_BYTES` | — (0 → grey) | `probeBunny`, circuit-breaker |
| `BUNNY_TRAFFIC_CAP_BYTES` | — (0 → grey) | `probeBunny`, circuit-breaker |
| `API_HEALTH_BUNNY_WARN_PCT` | 60 | `bunny_usage_pct` warn threshold |
| `API_HEALTH_BUNNY_CRIT_PCT` | 85 | `bunny_usage_pct` crit + probe `down` |
| `EVENT_COVER_UPLOAD_HARD_CAP_PCT` | 90 | circuit-breaker fail-closed threshold |

## 8. Migration `20261205000003_meta_orch_1270_reaper_and_alarm.sql` (authored, NOT applied)

- `ADD COLUMN IF NOT EXISTS reaped_at timestamptz` + partial index `WHERE reaped_at IS NULL AND source_asset_id IS NOT NULL` (reaper scan).
- Seed `bunny` into `api_health_services` (+ `monitoring_class='A'`, `depletion_signal` bunny_usage_pct warn 60/crit 85, status_feed NULL) and an `api_health_alert_state` row.
- Reaper cron `meta_orch_1270_cover_video_reaper` `0 */6 * * *` via `net.http_post` + vault `supabase_url`/`service_role_key` (ORCH-1201 pattern). Self-verify block asserts the cron, the `reaped_at` column, and both bunny rows.
- **Prefix `20261205000003`** is strictly greater than every local migration (max `20261205000000_meta_orch_1270_bunny_provider`) AND every sibling worktree (max `20261205000002_orch_1272_admin_get_person` in `1272-[admin-identity-console]`). Monotonic-safe. Adding the `bunny` row makes `api_health_services` count 26; the ORCH-1201 `count(*)=25` verify lives in an already-applied migration and does NOT re-run.

## 9. Verification (real output)

- `deno check` — all 7 touched edge files: **clean, no errors.**
- Phase-2 unit tests: **23 passed | 0 failed** (bunny_usage_pct 8, reaper-selection 7, destroy-on-terminal 4, circuit-breaker 4).
- **Fails-on-revert (all 4 required areas, true line-deletion then restore):**
  - null→warn guard removed from `logic.ts` → `probe_unreadable` test FAILS (`balanceLow got null`); restored → green.
  - `reaped_at` skip removed from `selectReapTargets` → already-reaped test FAILS; restored → green.
  - circuit-breaker block removed from `upload-intent` → 503 test FAILS; restored → green.
  - `reaped_at` stamp removed from `handleReaper` → destroy-on-terminal tests FAIL; restored → green.
- No regression: Phase-1 upload-intent bunny-provider (1), Phase-1 webhook (13), bunnyStream shared (4), and all api-health-probe root tests (85) pass after the Phase-2 changes.

## 10. Fail-safe posture (documented)

- **Reaper:** never throws into the cron tick (returns 200 so pg_cron doesn't retry-storm); a destroy failure leaves `reaped_at` NULL for retry; `reaped_at` prevents double-delete; Bunny-not-configured → `bunnyDeleteVideo` returns `{ok:false}` → skipped, retried later.
- **Circuit-breaker:** FAIL-OPEN on read error (loudly logged) so a Bunny read outage cannot permanently block uploads; only a real ≥90% reading fails closed.
- **Alarm:** config-absent is grey (never green, never a false page); config-present-but-unreadable fires a distinct warn (never silent-green).

## 11. Operator action required (NOT done here — cutover order per spec §8)

1. Apply the migration from a LINKED checkout after re-running the drift/monotonicity check (`supabase migration list --linked` was not runnable in this worktree — no linked `.temp`).
2. Deploy edge fns: `event-cover-video-reaper` (NEW), `api-health-probe`, `event-cover-video-upload-intent`, `-cancel`, `-apply` (+ shared `bunnyStream.ts`, `eventCoverVideo.ts`). Reaper needs `verify_jwt=false` (config.toml set).
3. Set the Phase-2 secrets on LIVE prod `gqnoajqerqhnvulmnyvv`: `BUNNY_ACCOUNT_API_KEY`, `BUNNY_STORAGE_CAP_BYTES`, `BUNNY_TRAFFIC_CAP_BYTES` (+ optional `API_HEALTH_BUNNY_*_PCT`, `EVENT_COVER_UPLOAD_HARD_CAP_PCT`).
4. Force one `api-health-probe` run; confirm a numeric `bunny` `used_percent` `api_health_checks` row and that the Resend alert path can send (RESEND_API_KEY non-sandbox, `API_HEALTH_ALERT_EMAILS` includes seth@usemingla.com, cron + vault present).
5. ONLY THEN flip `EVENT_COVER_VIDEO_PROVIDER=bunny` (Phase 1 cutover).

## 12. Live-blocked (retest at cutover with real Bunny creds)

- `probeBunny` against a real `api.bunny.net/videolibrary/{id}` (StorageUsage/TrafficUsage field names + auth) — verified vs docs, not live-fired.
- Live-fire the alarm email (set a low `BUNNY_TRAFFIC_CAP_BYTES` so `used_percent` crosses warn; force a probe; confirm a real "Bunny balance low" email lands — headless QA insufficient per the RPC-gap rule).
- Reaper end-to-end: upload 4 covers to one event; assert each superseded guid GETs 404; abandon a draft, run the reaper, assert the asset is gone + job `reaped_abandoned`.
