# WP6-916 IMPLEMENTATION REPORT — Reddit Ads Channel

**Issue:** #916 (child of #852 Full Rooms Ad Engine · plugs into #862 A3/A4)
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ISSUE-REDDIT_CHANNEL.md` (29 ACs)
**Worktree:** `~/Desktop/mingla-orchs/issue-916-[reddit-ads-channel]` · branch `issue-916-reddit-ads-channel` (rebased onto origin/main at `92d1960d8` before work)
**Author:** mingla-implementor+claude · **Date:** 2026-07-15
**Status:** implemented and verified (mocked-transport legs); live legs deliberately deferred to the tester's supervised window — Reddit has NO validate-only; the first real create is the tester's, PAUSED, rolled back via PATCH DELETED.

---

## 1. Summary

The fifth ad channel is code-complete. `_shared/reddit.ts` implements the A4-widened `ChannelAdapter` end-to-end: refresh-token mint that reads `expires_in` from the response (never hardcodes a TTL), a descriptive User-Agent on every call including the mint, three create-body builders that set `configured_status:"PAUSED"` explicitly at all three levels, unconditional `conversion_pixel_id` on every ad group and CBO campaign, the structured-post job runner (submit → bounded-backoff poll → SUCCESS t3_ / CLIENT_ERROR-never-resubmit / SERVER_ERROR-bounded-new-jobs), a targeting allowlist serializer that makes age keys unrepresentable, the 24-value Title-Case CTA contract, copy/destination validation (OneLinks are structurally blocked as BRIDGE_PAGE risks), review-status derivation from `effective_status` with verbatim `rejection_reason` persistence (including Reddit's own FACILIATE typo), and reverse-order PATCH-DELETED rollback with orphaned-post recording. The registry stub is replaced; admin-ad-connect gains the 7-step fail-close pre-flight; preflight/sync/action gain reddit lanes. 58 new deno tests + the two armed strict-grep gates are green; the full merged ad-engine suite is 192/192.

**Nothing can spend:** every create path is PAUSED-explicit, no live platform call was made (all tests stub `fetch`), nothing was deployed, no migration exists or was applied.

## 2. SPEC acceptance-criteria coverage (29 ACs)

Legend: **CC** = code-complete + unit-verified at commit; **CC/LD** = code-complete, live leg deferred to the tester (read-only probes or the supervised PAUSED create).

| AC | Status | Verified by | Commit |
|---|---|---|---|
| AC-R-1 connect mints + row upsert with captured ids | **CC/LD** — mocked 7-step happy path captures profile/funding/pixel/scope; live read-only run = tester | `reddit.test.ts` "connect pre-flight: 7-step happy path" | `aca341a82` |
| AC-R-2 TTL read from `expires_in` (86400→~86100s, 3600→~3300s; no 3600 literal) | **CC** | TTL test + no-3600 source trap | `abcbf3d7f` |
| AC-R-3 UA on EVERY request incl. the mint | **CC** | transport-capture test (mint Basic+form asserted too) | `abcbf3d7f` |
| AC-R-4 fail-close: missing secret → `reddit_not_connected` (zero fetches); no profile → `reddit_profile_missing`; funding → `reddit_funding_not_servable` + verbatim reasons (pre-fix probe values) | **CC** | 3 dedicated tests | `abcbf3d7f`/`aca341a82` |
| AC-R-5 `^(t2\|a2)_` — never assumes a2_ | **CC** | regex test + preflight account pick | `abcbf3d7f` |
| AC-R-6 non-8-enum currency → `invalid` + admin-visible reason | **CC/LD** — `reddit_currency_unsupported` → markRedditInvalid + 424 in connect fn; NGN unit test | currency test | `aca341a82` |
| AC-R-7 campaign body: PAUSED explicit, `REDDIT_OBJECTIVE.TRAFFIC`→CLICKS, funding attached, CBO=false, `{data:{…}}` wrap | **CC** | builder + transport-wrap tests | `abcbf3d7f` |
| AC-R-8 `conversion_pixel_id` unconditional — no ad-group path without it | **CC** + **fails-on-revert proven** | combo-sweep test; line-deletion proof (§6) | `abcbf3d7f` |
| AC-R-9 CBO cross-rule 422s (all six rules) | **CC** | cross-rule test battery | `abcbf3d7f` |
| AC-R-10 money: G-3 + low-budget 400 surfaced verbatim | **CC** | G-3 tests + mocked-400 verbatim test | `abcbf3d7f` |
| AC-R-11 job state machine (SUCCESS t3_; CLIENT_ERROR verbatim, same job NEVER resubmitted; SERVER_ERROR bounded NEW jobs; 2s→30s cap, 5-min deadline) | **CC** | 4 state-machine tests w/ injected sleep + submission counting | `abcbf3d7f` |
| AC-R-12 ad body `^t3_`/`^t2_`; unresolved post unrepresentable; canonical click_url ≤14 params incl `{{AD_ID}}` | **CC** | ad-body tests | `abcbf3d7f` |
| AC-R-13 launch top-down + 200+`warning` while PENDING/REJECTED | **CC/LD** — top-down PATCH order is the action fn's existing loop via `setStatus`; reddit reads the AD's effective_status; unit halves tested; live launch = tester | setStatus-per-level + `redditLaunchWarning` tests | `aca341a82` |
| AC-R-14 reverse-order PATCH-DELETED rollback; DELETE verb never used; orphaned t3_ recorded | **CC** | full-chain failure test (call-order + orphan + no-DELETE assertions) + rollback-order test + source trap | `abcbf3d7f` |
| AC-R-15 G-4 allowlist; age unrepresentable; property sweep | **CC** | hostile-input + 50-iteration junk-key sweep | `abcbf3d7f` |
| AC-R-16 gender ∈ {FEMALE, MALE, null} + warn | **CC** | gender tests | `abcbf3d7f` |
| AC-R-17 communities from passthrough, r/ stripped, politics default | **CC** | communities tests | `abcbf3d7f` |
| AC-R-18 cap 422s naming the limit (20,001/201/1,001/2,001/6) | **CC** | cap tests | `abcbf3d7f` |
| AC-R-19 keyword/geo validations BEFORE ad-group create; failure blocks | **CC** | call-order test + blocked-create test | `abcbf3d7f` |
| AC-R-20 `query=` never `q=`; ≥24h cache; r=0 backoff to reset window | **CC** | URL-param + cache-hit + backoff-sleep tests | `abcbf3d7f` |
| AC-R-21 defaults FEED+COMMENTS_PAGE / CARD+IMMERSIVE; COMPACT/CLASSIC warn | **CC** | defaults tests (+ excluded_interests deprecated warn, DESKTOP_LEGACY strip) | `abcbf3d7f` |
| AC-R-22 G-2 CTA map (6 offering classes) + `invalid_cta` 422 | **CC** | G-2 tests | `abcbf3d7f` |
| AC-R-23 copy boundaries (301/101/81/ALL-CAPS/181/40,001/2&501/5,001/15) | **CC** | boundary battery | `abcbf3d7f` |
| AC-R-24 display_url domain match; OneLink → 422 bridge-page; no OneLink can reach a create body | **CC** | destination tests incl. builder rejections | `abcbf3d7f` |
| AC-R-25 VIDEO thumbnail 422; carousel 1–6 [SPEC, not the guide's 2–7]; [3P] warn-never-block; INVALID_MEDIA verbatim | **CC** | creative-variant tests | `abcbf3d7f` |
| AC-R-26 §6.1 mapping (billing/identity/permission → warnings, review unchanged); FACILIATE typo verbatim | **CC** | mapping + typo tests; sync-fn wiring source-verified | `abcbf3d7f`/`aca341a82` |
| AC-R-27 sync cadence + read-pool discipline | **PARTIAL/LD** — sync reuses WP1's bounded oldest-first sweep through adapter `getStatus` (400/60s read pool); the 30–60-min-while-PENDING cadence is cron-owned (no in-repo scheduler); batch reads via list endpoints NOT implemented (deferral, §10) | source-verified | `aca341a82` |
| AC-R-28 G-1 fails on revert | **PROVEN** — deleting all three PAUSED lines: gate exit 1 (both failure modes) + 5 test failures; single-line deletion: suite fails (gate alone is count-based — see §12 discovery) | §6 transcript | at `94a81b380` |
| AC-R-29 G-2/G-3/G-4 in the standard CI suite, fail on their reverts | **CC** — registered in the ad-engine deno job; each guarded behavior is pinned byte-exact (CTA verbatim; toMicro values; allowlist subset; captured `query=` URL), so the named reverts flip assertions by construction | workflow registration + assertions | `94a81b380` |

## 3. Files changed (vs origin/main, 9 files, +4,984/−22)

| File | Δ | What |
|---|---|---|
| `supabase/functions/_shared/reddit.ts` | **NEW, 2,927 ln** | The adapter — everything in §1 |
| `supabase/functions/_shared/__tests__/reddit.test.ts` | **NEW, 1,707 ln** | 58 tests (append-only; no existing test touched) |
| `supabase/functions/_shared/adChannel.ts` | +19/−4 | Registry stub → `redditAdapter`; `CreateAdInput` gains additive-optional `clickUrl?`/`utmCampaign?`; header comment updated |
| `supabase/functions/admin-ad-connect/index.ts` | +132 | Reddit branch: 7-step pre-flight, per-step 424s, §1.4 row upsert, invalid-row persistence |
| `supabase/functions/admin-ad-preflight/index.ts` | +122 | `redditPreflight` P1–P6 row (pixel = HARD gate); stub condition narrowed |
| `supabase/functions/admin-ad-campaign-sync/index.ts` | +42 | Reddit review mapping (derived review_status; unmapped states leave it unchanged) + `buildRedditReviewDetail` |
| `supabase/functions/admin-ad-campaign-action/index.ts` | +32 | Reddit launch reads the ad's effective_status → 200 + warning |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +23 | `reddit.test.ts` registered; `REDDIT_ADS_*` env deliberately empty |
| `COMMS_LEDGER.md` | 1 row | COMMS-0103 ack (rides this branch — dispatch forbids pushing) |

## 4. Data-model changes applied

**NONE.** Zero migrations written or applied — the spec maps Reddit onto WP1's `ad_connections` / `ad_campaigns` / `ad_sets` / `ads` / `ad_status_events` exactly (`ads.review_status` is unconstrained text; `ad_status_events.action` already includes `rollback`/`create_failed`). The §1.4 seed row is a runtime upsert by admin-ad-connect, not a migration.

## 5. Edge functions touched (deploy list — orchestrator/operator, from MERGED main)

| Function | verify_jwt to preserve |
|---|---|
| `admin-ad-connect` | **true** |
| `admin-ad-preflight` | **true** |
| `admin-ad-campaign-sync` | **true** |
| `admin-ad-campaign-action` | **true** |

`admin-ad-create-campaign` is untouched (no reddit branch — see §10/§12).

## 6. Regression tests + fails-on-revert

- Suite: `supabase/functions/_shared/__tests__/reddit.test.ts` — **58 passed, 0 failed** (also 192/192 across all nine merged ad-engine suites, CI-parity env with all credentials empty).
- **Fails-on-revert verified at `94a81b380`** — true LINE DELETION, not comment-out:
  1. **All three `configured_status: "PAUSED",` lines deleted** → strict-grep gate `issue-862-reddit-configured-status-explicit.mjs` **FAILED** (`found 6 create-endpoint reference(s) … only 5 configured_status occurrence(s)` + `no explicit configured_status: "PAUSED" assignment found`, exit 1) AND the deno suite **FAILED (53/58, 5 failures)**.
  2. **Single ad-group PAUSED line deleted** → suite **FAILED** (`AC-R-8: every ad-group input combination carries conversion_pixel_id (GR-12) … FAILED`, 57/58).
  3. **`conversion_pixel_id: input.conversionPixelId,` line deleted** → suite **FAILED** (same AC-R-8 test, 57/58).
  4. Restored → **58/58 ok** + gate passed.
- Append-only: both new files are additions; no existing test modified or deleted.

## 7. Old → New receipts

### supabase/functions/_shared/reddit.ts (NEW)
**Before:** did not exist — the registry carried a fail-close stub (424 `reddit_not_connected`).
**Now:** the full ChannelAdapter per SPEC §1–§7 (mint/UA/rate-limit transport, PAUSED builders, unconditional pixel, job runner, allowlist targeting, CTA/copy/destination validation, review derivation, reverse-order PATCH-DELETED rollback + `redditCreateFullChain`).
**Why:** SPEC §3–§8 verbatim. **Lines:** +2,927.

### supabase/functions/_shared/adChannel.ts
**Before:** `reddit: failCloseStub("reddit")`; `CreateAdInput` had no click_url slot.
**Now:** `reddit: redditAdapter`; `CreateAdInput.clickUrl?`/`utmCampaign?` (additive-optional; other adapters ignore them).
**Why:** registry wiring (dispatch b); Reddit's §3.5 ad body needs click_url + UTM inputs the A4 shape didn't carry. **Lines:** ±23.

### supabase/functions/admin-ad-connect/index.ts
**Before:** reddit → blanket 424 stub.
**Now:** the ordered 7-step fail-close pre-flight with per-step 424 codes, verbatim `reasons_not_servable[]`, §1.4 upsert caching `reddit_profile_id`/`reddit_funding_instrument_id`/`reddit_pixel_id`/scopes into `extra`, and QA-P2-4-style invalid-row persistence on any failure.
**Why:** SPEC §1.3–§1.4 (dispatch b); kills the "created fine, never spends" mode (GR-13). **Lines:** +132.

### supabase/functions/admin-ad-preflight/index.ts
**Before:** reddit → stub row.
**Now:** real P1–P6 row; pixel is a HARD fail (GR-12); P6 exercises the community-search path with `query=`.
**Why:** SPEC §1 channel-health contract. **Lines:** +122.

### supabase/functions/admin-ad-campaign-sync/index.ts
**Before:** two-way review-detail (google/meta); `review_status` always overwritten with raw `effectiveStatus`.
**Now:** three-way review-detail; for reddit, `review_status` is written ONLY when §6.1 maps it (billing/identity/permission/paused states leave it unchanged) and `review_detail` carries verbatim `rejection_reason` + `delivery_status[]`.
**Why:** R-3 — Reddit has no review_status field; overwriting with raw effective_status would corrupt the column with non-review states. **Lines:** +42.

### supabase/functions/admin-ad-campaign-action/index.ts
**Before:** Meta-vocabulary warning list only; campaign-level effective_status.
**Now:** reddit launches read the AD's effective_status (where Reddit's review state lives) and return 200 + `redditLaunchWarning` copy; meta path byte-identical.
**Why:** AC-R-13 / #867 precedent. **Lines:** +32.

### .github/workflows/supabase-migrations-and-stripe-deno.yml
**Before:** 8 ad-engine suites; no REDDIT env.
**Now:** 9 suites (+`reddit.test.ts`) + empty `REDDIT_ADS_*` for the fail-close legs.
**Why:** SPEC §8 — the gates run in the standard CI suite. **Lines:** +23.

## 8. Cross-surface impact

| Surface | Affected? | Note |
|---|---|---|
| Consumer iOS / Android | No | backend/CI only |
| Buyer/anonymous Web | No | backend/CI only |
| Business iOS / Android | No | backend/CI only |
| Business Web preview | No | backend/CI only |
| Admin Web (`#/ad-engine`) | **Indirect, automatic** | the WP1 surface consumes connect/preflight generically per platform — once deployed, reddit renders real preflight rows instead of the stub; zero admin-code changes needed |
| Supabase edge/DB | **Yes** | 1 new shared module, 4 fns extended, 0 migrations |

