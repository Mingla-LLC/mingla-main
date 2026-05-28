# QA Report: ORCH-0986 Paired-Profile Redesign

> Date: 2026-05-28
> Mode: TARGETED + SPEC-COMPLIANCE + SECURITY + iOS/Android parity attempt
> Verdict: FAIL
> Findings: P0:1 P1:2 P2:2 P3:0 P4:3

## 1. Layman Summary

ORCH-0986 cannot ship. The biggest issue is privacy-critical: the production `get_paired_friend_last_location` RPC can be called with the public anon key and returns a paired friend's raw latitude/longitude when the caller provides a paired UUID pair. That violates the feature's core promise that friend GPS stays server-side and is never exposed to the viewer/client.

The backend implementation otherwise has several good pieces: the new batched edge endpoint is deployed, auth-gated, returns no coordinates itself, the curated image mapper is covered by tests, and the new no-GPS adversarial test passes. The required iOS/Android live-fire UI parity could not be completed because the iOS dev build stayed on the Mingla splash after bundle load, and a fresh Android dev build hung during Gradle assembly; this is recorded as unverified, not treated as a pass.

## 2. Inputs Reviewed

- Dispatch: `Mingla_Artifacts/prompts/TESTER_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- Design: `Mingla_Artifacts/reports/DESIGN_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0986_PAIRED_PROFILE_HOLIDAYS.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- Review: `Mingla_Artifacts/reports/REVIEW_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`
- Current worktree HEAD: `b72e17af0`, one local review-report commit above dispatched/pushed HEAD `8a8fb284c`.

## 3. Test Manifest

| Layer | Files / artifacts | What was checked |
|---|---|---|
| Database/RPC | `20260730000002_orch_0986_paired_friend_last_location.sql`, live Supabase RPC | Consent gate, function privileges, anon-call behavior, sparse location data |
| Edge functions | `_shared/personHeroCards.ts`, `get-paired-profile-cards`, `get-person-hero-cards`, `generate-curated-experiences` | Server-side friend location, response shape, no client location, curated image mapping, skipDescriptions |
| Services/hooks | `personHeroCardsService.ts`, `usePairedProfileCards.ts`, `usePairedCards.ts`, `queryKeys.ts` | Single batched request, summary surfacing, no location param, cache behavior |
| Components/screens | `ViewFriendProfileScreen.tsx`, `PersonHolidayView.tsx` | Hero anatomy, bio/message order, no ideal-night-out, states, card truthfulness |
| Tests/CI | Deno tests, strict-grep, app TypeScript | Regression coverage, fails-on-revert, strict invariants |
| Runtime parity | iOS Simulator + Android emulator | Attempted live-fire; blocked before profile surface rendered |

## 4. Verification Performed

| Check | Command / method | Result | Evidence |
|---|---|---|---|
| COMMS ledger | Read and acknowledged open ALL WARN entries | PASS | COMMS-0002/0003/0004 acked on anchor main commit `96fc1c755`; COMMS-0008 treated as awareness context |
| Edge Deno check | `/Users/sethogieva/.deno/bin/deno check ...` | PASS | `get-paired-profile-cards`, `get-person-hero-cards`, `generate-curated-experiences`, implementor test, adversarial test all checked |
| Implementor regression test | `deno test supabase/functions/_shared/personHeroCards.test.ts` | PASS | 3/3 passed |
| Fails-on-revert | Temporary mutation removing curated `raw.imageUrl` + stop-image fallback | PASS | Implementor test failed 2/3 as expected on image assertions |
| Tester adversarial test | `deno test supabase/functions/_shared/personHeroCards.adversarial.test.ts` | PASS | GPS-missing returns `null`; no fallback invented |
| Strict-grep ORCH-0986 | `node .github/scripts/strict-grep/orch-0986-paired-profile.mjs` | PASS | C1 no profile hero heart/save, C2 no client location param, C3 no ideal-night-out |
| Backend allowlist strict-grep | `node .github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` | PASS | Backend touches covered by allowlist |
| App TypeScript | `npx tsc --noEmit`, then grep touched files | PARTIAL | Full repo still fails on existing shared-package/native issues; no touched ORCH-0986 file names appeared in 236-line output |
| Deployed function presence | Supabase `list_edge_functions` | PASS | `get-paired-profile-cards`, `get-person-hero-cards`, `generate-curated-experiences` ACTIVE and auth-gated where expected |
| Unauth edge gate | `curl` no auth to `get-paired-profile-cards` | PASS | HTTP 401 `Missing authorization header` |
| Live sparse data | Read-only SQL | PASS | `user_location_history`: 3 users with rows; only one pairing has location on either side |
| RPC anon leak | `curl` anon PostgREST RPC with known paired UUIDs | FAIL | HTTP 200 returned `latitude`, `longitude`, `captured_at` |
| iOS Simulator live-fire | Metro 8092 + iPhone 17 | BLOCKED | Existing dev build first hit resolver error; symlink workaround loaded bundle but app stayed on Mingla splash |
| Android emulator live-fire | Pixel_8_Pro + fresh `expo run:android --port 8092` | BLOCKED | Gradle assembly produced output for several minutes then hung with no further progress; process killed and generated native dir removed |

