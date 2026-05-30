# SPEC — ORCH-1004 Business web data reliability (full sweep)

Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1004_BIZ_WEB_DATA_RELIABILITY.md`. Operator decisions: **full sweep** + **proceed on existing proof** (no live repro). Read the investigation first — RC-1/RC-2/RC-3 are proven there.

## Goal
Auth-scoped data never fires unauthenticated and never caches an RLS-empty result as success. After the fix: a cold load (incl. slow networks) shows loading → real data without manual refresh; buyer-web public pages are unchanged.

## Part 1 — Gate every auth-scoped hook on session readiness 🔒LOCKED

The gate signal already exists: `const { isAuthReady } = useAuth();` (`isAuthReady === true` ⟺ `authStatus === "signed_in_ready" && session.access_token` present — see `src/utils/authReadiness.ts`).

For each AUTH-SCOPED hook below, fold `isAuthReady` into the EXISTING `enabled` computation (preserve the `DISABLED_KEY` queryKey pattern so a not-ready query reads as loading per invariant `I-DISABLED-QUERY-IS-LOADING`, ORCH-0889):

```ts
const { isAuthReady } = useAuth();
const enabled = isAuthReady && /* existing predicate, e.g. */ brandId !== null && brandId.length > 0;
```

AUTH-SCOPED hooks to gate (verify each reads an RLS auth.uid()-scoped table/RPC before gating):
`useTrips` (useTripsByBrand + useTrip detail if auth), `useBusinessEvents`, `useServerDraftEvents`, `useBrandOfferingCounts`, `useAuditLog`, `useExperiencesByBrand`, `usePendingExperiences`, `useOrderInstallments`, `useTripOrders`, `useEventWaitlist`, `useIntakeSchema`, `useBrands` (accountId — lists the user's brands), `useBrandStripeStatus`, `useBrandStripeBalances`, `useBrandStripeBankVerification`, `useBrandStripeOrphanedRefunds`, `useAudienceList`, `useBrandCustomers`, `useEventBuyers`, `useMarketingOverview`, `useUserTemplates`, `useManualInstallmentActions`, `useAgentChat`. `useCurrentBrandRole` already gates on `userId` — tighten to `isAuthReady`.

DO NOT gate (genuinely public — buyer-web depends on anon reads; proven anon-readable: `events`, `brands`):
`usePublicEvents`, `usePublicTripBySlug`, `useBrand` (shell brand, anon-readable). If any hook is dual-use (public + auth), split or leave public — never break the anon buyer path.

## Part 2 — Stop the bootstrap timeout from stranding a late session 🔒LOCKED

`src/context/AuthContext.tsx` ORCH-0887-A/A-2: post-timeout it IGNORES late `INITIAL_SESSION`/`TOKEN_REFRESHED`/`USER_UPDATED` (lines ~269–301), so the real session is discarded for the page load → gated queries stay disabled (loading) until refresh.

Change: when a late PASSIVE event arrives post-timeout WITH a usable session, APPLY it (`setSession`/`setUser`, clear `bootstrapTimedOutRef`) so `isAuthReady` flips true and the gated queries fire — BUT preserve the ORCH-0887-A protections: do NOT re-run the `SIGNED_IN`-only recovery + first-event analytics block (those stay gated to explicit `SIGNED_IN`). The flash/duplicate-analytics concern the ignore was built for is met by applying session state without the SIGNED_IN side-effects. Update the locked `src/context/__tests__/AuthContext.timeout.test.ts` under `[TEST-MOD-APPROVED ORCH-1004]` to assert the NEW behavior (late session is applied, not ignored; no duplicate first-event analytics).

## Part 3 — Prevention gate 🔒LOCKED
New `.github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs` (+ CI job in `strict-grep-mingla-business.yml` + `test:orch-1004` npm script): every hook that reads an auth-scoped table/RPC must gate `enabled` on `isAuthReady`. Implement with an allowlist of public hooks; self-test + npm-wiring check (mirror `orch-1001-no-native-turbomodule-in-web-bundle.mjs`).

## Step 0.5 tests 🔒LOCKED
- Happy-path: a hook-level test proving a representative auth-scoped hook is DISABLED (not fetching) when `isAuthReady` is false and ENABLED when true (fails-on-revert: ungating re-enables the pre-auth fetch).
- Adversarial (different angle): the strict-grep gate driven against planted fixtures (auth-scoped hook missing the gate → FAIL; public allowlisted hook → PASS; missing npm wiring → FAIL) + a test asserting `usePublicEvents`/`usePublicTripBySlug` are NOT gated (buyer-web protected).

## Acceptance / `/goal`
- `npx tsc --noEmit` clean for touched files; `test:orch-1004` green; existing CoverPicker/auth tests green (except the pre-existing `eventCoverVideoProcessingService.compression.test.ts` baseline failure, out of scope).
- No public/anon hook gated (buyer-web unaffected).
- Web export builds; a headless probe of a cold load shows gated surfaces render loading→(data when authed) with no unauthenticated request firing for auth-scoped tables.
- `[deploy]` tag on close (mingla-business web surface).

## Hard guards
No out-of-scope edits; do not weaken RLS; do not change the queryClient retry/staleTime globally (the gate is the fix, not cache-tuning); preserve the ORCH-0887-A anti-flash / no-duplicate-analytics protections; keep `verify_jwt`/edge functions untouched (none in scope).
