# QA — ISSUE-862 WP1: Full Rooms Ad Engine foundation + Meta channel

**Tester:** mingla-tester+claude · **Date:** 2026-07-15
**Worktree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`
**Under test:** commits `b7be4718e..069422d8d` (schema+adapter / edge fns / admin surface / tests+gates / report)
**Contract:** `SPEC_ISSUE-862_META_ADS_CAMPAIGN_ENGINE.md` body + A1–A4 (**A4 binding**) · `PROOF_LOG.md` (live ground truth) · implementor claims in `WP1-862-IMPLEMENTATION-REPORT.md` (all independently re-derived)
**Environment:** LOCAL Supabase stack (`supabase start`, Docker, full 335-migration chain applied — **never the linked prod project**), `supabase functions serve` with the engine's real Meta credentials from master keys (values never echoed, never committed), plus direct read-only/validate-only Graph v25.0 calls for baseline/residual verification.

---

## 1. Verdict

## **FAIL — 0 × P0 · 1 × P1 · 4 × P2 · 6 × P3 · 3 × P4**

One P1 blocks the feature's core promise: **the atomic create cannot complete against the real Meta API** — every real (non-validate-only) create fails at step 2 (ad set) with Meta code 100 / subcode 1815857 *"Bid amount required"*, because the campaign builder never sends `bid_strategy`. Root cause proven live in both directions (§5 P1-1). Everything else in the foundation held up under live fire: connect, floors, all fail-close gates, RLS, authz, the no-orphan rollback (which this very failure exercised, flawlessly, on the real account), and token hygiene are all runtime-proven.

Routing: **REWORK → mingla-implementor** (findings cited by SC/AC-ID + file:line). The fix is small (one field in one builder + regression test); a focused RETEST can follow quickly.

---

## 2. SC/AC-by-AC matrix (every row independently runtime/live-verified)

| AC | Verdict | Runtime evidence (this session) |
|---|---|---|
| **AC-1** connect persists connection; invalid → 424 + `status='invalid'`, `connected=false` | **PASS** (with P2-4 caveat on the *no-existing-row* failure path) | Live `admin-ad-connect` (local edge runtime → real Graph): HTTP 200; row persisted `platform=meta, lane=consumer, external_account_id=2393570861066813, token_env_var=META_SYSTEM_USER_TOKEN, status=connected, connected=t, currency=USD, account_status=ACTIVE, timezone=America/Los_Angeles`. Re-serve WITHOUT the token secret → connect **424** `meta_not_connected` AND the existing row flipped to `invalid|f` (verified in DB). Reconnect with the token → `connected|t`, still exactly 1 row (upsert on `(platform,lane)` proven idempotent). |
| **AC-1 / A4.g floors** | **PASS** | `extra.minimum_budgets` persisted `{imp:100, video_views:100, high_freq:500, low_freq:4000}` — **exactly the PROOF M-P8 USD values, fetched live**, not hardcoded. |
| **A4.e.1 Page check** | **PASS** | `graph.page.tasks = [ADVERTISE, ANALYZE, CREATE_CONTENT, MESSAGING, MODERATE, MANAGE, VIEW_MONETIZATION_INSIGHTS]` from live `/me/accounts`; Page `797406353459597` "Mingla". |
| **A4.e.2 app-Live probe** | **PASS** | Connect completed past the validate-only `adcreatives` probe (no 424 `meta_app_not_live`); the probe demonstrably runs — its wire shape is the same builder the clean validate-only round-trip used. Zero creatives on the account after (`GET /adcreatives → {"data":[]}`). |
| **A4.e.5 pixel gate (`422 pixel_no_signal`)** | **PASS** | Live: pixel `last_fired_time = null` → `pixel_has_signal=false` persisted; create with `LANDING_PAGE_VIEWS` → **HTTP 422 `pixel_no_signal`**. (`OFFSITE_CONVERSIONS`/`VALUE` share the same `META_PIXEL_GATED_GOALS` path; floor check fires first at low budgets — order documented, benign.) |
| **AC-2** atomic create: 4 external IDs, one row set, all PAUSED, effective_status read-back | **FAIL — P1-1** | Real create through `admin-ad-create-campaign` **cannot get past step 2**: Meta rejects the ad set (`code 100, subcode 1815857 — "Bid amount required… For LOWEST_COST_WITH_BID_CAP…"`, fbtrace `AdfiDqAG99BJ_SVmQzabxcI`). The campaign body omits `bid_strategy` entirely (§5 P1-1). |
| **AC-3** cents + per-category floor 422 BEFORE any Meta write | **PASS** | 499¢/`LINK_CLICKS` → **422 `budget_below_minimum`, floor_cents 500, category high_freq**; 3,999¢/`OFFSITE_CONVERSIONS` → **422, floor 4000, low_freq**. Floors read from the stored connect-time values, not literals. |
| **AC-4** `destination_not_public` 422 before Meta write; URL shape | **PASS** (with P3-6 caveat) | Bogus slug → **422 `destination_not_public`** (no Graph call — Meta campaign list unchanged). Valid event resolved via `business_public_events_view` → `dest_url = https://business.usemingla.com/e/qa-brand-862/qa-event-862`, `dest_event_id` captured. |
| **AC-5** launch top-down / pause + audit | **BLOCKED by P1-1** (no persisted campaign can exist to launch) | Code path read; adapter `setStatus` fail-close proven (RT-1 tests); **must be retested live after the P1 fix** — do NOT close AC-5 on source reasoning. Hard guard honored: nothing was ever set ACTIVE this session. |
| **AC-6** no orphans: failed step ⇒ no DB row + compensating delete + audit | **PASS — live-fire, real account** | The P1 failure itself exercised it: real PAUSED campaign `52584720839827` created → step-2 failure → edge fn returned **502 `meta_create_failed`, step=ad_set, rolled_back=true** → Meta-side `DELETE` confirmed (`GET /52584720839827 → status=DELETED, effective_status=DELETED`), campaigns list **`{"data":[]}`**, **0 rows** in `ad_campaigns`/`ad_sets`/`ads`, **exactly one** `ad_status_events` row `action='rollback', external_ids={external_campaign_id: 52584720839827}, provider_response.step=ad_set, subcode=1815857`. Additionally the **step-3 mechanics** were proven on one diagnostic chain (§4 leg 3b): real PAUSED campaign+adset → forced creative failure (undownloadable image, subcode 3858258, no creative object) → campaign DELETE **cascades the ad set** (both read back DELETED) → final lists campaigns/adsets/ads/adcreatives all `{"data":[]}`. **Residual-zero confirmed. No orphan IDs outstanding.** |
| **AC-7** fail-close with token unset: 424, never a Meta call | **PASS — runtime** | Functions re-served without `META_SYSTEM_USER_TOKEN`: connect → **424**, create → **424**. RT-1 zero-fetch unit proof independently re-run (41/41 → fails on revert §6). |
| **AC-8** authz: non-admin 403 every fn; RLS 0 rows | **PASS** (with P3-5 caveat) | All five fns: no JWT → **401**. Non-admin JWT with well-formed bodies → **403 forbidden** (connect, preflight, create, action, sync). Real non-admin JWT via PostgREST: `ad_connections`/`ad_campaigns`/`ad_status_events` → **`[]`**; INSERT `ad_status_events` → **42501 RLS violation (403)**; UPDATE `ad_connections` → 204 **zero-row no-op** (row verified unchanged). Admin JWT → 1 row (is_admin_user path). Service role → 1 row. Anon → `[]`. |
| **AC-9** token never in response/row/log/bundle | **PASS** | Token value (24-char prefix) grepped: **0 hits** in any `ad_connections` row; **0 hits** in every edge response captured this session; `mingla-admin` **built** and dist grepped — 0 hits for the env NAME, the value prefix, and the generic `EAA[A-Za-z0-9]{40,}` pattern. Token travels only as an `Authorization: Bearer` header (never a URL param). Strict-grep gate live-verified + bite-proven (§7). |
| **A4 M-13** `is_adset_budget_sharing_enabled` | **PASS — proven live both directions** | Validate-only replay of PROOF M-P5 with the builder's exact non-CBO body: without the field → **subcode 4834011** ("You must specify True or False…"); with `false` → **`{"success":true}`**; campaigns list `[]` after. CBO branch (field omitted, `daily_budget` present) validated clean through the edge fn's validate-only leg. |
| **A4.f** creative link = `dest_url`, never the OneLink | **PASS** | Unit + **source-trap test committed** (T-7: `destSmartLink` flows ONLY declaration → `dest_smart_link` DB column; `_shared/meta.ts` contains no `go.usemingla.com`/`onelink`/`minglabiz`). COMMS-0100/0101 factored. |
| **Validate-only passthrough** (dispatch leg 2) | **PASS** (with P2-2 caveat) | Clean round-trip: **200 `{validated:true}`**, 0 DB rows in all four tables, Meta campaigns `[]` AND adcreatives `[]` after. A Meta-side validation failure surfaces normalized (**422 `validation_failed`** with code/subcode/fbtrace, no token) and writes nothing. **Caveat: only campaign + creative shapes are validated — the ad set is NOT** (that is exactly how P1-1 escaped the implementor's validate-only confidence — §5 P2-2). |
| **M-4** CREDIT rejected | **PASS — runtime** | Create with `["CREDIT"]` → **422 `special_ad_category_credit_retired`** with the FINANCIAL_PRODUCTS_SERVICES migration message. Cascade unit-proven + adversarial shapes (T-6). |
| **M-2/M-3 matrix** | **PASS — runtime** | `APP_INSTALLS` under `OUTCOME_TRAFFIC` → **422 `invalid_optimization_goal`** listing the 12 valid goals. |
| **Non-Meta stubs** | **PASS — runtime** | `platform=tiktok` create → **424 `tiktok_not_connected`**; connect same. Registry stubs unit-proven for all four. |
| **Lifetime budget** | **PASS (fail-close as documented)** | → **422 `budget_type_unsupported_wp1`** (flagged WP1 deferral, honest error). |
| **SC-1…SC-7 admin states** | **BUILD-VERIFIED ONLY** | `vite build` green; page/service/nav wiring read. Live driving of `#/ad-engine` was NOT performed (backend-first dispatch; single-surface admin web; and the create flow is P1-blocked anyway). Must be smoke-driven at RETEST after the fix. |
| **Migration** | **PASS** | Applied cleanly inside the full 335-file chain on a fresh local stack; all 5 tables + RLS enabled + 5 SELECT-only policies verified in `pg_tables`/`pg_policies`; version `20261230000000` is the global max. |

---

## 3. Findings

### P1-1 — Real campaign create ALWAYS fails at step 2: campaign builder omits `bid_strategy` (AC-2)
- **Evidence:** `supabase/functions/_shared/meta.ts:278-301` (`buildMetaCampaignBody`) never sets `bid_strategy`/`campaign_bid_strategy`, and `admin-ad-create-campaign/index.ts` neither reads a `bid_strategy` input nor supplies a default. Live create (real account, CBO 500¢, `LINK_CLICKS`/`IMPRESSIONS`): campaign created PAUSED, then ad-set create → `code 100, subcode 1815857: "Bid amount required: you must provide a bid cap or target cost in bid_amount field. For LOWEST_COST_WITH_BID_CAP…"` → 502. **Both directions proven live:** an otherwise-identical diagnostic campaign created WITH `bid_strategy: "LOWEST_COST_WITHOUT_CAP"` → the exact builder-shape ad set **validates `{"success":true}`** and creates cleanly (then deleted; residual zero).
- **Impact:** the engine's core promise (create a PAUSED campaign chain) is 100% broken against real Meta. No campaign can ever be persisted; launch/pause/sync are unreachable.
- **Required fix:** send `bid_strategy: "LOWEST_COST_WITHOUT_CAP"` explicitly on the campaign body (spec §4.0 campaign contract + §4.4b step 1 + OD-3 CBO already name it as the default; A4 does not supersede it). Optionally accept a `bid_strategy` input per §4.4b. Add a regression unit test asserting the campaign body carries `bid_strategy` (both CBO and non-CBO branches).
- **Retest:** live create through the edge fn must persist one `ad_campaigns`+`ad_sets`+`ads` set, all PAUSED, 4 external IDs; then the dispatch's original step-3 leg (forced creative failure AFTER a real campaign+adset) through the edge fn; then AC-5 launch/pause.

### P2-2 — Validate-only passthrough skips the ad-set shape (false confidence — the exact hole P1-1 hid in)
- **Evidence:** `admin-ad-create-campaign/index.ts:386-399` — validate-only calls `adapter.createCampaign` + `adapter.createCreative` only; `buildMetaAdSetBody` supports `validateOnly` (`meta.ts:325`) but is never invoked in this leg.
- **Impact:** an admin's "validation passed" can precede a guaranteed real-create failure (proven this session). The preflight's value is materially overstated.
- **Required fix:** validate the ad-set shape too. Meta's ad-set validate-only requires a `campaign_id`; options: (a) validate campaign non-CBO + adset against a known-paused sentinel, or simpler (b) document the gap in the response (`validated_layers: ["campaign","creative"]`) and add the ad-set input to Meta's validation at create time. At minimum the response must state which layers were validated.
- **Retest:** validate-only response names its layers, or an ad-set-shape error is caught at validate time.

### P2-3 — Business-lane FIRST connect verifies the CONSUMER credential, then persists a business row as `connected`
- **Evidence:** `admin-ad-connect/index.ts:148` — `resolveMetaClient(existing ?? null)`; with no existing business row, `resolveMetaToken(null)` falls back to `META_SYSTEM_USER_TOKEN` (`meta.ts:85-93`) and `resolveMetaEnvConfig()` reads the consumer `META_AD_ACCOUNT_ID`. The upsert then writes `token_env_var: defaultTokenEnvVar("meta","business") = META_MINGLABIZ_SYSTEM_USER_TOKEN` (`index.ts:226`) — a row claiming a credential that was never checked, `status='connected'`.
- **Impact:** a false-positive "connected" business lane. Downstream create fail-closes (the business token secret is unset → 424), so no spend risk — but SC-4's "Connected" UI state lies.
- **Required fix:** resolve the token env var from `defaultTokenEnvVar(platform, lane)` when no row exists (verify the credential the row will claim), and per-lane env config (business ad-account/page IDs) before any business-lane connect ships.
- **Retest:** business-lane connect with only consumer secrets set → 424, no `connected` row.

### P2-4 — First-connect failure persists nothing (AC-1 says upsert `token_status='invalid'`)
- **Evidence:** `admin-ad-connect/index.ts:137-144` — `markInvalid()` only UPDATEs an `existing` row; on a first connect with a bad/missing token, no row is created (spec §4.4a says "upsert `token_status='invalid'`, `connected=false`"). Runtime confirmed the update path works on an existing row (invalid|f observed); the create path was code-verified.
- **Impact:** SC-2 ("Disconnected/Invalid" red banner) can never render before the first successful connect — the UI falls back to SC-1 "Not configured", which conflates "no secret set" with "secret set but rejected".
- **Required fix:** upsert an `invalid` row (platform, lane, default display_name/env-var name) on connect failure.
- **Retest:** fresh DB + bad token → connect 424 AND a persisted `status='invalid'` row.

### P2-5 — Rollback leaves an account-level AdCreative orphan on step-4 (ad) failure; spec's cascade claim is wrong for creatives
- **Evidence:** §4.4b claims "DELETE /{campaign_id} (Meta cascades child adset/creative/ad)". Live-proven: campaign DELETE cascades the **ad set** (both DELETED, verified by direct read). But an AdCreative is an **account-level** object, not a campaign child — a step-4 failure (creative created, ad failed) leaves the creative on the account after campaign delete. Partial IDs (incl. `external_creative_id`) ARE captured in the audit row (T-8 proves plumbing).
- **Impact:** non-spending, non-delivering residue accumulates in the account's creative library on repeated step-4 failures. No financial risk.
- **Required fix (WP-scoped):** rollback should also `DELETE /{creative_id}` when `partialExternalIds.external_creative_id` exists; or explicitly document creative residue as accepted + reconciled from the audit row.
- **Retest:** forced step-4 failure → adcreatives list returns to baseline.

### P3-6 — Destination gate accepts `ended` and `cancelled` events as valid ad destinations
- **Evidence:** `business_public_events_view` includes `status IN ('scheduled','live','ended','cancelled')`; `admin-ad-create-campaign/index.ts:316-324` accepts any view row. Spec AC-4 says "public + **live**".
- **Impact:** an admin can point paid traffic at a cancelled event page.
- **Required fix:** filter `status IN ('scheduled','live')` (or warn) at destination resolve.

### P3-7 — Two fns validate input BEFORE the admin gate (pattern inconsistency + pre-auth probe surface)
- **Evidence:** `admin-ad-connect/index.ts:96-103` and `admin-ad-campaign-action/index.ts:63-70` return 400 validation errors before any auth check (observed: anon-key-only requests → 400, where preflight/create/sync → 401). No data or writes are reachable pre-auth.
- **Required fix:** hoist the admin gate above input validation in both fns (match the other three).

### P3-8 — `normalizeMetaError` passes provider messages through unscrubbed
- **Evidence:** `meta.ts:117-130` — no `EAA…`-pattern scrub on `message` before it reaches the admin client. Meta does not normally echo tokens, but there is no defense-in-depth.
- **Required fix:** cheap regex scrub (`EAA[A-Za-z0-9]+` → `[redacted]`) inside `normalizeMetaError`.

### P3-9 — `centsToPlatformBudget` has no upper bound; micro conversion loses integer precision past ~$9×10¹² 
- **Evidence:** `adChannel.ts:129-147`; `admin-ad-create-campaign` has no budget ceiling. Exactness proven safe to 9,007,199,254,740,000 micro (T-1). Unreachable for Meta (identity) in WP1; matters for WP2+ micro platforms.
- **Required fix (WP2 gate):** reject `cents > Number.MAX_SAFE_INTEGER / 10_000` (or a sane business ceiling) at the edge.

### P3-10 — `admin-ad-campaign-sync` all-campaign sweep is unbounded
- **Evidence:** `admin-ad-campaign-sync/index.ts:84-96` — no `campaign_id` → selects ALL `ad_campaigns` with no limit/pagination and serial per-entity Graph reads.
- **Impact:** future timeout at scale; fine at WP1 volume.

### P3-11 — Local dev bootstrap of the migration chain is broken by 6 duplicate version prefixes (pre-existing, NOT WP1)
- **Evidence:** `supabase start` aborts with `duplicate key … schema_migrations_pkey` — duplicate versions `20260612000000, 20260615000000, 20261012000000, 20261113000000, 20261116000000, 20261117000000` (each 2 files). This QA session required temporary local-only renames (restored byte-identical, verified `git status` clean) to boot the stack. The implementor's raw-Docker/psql pattern silently bypasses the collision.
- **Routing:** Discovery for orchestrator (§8) — not a WP1 defect, but it will bite every future local-stack QA and any `supabase db reset`.

### P4 (praise)
- **P4-a:** The no-orphan engine is genuinely excellent — it survived a REAL unplanned failure mode (P1-1) on the first live shot: correct 502, correct audit row with partial IDs + step + subcode, Meta-side delete verified, zero DB rows. This is exactly what §4.4b promised.
- **P4-b:** Token hygiene is airtight end-to-end (Bearer-only, env-name-only rows, clean bundle, biting CI gate).
- **P4-c:** The 422 error bodies are self-documenting (floor category + cents + PROOF references in the message) — best-in-repo error ergonomics.

---

## 4. Live-fire evidence log (commands + responses, secrets redacted)

**Leg 1 — connect (real account, read-only + validate-only probe):** `POST /functions/v1/admin-ad-connect {platform:meta, lane:consumer, action:connect}` → HTTP 200; graph echo `account={act_2393570861066813, "Use Mingla", USD, ACTIVE, has_payment_method:true}`, `page={797406353459597, "Mingla", tasks:[ADVERTISE,…]}`, `minimum_budgets={100,100,500,4000}`, `pixel={lastFiredTime:null, hasSignal:false}`, `instagram_user_id:null`. DB row verified; token-prefix grep over the row: 0 hits.

**Leg 2 — validate-only create:** first with robots-blocked images → 422 `validation_failed` (subcode 3858258, normalized, no writes — twice, incl. Wikimedia); with a downloadable image → **200 `{validated:true}`**; after: `ad_campaigns=0, ad_status_events=0`, Meta campaigns `[]`, adcreatives `[]`. **M-13 wire replay:** non-CBO body without flag → subcode **4834011**; with `is_adset_budget_sharing_enabled:false` → `{"success":true}`; campaigns `[]` after.

**Leg 3 — no-orphan rollback (real objects, PAUSED-only, one edge-fn chain + one diagnostic chain, all deleted same run):**
- Baseline `GET /act_…/campaigns` → `{"data":[]}` (empty account).
- Edge-fn create (forced step-3 image trigger) → failed earlier at step-2 (P1-1) → **502 rolled_back:true**; campaign `52584720839827` → `status=DELETED`; lists `[]`; DB 0/0/0; audit `rollback` row with partial IDs.
- Diagnostic chain: campaign `52584721074827` (PAUSED, explicit bid_strategy) → validate-only adset `{"success":true}` (root-cause proof) → REAL PAUSED adset `52584721109227` → forced creative failure (3858258, no object) → `DELETE` campaign → campaign AND adset read back `DELETED` (cascade proof) → **final lists: campaigns `[]`, adsets `[]`, ads `[]`, adcreatives `[]`**.
- **Residual-zero: CONFIRMED. Orphans: NONE. Nothing was ever ACTIVE.**

**Leg 4 — RLS + authz:** §2 AC-8 row. Non-admin JWT: 3 tables `[]`; insert 42501; update zero-row no-op (verified unchanged); admin 1 row; service-role 1 row; five fns 401 (no JWT) / 403 (non-admin, well-formed bodies).

**Fail-close runtime:** token-less serve → connect 424 + row `invalid|f`; create 424; reconnect restores `connected|t`, 1 row.

**Gate matrix:** pixel 422 · floors 422×2 (high_freq 500 / low_freq 4000) · matrix 422 · CREDIT 422 · destination 422 · lifetime 422 · tiktok 424.

---

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Implementor claimed: fails-on-revert verified at `9923f83af` (deleting `cents * 10_000`). **Re-derived independently on this checkout (`069422d8d` + working tree):** true line-mutation `return cents * 10_000; → return cents;` in `adChannel.ts` → `money: $5.00 (500¢) → 5,000,000 micro` **FAILED** and `money: $20.00 → 20,000,000 micro` **FAILED** (exact assertions at `adChannel.test.ts:45` and `:51`); `git checkout --` restore → **41/41 pass**. Claim confirmed.

## 6. Tester adversarial test (added, on-branch, in-diff)

- **Path:** `supabase/functions/_shared/__tests__/issue862_wp1_tester_adversarial.test.ts` — 20 tests (T-1…T-9), all green (`61 passed | 0 failed` across the 3 suites).
- **Different angles than the implementor:** money NaN/Infinity/string-typed/precision-boundary/odd-cents round-trip · Reddit CTA exact-map pin + unexpected-key access · **PAUSED-invariant fuzz incl. hostile injected `status`/`execution_options` keys** · pixel-gate 2001 cutoff boundary + non-string inputs · floor-category conservatism (garbage goal ⇒ $40 floor) · special-ad-category adversarial shapes · **A4.f destination-policy source trap** (destSmartLink may only reach the DB column) · **atomic step-4 failure + rollback-exactly-once + missing-rollback-hook honesty** · CBO safety pins.
- **fails-on-revert (different file/angle than the money proof):** true line-deletion of `status: "PAUSED"` in `buildMetaCampaignBody` (`_shared/meta.ts`, commit-surface `b7be4718e`) → **T-3 both tests FAIL** (`issue862_wp1_tester_adversarial.test.ts:124` and `:149`); restore → 20/20 pass. `fails-on-revert verified at 069422d8d (working-tree line-deletion, restored)`.
- **CI wiring:** appended to the `ad-engine-deno-tests` job's `DENO_TEST_FILES` (+ `--allow-read` for the source-trap test). Both the implementor's suites and this file will be visible in `git diff origin/main...HEAD --name-only` for the closing PR.

## 7. Strict-grep gates — bite proven (mutated copies, never the real tree)

| Gate | Live run | Self-test | Bite proof (scratch tree) |
|---|---|---|---|
| `issue-862-ad-token-env-server-only.mjs` | PASS (16 names × 7 trees) | PASS | `mingla-admin/src/leak.js` referencing `META_SYSTEM_USER_TOKEN` → **exit 1** with the exact invariant message |
| `issue-862-reddit-configured-status-explicit.mjs` | PASS (armed — reddit.ts absent) | PASS | (a) create body missing `configured_status` → **exit 1** (2 failures); (b) DELETE-verb rollback → **exit 1** (R-5 message) |

## 8. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A-deferred | Admin UI build-verified only; live tap audit at RETEST (single admin surface) |
| 2 | One owner per truth | PASS | Budgets cents-at-rest, ONE conversion point; floors owned by connect-time `extra`; statuses owned by edge fns |
| 3 | No silent failures | PASS (P1 aside) | Every failure path returns typed errors + audit rows; rollback failure surfaces `create_failed` with partial IDs |
| 4 | One query key per entity | N/A | No React Query surface in scope |
| 5 | Server state server-side | PASS | Admin page fetches via service seam; no client Zustand of server rows |
| 6 | Logout clears everything | N/A | No auth-state change in scope |
| 7 | `[TRANSITIONAL]` labeled | PASS | None needed; WP-deferred stubs are explicit 424s |
| 8 | Subtract before adding | PASS | No duplicated logic found; adapter internals reuse builders |
| 9 | No fabricated data | PASS | `buildMetaReviewDetail` returns null (never `{}`); missing floors → 424, not defaults |
| 10 | Currency-aware | PASS | Floors matched by account currency; cents/bigint at rest |
| 11 | One auth instance | PASS | Each fn one service-role client; gateway JWT + in-code gate |
| 12 | Validate at the right time | PASS | All 6 fail-close gates precede any platform write (runtime-proven order) |
| 13 | Exclusion consistency | PASS (P3-6 noted) | Destination gate consistent with the public view — but see P3-6 |
| 14 | Persisted-state startup | N/A | No hydration surface |

## 9. Device / parity matrix

| Surface | Result |
|---|---|
| Consumer iOS / Android | **skipped — does not ship there** (back-office engine; zero app-mobile diff, verified in diffstat) |
| Buyer/anonymous Web | **skipped — read-only reference** (view SELECT only; zero code diff) |
| Business iOS / Android / Web preview | **skipped — zero mingla-business diff** |
| Admin Web | **build-verified** (vite green, bundle token-clean); live UI drive deferred to RETEST behind P1-1 |
| Backend (local stack + real Meta) | **live-fire PASS** per legs 1–4 |
| Physical iPhone HITL | **N/A** — no mobile surface ships in WP1 |
| Edge-fn live deploy state | **N/A by design** — nothing deployed (dispatch hard guard); config.toml carries all five `verify_jwt = true` blocks (verified) |

**Live-fire exemption note:** DB/RLS/edge-function scope is source+local-runtime sufficient per Phase 0.A exemptions; the Meta-facing paths got REAL live-fire anyway (read-only + validate-only + one rollback-consumed PAUSED chain + one diagnostic PAUSED chain, residual zero).

## 10. Discoveries for Orchestrator

- **D-1 (P3-11):** duplicate migration version prefixes (6 pairs) break `supabase start` on a fresh machine — register a hygiene ORCH; the fix is renames on main + a monotonicity CI check (uniqueness assert).
- **D-2:** Meta validate-only creative validation actually DOWNLOADS `image_url` — robots.txt-blocked hosts (incl. `usemingla.com/favicon.ico` and Wikimedia) fail with subcode 3858258. #866's creative library must serve ad images from a crawler-permissive host (Cloudinary passes today; the Bunny migration META-1270 must preserve this).
- **D-3:** the implementor's report line "RLS via a real non-admin JWT against prod-shaped DB (browser anon key path)" is now fully covered here — no residual gap.
- **D-4:** COMMS-0100/0101 acked in this branch's ledger copy (acked_by appended); dispatch hard guard prevented a push — orchestrator should carry the ack to main at CLOSE.

## 11. Accepted conditions

None — verdict is FAIL; no conditions were offered for acceptance.

## 12. Session hygiene / residuals

- Local stack: `supabase stop --no-backup` executed at session end; `supabase/.branches/` scratch removed; migration renames restored byte-identical (git-clean verified).
- Credentials: read via grep into shell vars/scratchpad env files only; scratchpad env files shredded at session end; nothing committed (verified: committed diff contains no `EAA` pattern).
- Meta account state after session: campaigns/adsets/ads/adcreatives lists all `[]`; two soft-DELETED diagnostic campaigns exist in Meta's trash state (non-listable, non-spending, terminal) — ids `52584720839827`, `52584721074827` (+ cascaded adset `52584721109227`), recorded here for audit.

---

**Routing:** FAIL → REWORK (`mingla-implementor`): P1-1 (required), P2-2/P2-3/P2-4/P2-5 (required unless Seth explicitly accepts any as follow-up ORCHs), P3s at implementor discretion or as follow-ups. Then RETEST (this skill): live create-persist-launch-pause loop + the original step-3-through-the-edge-fn leg + admin UI smoke.
**Working tree:** `~/Desktop/mingla-orchs/issue-862-meta-ads-api` on branch `issue-862-meta-ads-api`.
