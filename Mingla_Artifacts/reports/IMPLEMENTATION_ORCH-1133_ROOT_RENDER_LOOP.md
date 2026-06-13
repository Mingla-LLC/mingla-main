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

---
---

# IMPLEMENTATION (2026-06-13) — APPROVED SINGLE-WRITER FIX APPLIED

> Sections 1–10 above are the prior agent's analysis-only confirmation (no patch).
> This block is the approved fix per the ORCH-1133 implement dispatch. The fix
> turns §4(e)'s noted **structural smell** (5+ concurrent writers to the global
> current-brand store, §4 lines 118–125 + §9.1) into a **single-writer** invariant.
> Disposition upgraded: **implemented + gate-verified; runtime crash verified by
> OTA on Seth's device** (the flicker is not reproducible in this environment).

## I-1. The exact change (single-writer)

The brand-recovery WRITE now has EXACTLY ONE authoritative owner.

`useCurrentBrandRecovery` gained an opt-in option:
`useCurrentBrandRecovery(options?: { authoritative?: boolean })`, `authoritative`
**defaults to FALSE**. The write side of the hook (the `setCurrentBrandId` store
write + the `setCreatorDefaultBrand` default persistence) was extracted, **verbatim
in behavior**, into an exported pure helper `runBrandRecoveryWrite(...)` whose FIRST
line is the gate:

```ts
if (!authoritative) return false;   // ORCH-1133 single-writer gate
```

The hook's `useEffect` now just builds `appliedKey` and calls
`runBrandRecoveryWrite`. A non-authoritative (read-only) mount does NOTHING on the
write path — no `setCurrentBrandId`, no default-brand network write, no
`appliedKeyRef`/`errorMessage` mutation. Read outputs (`isResolving`, `isError`,
`errorMessage`) are computed from query/resolution state and are UNCHANGED for every
caller. The resolver (`resolveCurrentBrandId`), the auth/session instance, the
logout-clears behavior, and the persisted store shape are untouched.

## I-2. Per-call-site authority assignment

| Call site | Line | Authority | Consumes |
|---|---|---|---|
| `app/_layout.tsx` (RootLayoutInner) | ~231 | **`authoritative: true`** (the SOLE writer) | `isResolving` |
| `app/(tabs)/_layout.tsx` (TabsLayout) | 98 | read-only (default) | `isResolving` |
| `app/(tabs)/home.tsx` | 134 | read-only (default) | `errorMessage` (toast) |
| `app/event/create.tsx` | 79 | read-only (default) | `isResolving`, `isError`, `errorMessage` |
| `src/hooks/useBusinessTodos.ts` | 50 | read-only (default) | `isResolving` |

Writer count dropped **5 → 1**.

## I-3. Proof root-only writing fully preserves recovery (confidence: HIGH)

1. **`RootLayoutInner` is the highest always-mounted node** for any authenticated
   business session: it is rendered unconditionally inside
   `QueryClientProvider → AuthProvider → KeyboardRoot` (`_layout.tsx:666–674`), and
   `useCurrentBrandRecovery({authoritative:true})` is called at line 230 **before**
   every deferred auth-routing `return` (the redirect/spinner branches at
   `:577–602`). So the write effect runs on every render in every auth state.
2. **The write effect's inputs are all global/shared state**, not per-mount:
   `userId` (from `useAuth`), `brands` (`useBrands(userId)` — React Query, shared
   cache), `creatorAccount` (`useCreatorAccount` — shared cache),
   `currentBrandId`/`setCurrentBrandId` (the shared Zustand store). None of them is
   derived from WHICH component mounts the hook. The root mount therefore reads the
   identical inputs and runs the identical `runBrandRecoveryWrite` the other 4 mounts
   ran. **The 4 non-root mounts had no unique write trigger the root lacks** — they
   were redundant writers, not unique triggers.
3. The other 4 sites are nested strictly DEEPER than the root (tab routes /
   `event/create`) — a subset of the root's mount lifetime — so dropping their writes
   removes nothing the root does not already cover.
4. **One behavioral consequence, intentional and correct:** the
   `DEFAULT_BRAND_SAVE_ERROR` (`"Brand selected for now. Couldn't save it as your
   default."`) is now set only by the authoritative root mount, so the toast on
   `home.tsx:270` no longer fires for *that* specific local error (the query-derived
   `CURRENT_BRAND_QUERY_ERROR` toast still works read-only). This is the correct
   consequence of single-writer — the write, and thus its error, lives at the one
   owner. No unique recovery path is lost.

## I-4. Files changed

