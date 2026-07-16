# QA — ISSUE-916 WP6 · Reddit Ads Channel

**Verdict: FAIL** — P0: 0 · **P1: 1** · P2: 1 · P3: 2 · P4: 3
**Tester:** mingla-tester+claude · **Date:** 2026-07-15
**Worktree:** `~/Desktop/mingla-orchs/issue-916-[reddit-ads-channel]` · branch `issue-916-reddit-ads-channel` · HEAD at QA start `bb68dbe0c` (code `abcbf3d7f`, lanes `aca341a82`, tests `94a81b380`)
**Binding contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-REDDIT_CHANNEL.md` (AC-R-1…29)
**Claims attacked:** `Mingla_Artifacts/implementation/WP6-916-IMPLEMENTATION-REPORT.md`

**Environment:** (1) LIVE read-only leg — the engine's real Reddit credentials grep-to-env'd from master keys (values never echoed, never committed), driven THROUGH THE ADAPTER'S OWN code paths (`reddit.ts` mint/transport/preflight/search) behind a recording fetch wrapper that hard-throws on any non-GET except the token-mint POST — **zero creates, zero PATCHes, 16 calls total, methods used = {GET, POST(mint only)}**. (2) LOCAL Supabase stack (`supabase start`, full migration chain after order-preserving temp renames of the duplicate prefixes — **COMMS-0102 factored; the collision has CASCADED to 14 files** — restored byte-identical, git-clean verified) + `supabase functions serve` with **dummy credentials** against a scenario-switched local mock Reddit server (`REDDIT_ADS_API_BASE`/`REDDIT_ADS_TOKEN_URL` overrides). The real credential never traveled to the mock; the dummy credential never traveled to Reddit. (3) CI-parity deno suites + strict-grep gates. Phase 0.A sim gate: **exempt — backend/edge-function/CI-only WP, no UI surface.**

**COMMS ledger:** COMMS-0103 (BLOCK, ALL) factored — no merge/push attempted; all gates run locally as the proof; ack rides this branch. COMMS-0102 (WARN, ALL) factored — see cascade note in Discoveries.

---

## 1. What the live reads PINNED (the dispatch's open questions)

| Question | Live answer | Evidence |
|---|---|---|
| `expires_in` read from response, not hardcoded | **YES — implied TTL 86400** (adapter cache expiry = now + 86400 − 300s, via `peekRedditTokenExpiryForTests`); mint 200 with scope `adsread adsedit` | probe P1 |
| UA on the mint + every call | **YES — all 16 live calls carried the adapter constant UA**, incl. the mint (Basic auth present on mint) | probe P1 + UA sweep |
| Mint cache reuse | `resolveRedditClient` after mint performed **zero additional mint calls** | probe P1_cacheReuse |
| `/me` | `t2_2ikkjswp3a` | P2 |
| Business | `950c8eac-da26-45e6-942e-645ed657e43f` "Mingla" (sole business) | P3 |
| Ad account | `a2_jcfwvnfcfqcs`, `SELF_SERVE`, `currency USD`, **`admin_approval: VALID`**, tz America/New_York | P4 |
| Profile | `t2_2ikkjswp3a` "usemingla" | P5 |
| Funding | `1889187`, **`is_servable: true`**, `reasons_not_servable: []`, credit_limit 100,000,000 micro ($100), USD | P6 |
| Pixel | id **== the ad-account id** (`a2_jcfwvnfcfqcs`) — R-P3 re-confirmed live | P7 |
| Full 7-step preflight through `redditConnectPreflight` | Snapshot **exactly matches every SPEC §0.4 pin** (AC-R-1 read half) | P8 |
| Community search `query=london` through `redditSearchCommunities` | 200, **12 London-relevant rows** (r/london `t5_2qkog` first — proves real search, not the popular-list no-op); payload shape `{data[], pagination}`, row keys `{categories, description, icon_url, id, name, subscriber_count}` — **the adapter's parser handles the real payload**; second call `fromCache=true` with **zero extra fetches** (≥24 h cache discipline live-proven) | P9 |
| Live `RateLimit` header shape | `"ads-targeting-taxonomy";r=99;t=3` — **parsed correctly** by `parseRedditRateLimitHeader` (remaining 99, reset 3s) | P9 |
| **Suggestions endpoint param** | **CANNOT BE PINNED BY READS — and the endpoint is a silent-no-op trap.** `GET /targeting/communities/suggestions` returns **200 with account-seeded generic interest rows** (webdev, marketing, analytics…) for NO params, `query=london`, `communities=london`, AND a junk param — it silently ignores everything we send. It is **account-seeded, not city-seeded**: SPEC §4.4's "seed suggestions from the destination city" does **not** match live behavior. The implementor's refusal to implement it (report §10.4) is **validated and upgraded**: implementing any param today would ship a silent-wrong-results bug of exactly the `q=` class. | P10 (4 probes) |
| Live rate-limit pools observed | business-manager 100/60s · campaign-management-read 400/60s · **funding-instruments 30/60s** · **conversion-signals 30/60s** · targeting-taxonomy 100/60s — two pools are TIGHTER than the SPEC's "tightest = 100/60s taxonomy" claim (no impact today: connect/preflight make 1 call each; see D-4) | header sweep |

Raw probe output: scratchpad `live_probe_out.json` (session-local; key values reproduced above).

## 2. SC-by-SC matrix (AC-R-1…29)

| AC | Verdict | Evidence (runtime unless noted) |
|---|---|---|
| AC-R-1 connect mint + `/me` + row upsert with captured ids | **PASS** | LIVE: mint→`/me`→ids exact through the adapter (probe P1–P8). LOCAL STACK: happy connect → HTTP 200, DB row `connected/true/a2_jcfwvnfcfqcs`, `extra` = profile+funding+pixel+scopes+env-var names (§1.4 exact), `currency USD` |
| AC-R-2 TTL from `expires_in`; no 3600 literal | **PASS** | LIVE implied TTL 86400; unit 86400→~86100s & 3600→~3300s; source trap green |
| AC-R-3 UA on EVERY request incl. mint | **PASS** | LIVE: 16/16 calls carried the constant (incl. mint); unit transport capture |
| AC-R-4 fail-close per-step 424s + verbatim reasons | **PASS** | LOCAL STACK (clean state per scenario): mint-fail→424 `reddit_not_connected`+invalid row · no-business→424 · no-profile→424 **`reddit_profile_missing`** · funding→424 **`reddit_funding_not_servable`** + `reasons_not_servable:["CREDIT_CARD_NOT_APPROVED","CREDIT_LINE_EXHAUSTED"]` verbatim · no-pixel→424; business lane missing secrets→424 (no consumer fallback); unit zero-fetch leg green |
| AC-R-5 `^(t2\|a2)_` — never assumes a2_ | **PASS** | unit regex + preflight pick; live account a2_ |
| AC-R-6 non-8-enum currency → invalid + reason | **PASS** | LOCAL STACK: NGN → 424 with the GR-72 message naming the enum + row `status='invalid'`; LIVE: real account USD ∈ enum. (Reason not persisted on the row — P3-2) |
| AC-R-7 campaign body PAUSED/objective-map/funding/CBO-false/`{data}` wrap | **PASS** | unit + LOCAL STACK PATCH bodies observed `{"data":{…}}`-wrapped on the wire |
| AC-R-8 unconditional `conversion_pixel_id` | **PASS** | unit combo sweep + **Step 0.5 re-derived fails-on-revert** (§4) |
| AC-R-9 CBO cross-rule 422s (all six) | **PASS** | unit battery |
| AC-R-10 money G-3 + low-budget 400 verbatim | **PASS** | G-3 green + ADV-A10 cents-boundary through the builder ($3.49/$3.50/$100/$100.01; $2.00/day builds; non-integer cents throw) |
| AC-R-11 job state machine | **PASS** | implementor's 4 tests + ADV-A1/A2/A3 hostile legs (garbage-SUCCESS ⇒ `post_id_missing` @ 1 submission; CLIENT_ERROR verbatim @ 1 submission, 0 post-verdict polls; unexpected job-id key ⇒ `job_id_missing`, 0 polls) |
| AC-R-12 ad body t3_/t2_; canonical click_url ≤14 incl `{{AD_ID}}` | **PASS** | unit + ADV-A4 hostile extraQueryParameters containment |
| AC-R-13 launch top-down + 200+warning | **PASS (mock-runtime) / live leg DEFERRED** | LOCAL STACK: PATCH order **campaign→ad_group→ad** observed on the mock wire, each `{"data":{"configured_status":"ACTIVE"}}`; 200 + exact warning for PENDING_APPROVAL / REJECTED / PENDING_BILLING_INFO (ad-level readback, R-3); pause = single campaign PATCH. Live launch = supervised window (§6) |
| AC-R-14 reverse-order PATCH-DELETED rollback + orphan + no DELETE verb | **PASS** | unit full-chain + rollback-order tests + source trap + G-1 DELETE-verb clause |
| AC-R-15 G-4 allowlist; age unrepresentable | **PASS** | property sweep + ADV-A7 passthrough smuggling (incl. alternate spellings; output ⊆ allowlist) |
| AC-R-16 gender ∈ {FEMALE, MALE, null} | **PASS** | unit |
| AC-R-17 communities passthrough, r/ strip, politics default | **PASS** | unit |
| AC-R-18 cap 422s naming limits | **PASS** | unit |
| AC-R-19 keyword/geo validations BEFORE create; failure blocks | **PASS** | unit call-order (wire SHAPES stay unpinned — deferred-live-fire §6) |
| AC-R-20 `query=` never `q=`; ≥24h cache; r=0 backoff | **PASS** | **LIVE**: real-search proof + cache discipline + live header parse (§1); unit + ADV-A11 (r=0 on a 200 gates the NEXT call; headerless 429 → 5s default) |
| AC-R-21 defaults + COMPACT/CLASSIC warn | **PASS** | unit |
| AC-R-22 G-2 CTA map + `invalid_cta` | **PASS** | G-2 + ADV-A6 (case/snake/NBSP/Cherokee-Ᏼ/Cyrillic-В/whitespace attacks all 422; cross-registry byte-exact) |
| AC-R-23 copy boundaries | **PASS** | boundary battery + ADV-A9 caps boundary |
| AC-R-24 display_url domain + OneLink 422 | **PASS** | unit + ADV-A8 (userinfo trick, uppercase host, narrower-display, suffix-lookalike, registrable-domain attack, http downgrade) |
| AC-R-25 VIDEO thumbnail; carousel 1–6; [3P] warn-only; INVALID_MEDIA verbatim | **PASS** | unit |
| AC-R-26 §6.1 mapping + verbatim rejection_reason | **PASS** | **LOCAL-STACK runtime matrix T1–T7 against the real DB column**: billing-first leaves review_status NULL + warning in detail · PENDING_APPROVAL→PENDING · billing/identity leave PENDING **unchanged** · REJECTED persists `FACILIATE_ILLEGAL_FRAUDULENT_OR_MISLEADING_BEHAVIOR` verbatim + preview_url · hostile junk statuses contained (review_status untouched; `ads.status` untouched; junk lands only in detail jsonb) · ACTIVE→APPROVED |
| AC-R-27 sync cadence + read-pool discipline | **PARTIAL** (P2-1) | Bounded oldest-first sweep (cap 50) through `getStatus` verified in source + local-stack runs; cron cadence is dashboard-owned (spec-acknowledged). **Batch reads via list endpoints NOT implemented** — implementor-declared deferral (§10.3), not Seth-accepted in the dispatch |
| AC-R-28 G-1 fails on revert | **PASS** | **Step 0.5 independently re-derived** (§4) — incl. the count-based single-line caveat (D-3) |
| AC-R-29 G-2/G-3/G-4 in standard CI, fail on their reverts | **PASS** | Registered in the ad-engine deno job; guarded behaviors pinned byte-exact; G-1 revert re-derived; my suite also registered (§5) |

## 3. Findings

### P1 QA-916-1 — a failed connect BRICKS every future reconnect (fail-close became fail-forever)
- **Evidence:** `supabase/functions/_shared/reddit.ts:2326` — `const wantedAccountId = env.expectedAccountId ?? conn?.external_account_id ?? null;` — combined with `admin-ad-connect/index.ts:194` (`markRedditInvalid` upserts `external_account_id: existing?.external_account_id ?? "unconfigured"`). **Runtime repro on the local stack (cold token cache):** (1) mint fails → 424 + invalid row `acct='unconfigured'` ✔ correct; (2) secrets fixed, reconnect with a fully-happy Reddit → **424 `"No ad account matching ^(t2|a2)_ found on the business (SPEC §1.3 step 4)"`** — the placeholder is used as an account PIN; (3) only after **manual DB row deletion** does the same request return 200/connected. Reproduced twice (matrix v1 S3–S8 all poisoned after one S1 failure; then the isolated cold-cache repro).
- **Impact:** any transient connect failure (a mint hiccup, a Reddit 5xx during preflight) permanently wedges the Reddit connection. The admin's documented recovery ("re-run admin-ad-connect") returns a misleading step-4 error forever. Preflight (`admin-ad-preflight`) is poisoned identically since it loads the same row. Reddit-only: google/meta never read `conn.external_account_id` as a preflight pin.
- **Required fix:** in `redditConnectPreflight`, only honour `conn.external_account_id` as a pin when it matches `REDDIT_AD_ACCOUNT_ID_REGEX` (the `'unconfigured'` sentinel and any other junk must fall through to discovery). Optionally: `markRedditInvalid` should preserve a previously-valid account id rather than only `existing?.external_account_id ?? 'unconfigured'` (it already does when one exists — the guard in preflight is the real fix).
- **Retest:** unignore `ADV-A12 [P1 QA-916-1]` in `issue916_wp6_tester_adversarial.test.ts` (it asserts the fixed behavior and passes only post-fix), and re-run the local-stack repro: fail → reconnect must 200 without DB surgery.

### P2 QA-916-2 — AC-R-27 batch reads not implemented (declared deferral, not yet accepted)
- **Evidence:** `admin-ad-campaign-sync/index.ts:194–235` — per-ad `getStatus` GETs; no list-endpoint batching. Implementor report §2 marks AC-R-27 PARTIAL, §10.3 defers.
- **Impact:** none today (bounded sweep of 50, 400 reads/60s pool); the AC as written is unmet.
- **Required fix / routing:** orchestrator decision — accept the deferral with a follow-up issue (my recommendation: volume-triggered), or route to REWORK. CONDITIONAL PASS was not available to me: the dispatch does not document Seth's acceptance.
- **Retest:** n/a if accepted; else list-endpoint batching + a read-count test.

### P3 QA-916-3 — currency-invalid reason is response-only, never persisted
- **Evidence:** `admin-ad-connect` NGN leg: 424 detail carries the GR-72 reason; the upserted row is bare `status='invalid'` (`extra` unchanged, no reason field). An admin who reloads later sees "invalid" with no cause.
- **Impact:** minor UX/ops; the connect-time response does carry the reason (AC-R-6's letter is met).
- **Required fix:** persist the last failure reason (e.g. `extra.last_error`) on invalid-row upserts — applies to all three failure classes.
- **Retest:** NGN scenario → row carries the reason.

### P3 QA-916-4 — `reddit.ts` cannot be a first-imported module (registry TDZ cycle; pre-existing class)
- **Evidence:** `import "…/_shared/reddit.ts"` as the entry edge crashes: `ReferenceError: Cannot access 'redditAdapter' before initialization` at `adChannel.ts:542` (registry object literal + bottom-of-file cyclic imports). Verified identical for `google.ts` and `meta.ts` — a WP1-era pattern, **not a WP6 regression**; every current edge fn happens to import `adChannel.ts` first, so nothing live breaks.
- **Impact:** a future edge fn importing an adapter before `adChannel.ts` boot-crashes at deploy.
- **Required fix (hygiene ORCH, not this WP):** make the registry lazy (function-valued entries or lazy `getAdapter` imports).
- **Retest:** entry-import each adapter module → no TDZ.

### P4 (notes / praise)
- **P4-1:** `review_detail` is replaced on every sync — a rejection_reason is dropped from the CURRENT detail once the state changes (history survives in `ad_status_events`). Same semantics as the meta/google lanes; intentional "current state" contract; no action.
- **P4-2 (pinned behavior):** the ALL-CAPS operationalization blocks an acronym RUN — `"NYC VIP DJ night out"` → block (3 consecutive ≥2-letter caps words) while single acronyms pass. Conservative by design; pinned in ADV-A9; amend via forensics if a different line is wanted (implementor flagged the ambiguity in §12.6).
- **P4-3 (praise):** fail-close discipline is real and consistent — zero-fetch secret checks, no fabricated ids anywhere (garbage SUCCESS payloads die with 1 submission), verbatim provider prose end-to-end (proven to the DB column), explicit-construction targeting (junk keys unrepresentable, confirmed by hostile sweeps), and the UA/mint/cache contract held on the LIVE wire exactly as coded.

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proof

At HEAD `bb68dbe0c` (proof commit `94a81b380` merged in):
1. **All three `configured_status: "PAUSED",` lines deleted** (reddit.ts 1542/1685/2098, true line-deletion): gate `issue-862-reddit-configured-status-explicit.mjs` **FAILED exit 1 with BOTH failure modes** — verbatim `found 6 create-endpoint reference(s) … only 5 configured_status occurrence(s)` + `no explicit configured_status: "PAUSED" assignment found` — AND the deno suite **FAILED 53/58** (AC-R-7 ×2, AC-R-8, AC-R-9, AC-R-12). Matches the implementor's transcript exactly.
2. **Single ad-group PAUSED line deleted** (1685): gate **PASSED** (count 7 ≥ 6 — the §12.1 count-based weakness, independently re-derived → D-3) but the suite **FAILED 57/58** at `AC-R-8: every ad-group input combination carries conversion_pixel_id (GR-12)`.
3. **Restored:** gate passed + 58/58 ok. Working tree verified byte-identical (`git status` clean).

## 5. Tester adversarial test

- **Path:** `supabase/functions/_shared/__tests__/issue916_wp6_tester_adversarial.test.ts` — **16 passing tests + 1 deliberately-ignored P1 regression (ADV-A12)**, angles A1–A12 (hostile job-poll payloads incl. all four id-key shapes + none + junk; CLIENT_ERROR terminality with submission/poll counting; job-id-refusal; PAUSED fuzz with status injection at all three levels; hostile getStatus containment; CTA Unicode-lookalike attacks; passthrough age smuggling; display_url/userinfo/uppercase-OneLink attacks; the ALL-CAPS 2-vs-3 boundary; bid-band edges in cents through the builder; r=0-on-200 + headerless-429 backoff).
- **Fails-on-revert verified at `bb68dbe0c` + this commit — at a DIFFERENT LINE than the implementor's three:** deleting `reddit.ts:1230` `if (run >= 3) return "block";` → **my suite FAILS at ADV-A9 while the implementor's 58 stay GREEN** (their caps tests only exercise the whole-text branch); restored → 16/16. CI registration: added to the ad-engine `DENO_TEST_FILES` list.
- Both the implementor's `reddit.test.ts` and this file are on-branch and appear in `git diff origin/main...HEAD --name-only`.

## 6. Deferred live-fire list (the orchestrator's supervised window — Reddit has NO validate-only)

1. **The first real PAUSED create chain** (campaign → ad group → structured-post job → ad) **+ PATCH-DELETED reverse rollback** — the create is the proof. Settles, in one run: the job-payload id key name (extractor pins 4 shapes, fails close), the `keyword_validations`/`geolocations_validations` request/response shapes (POSTs — barred from my read-only window), carousel card internals, any undocumented server-side budget floor (400 surfaced verbatim), and starts the empirical review-SLA clock (§6.3).
2. **AC-R-13 live launch leg** — top-down ACTIVE + 200-with-warning against the real account, inside the same window, immediately re-PAUSED/rolled back.
3. **First real rejection / INVALID_MEDIA observation** — verbatim persistence against live prose.
4. **Suggestions endpoint** — stays UNPINNED (my live reads prove it silently ignores every param we guessed and is account-seeded, not city-seeded); pin only via Reddit docs/`adsapi-partner-support@reddit.com`, never by guessing.
5. **Crawler-permissiveness of the creative master URL host against Reddit's fetcher** (URL intake = Reddit downloads + rehosts; the COMMS-0102 Meta lesson plausibly applies) — verify with the live-fire creative.

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI surface |
| 2 | One owner per truth | PASS | one `toMicro`, one objective map, one UA constant, one transport wrapper |
| 3 | No silent failures | PASS | connect surfaces every step; sync's per-entity catch is the house sweep-resilience pattern; P1 QA-916-1 is a *misleading* failure, not silent — filed above |
| 4 | One query key per entity | N/A | no client |
| 5 | Server state server-side | N/A | |
| 6 | Logout clears everything | N/A | |
| 7 | `[TRANSITIONAL]` labeled | PASS | none in code; deferrals live in reports |
| 8 | Subtract before adding | PASS | fail-close stub replaced, not duplicated |
| 9 | No fabricated data | PASS | no-fabricated-ids proven under hostile payloads (ADV-A1/A3); `'unconfigured'` is an explicit sentinel |
| 10 | Currency-aware | PASS | 8-enum gate live+local; cents at rest, micro at the boundary |
| 11 | One auth instance | PASS | mint cache keyed per env-var name; lanes never share |
| 12 | Validate at the right time | PASS | 422s before any provider call (builders) |
| 13 | Exclusion consistency | PASS | politics default; deprecated exclusions warned, never sent |
| 14 | Persisted-state startup | N/A | |

## 8. Device / parity matrix

| Surface | Result |
|---|---|
| Consumer iOS / Android | skipped — WP ships no consumer code |
| Buyer/anonymous Web | skipped — no buyer-web code |
| Business iOS / Android / Web preview | skipped — no business code |
| Admin Web | indirect only — zero admin code changed; the generic `#/ad-engine` surface consumes the preflight rows, whose shape I verified end-to-end on the local stack (P1–P6 rows, overall green/red/not_connected) |
| Supabase edge/DB | **runtime-verified on the local stack** (connect/preflight/sync/action, all four lanes); **NOT deployed to prod** — deploy list = implementor §5 (`verify_jwt=true` ×4), orchestrator-owned from MERGED main |
| Physical iPhone HITL | N/A — no user-touchable surface |

