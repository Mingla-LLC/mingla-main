# WP7-863 — TikTok channel implementation report

**ORCH/Issue:** #863 (child of #852 "[Full Rooms] Internal Ad & Reservation Engine") — WP7
**Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-863_TIKTOK_ADS_CAMPAIGN_ENGINE.md` body + **Amendment A1 (BINDING — A1 wins over the body)**, against the SPEC-862 A4-widened `ChannelAdapter` and the merged `_shared/{meta,google,adChannel}.ts` house idiom, grounded in `Mingla_Artifacts/research/ad-pipeline-2026-07-15/` (PROOF_LOG T-P1…T-P7 + D-P1; tiktok.md).
**Worktree:** `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/` on branch `issue-863-tiktok-ads-api` (rebased onto origin/main carrying merged WP1 + WP2 before any work).
**Code commit:** `5c78e36cc` · **Author phase:** mingla-implementor+claude · **Date:** 2026-07-15
**Status label:** implemented, partially verified (all pure logic + gate verification done locally; live TikTok legs are tester-owned and were NOT run — hard guard).

---

## 1. Summary (plain English)

The Ad Engine's TikTok channel now exists. `getAdapter("tiktok")` returns a real v1.3 Marketing-API adapter instead of the WP1 fail-close stub: it can build and fire campaign → ad group → ad creates (everything created paused at all three levels), launch/pause top-down, read back both TikTok statuses, update budgets under TikTok's published adjustment rules, upload images to the Asset Library, and resolve targeting countries against TikTok's LIVE region list — failing loudly (naming the country) when TikTok can't target it, which is GB today. `admin-ad-connect` and `admin-ad-preflight` gained full TikTok lanes. Until Seth sets the `TIKTOK_*` Supabase secrets, every path fail-closes with 424 `tiktok_not_connected` by design. No migrations, no deploys, no live platform calls.

## 2. SPEC success-criteria coverage (per the WP7 dispatch scope + A1 ACs)

| Criterion | How verified | Result |
|---|---|---|
| a) v1.3 client: `Access-Token` header, `code === 0` success contract, normalized `{code,message,request_id}` errors, token scrubbing | `tiktokApi` in `tiktok.ts`; deno check; error paths unit-covered indirectly (network legs unverified — no live calls) | ✓ `5c78e36cc` (wire legs UNVERIFIED — tester live-fire) |
| a) Everything `operation_status:'DISABLE'` at ALL THREE levels (A1.0-4/T-8, AC-2) | DISABLE fuzz across builder grid + hostile-injection test; **fails-on-revert by true line deletion** | ✓ PASS |
| a) Money: cents÷100 → dollars at the boundary; floors $20/day ad-group, $50/day CBO campaign, lifetime $20×days checked AFTER conversion (A1.0-1, AC-3) | unit tests incl. odd cents (2050¢→$20.50, 2001¢→$20.01), floor boundary tests, below-floor CBO build throws pre-call | ✓ PASS |
| a) `BALANCE_EXCEED` → 200 + warning, never silent clamp (A1.0-1) | `tiktokLaunchWarning` mapping tests (prefixed `CAMPAIGN_STATUS_BALANCE_EXCEED` + bare forms; healthy states → null); wired into `admin-ad-campaign-action` launch path | ✓ PASS |
| a) `bid_type` REQUIRED under CBO, `BID_TYPE_NO_BID` default; `bid_price` < BOTH budgets; CBO first-ad-group consistency (A1.1(b), AC-15) | CBO body always carries bid_type (fails-on-revert by line deletion); enum rejection; bid_price-vs-both-budgets tests; consistency validator test | ✓ PASS |
| a) UTC+0 schedule strings + bounds (≤12h past, ≤2028-01-01 start, ≤2038-01-01 end; dayparting 336×0/1) (A1.1(a), AC-16) | format/bounds/dayparting unit tests; V8 date-rollover hole (Feb 30 → Mar 2) caught by test and closed with a round-trip guard | ✓ PASS |
| a) Identity TT_USER only; CUSTOMIZED_USER hard-fail with explanatory error (A1.1(f), AC-12) | `assertTikTokIdentityAllowed` — CUSTOMIZED_USER → account-class error naming the 2026-01-15 cutoff; AUTH_CODE/BC_AUTH_TT → spark-fast-follow error; tests | ✓ PASS |
| a) `landing_page_url` = canonical dest_url, NEVER the OneLink; utm_params ≤14 (A1.0-5, AC-4 amended) | `go.usemingla.com` + `*.onelink.me` hosts hard-rejected (`landing_page_smart_link_blocked`); utm cap/key/value tests | ✓ PASS |
| a) LIVE `resolveGeo` via tool/region, fail-loud naming the country, numeric-only, ≤3,000, no-overlap (A1.1(e), AC-13) | pure picker fails loud on GB-absent payload (the proven T-P2 shape); location-id invariant tests; live fetch leg UNVERIFIED (no live calls) | ✓ PASS (fetch leg tester-owned) |
| a) Creative inline in ad create; `createCreative` = documented NO-OP (A1.0-2) | adapter method returns `{}`; test asserts no creative id ever emitted | ✓ PASS |
| a) Text validators: ad_text ≤100 no-emoji CJK×2; names ≤512 (A1.1(c), AC-14) | weighted-length tests (50 CJK pass / 51 fail; 100 Latin pass / 101 fail), emoji reject + `stripEmoji` strip tests, name cap tests | ✓ PASS |
| a) GAB placement gated (goal + geo-lock); TOPBUZZ/HELO deprecated (A1.1(l)) | placement gate tests | ✓ PASS |
| a) `PLACEMENT_TIKTOK` + `PLACEMENT_TYPE_NORMAL` defaults | ad-group builder default test | ✓ PASS |
| a) setBudget: ≤40% learning / ≤30% after / 2-day cadence as validation | pure `validateTikTokBudgetUpdate` tests; adapter reads live current budget + floors after conversion (live leg unverified) | ✓ PASS |
| a) setStatus/getStatus two-status read (operation_status + secondary) | status writer/reader map tests; DELETE inexpressible via setStatus (rollback-only) | ✓ PASS |
| b) Registry: stub replaced with the live adapter | `getAdapter("tiktok")` test + WP1's existing registry fail-close test still green (token resolves FIRST in every method) | ✓ PASS |
| b) admin-ad-connect tiktok lane (advertiser STATUS_ENABLE, identity, pixel, invalid-row on failure) | deno check clean; branch mirrors the Meta/Google QA-hardened shape (P2-3 lane-correct env names, P2-4 invalid-row upsert); runtime UNVERIFIED (needs secrets + deploy) | ✓ `5c78e36cc` (runtime tester-owned) |
| b) admin-ad-preflight tiktok lane: P1 STATUS_ENABLE · P2 balance-vs-floor amber · P3 identity AVAILABLE · P4 pixel-events amber · P6 live region check | deno check clean; P2/P4 are WARN (never hard fail — API blind to the payment portfolio; pixel is #865); P6 warns naming absent live markets (GB), fails only if US unresolvable | ✓ `5c78e36cc` (runtime tester-owned) |
| c) Tests append-only + fails-on-revert for DISABLE line and bid_type requirement | new file only; `git diff origin/main...HEAD --name-only` shows no test modified/deleted; both revert proofs below | ✓ PASS |

## 3. Files changed (commit `5c78e36cc`)

| File | Δ | What |
|---|---|---|
| `supabase/functions/_shared/tiktok.ts` | **NEW, 2,144 lines** | The full TikTok v1.3 ChannelAdapter + pure builders/validators/probes |
| `supabase/functions/_shared/__tests__/tiktok.test.ts` | **NEW, 813 lines, 38 tests** | WP7 happy-path suite (append-only) |
| `supabase/functions/_shared/adChannel.ts` | +2/−1 | Registry: `tiktok: tiktokAdapter` replaces the WP7 stub |
| `supabase/functions/admin-ad-connect/index.ts` | +194/−13 | TikTok connect/status branch; lane-correct default env var; stub gate narrowed to snapchat/reddit |
| `supabase/functions/admin-ad-preflight/index.ts` | +217/−4 | `tiktokPreflight` (P1–P6); stub gate narrowed; sweep includes tiktok |
| `supabase/functions/admin-ad-campaign-action/index.ts` | +24/−7 | Platform-aware launch warning: tiktok → `tiktokLaunchWarning`; **Meta branch byte-identical behavior** |
| `COMMS_LEDGER.md` | 4 rows | acks (see §12) |

## 4. Data-model changes applied

**NONE — by design.** WP7 reuses the WP1 generalized tables (`ad_connections`, `ad_campaigns`, `ad_sets`, `ads`, `ad_status_events`). TikTok's identity/pixel refs land in `ad_connections.extra` (A3 model): `identity_id`, `identity_type`, `identity_username`, `identity_available_status`, `pixel_id`, `pixel_activity_status`, `pixel_events_count`, `api_balance`, `events_env_var`, `api_version`. `min_daily_budget_cents` stays NULL for TikTok (no read API exposes it; floors are validated at create, after conversion). No `db push` needed.

## 5. Edge functions touched (deploy list — orchestrator/operator, from MERGED main)

| Function | verify_jwt (preserve) | Change |
|---|---|---|
| `admin-ad-connect` | `true` | + tiktok lane |
| `admin-ad-preflight` | `true` | + tiktok P1–P6 |
| `admin-ad-campaign-action` | `true` | + tiktok launch-warning mapping |
| `admin-ad-create-campaign` | `true` | **byte-untouched** (imports unchanged; redeploy only because `_shared/adChannel.ts` changed) |
| `admin-ad-campaign-sync` | `true` | **byte-untouched** (same `_shared` reason; tiktok flows through the generic adapter path; review_detail stays null for tiktok — reject-reason ingestion is a documented fast-follow) |

Deploy is NOT the implementor's; CI is dead repo-wide (COMMS-0103 billing) — manual CLI deploy from merged main if urgent, per that entry.

## 6. Regression tests added (append-only — no existing test modified or deleted)

- **Path:** `supabase/functions/_shared/__tests__/tiktok.test.ts` — 38 tests, all passing (type-checked run):
  `deno test --allow-env --allow-read supabase/functions/_shared/__tests__/tiktok.test.ts` → `ok | 38 passed | 0 failed`.
- **Fails-on-revert #1 (DISABLE):** TRUE LINE DELETION of `operation_status: "DISABLE",` in `buildTikTokCampaignBody` → `FAILED | 0 passed | 2 failed` (both DISABLE-fuzz tests); restored → `ok | 2 passed`. **fails-on-revert verified at `5c78e36cc`.**
- **Fails-on-revert #2 (bid_type-under-CBO):** TRUE LINE DELETION of `body.bid_type = spec.bidType ?? TIKTOK_DEFAULT_BID_TYPE;` → `FAILED | 1 passed | 3 failed` (bidding tests); restored → green. **fails-on-revert verified at `5c78e36cc`.**
- **Merged suites kept green:** ad-engine-scoped run (adChannel, meta, google, tiktok, issue862 WP1 tester+retest adversarial, issue867 WP2 flow+adversarial) → **`ok | 160 passed | 0 failed`** (type-checked, `--allow-env --allow-read`). Full `_shared/__tests__/` directory (`--no-check`, house convention — pre-existing type errors in unrelated `ticketPdf.ts` block a checked run): worktree `776 passed | 35 failed`; the 35 failures were proven a **strict subset** of origin/main's baseline failures (baseline extraction: `703 passed | 40 failed`; the only name-diff is a baseline-extraction artifact — a test that reads `supabase/migrations/`, which the supabase-functions-only extraction lacked). **Zero new failures.**
- **Strict-grep gates:** the ISSUE-862 ad-token gate passes (`16 token names, 7 client trees clean` — it already covered `TIKTOK_ACCESS_TOKEN` from WP1, so RT-3 needed no CI change). Full gate sweep: 17 failures, **identical list reproduced on the stashed pre-change tree** — all pre-existing, none in this lane.
- **WP1's registry fail-close test still passes with the live adapter** because the token resolves FIRST in every adapter method (mirrors Google's fail-close-first ordering).

## 7. Old → New receipts

### supabase/functions/_shared/tiktok.ts (NEW)
**Before:** did not exist; `getAdapter("tiktok")` returned a fail-close stub.
**Now:** the full v1.3 adapter: lane-correct env/token resolution (`TIKTOK_ACCESS_TOKEN` / `TIKTOK_MINGLABIZ_*`, advertiser-id mismatch guard), `tiktokApi` wrapper (Access-Token header, JSON-encoded GET params, `code===0`, AbortController 15s, token scrubbing), text validators (emoji detect/strip incl. ZWJ/flags/keycaps with ©®™ allowlisted; CJK×2 weighted length), UTC+0 schedule validation with 2028/2038 bounds + a V8 date-rollover round-trip guard + 336-char dayparting, budget floors after conversion + the 40%/30%/2-day adjustment validator, the 8-value objective enum + 16-value goal enum + billing/bid enums owned client-side, GAB/deprecated placement gates, numeric/≤3,000/no-overlap location-id invariants, live tool/region geo resolution failing loud by name, OneLink-host rejection + utm_params validation, TT_USER-only identity gate, pure body builders (all three levels DISABLE), UPLOAD_BY_URL image upload with timestamp-unique names capturing image_id AND material_id, two-status reads, ENABLE/DISABLE-only status writer with DELETE confined to `rollbackCampaign`, `tiktokLaunchWarning`, and connect/preflight probes (advertiser/identity/pixel).
**Why:** SPEC §4.3 as amended by A1 — the entire WP7 scope (a).
**Lines:** 2,144.

### supabase/functions/_shared/adChannel.ts
**Before:** `tiktok: failCloseStub("tiktok"), // WP7 (#863)`.
**Now:** `tiktok: tiktokAdapter` (+ import).
**Why:** scope (b) registry wire. **Lines:** 3.

