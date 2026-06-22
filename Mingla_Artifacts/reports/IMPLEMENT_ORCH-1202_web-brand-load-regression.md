# IMPLEMENT — ORCH-1202 [business-web brand-load regression]

**Skill:** mingla-implementor (claude)
**Date:** 2026-06-21
**Worktree:** `~/Desktop/mingla-orchs/1201-[web-brand-load-regression]` on branch `1202-web-brand-load-regression`
**SPEC (binding):** `Mingla_Artifacts/specs/SPEC_ORCH-1202_web-brand-load-regression.md`
**Investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1202_web-brand-load-regression.md`
**Status:** implemented and verified (gate + jest + fails-on-revert proven). NO deploy/merge/OTA.

---

## 1. Summary

On a cold business-web load, ~20 React Query hooks that read `auth.uid()`-scoped tables fired BEFORE the Supabase JWT attached, cached the RLS-empty `200 + []` as success, and never refetched — so authed sections (TopBar bell, partner/team, Ari, marketing, venue suite) showed empty/zero until a manual reload. This fix folds `isAuthReady` (from `useAuth()`) into each hook's React Query `enabled` so the query stays *disabled* (reads as loading) until auth is ready, then fires WITH the JWT — mirroring the proven `useBrands.ts` shape. The disabled-state query key routes through a `DISABLED_KEY` sentinel.

The structural cure is making the ORCH-1004 CI gate **fail-closed**: a completeness check now walks every `mingla-business/src/hooks/**` query hook and FAILS CI if any is in neither `AUTH_SCOPED_HOOK_FILES` nor `PUBLIC_HOOK_ALLOWLIST`. The curated list went stale (~20 hooks added, none registered, CI green) — that can no longer recur.

Pure-JS; ships to web via Vercel `[deploy]` at CLOSE; rides the next business native build. **NO `eas update`** (COMMS-0052 BLOCK, re-affirmed).

---

## 2. SPEC success-criteria coverage

| SC | Criterion | Status | Evidence / commit |
|----|-----------|--------|-------------------|
| SC-1 (Web) | DELTA-1-backed sections render loading→data, no manual reload; bell shows correct unread on first paint after auth | ✓ (mechanism proven; live authed-web eyeball deferred to Seth per investigation OQ-4) | runtime cache proof (B), `54ead2297` |
| SC-1-iOS/Android | Same hooks fire only after isAuthReady; no native regression (rides next build) | ✓ gate+jest; native eyeball deferred | `54ead2297` |
| SC-2 (per-hook gate) | Each of 20 DELTA-1 hooks folds isAuthReady; disabled queryKey is a sentinel; gate passes for all 61 | ✓ | gate PASS (61/8), `54ead2297` |
| SC-3 (completeness, fail-closed) | Every src/hooks query hook is classified; an unregistered hook FAILS CI with the §4.C message | ✓ | gate `checkCompleteness`; fails-on-revert demo below, `54ead2297` |
| SC-4 (allowlist preserved) | No public hook gated; `checkPublicNotGated` passes for all 8 | ✓ | `isAuthReady` count 0 in all 3 new public hooks; gate PASS, `54ead2297` |
| SC-5 (no behavior drift) | No staleTime/queryFn/key-factory/realtime/refetch changed; diff only useAuth import + isAuthReady fold + disabled-key sentinel | ✓ | per-file receipts §7; diffstat | 
| SC-6 (carve-outs preserved) | `useBrandBanks` + `useBuyerRefundPreview` stay ungated; their files still pass via co-resident gated hook | ✓ | verified ungated; gate PASS for both files, `54ead2297` |

---

## 3. Files changed (26)

**Hook layer — 20 DELTA-1 files (each: + `useAuth` import, fold `isAuthReady` into `enabled`, DISABLED_KEY sentinel for disabled state):**
`useBrandInvitations.ts` (3 hooks), `useScannerInvitations.ts` (2), `useBrandPaystack.ts` (`useBrandPaystackStatus` only — `useBrandBanks` carve-out untouched), `useBrandTaxRegistration.ts`, `useBusinessNotifications.ts` (+ realtime subscription gated on `enabled`), `useNotificationTypePrefs.ts`, `useMinglaToSAcceptance.ts`, `useAriPreferences.ts`, `useConversationList.ts`, `usePartnerSplits.ts` (2), `usePartnerBrandLinks.ts`, `usePartnerStripe.ts` (`usePartnerStripeStatus`), `useTripEditLog.ts`, `useTripHasWebPurchases.ts`, `useVenueClaimFeedback.ts` (2 — dropped `"__none__"` fallbacks), `useCancelTripBooking.ts` (`useOperatorRefundPreview` only — `useBuyerRefundPreview` carve-out untouched), `marketing/useCampaigns.ts`, `marketing/useCampaignReport.ts`, `marketing/useTemplate.ts`, `marketing/useStarterTemplates.ts`.

**CI gate:** `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` (+37 auth-scoped entries, +3 public allowlist entries, fail-closed completeness check + detection regex + broadened `enabled\w*` detection for named-variable folds + extended self-test).

**Tests:** `mingla-business/src/hooks/__tests__/orch1202AuthScopedHookCompleteness.test.ts` (NEW, 9 tests); `orch1004AllowlistIntegrity.test.ts` (lock-step regex sync, `[TEST-MOD-APPROVED ORCH-1202]`); `useBusinessNotificationsInbox.test.ts` + `orch_1142_clearRead_scope.tester_adversarial.test.ts` (pure-addition AuthContext mock — collateral fix).

**Invariant:** `Mingla_Artifacts/INVARIANT_REGISTRY.md` (DRAFT `I-PROPOSED-1202-AUTH-SCOPED-HOOK-COMPLETENESS`).

Diffstat: 26 files, +584 / -42.

---

## 4. Data-model / edge / migration changes

NONE. No DB, edge function, RLS, migration, or service change. Hook-layer + CI only. No `db push` / edge-deploy handoff required.

---

## 5. Regression tests added

- `mingla-business/src/hooks/__tests__/orch1202AuthScopedHookCompleteness.test.ts` — 9 tests:
  - (A) source-assert: `useBusinessNotifications` + 4 sample DELTA-1 hooks fold `isAuthReady`.
  - (B) runtime cache proof (real `@tanstack/query-core` v5.100.6 + verbatim QueryClient defaults): ungated strands `[]` (`queryFnCalls===1`, `finalDataLength===0`); gated loads the row (`finalDataLength===1`).
  - (C) completeness: fixture collection (useQuery in, useMutation/useQueryClient/re-export out) + live-gate "no orphans".
- Gate `--self-test`: 6 enabled-detection cases (incl. named-variable fold) + 6 completeness detection-robustness cases + a temp-fixture completeness case. All pass.

**fails-on-revert verified at `54ead2297`** (true LINE DELETION, not comment-out) — see §9.

---

## 6. Old → New receipts (representative; pattern identical across all 20)

### useBusinessNotifications.ts (highest-blast — always-mounted TopBar bell)
- **Before:** `const enabled = userId !== null;` — fired pre-auth; realtime subscription early-returned only on `userId === null` (opened a pre-auth channel).
- **Now:** `const { isAuthReady } = useAuth(); const enabled = isAuthReady && userId !== null;`; realtime hook takes `enabled` and early-returns on `!enabled || userId === null` (deps array `[userId, enabled, queryClient]`). queryKey sentinel already `DISABLED_KEY`.
- **Why:** SC-1/SC-2 — stop the pre-auth fire that cached the RLS-empty bell count.
- **Lines:** ~9.

### useBrandPaystack.ts
- **Before:** `useBrandPaystackStatus` had `enabled: typeof brandId === "string" && ...` + queryKey `status(brandId ?? "none")`.
- **Now:** lifted `const enabled = isAuthReady && typeof brandId === "string" && ...`; queryKey `enabled ? status(brandId) : DISABLED_KEY` (dropped `?? "none"`). `useBrandBanks` (static NUBAN list, carve-out) UNCHANGED.
- **Lines:** ~8.

### useVenueClaimFeedback.ts (2 hooks)
- **Before:** queryKey fell back to `brandKeys.feedback("__none__")`.
- **Now:** `const enabled = isAuthReady && brandId !== null && Boolean(followUpAt)`; queryKey `enabled && brandId !== null ? feedbackKey : DISABLED_KEY` (dropped `"__none__"`). `feedbackKey` const preserved (used by the mark-fixed optimistic mutation).
- **Lines:** ~10.

(All other DELTA-1 files: same shape — `useAuth` import + `isAuthReady &&` fold + DISABLED_KEY sentinel; staleTime/queryFn/key-factory/refetch untouched.)

### Gate (.mjs)
- **Before:** opt-in curated list (24 + 5); a new auth-scoped hook silently missed.
- **Now:** 61 auth-scoped + 8 public; `checkCompleteness` walks every query hook and fails CI if unclassified; detection regex `\buseQuery(?!Client)\s*[<(]` / `\buseInfiniteQuery\s*[<(]`; `ENABLED_USES_IS_AUTH_READY` broadened to `const\s+enabled\w*\s*=` (named-variable fold).

---

## 7. Cross-surface impact

| Surface | Affected | Parity |
|---------|----------|--------|
| Consumer iOS / Android | No | separate codebase |
| Buyer/anon Web | No (protected) | allowlist additions keep public hooks ungated |
| Business iOS / Android | Yes (rides next native build) | automatic (shared hook code) |
| Admin Web | No | separate app |
| **Business Web (primary)** | **Yes** | automatic (shared); ships via Vercel `[deploy]` |

---

## 8. Smoke / gate results (real output)

```
$ node .github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs --self-test
ORCH-1004 gate self-test PASS (all cases, incl. ORCH-1202 completeness + named-variable fold).

$ node .github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs
ORCH-1004 gate PASS: all 61 auth-scoped hooks gate enabled on isAuthReady; 8 public/dual-use hooks left ungated (buyer-web protected). ORCH-1202 completeness: every src/hooks query hook is classified.

$ npx jest orch1202AuthScopedHookCompleteness
Tests: 9 passed, 9 total

$ npm run test:orch-1004
ORCH-1004 gate self-test PASS ... / ORCH-1004 gate PASS: all 61 ... 
PASS src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts (12 tests)
FAIL src/hooks/__tests__/authScopedQueryReadiness.test.ts  ← PRE-EXISTING (see Known Issues)

$ npx jest src/hooks/__tests__/
Test Suites: 2 failed, 23 passed, 25 total
Tests: 1 failed, 143 passed, 144 total
   (the 2 failing suites — brandListState.test.ts, authScopedQueryReadiness.test.ts —
    fail IDENTICALLY on the anchor origin/main: 2 failed / 1 passed. PRE-EXISTING.)

$ npx tsc --noEmit  → 0 errors in any ORCH-1202-touched file
   (only pre-existing packages/phone-input/* errors remain — out of scope, untouched)
```

### Fails-on-revert proof (SPEC §9 step 5) — at `54ead2297`

**Revert 1 (per-hook):** deleted `isAuthReady && ` from `useBusinessNotifications.ts` `const enabled` (true line deletion via perl):
- gate → exit 1: `useBusinessNotifications.ts: isAuthReady is imported but not wired into an "enabled" computation.`
- jest (A) → FAIL at the `const\s+enabled\s*=\s*isAuthReady\s*&&\s*userId !== null` assertion.
- restored (`git checkout`) → gate exit 0.

**Revert 2 (completeness, fail-closed):** added `mingla-business/src/hooks/useOrchProbeUnregistered.ts` calling `useQuery`:
- gate → exit 1: `ORCH-1202 completeness: unregistered query hook "useOrchProbeUnregistered.ts" — it calls useQuery/useInfiniteQuery but is in neither AUTH_SCOPED_HOOK_FILES nor PUBLIC_HOOK_ALLOWLIST. ...`
- jest (C) "no orphans" → FAIL.
- removed fixture → gate exit 0, working tree clean.

---

## 9. Known issues / deferred

- **Pre-existing test transform failures (NOT introduced):** `brandListState.test.ts` + `authScopedQueryReadiness.test.ts` fail under node/ts-jest because they transitively import `AuthContext.tsx` → `react-native`/`expo-constants` (ESM not in `transformIgnorePatterns`). PROVEN pre-existing: both fail identically on the anchor `main`. Out of ORCH-1202 scope (DO-NOT-TOUCH: those files / jest.config). Flagged for orchestrator.
- **Collateral fixed:** adding `useAuth` to `useBusinessNotifications.ts` newly pulled AuthContext into 2 tests that did not mock it (`useBusinessNotificationsInbox.test.ts`, `orch_1142_clearRead_scope.tester_adversarial.test.ts`); fixed with a pure-addition `jest.mock("../../context/AuthContext")` (isAuthReady:true → behaviorally identical to pre-1202). Both PASS.
- **Live authed-web eyeball (investigation OQ-4):** the literal user-visible cure on a real authed web session is for Seth to confirm post-deploy (mechanism is runtime-proven).

---

## 10. Operator action required

- **NO migration / edge deploy.** Hook + CI only.
- **NO `eas update`** for mingla-business (COMMS-0052 BLOCK) — ship web via Vercel `[deploy]` at CLOSE; pure-JS fix rides the next business native build.
- At CLOSE: flip `I-PROPOSED-1202-AUTH-SCOPED-HOOK-COMPLETENESS` DRAFT → ACTIVE; update WORLD_MAP.

---

## 11. Deviations from SPEC (with justification)

1. **Gate `ENABLED_USES_IS_AUTH_READY` regex broadened to `const\s+enabled\w*\s*=`** (not in the SPEC). Root cause: DELTA-2 hook `useSupportStaff.ts` (DO-NOT-TOUCH, already-gated) uses `const enabledQuery = isAuthReady && ...` → `enabled: enabledQuery`, which the original narrow regex did not detect. The SPEC required registering `useSupportStaff.ts` but its naming would have FAILED the per-hook check. The gate-only broadening (within the scoped allowlist) recognizes the valid named-variable fold WITHOUT editing the DO-NOT-TOUCH hook (preserves SC-5). Self-test case added; fails-on-revert holds.
2. **`orch1004AllowlistIntegrity.test.ts` regex updated (lock-step sync)** — the tester test replicates the gate regex (its line-47 contract: "drift is caught by..."). Broadening #1 forced this mirror update. It is a constant sync, not an assertion deletion; committed with `[TEST-MOD-APPROVED ORCH-1202]` per the append-only rule. Same invariant asserted, accurate predicate.
3. **2 existing tests got a pure-addition AuthContext mock** (collateral from the new `useAuth` import; no deletions, append-only-safe). Documented §9.

No scope widening, no DO-NOT-TOUCH hook edited, no public hook gated, no carve-out gated.

---

## 12. Discoveries for Orchestrator

- The node/ts-jest config can't transform `react-native`/`expo-constants` ESM, so ANY hook test that imports an AuthContext-using hook without mocking AuthContext fails on a transform error (not an assertion). As more hooks adopt `useAuth`, this will recur. Consider a shared AuthContext jest mock or a `transformIgnorePatterns` allowance — separate from ORCH-1202.
- F-7 (stale-chunk "reload to load" tail) remains unaddressed (investigation OQ-3) — separate low-priority thread.
