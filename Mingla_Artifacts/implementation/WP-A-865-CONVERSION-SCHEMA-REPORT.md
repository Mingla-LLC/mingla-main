# IMPLEMENTATION — ISSUE-865 WP-A [Attribution Engine — conversion-tracking schema + capture edge fn]

**Phase:** IMPLEMENT (WP-A only). **Author:** mingla-implementor+claude · **Date:** 2026-07-18
**Worktree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine` (rebased on `origin/main`, clean; now 9 commits ahead: 6 spec/investigation + 3 WP-A).
**Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md` §5.1 + Amendment **A3**; `Mingla_Artifacts/investigations/INVESTIGATION_ISSUE-865_ENGINE_REVALIDATION.md` (WP-A).
**Status:** implemented and verified (backend gates green; live-fire is a WP-B/WP-C/tester concern, not WP-A).

---

## 1. Summary

Built ONLY WP-A: the backend conversion-tracking schema and the capture edge function. Two new tables (`ad_attribution_touches`, `ad_conversions`) sit on top of the SHIPPED 5-channel ad engine — every `campaign_id` FK targets `public.ad_campaigns` and a new `connection_id` targets `public.ad_connections` (Amendment A3-1/A3-2), NOT the never-shipped `meta_campaigns`. `ad_conversions.event_id` is `UNIQUE` — the single browser↔CAPI dedup / idempotency guard. A new anon `attribution-capture` edge function records touches and conversions, is **fail-open** (never 5xx — it will be called post-finalize by WP-B), **idempotent** on `event_id`, resolves the per-lane `ad_connections` row reading env-var **NAMES only** (never a token value), writes as service-role, and hashes PII in-memory (SHA-256) so raw PII never reaches Postgres.

**Nothing else was built.** No CAPI senders, no finalize hook, no web pixels, no admin rollup (WP-B/WP-C/WP-E — gated on Seth). **Zero web/browser files and zero purchase/finalize files were touched** (verified below).

---

## 2. SPEC success-criteria coverage (WP-A slice)

WP-A delivers the schema + capture foundation; the end-to-end SCs (SC-2 threading, SC-4 CAPI send, SC-5/SC-15 live dedup, SC-6/SC-7 rollups) are WP-B/C/E and are explicitly out of scope.

| SC | Statement (WP-A portion) | Verified | Commit |
|----|--------------------------|----------|--------|
| SC-1 (schema) | a touch persists ONE `ad_attribution_touches` row with network/external_click_id/campaign_id/surface/page ref — the table + columns exist and accept the row | ✓ SQL suite T-1 + touch insert | `e47970394` |
| SC-3 (idempotent conversion) | exactly ONE `ad_conversions` row per `event_id`; re-delivered event writes no 2nd row | ✓ SQL T-2 (`INSERT 0 1` then `INSERT 0 0`); Deno dedup test | `e47970394` / `98ac00af2` |
| SC-4 (status columns) | per-channel send status is recordable (fail-open field) | ✓ 5 `*_status` cols (meta/tiktok/snap/reddit CAPI + appsflyer), default `pending` | `e47970394` |
| SC-8/SC-9 (privacy) | no raw email/phone/IP stored; only hashes | ✓ SQL T-4 (no raw-PII column); Deno sha256 vector; fn hashes in-memory | `e47970394` / `0c627b771` |
| RT-1 (fail-open) | the capture path never throws/5xx upward | ✓ Deno: malformed / throwing-client / DB-error all → 200 soft | `0c627b771` / `98ac00af2` |
| RT-2 (idempotency guard) | reverting `UNIQUE(event_id)` fails a test | ✓ fails-on-revert proven (§6) | `98ac00af2` |
| A3-1 (generalized FKs) | `campaign_id`→`ad_campaigns`, not `meta_campaigns` | ✓ SQL T-1 FK probe | `e47970394` |
| A3-2 (per-lane resolve, no secret values) | connection resolved from `ad_connections` by (platform,lane); NAMES only | ✓ fn `resolveConnectionId`; `issue-862-ad-token-env-server-only` gate PASS | `0c627b771` |

---

## 3. Files changed

| File | Δ | Kind |
|------|---|------|
| `supabase/migrations/20270105000865_issue_865_attribution_conversion_schema.sql` | +164 | new migration (NOT applied) |
| `supabase/functions/attribution-capture/index.ts` | +322 | new edge fn |
| `supabase/functions/attribution-capture/index.test.ts` | +188 | new Deno test |
| `supabase/migrations/__tests__/issue_865_attribution_conversion_schema.test.sql` | +193 | new SQL contract suite |
| `supabase/config.toml` | +12 | `[functions.attribution-capture] verify_jwt=false` block |

No other files. `git status` = `M config.toml` + 3 new paths only.

---

## 4. Data-model changes applied (in the migration — NOT yet run on prod)

