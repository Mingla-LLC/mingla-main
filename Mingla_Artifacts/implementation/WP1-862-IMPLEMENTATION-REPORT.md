# IMPLEMENTATION — ISSUE-862 WP1: Full Rooms Ad Engine foundation + Meta channel

**Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` body + A1–A4
(**A4 binding**, supersedes conflicting body text), grounded in
`Mingla_Artifacts/research/ad-pipeline-2026-07-15/PROOF_LOG.md` (proof-grade) and
`BATTLE_TESTED_BLUEPRINT.md` §4 WP1.
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`
(rebased onto `origin/main` at session start — clean, 0 conflicts).
**Status label:** implemented, partially verified — every locally-provable contract is
unit/DB-proven; live-fire against the real Meta account is deliberately NOT run
(dispatch hard guard: no live platform calls from this session) and is the tester's lane.

---

## 1. Summary

WP1 builds the engine's spine: one platform-agnostic, lane-aware schema (5 tables,
cents-at-rest `bigint`), the A4-widened `ChannelAdapter` interface + registry with the Meta
adapter fully implemented (Graph **v25.0**, M-13 `is_adset_budget_sharing_enabled`,
PAUSED-explicit-everywhere, creative link = canonical `dest_url` per destination policy v1),
five `admin-ad-*` edge functions (connect / preflight / create / action / sync — all
fail-close, admin-gated, service-role writes), a minimal functional admin surface at
`#/ad-engine`, 41 Deno unit tests, 2 self-testing strict-grep CI gates, and CI wiring in the
house paths-gated pattern. The four non-Meta adapters are fail-close stubs
(`424 <platform>_not_connected`) until WP2/5/6/7.

Nothing was deployed, no migration applied, nothing pushed. 5 local commits.

## 2. Commits (logical order)

| Commit | Content |
|---|---|
| `b7be4718e` | Migration (5 tables + RLS + indexes + triggers) + `_shared/adChannel.ts` + `_shared/meta.ts` |
| `2095f4678` | 5 edge fns `admin-ad-*` + `supabase/config.toml` verify_jwt blocks |
| `9923f83af` | Minimal admin surface (`#/ad-engine`) + nav/icon wiring |
| `cf76d0b92` | 41 Deno tests + 2 strict-grep gates + CI jobs |
| (this file) | Implementation report |

## 3. Files created / changed

**New (backend):**
- `supabase/migrations/20261230000000_issue_862_ad_engine_foundation.sql` (~250 lines)
- `supabase/functions/_shared/adChannel.ts` (~600 lines) — types, errors, money conversion,
  CTA maps, objective→goal matrix, floor-category map, registry + stubs, atomic-create engine
- `supabase/functions/_shared/meta.ts` (~640 lines) — Meta adapter + preflight probes +
  pure body builders + `buildMetaReviewDetail`
- `supabase/functions/admin-ad-connect/index.ts` (~300 lines)
- `supabase/functions/admin-ad-preflight/index.ts` (~330 lines)
- `supabase/functions/admin-ad-create-campaign/index.ts` (~560 lines)
- `supabase/functions/admin-ad-campaign-action/index.ts` (~230 lines)
- `supabase/functions/admin-ad-campaign-sync/index.ts` (~230 lines)

**New (admin):**
- `mingla-admin/src/services/adEngineService.js` (~95 lines)
- `mingla-admin/src/pages/AdEnginePage.jsx` (~470 lines)

**New (tests + gates):**
- `supabase/functions/_shared/__tests__/adChannel.test.ts` (20 tests)
- `supabase/functions/_shared/__tests__/meta.test.ts` (21 tests)
- `.github/scripts/strict-grep/issue-862-ad-token-env-server-only.mjs`
- `.github/scripts/strict-grep/issue-862-reddit-configured-status-explicit.mjs`

**Modified (append-only edits):**
- `supabase/config.toml` (+22 — five `[functions.admin-ad-*] verify_jwt = true`)
- `mingla-admin/src/App.jsx` (+5 — route `ad-engine`)
- `mingla-admin/src/lib/constants.js` (+9 — "Growth" nav group)
- `mingla-admin/src/components/layout/Sidebar.jsx` (+4 — `Megaphone` ICON_MAP)
- `.github/workflows/strict-grep-mingla-business.yml` (+28 — 2 gate jobs)
- `.github/workflows/supabase-migrations-and-stripe-deno.yml` (+44 — ad-engine deno job)

No existing test was modified or deleted (append-only gate safe). No DO-NOT-TOUCH file touched.

## 4. Data-model changes (written, NOT applied)