## 5. Findings

### P0-001: Production RPC leaks paired friend coordinates to anon callers

- Evidence: `curl -X POST https://gqnoajqerqhnvulmnyvv.supabase.co/rest/v1/rpc/get_paired_friend_last_location` with only the public anon key returned:
  `[{ "latitude": 6.4835822, "longitude": 7.4842913, "captured_at": "2026-04-08T11:24:01.574056+00:00" }]`
- Evidence: the request used a real paired UUID pair from `pairings`: viewer `8905106f-656d-4ee9-b7f0-a993e937a790`, friend `1bb79276-a2b0-4728-b36a-3eb00801b6a3`.
- What is wrong: the RPC exposes the raw friend GPS that the SPEC says must stay server-side. The consent gate only checks that the supplied UUIDs are paired; it does not prove the caller is the viewer, and anon access should not be possible at all.
- Impact: privacy breach and direct violation of I-0986-NO-COORD-LEAK / I-0986-FRIEND-GPS-ONLY. Anyone with/guessing paired UUIDs can retrieve friend coordinates through the REST RPC surface.
- Required fix: make the RPC non-callable from anon/client surfaces. Preferred: revoke execute from `anon` and `authenticated`, grant only to `service_role`, and keep all calls inside edge functions. If direct authenticated RPC access is intentionally retained, the function must enforce `auth.uid() = p_viewer_id` and still revoke anon. Retest by proving anon returns 401/403 and authenticated wrong-actor returns zero/error.

### P1-001: Mandatory iOS/Android live-fire parity remains unverified

- Evidence: iOS screenshot `/tmp/orch0986-ios-launch.png` showed a Metro resolver error for `expo-router/entry`; after local symlink workaround, `/tmp/orch0986-ios-home.png` stayed on the Mingla splash. Android emulator booted, but a fresh `npx expo run:android --port 8092` build hung during Gradle assembly and was killed.
- What is wrong: the SPEC and dispatch required proven-level live-fire on both simulator surfaces. I could not reach the paired profile screen on either platform.
- Impact: SC-1..7, SC-10, SC-12, SC-16..18 are not runtime-proven. This alone prevents PASS/CONDITIONAL PASS, even without P0-001.
- Required fix: provide a known-good current dev build or unblock local native builds, then rerun iOS and Android with a paired test user that can open both populated and missing-GPS paired profiles.

### P1-002: Shuffle tap appears wired to stale per-section cache, not the batched profile cache

- Evidence: `CardRow` reads cards from `profileCards.sections[...]` via `usePairedProfileCards` (`PersonHolidayView.tsx:876`, `934`, `966`, `1007`). `useShufflePairedCards` writes the shuffle result into `personCardKeys.paired(...)`, an old per-section key (`usePairedCards.ts:120-123`), then `CardRow` merely calls `refetchProfile()` (`PersonHolidayView.tsx:391-395`), which refetches default batched cards rather than the shuffle result.
- What is wrong: the visible row shuffle control likely does not update the rendered row with the shuffled result.
- Impact: likely dead tap / misleading interaction on every recommendation row.
- Required fix: either write the shuffle result into the `personCardKeys.pairedProfile(...)` section slice, or remove/disable the shuffle button from batched rows until the batched endpoint supports section-level shuffle semantics.

