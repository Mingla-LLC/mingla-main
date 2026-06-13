# IMPLEMENTATION — ORCH-1133 [mingla-business root-layout "Maximum update depth exceeded" infinite render loop]

- **Verdict: SUSPECTED (source-only). NO PATCH APPLIED.**
- **Date:** 2026-06-13
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1133-[biz-root-render-loop]/`
  on branch `ORCH-1133-biz-root-render-loop`, at `907b2b2a0` (== `origin/main`; confirmed 0 ahead / 0 behind).
- **Disposition:** STEP-1 PROVE-THE-CYCLE failed to close. Per the dispatch's hard
  guard — *"If you cannot prove the exact loop cycle from source, STOP and report
  rather than guess"* and *"do not patch the auth backbone on a guess"* — I did
  **not** modify any file, did not write a regression test against an unproven
  seam, and did not run gates on a non-change. The auth/session backbone is
  byte-identical to `origin/main`.

---

## 1. Summary (plain English)

The reported crash is a `useSyncExternalStore`-driven render loop in the
`mingla-business` web root shell. The forensics investigation
(`INVESTIGATE_ORCH-1132_MAX_UPDATE_DEPTH.md`) reached **SUSPECTED** and asked
the implementor to elevate it to **PROVEN** from source before touching the auth
backbone. I read every file in the root render path and could **not** trace a
closed, deterministic loop. Every classic loop shape the dispatch enumerated is
already guarded in the current code (and one prior instance of this exact loop —
ORCH-1062 — was already fixed). The loop is therefore **state-flicker /
timing-dependent**, which by definition cannot be proven from source alone and
requires a live-fire repro. I am stopping and reporting, not patching.

---

## 2. The crash (restated)

```
Maximum update depth exceeded. ... setState inside componentWillUpdate/componentDidUpdate ...
```
- **Component stack:** `... TabsLayout → ... → RootLayoutInner → AuthProvider → QueryClientProvider`
- **JS stack:** `forceStoreRerender → enqueueConcurrentRenderForLane → batchUpdates → commitHookEffectListMount → commitLayoutEffectOnFiber → flushLayoutEffects → commitRoot → performSyncWorkOnRoot`
- `forceStoreRerender` is React's internal `useSyncExternalStore` callback (the
  subscription primitive behind **both** Zustand and React Query v5). Its presence
  at the top means an external store's snapshot changed between a render and that
  render's layout-commit, forcing a synchronous re-render — and it kept happening.

---

## 3. Files read (full root render path — every line)

| File | Role in the loop hypothesis |
|---|---|
| `mingla-business/app/_layout.tsx` | `RootLayoutInner` + `RootLayout` — the shell. The L353-411 deadline-tick cluster + the splash/timeout/eviction/reap setState effects. |
| `mingla-business/src/context/AuthContext.tsx` | `useAuth` value source (Context, not an external store). |
| `mingla-business/src/store/currentBrandStore.ts` | Zustand store + `useCurrentBrandId` / `useCurrentBrandHasHydrated` selectors. |
| `mingla-business/src/hooks/useCurrentBrandRecovery.ts` | Composes auth + brands + creator-account and WRITES `setCurrentBrandId` — the prime suspect edge. |
| `mingla-business/src/utils/currentBrandResolver.ts` | Pure resolver `resolveCurrentBrandId`. |
| `mingla-business/src/hooks/useBrands.ts` | `useBrand` / `useBrands` React Query + Realtime + `useSoftDeleteBrand` (carries the ORCH-1062 fix). |
| `mingla-business/src/hooks/useCreatorAccount.ts` | `default_brand_id` source for the resolver. |
| `mingla-business/src/hooks/usePushPermissionMoment.ts` | Root-mounted effect keyed on `currentBrandId`. |
| `mingla-business/src/wrappers/KeyboardRoot.tsx` (+ `.web`) | Web passthrough Fragment / native provider. |
| `mingla-business/app/(tabs)/_layout.tsx` | `TabsLayout` — the literal rendering frame in the crash stack; ALSO calls `useCurrentBrandRecovery()`. |
| `mingla-business/src/hooks/useResponsiveLayout.ts` | `useWindowDimensions` consumer feeding `TabsLayout`. |
| `mingla-business/src/hooks/useCurrentBrandRole.ts` | Rank source for `TabsLayout`. |

---

## 4. STEP 1 — PROVE THE CYCLE: result for each classic shape

The dispatch named five shapes (a)–(e). Each was checked against the actual code:

**(a) `useSyncExternalStore` getSnapshot returning a fresh object — NOT PRESENT.**
Every Zustand selector in the root path returns a **primitive**:
`useCurrentBrandId = useCurrentBrandStore(s => s.currentBrandId)` →
`string | null` (`currentBrandStore.ts:201-202`);
`useCurrentBrandHasHydrated = useCurrentBrandStore(s => s.hasHydrated)` →
`boolean` (`:211-212`). Primitives are referentially stable, so the
`getSnapshot` identity check never trips on them. React Query v5 default
`structuralSharing` keeps `data` reference-stable across refetches that return
equal data, and no hook in the path passes an unstable `select`.

**(b) Zustand selector `s => ({...})` without shallow equality — NONE.**
Grep over `src/store src/hooks app` for object/array-returning selectors
(`Store((...) => ({` / `=> [` / multi-field) returned **zero** non-test hits.
`grep -rn "useShallow"` also returns zero — because none is needed; every
selector returns a single primitive.

**(c) `useEffect` dep array including an object/array recreated each render — GUARDED.**
`useCurrentBrandRecovery`'s effect depends on `resolution`, but `resolution` is
`useMemo`'d (`useCurrentBrandRecovery.ts:59-69`) over stable inputs
(`brands` is `useMemo([brandsQuery.data])`, `currentBrandId` primitive,
`dataReady` boolean, `defaultBrandId` primitive). `brandIdsKey` is a `useMemo`'d
**string**. The `_layout.tsx` effects key off primitives
(`loading`, `brandReady`, `splashHidden`, `isWeb`, `authResolving`, `user`,
`authResolutionExpired`, `userId`, `router`).

**(d) setState called unconditionally in a layout effect — NONE.**
There is **no `useLayoutEffect`** anywhere in the root route tree (grep-confirmed:
the only `useSyncExternalStore`/`useLayoutEffect` hits are inside Zustand store
internals). Every `useEffect` that calls setState in `_layout.tsx` is guarded by
an early-return:
- brand-fetch-timeout: `if (loading) return; if (brandFetchTimedOut) return;` (`:233-240`)
- splash-hide: `if (loading || !brandReady || splashHidden) return;` (`:248-260`)
- eviction: `if (loading || evictionRan) return;` (`:522-543`)
- reap: `if (loading || reapRan) return;` (`:548-563`)
- deadline-tick interval: `if (!authResolving || user !== null || authResolutionExpired) return;` (`:399-411`)

**(e) Two effects ping-ponging (recovery `setCurrentBrandId` ↔ brand-read re-derive) — ALREADY FIXED.**
This is the precise ORCH-1062 loop. The current code carries all of its guards:
- `useCurrentBrandRecovery` writes only when the value actually changes:
  `if (resolution.brandId !== currentBrandId) setCurrentBrandId(...)` (`:87-89`),
  and the whole effect is gated by `appliedKeyRef` (`:83-84`) so an identical
  resolution never re-applies.
- `resolveCurrentBrandId` is a **pure, convergent** function: once it lands on a
  valid brand, `hasBrandId(brands, currentBrandId)` returns `keep-local` and it
  stops moving (`currentBrandResolver.ts:29-31`).
- `useSoftDeleteBrand.onSuccess` (`useBrands.ts:429-466`) SYNCHRONOUSLY evicts the
  deleted brand from the list cache + clears a stale `default_brand_id` so the
  resolver can't re-resolve a just-deleted brand — the documented ORCH-1062
  root-cause fix for "Maximum update depth exceeded" on delete.

**Additional observation (not a proof):** `useCurrentBrandRecovery()` runs in
**two** subscriber trees at once — `RootLayoutInner` (`_layout.tsx:222`) and
`TabsLayout` (`(tabs)/_layout.tsx:98`). Each instance has its own
`appliedKeyRef`/`errorMessage` but both write the **same** shared Zustand
`currentBrandId`. On a settled state both converge to `keep-local` and stop. I
could not construct an input under which they oscillate (the resolver is
convergent and the write is change-guarded), so this is a noted structural smell,
**not** a proven loop edge.

### Confidence: SUSPECTED — the closed loop does not exist in source as written

Every edge that could close the loop is guarded, and the one historically-proven
instance of this exact crash is already patched. A loop can therefore only arise
from a **store value oscillating between two values across commits** under live
session/auth-lock timing (the `_layout.tsx:365-372` "~66 renders/sec" failure
mode the shell's own comments document) — a runtime/flicker condition that is
**not observable from source**. This matches the forensics ceiling exactly.

---

## 5. STEP 2 — MINIMAL GUARDED FIX: NOT PERFORMED (by mandate)

No fix applied. Any change here would be a guess against the auth/session
backbone, which the dispatch and `feedback_interactive_elements_must_fire_runtime_proof`
+ the conservative-on-auth guard forbid. The candidate "fixes" considered and
rejected as unprovable-from-source:
- Stabilising a snapshot/selector — **nothing to stabilise**: all selectors
  already return primitives; no `useShallow` is missing.
- Guarding a setState with an equality check — **already guarded everywhere**.
- Correcting an effect dependency — **deps are already primitives/memoised**.
- De-duplicating the two `useCurrentBrandRecovery()` mounts — plausible hardening
  but it changes auth/brand-resolution structure and is NOT a proven cause; doing
  it blind risks altering what the recovery resolves to (explicitly forbidden).

These belong in a SPEC written **after** a live repro pins the oscillating value.

---

## 6. STEP 3 — REGRESSION TEST: NOT WRITTEN (no proven seam, no change)

A render-loop test must exercise the *specific* oscillating edge to prove
fails-on-revert. With no proven edge and no code change, there is nothing to
delete-and-fail. Writing a green test against an arbitrary seam would be a false
fails-on-revert (the dispatch's own warning). **BACKFILL status:** not exempt —
this ORCH simply produced no product-code change to test. The existing suite
already covers the known instances of this class and all pass on `origin/main`
(not re-run here; no files changed): `useSoftDeleteBrand.orch1062.test.ts`,
`useSoftDeleteBrand.orch1062.adversarial.test.ts`,
`orch_1103_signout_redirect_loop.test.ts`, `orch1102Wave2LoadingTimeout.test.ts`.

---

## 7. Gates

No source files changed → typecheck/lint/jest were intentionally not run on a
non-change (running them would prove nothing about a loop and the report would
misrepresent a clean tree as "verified fixed"). The tree is byte-identical to
`origin/main` @ `907b2b2a0`.

---

## 8. What it would take to elevate to PROVEN (handoff to live-fire INVESTIGATE)

1. Run `mingla-business` on web (`expo start --web`) with a **real authenticated
   session** and induce the auth-lock/multi-tab/deadlock timing the shell's
   L365-372 comment documents.
2. Mount a render-count probe (React DevTools "why-did-you-render" or a
   `useRef` render counter) on `RootLayoutInner` **and** on both
   `useCurrentBrandRecovery` instances; log `currentBrandId`, `brandFetchStatus`,
   `brandRecoveryResolving`, `authResolving`, and the React Query `dataUpdatedAt`
   for `brandKeys.detail`/`list` on every render.
3. Capture which single value flips each commit. That value's owner is the
   real culprit; THEN write the SPEC + the change-guarded fix + a fails-on-revert
   test that oscillates that exact value.
4. Save the RedBox + render trace under `Mingla_Artifacts/evidence/ORCH-1133/`.

---

## 9. Discoveries for Orchestrator

1. **Structural smell (not a bug):** `useCurrentBrandRecovery()` is mounted twice
   in the live tree (`RootLayoutInner` + `TabsLayout`), each writing the same
   shared `currentBrandId`. Convergent today, but it doubles the write surface for
   any future regression in the resolver. Candidate for a single-owner refactor —
   under its OWN ORCH, with a proven need, never blind on the auth path.
2. **Dispatch surface confirmation still open (carried from forensics §6.2):** the
   stack is `mingla-business` WEB, not `app-mobile`/iOS. Worth re-confirming with
   Seth which app + surface showed the RedBox before any live-fire repro is set up,
   so the repro environment matches.
3. This ORCH produced no code change; CLOSE should treat it as an
   **investigation-confirmation** (SUSPECTED upheld), not a shipped fix. The fix
   belongs to a follow-on after live-fire.

---

## 10. Confirmation re: auth/session integrity

No file was modified. The login/session backbone (`AuthContext.tsx`,
`_layout.tsx`, `currentBrandStore.ts`, `useCurrentBrandRecovery.ts`, `useBrands.ts`)
is **byte-identical to `origin/main` @ `907b2b2a0`**. This turn could not have
altered auth/session resolution, logout-clears-everything behavior, the number of
auth instances, or what the brand recovery resolves to.