`20261230000000_issue_862_ad_engine_foundation.sql` — prefix strictly greater than local max,
sibling-worktree max, and the linked remote head (drift check run: **no remote-only versions**).

- `ad_connections` — one row per `(platform, lane)` UNIQUE; platform CHECK
  `('meta','tiktok','snapchat','google','reddit')`; lane CHECK `('consumer','business')`;
  `auth_kind` CHECK (3 values); `token_env_var` (env-var **NAME** only — table COMMENT
  encodes the secrets invariant); `extra` jsonb (page/dataset ids, capi_env_var,
  has_payment_method, **minimum_budgets** {imp, video_views, high_freq, low_freq} per A4.g,
  pixel signal, instagram_user_id); A2/§4.2 operational columns retained.
- `ad_campaigns` — `daily_budget_cents bigint` (A4.a widening), `dest_url` (ad-visible
  destination, A4.f) + `dest_smart_link` (A1, demoted — COMMENT documents D-P1),
  `dest_page_type/dest_brand_slug/dest_entity_slug/dest_event_id`, `delivery_status`,
  `targeting` jsonb, `request_id` idempotency `UNIQUE (connection_id, request_id)`,
  `UNIQUE (platform, external_campaign_id)`, status CHECK PAUSED-default.
- `ad_sets` — `budget_cents bigint NULL` (CBO ⇒ NULL), `optimization_goal`,
  `billing_event`/`bid_strategy`/`placement`/schedule/`external_status` retained,
  `UNIQUE (campaign_id, external_adset_id)`.