## 9. Full battery at final commit

- **208/208 deno tests passed + 1 deliberately ignored** (ADV-A12) across all 10 ad-engine suites (WP1 adChannel/meta + 3 tester suites, WP2 google ×3, WP6 reddit + this suite) in CI-parity env (all credentials empty).
- `deno check` clean on all 8 touched TS files.
- Strict-grep gates: `issue-862-reddit-configured-status-explicit.mjs` PASS + self-test PASS; `issue-862-ad-token-env-server-only.mjs` PASS (16 token names, 7 client trees clean) + self-test PASS.
- CI itself is DEAD repo-wide (COMMS-0103 billing) — local runs above are the proof, per the implementor's precedent.

## 10. Discoveries for Orchestrator

- **D-1 (SPEC amendment):** §4.4's suggestions line ("seed suggestions from the destination city") contradicts live behavior — the endpoint is account-seeded and silently ignores unknown params (probes P10 ×4). Amend the SPEC; keep suggestions unimplemented until Reddit documents the param.
- **D-2 (rate-limit reality):** live pools `ads-funding-instruments` and `ads-conversion-signals` are **30 req/60s** — tighter than the SPEC's "tightest = 100/60s taxonomy". No code change needed now (1 call each per connect); worth noting in the blueprint before any polling touches those endpoints.
- **D-3 (gate hardening, re-derived):** G-1 is count-based — a SINGLE PAUSED-line deletion passes the gate (7 ≥ 6) and is caught only by the deno suite. Harden to per-builder structural checks at CLOSE (implementor §12.1 confirmed).
- **D-4 (hygiene ORCH):** adapter modules TDZ-crash as entry imports (P3 QA-916-4) — registry should be lazy; class covers meta/google/reddit.
- **D-5 (COMMS-0102 cascade):** the duplicate-prefix workaround has degraded — naive +1 renames now collide with pre-existing +1 files in 3 buckets; 14 files needed order-preserving renames this session (restored byte-identical). The renames-on-main hygiene fix is getting more urgent with every bucket that fills in.
- **D-6:** `adChannel.test.ts` stale test name ("four unbuilt adapters") now also mislabels reddit — cosmetic, still passing for the right fail-close reason (implementor §12.2 confirmed; append-only forbids the rename).

## 11. Routing

**FAIL → REWORK (mingla-implementor):** fix P1 QA-916-1 (cite: `reddit.ts:2326` + `admin-ad-connect/index.ts:194`; unignore ADV-A12), and carry the orchestrator's decision on P2 QA-916-2 (AC-R-27 batching: accept-with-follow-up or implement). Everything else is green: 27/29 ACs PASS, 1 PASS-with-deferred-live-leg (AC-R-13), 1 PARTIAL (AC-R-27). The deferred live-fire list (§6) belongs to the orchestrator's supervised window after REWORK + merge.
