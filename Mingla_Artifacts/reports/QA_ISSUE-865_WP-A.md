# QA — ISSUE-865 WP-A [Attribution engine — conversion-tracking schema + attribution-capture edge fn]

**Phase:** TEST (WP-A backend-only slice). **Tester:** mingla-tester+claude · **Date:** 2026-07-18
**Worktree:** `~/Desktop/mingla-orchs/issue-865-attribution-engine/` on branch `issue-865-attribution-engine`
**Under test:** commits `e47970394..1d5af2b42` (migration `20270105000865` + `attribution-capture` edge fn + `config.toml`).
**Contract:** `SPEC_ISSUE-865_ATTRIBUTION_ENGINE.md` §5.1/§5.2 + Amendments A1/A2/A3 + `INVESTIGATION_ISSUE-865_ENGINE_REVALIDATION.md`.
**Method:** LOCAL raw-Docker `supabase/postgres:17.4.1.075` (COMMS-0102 — `supabase start` broken on duplicate prefixes); a faithful fixture = FK-target prelude + a verbatim copy of `public.is_admin_user()` (baseline_squash L5420) + the REAL ad-engine foundation migration `20261230000000` + the target `20270105000865`. Deno 2.7.14 for the edge fn. NO linked prod project touched; NO ad-platform call; NO deploy; NO push. Container torn down at end.

---

## 1. VERDICT

**PASS** — P0: 0 · P1: 0 · P2: 0 · P3: 2 (Discoveries, non-blocking) · P4: 2 (observations).

Backend-only change → Phase-0.A live-fire sim gate EXEMPT (SQL/RLS/edge-fn only); all evidence is DB-runtime + Deno-runtime. Regression gate SATISFIED: the implementor's happy-path suites (fails-on-revert independently re-derived) AND two tester adversarial suites (different angles, on-branch, in-diff, each with its own fails-on-revert at a different line) are present. Migration applies cleanly on the prod-equivalent ad-engine chain; the `UNIQUE(event_id)` idempotency guard holds under real concurrent contention; FK integrity + ON-DELETE-SET-NULL preserve revenue records; RLS holds both directions; the edge fn is fail-open and never 5xx.

