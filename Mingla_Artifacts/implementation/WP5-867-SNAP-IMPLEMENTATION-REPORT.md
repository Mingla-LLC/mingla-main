# WP5 (#867) — Snapchat channel: implementation report

**ORCH:** ISSUE-867 WP5 [Full Rooms Ad Engine — Snapchat lane; the Google half shipped as WP2]
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` body + **Amendment A1** (A1.1 canonical decisions + the A1.2 SNAP SECTION), grounded in `Mingla_Artifacts/research/ad-pipeline-2026-07-15/PROOF_LOG.md` S-P1…S-P5
**Worktree:** `~/Desktop/mingla-orchs/issue-867-[snapchat-lane]/` on branch `issue-867-snapchat-lane` (rebased onto `origin/main` at `7aa1b971c` — full four-channel foundation present)
**Commits:** `d9e4959de` (adapter + registry) · `8f67aa237` (edge-fn lanes) · `d9b4005de` (test suites)
**Status label:** **implemented, partially verified** — every pure/wire-shape behavior is unit-verified (52 new tests; 494/494 type-checked ad-engine merged scope; full 1,168-passing battery with the failure set a strict subset of main's pre-existing set). The LIVE Snapchat legs (real mint, real connect, the §8 live-fire) are deliberately NOT exercised — the dispatch forbids live platform calls; the tester owns them.

---

## 1. Summary

Snapchat is now the **fifth and final live channel adapter** of the Full Rooms Ad Engine — the last `failCloseStub` in `_shared/adChannel.ts` is gone. The adapter implements the A4 `ChannelAdapter` with **all four A1.2 create-sequence fixes** (the body spec's create chain could not succeed as written): S-1 `objective_v2_properties.objective_v2_type`, S-2 the creative-type→ad-type **map** (WEB_VIEW → `REMOTE_WEBPAGE`; the attachment-less `SNAP_AD` trap is structurally unreachable), S-3 the 23-value WEB_VIEW CTA allowlist (`VIEW_MORE` rejected pre-call), S-4 adapter-derived `delivery_constraint`. Money follows the GR-01 contract: cents at rest, ×10,000 to micro at exactly ONE boundary, floors checked **in micro after conversion**. There is **no static Snap token** (S-P1): every call mints a 3600 s access token from `SNAPCHAT_REFRESH_TOKEN`/`_CLIENT_ID`/`_CLIENT_SECRET`, cached module-scope with a 60 s margin, fail-close on any mint failure. The Public Profile id is **trusted config** (`SNAPCHAT_PROFILE_ID` — the API lookup 403s on our token class, S-P4), gated fail-close (`424 snapchat_profile_missing`) at connect AND at create, before any provider write. All five `admin-ad-*` functions gained snapchat lanes, including **the validate gate**: Snap has no validate-only, so `validate_only=true` returns an explicit named-skipped-layers response with **zero** adapter calls (the WP2 §10 discovery — the generic block would have created a REAL creative).

## 2. SPEC success-criteria coverage

| AC | Status | Evidence | Commit |
|---|---|---|---|
| **AC-S-1** — connect mints from the refresh token, validates account/funding, persists the row; missing/expired token → 424 + `invalid` row, zero create calls | ✓ implemented; mint/fail-close/sentinel unit-verified; **live leg UNVERIFIED (tester-owned)** | connect lane (5-step fail-close); `RT-1/AC-S-7` test proves zero network on absent secrets across all 7 adapter surfaces; mint 4xx fail-close test | `8f67aa237` / `d9e4959de` |
| **AC-S-2 (A1.4-tightened)** — one campaign+squad+creative+ad, ALL PAUSED; S-1 key, S-2 map-derived `REMOTE_WEBPAGE`, S-3 allowlisted CTA, S-4 derived `delivery_constraint`; row carries review_status + creative_review_status + review_status_reasons | ✓ implemented; the mocked-wire flow test asserts every fix ON THE WIRE + exact call order; **live leg UNVERIFIED** | `issue867_wp5_snapchat_flow.test.ts` "WP5 flow…" ; create-campaign branch persists both vocabularies via `review_detail` | `d9e4959de`+`8f67aa237` |
| **AC-S-3 (A1.4)** — cents at rest; ×10,000 at the adapter boundary; floors in micro AFTER conversion; 422 `budget_below_minimum` pre-write; RT-5 $5→5,000,000 / $20→20,000,000 | ✓ verified | RT-5 exactness tests; floor tests (499¢ fails / 500¢ passes; 1,999¢ / 2,000¢); edge branch pre-call floor 422 | `d9e4959de` |
| **AC-S-4** — non-public destination → 422 `destination_not_public` pre-write; valid → correct `dest_url` + smart link | ✓ implemented (same view gate as WP1/WP2, byte-parallel); GR-52 re-checker already channel-generic | create-campaign branch steps (4) | `8f67aa237` |
| **AC-S-5 (A1.4)** — top-down launch; pause; audit rows; warning keys off BOTH review vocabularies | ✓ implemented; warning matrix unit-verified | `snapchatLaunchWarning` tests (ad PENDING / creative PENDING_REVIEW / REJECTED / approved-silent); action-fn snapchat branch | `8f67aa237` / `d9e4959de` |
| **AC-S-6** — no orphans: step failure ⇒ no DB rows, compensating `DELETE /campaigns/{id}`, 502 `snapchat_create_failed` | ✓ verified (mocked wire): squad-step `sub_request_status FAILURE` → DELETE fired, `AtomicCreateError` carries partial ids; GR-48 creative delete asserted separately | flow tests #2/#3 | `d9e4959de` |
| **AC-S-7** — secrets unset ⇒ 424 everywhere, zero Marketing-API calls | ✓ verified (RT-1 test, calls===0 across connect/create×3/setStatus/getStatus/setBudget) | `snapchat.test.ts` | `d9e4959de` |
| **AC-S-8** — one mint per ~60-min window, re-mint after expiry, mint 4xx fails close | ✓ verified (cache test: 2 resolves → 1 HTTP mint; reset → re-mint; 400 → `AdNotConnectedError`; flow test: ONE mint across the whole atomic chain) | `d9e4959de` |
| **AC-S-9** — authz 403 / RLS | ✓ inherited (WP1 admin gate is byte-identical in every lane; RLS shipped in the WP1 migration — no schema change here) | — | n/a |
| **AC-S-10** — no token leak | ✓ implemented: Bearer-header-only, scrub on every provider text, mint errors carry no detail; strict-grep `issue-862-ad-token-env-server-only` green | scrub test + gate output §9 | `d9e4959de` |
| **AC-S-11** — `profile_or_page_id` null ⇒ 424 `snapchat_profile_missing`, ZERO provider calls | ✓ implemented at BOTH the edge pre-flight (step 3, before any adapter call) and the adapter (defense-in-depth `AdNotConnectedError('snapchat_profile_missing')`) | create branch step (3); connect step 4; preflight P3 | `8f67aa237` |
| **AC-S-12** — review cron persists both vocabularies + reasons + delivery at all levels | ✓ sync lane implemented (`buildSnapchatReviewDetail` → `ads.review_detail`; campaign/squad delivery arrays → text columns); **cron SCHEDULING is cross-channel work** (same posture as WP2 §10.8 / WP6 — the sweep is admin-triggerable now) | sync branch + GR-38 tests | `8f67aa237` |
| **AC-S-13** — SWIPES default; pixel goals 422 `pixel_goal_unavailable` until `pixel_installed`; permitted pixel goal carries `pixel_id` | ✓ verified: edge gate on `extra.pixel_installed !== true`; adapter wire-guard test (goal without pixelId throws; with it, `pixel_id` rides; SWIPES never carries it) | `8f67aa237` / `d9e4959de` |
| **Dispatch: S-6 / S-7 / S-9 / GR-39 / GR-54 / GR-64 / A1.2-14 / paging** | ✓ all verified by dedicated unit tests (legacy-`objective`-absent; MIN_ROAS lockout + bid_micro≥10,000; recursive envelope double-assert; string demographics min_age "18" default; 34/32/375/2048-SSL validators; spend-cap ≥20M + >1.1×-spent reduction rule; 3–180 s duration; next_link followed) | `snapchat.test.ts` | `d9e4959de` |
| **Dispatch: sentinel-poisoning class (F-1)** | ✓ verified from the start: non-UUID-v4-lowercase persisted `external_account_id` = ABSENCE (3-angle test: sentinel→env wins; uppercase→absence; real-mismatch→loud `account_mismatch`; nothing→424 with zero calls) | `d9e4959de` |
| **Dispatch: validate gate (WP2 §10)** | ✓ implemented twice: the edge branch returns `validated:false` + 4 named skipped layers with zero adapter calls; the adapter independently refuses `validateOnly:true` (`snapchat_no_validate_only`, zero API calls — unit-verified) | `8f67aa237` / `d9e4959de` |

## 3. Files changed (9 files · +4,613 / −67)

| File | Δ | What |
|---|---|---|
| `supabase/functions/_shared/snapchat.ts` | **+1,996 (new)** | The full adapter: env/lane resolution, cached mint, envelope double-assert, `snapchatApi` (GET/POST/PUT/DELETE + absolute-URL paging), all validators/enums/maps, pure body builders, packaging poll, read-modify-write status updates, setBudget, rollback hooks, connect/preflight probes, review-detail + launch-warning builders |
| `supabase/functions/_shared/adChannel.ts` | +9/−25 | Registry: `snapchat: snapchatAdapter` replaces the last `failCloseStub` (stub helper deleted — subtract before adding); header doc updated |
| `supabase/functions/admin-ad-connect/index.ts` | +251/−? | Snapchat 5-step fail-close connect lane + lane-correct default token env var + sentinel-guarded `markSnapchatInvalid`; the "one unbuilt channel" stub block deleted |
| `supabase/functions/admin-ad-preflight/index.ts` | +191/−? | `snapchatPreflight` (P1 mint+ACTIVE · P2 funding · P3 profile trusted config · P4 pixel warn · P5 n/a · P6 n/a); `stubRow` + stub 424 block deleted (all five channels live) |
| `supabase/functions/admin-ad-create-campaign/index.ts` | +661 | Self-contained snapchat branch (validators → 424 gates → idempotency → destination → #866 media resolve → **validate gate** → atomic create → both-vocabulary read-back → persist → audit). Meta + google paths byte-identical |
| `supabase/functions/admin-ad-campaign-action/index.ts` | +27 | Launch warning keyed off BOTH review vocabularies (reads the first ad's status incl. `creative_review_status`) |
| `supabase/functions/admin-ad-campaign-sync/index.ts` | +22 | `buildSnapchatReviewDetail` branch (both vocabularies + reasons + delivery into `review_detail`) |
| `supabase/functions/_shared/__tests__/snapchat.test.ts` | **+964 (new)** | 44 happy-path tests (append-only) |
| `supabase/functions/_shared/__tests__/issue867_wp5_snapchat_flow.test.ts` | **+534 (new)** | 8 mocked-wire flow tests (append-only) |

## 4. Data-model changes applied

**None — zero migrations (per dispatch hard guard and COMMS-0102).** The WP1 foundation schema carries everything: ad-review vocabulary → `ads.review_status`; creative vocabulary + `review_status_reasons` + delivery arrays → `ads.review_detail` jsonb; campaign/squad delivery arrays serialize to the existing `ad_campaigns.delivery_status` / `ad_sets.external_status` text columns; media id → audit `external_ids.external_media_id` (+ `ads.creative_id` FK when the #866 library was the source).

## 5. Edge functions touched (deploy list — orchestrator/operator, from MERGED main)

| Function | `verify_jwt` to preserve |
|---|---|
| `admin-ad-connect` | `true` |
| `admin-ad-preflight` | `true` |
| `admin-ad-create-campaign` | `true` |
| `admin-ad-campaign-action` | `true` |
| `admin-ad-campaign-sync` | `true` |

(All five must be redeployed together — they share `_shared/adChannel.ts`/`_shared/snapchat.ts`. `admin-ad-creative-upload` is untouched but imports nothing new; no redeploy needed.)

## 6. Regression tests added

- `supabase/functions/_shared/__tests__/snapchat.test.ts` — 44 tests.
- `supabase/functions/_shared/__tests__/issue867_wp5_snapchat_flow.test.ts` — 8 tests.
- **Fails-on-revert #1 (S-2 map):** TRUE LINE DELETION of `WEB_VIEW: "REMOTE_WEBPAGE",` in `SNAPCHAT_CREATIVE_TO_AD_TYPE` → `FAILED | 48 passed | 4 failed` (both S-2 tests + PAUSED fuzz + the wire flow); restored → `ok | 52 passed`. Re-stamped at HEAD post-amend (both suites fail on deletion, green on restore). **fails-on-revert verified at `d9b4005de`.**
- **Fails-on-revert #2 (PAUSED):** TRUE LINE DELETION of `status: "PAUSED",` in `buildSnapchatCampaignBody` → `FAILED | 50 passed | 2 failed` (PAUSED fuzz + wire flow); restored → green. **fails-on-revert verified at `d9b4005de`.**
- **Append-only:** both files are NEW; `git diff origin/main...HEAD --name-only` shows no existing test modified/deleted.

## 7. Old → New receipts

### `supabase/functions/_shared/snapchat.ts` (NEW)
**Before:** did not exist; `getAdapter("snapchat")` returned a fail-close stub.
**Now:** full `ChannelAdapter` per §2 above.
**Why:** WP5 dispatch — the last channel adapter, to the A1.2-corrected contract.

### `supabase/functions/_shared/adChannel.ts`
**Before:** `snapchat: failCloseStub("snapchat")` + a 20-line stub factory.
**Now:** `snapchat: snapchatAdapter`; stub factory deleted (no remaining consumer).
**Why:** registry wiring; subtract-before-adding.
**Lines:** +9/−25.

### `admin-ad-connect/index.ts`
**Before:** `platform === "snapchat"` → 424 stub.
**Now:** 5-step fail-close lane (mint → account ACTIVE → funding servable → profile trusted config → pixel informational), success upsert (auth_kind `refresh_token`, env NAMES in `extra`, `pixel_installed` preserved for #865, `min_daily_budget_cents` 500), sentinel-guarded invalid-row upsert with persisted `last_error`.
**Why:** SPEC §4.4a + A1.2-8 + dispatch "7-step-style".
**Lines:** ~+250.

### `admin-ad-preflight/index.ts`
**Before:** snapchat → `stubRow` (P1 fail).
**Now:** `snapchatPreflight` P1–P6; stub machinery deleted.
**Why:** channel-health parity with the other four lanes.
**Lines:** ~+190/−15.

### `admin-ad-create-campaign/index.ts`
**Before:** snapchat requests fell through to the Meta-shaped path (accidental 422 `invalid_objective`).
**Now:** self-contained branch: 422 validators pre-call (name ≤375, headline ≤34, brand ≤32, CTA allowlist w/ BUY_TICKETS/BOOK_NOW defaults, S-7 bid pre-check, demographics strings, floors-in-micro, spend-cap min) → 424 connection → 424 profile (AC-S-11) → idempotent replay → destination resolve + https/2048 gate → #866 library media resolve (ready ref, content-hash match, video duration) → **validate gate (zero adapter calls)** → `createFullCampaignAtomic` → both-vocabulary read-back → persist campaign/squad/ad rows → audit (incl. `external_media_id`); AtomicCreateError path mirrors WP1 incl. creative-residue naming.
**Why:** SPEC §4.4b as corrected by A1.2; WP2 §10; WP7 §9.6 follow-through ("the edge branch is the next WP's").
**Lines:** +661.

### `admin-ad-campaign-action/index.ts`
**Before:** snapchat launches would have warned only via the Meta `WARNING_STATUSES` list (never matching Snap vocabularies).
**Now:** snapchat branch reads the first ad's status and warns off BOTH vocabularies; 200 + warning, never a silent clamp.
**Lines:** +27.

### `admin-ad-campaign-sync/index.ts`
**Before:** snapchat ads would have flowed through `buildMetaReviewDetail` (dropping reasons + the creative vocabulary).
**Now:** `buildSnapchatReviewDetail` branch.
**Lines:** +22.

## 8. Cross-surface impact

| Surface | Affected? | Parity |
|---|---|---|
| Consumer iOS / Android | No — back-office engine only | n/a |
| Buyer/anonymous Web | Read-only destination reference (`business_public_events_view` / `business_public_brands_view`) — no code change | n/a |
| Business iOS / Android | No | n/a |
| **Admin Web** | Backend contract ready; **no UI built in WP5** (same posture as WP2/WP6/WP7 — the SC-1…SC-8 admin surface is the #864 builder's) | single surface |
| Business Web preview | No | n/a |
| **Backend (supabase/)** | **YES — primary** (5 edge fns + 2 shared modules + 2 test files) | server-authoritative |

## 9. Smoke / gate results

- `deno check` on all 7 product files: **clean**.
- New suites: `ok | 52 passed | 0 failed` (type-checked).
- Ad-engine merged scope (adChannel/meta/google/tiktok/reddit/snapchat + all WP1/WP2/WP3/WP6/WP7 implementor+adversarial suites + adCreative): **`ok | 494 passed | 0 failed`** (type-checked).
- Full `_shared/__tests__/` battery (`--no-check`, house convention): worktree **`1168 passed | 33 failed`** vs pre-change baseline `1116 passed | 33 failed` — **+52, zero new failures; the post-change failure-name set is a strict subset of the baseline set** (the only run-to-run name delta is the known network-flaky Mapbox `paired GPS present` test; the `ticketCheckout` uncaught-error flake persists on both sides). Note for QA: naive `grep FAILED` extraction false-positives on four PASSING tests whose NAMES contain "FAILED"/"WRITE_FAILED" (QA-R3, ORCH-1103 ADV-A6, ORCH-1146 T9, ORCH-1151 T6) — verified by result-marker extraction, not name match.
- Strict-grep gates: `issue-862-ad-token-env-server-only` **passed** (16 token names, 7 client trees clean); `issue-866-creative-guards` **passed**; `issue-862-reddit-configured-status-explicit` **passed**.
- **No live Snapchat call was made from this session** (hard guard) — the tester owns: real connect, the AC-S-2 live create (PAUSED), launch/pause with review polling, and the GR-48 cascade verification.

## 10. Known issues / deferred (no `[TRANSITIONAL]` markers in code)

1. **`setStatus` is read-modify-write, a deliberate safety deviation from the body's bare `{id,status}` PUT.** Snap PUTs are full-object updates — a bare `{id,status}` body risks wiping sibling fields. The adapter GETs the entity, strips a pinned server-owned-field list (`SNAPCHAT_READ_ONLY_ENTITY_FIELDS`), merges the status, and PUTs to the parent collection (still the §4.0 endpoint contract). **The stripped-field list is doc-derived, unverified live** — the tester's launch leg should confirm no `unknown field` rejection and no field loss.
2. **`rollbackCreative` = attempted `DELETE /creatives/{id}` — the Snap creative-delete surface is unverified pre-live-fire (GR-48).** If Snap refuses, the throw makes the runner record `creative_residue_id` in the audit row (tested). The tester's live-fire must verify what `DELETE /campaigns/{id}` actually cascades and whether creative delete exists at all.
3. **Spend-cap reduction rule (GR-64) ships as `validateSnapchatSpendCapReduction`** and is enforced fail-close when the spent amount is unknown; a live spent-micro READ (stats endpoint) is #865-adjacent and not wired into `setBudget` yet — today `setBudget` updates `daily_budget_micro`/`lifetime_budget_micro` only, not the spend cap.
4. **Review cron scheduling** (A1.2-9's 30–60-min-while-PENDING cadence) is not scheduled here — cross-channel, same posture as WP2 §10.8 / WP6; the sync fn is sweep-ready.
5. **Daily budgets only** in create-campaign (`budget.type !== 'daily'` 422s in the shared block — WP1 posture); the squad builder already supports lifetime for the #864 builder.
6. **Admin UI (SC-1…SC-8) not built** — #864, matching WP2/WP6/WP7.
7. **`promotion_type: PROMOTE_PLACES` (GR-65)** is accepted as an optional input and validated, never defaulted — the live-fire A/B evaluation is the tester's.
8. **Top Snap duration 3–180 s** enforced; the 1800 s doc discrepancy must be confirmed live (A1.5 #5).
9. **P6 market check is `n/a`** in preflight — Snap geos take ISO codes directly; no resolver exists to probe read-only without an unverified dictionary endpoint.

## 11. Operator action required

- **No migration. No `db push`.**
- **Secrets to confirm before tester live-fire** (Supabase Function Secrets, consumer lane): `SNAPCHAT_REFRESH_TOKEN`, `SNAPCHAT_CLIENT_ID`, `SNAPCHAT_CLIENT_SECRET` (set — S-P1), plus the NEW config names this WP reads: **`SNAPCHAT_AD_ACCOUNT_ID`** (`6421cc96-dcaf-4a09-a7fa-b24199dcb391`), **`SNAPCHAT_PROFILE_ID`** (`2cfbdc85-890c-43af-b393-10c0adbbad67` — trusted config, A1.2-8), optional `SNAPCHAT_ORG_ID` (`9389df65-3fa2-4a79-9593-479eee8d67bb`) and `SNAPCHAT_PIXEL_ID` (`af5f8fc4-1ef6-41e7-81c5-042b7be7df38`).
- **Edge deploy (from MERGED main, orchestrator-owned):** the five functions in §5, `verify_jwt=true` preserved on all.

## 12. Discoveries for Orchestrator

1. **Test-battery tooling hazard:** failure-set extraction by `grep FAILED` silently counts PASSING tests whose names contain the token (4 such pre-existing test names; I renamed my own to avoid adding a 5th). Any CI/QA harness diffing failure sets by name-grep will report phantom regressions — extraction must key on the result marker after the `...` separator.
2. **The `ticketCheckout.test.ts` uncaught error** (pre-existing on main) intermittently CANCELS neighboring tests mid-sweep, causing ±1 run-to-run variance in the full-battery failure count. A cleanup ORCH would stabilize the battery baseline.
3. **WP1's T-7 adversarial guard** (`issue862_wp1_tester_adversarial.test.ts`) counts `destSmartLink` identifier substrings in `admin-ad-create-campaign/index.ts` — any future branch must avoid identifiers containing that substring (my branch uses `snapSmartLink`); worth noting in the #864 builder dispatch.
4. **`business` lane env names** follow the house convention → `SNAPCHAT_MINGLABIZ_*` (unprovisioned; fail-close). The spec names only the consumer set — same flag as WP2 §10.9.
5. **COMMS-0105/0104/0102/0100 WARNs factored** this turn (no stash used; no migrations; multipart media path means the crawler-permissive-image-host constraint does not bind Snap uploads). Ledger acks are **owed as direct-to-main commits** — this dispatch forbids pushing from this session; the orchestrator should append `mingla-implementor+claude (ISSUE-867 WP5 snapchat)` to the acked_by columns of COMMS-0105/0104/0102 at CLOSE.

---

**Routing:** back to the **orchestrator for REVIEW → `mingla-tester` dispatch** (live legs: connect against the real account, one PAUSED $5/day live-fire create per SPEC §8 — confirm Snap-3 profile verification at the first creative create, the GR-48 cascade truth, the read-modify-write PUT safety, review polling through PENDING→APPROVED, launch/pause, cleanup). Not deployed, not merged, not pushed.