### P2-001: Tester adversarial test is present but not committed/pushed as part of the implementation commit

- Evidence: added `supabase/functions/_shared/personHeroCards.adversarial.test.ts` during QA; `git status --short` shows it uncommitted.
- Impact: it is valid local QA evidence, but not yet part of the scoped branch history.
- Required fix: after P0/P1 rework, include this or equivalent GPS-missing/consent/no-leak test in the implementation branch commit.

### P2-002: Current worktree HEAD differs from dispatch HEAD

- Evidence: dispatch named `8a8fb284c`; current worktree is `b72e17af0` with one review-report-only commit above origin.
- Impact: low code risk because the extra commit only changes `REVIEW_ORCH-0986_PAIRED_PROFILE_REDESIGN.md`, but the mismatch should be normalized before close.
- Required fix: push or intentionally drop the local review-report commit per orchestrator preference.

## 6. Spec Traceability

| Criterion | Status | Evidence | Finding |
|---|---|---|---|
| SC-1 | UNVERIFIED | iOS/Android did not reach profile screen | P1-001 |
| SC-2 | CODE PASS, RUNTIME UNVERIFIED | `ViewFriendProfileScreen.tsx:400-417`; grep found no `Ideal night out` | P1-001 |
| SC-3 | PARTIAL | Profile hero has no heart/save; strict-grep C1 PASS. Birthday liked-places footer still uses heart icon by design | P1-001 |
| SC-4 | CODE PASS, RUNTIME UNVERIFIED | `isPaired` gates only `PersonHolidayView` at `ViewFriendProfileScreen.tsx:435-454`; hero chrome outside gate | P1-001 |
| SC-5 | CODE PASS, RUNTIME UNVERIFIED | Birthday card is white card with liked-places + calendar at `PersonHolidayView.tsx:897-929` | P1-001 |
| SC-6 | AUTOMATED PASS, RUNTIME UNVERIFIED | `curatedCardToCard` reads real `imageUrl`/stop image; Deno tests pass; producer adds top-level `imageUrl` | P1-001 |
| SC-7 | CODE PASS, RUNTIME UNVERIFIED | `stopsData` mapped into `stops` for curated taps at `PersonHolidayView.tsx:493` | P1-001 |
| SC-8 | CODE PASS, RUNTIME UNVERIFIED | One `usePairedProfileCards` query at top; rows consume slices, not per-section hooks | P1-001 |
| SC-9 | PASS | `skipDescriptions: true` in `planComboForHoliday` request | None |
| SC-10 | CODE PASS, RUNTIME UNVERIFIED | Skeleton row at `PersonHolidayView.tsx:423-429` | P1-001 |
| SC-11 | FAIL | Edge omits coords, but public anon RPC returns raw friend coords | P0-001 |
| SC-12 | CODE PASS, RUNTIME UNVERIFIED | `locationStatus === "missing"` replaces rows with GPS empty card; adversarial test covers no fallback | P1-001 |
| SC-13 | PARTIAL | SQL has pairing gate, but caller identity is not enforced and anon can call RPC | P0-001 |
| SC-14 | CODE PASS, RUNTIME UNVERIFIED | Price/rating hidden when null/≤0 at `PersonHolidayView.tsx:319-335` | P1-001 |
| SC-15 | PASS | Service returns `summary`; endpoint preserves per-section `summary.emptyReason` | None |
| SC-16 | CODE PASS, RUNTIME UNVERIFIED | Error card + retry at `PersonHolidayView.tsx:432-441`; section failures map to `section_error` | P1-001 |
| SC-17 | PARTIAL | Code has accessibility labels for key profile controls; touch target review not runtime-verified | P1-001 |
| SC-18-iOS | FAIL/UNVERIFIED | Could not complete simulator path | P1-001 |
| SC-18-Android | FAIL/UNVERIFIED | Could not complete emulator path | P1-001 |

## 7. Test Case Traceability

