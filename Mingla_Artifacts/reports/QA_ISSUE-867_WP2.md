# QA — ISSUE-867 WP2: Google lane of the Full Rooms Ad Engine

**Tester:** mingla-tester+claude · **Date:** 2026-07-15
**Worktree:** `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels` on branch `issue-867-snapchat-google-channels`
**Under test:** commits `a90ec252a..20ee24d16` (adapter + edge-fn extensions / tests + CI / report)
**Contract:** `SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` body + **Amendment A1 (binding — A1.3 G-1…G-14 + the PROVEN G-P3 reference body)** · `PROOF_LOG.md` G-P1…G-P3 · implementor claims in `WP2-867-GOOGLE-IMPLEMENTATION-REPORT.md` (all independently re-derived)
**Environment:** LOCAL Supabase stack (`supabase start`, Docker, full **335-migration** chain applied after **order-preserving** temporary local renames of the 6 duplicate version prefixes — restored byte-identical, git-clean verified; COMMS-0102 factored — **never the linked prod project**); `supabase functions serve` with the engine's real Google credentials from master keys (values never echoed, never committed, shredded at session end); direct read-only/remove-only Google Ads v24 calls for baseline/read-back/cleanup; a local **mock Google Ads server** via the `GOOGLE_ADS_API_BASE`/`META_GRAPH_BASE` env overrides for wire-capture, GR-52 auto-pause, and REMOVED-never attack legs (attacks never touched the real account).

---

## 1. Verdict

## **PASS — 0 × P0 · 0 × P1 · 0 × P2 · 4 × P3 · 3 × P4**

The Google lane survived live fire end-to-end. The exact wire body the edge function emits was captured byte-shape and matches the PROVEN G-P3 contract on every point; Google validated it clean (`validate_only`) with zero objects created; ONE real chain was created fully **PAUSED** (never ENABLED at campaign level at any moment), read back from Google's side, then set **REMOVED** in the same run — the account lists **zero servable campaigns** after. The GR-52 destination re-checker auto-paused a dead-destination campaign at runtime through the real sync function **for both Google and Meta** (channel-generic proven at the wire). The REMOVED-never guard held under 8 hostile runtime attacks and unit fuzz — no path ever put `REMOVED` (or any remove/update op) on the wire from launch/pause/sync. Fail-close held at runtime in all three directions (secrets unset → 409; broken refresh token → 424 + `invalid` row; business lane never borrows the consumer credential). Findings are P3/P4 observations only — nothing blocks.

Routing: **PASS → CLOSE (orchestrator).**

---

## 2. SC/AC matrix (A1.4 Google ACs — every row independently runtime/live-verified)

