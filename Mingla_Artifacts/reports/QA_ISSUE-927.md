# QA_ISSUE-927 — secret-slot consolidation + create-fn completion (TESTER VERDICT)

- **Issue:** #927 · **Branch:** `issue-927-secret-slot-consolidation` · **Worktree:** `~/Desktop/mingla-orchs/issue-927-[secret-slot-consolidation]`
- **Range under test:** `714a5be9e..3939ae1fd` (implementor) + tester commits stacked on top (all carry `[TEST-MOD-APPROVED ORCH-0927]`)
- **Mode:** TARGETED (adversarial, runtime-first) · **Date:** 2026-07-16
- **Hard guards honored:** zero live platform calls (in-process mock Reddit/TikTok/Supabase only), local-only, no deploys, no push, append-only tests.
- **Live-fire exemption:** backend/edge-function + admin logic-module change. The only UI-shipping surface (admin wizard channel rows) is pinned at module runtime (`planChannels` direct probes) per the dispatch; a full authed-browser wizard run needs the deployed fn + seeded secrets and remains the implementor-flagged post-deploy smoke (§10 of their report) — restated in Discoveries.

## 1. Verdict

**PASS** — P0: 0 · P1: 0 · **P2: 1** · **P3: 1** · P4: 2 (praise).
The single P2 is a latent-class finding (unreachable through any shipped call path today, pinned by a tester test that reds the day it becomes reachable) — it does not gate this merge. Regression gate satisfied both ways (implementor fails-on-revert re-derived + tester adversarial with its own fails-on-revert at a different line, all on-branch and in the closing diff).

## 2. Leg-by-leg matrix (dispatch legs 1–7)