**FK ON-DELETE behavior found (dispatch's key ask):** ALL four `ad_conversions` FKs — `campaign_id`→`ad_campaigns`, `connection_id`→`ad_connections`, `order_id`→`orders`, `touch_id`→`ad_attribution_touches` — are **ON DELETE SET NULL**. This is the CORRECT choice: deleting/cancelling a parent campaign/connection/order/touch **preserves the revenue-relevant conversion row** and merely nulls the attribution link — no orphan, no wrong cascade-delete of a conversion. Proven live (Leg 3) and its inverse proven by revert (flip to CASCADE → conversion vanishes → tester A-2 fails).

---

## 2. SC / test-leg matrix (every row = reproducible runtime evidence)

| Leg | Claim | Verdict | Evidence |
|-----|-------|---------|----------|
| 1 · migration applies + schema shape | migration applies on the real foundation chain; both tables + all A3 columns; UNIQUE(event_id)+UNIQUE(click_id); FK→ad_campaigns/ad_connections; 11 rollup indexes; RLS enabled; updated_at trigger fires; prefix unique & > prod head | **PASS** | Applied clean on prelude+`20261230000000`+target. `ad_conversions` = 27 cols incl. event_id(text NOT NULL UNIQUE), event_name(NOT NULL), value_cents, currency, platform, lane, event_source_url, hashed_email/phone, 5 `*_status`(default pending), created_at/updated_at. UNIQUE: event_id, click_id. 15+15 indexes. Trigger `trg_ad_conversions_updated_at` bumps updated_at on UPDATE (proven). Prefix `20270105000865` > prod head `20270104000000` (COMMS-0110), count=1, none of the 6 COMMS-0102 duplicates. |
| 2 · idempotency (core guard) | same event_id twice → 1 row; concurrent → 1 row; different → 2 rows | **PASS** | 20 parallel connections, plain INSERT same event_id → **1 row, 19× SQLSTATE 23505**. 20 parallel ON CONFLICT DO NOTHING (edge-fn path) → **0 errors, exactly 1 row**. Interleaved 2-session → 2nd gets 23505, original payload NOT clobbered. 5 distinct ids → 5 rows. Implementor T-2 re-run: `INSERT 0 1` then `INSERT 0 0`. |
| 2 · fails-on-revert (re-derived) | delete UNIQUE(event_id) → defect reappears | **PASS** | Reverted schema (event_id, no UNIQUE): two plain inserts of same id → **2 rows (double-count)**; implementor suite fails `ERROR: T-1 FAIL: UNIQUE(event_id) idempotency guard missing`. Restored → `T-1..T-4 PASS`. |
| 3 · FK cascade + integrity | non-existent FK rejected; parent-delete = SET NULL (revenue survives); value_cents/enum boundaries | **PASS** | Non-existent campaign_id/connection_id → 23503 reject. Delete parent campaign/order/connection/touch → conversion **survives (1 row)**, link nulled, value_cents=1000 preserved. value_cents: 0 ok / −1 → 23514 / int4-max ok / 2147483648 → 22003. Unknown platform/lane/surface/event_type/*_status/network → 23514 each. |
| 4 · RLS both directions | non-admin → 0 rows + write denied; admin → reads; service-role → writes | **PASS** | Non-admin authed (real JWT sub, not in admin_users): is_admin=false, 0 conv + 0 touch visible, INSERT → RLS denial, UPDATE 0. **Admin authed (sub in admin_users): is_admin=true, sees rows** (positive case implementor under-covered), INSERT still denied (SELECT-only policy). Anon/no-claim: 0 rows, INSERT denied. service_role: writes + reads-all (bypassrls). |
| 5 · fail-open edge fn | malformed / duplicate / DB-unavailable all absorbed, never 5xx; auth gate | **PASS** | `deno check` clean; implementor suite **12/12**: malformed JSON, storage-null, THROWING client (both paths), DB-error → all 200 soft. Auth "401/403" is **N/A by design** — SPEC §5.2 (L142/149) mandates `verify_jwt=false` anon buyer surface; only method gate (non-POST → 405) + OPTIONS/CORS. |
| 6 · adversarial suite (committed) | different angle than the 12; ≥1 fails-on-revert at a different line; full suite + gates green | **PASS** | Deno tester suite (8) + SQL tester suite (4) added; combined **Deno 20/20**, both SQL suites PASS; `issue-862-ad-token-env-server-only` + `orch-1205-edge-cors-x-client-info` gates PASS; append-only clean. |

---

## 3. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Checked out state at HEAD `1d5af2b42`. **SQL suite** (`issue_865_attribution_conversion_schema.test.sql`): built a TRUE-line-deletion revert (`sed` removed only ` UNIQUE` from the `event_id` column, click_id UNIQUE left intact — diff verified one line), applied prelude+foundation+reverted-migration in-place. Result — the suite errored `T-1 FAIL: UNIQUE(event_id) idempotency guard missing on ad_conversions`; two plain inserts of the same event_id produced **2 rows**. Restored the real migration → `ISSUE-865 WP-A schema suite: T-1..T-4 PASS`.
**Note (P4):** the implementor report §6 says revert fails via the T-2 `ON CONFLICT` `42P10` error; in fact the suite trips EARLIER at T-1's explicit UNIQUE-existence check. Same net fails-on-revert — cosmetic doc inaccuracy only.
**Deno suite** (`index.test.ts`): re-ran → **12 passed / 0 failed**; the RT-1 anchor (throwing-client absorbed → 200) confirmed.

---

## 4. Adversarial tests added (tester-owned, append-only, in-diff)

1. `supabase/functions/attribution-capture/index.adversarial.tester.test.ts` (8 tests) — CAPTURES the row handed to the DB (the implementor's mock discards it) to assert **value_cents sanitization** (negative → null before insert, so the row is recorded not dropped), **PII hashing** (sha256 normalized email/phone; no raw column; not echoed), the **anon touch rate-limit** (61st → soft `rate_limited`), **isConversion routing**, and array/null-body absorption.
   **fails-on-revert verified:** removed `&& body.value_cents >= 0` (index.ts:230 — a DIFFERENT line than the implementor's outer try/catch anchor) → `T-ADV-1` failed with `AssertionError`; `git checkout` restored byte-identical → 8/8 pass.
2. `supabase/migrations/__tests__/issue_865_attribution_fk_cascade.tester.test.sql` (A-1..A-4) — the FK/boundary angle the implementor's SQL suite lacks: non-existent-FK reject, **ON DELETE SET NULL survival**, negative value_cents reject, unknown platform reject.
   **fails-on-revert verified:** flipped `ad_conversions.campaign_id` FK to `ON DELETE CASCADE` → `A-2 FAIL: conversion row did NOT survive parent-campaign delete (got 0 rows)`; restored SET NULL → `A-1..A-4 PASS`.

Both are NEW files (git status = 2 untracked additions), zero existing-test edits → append-only, no TEST-MOD token owed. Both appear in `git diff origin/main...HEAD --name-only` after the QA commit alongside the implementor's `index.test.ts` + `..._schema.test.sql`.

---

## 5. Constitution (relevant rules; backend slice)

| Rule | Verdict | Evidence |
|------|---------|----------|
| 2 One owner per truth | PASS | `ad_conversions`/`ad_attribution_touches` written only by `attribution-capture` (service-role). |
| 3 No silent failures | PASS | Fail-open is the RT-1 CONTRACT, not a swallow: every absorb logs `console.error` + returns a soft `{ok:false, soft_error}` the caller can read. Spec-mandated. |
| 9 No fabricated data | PASS | `mingla_event_id`/`brand_id` left NULL until WP-B/E resolve — never faked. |
| 10 Currency-aware | PASS | `currency` column carried on the conversion. |
| 1,4,5,6,7,8,11,12,13,14 | N/A | No UI/client/query-key/auth-instance/persisted-state surface in this backend slice. |

---

## 6. Device / parity matrix

Single backend surface (Postgres + one Deno edge fn). Consumer iOS/Android, Buyer Web, Business iOS/Android, Admin Web, Business Web preview — **N/A, no client/web file touched** (verified: diff = migration + edge fn + config.toml + tests only). Physical-iPhone HITL — **N/A** (no runtime UI surface). Edge-fn live-deploy — **not deployed** (orchestrator/operator owns deploy from merged main; `verify_jwt=false` must be preserved).

---

## 7. Findings

- **P3-1 (Discovery → WP-B/WP-C):** the conversion path is anon-reachable (`verify_jwt=false`) AND, unlike the touch path, is **NOT rate-limited**. An attacker can POST forged `ad_conversions` rows with random `event_id`s to pollute the admin-only attribution rollups. Blast radius is analytics-only (real revenue truth lives in `orders`/webhooks; UNIQUE(event_id) prevents double-counting a genuine conversion), and it matches the spec's browser-pixel+CAPI-dedup design — so NOT a WP-A blocker. Recommend WP-B/WP-C add a rate-limit and/or correlate `event_id` to a real `order_id`/`click_id` before trusting a row for spend attribution.
- **P3-2 (Discovery → WP-C):** `ad_attribution_touches.user_id → auth.users(id)` has **no ON DELETE clause (defaults to NO ACTION)**. Once WP-C writes touches with `user_id`, a user-deletion/GDPR flow that deletes an `auth.users` row will be **RESTRICTED** (23503) by a referencing touch. Consider `ON DELETE SET NULL` (touches are already PII-hashed) to keep user deletion unblocked.
- **P4-1:** implementor report §6 mis-attributes the SQL fails-on-revert to T-2's `42P10`; it actually trips at T-1's UNIQUE-existence check. Cosmetic.
- **P4-2 (observation, no action):** the base Supabase role model grants `anon`/`authenticated` broad table privileges via ALTER DEFAULT PRIVILEGES, so **RLS (not GRANT-absence) is the sole write-gate**. I proved the gate holds under this pessimistic case (INSERT by authenticated/anon → `new row violates row-level security policy`). Matches the shipped ad-engine idiom (`ad_connections`, `payment_webhook_events`).

---

## 8. Ledger

COMMS-0102 (raw-Docker + duplicate-prefix + crawler-host — OPEN WARN) FACTORED: used raw-Docker postgres; the target prefix reuses none of the 6 duplicates and no image host was touched. COMMS-0106 (OPEN WARN) FACTORED: tests are NEW files with zero deletions (no TEST-MOD token owed); no slice-and-execute test used; no expo export in this backend leg. COMMS-0110/0111/0108/0103 all RESOLVED. Acks noted here in lieu of an anchor-commit (leg hard-guards: no push, never edit the shared anchor).

---

## 9. Teardown

Docker container `mingla865qa` removed. `index.ts` restored byte-identical via `git checkout` after the revert probe (0-line diff confirmed). No migration file renamed (fixture fed to psql in explicit order, so the COMMS-0102 temp-rename recipe was unnecessary). Worktree product code untouched; only the 2 new test files + this report added.
