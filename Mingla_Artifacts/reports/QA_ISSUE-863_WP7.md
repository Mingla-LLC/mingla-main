# QA — ISSUE-863 WP7 (TikTok channel) — LOCAL SCOPE

**Tester:** mingla-tester+claude · **Date:** 2026-07-15
**Under test:** code commit `5c78e36cc` (report commit `4945aec40`) on branch `issue-863-tiktok-ads-api`, worktree `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/`
**Contract:** `Mingla_Artifacts/specs/SPEC_ISSUE-863_TIKTOK_ADS_CAMPAIGN_ENGINE.md` body + **Amendment A1 (binding)**; PROOF_LOG rows T-P1…T-P7 as live ground truth
**Scope:** LOCAL-ONLY per dispatch (CI dead — COMMS-0103 billing), plus ONE live read-only leg (tool/region through the adapter's own parser). The live create/launch/pause round is DEFERRED (list in §8).
**Environment:** isolated local Supabase stack (`supabase start`, project id temporarily `qa863tiktok` on shifted ports so a parallel session's stack was never touched; the 6 duplicate migration prefixes temp-renamed order-preserving and restored byte-identical — COMMS-0102 factored); `supabase functions serve` in two env phases; a local mock TikTok v1.3 + Meta Graph server via the `TIKTOK_GRAPH_BASE`/`META_GRAPH_BASE` overrides with full wire capture; ONE live read-only `tool/region` GET with the real engine token (grep-to-env from master keys; never echoed, never written to disk, zero writes to TikTok).
**Sim gate exemption:** backend-only change (edge functions + `_shared` module; zero UI/runtime surface) — Phase 0.A exemption stated per skill rules. `git show 5c78e36cc --stat` confirms only `supabase/functions/**` + `COMMS_LEDGER.md` are touched.

---

## 1. Verdict

**FAIL — 0 × P0 · 1 × P1 · 3 × P2 · 2 × P3 · 3 × P4** → routes to REWORK (mingla-implementor).

The adapter's validation core is genuinely excellent — every dispatched adversarial angle on money, schedules, DISABLE, bidding, geo fail-loud, identity, and the OneLink gate held, and the one live leg matched T-P2 exactly. The FAIL is a single P1 discovered by runtime sequence-attack, not by source reading: **the documented operational sequence (connect attempted before secrets → secrets set → reconnect) permanently bricks the TikTok lane** — the WP7-new advertiser-mismatch guard compares the env advertiser id against the `'unconfigured'` sentinel that the invalid-row upsert itself persisted, and no API path can ever repair it (proven end-to-end in §5, legs 8–15; recovery required manual SQL). One line of rework fixes it; everything else in this report is P2-or-below.

Regression gate: implementor happy-path test present with fails-on-revert (re-derived independently, §4) + tester adversarial suite (different angles, on-branch, in-diff, own fails-on-revert at a different line, §5) → satisfied.

---

## 2. SC-by-SC matrix (WP7 dispatch scope + A1 ACs)

All rows are single-surface (backend); parity is automatic through the shared code path.

| SC | Criterion | Verdict | Evidence |
|---|---|---|---|
| a-1 | v1.3 client: `Access-Token` header (not Bearer), `code===0` contract, normalized errors, token scrubbing | **PASS (local)** | Wire capture (mock): every call carries `Access-Token`; live leg used the same wrapper against the real API (`code:0` → parsed payload). Token absent from every response/row (§5 legs 9/11/15). Live-fire error paths deferred (§8). |
| a-2 | `operation_status:'DISABLE'` at ALL THREE levels (A1.0-4, AC-2) | **PASS** | Implementor DISABLE fuzz (re-run 38/38) + tester T-5 hostile-spec-property vector + fails-on-revert re-derived: deleting the campaign DISABLE line → `36 passed / 2 failed`; restored green. |
| a-3 | Money: cents÷100, floors AFTER conversion ($20/$50/$20×days) (A1.0-1, AC-3) | **PASS** | Tester T-8: 1999¢ refused / 2000¢ exact-floor builds `budget: 20`; 4999¢/5000¢ CBO edge; real 3-day lifetime window floor $60 (5999¢ refused / 6000¢ builds); NaN/∞/0/negative/fractional cents throw; `MAX_BUDGET_CENTS` boundary exact. |
| a-4 | `BALANCE_EXCEED` → 200 + warning, never silent; Meta branch unaffected (A1.0-1) | **PASS (runtime)** | §5 leg 17: launch through the real edge fn on the local stack → HTTP 200 + "Add funds in TikTok Ads Manager (Advanced Payment Portfolio)…", `delivery_status` persisted, audit row appended. Leg 19: Meta launch → WP1's exact `PENDING_BILLING_INFO` message. Tester T-6: Meta vocabulary (`PENDING_BILLING_INFO`, `WITH_ISSUES`) maps to null in the TikTok mapper; hostile/lowercase/double-prefix statuses null, never throw. |
| a-5 | `bid_type` REQUIRED under CBO, `BID_TYPE_NO_BID` default, `bid_price` < both budgets, CBO first-ad-group consistency (A1.1(b), AC-15) | **PASS** | Fails-on-revert #2 re-derived (deleting the CBO default → 3 failed, restored green); tester T-7: undefined≡null optimization_event, both mismatch arms, empty-string-is-not-absence. |
| a-6 | UTC+0 schedules + bounds + dayparting 336×0/1 (A1.1(a), AC-16) | **PASS** | Tester T-4: dispatch-mandated trio `2027-02-30`, `2026-13-01`, `2026-06-31` ALL reject; plus non-leap `2027-02-29`, `24:00:00` roll, `:60` minute/second, day/month `00` reject; leap `2028-02-29` parses; exact bound values pass and +1 s fails. Tester fails-on-revert on the round-trip-guard line (§5). |
| a-7 | Identity TT_USER only; CUSTOMIZED_USER hard-fail with explanatory error (A1.1(f), AC-12) | **PASS** | Implementor tests re-run + tester T-14 (empty identity_id, invalid identity strings). |
| a-8 | `landing_page_url` = canonical dest_url, NEVER the OneLink; utm ≤14 (A1.0-5, AC-4 amended) | **PASS** | Tester T-9: case evasion, apex `onelink.me`, deep subdomains, http downgrade all refused; the userinfo@ trick judged by REAL hostname; T-11: 14/15 boundary + malformed entries + 100/101-char key and 600/601-char value edges. |
| a-9 | LIVE `resolveGeo` via tool/region, fail-loud naming the country, numeric-only, ≤3,000, no-overlap (A1.1(e), AC-13) | **PASS (incl. LIVE)** | **Live leg:** the adapter's own `tiktokFetchRegions`+`parseTikTokRegions` against the real API → **2,831 regions / 33 codes / GB ABSENT (exact T-P2 match)**; US→`6252001`, NG→`2328926`; GB fails loud naming GB; every live code has a COUNTRY-level row; live `level` vocabulary = COUNTRY/PROVINCE/CITY/DISTRICT. Closes the implementor's flagged ambiguity #6/#3. Tester T-1/T-2: hostile payload shapes (with F-3 exception), 3,500-entry scale, country-row preference over 34 preceding province rows, duplicate-request dedupe. |
| a-10 | Creative inline; `createCreative` documented NO-OP (A1.0-2) | **PASS** | Implementor test re-run; adapter source confirms `rollbackCreative` deliberately absent. |
| a-11 | Text validators: ad_text ≤100 no-emoji CJK×2; names ≤512 (A1.1(c), AC-14) | **PASS with F-2/F-4 gaps (P2/P3)** | Tester T-3: ZWJ family, skin-tone PAIRS, flag digraphs, keycaps ±VS16, tag flags all rejected; ©+VS16 rejected while bare ©®™ pass; exact boundary 50 CJK=100 / 49 CJK+2 Latin=100 pass and 101 fails (names: 256 CJK=512). **Gaps:** lone modifier + tag chars — findings F-2/F-4. |
| a-12 | GAB placement gate; TOPBUZZ/HELO deprecated (A1.1(l)) | **PASS** | Implementor tests re-run (38/38). |
| a-13 | setBudget 40%/30%/2-day validation | **PASS (local)** | Implementor tests re-run; live read-back leg deferred (§8). |
| a-14 | setStatus/getStatus two-status read; DELETE rollback-only | **PASS (runtime)** | §5 leg 17 wire capture: top-down `campaign→adgroup→ad` ENABLE; read-back persisted BOTH statuses. Tester T-13: hostile writer inputs throw; reader maps only exact vocabulary. |
| b-1 | Registry: live adapter, fail-close first | **PASS** | Implementor registry tests re-run; tester T-12: business lane NEVER falls back to the consumer credential; whitespace `token_env_var` falls back to the lane default; set-but-empty env fail-closes; token-without-advertiser-id fail-closes. |
| b-2 | admin-ad-connect tiktok lane (STATUS_ENABLE, identity, pixel, invalid-row) — AC-1 | **FAIL — F-1 (P1)** | Happy path runtime-verified exactly per AC-1 (§5 leg 15: row + extra refs + BC as org id + `min_daily_budget_cents` NULL + token absent). Invalid-row upsert on FIRST connect verified both lanes with lane-correct env names (§5 leg 5). **But the invalid row then bricks all subsequent connects — F-1.** |
| b-3 | admin-ad-preflight P1–P6 (P2/P4 amber, GB warning on P6) | **PASS (runtime)** | §5 leg 16: P1 pass · P2 **warn** (API blind to portfolio) · P3 pass · P4 **warn** (zero events → #865) · P5 pass · P6 **warn naming GB** · overall **amber**. Unset matrix: overall `not_connected`, P1 fail (§5 leg 7). |
| c-1 | Tests append-only + fails-on-revert | **PASS** | `git diff origin/main...HEAD --name-status`: only ADDED test files; both implementor + tester suites in the closing diff after this commit. Both implementor proofs re-derived + one tester proof at a different line (§4/§5). |

---

## 3. Findings

### F-1 · P1 — A failed first connect permanently bricks the TikTok lane (`'unconfigured'` sentinel × advertiser-mismatch guard); no API recovery exists
- **Evidence (runtime, end-to-end):** With TIKTOK_* env unset, `POST admin-ad-connect {platform:'tiktok'}` → 424 + invalid row `external_account_id='unconfigured'` (per QA P2-4 / AC-1 — correct). Then with the secrets SET (fake creds + mock), the SAME call → **424 `advertiser_mismatch`**: "TIKTOK_ADVERTISER_ID (7627974536397766673) does not match the persisted connection's advertiser (unconfigured)". Retry → same. `action:'status'` → same. `markTikTokInvalid` re-persists the sentinel (`existing.external_account_id ||` is truthy), so the row can never heal; only `DELETE FROM ad_connections` recovered it (§5 legs 8–15).
- **Root cause:** `supabase/functions/_shared/tiktok.ts:147` — the mismatch guard treats the sentinel as a real advertiser id; `supabase/functions/admin-ad-connect/index.ts:303-306` — `markTikTokInvalid` persists `'unconfigured'` into `external_account_id`, and line 303's `existing?.external_account_id ||` keeps it forever. **WP7-new:** neither `meta.ts` nor `google.ts` compares `conn.external_account_id` against env (grep-verified), so Meta/Google invalid rows do not brick.
- **Impact:** the exact documented operator sequence — "until Seth sets the TIKTOK_* secrets, every path fail-closes by design" (implementor report §11) — self-destructs: any connect/status/preflight-driven connect attempt during the pre-secrets window (a curl, the SC-2 Reconnect button, a checklist click) makes the lane unconnectable after the secrets land, failing AC-1/SC-2 recovery, until someone runs manual SQL on prod.
- **Required fix (one line + regression test):** in `resolveTikTokClient`, treat the sentinel as absence — e.g. `const connAdvertiserId = ((conn?.external_account_id ?? "").trim() === "unconfigured" ? "" : …)` — or stop persisting the sentinel into `external_account_id` on invalid rows (persist NULL is impossible — column NOT NULL — so prefer the resolver-side exclusion). Mirror whichever choice into a new append-only test: failed-connect → set env → connect MUST succeed.
- **Retest:** re-run §5 legs 3→8→15 in order WITHOUT the DB surgery step; connect must return 200 after the env lands.

### F-2 · P2 — Emoji validator misses lone skin-tone modifiers (U+1F3FB–FF); `stripEmoji` STRANDS them, and the stranded output then PASSES validation
- **Evidence (runtime probe):** `containsEmoji("\u{1F3FD}")` → **false**; `stripEmoji("👍🏽")` → `"🏽"` (strips the thumb, leaves the modifier — it is not Extended_Pictographic in V8's data); `validateTikTokAdText("🏽 nice event")` → **ok:true**. AC-14 demands blanket no-emoji before any TikTok call; a medium-skin-tone swatch IS rendered emoji and TikTok review will reject it — after the documented strip pipeline (A1.1(c) "strip for non-Spark") itself produced it.
- **Impact:** content-engine copy with skin-toned emoji passes our gate post-strip and dies in TikTok review — the exact review-burn class A1.1(d) exists to prevent.
- **Required fix:** add `U+1F3FB–U+1F3FF` (and see F-4) to the plumbing/strip set in both `containsEmoji` and `stripEmoji` (`supabase/functions/_shared/tiktok.ts:288-323`).
- **Retest:** `containsEmoji("\u{1F3FD}")===true`; `stripEmoji("👍🏽")===""`; strip-then-validate round trip clean. (Deliberately NOT enshrined in my append-only suite so the fix isn't blocked; T-3's header documents this.)

### F-3 · P2 — `parseTikTokRegions` crashes with a raw TypeError on a `null` element in the region array
- **Evidence:** `parseTikTokRegions({ region_info: [null] })` → `TypeError: Cannot read properties of null (reading 'location_id')` at `tiktok.ts:929` — caught during my T-1 hostile-shape attack (test deliberately excludes the crash case; see the inline NOTE at the test). The function's own doc comment says "Tolerant parser".
- **Impact:** a malformed live payload would surface as 500 `internal_error` instead of a normalized `AdApiError` — loud but wrong-shaped; contradicts the module's tolerant-parser contract.
- **Required fix:** filter non-object entries — e.g. `for (const entry of raw) { if (entry === null || typeof entry !== "object") continue; … }` at `tiktok.ts:928`.
- **Retest:** `parseTikTokRegions({region_info:[null, {location_id:"6252001",region_code:"US"}]})` returns the one valid region.

### F-4 · P3 — TAG characters (U+E0020–E007F) survive `stripEmoji` as invisible junk
- **Evidence:** `stripEmoji("🏴󠁧󠁢󠁥󠁮󠁧󠁿")` (England tag-flag) leaves 6 invisible TAG chars (`e0067,e0062,e0065,e006e,e0067,e007f`), weight 6. Raw input IS rejected by `containsEmoji` (the base 🏴 is Extended_Pictographic) so the validator holds; only the strip pipeline emits invisible garbage.
- **Required fix:** include `U+E0020–E007F` in the strip set (same lines as F-2).

### F-5 · P3 — Circular-import TDZ: importing `_shared/tiktok.ts` (or meta/google) as the ENTRY module crashes at load
- **Evidence:** `deno eval 'import "./supabase/functions/_shared/tiktok.ts"'` → `ReferenceError: Cannot access 'tiktokAdapter' before initialization` at `adChannel.ts:529` (meta 528 / google 531 identical). All 5 shipped `admin-ad-*` entry points import `adChannel.ts` FIRST (verified), so no deployed function cold-start crashes today.
- **Impact:** latent — a future edge function that imports `tiktok.ts` before `adChannel.ts` dies at cold start. Pre-existing CLASS from WP1/WP2 (meta/google share it); WP7 joins the pattern rather than creating it → routed as a Discovery (D-2), not WP7 rework.

### P4 notes (praise / observations)
- **P4-a:** the V8 date-rolling round-trip guard is excellent defensive work — my widened attack (10 hostile date shapes incl. leap/`24:00:00`/`:60`) could not get a single rolled date through, and the implementor's self-discovered bug class held at a line I fails-on-revert-verified independently.
- **P4-b:** the DISABLE invariant survived a second, different injection vector (hostile SPEC properties + a utm entry literally named `operation_status`), and the hostile `budget_mode:"BUDGET_MODE_INFINITE"` hijack degraded safely to a bounded daily budget.
- **P4-c:** half-width katakana (U+FF66–FF9F) is weighted ×2 by the full-width-block rule — likely over-strict vs TikTok's real counter (half-width traditionally counts 1). Unverifiable locally; conservative direction (rejects early, never over-sends). Documented in T-3.

---

## 4. Step 0.5 — independent re-run of the implementor's fails-on-revert proofs

Both proofs re-derived by TRUE LINE DELETION at `4945aec40` (tree identical to `5c78e36cc` for code), file restored and re-verified green after each:

1. **DISABLE:** deleted `operation_status: "DISABLE",` from `buildTikTokCampaignBody` (`tiktok.ts:1242`) → `FAILED | 36 passed | 2 failed` (both DISABLE-fuzz tests, exactly as claimed) → restored → `ok | 38 passed`.
2. **bid_type-under-CBO:** deleted `body.bid_type = spec.bidType ?? TIKTOK_DEFAULT_BID_TYPE;` (`tiktok.ts:1418`) → `FAILED | 35 passed | 3 failed` (the three bidding tests; implementor reported "1 passed | 3 failed" on a filtered run — same 3 failures) → restored → `ok | 38 passed`.

Implementor's 38/38 claim independently reproduced before any deletion: `deno test --allow-env --allow-read …/tiktok.test.ts` → `ok | 38 passed | 0 failed`.

---

## 5. Tester adversarial suite + local runtime legs

**Suite:** `supabase/functions/_shared/__tests__/issue863_wp7_tester_adversarial.test.ts` — **43 tests, all passing**, append-only, committed with this report. Angles per §2 (T-1…T-14 documented in the file header; all beyond the implementor's 38).
**Tester fails-on-revert (different line from both implementor targets):** deleted the round-trip guard `if (formatTikTokScheduleTime(new Date(ms)) !== value) return null;` (`tiktok.ts:459`) → **3 T-4 tests FAILED**; restored → `ok | 43 passed`. **fails-on-revert verified at `4945aec40`.**

**Local runtime legs** (isolated stack `qa863tiktok`; mock platform server with wire log; admin JWT minted against local GoTrue; numbered as executed):

| # | Leg | Result |
|---|---|---|
| 1–2 | No auth / anon-key call → 401 | PASS |
| 3–4 | Consumer + business connect, env unset → 424 `tiktok_not_connected` with the full §7 secrets checklist | PASS |
| 5 | Invalid-row upsert on FIRST connect, BOTH lanes, lane-correct `token_env_var` (`TIKTOK_MINGLABIZ_ACCESS_TOKEN` for business) | PASS |
| 6 | Non-admin authenticated user → 403 `forbidden` | PASS |
| 7 | Preflight env-unset → overall `not_connected`, P1 fail | PASS |
| 8–13 | Connect with secrets set AFTER a failed first connect → **424 `advertiser_mismatch` forever** (connect AND status) | **FAIL → F-1** |
| 14–15 | After manual row deletion: connect → 200; row exactly AC-1 (acct `7627974536397766673`, BC org id, `TT_USER` identity + pixel + `api_balance:0` + `events_env_var` in `extra`, `min_daily_budget_cents` NULL); fake token absent from response body AND all DB rows | PASS (post-surgery) |
| 16 | Preflight mocked → **P1 pass · P2 warn · P3 pass · P4 warn · P5 pass · P6 warn naming GB · overall amber** | PASS |
| 17 | Launch tiktok campaign → **200 + BALANCE_EXCEED warning** (never silent); wire order top-down campaign→adgroup→ad, all ENABLE, `Access-Token` header; `status ACTIVE` + `delivery_status` persisted | PASS |
| 18 | `ad_status_events` audit row appended with `provider_response` | PASS |
| 19 | **Meta branch unaffected:** meta launch → WP1's verbatim `PENDING_BILLING_INFO` message | PASS |
| 20 | Connection flipped invalid → action → 424 fail-close | PASS |

**Live read-only leg (the ONE dispatched):** real engine token (grep-to-env; never echoed/persisted), single GET `tool/region` for TRAFFIC **through `tiktokFetchRegions` + `parseTikTokRegions`** → 2,831 regions / 33 codes / **GB absent** / US `6252001` / NG `2328926` / all codes carry COUNTRY-level rows / GB pick fails loud naming GB. Exact T-P2 match; ambiguity closed; **zero writes**.

---

## 6. Full battery at the final tree

- `deno check` on all 6 touched files + both test suites → clean.
- Scoped ad-engine battery (adChannel + meta + google + tiktok + WP1 tester/retest/rework + WP2 flow/adversarial + WP7 implementor + WP7 tester) → **`ok | 215 passed | 0 failed`** (type-checked).
- Full `_shared/__tests__/` directory (`--no-check`, house convention): worktree **819 passed | 35 failed** vs pre-change tree `44822322b` **738 passed | 35 failed** — **failure sets IDENTICAL** (not merely a subset; diff empty), pass delta exactly the 81 new tests (38 + 43). Zero new failures. (Implementor's earlier baseline of `703/40` was a supabase-functions-only extraction artifact; my apples-to-apples run at the true pre-change commit supersedes it and confirms the substance of the claim.)
- Strict-grep sweep, all 388 gates: worktree **17 failures**, pre-change tree **17 failures — identical list** (diff empty; all pre-existing, none in this lane). RT-3 ad-token gate passes explicitly: "16 token names, 7 client trees clean" (TIKTOK_ACCESS_TOKEN already covered).
- Append-only: `git diff origin/main...HEAD` shows only ADDED test files; no test modified/deleted.

## 7. Constitution 14-rule matrix

| # | Rule | Verdict | Note |
|---|---|---|---|
| 1 | No dead taps | N/A | no UI surface |
| 2 | One owner per truth | PASS | token env-only; ONE cents→dollars conversion point; two-status ownership explicit |
| 3 | No silent failures | PASS | geo fail-loud (live-proven), warnings never silent (runtime-proven); F-3 is wrong-shaped but loud |
| 4 | One query key per entity | N/A | no client queries |
| 5 | Server state server-side | N/A | — |
| 6 | Logout clears everything | N/A | — |
| 7 | `[TRANSITIONAL]` labels | PASS | none claimed, none found |
| 8 | Subtract before adding | PASS | WP1 stub replaced, not duplicated |
| 9 | No fabricated data | PASS | `'unconfigured'` is a documented sentinel (its interaction bug is F-1, not fabrication); normalizer never invents fields (T-14) |
| 10 | Currency-aware | PASS | USD floors per platform docs; cents at rest |
| 11 | One auth instance | PASS | house edge auth pattern; gate-first ordering runtime-proven (legs 1/2/6) |
| 12 | Validate at the right time | PASS | UTC+0 contract + injectable clock; bounds at create time |
| 13 | Exclusion consistency | PASS | deprecated placements/objective gates consistent |
| 14 | Persisted-state startup | N/A | — |

## 8. Device / parity matrix + deferred live legs

Backend-only: Consumer iOS/Android, Business iOS/Android, Buyer web, Business-web preview — **skipped, surface not shipped there** (diff touches only `supabase/functions/**`). Admin Web — **not in WP7** (dispatch scope; #864 wires the channel). Physical-iPhone HITL — N/A (no runtime surface). Edge-fn live deploy state — N/A by dispatch (no deploys; CI dead).

**DEFERRED LIVE LEGS (conditions on any eventual ship, post-merge, after Seth sets the TIKTOK_* Function Secrets and tops up the Advanced Payment Portfolio ≥ $20/day):**
1. Live paused-create (campaign→adgroup→ad, all DISABLE in Ads Manager) → launch → pause → rollback DELETE, with real IDs captured.
2. Live BALANCE_EXCEED read-back on the real advertiser ($10 < $20 floor) — expected to reproduce leg 17 live.
3. `UPLOAD_BY_URL` against a real bucket URL (10 s fetcher; Bunny reachability pre-check before #866).
4. Implementor ambiguity #7: ad-group budget OMITTED under CBO vs the MCP static schema marking it required — only a live CBO create resolves it; surface TikTok's error verbatim if it disagrees.
5. Live error-path shapes for the v1.3 wrapper (non-zero codes, HTTP failures) beyond the mock.
6. Edge deploy of the 5 functions from MERGED main with `verify_jwt=true` preserved + post-billing-fix PR green rerun (COMMS-0103).

## 9. Discoveries for Orchestrator

- **D-1:** F-5's circular-import TDZ (`adChannel.ts` ⇄ `meta.ts`/`google.ts`/`tiktok.ts`) is a WP1/WP2-era latent class — worth a tiny hygiene ORCH (invert the registry to lazy `getAdapter` imports or add a lint gate asserting `adChannel.ts` is imported first in every `admin-ad-*` entry).
- **D-2:** COMMS-0102's duplicate-prefix hazard bit AGAIN in this QA: two of the six pairs (tr4 and orch-1188) have REAL intra-day ordering dependencies, so naive dedupe renames invert them and break `supabase start` mid-chain (`biz_compute_refund_for_cancel` does not exist). The hygiene ORCH's rename plan must keep `tr4_refund_tiers` BEFORE `tr4_revoke_rpc_anon_grants` and `1188_orders_event_date_id` BEFORE `1188_finalize_persist_event_date_id`.
- **D-3:** The half-width-katakana ×2 weighting (P4-c) is a candidate one-line fidelity question for the live-fire round — a 51-char half-width-katakana ad_text that TikTok would accept is rejected by us today (safe direction).
- **D-4:** The launch-warning healthy-path (no warning on `DELIVERY_OK`) is unit-proven; the local mock always returns BALANCE_EXCEED, so the healthy read-back was not runtime-exercised — trivially covered in the live round.

## 10. Comms-ledger activity

- **COMMS-0103 (BLOCK, already ACKNOWLEDGED):** factored — nothing merged, nothing pushed, no CI relied on; all gates local. Ack appended.
- **COMMS-0102 (WARN):** factored — isolated stack via order-preserving temp renames (restored byte-identical, git-clean verified); D-2 extends its evidence. Ack appended.

*Filed by mingla-tester+claude · 2026-07-15 · worktree `~/Desktop/mingla-orchs/issue-863-tiktok-ads-api/` on branch `issue-863-tiktok-ads-api`.*