- `ads` — `creative_id uuid NULL` (**no FK yet** — `ad_creatives` is #866's table; migration
  comment carries the exact `ALTER TABLE` #866 must add), `external_creative_id text`
  (persists the 4th Meta ID — AC-2), `review_status`, `review_detail jsonb` (GR-18; COMMENT
  encodes the never-`recommendations` rule), `UNIQUE (ad_set_id, external_ad_id)`.
- `ad_status_events` — append-only audit, A3 §A verbatim
  (`create/launch/pause/sync/create_failed/rollback`, `external_ids`, `provider_response`).
- RLS all 5: `SELECT USING (public.is_admin_user())` for `authenticated`; **no write
  policies** (service-role-only, `payment_webhook_events` pattern); `GRANT SELECT` to
  authenticated, `GRANT ALL` to service_role. Indexes exactly per A3 §A. One shared
  `tg_ad_engine_set_updated_at()` trigger on the 4 updatable tables.
- **No seed rows** — deliberate (see Ambiguity F-1).

## 5. Edge functions (to deploy from MERGED main — orchestrator/operator-owned)

| Function | verify_jwt | Notes |
|---|---|---|
| `admin-ad-connect` | **true** | 424s: `meta_not_connected` / `meta_page_not_assigned` (A4.e.1 `/me/accounts`+ADVERTISE) / `meta_app_not_live` (A4.e.2 validate-only probe, error 1885183); fetches + stores `minimum_budgets` |
| `admin-ad-preflight` | **true** | P1–P6 Meta live; B6 app-live; P4 pixel WARN; non-Meta rows `not_connected`; single non-Meta platform → 424 |
| `admin-ad-create-campaign` | **true** | atomic create, everything PAUSED, no-orphan rollback, per-category floors, pixel gate 422, matrix 422, CREDIT 422, destination 422, `validate_only` passthrough, request_id idempotency |
| `admin-ad-campaign-action` | **true** | launch top-down / pause; 200+`warning` on PENDING_BILLING_INFO / DISAPPROVED / WITH_ISSUES |
| `admin-ad-campaign-sync` | **true** | status + effective_status + issues_info + ad_review_feedback → `review_detail`; `recommendations` never requested/stored |

Secrets required before first connect (NAMES only — values in Supabase Edge Function
Secrets): `META_SYSTEM_USER_TOKEN`, `META_API_VERSION=v25.0`, `META_AD_ACCOUNT_ID`,
`META_BUSINESS_ID`, `META_PAGE_ID`, `META_DATASET_ID` (optional: `META_GRAPH_BASE`,
`META_CAPI_ACCESS_TOKEN` for #865). Business lane later: `META_MINGLABIZ_*`.

## 6. Regression tests + fails-on-revert

- 41 Deno tests, all green:
  `deno test --allow-env supabase/functions/_shared/__tests__/{adChannel,meta}.test.ts`
  → `ok | 41 passed | 0 failed`.
- **fails-on-revert verified at `9923f83af`** (money conversion): deleted the
  `cents * 10_000` micro conversion in `centsToPlatformBudget` (the exact GR-01 10,000×
  bug) → `money: $5.00 (500¢) → 5,000,000 micro` and `$20.00 → 20,000,000 micro` **FAILED**;
  restored → 41/41 pass again.
- RT-1 (fail-close) enforced by tests that stub `globalThis.fetch` with a counter and assert
  **zero** network calls when the token is unset; RT-2 (no-orphan) enforced via mock-adapter
  atomic tests (step-2 failure → rollback called, later steps never run, partial IDs carried).
- Strict-grep gates: both `--self-test` PASS + live run PASS
  (`ad-token-env-server-only`: 16 token names × 7 client trees clean;
  `reddit-configured-status`: armed-pass while `_shared/reddit.ts` absent; self-test proves
  it bites on a missing `configured_status`, a never-PAUSED body, and a DELETE-verb rollback).

## 7. Gates run (real output, this session)

| Gate | Result |
|---|---|
| `deno check` — `_shared/adChannel.ts`, `_shared/meta.ts`, 5 edge fns | **GREEN** (0 errors) |
| `deno test` — 41 tests (2 suites) | **GREEN** `41 passed | 0 failed` |
| Migration apply, full chain from baseline (CI-equivalent: Docker `supabase/postgres:17.4.1.075`, every migration in timestamp order, `ON_ERROR_STOP=1`) | **GREEN** — `ALL MIGRATIONS APPLIED CLEANLY` incl. the new one |
| RLS negative probe (local DB): authenticated non-admin `SELECT` on `ad_connections`/`ad_campaigns` | **0 rows** (policy holds) |
| RLS negative probe: authenticated `INSERT` into `ad_status_events` | **DENIED** (`new row violates row-level security policy`) |
| `vite build` — mingla-admin with the new page | **GREEN** (3.3s; pre-existing chunk-size warning only) |
| `issue-862-ad-token-env-server-only.mjs` (self-test + live) | **GREEN** |
| `issue-862-reddit-configured-status-explicit.mjs` (self-test + live) | **GREEN** (armed) |
| YAML lint on both modified workflows | **GREEN** |
| tests-append-only | safe by construction (new files only) |

## 8. Spec-AC coverage map

| AC | Status | Evidence |
|---|---|---|
| AC-1 connect persists connection; invalid token → 424 + `status='invalid'` | ✓ implemented `2095f4678` — **live-fire deferred to tester** (no live calls allowed here) |
| AC-2 atomic create: 4 external IDs, one row set, all PAUSED, effective_status read-back | ✓ implemented `2095f4678`; PAUSED + create-order + ID plumbing unit-proven `cf76d0b92`; live-fire deferred |
| AC-3 cents + floor rejection 422 BEFORE any Meta write | ✓ — per-category floors from `extra.minimum_budgets` (A4.g supersedes flat 100¢); floor check precedes any adapter call; conversion unit-proven |
| AC-4 destination_not_public 422 before Meta write; `/e/{brand}/{event}` shape | ✓ event + brand paths; trip/venue fail-close (Ambiguity F-7) |
| AC-5 launch top-down / pause + audit rows | ✓ implemented; live-fire deferred |
| AC-6 no orphans (step-N failure ⇒ no DB row + compensating delete / create_failed audit) | ✓ implemented + **unit-proven** (RT-2 mock-adapter suite) |
| AC-7 fail-close with token unset: 424, never a Meta call | ✓ **unit-proven** (RT-1 zero-fetch tests) |
| AC-8 authz: non-admin 403 every fn; non-admin cannot SELECT ad_* | ✓ in-code gate every fn; RLS **proven** in local DB (0 rows + write denied) |
| AC-9 token never in response/row/log/bundle | ✓ Bearer-header only, normalized errors, table stores env NAMES, RT-3 gate green |
| A4 M-13 `is_adset_budget_sharing_enabled` | ✓ unit-proven (both CBO / non-CBO branches) |
| A4.f creative link = dest_url, never the OneLink | ✓ unit-proven; `dest_smart_link` stored, never sent |
| A4.e preflight contract (P1–P6, `/me/accounts`+ADVERTISE, `meta_app_not_live`) | ✓ implemented; live-fire deferred |
| A4.e.5 `422 pixel_no_signal` gate | ✓ implemented; `metaPixelHasSignal` epoch-0 unit-proven |
| A4.g floors stored in `extra`, never hardcoded / video_data branch / url_tags / conversion_domain / self_ai_disclosure | ✓ all unit-proven at the body-builder level |
| M-4 CREDIT rejected + restriction cascade | ✓ unit-proven |
| GR-18 `review_detail`, never `recommendations` | ✓ unit-proven + sync fn never requests the field |
| A4.a interface (createCreative? + setBudget, Google REMOVED-never at type level) | ✓ `adChannel.ts`; `AdvertiserStatus = 'PAUSED'|'ACTIVE'` makes delete inexpressible |
| SC-1…SC-7 admin states | ✓ functional minimal (`9923f83af`); polished builder = **#864** |

**Deferred to later WPs:** Google adapter (WP2/#867) · creative library + uploads (WP3/#866)
· builder UI (WP4/#864) · Snapchat (WP5) · Reddit adapter (WP6 — its `configured_status`
gate is already armed) · TikTok (WP7) · attribution/insights (#865) · business lane
connections (per-platform, as provisioned).

## 9. Old → New receipts

### supabase/migrations/20261230000000_issue_862_ad_engine_foundation.sql
**Before:** no ad-engine tables existed. **Now:** the A3/A4 unified 5-table schema with
admin-read RLS, service-role-only writes, cents-bigint budgets, audit trail. **Why:** SPEC
A3 §A/§F + A4.a. ~250 lines.

### supabase/functions/_shared/adChannel.ts
**Before:** did not exist. **Now:** THE channel layer — Platform/Lane types, AdNotConnected/
AdApi errors, the single cents→platform conversion, per-platform CTA maps (Reddit
Title-Case), Meta objective→goal matrix + floor categories, A4.a ChannelAdapter + registry
(meta real, 4 fail-close stubs), `createFullCampaignAtomic` (§4.4b no-orphan). **Why:** A3
§B / A4.a. ~600 lines.

### supabase/functions/_shared/meta.ts
**Before:** did not exist. **Now:** the Meta adapter — env-name-only config, fail-close
token resolve, Bearer-header Graph wrapper + error normalizer, pure body builders (M-13,
PAUSED, A4.f link, video_data, url_tags, self_ai_disclosure), special-ad-category
validation/cascade, preflight probes (account, `/me/accounts` ADVERTISE, validate-only
app-live, minimum_budgets, pixel, IG), review-detail builder, rollback. **Why:** §4.3 + A4.
~640 lines.

### The five admin-ad-* edge functions
**Before:** did not exist. **Now:** the §4.4/A3 §C surface with the A4.e corrections; every
write path admin-gated + fail-close; audit rows on every state change. **Why:** §4.4 a–d +
blueprint §4.1 preflight. ~1,650 lines total.

### mingla-admin (5 files)
**Before:** no ad-engine UI. **Now:** `#/ad-engine` page (connection card SC-1..4, preflight
panel, create-paused form with validate-only, campaign list with advertiser+delivery badges,
launch/pause/sync, inline normalized errors SC-7) + service seam + nav registration.
**Why:** §5 minimal admin surface (deliberately minimal — #864 owns the builder). ~580 lines.

### CI (2 workflows + 2 gate scripts + 2 test suites)
**Before:** no ad-engine coverage. **Now:** paths-gated deno job + 2 registry-pattern
strict-grep jobs, all self-testing. **Why:** §9 RT-1..RT-3 + A4.a mandatory tests. ~700 lines.

## 10. Cross-surface impact

| Surface | Affected | Detail |
|---|---|---|
| Consumer iOS / Android | No | engine is back-office; zero app-mobile changes |
| Buyer/anonymous Web | Reference-only | `business_public_events_view` READ to resolve `dest_url`; zero code changes |
| Business iOS / Android / Web preview | No | zero mingla-business changes |
| Admin Web | **YES** | new `#/ad-engine` route (single surface — no parity concern) |
| Backend | **YES** | 1 migration + 2 shared modules + 5 edge fns + config.toml |

No manual parity obligations. No `app.json`/store-submit config touched
(I-RELEASE-VERSION-PARITY / I-RELEASE-SUBMIT-CONFIG untouched).

## 11. Known issues / deferred

- Live-fire verification (connect → $5/day LINK_CLICKS plumbing test → launch → pause) is
  the tester's lane, only after Seth's explicit go (blueprint: "first live-fire = one $5/day
  Meta LINK_CLICKS plumbing test, launched only by Seth").
- `ads.creative_id` has no FK until #866 creates `ad_creatives` (migration comment carries
  the exact ALTER for #866).
- Lifetime budgets 422 in WP1 (A3 §A schema has `daily_budget_cents` only).
- IG placement is Facebook-only until a human links IG to the Page (A4.e.7 — connect stores
  `instagram_user_id` in `extra` the moment it appears).
- No `[TRANSITIONAL]` markers were needed.

## 12. Operator action required (post-REVIEW, post-merge — do NOT run from this worktree state)

1. Migration (after PR merge, from the merged checkout):
   `cd "/Users/sethogieva/Desktop/mingla-main" && /Users/sethogieva/bin/supabase db push --linked`
   (monotonicity + drift re-checked this session: local/sibling max `20261229000000`, remote
   head matches, no remote-only versions).
2. Deploy the five edge fns from MERGED main (orchestrator-owned), preserving
   `verify_jwt = true` for all five.
3. Set the Meta Function Secrets (§5 names) if any are missing; then in Admin →
   Growth → Ad Engine, hit **Connect Meta** and then **Run preflight** — expected: connect
   200 with floors `{100, 100, 500, 4000}` (PROOF M-P8) and preflight `amber` (P4 pixel warn).

## 13. Flagged ambiguities (spec-vs-dispatch / spec gaps — resolved conservatively, NOT improvised silently)

- **F-1 — A3 §D "seed all five connections" vs dispatch hygiene guard ("IDs live in
  env/config, not literals").** The dispatch hard guard wins: the migration seeds NOTHING;
  `admin-ad-connect` materializes each `(platform, lane)` row from env at connect time.
  The §D/A4.c registry values stay in the spec + master keys, not in the public repo.
- **F-2 — `ads.creative_id REFERENCES ad_creatives`** (A3 §A) cannot be created in WP1:
  `ad_creatives` is #866's table. Column shipped without the FK; #866 adds the constraint.
- **F-3 — `ads.external_creative_id` added** (not in A3 §A): the generalized schema had
  nowhere to persist the platform's AdCreative id, but AC-2 requires all four Meta IDs.
- **F-4 — `rollbackCampaign?` added to ChannelAdapter** (optional): A4.a's shape has no slot
  for the §4.4b compensating cleanup; the optional hook expresses it per-platform
  (meta DELETE /{id}; reddit PATCH configured_status DELETED; google atomic — none needed).
- **F-5 — goal→floor-category mapping** (`metaBudgetCategoryForGoal`) is an interpretation:
  A4.g pins the four categories and that LINK_CLICKS is high_freq; the full goal→category
  table is not in the spec. Conversion-class goals default to `low_freq` (the most
  conservative, $40 floor). Encoded in one function + unit tests so the tester/forensics can
  correct it in one place.
- **F-6 — dest_url origin**: §4.4b's `${BUSINESS_WEB_ORIGIN}/e/…` formula used (default
  `https://business.usemingla.com`); A4.f's "canonical `usemingla.com/e/…`" reads as the
  domain-policy statement (conversion_domain = `usemingla.com`, derived). If A4.f meant the
  apex host literally, it is a one-line env change (`BUSINESS_WEB_ORIGIN`).
- **F-7 — trip/venue destinations** have no public read model in the repo (events + brands
  views exist); WP1 fail-closes them with `422 destination_not_public`
  (`dest_page_type_not_supported_wp1`).
- **F-8 — `has_payment_method`** is not a plain field on the account read; derived from
  `funding_source` presence (matches the §4.0 probe semantics).
- **F-9 — COMMS ledger acks not committed**: the ledger discipline says acks push to main
  now; the dispatch hard guard says NEVER push. No OPEN entry targets this ORCH/skill or the
  ad-engine lane (scanned 2026-07-15), so nothing material was skipped — the orchestrator
  should ack on CLOSE.

## 14. Discoveries for Orchestrator

- `mingla-admin` has **no CI build check** (only mingla-business web is built by
  `web-build-check.yml`) — a syntax break in the admin app merges green today. WP1
  self-verified with a local `vite build`, but a `mingla-admin` build job is a cheap gate.
- The admin `node --test` suite has 19 pre-existing failures (already documented in the
  strict-grep workflow comments) — untouched, unrelated.
- Sibling specs (#863/#866/#867) still carry pre-A4 shapes in places (e.g. #866 `'snap'`
  enum, #867 `provider_*`/`budget_micro`) — A3 §F reconciliations hold; their WPs must build
  against THIS schema, not their local text.

## 15. Test-first priorities for the tester

1. Live connect against the real account (expect floors 100/100/500/4000 + amber preflight).
2. Validate-only create passthrough (M-P5/M-P6 replay with the engine's own token).
3. Adversarial no-orphan: force a step-3 creative failure (bad image URL) → assert Meta has
   zero residual campaigns + one `create_failed`/`rollback` audit row + no DB rows.
4. RLS via a real non-admin JWT against prod-shaped DB (browser anon key path).
5. The $5/day PAUSED plumbing campaign — only with Seth's explicit go.