| Leg | Claim under attack | Verdict | Runtime evidence |
|---|---|---|---|
| 1a | 8 consolidated readers resolve BUSINESS_WEB_ORIGIN-first at runtime | **PASS** | `issue927_tester_origin_runtime.test.ts` (10/10): the SHIPPED expression of each of the 8 sites is extracted verbatim and EXECUTED under env permutations — canonical wins over old name; old name alone still resolves (deletion decoupled); neither → hardcoded default (5 sites) or `undefined` + adjacent `web_base_url_missing` 500 guard intact (3 fail-close sites) |
| 1b | ticket-confirmation-dispatch PUBLIC_BUYER_BASE_URL override wins over BOTH | **PASS** | same suite: 4-permutation matrix — override beats canonical+old together, and alone |
| 1c | Sweep bans any future bare old-name read | **PASS (red→green proven)** | injected `Deno.env.get("MINGLA_PUBLIC_WEB_BASE_URL")` probe file under `supabase/functions/` → implementor sweep test FAILED (4/5); removed → 5/5 |
| 2a | Reddit full chain wire order (campaign→geo-validate→ad group→job→poll→ad) | **PASS** | `issue927_tester_adversarial_runtime.test.ts` r2 — real edge fn in-process, mock Reddit records order; token mint first (cold cache) |
| 2b | `configured_status:"PAUSED"` explicit on ALL THREE create bodies, incl. under hostile injection | **PASS** | r2 + r3 fuzz: `status`/`configured_status`/`conversion_pixel_id`/`funding_instrument_id` injected at body top-level AND `targeting.passthrough.reddit` — every wire body stays PAUSED, no `"ACTIVE"`/`px_EVIL`/`fi_EVIL` on the wire, pixel stays the connection's own; allowlisted keys (keywords) still ride + get pre-validated (selective drop proven, not dead passthrough) |
| 2c | `conversion_pixel_id` on ad group + CBO campaign | **PASS** | r2 (wire: ad-group body `px_qa_1`) + r6 (builder runtime: CBO body carries it unconditionally; non-CBO omits it; ad-group builder THROWS without one) |
| 2d | Validate gate = ZERO adapter calls | **PASS** | r1: zero reddit-bound requests INCLUDING the token mint (cold cache), zero DB writes, named-skipped-layers ×4 |
| 2e | Rollback = PATCH `configured_status:"DELETED"` in reverse order, at EVERY step | **PASS** | r4a–r4d: campaign fail → no PATCH; ad_group fail → PATCH campaign only; job CLIENT_ERROR → PATCH ad_group THEN campaign; ad fail → same reverse pair + `orphaned_post_id`/`profile_id` recorded in the audit row |
| 2f | DB rows only on full success | **PASS** | r4a–r4d: 0 ad-tree inserts on every forced failure (audit row only); r2: exactly 3 inserts + 1 audit on success; r5: DB-persist failure after platform success → platform PATCH DELETED + 500 `db_persist_failed_platform_rolled_back` |
| 3a | TikTok DISABLE at all three levels | **PASS** | t2: `operation_status:"DISABLE"` on campaign + adgroup bodies and inside the ad create body (wire-recorded) |
| 3b | bid_type required under CBO, enforced pre-call | **PASS** | t3: `budget.level="campaign"` → adgroup wire body carries `bid_type:"BID_TYPE_NO_BID"` (builder default), campaign carries the budget; ABO control: no bid_type, budget on adgroup |
| 3c | UTC+0 schedule strings | **PASS** | t2: `schedule_start_time` matches `YYYY-MM-DD HH:MM:SS`, parses AS UTC to within minutes of now (a local-tz emission on this EDT machine would be ~4h off) |
| 3d | Validate gate zero adapter calls | **PASS** | t1: zero tiktok-bound requests (geo/upload/create), zero DB writes, 3 named skipped layers |
| 3e | BALANCE_EXCEED launch passthrough unchanged | **PASS (by construction + suite)** | `git diff 714a5be9e^..HEAD` = 0 lines on BOTH `_shared/tiktok.ts` AND `admin-ad-campaign-action/index.ts` (consumer at index.ts:35/182); WP7 suites 91/91 green incl. "BALANCE_EXCEED maps to an actionable funding warning" |
| 3f | Forced failures + geo | **PASS** | t4a–t4c: 502 naming the step, `campaign/status/update` `operation_status:"DELETE"` rollback where a campaign exists, zero ad-tree rows; t4d: geo_unavailable → loud 422 NAMING the country, zero create calls, zero DB writes |
| 4 | D-1 payload-mislabeling class dead | **PASS with one P2 (see F-1)** | `issue927_tester_adversarial.test.js` (12/12): own-platform label asserted by ITERATING `CREATE_WIRED` (a 6th wired channel without a payload branch reds the suite — the exact historical mutation); exactly one meta-labeled payload in the wired set; every ELIGIBLE `planChannels` row builds an own-labeled payload; runtime cross-check — r2/t2 persisted `ad_campaigns.platform` = `"reddit"`/`"tiktok"` and `dest_smart_link` `pid=reddit_ads`/`pid=tiktok_ads` |
| 5a | Object.hasOwn on creative-type map + CTA allowlist fail CLOSED | **PASS** | s1: `constructor`/`toString`/`__proto__`/`hasOwnProperty`/`valueOf` — map THROWS the named error (never returns the inherited function), CTA returns clean `invalid_cta` (never TypeError); positive controls green |
| 5b | Legacy `objective` stripped from echoed bodies | **PASS** | s2: `snapchatStripReadOnlyFields({objective:…})` drops it, keeps writable fields |
| 6a | CREATE_WIRED widened, market gates enforced | **PASS** | implementor suite 14/14 green; my module probes: NG+GB combined plan excludes BOTH reddit (naira) AND tiktok (UK) with market-reasons (not endpoint-gap copy); US plan admits all five (positive control) |
| 6b | D-3 honest 422 `creative_not_uploaded` for Snapchat media | **PASS** | s3 runtime: profile absent → 424 `snapchat_profile_missing` (zero writes); profile seeded + library row present + NO ready ref → 422 `creative_not_uploaded`, zero DB writes, zero platform calls — an honest fail-close, not a silent failure |
| 7 | Full battery at final commit | **PASS** (see §5) | totals + baseline set-parity below |

## 3. Findings

### F-1 (P2) — the D-1 class is closed at the boundary, not in the builder
- **Evidence:** `mingla-admin/src/lib/adBuilder/payload.js:194-227` — the final branch is an unconditional Meta fallthrough. `buildCreatePayload("pinterest", state)` (or a casing typo like `"TikTok"`) returns `platform:"meta"` today. The CI job name added by `e51873df4` says "the pre-927 mislabeling class is dead" — the five known members are dead; the CLASS survives in the builder.
- **Impact:** none live — the only caller is `CampaignBuilderPage.jsx:292` and its `platform` values come exclusively from `planChannels` rows (⊆ the 5 canonical strings). But the exact historical mutation (add a 6th channel to `CREATE_WIRED` before its payload branch) would silently create a mislabeled Meta campaign again.
- **Containment (tester-shipped):** my suite iterates `CREATE_WIRED` — that mutation now reds CI the moment it lands.
- **Required fix (follow-up, not merge-gating):** make the Meta branch explicit (`if (platform === "meta")`) and throw `unknown_platform` on the fallthrough.
- **Retest:** `buildCreatePayload("pinterest", state)` throws; all five canonical channels unchanged.

### F-2 (P3) — per-ORCH worktree brackets break glob-based gates when run locally
- **Evidence:** 4 strict-grep gates (x-web-deprecation, orch-0939, orch-0931, orch-0943) FAIL when executed from `…/issue-927-[secret-slot-consolidation]` and PASS from a bracket-free worktree of the SAME commit — `[…]` in the cwd is a glob character class. CI is unaffected (checkout paths are bracket-free).
- **Impact:** false regression signals in every locally-run gate battery from a per-ORCH worktree.
- **Required fix:** process note for the worktree strategy (quote/`--`-guard the globs, or run gate batteries from a flat mirror). Routed as a Discovery, not fixed here.

