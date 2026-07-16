# WP6-916 REWORK NOTE — QA_ISSUE-916_WP6 findings

**Rework commit:** `0ff39026f` (on `issue-916-reddit-ads-channel`, after QA commit `79cb8adf4`)
**Author:** mingla-implementor+claude · **Date:** 2026-07-15
**Scope discipline:** ONLY the failing finding fixed (+ the dispatch's optional same-pass P3); no scope expansion. No live platform calls, no deploys, no migrations, nothing pushed.

## Per-finding status

### QA-916-1 (P1) — failed connect bricks every reconnect → **FIXED**
**What failed:** `admin-ad-connect` persists the explicit `external_account_id: 'unconfigured'` sentinel on any failed connect; `redditConnectPreflight` then honoured that persisted value as a step-4 account PIN, so after one transient failure every reconnect died at step 4 (`No ad account matching ^(t2|a2)_ found…`) until manual DB surgery. Fail-close had become fail-forever.

**Fix (both halves the dispatch mandated):**
1. `supabase/functions/_shared/reddit.ts` (step 4): a persisted `conn.external_account_id` pins discovery ONLY when it matches `REDDIT_AD_ACCOUNT_ID_REGEX` (`^(t2|a2)_`); the sentinel and any junk fall through to discovery. Implemented as a single guard line so a one-line revert reproduces the bug exactly:
   `if (persistedAccountId && !REDDIT_AD_ACCOUNT_ID_REGEX.test(persistedAccountId)) persistedAccountId = null;`
2. `supabase/functions/admin-ad-connect/index.ts` (belt-and-braces): `markRedditInvalid` now writes a prior account id through the same regex — only a real `^(t2|a2)_` id survives an invalid-row upsert; anything else collapses to the explicit sentinel. The reconnect path therefore treats a non-matching persisted id as absent on BOTH sides.

**Regression test:** the tester's pre-staged `ADV-A12 [P1 QA-916-1]` in `issue916_wp6_tester_adversarial.test.ts` UNIGNORED per the QA §3 retest instruction (`ignore: true` line deleted — the only change to that file; commit body carries `[TEST-MOD-APPROVED ORCH-0916]`; the file is PR-new so the origin/main closing diff remains pure-addition). It passes post-fix.

**Fails-on-revert verified at `0ff39026f`:** true single-line deletion of the guard → `ADV-A12 … FAILED` (16 passed, 1 failed); restored → 17/17. (The tester's local-stack repro — fail → reconnect 200 without DB surgery — is the RETEST leg and stays tester-owned.)

### QA-916-2 (P2) — AC-R-27 batch reads → **ACCEPTED AS DEFERRED (orchestrator ruling; no code change)**
Registered as a follow-up: *list-endpoint batching for `admin-ad-campaign-sync`'s Reddit ad reads, volume-triggered (revisit when pending-Reddit-ad count pressures the 400 reads/60s pool; today's sweep is bounded at 50, oldest-first, 1 GET per entity).* For the orchestrator to file at CLOSE.

### QA-916-3 (P3, optional same-pass) — currency-invalid reason response-only → **FIXED**
`markRedditInvalid` now persists the failure cause on the invalid row (`extra.last_error`) for ALL THREE failure classes (pre-flight step errors incl. the GR-72 currency reason, missing-secrets/mint failures, provider `AdApiError`s) — an admin reloading later sees why the row is invalid, not just that it is. Response bodies unchanged.

### QA-916-4 (P3, registry TDZ) — **NOT MINE TO FIX** (pre-existing WP1-era class across meta/google/reddit; QA routes it to a hygiene ORCH — D-4).

## Verification at `0ff39026f`
- Full battery: **209/209** (the QA's 208 + ADV-A12 now live) across all 10 ad-engine suites, CI-parity env (all credentials empty).
- `deno check` clean on both touched product files.
- Strict-grep gates: `issue-862-reddit-configured-status-explicit` PASS · `issue-862-ad-token-env-server-only` PASS (16 names, 7 trees clean).
- Append-only: no test line modified anywhere except the tester-pre-staged `ignore: true` deletion (authorized above); my `reddit.test.ts` untouched.
- Working tree clean; CI itself still dead repo-wide (COMMS-0103) — local runs are the proof.

## Files changed (rework commit)
| File | Δ | Why |
|---|---|---|
| `supabase/functions/_shared/reddit.ts` | +11/−1 | QA-916-1 pin guard (step 4) |
| `supabase/functions/admin-ad-connect/index.ts` | +21/−11 | QA-916-1 belt-and-braces + QA-916-3 `extra.last_error` |
| `supabase/functions/_shared/__tests__/issue916_wp6_tester_adversarial.test.ts` | −1 | ADV-A12 unignored (tester-pre-staged) |

*Routing: back to mingla-tester for RETEST (ADV-A12 green here; the local-stack fail→reconnect-200 repro is yours), then orchestrator REVIEW/CLOSE — carrying the QA-916-2 follow-up registration and the QA §10 discoveries (D-1 SPEC amendment on suggestions, D-3 G-1 hardening, D-4 TDZ hygiene ORCH).*