| AC | Verdict | Runtime evidence (this session) |
|---|---|---|
| **AC-G-1** — secrets unset → **409 `google_not_provisioned`**, zero Google calls | **PASS — runtime + unit** | Re-served with GOOGLE_ADS_* unset: connect → **409** with the §7 checklist detail; create → **409**; preflight → `not_connected`, P1 fail with the provisioning message. Unit: `resolveGoogleEnvConfig` throws with ANY of the six names missing; adapter connect/setStatus/getStatus/setBudget make **0 fetch calls** (implementor test independently re-run; my T-2 extends it to the business lane). |
| **AC-G-2 (connect)** — GAQL validation against customer `3623860476` (login-customer-id `8284700017`) + persisted row | **PASS — live** | `admin-ad-connect` → HTTP 200; live GAQL `SELECT … FROM customer` returned `ENABLED, testAccount:false, USD`; row persisted: `external_account_id=3623860476, external_org_id=8284700017, auth_kind=dev_token_oauth, token_env_var=GOOGLE_ADS_REFRESH_TOKEN` (env **NAME** only — secret-pattern grep over the row: **0 hits** for `GOCSPX`/`ya29.`/`1//`), `extra={api_version:v24, test_account:false, login_customer_id:8284700017}`. Preflight: **overall green** — P1 mint+dev-token pass, P2 ENABLED+non-test pass, P5 BASIC pass-by-proof, P6 live London/GB geo-suggest pass. |
| **AC-G-2 (create)** — ONE atomic `googleAds:mutate` (`partialFailure:false`) matching G-P3: temp-ID ordering, **G-14**, PRESENCE, PAUSED, search-only networks, RSA 3–15/2–4, PHRASE keyword, cents×10,000→micros | **PASS — wire-captured + live** | **Wire capture (mock base):** exactly ONE mutate; op order `budget(-1) → campaign(-2) → campaignCriterion → adGroup(-3) → adGroupAd → keywords(+negative)`; temp IDs negative + defined-before-referenced; campaign carries `status:PAUSED`, `advertisingChannelType:SEARCH`, `targetSpend:{}`, **`containsEuPoliticalAdvertising:DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`**, `geoTargetTypeSetting.positiveGeoTargetType:PRESENCE`, search-only `networkSettings`; budget `amountMicros:"20000000"` (2,000¢ ×10,000, int64 string) + `deliveryMethod:STANDARD`; ad group `ENABLED SEARCH_STANDARD, cpcBidMicros:"1000000"` (100¢); ad `PAUSED`, `finalUrls:[canonical /e/ page]`; keywords `PHRASE` (string input defaulted; explicit lowercase normalized); negative op `negative:true`; envelope `partialFailure:false`. Headers `Authorization: Bearer` + `developer-token` + `login-customer-id: 8284700017` on **both** the suggest and the mutate. **Live validate_only (real Google):** 200 `{validated:true, request_id:N11Aw4yZP7a-iZ1YBW3VUA}` — the exact captured shape validated **clean**; GAQL after: **zero new objects** (only the pre-existing REMOVED wizard `App-1`); **0 DB rows** in all four tables. |
| **AC-G-2 (persist path)** — external IDs incl. the `{ad_group_id}~{ad_id}` composite | **PASS — live, ONE chain** | Real create → `external_campaign_id=24040843582` (numeric), `external_adset_id=198459963277` (numeric), **`external_ad_id=198459963277~817014215929` (the composite)**; `targeting` jsonb persisted with `criterion_id:1006886 + canonical_name:"London,England,United Kingdom" + PRESENCE` (GR-37 resolver output); `dest_smart_link` = the tracking template (OneLink in the demoted, tracking-only slot); audit row `action='create'` carrying all external IDs + `budget_resource_name` + Google `request_id=G_57cDv8WLzcnIJJZoiOuA`. **GAQL read-back (Google's side):** campaign **PAUSED** (SEARCH, trackingUrlTemplate = the OneLink template), ad group ENABLED SEARCH_STANDARD, ad **PAUSED** with `finalUrls=[canonical page]`, geo criterion `1006886`, keywords PHRASE + negative `free`. Idempotent replay (same `request_id`) returned the SAME row, **no second Google create** (campaign list confirms exactly one QA campaign ever existed). Pause action → real `campaigns:mutate` `update.status=PAUSED, updateMask:"status"`; sync → `delivery_status PAUSED`, G-3 dual vocabulary persisted (`review_detail={approval_status:UNKNOWN, review_status:REVIEW_IN_PROGRESS}`). |
| **AC-G-3** — destination re-checker auto-pauses + audit row; channel-generic | **PASS — runtime through the real sync fn** | Mock-base leg: cancelled the destination event; seeded ACTIVE google + **meta** campaign rows; ran `admin-ad-campaign-sync`. BOTH auto-paused: google wire = `campaigns:mutate {update:{…,status:"PAUSED"},updateMask:"status"}` with the full header trio; meta wire = `POST /{id} {status:"PAUSED"}`. DB rows → PAUSED; audit rows `action='pause', from ACTIVE → PAUSED, provider_response.reason='destination_not_public'` for **both platforms** (3 rows total). Blast check over every recorded request in the leg: `REMOVED` appears **nowhere**; no `remove` op key anywhere. Unit: checker uses the EXACT create-time gate (view names + `scheduled|live` filter); unknown/case-variant page types fail closed with zero queries (T-6b); my T-6c source trap fails CI if the re-check ever gets platform-gated. Bonus read-side proof: after the real REMOVED cleanup, a live sync mapped Google `REMOVED` → engine `DELETED` at all three levels with `delivery_status=REMOVED`. |
| **AC-G-4** — no launch/pause/sync path can emit `REMOVED` | **PASS — unit + adversarial + runtime** | Implementor's hostile-cast unit re-run; my T-5 widens to 8 hostile strings (incl. platform vocabulary `ENABLED`, lowercase, `DELETED`, padded) through the writer AND the per-level operation builder — all throw; T-5b proves adapter.setStatus with a hostile cast makes **ZERO** mutate wire calls; T-5c proves an atomic create carries ONLY `create` ops. Runtime: 8 hostile `action` values (`remove`, `REMOVED`, `delete`, `DELETED`, `archive`, object, null, array) against `admin-ad-campaign-action` → all **400 `action_invalid`** with **0** wire calls reaching the mock. Session-wide: nothing was EVER `ENABLED` at campaign level on the real account (created PAUSED atomically → paused → REMOVED). |
| **Fail-close 424 (broken token)** | **PASS — runtime** | Served with a garbage `GOOGLE_ADS_REFRESH_TOKEN`: connect → **424 `google_not_connected`** AND the row flipped `invalid|false` (verified in DB); reconnect with the real env → `connected|true` restored, still exactly 1 row (upsert idempotent). Create on the invalid row → 409 per the spec's Google exception (see P3-1). |
| **Mixed-lane guard (QA P2-3 parity)** | **PASS — runtime + unit** | Business-lane connect with only consumer secrets set → **409 `google_not_provisioned`**, NO business row written (DB: only the consumer row exists). Unit T-2/T-2b: business default env NAME is `GOOGLE_ADS_MINGLABIZ_REFRESH_TOKEN`; a business connection row fail-closes with zero wire calls even with consumer secrets fully set; business-set + consumer-unset resolves business names only (no reverse bleed; dashes stripped per-lane). |
| **Authz (AC-S-9 analogue)** | **PASS — runtime** | connect/create: no JWT → **401**; non-admin JWT → **403**. (Full RLS matrix was live-proven in WP1 QA on the same tables — unchanged here, no schema diff in WP2.) |
| **Token hygiene (SC-SEC-1)** | **PASS** | No secret value in any DB row (pattern grep 0 hits), any edge response captured this session, or the committed diff (`GOCSPX`/`ya29.`/`1//` grep over `git diff`: **0**). Bearer-header-only transport verified at the wire (T-1 + mock capture); mint call carries no developer token; `ya29.`/`1//` scrub unit-proven incl. inside detail messages (T-10). |

---

## 3. Findings

### P3-1 — Google create maps a broken-token connection to 409 `google_not_provisioned` (spec-mandated, but SC-7 UX will misname the failure)
- **Evidence:** `admin-ad-create-campaign/index.ts:329-331` — `!gconnRow || !gconnRow.connected || gconnRow.status !== "connected"` → 409. Runtime: after the broken-token connect flipped the row to `invalid`, create returned **409 `google_not_provisioned`** though the real condition is a revoked token (connect itself correctly said **424 `google_not_connected`**).
- **Impact:** the admin UI's SC-7 "not provisioned" checklist renders for a broken-token state; an admin may re-seed secrets that are already present instead of re-minting the refresh token. Zero spend risk (fail-close either way).
- **Why not higher:** SPEC §4.4(b) literally pins "Google → 409 `google_not_provisioned`" for the not-connected create state; the implementation is contract-compliant. This is a spec-level UX truthfulness wrinkle.
- **Required fix (conductor decision, not REWORK):** either differentiate (row `status='invalid'` → 424 on create) via a spec amendment, or have #864's Google tab read the connection row status and caption accordingly.
- **Retest:** create on an `invalid` row returns/renders the broken-token message.

### P3-2 — GR-52 fail-open catch swallows ALL destination-read exceptions and reports `destination_ok: true`
- **Evidence:** `admin-ad-campaign-sync/index.ts:239-241` — `catch { destinationOk = true; }`; the synced output row then carries `destination_ok: true` for a state that is actually *unknown*. T-6 documents that the shared checker itself propagates (the policy lives here).
- **Impact:** a persistently throwing view read (not just a transient hiccup) leaves a dead-destination campaign ACTIVE indefinitely, with the sweep output claiming the destination is fine and no audit trace that the check was skipped. Bounded by: the next sweep retries; a *definitive* not-public read still pauses.
- **Required fix:** report the tri-state honestly (`destination_ok: null` / `destination_check: "skipped_read_error"`) and count skips in the response so a cron/UI can alert on repeated fail-opens. Fail-open behavior itself may stay (deliberate, documented).
- **Retest:** a throwing view read yields a `skipped` marker in the sync output, not `true`.

### P3-3 — The disabled sequential `createCampaign/createAdSet/createAd` stubs resolve their fail-close env check with default (consumer) lane names for the non-row secrets
- **Evidence:** `_shared/google.ts:1130-1146` — `resolveGoogleEnvConfig(conn)` without the lane argument (defaults `"consumer"`), so for a business connection the developer-token/client-id/secret presence checks read the CONSUMER names (the refresh-token name still comes from the row, which fail-closes correctly today — proven in T-2).
- **Impact:** none reachable — all three methods throw `google_atomic_create_only` immediately after, and every real path (`resolveGoogleClient`) is lane-correct. Latent inconsistency only.
- **Required fix (cheap):** pass `conn.lane` — `resolveGoogleEnvConfig(conn, conn.lane)` — in the three stubs.
- **Retest:** T-2 keeps passing; a business conn with consumer-only env throws `google_not_provisioned` from the stubs for the *right* reason.

### P3-4 — Pre-existing duplicate-migration-prefix hazard (COMMS-0102) still open; this QA re-proved and refined the workaround
- **Evidence:** `supabase start` on the untouched tree still dies on the 6 duplicate versions. This session proved an **order-preserving** rename scheme (move the alphabetically-FIRST file of each pair one second EARLIER — e.g. `20261117000000_orch_1186b_…` → `20261116235959_…`) applies the full 335-file chain cleanly. Note: the naive "bump the second file later" scheme **breaks dependencies** (proven: `20260612000001_tr4_revoke_rpc_anon_grants.sql` verifies ACLs of functions created in `tr4_refund_tiers` at the duplicate version; `20261117000001` depends on the column added by `orch_1188_orders_event_date_id`).
- **Routing:** re-affirms WP1 QA D-1 — the hygiene ORCH should use the order-preserving direction when renaming on main.

### P4-a (praise) — The atomic create is genuinely bulletproof
The wire-captured body matched G-P3 byte-shape on the FIRST capture; the same body validated clean against real Google on the first live shot; zero-fabrication holds (T-9: a lying/partial 200 payload refuses to return ids rather than persist garbage); the idempotency key prevented a duplicate chain at runtime.

### P4-b (praise) — REMOVED-never is enforced at four independent layers
Type system (`AdvertiserStatus`), exhaustive-switch writer (hostile-cast throw), edge-fn action allowlist (8/8 hostile values → 400, zero wire calls), and now a CI blast test that no create/update request can carry `REMOVED` or a `remove` op.

### P4-c (note) — `GOOGLE_ADS_API_BASE` / `META_GRAPH_BASE` env overrides exist and are load-bearing for QA
They enabled full wire capture and safe GR-52/attack legs. House pattern (WP1 precedent). If a value ever lands in prod Function Secrets pointing elsewhere, all traffic silently redirects — worth a strict-grep/ops note someday; not a WP2 defect.

---

## 4. Live-fire evidence log (compact; secrets redacted throughout)

- **Baseline (read-only):** mint 200 (`expires_in 3599`); GAQL customer `3623860476` → ENABLED, `testAccount:false`, USD; campaign inventory = exactly one REMOVED wizard campaign `App-1 24039386311` ($0 spend — matches PROOF_LOG G-P3's list-after).
- **Leg 1 connect/preflight:** §2 rows AC-G-2(connect); 401/403 checks; secret-grep over row = 0.
- **Leg 2 validate_only:** mock wire capture (full body in §2) → real validate_only 200 clean, `request_id N11Aw4yZP7a-iZ1YBW3VUA`; GAQL after = no new objects; DB after = 0/0/0/0.
- **Leg 3 real chain:** create 200 → IDs `24040843582 / 198459963277 / 198459963277~817014215929`; GAQL read-back campaign PAUSED / ad PAUSED / ad group ENABLED / geo 1006886 / PHRASE keywords + negative; idempotent replay true; pause wire PAUSED; sync → G-3 review_detail. **Cleanup:** bottom-up `remove` ops (ad → adGroup → campaign → budget), each 200; **`SELECT campaign WHERE status != 'REMOVED'` → `[]` (zero servable campaigns)**; ad group + ad read back REMOVED; final sync mapped the row set to DELETED. **Exactly ONE chain existed; nothing was ever ENABLED at campaign level.**
- **Leg 4 GR-52 (mock base):** §2 AC-G-3 row — google + meta auto-pause wires + 3 audit rows, REMOVED absent from every recorded request.
- **Leg 5 attacks:** 8 hostile actions → 400, 0 wire calls; hostile status fuzz unit-level (T-5/T-5b/T-5c).
- **Fail-close matrix (runtime):** env-unset → 409/409/preflight-fail · broken token → 424 + `invalid|f` row · reconnect → `connected|t` · business lane w/ consumer secrets → 409, no row.

## 5. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

Claimed at `a90ec252a` (tests `f9fcc65d7`). **Re-derived on this checkout by TRUE line deletion:**
1. Deleted `containsEuPoliticalAdvertising: GOOGLE_EU_POLITICAL_ADVERTISING_VALUE,` (google.ts:703) → the G-14 test **FAILED** (`0 passed | 1 failed`); restored → green.
2. Deleted the campaign `status: "PAUSED",` line (google.ts:694) → the G-P3 PAUSED test **FAILED** (`0 passed | 1 failed`); restored → 34/34 green, working tree clean.
Claims confirmed.

## 6. Tester adversarial test (added, on-branch, in-diff)

- **Path:** `supabase/functions/_shared/__tests__/issue867_wp2_tester_adversarial.test.ts` — **18 tests (T-1…T-10)**, all green; full suite `134 passed | 0 failed`.
- **Different angles than the implementor's 41:** header trio on EVERY Google Ads call surface (6 calls asserted, incl. setBudget's two-step wire and the mint's header isolation) · mixed-lane env fail-close both directions · micros overflow THROUGH the builder at the exact MAX_BUDGET_CENTS boundary + NaN/Infinity/non-integer fuzz · finalUrls/tracking swap traps + the 2,084-**BYTE** boundary with multi-byte UTF-8 + hostile schemes + an `--allow-read` source trap on the edge fn (finalUrl only from the view-resolved dest_url; no caller-supplied final/tracking override readable) · REMOVED-never hostile strings (incl. platform-vocab `ENABLED`) through writer AND operation builder + zero-wire-call proof + create-ops-only blast · GR-52 checker throw-propagation + exact page-type matching + a channel-generic source trap on the sync fn · RSA/keyword exact-boundary PASS sides · mutate-response zero-fabrication · composite-id GAQL-injection guard · normalizeGoogleError garbage resilience + later-detail requestId + detail-message scrubbing.
- **fails-on-revert (different line than the implementor's G-14/PAUSED):** true line-deletion of `"login-customer-id": client.loginCustomerId,` (`_shared/google.ts:297`, the googleAdsRequest header) → **T-1 FAILED** (`1 passed | 1 failed` in filter); restored → 18/18. `fails-on-revert verified at 20ee24d16 (working-tree line-deletion, restored, git-clean verified)`.
- **CI wiring:** appended to the `ad-engine-deno-tests` job's `DENO_TEST_FILES` (append-only; `--allow-read` already present for the WP1 source traps). Both the implementor's suites and this file are visible in `git diff origin/main...HEAD --name-only`.

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | No UI ships in WP2 (backend-only; admin google tab is #864) |
| 2 | One owner per truth | PASS | Cents at rest; ONE ×10,000 boundary (`centsToPlatformBudget`); status owned by edge fns; tracking template built server-side only (T-4c) |
| 3 | No silent failures | PASS (P3-2 noted) | Typed 4xx/5xx everywhere; audit rows on create/pause/sync/create_failed; the one deliberate fail-open (GR-52 read error) is documented but under-reported — P3-2 |
| 4 | One query key per entity | N/A | No React Query surface |
| 5 | Server state server-side | PASS | No client state in scope |
| 6 | Logout clears everything | N/A | No auth-state change |
| 7 | `[TRANSITIONAL]` labeled | PASS | None needed; WP-deferred stubs are explicit 424s |
| 8 | Subtract before adding | PASS | Google branch reuses shared validators/gates; Meta path byte-identical (diff-verified) |
| 9 | No fabricated data | PASS | validateOnly returns empty ids (runtime + unit); partial mutate payload refuses (T-9); `buildGoogleReviewDetail` returns null, never `{}` |
| 10 | Currency-aware | PASS | cents bigint at rest; int64-string micros on the wire; account USD read live |
| 11 | One auth instance | PASS | One service-role client per fn; gateway JWT + in-code admin gate (verify_jwt=true ×5 in config.toml) |
| 12 | Validate at the right time | PASS | All 422 validators pre-call (runtime-proven order: RSA/keywords/geo/destination before any mutate) |
| 13 | Exclusion consistency | PASS | Create gate and GR-52 re-check use the SAME view + `scheduled|live` filter (unit-pinned to exact names) |
| 14 | Persisted-state startup | N/A | No hydration surface |

## 8. Device / parity matrix

| Surface | Result |
|---|---|
| Consumer iOS / Android | **skipped — does not ship there** (zero `app-mobile` diff) |
| Buyer/anonymous Web | **skipped — read-only reference** (views SELECTed only; zero code diff) |
| Business iOS / Android / Web preview | **skipped — zero `mingla-business` diff** |
| Admin Web | **skipped — zero `mingla-admin` diff in WP2** (google tab renders the 409 checklist from edge responses; SC-7→connected flip is #864) |
| Backend (local stack + real Google Ads v24) | **live-fire PASS** per legs 1–5 |
| Physical iPhone HITL | **N/A** — no mobile surface ships in WP2 |
| Edge-fn live deploy state | **N/A by design** — nothing deployed (dispatch hard guard); `config.toml` carries all five `verify_jwt = true` blocks (verified) |

**Phase 0.A exemption:** backend/edge-function-only scope — source+local-runtime sufficient; the Google-facing paths got REAL live fire anyway (read-only + validate-only + one PAUSED chain REMOVED in the same run, residual zero-servable).

## 9. Discoveries for Orchestrator

- **D-1:** the account now carries a second terminal REMOVED campaign — `24040843582` "QA-867 Persist Proof (PAUSED)" ($0 spend, 0 impressions, created PAUSED → REMOVED same run) alongside the pre-existing `24039386311` "App-1". Recorded for audit; nothing servable remains.
- **D-2:** the **order-preserving** duplicate-migration rename direction (P3-4) — move the alphabetically-first file of each pair EARLIER — is the safe recipe for the COMMS-0102 hygiene ORCH; the "bump-later" direction provably breaks two dependency chains (`tr4_revoke_rpc_anon_grants`, `orch_1188_finalize_persist_event_date_id`).
- **D-3:** account `3623860476` has an empty `descriptive_name` — connect's display_name renders without the account-name parenthetical. Cosmetic; a 1-min Ads-UI rename fixes it.
- **D-4:** COMMS-0100 + COMMS-0102 acks appended to this branch's ledger copy (push forbidden by dispatch hard guard) — carry to main at CLOSE.
- **D-5:** P3-1/P3-2/P3-3 are candidates for a small follow-up ORCH or #864 absorption — none blocks CLOSE.

## 10. Accepted conditions

None required — verdict is PASS with no P1/P2.

## 11. Session hygiene / residuals

- Local stack: `supabase stop --no-backup` executed; `supabase/.branches/` scratch removed; migration renames restored **byte-identical** (git-status clean on `supabase/migrations/`).
- Credentials: extracted by script from master keys directly into scratchpad env files (values never printed — name/length echo only); all env files + JWTs + the one access-token temp file **overwritten with random bytes and deleted** at session end; committed diff secret-grep = 0 hits.
- Google account state after session: **zero servable campaigns** (`WHERE status != 'REMOVED'` → empty); the QA chain fully REMOVED (campaign, ad group, ad, budget — each verified by read-back); **nothing was ever ENABLED at campaign level at any moment**.
- Mock server + all `supabase functions serve` sessions stopped; the 3 non-Supabase Docker containers belonging to other sessions were never touched.

---

**Routing:** PASS → **CLOSE (orchestrator)**. P3-1/P3-2/P3-3 to the conductor as optional follow-ups (P3-1 is a spec-semantics decision; P3-2/P3-3 are two-line hardenings); P3-4/D-2 feeds the COMMS-0102 hygiene ORCH.
**Working tree:** `~/Desktop/mingla-orchs/issue-867-snapchat-google-channels` on branch `issue-867-snapchat-google-channels`.