Parity is automatic everywhere (single shared code path); no manual-parity surface exists in this WP.

## 9. Smoke result

No simulator/device leg exists (backend + CI only). Runtime verification = the mocked-transport deno suite (58 tests incl. full-chain wire-shape assertions, header capture, call ordering, rollback ordering) + `deno check` on all 7 touched TS files + both strict-grep gates with self-tests + the 371-gate local sweep (14 failures, all pre-existing/environmental — none reads a WP6 file; verified by grep). **No live Reddit call was made at any point.**

## 10. Known issues / deferred (no [TRANSITIONAL] markers in code)

1. **Live legs** (tester-owned): AC-R-1/AC-R-6 read-only probes; the supervised PAUSED create + PATCH-DELETED rollback; AC-R-13 live launch leg — all deferred to the orchestrator's live-fire window per dispatch.
2. **`admin-ad-create-campaign` has no reddit branch** (not in dispatch scope b). `platform:"reddit"` through the generic path fail-closes safely at the adapter (objective/creative-shape 422s). `redditCreateFullChain` is built and tested, ready for the builder wiring (#864 or a fast-follow).
3. **AC-R-27 batch reads**: sync uses WP1's per-entity `getStatus` loop (bounded, oldest-first) — list-endpoint batching is a follow-up if Reddit ad volume ever pressures the 400/60s pool. Cron cadence (30–60 min while PENDING) is dashboard/cron-owned, not in-repo.
4. **Community `suggestions` endpoint not implemented** — its query-param name is unpinned by research/PROOF (only `search?query=` is proven, R-P6). Implementing it would mean fabricating a param. Search alone serves the picker; suggestions can land after a 1-call live verification.
5. **Business lane**: env names (`REDDIT_ADS_MINGLABIZ_*`) fail-close until provisioned — by design (SPEC §0.2).

## 11. Operator action required

- **No migration. No `db push`.** Nothing to apply.
- **Edge deploy (from MERGED main, orchestrator-owned):** `admin-ad-connect`, `admin-ad-preflight`, `admin-ad-campaign-sync`, `admin-ad-campaign-action` — all `verify_jwt=true` preserved.
- **Before the first connect**, provision Supabase Edge Function Secrets (names only in repo/DB): `REDDIT_ADS_CLIENT_ID`, `REDDIT_ADS_CLIENT_SECRET`, `REDDIT_ADS_REFRESH_TOKEN` (minted with `duration=permanent`). Optional non-secret pins the pre-flight will assert when set: `REDDIT_ADS_BUSINESS_ID`, `REDDIT_ADS_ACCOUNT_ID`, `REDDIT_ADS_PROFILE_ID`, `REDDIT_ADS_PIXEL_ID`, `REDDIT_ADS_FUNDING_INSTRUMENT_ID` (live values in PROOF_LOG R-P2…R-P5; without pins the pre-flight discovers them — single-business accounts resolve unambiguously).
- **COMMS-0103**: CI is dead repo-wide (billing) — this branch's checks will be red at PR time for billing reasons, not code; all gates/suites are proven locally above. Re-run workflows after the billing fix.

## 12. Discoveries for Orchestrator

1. **G-1 gate is count-based, not per-builder:** deleting a SINGLE `configured_status: "PAUSED"` line passes the strict-grep gate (occurrence count 7 ≥ 6 create-endpoint refs; the PAUSED literal survives elsewhere). CI still catches it — the deno suite pins each builder byte-exact — but consider hardening the gate to per-builder structural checks at CLOSE.
2. **`adChannel.test.ts` test name is stale**: "registry: the four unbuilt adapters fail-close" still loops google+reddit; it passes only because both live adapters fail-close on missing env with `AdNotConnectedError`. Append-only forbids me touching it; cosmetic, but the tester should know why it's green.
3. **CreateAdInput widened** (additive-optional `clickUrl`/`utmCampaign`) — A4 governs the interface; flag for the A4 amendment record.
4. **utm_campaign chicken-and-egg**: SPEC §3.5 pins `utm_campaign=<ad_campaigns.id>`, but the DB row is persisted AFTER the platform create. `buildRedditAdBody` takes the value from the caller and omits the param when absent (never fabricates); the future create-fn wiring should pass `request_id` or patch post-persist.
5. **Ambiguities flagged (unpinned wire shapes, all fail-close in code):** carousel card item internals; `keyword_validations`/`geolocations_validations` request/response bodies (implemented `{data:{keywords|geolocations}}` + defensive `is_valid===false` scan + non-2xx verbatim); job-payload id field names (extractor checks 4 documented-plausible keys, fails close). One live probe each in the tester's window settles them.
6. **ALL-CAPS operationalization** (spec says "ALL-CAPS anywhere → hard-block" without defining "anywhere"): whole-text caps OR ≥3 consecutive shouted words = block; a single ≥4-letter shouted word = warn; ≤3-letter acronyms (NYC, VIP) pass. Test-pinned; amend if forensics wants a different line.
7. **Local gate sweep**: 14/371 strict-grep scripts fail locally — all pre-existing (missing `@babel/parser` in a fresh worktree, missing expo-export artifact) or pre-existing app-code findings in files WP6 never touched. None blocks this WP.

---

*Commits: `abcbf3d7f` (adapter + registry) · `aca341a82` (edge-fn lanes) · `94a81b380` (tests + CI) · `f819b76f0` (COMMS-0103 ack) · report commit follows. Next: orchestrator REVIEW → mingla-tester (AC-R-1…29 incl. the live-fire PAUSED create + rollback).*
