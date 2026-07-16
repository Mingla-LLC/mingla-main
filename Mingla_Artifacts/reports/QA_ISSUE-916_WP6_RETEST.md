# QA RETEST — ISSUE-916 WP6 · Reddit Ads Channel (after REWORK `0ff39026f`)

**Verdict: PASS** — P0: 0 · P1: 0 · P2: 0 unresolved (QA-916-2 accepted-as-deferred by orchestrator ruling, follow-up registered) · **P3: 1 new** (QA-916-5, non-blocking) · P4: 1
**Tester:** mingla-tester+claude · **Date:** 2026-07-15 · **Retest cycle: 1**
**Worktree:** `~/Desktop/mingla-orchs/issue-916-[reddit-ads-channel]` · branch `issue-916-reddit-ads-channel` · HEAD at retest start `28773bcb1` (fix `0ff39026f`, rework note `Mingla_Artifacts/implementation/WP6-916-REWORK-NOTE.md`)
**Previous report:** `QA_ISSUE-916_WP6.md` @ `79cb8adf4` (FAIL — P1 QA-916-1)
**Environment:** LOCAL stack only (`supabase start` after order-preserving temp renames — COMMS-0102 factored — restored byte-identical, git-clean verified; scenario-switched mock Reddit; dummy creds; cold-cache functions serve). **No live Reddit call was needed or made this round. No deploys, nothing pushed, append-only respected.** Phase 0.A sim gate: exempt — backend/edge-only.

## 0. Adversarial-suite integrity (dispatch precondition)

`git diff 79cb8adf4..28773bcb1 -- issue916_wp6_tester_adversarial.test.ts` shows **exactly one deletion: the `ignore: true,` line on ADV-A12** — the unignore I pre-staged in QA §3. Nothing else in the file changed; `reddit.test.ts` untouched; both test files remain in `git diff origin/main...HEAD --name-only`. **Integrity confirmed.**

## 1. Per-finding re-verification

### QA-916-1 (P1, was the FAIL) → **FIXED — runtime-proven, no DB surgery**
- **Fix inspected:** `reddit.ts:2334` guard (`persistedAccountId` honored only when `^(t2|a2)_`; single-line revert target) + `admin-ad-connect` belt-and-braces (junk collapses to the sentinel; a valid prior id survives).
- **Leg 1 — the exact QA §3 repro sequence (cold token cache):**
  1a. mint-fail connect → **424** + invalid row `acct='unconfigured'` (sentinel persists as data, correct);
  1b. secrets fixed, reconnect **on the intact row** → **HTTP 200**, row `connected|true|a2_jcfwvnfcfqcs` — **zero database surgery between 1a and 1b** (the pre-fix behavior was a permanent step-4 424).
- **Leg 1b — valid-id preservation:** happy connect, then a currency failure → invalid row **keeps `acct='a2_jcfwvnfcfqcs'`** (belt-and-braces); happy reconnect → 200.
- **Preflight un-poisoned:** `admin-ad-preflight` against a row in the previously-bricking state (`invalid|unconfigured`) now returns **overall green, P1–P6 pass** (same guarded function).
- **Regression test live:** ADV-A12 unignored and passing (17/17).

### QA-916-2 (P2, AC-R-27 batch reads) → **ACCEPTED AS DEFERRED** (orchestrator ruling per rework note §QA-916-2 + this RETEST dispatch; volume-triggered follow-up to be filed at CLOSE). No code change expected or made.

### QA-916-3 (P3, reason response-only) → **FIXED — all three failure classes runtime-proven**
- PreflightError class (NGN): invalid row `extra.last_error` = the GR-72 currency message verbatim.
- AdNotConnectedError class (mint/secrets, cold cache): `extra.last_error` = the secrets/mint detail.
- AdApiError class (provider 400 on `/me`): `extra.last_error` = `"mock provider 400: me endpoint rejected"` verbatim.

### QA-916-4 (P3, registry TDZ) → unchanged, correctly routed to the hygiene ORCH (not this WP).

## 2. Step 0.5 — independent re-run of the implementor's fails-on-revert (rework)

At HEAD `28773bcb1`: true single-line deletion of `reddit.ts:2334` (the pin guard) → **ADV-A12 FAILED (16 passed, 1 failed)** — the bricked-reconnect bug reproduces exactly; implementor's `reddit.test.ts` unaffected (58/58, as expected — the guard is my suite's line). Restored → **17/17**; working tree byte-identical (git status clean). Matches the rework note's claim.

## 3. New findings from the rework

### P3 QA-916-5 — stale `last_error` survives onto the CONNECTED row
- **Evidence:** Leg 1b/2b — after a failure then a successful reconnect, the connected row still carries the OLD failure in `extra.last_error` (the success upsert spreads `priorExtra` without clearing it). `admin-ad-connect/index.ts` happy-path `extra: { ...priorExtra, … }`.
- **Impact:** minor — `status='connected'` is the authoritative signal; but any surface that renders `extra.last_error` shows a stale failure on a healthy connection.
- **Required fix (follow-up, non-blocking):** strip/null `last_error` in the success-path upsert.
- **Retest:** fail → reconnect → connected row must carry no `last_error`.

### P4 — praise: the fix is exactly the requested shape — a single greppable guard line with the belt-and-braces half, no scope creep, and the pre-staged regression test wired in with a clean `[TEST-MOD-APPROVED]` trail.

## 4. Full battery at final state

- **209/209 deno tests** across all 10 ad-engine suites, CI-parity env (ADV-A12 now counted — the QA round's 208 + 1).
- Strict-grep gates: reddit-configured-status PASS + self-test PASS; ad-token-env-server-only PASS (16 names, 7 trees clean).
- `deno check` clean on both touched product files + the adversarial suite.
- Stack torn down (`supabase stop --no-backup`), scratch removed, migration renames restored byte-identical, tree clean. CI still dead repo-wide (COMMS-0103) — local runs are the proof; re-run workflows after the billing fix.

## 5. Deferred live-fire conditions (unchanged — the orchestrator's supervised window, QA §6)

1. First real **PAUSED create chain + PATCH-DELETED reverse rollback** (settles: job-payload id key name, keyword/geo validation wire shapes, carousel card internals, any server-side budget floor; starts the review-SLA clock).
2. **AC-R-13 live launch leg** (top-down ACTIVE, 200+warning, immediately re-paused/rolled back).
3. First real **rejection / INVALID_MEDIA** observation (verbatim persistence against live prose).
4. **Suggestions endpoint stays unpinned** (live reads proved silent-param-ignore + account-seeding; pin via Reddit docs/support only — D-1 SPEC amendment stands).
5. **Crawler-permissiveness of the creative master-URL host against Reddit's fetcher** (COMMS-0102 Meta lesson).

## 6. Routing

**PASS → CLOSE (orchestrator)**, carrying: the QA-916-2 volume-triggered follow-up registration, new P3 QA-916-5 (one-line follow-up, may ride any later Reddit pass), the QA §10 discoveries (D-1 suggestions SPEC amendment · D-2 30/60s pools · D-3 G-1 per-builder hardening · D-4 TDZ hygiene ORCH · D-5 duplicate-prefix cascade urgency), the edge-deploy list (4 fns, `verify_jwt=true`, from MERGED main), and the §5 supervised live-fire window as the channel's final activation gate.