### F-3 (P4, praise) — the failure machinery is real, not decorative
Every forced-failure path (8 scenarios across both channels) produced the exact contract: right step name, right rollback verbs in the right (reverse) order, orphaned-post audit, zero half-written DB rows. The validate gates are airtight to the point of not even minting a token.

### F-4 (P4, praise) — injection resistance is structural
The reddit serializer's allowlist provably drops hostile `configured_status`/pixel/funding injections while still passing allowlisted keys through (and pre-validating them on the wire) — the right shape of defense.

## 4. Step 0.5 — implementor fails-on-revert, independently re-derived (at `3939ae1fd`)

| Proof | Revert performed (line deletion in working tree) | On revert | Restored |
|---|---|---|---|
| #1 reddit-PAUSED persist | `status: "PAUSED",` deleted from the reddit `ad_campaigns` insert (`admin-ad-create-campaign/index.ts:2147`) | implementor suite **FAILED 1/11** — exact assertion: `reddit branch must persist PAUSED on the campaign+ad_set+ad rows; found 2 bare status:"PAUSED" sites`; **cross-check:** my runtime r2 ALSO red (live DB-row assertion) | 11/11 green |
| #2 F-1 hasOwn guard | guard replaced with the direct map lookup (`_shared/snapchat.ts`) | implementor WP5 suite **FAILED 1/5** (`927 F-1: prototype-chain creative types throw creative_type_unmapped`); **cross-check:** my s1 ALSO red | 5/5 green |

## 5. Tester adversarial tests added (on-branch, in the closing diff)

- `supabase/functions/_shared/__tests__/issue927_tester_origin_runtime.test.ts` — 10 tests (leg 1; executes the shipped expressions, not copies).
- `supabase/functions/_shared/__tests__/issue927_tester_adversarial_runtime.test.ts` — 19 tests (legs 2/3/5/6; the REAL edge fn in-process against mock Supabase/Reddit/TikTok).
- `mingla-admin/src/__tests__/issue927_tester_adversarial.test.js` — 12 tests (legs 4/6).
- CI-registered: origin suite appended to the ad-engine deno block; runtime harness as a new step (needs `--allow-net`); node suite as job `issue-927-qa-tester-adversarial`. Both workflows YAML-parse (345 / 17 jobs).
- **Tester fails-on-revert (different line than the implementor's targets):** deleted `conversion_pixel_id: input.conversionPixelId,` from `buildRedditAdGroupBody` (`_shared/reddit.ts:~1688`) → my suite **FAILED 2/19** (r2 wire-pixel + r3), while the implementor's 927 suite stayed **11/11 GREEN** — proving my angle covers ground theirs does not. Restored → 19/19. `fails-on-revert verified at f6265b85c` (tests committed) over tree `3939ae1fd`.
- Commit: `f6265b85c` (token in body). Both the implementor's suites and mine appear in `git diff origin/main...HEAD --name-only`.

## 6. Battery at final commit (tester HEAD, tests-only commits stacked on `3939ae1fd`)

| Suite | Result |
|---|---|
| CI deno workflow — ALL 12 `deno test` run-steps executed VERBATIM | **681 passed / 0 failed** (ad-engine 230, creative-library 206, stripe/notify/appsflyer/scorer/paystack/1361/1362/1363/1365/import-map 245) |
| Ad-engine block re-run as re-registered (+ my origin suite) | **240 passed / 0 failed** |
| Tester runtime harness | **19 passed / 0 failed** |
| Unregistered `_shared` deno suites (96 files, incl. tiktok/snapchat/WP5/WP7) | **927 passed / 26 failed — failure set BYTE-IDENTICAL to an origin/main baseline worktree run** (env-dependent locals: suites that import serve-binding edge fns or need secrets; diff of sorted failure lists = empty) |
| mingla-admin node battery (864 happy + 864 adversarial + 927 widened + 927 tester) | **129 passed / 0 failed** (+ package.json suite green) |
| strict-grep gate battery (every job in `strict-grep-mingla-business.yml`, run-steps verbatim, bash -e) | **branch 344 run / 0 failed** vs **baseline (origin/main `1cf0b80df`) 343 run / 0 failed** — set parity; the +1 is the branch's own new job, green |
| `deno check` (8 touched fns + snapchat/reddit/tiktok shared) | clean ×11 |
| append-only gate at tester HEAD | **9 passed / 0 failed** (`[TEST-MOD-APPROVED ORCH-0927]` carried on every stacked commit) |

**Methodology note on the implementor's "372 gates / 15 failures byte-identical":** not numerically reproducible under a consistent local harness — my verbatim-run-step harness yields 344/0 (branch, bracket-free) vs 343/0 (baseline). Their invariant (no gate regression vs baseline) HOLDS under a single fixed harness; their absolute counts appear to be harness-specific (and 4 of any bracket-path run's failures are the F-2 artifact). Not a defect in the deliverable.

