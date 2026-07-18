# WP-927 IMPLEMENTATION REPORT — secret-slot consolidation + create-function completion

- **Issue:** #927 — Ad Engine ops: secret-store consolidation (origin-URL family 4→1) + create-fn completion (tiktok/reddit/snapchat branches)
- **Branch:** `issue-927-secret-slot-consolidation` (worktree `~/Desktop/mingla-orchs/issue-927-[secret-slot-consolidation]`)
- **Status:** implemented and verified (source + full local battery; live platform behavior deliberately NOT exercised — hard guard)
- **Date:** 2026-07-16

## 1. Summary

Two paired follow-ups shipped in five local commits.

**Part 1 — origin-URL secret consolidation.** Four Function Secrets carry one digest (`BUSINESS_WEB_ORIGIN` = `MINGLA_BUSINESS_WEB_URL` = `MINGLA_PUBLIC_APP_ORIGIN` = `MINGLA_PUBLIC_WEB_BASE_URL`). All 8 reader sites of the three old names (7 files) now read `BUSINESS_WEB_ORIGIN` FIRST with the old name as fallback — behavior is identical whether or not the old secrets exist, so the orchestrator's post-merge deletion of the 3 duplicates (freeing 3 of the 100 hard-capped slots) is safely decoupled. Runtime + source + sweep tests pin the resolution order.