| Test | Result | Evidence |
|---|---|---|
| T-01 | PASS | Implementor Deno test; fails-on-revert confirmed |
| T-02 | PASS | Implementor Deno test; UI runtime unverified |
| T-03 | CODE PASS | Null price/rating hidden in `CompactCard`; runtime unverified |
| T-04 | PARTIAL PASS | No profile hero save/heart; birthday liked-places heart icon remains |
| T-05 | FAIL | Location centered server-side, but RPC leaks coordinates to anon |
| T-06 | PARTIAL PASS | Tester adversarial test proves no fallback in helper; UI runtime unverified |
| T-07 | PARTIAL/FAIL | Pairing gate exists, but caller identity/anon access flaw remains |
| T-08 | FAIL | Edge response omits coords, but RPC response leaks coords |
| T-09 | CODE PASS | `stopsData -> stops` mapping present; runtime tap unverified |
| T-10 | CODE PASS | Single batched profile query; runtime network count unverified |
| T-11 | CODE PASS | Section error maps to `section_error`; runtime unverified |
| T-12 | CODE PASS | Driving radius + `skipDescriptions`; live populated combo unverified |
| T-13-iOS | BLOCKED | Simulator did not reach app surface |
| T-13-Android | BLOCKED | Emulator build did not complete |

## 8. Security

| Check | Severity | Result |
|---|---|---|
| Edge auth gate | P0 if failed | PASS: no-auth `get-paired-profile-cards` returns HTTP 401 |
| Friend coordinate leakage | P0 | FAIL: anon REST RPC returns latitude/longitude |
| Friend-GPS-only server side | P0 if failed | FAIL as a privacy boundary because RPC exposes GPS client-side |
| Consent gate | P0 if failed | PARTIAL: pair existence checked, caller identity not checked |
| No fabricated data | P0 if failed | PASS by code/tests for curated images and single price/rating |

## 9. UX / Accessibility

| Screen/state | Result | Notes |
|---|---|---|
| Profile hero + sheet | UNVERIFIED | iOS/Android could not reach screen |
| Skeleton | CODE PASS | Coherent skeleton row exists |
| Populated | UNVERIFIED | Live UI blocked; backend populated path not authenticated via edge |
| No-cards | CODE PASS | `summary.emptyReason` no-cards card exists |
| Friend-GPS-missing | CODE PASS, RUNTIME UNVERIFIED | Helper test + UI card exists |
| Error | CODE PASS, RUNTIME UNVERIFIED | Retry card exists |

## 10. Required Actions

1. P0-001: Lock down `get_paired_friend_last_location` so anon cannot execute it and raw coordinates cannot be fetched from the client-side REST RPC surface. Retest with anon key and wrong-actor authenticated calls.
2. P1-001: Re-run proven iOS and Android live-fire after the privacy fix, with one paired friend that has a location row and one paired friend without a location row.
3. P1-002: Rewire or remove row shuffle so the visible control updates the batched profile cache or is no longer shown.

## 11. Conditional / Recommended Actions

1. Commit the tester adversarial test (or equivalent) with the rework.
2. Normalize/push/drop local review-report commit `b72e17af0` before close.
3. Keep COMMS-0008 merge coordination: the ORCH-0978 migration files ride ORCH-0986 as source reconciliation only.

## 12. Discoveries For Orchestrator

- The RPC privacy issue is not a cross-ORCH discovery; it belongs directly to ORCH-0986 rework.
- The simulator/runtime blockers may be local dev-build/environment issues, but they still prevent the required proof level.

---

# RETEST (Claude mingla-tester) — 2026-05-28 — VERDICT: CONDITIONAL PASS

Re-test at HEAD `52649714e` after the orchestrator-executed rework. P0:0 P1:0(open) P2:0(open) — the prior P0 is independently proven fixed; the only remaining gap is environment-blocked UI live-fire (deferred, not a code defect).

## Prior FAIL findings — re-verification