### supabase/functions/admin-ad-connect/index.ts
**Before:** tiktok hit the fail-close stub 424.
**Now:** full tiktok branch — advertiser STATUS_ENABLE gate, TT_USER-identity requirement (`tiktok_identity_unavailable` 424), pixel snapshot (never a blocker), invalid-row upsert on every failure (QA P2-4), lane-correct `tiktokDefaultTokenEnvVar` (QA P2-3), connection row with BC as `external_org_id` and identity/pixel refs in `extra`; token never echoed.
**Why:** scope (b); SPEC §4.4(a) + AC-1. **Lines:** ~194.

### supabase/functions/admin-ad-preflight/index.ts
**Before:** tiktok was a stub row / 424.
**Now:** `tiktokPreflight` — P1 advertiser STATUS_ENABLE (hard), P2 API-balance-vs-$20-floor as WARN (API blind to the payment portfolio — T-P3), P3 TT_USER AVAILABLE (hard), P4 pixel zero-events as WARN (#865), P5 pass (app approved 2026-07-15 — T-P1), P6 live tool/region: US must resolve (hard), live-market absence (GB — T-P2) warns naming the market.
**Why:** scope (b). **Lines:** ~217.

### supabase/functions/admin-ad-campaign-action/index.ts
**Before:** launch warnings were Meta-only (`WARNING_STATUSES` + Meta message).
**Now:** platform-dispatched — `campaign.platform === "tiktok"` routes the read-back secondary status through `tiktokLaunchWarning`; the Meta branch's statuses and messages are unchanged.
**Why:** A1.0-1 — BALANCE_EXCEED must surface as 200 + warning through the launch path. **Lines:** ~24.

## 8. Cross-surface impact

| Surface | Affected? | Note |
|---|---|---|
| Consumer iOS / Android | No | back-office engine only |
| Buyer/anonymous Web | No | destination reference read-only (unchanged WP1 gate) |
| Business iOS / Android | No | — |
| Admin Web (`mingla-admin`) | **Not in WP7** | dispatch scope was adapter+registry+connect/preflight; the admin UI already calls the generic `admin-ad-*` fns — the TikTok channel appears there once #864's builder passes `platform:'tiktok'` |
| Business Web preview | No | — |
| **Backend (`supabase/functions`)** | **YES — the whole change** | parity automatic (single shared code path) |

## 9. Smoke result

No simulator/device surface exists (backend-only). Local verification: `deno check` clean on all 6 touched files; 38/38 new tests; 160/160 ad-engine suites; full-directory failure-set identical to origin/main; strict-grep failure-set identical to the pre-change tree; both fails-on-revert proofs by true line deletion. **No live TikTok call was made (hard guard — tester owns live legs).**

## 10. Known issues / deferred (no `[TRANSITIONAL]` markers in code)

1. **`admin-ad-create-campaign` has no tiktok branch yet (deliberately out of WP7 scope).** With the connection live, a tiktok create through the generic path still fail-closes structurally (Meta objective matrix → 422 `invalid_objective`; and `extra.minimum_budgets` is absent for tiktok → 424) — no malformed TikTok spend is reachable. The adapter + `createFullCampaignAtomic` are fully create-capable; the edge branch is the next WP (or #864's).
2. **Spark (AUTH_CODE) creation** — documented fast-follow (GR-50); the identity gate returns the explanatory error.
3. **SINGLE_VIDEO** — #866; the 5–60s POLICY duration validator ships now so the video path can't be built without it.
4. **`ad_review_info` reject-reason ingestion** (v1.3 `is_approved`/`reject_info[]`) — fast-follow; `getStatus` returns `issuesInfo: null` and sync stores no tiktok review_detail yet.
5. **setBudget cadence/learning state** — the 2-day/learning inputs are engine-owned; the adapter enforces the conservative 30% cap against the live-read budget when the caller passes no opts (extra optional param, interface-compatible). The pure validator is exported for the #884 optimizer.
6. **tool/region response-shape tolerance** — the parser accepts `region_info`/`regions`/`list` with `location_id|region_id` + `region_code`; the exact live field names could not be re-probed (no live calls) — tester should confirm one live `tool/region` read parses non-empty.
7. **Ad-group budget under CBO is OMITTED** per SPEC §4.4b step 4, though the MCP static schema marks `budget_mode`/`budget` required — TikTok docs say they are ignored under CBO; if TikTok's validation disagrees, the error surfaces verbatim (spec-is-law; flag for the live leg).
8. **Pre-existing repo noise (not mine):** `ticketPdf.ts` type errors block a type-checked full-directory test run; 35 `_shared` test failures and 17 strict-grep failures exist on origin/main.

## 11. Operator action required

- **No migration** (nothing to `db push`), **no config.toml change** (all five `admin-ad-*` blocks already registered).
- **Secrets (SPEC §7 as amended — the app is APPROVED and the token LIVE per T-P1):** set Supabase Function Secrets `TIKTOK_ACCESS_TOKEN`, `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_ADVERTISER_ID=7627974536397766673`, `TIKTOK_API_VERSION=v1.3`, `TIKTOK_GRAPH_BASE=https://business-api.tiktok.com`. Until then: 424 fail-close everywhere (by design).
- **Funding before live-fire:** $10 prepaid < the $20/day ad-group floor — top up the Advanced Payment Portfolio or launches park at BALANCE_EXCEED (surfaced as the warning).
- **Edge deploy** (orchestrator/operator, from MERGED main): the 5 functions in §5, `verify_jwt=true` preserved on all.
- **CI is dead (COMMS-0103 billing)** — do not read red PR rollups as code failures; local gate evidence is in §6.

## 12. Comms-ledger activity

- **COMMS-0103 (BLOCK→ACKNOWLEDGED):** factored — nothing merged, no CI relied on, all gates run locally.
- **COMMS-0102 (WARN, acked):** zero new migrations; flagged that the crawler-permissive-host constraint also binds TikTok's URL fetcher (10s timeout; Bunny reachability UNVERIFIED — pre-build check for #866 video).
- **COMMS-0100 / COMMS-0101 (WARN, acked):** minglabiz.onelink.me never used; smart-link hosts hard-rejected at the adapter boundary.

## 13. Discoveries for Orchestrator

1. **V8 silently ROLLS impossible calendar dates** (`Date.parse("2027-02-30T00:00:00Z")` → 2027-03-02, not NaN). My schedule validator now round-trip-guards it, but any OTHER code that validates a date by `!Number.isNaN(Date.parse(...))` has the same hole — worth a repo-wide sweep candidate.
2. **The `admin-ad-create-campaign` generic path is only ACCIDENTALLY fail-closed for tiktok** (Meta objective matrix + missing minimum_budgets). It should grow an explicit tiktok branch (next WP/#864) rather than rely on Meta-shaped validation to reject tiktok creates.
3. **The full `_shared/__tests__` directory cannot run type-checked** because of pre-existing `ticketPdf.ts` type errors (20 errors) — unrelated to the ad engine; a cleanup ORCH would restore `deno test` without `--no-check`.
4. **The anchor checkout's `main` (5a0a3ca90) is BEHIND origin/main** — observed while baselining; parallel sessions should `git fetch` before any ID-scan (existing memory rule confirmed live).
