# INVESTIGATE — "Maximum update depth exceeded" infinite render loop at the app root shell

- **Dispatched as:** ORCH-1132 (URGENT). **ID-COLLISION WARNING:** the ID `ORCH-1132`
  is ALREADY TAKEN on `origin/main` by a merged-and-CLOSED cosmetic fix
  ("ORCH-1132: checkout cover full-frame (no crop) + Sound-pill edge clearance",
  commits `f6fa691b9` + `907b2b2a0`, PR #462/#463). This investigation needs a
  FRESH ORCH-ID (next free is ORCH-1133+ — orchestrator must re-INTAKE with a
  `git fetch` ID scan). All references below use ORCH-1132 only because the
  dispatch did; treat the number as provisional.
- **Date:** 2026-06-13
- **Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/ORCH-1130-[trip-pay-structure]/`
  on branch `ORCH-1130-trip-pay-structure` @ `da7222178`.
  ⚠️ This worktree is **4 commits BEHIND `origin/main`** (the ORCH-1130 dev OTA
  bundle predates ORCH-1131/1132 cover-crop merges). None of those 4 commits
  touch the root shell, so they are not the cause either.
- **Confidence ceiling:** SUSPECTED (source-only). No live repro was run — the
  loop is auth-session/timing-gated and reproducing it needs a running business
  web build with a real session + lock contention. See "Reproduction".

---

## 0. The reported crash

```
Maximum update depth exceeded. This can happen when a component repeatedly calls
setState inside componentWillUpdate or componentDidUpdate...
```

Component stack (top→down):
`SlotNavigator → Slot → DesktopCanvas → RCTView/View → TabsLayout → Suspense →
Route → BaseRoute → ... → RootLayoutInner → AuthProvider → QueryClientProvider`

JS stack: `forceStoreRerender → enqueueConcurrentRenderForLane → batchUpdates →
commitHookEffectListMount → commitLayoutEffectOnFiber (recursivelyTraverse...) →
flushLayoutEffects → commitRoot → performSyncWorkOnRoot`.

---

## 1. OWNERSHIP VERDICT — PRE-EXISTING on origin/main (NOT ORCH-1130)

**The crash is NOT in `app-mobile` (the consumer app) at all — it is the
`mingla-business` app running on WEB.** The dispatch's "consumer app / iOS"
framing is refuted by the component stack itself:

| Stack frame | Where it exists |
|---|---|
| `RootLayoutInner` | ONLY `mingla-business/app/_layout.tsx` (defined line 195). app-mobile has NO such component. |
| `AuthProvider` + plain `QueryClientProvider` | ONLY `mingla-business` (`src/context/AuthContext.tsx`, `app/_layout.tsx:666-667`). app-mobile's root uses `PersistQueryClientProvider` and has **no `AuthProvider` and no `RootLayoutInner`** (grep over `app-mobile/` returns zero non-test hits). |
| `DesktopCanvas` / `SlotNavigator` / `TabsLayout` | expo-router **web** internals — the desktop/web canvas. The crash was captured **on web**, not iOS native. |

**Evidence — app-mobile is structurally incapable of producing this stack:**

```
$ grep -rln "RootLayoutInner|AuthProvider" app-mobile/app app-mobile/src   → (none, non-test)
$ grep -rln "RootLayoutInner" mingla-business                              → mingla-business/app/_layout.tsx
```

**Evidence — ORCH-1130 touched ZERO root-shell files:**

```
$ git diff origin/main...HEAD --stat -- \
    mingla-business/app/_layout.tsx \
    mingla-business/src/context/AuthContext.tsx \
    mingla-business/src/hooks/useBrands.ts \
    mingla-business/src/hooks/useCurrentBrandRecovery.ts \
    mingla-business/src/store/currentBrandStore.ts \
    mingla-business/src/wrappers/KeyboardRoot.tsx
  → (empty — ORCH-1130 changed none of them)
```

ORCH-1130's full diff (`git diff origin/main...HEAD`) touches only: the consumer
trip screen + hook + native checkout (app-mobile), and the **business public
trip page / trip checkout funnel** (`app/t/[brandSlug]/[tripSlug].tsx`,
`app/checkout-trip/**`, `components/trip/TripPaymentChoice.tsx`,
`components/trip/TripCheckoutFlow.tsx`, `components/checkout/CartContext.tsx`,
`components/checkout/CheckoutHeader.tsx`). Every one of those is a LEAF route /
component that mounts only on a trip or checkout route — **none is an ancestor of
`RootLayoutInner`**, and the crash stack contains NONE of them. Each was
inspected for the four classic loop causes:

- `CartContext.tsx` — context value is `useMemo`'d, setter is `useCallback`'d
  with `[]` deps; the new `SET_PAYMENT_PLAN_CHOICE` reducer case returns a new
  object only on dispatch. **Clean.**
- `checkout-trip/[tripEventId]/index.tsx` — two NEW `useEffect`s (seed-plan
  once with `[]` deps; single-tier auto-skip guarded by
  `if (lines.some(... === sole.id)) return;` + `router.replace`). Both guarded;
  neither is a layout effect; both live on a checkout route, not the shell.
  **Not the shell loop.**
- `[tripSlug].tsx`, `TripPaymentChoice.tsx`, `TripCheckoutFlow.tsx`,
  `payment.tsx` — controlled `useState` + prop threading; no new effects.
  **Clean.**

→ **VERDICT: PRE-EXISTING on `origin/main`.** ORCH-1130 is exonerated. The fix
must NOT be folded into ORCH-1130; it needs its own (re-numbered) ORCH. The
shell files were last touched by the auth-routing chain ORCH-1102 → 1103 →
1106 → 1115 (`git log origin/main -- mingla-business/app/_layout.tsx`).

---

## 2. ROOT CAUSE (SUSPECTED) — a `useSyncExternalStore` loop in the business root shell

`forceStoreRerender` is the React-internal callback fired by
**`useSyncExternalStore`** (the subscription primitive behind BOTH Zustand and
React Query v5). Its presence at the top of the JS stack means an EXTERNAL STORE
is re-rendering the root shell in a tight loop, and a `setState` reached inside a
committed (layout-phase) effect keeps re-enqueueing. The subtree that subscribes
to external stores in the root render path is `RootLayoutInner` (`_layout.tsx`)
plus its hooks: `useAuth` (Context — ruled out, `useMemo`'d value), and the
external-store hooks `useCurrentBrandId` (Zustand), `useBrand(currentBrandId)` +
`useBrands` (React Query), and `useCurrentBrandRecovery` (which composes all of
the above and WRITES back via `setCurrentBrandId`).

**Suspected cycle (highest-probability, source-traced):** `_layout.tsx`'s
`RootLayoutInner` runs a cluster of timing-gated `setState` effects
(`brandFetchTimedOut` L233-240, splash-hide L248-260, `forceDeadlineTick`
L398-411 deadline interval, plus `evictionRan`/`reapRan`) that all key off
`loading` / `brandReady` / `authResolving`. The file's OWN comments (L365-372)
document a real, observed **"~66 renders/sec" render loop under auth-lock /
deadlock contention** on the web static build, which the module-level deadline
anchor was added to survive — i.e. a render loop here is a known, reproduced
failure mode of this shell. Combined with `useCurrentBrandRecovery` calling
`setCurrentBrandId` (which re-runs `useBrand` → React Query
`useSyncExternalStore` re-render), the shell has multiple store→setState→store
edges that can oscillate when auth/brand state flickers.

**Why this stays SUSPECTED, not proven:** I could not, by source alone, isolate
the SINGLE `setState`-in-layout-effect edge that closes the loop deterministically
(`useCurrentBrandRecovery`'s write is guarded by `appliedKeyRef`; the resolver is
stable/idempotent; the `_layout` effects each have `if (...return)` guards). The
loop is therefore almost certainly **state-flicker-dependent** (a store value
oscillating between two values each render), which only manifests under live
session/lock timing. Pinning the exact oscillating store value REQUIRES a live
repro (see §3).

**Lower-probability alternatives NOT ruled out:** a React Query observer in
`useBrands`/`useBrand` returning a fresh result object each render (stuck refetch
or unstable `select`), or a Zustand selector elsewhere in the `(tabs)` layout
(`TabsLayout` is in the stack) returning a new object/array per call.

---

## 3. REPRODUCTION CONFIDENCE — not reproduced (env-blocked); likely CONDITIONAL

- **Was it run?** No. Reproducing needs a running `expo start --web` business
  build WITH a real authenticated session and the auth-lock/deadlock timing the
  loop depends on. The worktree `node_modules` is a shared symlink and the loop
  is session/timing-gated, so a deterministic repro is not feasible read-only in
  this environment within scope.
- **Deterministic-on-load or conditional?** Evidence points to **conditional**,
  not every cold start: the shell's documented render-loop failure mode is tied
  to auth-lock / multi-tab / deadlock contention (`_layout.tsx` L353-411), and
  the cover-crop work merged on `origin/main` AFTER this bundle did not touch the
  shell — so this is not a clean "crashes every boot" regression but a
  state-flicker loop. (If it WERE deterministic-on-every-cold-start, the business
  web app would be uniformly down, which the merged-and-shipping 1131/1132 web
  work suggests it is not.)
- **Next step to elevate to PROVEN:** run business web, sign in, open the React
  DevTools "why-did-you-render" / a render-count probe on `RootLayoutInner`, and
  capture which store value flips each render. Save the RedBox + render trace to
  `Mingla_Artifacts/evidence/ORCH-1132/`.

---

## 4. PROPOSED FIX — NONE (INVESTIGATE proposes nothing)

Per the forensics creed, no fix is proposed here. The SPEC phase (after a live
repro pins the oscillating store value) will define it. Direction only for the
re-investigation/SPEC: instrument `RootLayoutInner`'s render count + every
external-store subscription it reads (`useCurrentBrandId`, `useBrand`,
`useBrands`, `useCurrentBrandRecovery`), find the value that flips each render,
and stabilize THAT edge (memoize the selector / stabilize the React Query result
/ break the recovery-write↔brand-read cycle). Do NOT guess-patch a `_layout.tsx`
effect guard without the repro — the guards are already present and the loop is
upstream of them.

---

## 5. BLAST RADIUS & PRODUCTION IMPACT

- **Surface:** `mingla-business` on WEB (desktop/mobile browser). NOT app-mobile
  consumer, NOT business native (the `DesktopCanvas` frame is web-only). The
  dispatch's "consumer app unusable on dev OTA" framing is mis-attributed — if
  Seth saw this, it was the **business web** surface, or a mislabeled bundle.
- **Is this why the consumer app is unusable on the dev OTA?** **No** — the
  consumer app (`app-mobile`) cannot emit this stack (no `RootLayoutInner` /
  `AuthProvider`). If the consumer dev OTA is also unusable, that is a SEPARATE
  issue and needs its own repro; this crash is a business-web shell loop.
- **Production today?** The culprit shell files (`_layout.tsx`, AuthContext,
  brand store/recovery, useBrands) are on `origin/main` and SHIPPED (ORCH-1102…
  1115 all `[deploy]`-merged). So the loop's ingredients ARE in production. But
  because it is condition-gated (auth-lock/deadlock flicker), it is an
  intermittent prod risk, not a guaranteed every-load crash — consistent with
  business web otherwise functioning. **Dating the regression:** last shell
  touch is `ca352fdc2` (ORCH-1115, 2026-06-12) over a chain back to ORCH-1102
  (`7c86708c2`) which introduced the bounded-loading / deadline-tick machinery
  the loop most plausibly lives near.

---

## 6. DISCOVERIES FOR ORCHESTRATOR

1. **ORCH-ID COLLISION (P1 process):** `ORCH-1132` is already merged+closed on
   `origin/main` for an unrelated cover-crop fix. Re-number this loop
   investigation (INTAKE ID-scan after `git fetch` — the exact failure mode
   memory warns about). 
2. **Dispatch mis-attribution:** the bug is `mingla-business` WEB, not
   `app-mobile`/iOS/consumer. Worth re-confirming with Seth WHICH app + surface
   he actually saw the RedBox on (business web in a browser vs the consumer dev
   OTA on the phone) before SPEC — the two have different root causes.
3. The worktree used for this investigation is 4 commits behind `origin/main`;
   any follow-on work should rebase (`git fetch origin && git rebase origin/main`).

---

## 7. RECOMMENDED NEXT PHASE

Re-INTAKE under a fresh ORCH-ID → a **live-fire INVESTIGATE** of `mingla-business`
WEB (`expo start --web`, real session) to pin the oscillating store value and
capture the RedBox/render trace → THEN SPEC the stabilization. Do NOT SPEC from
this source-only report — the exact loop edge is SUSPECTED, not proven.