## 7. Constitution (14-rule) matrix

| # | Rule | Verdict | Evidence |
|---|---|---|---|
| 1 | No dead taps | N/A | no new tap targets; wizard rows admitted via existing StepChannels rendering |
| 2 | One owner per truth | PASS | create-status truth owned server-side (builders); wizard sends no status key (my leak test); origin secret canonicalized to ONE name |
| 3 | No silent failures | PASS | geo 422 names countries; job CLIENT_ERROR verbatim; D-3 honest 422; rollback failures recorded in audit rows (r4/r5) |
| 4 | One query key per entity | N/A | no client query keys touched |
| 5 | Server state stays server-side | PASS | no Zustand/store changes |
| 6 | Logout clears everything | N/A | untouched |
| 7 | `[TRANSITIONAL]` labeled | PASS | none introduced (report §11 confirmed by grep) |
| 8 | Subtract before adding | PASS | CREATE_GAP_REASONS emptied; 3 secrets scheduled for deletion; old names kept only as fallback arms with a sweep test banning new bare reads |
| 9 | No fabricated data | PASS | ids refused when providers return none (`create_no_id`, `post_id_missing` paths exercised by mocks) |
| 10 | Currency-aware | PASS | one cents→platform conversion (r2 goal_value micro; t2/t3 dollars post-`centsToPlatformBudget`; floors after conversion re-pinned by implementor suite) |
| 11 | One auth instance | N/A | untouched |
| 12 | Validate at the right time | PASS | UTC+0 schedule proven at runtime (t2) |
| 13 | Exclusion consistency | PASS | market-gate exclusions carry market reasons, not endpoint-gap copy (my NG+GB test) |
| 14 | Persisted-state startup | N/A | no persisted client state |

## 8. Device / parity matrix

| Surface | Verdict | Reason |
|---|---|---|
| Consumer iOS / Android | skipped | no `app-mobile` files in the diff (diff-verified) |
| Business iOS / Android / Web preview | skipped | no `mingla-business` files in the diff; email accept-URLs resolve to the same digest either way (leg-1 runtime proof) |
| Buyer/anonymous Web | PASS (indirect) | checkout/RSVP/reservation return-URL resolution proven value-identical across all env permutations at runtime |
| Admin Web | PASS at module runtime | `planChannels`/`buildCreatePayload` direct probes + edge-fn runtime; full authed wizard browser run = post-deploy smoke (implementor §10, restated in D-3 below) |
| Edge functions (live deploy state) | N/A this round | no deploys (hard guard); orchestrator's binding order-of-ops: merge → redeploy the 8+1 fns → delete 3 secrets → seed `SNAPCHAT_PROFILE_ID` |

Physical-iPhone HITL: not applicable — no consumer/business runtime surface ships in this diff.

## 9. Discoveries for Orchestrator

- **D-QA-1 (from F-2):** per-ORCH worktree names with `[…]` break glob-based gates run locally — 4 false FAILs reproducible on ANY branch. Consider a bracket-free naming convention or a gate-runner that mirrors to a flat path.
- **D-QA-2 (from F-1):** `buildCreatePayload`'s Meta fallthrough — follow-up one-liner (explicit meta branch + throw) closes the D-1 class structurally; my boundary test contains it meanwhile.
- **D-QA-3:** post-deploy smoke remains OWED (implementor §10): one real wizard run creating a paused TikTok + Reddit campaign against the deployed fn with seeded secrets — zero-spend by construction (everything PAUSED/DISABLE, proven at the wire in this QA).
- **D-QA-4 (confirms implementor D-4):** 96 `_shared` deno suites run in NO workflow; 26 of them fail locally for env reasons on main itself. The CI-consolidation research should sweep them in (or mark env-gated).
- **D-QA-5:** implementor's gate-count claims (372/15) are harness-specific (see §6 note) — future reports should name the harness, or CLOSE-gate comparisons will look like discrepancies.
- **Comms:** WARNs 0099/0100/0102/0104/0105/0106/0107 factored; tester acks appended BRANCH-SIDE in this commit (never-push guard, same D-6 pattern as the implementor) — orchestrator reconciles at CLOSE. COMMS-0103 BLOCK verified RESOLVED (merge freeze over).

## 10. Routing

**PASS → CLOSE (orchestrator).** Merge-gating findings: none. F-1(P2)/F-2(P3) → follow-up register. The CLOSE commit must carry `[TEST-MOD-APPROVED ORCH-0927]` (HEAD-only append-only gate) and re-verify against MERGED main per the close gate.