### P0-001 (RPC coord leak) — FIXED, INDEPENDENTLY PROVEN
- Re-ran the QA's exact anon attack myself: `POST /rest/v1/rpc/get_paired_friend_last_location` with the public anon key + the same paired UUIDs (`8905106f…` / `1bb79276…`) → **HTTP 401 `{"code":"42501","message":"permission denied for function get_paired_friend_last_location"}`**. No `latitude`/`longitude` in the response. (Previously: HTTP 200 with raw coords.)
- ACL after fix (`pg_proc.proacl`, read independently): `{postgres=X/postgres,service_role=X/postgres}` — only owner + `service_role` hold EXECUTE; `anon`/`authenticated`/PUBLIC have none.
- Migration `20260730000003_orch_0986_lock_friend_location_rpc.sql` applied to remote.
- Edge path intact: functions call via the service-role admin client, which retains EXECUTE; no redeploy needed (grant-only change). Verdict on P0: **PASS (proven, backend-verifiable)**.

### P1-002 (shuffle dead tap) — FIXED at code level (suspected; UI not live-fired)
- `useShufflePairedCards` now writes the shuffle result into `personCardKeys.pairedProfile(pairedUserId, mode)` via `setQueryData` (the slice the UI reads), not the legacy per-section key (`usePairedCards.ts:122-123`). `CardRow.handleShuffle` passes the active `mode` and no longer calls `refetchProfile()` (`PersonHolidayView.tsx:394-395`). Code-correct. Runtime confirmation pending live-fire (see blocker).

### P2-001 (adversarial test) — RESOLVED
- `supabase/functions/_shared/personHeroCards.adversarial.test.ts` is committed + allowlisted. Regression suite re-run by me: **4 passed / 0 failed** (3 implementor happy-path incl. fails-on-revert + 1 adversarial GPS-missing → returns null, different angle from the implementor's curated-mapping test).

### P2-002 (branch push) — RESOLVED (HEAD `52649714e` on origin).

## P1-001 (iOS/Android live-fire) — STILL BLOCKED (environment, not code) → `probable`
- I started Metro on 8092 and launched `com.mingla.app.v2` on booted iPhone 17 Pro. The app shows a **red Metro resolver error**: `Unable to resolve module ./mingla-main/app-mobile/node_modules/expo-router/entry`. Screenshot `/tmp/orch0986_ios_state2.png`.
- **Named root cause:** `app-mobile/node_modules` in this worktree is a SYMLINK to `~/Desktop/mingla-main/app-mobile/node_modules` (the spawn.sh optimization). Metro resolves the symlink and can't locate `expo-router/entry` relative to the worktree. This is the same blocker the prior tester hit. It is a tooling/environment issue, NOT an ORCH-0986 code defect.
- Android leg: no AVD booted; prior session's `expo run:android` hung at Gradle.
- Consequence: the app cannot reach login → paired profile, so a Maestro UI flow is impossible. SC-1..7, SC-10, SC-12, SC-14, SC-16..18 remain CODE-PASS / RUNTIME-UNVERIFIED.

## Unblock options (to reach `proven` PASS)
1. Remove the worktree node_modules symlink and run a real `npm install` in `app-mobile/` (spawn.sh symlink breaks Metro+expo-router here), then re-run iOS + Android Maestro live-fire with a paired test user that has a `user_location_history` row (only the `8905106f…`/`1bb79276…` pairing currently has one) AND one without.
2. OR Seth verifies on his physical device: open a paired friend's profile, confirm the new hero/quote-bio/Message-beneath layout, tap Shuffle and confirm the row updates, and confirm the friend-GPS-missing empty state for a friend with no location.

## Verdict rationale
The prior FAIL was caused by the P0 coordinate leak — that is independently proven fixed. Backend, security, and regression are solid. The remaining gap is on-device UI confirmation of the visual redesign + shuffle, blocked by a worktree tooling issue. Per the live-fire gate, PASS requires `proven` UI repro, which the environment blocks. **CONDITIONAL PASS** — requires Seth's explicit acceptance of the UI-live-fire deferral (or completion of an unblock option above) before CLOSE.

## Regression-test gate
- Implementor happy-path: `supabase/functions/_shared/personHeroCards.test.ts` (fails-on-revert confirmed). Tester adversarial: `supabase/functions/_shared/personHeroCards.adversarial.test.ts` (different angle). Both on branch `52649714e`. Gate SATISFIED.
