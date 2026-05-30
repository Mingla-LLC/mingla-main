# IMPLEMENTATION — ORCH-1004 [Business web data reliability]

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1004-[biz-web-data-reliability]/` · **Branch:** `ORCH-1004-biz-web-data-reliability`
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-1004_BIZ_WEB_DATA_RELIABILITY.md`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1004_BIZ_WEB_DATA_RELIABILITY.md`
**Status:** implemented and verified · **Surface:** business-web (primary), business-iOS/Android (shared hooks). Buyer/anon-web UNCHANGED.

---

## Goal recap
Auth-scoped data must never fire unauthenticated and never cache an RLS-empty result (HTTP 200 + `[]`) as success. After the fix a cold load (incl. slow networks) shows loading → real data with no manual refresh; buyer-web public pages are unchanged.

---

## Cross-surface impact (Step 3.5)
- **Business iOS / Android / Web** — AFFECTED. Shared `src/hooks/*` + `AuthContext.tsx`; parity is automatic (single code path). Web is the primary symptom surface (URL persists across refresh → authed routes load directly into the pre-auth race). The fix is identical on all three.
- **Buyer/anon Web** — UNAFFECTED by design. The public hooks (`usePublicEvents`, `usePublicTripBySlug`, `usePublicTripById`, `useBrand` single-by-id, dual-use `useIntakeSchema`) are left ungated; verified anon RLS policies still serve them (see Deviations).
- **Consumer iOS/Android** — UNAFFECTED (`app-mobile/` untouched).
- **Admin Web** — UNAFFECTED (`mingla-admin/` untouched).

---

## Part 1 — Gate every auth-scoped hook on `isAuthReady`

Each auth-scoped hook now reads `const { isAuthReady } = useAuth();` and folds it into the EXISTING `enabled` (`enabled = isAuthReady && <existing predicate>`), preserving the hook's `DISABLED_KEY` queryKey pattern so a not-ready query reads as loading (I-DISABLED-QUERY-IS-LOADING, ORCH-0889). Template: `useEventOrders` (`!loading && session !== null`).

### Hooks GATED (24 query hooks across 19 files) — with the RLS surface each reads

| File | Query hook(s) gated | Auth-scoped surface (verified) |
|------|--------------------|-------------------------------|
| `useTrips.ts` | `useTripsByBrand`, `useTrip` | `events` (RLS) via `business_management_events_view` `security_invoker=true` + trip sidecars |
| `useBusinessEvents.ts` | `useBusinessEventsForBrand`, `useBusinessEventById` | `business_management_events_view` (`security_invoker=true`) + `events` (RLS) |
| `useServerDraftEvents.ts` | `useServerDraftsForBrand`, `useServerDraftById` | already gated on `isAuthReady` (pre-existing) — no change needed; registered in gate list |
| `useBrandOfferingCounts.ts` | `useBrandOfferingCounts` | RPC `pg_brand_offering_counts` (SECURITY DEFINER, brand-access-scoped) |
| `useAuditLog.ts` | `useAuditLog` | `audit_log` (RLS `user_id = auth.uid()`) |
| `useExperiencesByBrand.ts` | `useExperiencesByBrand` | `venue_experiences` (RLS auth.uid()-scoped) |
| `usePendingExperiences.ts` | `usePendingExperiences` (pending query) | pending experience proposals (RLS auth.uid()-scoped) |
| `useOrderInstallments.ts` | `useInstallmentsForOrder`, `useInstallmentsForBrandTrips` | `order_installments` (RLS auth.uid()-scoped) |
| `useTripOrders.ts` | `useTripOrders` | `orders` (RLS auth.uid()-scoped, organiser-only) |
| `useEventWaitlist.ts` | `useEventWaitlist` | `waitlist_entries` (RLS auth.uid()-scoped) |
| `useBrands.ts` | `useBrands` (list) | `brands` via authenticated "Account owner can select own brands" policy. **`useBrand` single-by-id left UNGATED** — `brands` has anon "Public can read non-deleted brands" policy (buyer-web). |
| `useBrandStripeStatus.ts` | `useBrandStripeStatus` | tightened existing `loading+user+session` gate to also require `isAuthReady`; status edge call auth.uid()-scoped |
| `useBrandStripeBalances.ts` | `useBrandStripeBalances` | tightened existing gate to also require `isAuthReady`; balances edge call auth-scoped |
| `useBrandStripeBankVerification.ts` | `useBrandStripeBankVerification` | `stripe_external_accounts` (RLS auth.uid()-scoped) |
| `useBrandStripeOrphanedRefunds.ts` | `useBrandStripeOrphanedRefunds` | orphaned-refund history (RLS auth.uid()-scoped) |
| `useManualInstallmentActions.ts` | `useRecentReminderForOrder` | reminder ledger (RLS auth.uid()-scoped) |
| `useAgentChat.ts` | `messagesQuery` | agent conversation messages (RLS auth.uid()-scoped) |
| `useCurrentBrandRole.ts` | role query | `brand_team_members` + `brands` + `creator_accounts` (RLS auth.uid()-scoped); tightened from `userId !== null` to `isAuthReady` |
| `useEventOrders.ts` | (template) | `orders` — already gated `!loading && session !== null`; registered in gate as the proven session-gate equivalent |
| `marketing/useAudienceList.ts` | `useAudienceList` | buyer rollups (`resolveBrand/EventBuyers`, RLS auth.uid()-scoped) |
| `marketing/useBrandCustomers.ts` | `useBrandCustomers` | brand buyer rollup (RLS auth.uid()-scoped) |
| `marketing/useEventBuyers.ts` | `useEventBuyers` | event buyer rollup (RLS auth.uid()-scoped) |
| `marketing/useMarketingOverview.ts` | `useMarketingOverview` | funnel counters (RLS auth.uid()-scoped) |
| `marketing/useUserTemplates.ts` | `useUserTemplates` | user-authored templates (RLS auth.uid()-scoped) |

### Hooks LEFT PUBLIC (allowlisted — NOT gated, buyer-web depends on them)

| File | Reason (verified anon RLS) |
|------|----------------------------|
| `usePublicEvents.ts` | anon-readable `events` via `business_public_events_view` (`security_invoker=false`) — buyer-web feed |
| `usePublicTripBySlug.ts` | published-trip anon RLS on trip sidecars — buyer-web |
| `usePublicTripById.ts` | published-trip anon by id — buyer-web |
| `useBrand.ts` (single) | `brands` "Public can read non-deleted brands" policy `{anon}` — public brand shell |
| `useIntakeSchema.ts` | **dual-use**: `trip_intake_schemas` has `trip_intake_schemas_anon_select` for published trips; buyer checkout-trip intake pages (`app/checkout-trip/[tripEventId]/{buyer,intake}.tsx`) read it anonymously. See Deviation D-1. |

---

## Part 2 — AuthContext late-session fix (RC-3)

**File:** `src/context/AuthContext.tsx` (`onAuthStateChange` listener, `if (bootstrapTimedOutRef.current)` block).

**Before:** after the 3s bootstrap-timeout, EVERY late passive event (`INITIAL_SESSION` / `TOKEN_REFRESHED` / `USER_UPDATED`) was IGNORED with an early `return;`. The real session that finally resolved was discarded → `isAuthReady` stayed false → every gated query stayed disabled (loading) until a manual refresh.

**After:** when a late passive event arrives WITH a usable session (`hasUsableBusinessSession(s)`), the handler clears `bootstrapTimedOutRef` and FALLS THROUGH to the shared `setSession`/`setUser` writes — so `isAuthReady` flips true and gated queries fire WITHOUT a manual refresh. A late passive event with NO usable session is still ignored (stale echo). The recovery deliberately does NOT re-enter the `SIGNED_IN`-only recovery + first-event analytics block (that stays gated to `_event === "SIGNED_IN"`), so the ORCH-0887-A anti-flash / no-duplicate-analytics protection is preserved (no `ensureCreatorAccount` re-run flash, no duplicate `af_login`/Mixpanel `Login`).

**Test update:** `src/context/__tests__/AuthContext.timeout.test.ts` (locked file). Cases 15/17/18 previously asserted the ignore-all behavior ("ignoring" warn strings + early `return;`); they now assert the apply-if-usable behavior + preserved invariants (isPassiveLateEcho union still lists all 3 passive events and excludes SIGNED_IN/SIGNED_OUT; SIGNED_IN recovery block still gated). Modified under `[TEST-MOD-APPROVED ORCH-1004]` (the change includes deleted lines → append-only CI gate requires the token in the commit body). All 18 tests pass.

---

## Part 3 — Prevention gate

**File:** `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` (+ CI job in `.github/workflows/strict-grep-mingla-business.yml` + `test:orch-1004` npm script in `mingla-business/package.json`).

Mirrors `orch-1001-no-native-turbomodule-in-web-bundle.mjs` (self-test + npm-wiring check). The gate carries a curated `AUTH_SCOPED_HOOK_FILES` list (every hook in the Part 1 table) and a `PUBLIC_HOOK_ALLOWLIST` (each with a one-line anon reason). For every auth-scoped hook it requires either the proven session-gate template (`!loading && session !== null`) OR `isAuthReady` both read from `useAuth()` AND wired into an `enabled` computation. For every allowlisted public hook it FAILS if the hook gates on `isAuthReady` (buyer-web protection). Cross-checks that no file is in both lists.

- `--self-test` → `PASS (6/6 cases)`.
- live run → `PASS: all 24 auth-scoped hooks gate enabled on isAuthReady; 5 public/dual-use hooks left ungated (buyer-web protected).`

---

## Step 0.5 regression tests

### Happy-path — `mingla-business/src/hooks/__tests__/authScopedQueryReadiness.test.ts`
Behavioral hook test using this repo's manual React-hook harness convention (mock `react`/`@tanstack/react-query`/`useAuth`/service; capture the options passed to `useQuery`). Proves `useTripsByBrand` is DISABLED + reads `DISABLED_KEY` when `isAuthReady` is false, ENABLED + reads `tripKeys.listByBrand(brandId)` when true, and still DISABLED when authed-but-`brandId===null`.

**Passing run:** `Tests: 15 passed` (combined with adversarial below).

**Fails-on-revert:** verified at commit `074d4787da88c8611fa4aa53e41e0f75955ff51a`. Reverting the gate in `useTrips.ts` (removing `isAuthReady &&` from `enabled`) → happy-path test FAILS:
```
> 95 |     expect(call.enabled).toBe(false);
Test Suites: 1 failed, 1 total · Tests: 1 failed, 2 passed
```
Fix restored; test passes again.

### Adversarial (different angle) — `mingla-business/src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts`
Attacks the prevention gate from the outside: (1) classifies planted fixtures the way the gate does (auth-scoped hook missing gate → ungated; gated hook → gated; dead-import → ungated; npm-wiring present/absent detection); (2) runs the gate `--self-test` as a subprocess (asserts `self-test PASS`); (3) runs the LIVE gate against the real repo (asserts `gate PASS` — throws on non-zero exit); (4) reads the REAL `usePublicEvents`/`usePublicTripBySlug`/`usePublicTripById` and asserts they are NOT gated, plus asserts the gate file allowlists `useBrand.ts` + dual-use `useIntakeSchema.ts` with anon reasons.

**Passing run:**
```
PASS src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts
PASS src/hooks/__tests__/authScopedQueryReadiness.test.ts
Test Suites: 2 passed, 2 total · Tests: 15 passed, 15 total
```
**Fails-on-revert:** the adversarial test's subprocess "live gate exits 0" assertion is wired to the gate; reverting any auth-scoped hook makes the gate exit 1 (proven directly: ungating `useTrips.ts` → `gate FAILED ... exit=1`), which makes `execFileSync` throw and the adversarial test fail.

### AuthContext test fails-on-revert
Reverting the apply-path (`applying late session (ORCH-1004)` → ignore) made the AuthContext.timeout test FAIL at Case 15 (line 424). Fix restored; all 18 pass.

---

## Verification matrix (`/goal`)

| Clause | Result | Evidence |
|--------|--------|----------|
| `tsc --noEmit` clean for touched files | PASS | Zero errors in any `src/hooks/` or `src/context/` file. Only errors are pre-existing in out-of-scope `packages/phone-input/` (untouched — clean git status). |
| `test:orch-1004` green | PASS | self-test 6/6 + live gate PASS + jest 15/15. |
| Existing auth tests green | PASS | `authReadiness`, `brandStripeStatusAuthGate`, `brandListState`, `useTrips`, `useBrands.orch_0964` → 20/20. |
| CoverPicker tests green | PASS | `CoverPicker.*` 3 suites + `eventCoverVideoProcessingService.test.ts` PASS. |
| Only allowed pre-existing failure | CONFIRMED | `__tests__/services/eventCoverVideoProcessingService.compression.test.ts` fails on `supabase.auth.getSession` mock (out of scope; identical on main). |
| Web export builds | PASS | `npx expo export -p web` → `Web Bundled ... 652 modules` exit 0; build dir deleted (not committed). |
| No public/anon hook gated | PASS | 5 public hooks allowlisted; adversarial test asserts they are ungated. |
| RLS not weakened; queryClient retry/staleTime unchanged | PASS | No migration / RLS / queryClient edits. The enabled-gate is the only fix. |
| No edge-function / migration changes | CONFIRMED | None in scope; none made. |

---

## Invariant preservation
- **I-DISABLED-QUERY-IS-LOADING (ORCH-0889):** preserved — every gated hook keeps its `DISABLED_KEY` (or `enabled: false`) so a not-ready query reads as loading, not empty.
- **ORCH-0887-A / A-2 anti-flash + no-duplicate-analytics:** preserved — passive late-session recovery does NOT run the `SIGNED_IN`-only block; the `isPassiveLateEcho` union still excludes SIGNED_IN/SIGNED_OUT.
- **I-AUTH-BOOTSTRAP-TIMEOUT:** preserved — the 3s Promise.race + Symbol sentinel + timeout branch unchanged.

## Cache safety
No query keys changed. The DISABLED_KEY patterns are preserved exactly. No staleTime/retry tuning.

## Regression surface (for tester)
1. Cold business-web load on a throttled network → loading → real data, no manual refresh (RC-1/RC-2/RC-3 combined).
2. Buyer-web public pages (`/e/{brand}/{event}`, `/b/{brand}`, `/t/{brand}/{trip}`, checkout-trip intake) still render anonymously.
3. Sign-out → sign-in transition still repopulates without flash or duplicate analytics.
4. Trip dashboard / Money / Marketing / Audit surfaces populate after auth on first paint.

---

## Deviations from SPEC
- **D-1 — `useIntakeSchema` left UNGATED (dual-use).** The SPEC Part 1 gate list included `useIntakeSchema`, but the dispatch hard guard ("confirm it reads an RLS auth.uid()-scoped table/RPC; if genuinely public/dual-use, leave the public path working") overrides. DB probe proved `trip_intake_schemas` has an **`anon_select` policy for published trips**, and `useTripIntakeSchemasByEvent` is consumed by the anonymous buyer checkout-trip intake pages (`app/checkout-trip/[tripEventId]/buyer.tsx` + `intake.tsx`). Gating it on business `isAuthReady` would break anon buyer-web intake. It is therefore allowlisted as public/dual-use, with the reason recorded in the gate file. `useTripIntakeSchemaByTier` has no callers (dead).
- No other deviations. `useBrand` (single) and `useBusinessEvents` were handled exactly per SPEC (the former left public per the SPEC's explicit instruction; the latter gated — its management view is `security_invoker=true`, the public feed is `usePublicEvents`).

## Discoveries for orchestrator
- **`useTripIntakeSchemaByTier` is dead code** (no callers in `app/` or `src/`). Out of scope to remove here; flagging for a future cleanup ORCH.

## Files changed
- 19 hook files gated (Part 1 table); `useServerDraftEvents.ts` already gated (registered only).
- `src/context/AuthContext.tsx` (Part 2) + `src/context/__tests__/AuthContext.timeout.test.ts` (`[TEST-MOD-APPROVED ORCH-1004]`).
- `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` (new) + `.github/workflows/strict-grep-mingla-business.yml` (job) + `mingla-business/package.json` (`test:orch-1004`).
- `mingla-business/src/hooks/__tests__/authScopedQueryReadiness.test.ts` (new, happy-path) + `mingla-business/src/hooks/__tests__/orch1004AuthScopedQueryGate.test.ts` (new, adversarial).