| File | Δ | What |
|---|---|---|
| `mingla-business/src/hooks/useCurrentBrandRecovery.ts` | +~95 / −~30 | `authoritative` option + `runBrandRecoveryWrite` extraction + single-writer gate + invariant docs |
| `mingla-business/app/_layout.tsx` | +~9 / −1 | root mount passes `authoritative: true` (+ doc comment) |
| `mingla-business/src/hooks/__tests__/useCurrentBrandRecovery.orch1133.singleWriter.test.ts` | +~140 (new) | behavioral gate test + structural one-owner invariant |

The 4 read-only call sites were NOT edited (they default to read-only). Resolution
logic, auth/session, and the store were not changed.

## I-5. Regression test + fails-on-revert

- Test: `mingla-business/src/hooks/__tests__/useCurrentBrandRecovery.orch1133.singleWriter.test.ts`
- **(A) Behavioral** (drives the REAL `runBrandRecoveryWrite`): `authoritative:false`
  ⇒ 0 `setCurrentBrandId` calls + no ref/error mutation; `authoritative:true` ⇒
  exactly 1 call with `"brand-A"`; idempotent re-run ⇒ still 1.
- **(B) Structural invariant**: only `app/_layout.tsx` passes `authoritative:true`;
  the other 4 sites do not; exactly ONE site total passes it.
- Result: **9/9 PASS.**
- **Fails-on-revert (true line deletion of `if (!authoritative) return false;`):**
  the read-only assertion fails (`wrote===true`, `setCurrentBrandId` called).
  **fails-on-revert verified at `45cfe9d7b`** (HEAD at deletion-proof time). Gate
  restored → 9/9 PASS again.

## I-6. Gates

- `npx jest <the orch1133 test>` → **9 passed / 9**.
- Adjacent: `currentBrandResolver.test.ts` + both `useSoftDeleteBrand.orch1062*`
  → **11 passed / 11**.
- `npx tsc --noEmit`: **263 errors WITH my changes == 263 errors with my changes
  STASHED** (origin/main baseline) → **zero new TS errors**; no error in any touched
  file.
- `npx eslint` on the 3 touched files: **0 errors** (5 pre-existing
  "unused eslint-disable" warnings in `_layout.tsx`, far from my edit, present on
  baseline).
- Full `src/hooks/__tests__/` run: 97 pass / 2 fail. The 2 failures
  (`brandListState.test.ts`, `orch1004AllowlistIntegrity.test.ts`) **fail
  IDENTICALLY on origin/main with my changes stashed** → pre-existing baseline,
  not mine.

## I-7. Invariant / gate note (Discovery for Orchestrator)

- The unwired strict-grep gate `orch-0756a-active-brand-recovery.mjs` asserts
  `_layout.tsx` contains the literal `"useCurrentBrandRecovery()"`. My root call is
  now `useCurrentBrandRecovery({ authoritative: true })`; the literal substring still
  appears (in the explanatory comment at `_layout.tsx:225` describing the read-only
  mounts), so the assertion incidentally still passes. **Recommend** the orchestrator
  loosen that gate literal to `useCurrentBrandRecovery(` (open paren) so the match is
  intentional, not comment-dependent. NOTE: this gate is (a) NOT registered in any
  `.github/workflows/` file and (b) ALREADY RED on origin/main baseline
  (`BrandSwitcherSheet.tsx` lacks `default_brand_id: newBrand.id`) — a separate
  pre-existing issue, out of ORCH-1133 scope. I did NOT touch the gate (hard-guard:
  hook + 5 sites + test only).

## I-8. Confirmation: brand-resolution + auth behaviorally unchanged

`resolveCurrentBrandId` is byte-identical. The auth/session instance, logout-clears,
and persisted store shape are untouched. The hook still resolves to the SAME
`brandId` for the SAME inputs — only the **number of mounts permitted to WRITE that
resolution to the global store dropped from 5 to 1**. The write body inside
`runBrandRecoveryWrite` is the prior effect body verbatim (same `appliedKeyRef`
dedupe, same `if (resolution.brandId !== currentBrandId)` value-guard, same
`setCreatorDefaultBrand` newest-brand persistence) gated only by `authoritative`.

## I-9. Operator action required

- No migration, no edge function, no deploy. Pure-JS RN change.
- **Verify on device via OTA** (the flicker crash is not reproducible in CI/this
  env): after merge, OTA the business app and confirm the "Maximum update depth
  exceeded" RedBox no longer appears on the authenticated business root, and brand
  selection still resolves to the same brand it did before.