**Part 2 — create-fn completion.** `admin-ad-create-campaign` gains self-contained **TikTok** and **Reddit** create branches (the **Snapchat branch already existed on main** — shipped by WP5 #921 with SWIPES default, delivery_constraint derivation in the adapter, the four create fixes, and the named-skipped-layers validate path; the dispatch's "only meta and google" was stale for snapchat — see §12). The three QA-867-WP5 one-liners landed (`Object.hasOwn` guards F-1/F-2, legacy `objective` strip F-4), each with tests. The wizard's `CREATE_WIRED` widened to all five channels **plus the mandatory payload-builder cascade** (without it, a tiktok allocation posted `platform:"meta"` — a mislabeled Meta campaign; see §12 D-1).

## 2. Success-criteria coverage

| SC | Criterion | Status | Commit |
|---|---|---|---|
| SC-1 | Every reader of the 3 old secret names reads `BUSINESS_WEB_ORIGIN` first with old-name fallback | ✓ (8 sites, 7 files; runtime+source+sweep tests) | `714a5be9e` |
| SC-2 | Deletion decoupled: behavior identical with old secrets present or absent | ✓ (runtime test proves both legs + default) | `714a5be9e` |
| SC-3 | T-7 strict-grep guard semantics untouched; no gate collisions | ✓ (`destSmartLink` stays exactly declaration+insert; 372 gates run, failure set == main's 15) | `6cb7b4841` |
| SC-4 | TikTok create branch per SPEC_ISSUE-863+A1 (DISABLE everywhere, bid_type under CBO, UTC+0) | ✓ (DISABLE ×3 + bid_type default live in the WP7 builders the branch calls; UTC+0 schedule default in `buildTikTokAdGroupBody`; floors after ÷100; live geo AC-13; identity fail-close AC-12; no-validate-only gate) | `6cb7b4841` |
| SC-5 | Reddit create branch per SPEC_ISSUE-REDDIT_CHANNEL (`redditCreateFullChain`, explicit PAUSED ×3, `conversion_pixel_id` injected) | ✓ (branch routes ONLY through the chain — G-1 test proves no hand-rolled body; PAUSED ×3 in builders + persisted rows; pixel id injected unconditionally by the chain from `extra.reddit_pixel_id`, fail-closed via `redditConnExtras`) | `6cb7b4841` |
| SC-6 | Snapchat branch per SPEC_ISSUE-867+A1 (four create fixes, SWIPES, delivery_constraint, named-skipped-layers validate path) | ✓ PRE-EXISTING on main (WP5 #921, verified line-by-line); this branch adds the F-1/F-2/F-4 hardening | `b8d2e8ba6` |
| SC-7 | QA-867-WP5 F-1: `Object.hasOwn` on the creative-type→ad-type map, fails CLOSED | ✓ + test + fails-on-revert | `b8d2e8ba6` |
| SC-8 | QA-867-WP5 F-2: `Object.hasOwn` on the CTA allowlist, clean `invalid_cta` (never TypeError) | ✓ + test | `b8d2e8ba6` |
| SC-9 | QA-867-WP5 F-4: server-echoed legacy `objective` added to `SNAPCHAT_READ_ONLY_ENTITY_FIELDS` | ✓ + test | `b8d2e8ba6` |
| SC-10 | `CREATE_WIRED` → `["meta","google","tiktok","reddit","snapchat"]`; NG/Reddit + GB/TikTok market gates verified with the wider set | ✓ (gates now fire in the DEFAULT plan; 103+14 admin tests green) | `e51873df4` |
| SC-11 | Battery green at full scale, failure set identical to main | ✓ (818 deno + 117 admin node green; strict-grep 372 gates: 15 failures — byte-identical set to origin/main baseline) | all |
| SC-12 | Fails-on-revert: reddit-PAUSED branch line + one `Object.hasOwn` guard | ✓ (§7) | `6cb7b4841`, `b8d2e8ba6` |

## 3. Commits

| Hash | What |
|---|---|
| `714a5be9e` | P1 — origin-secret consolidation (8 sites) + resolution-order suite |
| `b8d2e8ba6` | P2 — WP5 one-liners F-1/F-2/F-4 + suite |
| `6cb7b4841` | P2 — TikTok + Reddit create branches + suite + CI registration |
| `e51873df4` | P2 — CREATE_WIRED widening + payload cascade + 4 test-mods `[TEST-MOD-APPROVED ORCH-0927]` + new suite + CI job |
| `fed3bf811` | COMMS acks (0099/0100/0104/0105/0106/0107) — branch-side (never-push guard) |

## 4. Consolidated-reader list (file:line per old name, post-change)

**`MINGLA_BUSINESS_WEB_URL` (4 sites):**
- `supabase/functions/invite-brand-member/index.ts:583` — `BUSINESS_WEB_ORIGIN ?? MINGLA_BUSINESS_WEB_URL ?? "https://business.usemingla.com"`
- `supabase/functions/invite-scanner/index.ts:383` — same chain
- `supabase/functions/ticket-confirmation-dispatch/index.ts:237` — `PUBLIC_BUYER_BASE_URL ?? BUSINESS_WEB_ORIGIN ?? MINGLA_BUSINESS_WEB_URL ?? default` (the deliberate per-surface override keeps precedence)
- `supabase/functions/_shared/email/claimApprovedEmail.ts:27` — same chain (the runtime-tested reader)

**`MINGLA_PUBLIC_APP_ORIGIN` (1 site):**
- `supabase/functions/marketing-send/index.ts:1381` — `BUSINESS_WEB_ORIGIN ?? MINGLA_PUBLIC_APP_ORIGIN ?? "https://mingla.app"`

**`MINGLA_PUBLIC_WEB_BASE_URL` (3 sites):**
- `supabase/functions/ticket-checkout-create/index.ts:1015` — `BUSINESS_WEB_ORIGIN ?? MINGLA_PUBLIC_WEB_BASE_URL` (fail-close 500 `web_base_url_missing` preserved)
- `supabase/functions/rsvp-contribution-create/index.ts:419` — same
- `supabase/functions/venue-reservation-create/index.ts:608` — same

No constructed-pattern reads of the three old names exist (repo-wide sweep is itself a test: any future bare old-name read fails `issue927_origin_secret_consolidation.test.ts`). All other `MINGLA_BUSINESS_WEB_URL` hits in the repo are the UNRELATED client-side `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL` Expo constant — not Function Secrets, untouched.

## 5. Files changed

| File | Δ |
|---|---|
| `supabase/functions/invite-brand-member/index.ts` | +5/−2 |
| `supabase/functions/invite-scanner/index.ts` | +5/−1 |
| `supabase/functions/ticket-confirmation-dispatch/index.ts` | +6/−1 |
| `supabase/functions/_shared/email/claimApprovedEmail.ts` | +4/−1 |
| `supabase/functions/marketing-send/index.ts` | +4/−1 |
| `supabase/functions/ticket-checkout-create/index.ts` | +6/−2 |
| `supabase/functions/rsvp-contribution-create/index.ts` | +4/−1 |
| `supabase/functions/venue-reservation-create/index.ts` | +4/−1 |
| `supabase/functions/_shared/snapchat.ts` | +15/−2 (F-1/F-2/F-4) |
| `supabase/functions/admin-ad-create-campaign/index.ts` | +1,022 (tiktok + reddit branches + imports) |
| `mingla-admin/src/lib/adBuilder/channelPlan.js` | CREATE_WIRED 5-set, CREATE_GAP_REASONS = {}, comments trued |
| `mingla-admin/src/lib/adBuilder/payload.js` | +120 (three payload branches + TIKTOK_GOAL_DEFAULTS) |
| `mingla-admin/src/pages/CampaignBuilderPage.jsx` | +12 (goal.platforms / creativeLibraryId / brandName pass-through) |
| `mingla-admin/src/__tests__/issue864_campaign_builder_happy.test.js` | 2 tests modified (TEST-MOD) |
| `mingla-admin/src/__tests__/issue864_campaign_builder_tester_adversarial.test.js` | 2 tests modified (TEST-MOD) |
| `.github/workflows/supabase-migrations-and-stripe-deno.yml` | +3 files registered in the ad-engine deno block |
| `.github/workflows/strict-grep-mingla-business.yml` | issue-864 job name trued + new `issue-927-create-wired-widened` job |
| NEW `supabase/functions/_shared/__tests__/issue927_origin_secret_consolidation.test.ts` | 5 tests |
| NEW `supabase/functions/_shared/__tests__/issue927_wp5_hasown_guards.test.ts` | 5 tests |
| NEW `supabase/functions/_shared/__tests__/issue927_create_fn_tiktok_reddit_branches.test.ts` | 11 tests |
| NEW `mingla-admin/src/__tests__/issue927_create_wired_widened.test.js` | 14 tests |
| `COMMS_LEDGER.md` | 6 ack appends |

## 6. Data-model / edge-function surface

- **No migrations. No schema changes. No secret set/unset. No deploys.**
- Edge functions touched (deploy list for the orchestrator, from MERGED main): `admin-ad-create-campaign` (verify_jwt=true), `invite-brand-member` (true), `invite-scanner` (true), `ticket-confirmation-dispatch` (preserve current), `marketing-send` (preserve current), `ticket-checkout-create` (preserve current), `rsvp-contribution-create` (preserve current), `venue-reservation-create` (preserve current). `_shared/snapchat.ts` + `_shared/email/claimApprovedEmail.ts` ride with their importers (`admin-ad-*` snapchat consumers, `admin-review-venue-claim`).
- **Order of operations (binding):** merge → redeploy ALL functions above → orchestrator deletes the 3 duplicate secrets → seed `SNAPCHAT_PROFILE_ID` in the freed slot. Deleting secrets before redeploy breaks the OLD deployed readers (they still read only old names).

## 7. Regression tests + fails-on-revert

- 35 new tests across 4 new append-only files (5 + 5 + 11 + 14), all registered in CI (ad-engine deno block ×3; new node job ×1).
- **fails-on-revert #1 (reddit-PAUSED branch line):** deleted `status: "PAUSED",` from the reddit branch's `ad_campaigns` insert → `issue927_create_fn_tiktok_reddit_branches.test.ts` FAILED 1/11; restored → 11/11. First run of this proof exposed a matcher orphan (`to_status:` satisfying a loose `/status:/` regex — the COMMS-0106 trap class); the matcher was tightened to `(?<![a-z_])status:` and the proof re-run cleanly. Verified at `6cb7b4841`.
- **fails-on-revert #2 (Object.hasOwn guard F-1):** deleted the hasOwn guard (restored the direct map lookup) → `issue927_wp5_hasown_guards.test.ts` FAILED 1/5; restored → 5/5. Verified at `b8d2e8ba6`.
- Append-only gate: `node .github/scripts/test-append-only-check.js` → **6 passed, 0 failed** with `[TEST-MOD-APPROVED ORCH-0927]` on HEAD. **HEAD-only trap (COMMS-0106): every commit stacked on top of `e51873df4` carries the token; any FUTURE commit on this branch (incl. the CLOSE commit) must carry it too or CI reds.**

## 8. Battery results

| Suite | Result |
|---|---|
| Ad-engine deno block (13 files incl. 3 new) | **230 passed / 0 failed** |
| TikTok + Snapchat + creative-library deno suites (unregistered-in-CI but part of the merged battery) | **373 passed / 0 failed** |
| All other CI deno blocks (stripe/notify/marketing/appsflyer/scorer/paystack/mapbox/curated + import-map T-8) | **214 + 1 passed / 0 failed** |
| mingla-admin issue864 happy + tester adversarial | **103 passed / 0 failed** |
| mingla-admin issue927 new suite | **14 passed / 0 failed** |
| strict-grep gates (372 run) | **15 failures — byte-identical set to a pristine origin/main baseline worktree** (i-proposed-a-brands-deleted-filter, tr2×2, x-web-deprecation, i37/38/39, orch-0756a/0769/0770/0776a/0808/0891-perf/0910, orch-1369-adversarial) |
| `deno check` on all touched edge fns | clean |
| mingla-business / app-mobile | **no files touched** (diff-verified) — suites cannot regress |

Total exercised this run: **921 deno/node tests green; zero new failures anywhere.**

## 9. Cross-surface impact

| Surface | Affected | Notes |
|---|---|---|
| Admin Web | YES | Wizard now admits all five channels (plan + payloads); parity manual (admin-only code) |
| Buyer/anonymous Web | Indirect | Checkout/RSVP/reservation return-URL env resolution consolidated — same value either way (same digest) |
| Consumer iOS / Android | NO | No app-mobile changes |
| Business iOS / Android / Web preview | NO | No mingla-business changes (email accept-URLs resolve to the same host) |

## 10. Smoke result

- No live platform calls, no deploys (hard guards). All verification is local: full deno/node battery + gate battery + baseline comparison (§8).
- **UNVERIFIED (needs post-deploy QA):** a real wizard run creating a paused TikTok/Reddit campaign end-to-end (needs deployed fn + seeded secrets + admin session). Everything is created DISABLE/PAUSED, so the first live-fire is zero-spend by construction.

## 11. Known issues / deferred

- **Snapchat remains fail-closed server-side** (`424 snapchat_profile_missing`) until `SNAPCHAT_PROFILE_ID` is seeded in the freed slot — by design; the wizard surfaces the error per-channel.
- Snapchat media through the wizard requires a READY #866 platform ref (`admin-ad-creative-upload` upload leg); StepCreative currently records the library row but does not trigger the per-platform upload — a snap create through the wizard 422s `creative_not_uploaded` (honest fail-close). Routed as a discovery (D-3).
- TikTok review-status ingestion (`ad_review_info`) remains the documented WP7 fast-follow (sync repairs `review_status`).
- No `[TRANSITIONAL]` markers introduced.

## 12. Discoveries for Orchestrator

- **D-1 (P1-grade, fixed in-branch):** widening `CREATE_WIRED` alone would have been a live defect — `buildCreatePayload` had only meta/google branches and its fallback returned `platform:"meta"` for ANY other channel; a tiktok allocation would have created a real (paused) **Meta** campaign labeled tiktok. The payload cascade in `e51873df4` was mandatory, not scope creep; pinned by the "own platform literal" test.
- **D-2 (dispatch-truth correction):** the snapchat create branch already existed on main (WP5 #921) — issue #927's "branches only for meta and google" was stale. Only tiktok + reddit branches were missing.
- **D-3:** wizard→Snapchat media gap (see §11) — suggest a small follow-up wiring StepCreative's record step to fire the per-platform `admin-ad-creative-upload` upload for funded channels.
- **D-4 (CI gap, pre-existing):** the WP5/WP7 suites (`snapchat.test.ts`, `issue867_wp5_*`, `tiktok.test.ts`, `issue863_wp7_*`) are registered in NO workflow — they run only in local batteries. Belongs to the CI-consolidation research already on the anchor (`RESEARCH_CI_ACTIONS_CONSOLIDATION.md`).
- **D-5:** the append-only TEST-MOD token regex accepts only `ORCH-\d{4}` — issue-numbered work must masquerade as `ORCH-0927`. Consider widening the regex to `(ISSUE|ORCH)-\d+` in the gate.
- **D-6:** comms-ledger acks were committed ON THE BRANCH (`fed3bf811`) because the dispatch's never-push guard rules out the direct-anchor-main procedure; reconcile/merge-order-check at CLOSE if other sessions acked the same rows meanwhile.

## 13. Operator action required (post-merge, orchestrator-owned)

1. Merge the PR (all checks green; token on HEAD).
2. Redeploy from merged main: `admin-ad-create-campaign` + the 7 Part-1 functions (§6), preserving each `verify_jwt`.
3. THEN delete the 3 duplicate secrets (`MINGLA_BUSINESS_WEB_URL`, `MINGLA_PUBLIC_APP_ORIGIN`, `MINGLA_PUBLIC_WEB_BASE_URL`) and seed `SNAPCHAT_PROFILE_ID`.
4. No `db push` — zero migrations in this branch.
