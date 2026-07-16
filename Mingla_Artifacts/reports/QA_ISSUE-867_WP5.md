# QA — ISSUE-867 WP5 (Snapchat channel — the fifth and final adapter)

**Tester:** mingla-tester+claude · **Date:** 2026-07-16
**Under test:** commits `d9e4959de..dacc81824` (pre-rebase) = `73a74067c` (adapter) · `3f5ddf718` (edge lanes) · `06f613c10` (tests) · `954809b92` (report) after this session's clean rebase onto `origin/main` (`4b60896b9`). Tester suite commit: `ba5a116d2`.
**Worktree:** `~/Desktop/mingla-orchs/issue-867-[snapchat-lane]/` on `issue-867-snapchat-lane`.
**Contract:** `SPEC_ISSUE-867_SNAPCHAT_GOOGLE_CHANNELS.md` body as corrected by **Amendment A1 (A1.1 + the A1.2 SNAP SECTION — binding)**; PROOF_LOG rows S-P1…S-P5 as live ground truth.
**Environment:** isolated local Supabase stack (project id `qa867snap`, shifted ports 56421/56422 — the parallel session's default-port stack untouched; the 6 duplicate migration prefixes temp-renamed **order-preserving, first-of-pair minus-1**, restored byte-identical, git-clean verified — COMMS-0102 factored; COMMS-0105 factored: zero `git stash` used). `supabase functions serve` in two env phases (secrets-absent, then real). Real engine credentials grep-to-env from master keys (values never echoed; env file 600-perm, shredded at session end). LIVE Snapchat legs against the real "Mingla Ads" account.
**Sim gate:** Phase 0.A **exemption — backend/edge-function-only** (zero UI surface; `git show --stat` confirms only `supabase/functions/**` + artifacts). The Snapchat-facing paths got REAL live fire anyway.
**Spend:** $0.00 — one chain, PAUSED at every level at every moment, deleted same-run. **Nothing was ever ACTIVE.**

---

## 1. Verdict

**PASS — 0 × P0 · 0 × P1 · 2 × P2 · 2 × P3 · 3 × P4** → routes to CLOSE (P2/P3 findings are follow-up candidates for the orchestrator, not blockers).

**THE PROFILE PROOF (headline): the UI-captured Public Profile WORKS.** The first-ever Snap creative create with `profile_properties.profile_id = 2cfbdc85-890c-43af-b393-10c0adbbad67` **succeeded live** (creative `1f367be4-…`, packaging `SUCCESS`). Snap-3 / A1.2-8's accepted residual risk is now retired — the trusted config is verified, and the launch-blocking unknown is CLOSED in our favor.

**THE GR-48 CASCADE TRUTH (settled live):** `DELETE /campaigns/{id}` **succeeds and cascades the ad squad AND the ad** (direct GETs on all three → HTTP 400 post-delete; list-after shows zero). **The creative does NOT cascade and CANNOT be deleted — Snap has no creative-DELETE verb at all: HTTP 405 "HTTP method is not supported for this endpoint."** Media has no DELETE route either (404). Residue after any failed create past the creative step is therefore **permanent and non-servable**; the adapter's residue-audit design is the correct and only possible behavior.

Regression gate: implementor happy-path suites present with BOTH fails-on-revert proofs **independently re-derived** (§4) + tester adversarial suite (24 tests, different angles, on-branch, in-diff, own fails-on-revert at a different line, §5) → **satisfied**.

---

## 2. SC-by-SC matrix (AC-S-* per A1.4 + dispatch legs)

Backend-only — single surface; parity automatic through the shared code path.

| AC | Criterion | Verdict | Evidence |
|---|---|---|---|
| AC-S-1 | connect mints from refresh token, validates account/funding, persists row; missing token → 424 + invalid row, zero create calls | **PASS (LIVE)** | Phase-1 (secrets absent): 424 + row `status=invalid`, `external_account_id='unconfigured'`, `last_error` persisted. Phase-2 (real secrets): 200 — account "Mingla Ads" **ACTIVE**, USD, America/New_York; funding CREDIT_CARD **ACTIVE**, `daily_spend_limit_micro=15,000,000,000` ($15k/day — exact S-P3 match); pixel `af5f8fc4-…` ACTIVE; `min_daily_budget_cents=500`; connection `extra` carries env **NAMES** only. Mint contract probed live via the adapter's own env resolution: `expires_in: 3600`, Bearer, both scopes — token length only, never echoed. |
| **Sentinel-absence heal (WP7 F-1 class)** | failed pre-secrets connect must not brick reconnect | **PASS (LIVE, end-to-end)** | 424-connect wrote the `unconfigured` sentinel → secrets landed → reconnect **healed to 200** with the real account id, `last_error: null`. The exact sequence that permanently bricked the TikTok lane (WP7 F-1) is FIXED in this adapter. |
| AC-S-2 (A1.4) | ONE campaign+squad+creative+ad, ALL PAUSED; S-1 key; S-2 map → `REMOTE_WEBPAGE`; S-3 allowlisted CTA; S-4 derived `delivery_constraint`; row carries both vocabularies | **PASS (LIVE)** | Live read-back of all four entities: campaign `objective_v2_properties.objective_v2_type=TRAFFIC` PAUSED; squad `delivery_constraint=DAILY_BUDGET`, `daily_budget_micro=5,000,000` EXACT, SWIPES, AUTO_BID, geos `us`, demographics `[{min_age:"18"}]` (strings) PAUSED; creative WEB_VIEW + BOOK_NOW + profile + canonical `https://business.usemingla.com/e/smokerhythm/vibe-check` + packaging SUCCESS; ad `type=REMOTE_WEBPAGE` (NOT SNAP_AD) PAUSED, `review_status=PENDING`. DB rows: `review_status=PENDING` + `review_detail.creative_review_status=PENDING_REVIEW` + delivery arrays. Idempotent replay (`request_id`) returned the SAME chain — list-after confirmed exactly one. |
| AC-S-3 (A1.4) | cents at rest; ×10,000 at ONE boundary; floors in MICRO after conversion; RT-5 | **PASS (LIVE + unit)** | Edge live: 499¢ → 422 `budget_below_minimum` ("converts to 4990000 micro — below 5000000"); 500¢ → live squad carries `daily_budget_micro=5,000,000` exactly. Tester T-1a/b/c: raw micro boundary 4,999,999/5,000,000 + 19,999,999/20,000,000; NaN/∞/0/negative/fractional-cents refused at the single conversion point. |
| AC-S-4 | non-public destination → 422 pre-write; valid → correct `dest_url` + smart link | **PASS (LIVE)** | Dead slug → 422 `destination_not_public`, zero provider calls (account listed empty after all probes). Valid → `dest_url` = canonical page (**never** the OneLink — D-P1; the OneLink is stored demoted in `dest_smart_link` only, confirmed absent from the on-Snap `web_view_properties.url`). |
| AC-S-5 (A1.4) | top-down launch; pause; audit rows; warning off BOTH vocabularies | **PASS (pause live; launch local-runtime)** | Pause fired live through `admin-ad-campaign-action` → 200, audit `pause` row. **Launch deliberately NOT fired (hard guard: nothing may ever be ACTIVE)** — warning matrix proven at unit level (implementor tests + tester T-8c precedence fuzz: REJECTED wins; APPROVED ad + PENDING_REVIEW creative still warns). |
| AC-S-6 | no orphans; compensating deletes; 502; residue audited | **PASS (local-runtime + GR-48 verbs live-proven)** | Mocked-wire: squad/creative/packaging/ad-step failures ALL roll back (implementor flow tests + tester T-4a/b/c per-level smuggles) with partial ids + residue in `ad_status_events`. Live: campaign DELETE works/cascades; creative DELETE **405 = the residue path is the permanent reality** (F-3). A live mid-chain failure was not forced (ONE-chain cap). |
| AC-S-7 | secrets unset → 424 everywhere, zero API calls | **PASS (LIVE + unit)** | Phase-1 connect AND create both 424 with zero Marketing-API calls (account list-after empty); RT-1 unit test re-run (calls===0 across all 7 adapter surfaces). |
| AC-S-8 | one mint/~60 min; re-mint after expiry; mint 4xx fails close | **PASS** | Unit cache tests re-run (2 resolves → 1 mint; reset → re-mint; 400 → fail-close); live mint `expires_in=3600` matches the 60-min window design; flow test: ONE mint across the atomic chain. |
| AC-S-9 | non-admin 403; RLS deny | **PASS (LIVE)** | Fresh non-admin user: edge fn → **403**; REST `SELECT` on `ad_connections`/`ad_campaigns`/`ad_status_events` → `[]` all. |
| AC-S-10 | no token leak | **PASS** | Strict-grep `issue-862-ad-token-env-server-only` green (+ self-test); DB sweep over `extra`/`provider_response`/`review_detail` → 0 token-shaped strings; serve logs → 0; connect/create responses inspected — ids and env NAMES only. |
| AC-S-11 | null profile → 424 `snapchat_profile_missing`, ZERO provider calls | **PASS (LIVE + unit)** | Connect step-4 fail-close verified in phase-1 wiring; tester T-6a/b at the ADAPTER: whitespace + non-string persisted profile with env unset → `snapchat_profile_missing` with **zero adsapi calls**. The profile-present path is now live-VERIFIED (the profile proof). |
| AC-S-12 | sync persists both vocabularies + reasons + delivery at all levels | **PASS (LIVE)** | `admin-ad-campaign-sync` on the live PENDING chain: `ads.review_status=PENDING`, `review_detail={review_status, creative_review_status: PENDING_REVIEW, delivery_status[…]}`, campaign `delivery_status` text, ad_set `external_status` — all three levels; audit `sync` row. Cron **scheduling** remains cross-channel (same accepted posture as WP2/WP6/WP7). Tester T-8a/b hostile fuzz on the mapper green. |
| AC-S-13 | SWIPES default; pixel goals 422 until `pixel_installed`; permitted goal carries `pixel_id` | **PASS (LIVE + unit)** | Live: `LANDING_PAGE_VIEW` → 422 `pixel_goal_unavailable` (pixel ACTIVE but events are #865's); live squad under SWIPES carries `pixel_id: null`. Wire-guard unit tests re-run. |
| Validate gate (WP2 §10) | `validate_only` → named-skipped-layers, ZERO adapter calls | **PASS (LIVE)** | Live: `validated:false` + 4 named skipped layers; account listed EMPTY afterward — nothing created. Adapter-level `snapchat_no_validate_only` refusal unit-verified. |
| Dispatch: review-poll vocabularies | sync through both vocabularies live + hostile mapper fuzz | **PASS** | Above + T-8a/b/c. |
| Dispatch: read-modify-write PUT | no `unknown field` rejection; no field loss | **PASS (LIVE)** | Pause → HTTP 200; full re-read: `objective_v2_properties`, `buy_model`, budget fields, targeting all byte-identical post-PUT. See F-4 for the server-added `objective` echo. |

---

## 3. Findings

### F-1 · P2 — S-2 map fails OPEN on prototype-chain creative types: the ad body goes onto the wire TYPELESS
- **Evidence (runtime probe):** `snapchatAdTypeForCreativeType("toString")` returns the inherited **function** `Object.prototype.toString` instead of throwing (`SNAPCHAT_CREATIVE_TO_AD_TYPE[key]` hits the prototype chain; `if (!adType)` — a function is truthy). Same for `constructor`, `hasOwnProperty`, `valueOf`. Downstream: `buildSnapchatAdBody(SQUAD, {name:"x", creativeExternalId:<uuid>, creativeType:"toString"})` → wire JSON `{"name":"x","ad_squad_id":…,"creative_id":…,"status":"PAUSED"}` — **the `type` key is DROPPED** (JSON.stringify elides function values). Snap then chooses the default ad type server-side — the exact delegation S-2 exists to forbid ("must fail closed, never default to SNAP_AD").
- **Reachability:** NOT reachable from the shipped edge branch (`admin-ad-create-campaign` pins `creativeType: "WEB_VIEW"` on both inputs). Reachable only by a future direct caller of `createAd`/the builders with attacker-influenced `creativeType` (the #864 builder is in flight).
- **Required fix:** guard with own-key lookup — `Object.hasOwn(SNAPCHAT_CREATIVE_TO_AD_TYPE, creativeType)` in `snapchatAdTypeForCreativeType` (`supabase/functions/_shared/snapchat.ts:719-730`).
- **Retest:** append a unit test asserting `toString|constructor|hasOwnProperty|valueOf` all throw `creative_type_unmapped`.

### F-2 · P2 — CTA validator crashes (raw TypeError) on prototype-chain creative types instead of a clean 422
- **Evidence (runtime probe):** `validateSnapchatCta("toString", "BOOK_NOW")` → `TypeError: allowlist.includes is not a function` (the allowlist map lookup returns the inherited function; the code then calls `.includes` on it). An unhandled throw class → 500, not the S-3 `invalid_cta` 422. `"__proto__"` happens to fail closed (probed).
- **Reachability:** same as F-1 — edge pins WEB_VIEW; adapter-interface callers only.
- **Required fix:** `Object.hasOwn(SNAPCHAT_CTA_ALLOWLIST_BY_CREATIVE_TYPE, creativeType)` in `validateSnapchatCta` (`_shared/snapchat.ts:678-699`).
- **Retest:** unit test asserting the prototype keys return `{ok:false, detail:"invalid_cta"}` and never throw TypeError.

### F-3 · P3 — GR-48 answered: `rollbackCreative` can NEVER succeed — Snap has no creative-DELETE verb; residue is permanent
- **Evidence (LIVE):** `DELETE /creatives/{id}` → **HTTP 405 "HTTP method is not supported for this endpoint"**; `DELETE /media/{id}` → 404 (no route). Campaign DELETE cascades squad+ad only.
- **Impact:** none functional — the adapter's throw→`creative_residue_id`-audit path (tested) is the permanent, only-possible behavior; residue creatives are non-servable. But the code comment ("the creative-delete surface is unverified pre-live-fire") and the flow-test framing ("creative DELETE fires") should be updated to the settled truth, and the atomic runner will pay one guaranteed-405 round trip per rollback.
- **Required fix (doc-grade):** update the `rollbackCreative` header + spec note to "no delete verb exists (live-proven 405, 2026-07-16); the DELETE attempt is kept as a cheap forward-compat probe and ALWAYS records residue." Orchestrator: record in the gap register.
- **Retest:** n/a (truth capture).

### F-4 · P3 — Snap's read-back adds server-owned fields the strip list doesn't cover; the RMW PUT echoes the deprecated legacy `objective` key back
- **Evidence (LIVE):** post-create campaign read-back carries a server-added `objective` key (the S-6 deprecated field — we never sent it; the flow tests prove the CREATE body is clean) plus `enable_targeting_expansion`/`auto_expansion_options` on the squad. `SNAPCHAT_READ_ONLY_ENTITY_FIELDS` strips neither, so the pause PUT echoed them. The live PUT **succeeded (200) and preserved every field** — no rejection today.
- **Impact:** latent — echoing the deprecated `objective` invites the exact translator behavior S-6 exists to avoid if Snap ever re-derives from it on update; harmless as observed.
- **Required fix:** add `objective` to `SNAPCHAT_READ_ONLY_ENTITY_FIELDS` (`_shared/snapchat.ts:1420-1428`).
- **Retest:** unit: strip removes `objective`; live: next launch/pause round confirms 200 + fields preserved.

### F-5 · P4 — Snap enables targeting EXPANSION by default on our squads
- **Evidence (LIVE):** squad read-back: `enable_targeting_expansion: true`, interest + custom-audience expansion `enabled: true` — server defaults we never sent. A geo+age-only squad will serve EXPANDED audiences.
- **Routing:** discovery for #864 (builder should surface/decide) and #884 (budget optimizer semantics). Spec is silent — not a WP5 violation.

### F-6 · P4 — circular-import TDZ: an entry module importing `_shared/snapchat.ts` before `_shared/adChannel.ts` crashes at init
- **Evidence:** `deno run` with snapchat.ts as first import → `ReferenceError: Cannot access 'snapchatAdapter' before initialization` at `adChannel.ts:519`. All six edge fns import `adChannel.ts` first — prod cold starts safe. Same structural trait for ALL five adapters (cross-channel, pre-existing class).
- **Routing:** discovery — worth a lint note or registry-late-binding refactor in a hygiene ORCH; any future edge fn/test that imports an adapter module first will crash at cold start.

### F-7 · P4 — praise
- The **sentinel-absence heal** (the WP7 F-1 bug class) is encoded from the start and proven end-to-end live — failed connect → secrets → reconnect heals. The validate gate is real (zero adapter calls proven by live list-after). The implementor's §12 battery-tooling hazard is real and correctly documented (exactly 4 passing tests carry `FAILED`/`WRITE_FAILED` in their names — verified). Money, PAUSED, and envelope contracts held every angle thrown at them.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proofs

At rebased HEAD (suites commit `06f613c10`, adapter content identical to `d9e4959de`):
- **#1 (S-2 map):** true line deletion of `WEB_VIEW: "REMOTE_WEBPAGE",` (`_shared/snapchat.ts:711`) → **`FAILED | 48 passed | 4 failed`**; `git checkout` restore → **`ok | 52 passed`**. Exactly the claimed counts.
- **#2 (PAUSED):** true line deletion of `status: "PAUSED",` in `buildSnapchatCampaignBody` (`:1025`) → **`FAILED | 50 passed | 2 failed`**; restore → **`ok | 52 passed`**. Exactly the claimed counts.

## 5. Tester adversarial suite

- **Path:** `supabase/functions/_shared/__tests__/issue867_wp5_tester_adversarial.test.ts` (NEW, append-only) — **24 tests, `ok | 24 passed | 0 failed`** — committed `ba5a116d2`.
- **Angles (beyond the 52):** raw-MICRO floor boundary + hostile numerics (T-1); CTA case/whitespace/NUL/cross-platform-enum evasion (T-2); `delivery_constraint`↔budget-field wire consistency incl. hostile `budget_mode` cast and never-both-fields (T-3); per-level envelope smuggles through the atomic runner — creative step 3-deep, packaging-poll GET (lowercase `failure`), ad step inside `paging` (mixed-case) — with compensating-delete assertions (T-4); S-2 fail-closed surface + exact 6-key own-surface (T-5); adapter-level profile-absent with ZERO adsapi calls (T-6); PAUSED wire fuzz across ABO/lifetime/CBO/TARGET_COST/promotion variants — no `"status":"ACTIVE"` ever on the wire (T-7); review-mapper hostile fuzz + warning precedence (T-8); strip-list completeness + unknown-sibling preservation + status-writer casts (T-9).
- **fails-on-revert (different line than the implementor's two):** true deletion of the CBO else-branch `body.delivery_constraint = "DAILY_BUDGET";` (`_shared/snapchat.ts:1167`) → **T-3c `FAILED | 23 passed | 1 failed`**; restored → **`ok | 24 passed`**.
- **Closing diff:** `git diff origin/main...HEAD --name-status` → all three snapchat test files **Added**, zero existing tests modified/deleted (append-only holds).

## 6. Constitution (14 rules)

| # | Rule | Verdict |
|---|---|---|
| 1 | No dead taps | N/A (no UI) |
| 2 | One owner per truth | PASS — ONE cents→micro boundary (`centsToPlatformBudget`); one connection row per platform×lane |
| 3 | No silent failures | PASS — fail-close everywhere; best-effort catches (read-back/sync) documented + repaired by sync; residue audited, never dropped |
| 4 | Query-key factory | N/A |
| 5 | Server state server-side | N/A |
| 6 | Logout clears | N/A |
| 7 | `[TRANSITIONAL]` labeled | PASS — zero markers (grep) |
| 8 | Subtract before adding | PASS — `failCloseStub` factory deleted with the last consumer |
| 9 | No fabricated data | PASS — explicit `unconfigured` sentinel; nulls stay null (`daily_budget_cents: null` under ABO) |
| 10 | Currency-aware | PASS — USD account verified live; cents at rest |
| 11 | One auth instance | N/A |
| 12 | Validate at right time | PASS — `start_time` defaults to now; duration/floors pre-call |
| 13 | Exclusion consistency | N/A |
| 14 | Persisted-state startup | N/A |

## 7. Device / parity matrix

| Surface | Result |
|---|---|
| Consumer iOS / Android | skipped — surface not shipped (backend-only engine) |
| Buyer/anonymous Web | skipped — read-only view reference; no code change |
| Business iOS / Android | skipped — not shipped |
| Admin Web | skipped — no UI in WP5 (SC-1…SC-8 = #864, same posture as WP2/WP6/WP7) |
| Business Web preview | skipped — not shipped |
| **Backend (edge fns + shared)** | **live-fire PASS** (legs: connect ×2 phases, preflight, 5 pre-write attacks, THE create, replay, pause/RMW, sync, cleanup, authz/RLS) |
| Physical iPhone HITL | N/A — no user-touchable surface |
| Edge deploy state | NOT deployed (correct — deploy is orchestrator-owned from MERGED main; the five fns in report §5 + `verify_jwt=true`) |

## 8. Live-fire evidence register (the ONE chain)

| Entity | Snap id | End state |
|---|---|---|
| Campaign | `af7975cc-3ccc-4e65-8a4c-94a009525d05` | DELETED (cascade origin; GET → 400) |
| Ad squad | `1d1c9399-f5cc-43f6-8cf1-4623f0a3433c` | DELETED via cascade (GET → 400) |
| Ad | `fabb78e9-93dc-4b17-98eb-d6efb53ed34f` | DELETED via cascade (GET → 400) |
| Creative | `1f367be4-74dd-457b-b468-1eb13bdccaec` | **PERMANENT RESIDUE** — no delete verb (405); non-servable; `review_status: PENDING_REVIEW` |
| Media | `a7c62666-6990-4c2d-851c-0729f46f45d5` | **PERMANENT** — durable #866 asset by design (delete route 404); READY |

List-after: `campaigns 0 · adsquads 0 · ads 0 · creatives 1 (the residue) · media 1`. **Nothing servable remains; nothing was ever ACTIVE; $0.00 spent.** Local DB rows died with the `qa867snap` stack (destroyed `--no-backup`); migrations + config.toml restored byte-identical (git-clean verified); secrets env shredded.

## 9. Full battery + gates (final commit `ba5a116d2`)

- `deno check` on all 7 product files + the tester suite: **clean**.
- Three snapchat suites together: **`ok | 76 passed | 0 failed`**.
- **Full `_shared/__tests__/` battery vs baseline** (structured result-marker extraction, NOT `grep FAILED` — the §12 hazard, which I verified is real: exactly 4 passing tests carry the token in their NAMES): worktree HEAD **1158 passed / 29 failed** vs `origin/main` baseline (temp detached worktree) **1106 passed / 29 failed** → **+52 passed, failure NAME SET IDENTICAL (21 FAILED + 7 cancelled, both sets byte-identical), zero snapchat tests in either set**. The 29-vs-33 delta vs the implementor's run is the documented `ticketCheckout` uncaught-error cancellation variance (identical on both sides).
- Strict-grep gates (+ self-tests): `issue-862-ad-token-env-server-only` ✓ · `issue-866-creative-guards` ✓ · `issue-862-reddit-configured-status-explicit` ✓.

## 10. Discoveries for Orchestrator

1. **GR-48 verb truth (F-3):** no creative-DELETE verb on Snap (405, live-proven); media delete route absent (404). Update the gap register + `rollbackCreative` doc; residue is permanent-by-platform, non-servable, audited.
2. **Profile proof retired the Snap-3 residual risk** — record in the A3 §D registry: snapchat/consumer GREEN end-to-end (create-chain proven, profile verified).
3. **Targeting expansion is ON by default server-side (F-5)** — feed into #864 builder UX + #884 optimizer assumptions.
4. **Adapter circular-import TDZ class (F-6)** — all five adapters; import-order landmine for future edge fns/tests; hygiene ORCH candidate.
5. **Process near-miss (self-reported):** one broad `pkill -f "supabase functions serve"` was issued before switching to PID-targeted kills; the parallel session's edge-runtime container was confirmed Up/unaffected. House rule reinforced.
6. **COMMS-ledger acks owed:** COMMS-0102/0104/0105 WARNs factored this session (raw-rename workaround, canonical-only destinations, zero stash); the dispatch's never-push guard means acks were not committed to `main` — orchestrator should append `mingla-tester+claude (ISSUE-867 WP5 QA)` to those `acked_by` columns at CLOSE.
7. **Deploy list for CLOSE:** the five `admin-ad-*` fns (§5 of the implementation report), `verify_jwt=true` preserved, deployed together from MERGED main.

## 11. Commits

- Under test (post-rebase): `73a74067c` · `3f5ddf718` · `06f613c10` · `954809b92` (pre-rebase: `d9e4959de` · `8f67aa237` · `d9b4005de` · `dacc81824`).
- Tester: `ba5a116d2` (adversarial suite) + this report's commit.