**`public.ad_attribution_touches`** (append-only): `id` PK; `click_id text NOT NULL UNIQUE` (first-party id); `network` CHECK 5 channels + `other`; `external_click_id`; `connection_id`→`ad_connections` (SET NULL); `campaign_id`→`ad_campaigns` (SET NULL); `lane` CHECK consumer/business; `af_c_id`; `utm jsonb`; `dest_page_type/brand_slug/entity_slug`; `dest_event_id`→`events`; `surface` CHECK web/ios/android; `user_id`→`auth.users`; `af_uid`; `ua_hash`/`ip_hash` (SHA-256 hex only); `created_at`.

**`public.ad_conversions`**: `id` PK; `touch_id`→touches (SET NULL); `click_id`; `order_id`→`orders` (SET NULL); `event_type` CHECK purchase/reservation/lead/view; `event_name` (CAPI name — dedup PAIR with event_id, A2-5); `value_cents` (≥0); `currency`; `connection_id`→`ad_connections`; `campaign_id`→`ad_campaigns`; `platform`/`lane` CHECKs; `brand_id`, `mingla_event_id` (nullable, for WP-E rollups — `mingla_event_id` renamed from §5.1's colliding second `event_id uuid`); `surface`; **`event_id text NOT NULL UNIQUE`** (dedup/idempotency guard); `event_source_url`; `hashed_email`/`hashed_phone` (SHA-256 hex only); `meta_capi_status`/`tiktok_events_status`/`snap_capi_status`/`reddit_capi_status`/`appsflyer_status` (default `pending`, CHECK pending/sent/failed/skipped); `provider_response jsonb` (never a token); `created_at`/`updated_at`.

**Constraints/indexes:** `UNIQUE(event_id)` + `UNIQUE(click_id)` (auto-indexed dedup keys); 4 touch indexes (connection/campaign/external_click/created_at) + 7 conversion indexes (touch/click/order/connection/campaign/brand/created_at). **Trigger:** `trg_ad_conversions_updated_at` reuses the ad-engine `public.tg_ad_engine_set_updated_at()`.

**RLS:** both tables `ENABLE ROW LEVEL SECURITY`; admin-only `SELECT` via `public.is_admin_user()`; NO insert/update/delete policy (service-role writes bypass RLS); `GRANT SELECT … TO authenticated`, `GRANT ALL … TO service_role`. Verbatim the ad-engine foundation idiom. The WP-E brand-scoped proof-feed SELECT policy is deferred (needs `brand_id` populated by WP-B's fire helper) — noted in-file.

---

## 5. Edge functions touched

| Function | State | verify_jwt | Notes |
|----------|-------|-----------|-------|
| `attribution-capture` | **NEW** | **false** (`config.toml`) | Anon buyer surface + internal S2S caller; writes as service_role; fail-open; idempotent. Same anon idiom as `discover-merged-events`. |

No existing edge function was modified. Deploy is orchestrator/operator-owned from MERGED main (§11).

---

## 6. Regression tests added + fails-on-revert

**A. SQL contract suite** — `supabase/migrations/__tests__/issue_865_attribution_conversion_schema.test.sql` (one rollback txn; raw-Docker `psql`, `supabase/postgres:17.4.1.075`, per COMMS-0102):
- T-1 schema/constraints (UNIQUE event_id + click_id; FK→ad_campaigns/ad_connections; 5 status cols).
- **T-2 IDEMPOTENCY** — same `event_id` inserted twice via `ON CONFLICT (event_id) DO NOTHING` → `INSERT 0 1` then `INSERT 0 0` → exactly one row.
- T-3 RLS negative — `set role authenticated` reads 0 rows + INSERT denied; `set role service_role` INSERT succeeds.
- T-4 privacy — no raw email/phone/ip/ua column; `*_hash` present.
- Result: `ISSUE-865 WP-A schema suite: T-1..T-4 PASS` (exit 0).

**B. Deno handler suite** — `supabase/functions/attribution-capture/index.test.ts` (exercises the exported `handleCapture` with an injected mock client — runtime, not source-grep, per COMMS-0106): 12 tests, **12 passed / 0 failed**. Covers fail-open (malformed / throwing-client / DB-error / storage-missing all → 200, never 5xx), dedup reporting (deduped true/false), touch click_id, method/CORS, and the sha256 pgcrypto vector.

**fails-on-revert verified at `98ac00af2`.** TRUE LINE DELETION (not comment-out): removed ` UNIQUE` from the `event_id` column in a copy of the migration, applied to a fresh DB, re-ran the suite →
`ERROR: T-1 FAIL: UNIQUE(event_id) idempotency guard missing on ad_conversions` (exit 3). Restored (real file) → `T-1..T-4 PASS` (exit 0). The Deno RT-1 anchor is the throwing-client test: deleting `handleCapture`'s try/catch surfaces the throw and fails that test.

Append-only: only new test files added; no existing test modified/deleted.

---

## 7. Old → New receipts

### supabase/migrations/20270105000865_issue_865_attribution_conversion_schema.sql (new, +164)
**Before:** no attribution/conversion tables on main (greenfield — investigation F-2). **Now:** `ad_attribution_touches` + `ad_conversions` per §5.1 as corrected by A3. **Why:** SC-1/SC-3/SC-9 foundation. 

### supabase/functions/attribution-capture/index.ts (new, +322)
**Before:** no capture endpoint. **Now:** anon fail-open, idempotent (`ON CONFLICT event_id`), service-role-writing, per-lane-connection-resolving capture fn; PII hashed in-memory. **Why:** SPEC §5.2 attribution-capture + the dispatch's idempotent/fail-open/per-lane contract.

### supabase/config.toml (+12)
**Before:** no `attribution-capture` entry. **Now:** `[functions.attribution-capture] verify_jwt=false` with a rationale comment. **Why:** the fn must be reachable by the anon buyer surface and by the WP-B internal caller; it self-authorizes to the DB as service_role.

---

## 8. Cross-surface impact

| Surface | Affected | Why |
|---------|----------|-----|
| Consumer iOS / Android | No | backend-only; no app code touched |
| Buyer/anonymous Web | No | no web/browser file touched (WP-C) |
| Business iOS / Android | No | no app code touched |
| Admin Web | No | no rollup UI (WP-E) |
| Business Web preview | No | no web file touched |
| Backend (DB + edge) | **Yes** | 2 new tables (not applied) + 1 new anon edge fn (not deployed) |

Parity: N/A (single backend surface). No manual parity risk introduced.

---

## 9. Smoke result

Raw-Docker `supabase/postgres:17.4.1.075` (full 341-migration history needs the `vault` schema — the COMMS-0102 limitation — so a targeted fixture was used: minimal FK-target prelude + the REAL ad-engine foundation migration `20261230000000` + the #865 migration): migration **applied cleanly**, SQL suite **T-1..T-4 PASS**, Deno suite **12/12**. Fails-on-revert reproduced and restored. All strict-grep gates directly relevant to this change type PASS: `issue-862-ad-token-env-server-only` (7 client trees clean) and `orch-1205-edge-cors-x-client-info`. Container removed.

---

## 10. Known issues / deferred

- **`mingla_event_id`, `brand_id`** on `ad_conversions` are nullable and populated later by WP-B/WP-E (rollup resolution). No fabrication — NULL until resolved (Constitution #9).
- **Brand-scoped proof-feed RLS** (SELECT for a brand owner) is deferred to WP-E (needs `brand_id` populated). WP-A ships admin-read only.
- **Rate limit** on the anon touch path is per-isolate (in-memory) — best-effort defensive; a durable limiter can harden in WP-C if needed. Soft (never errors).
- No `[TRANSITIONAL]` code introduced.

---

## 11. Operator action required (orchestrator/operator — NOT the implementor)

1. **Apply the migration at CLOSE** (from the merged branch/worktree):
   ```bash
   cd "/Users/sethogieva/Desktop/mingla-orchs/issue-865-attribution-engine" && /Users/sethogieva/bin/supabase db push --linked
   ```
   Prefix `20270105000865` > prod head `20270104000000` (ORCH-1392, COMMS-0110) and > every sibling-worktree prefix; not a COMMS-0102 duplicate. Additive DDL only — no data backfill, no destructive predicate, no pre-flight guard, so no read-only remote probe is required.
2. **Deploy the edge function** from MERGED main: `attribution-capture` — **preserve `verify_jwt=false`**. No secrets needed for WP-A (it reads no token).
3. Migration-list `--linked` could not run in the worktree (not linked); monotonicity rests on the COMMS-0110 evidence that `20270104000000` is the applied prod head. Re-confirm no remote-only version before `db push`.

---

## 12. Discoveries for Orchestrator

- **SPEC §5.1 column collision:** `ad_conversions` lists `event_id` twice — `event_id uuid NULL` (rollups) and `event_id text NOT NULL UNIQUE` (dedup). Resolved by keeping the dedup key as `event_id` and renaming the rollup id to `mingla_event_id`. A3 may want to record this rename so WP-E/rollup SQL uses `mingla_event_id`.
- **Status columns widened to 5** (`snap_capi_status` + `reddit_capi_status` added beyond §5.1's meta/tiktok/appsflyer) to match A3's 5-channel engine + WP-B's four CAPI senders. WP-B should set these.
- **Pre-existing repo-wide gate noise:** running all strict-grep gates locally shows failures on `mingla-business`/`app-mobile` client files (currency, safearea, routing, etc.) and `@babel/parser`/`expo` module-not-found (worktree has no installed node_modules). NONE reference WP-A files — confirmed by a targeted grep returning zero hits. These are inherited, not introduced.
- **COMMS-0102 factored:** unique prefix used, raw-Docker test path used. COMMS-0112 (web-shim parity) does not bind WP-A (no `appsFlyerService` touched — that's WP-C2).
