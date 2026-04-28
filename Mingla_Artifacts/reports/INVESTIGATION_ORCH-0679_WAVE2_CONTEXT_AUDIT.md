# Investigation Report — ORCH-0679 Wave 2.8 Context Stability Audit

**Mode:** INVESTIGATE (focused — context-stability scope)
**Date:** 2026-04-26
**Predecessor audits:**
- `INVESTIGATION_ORCH-0679_ANDROID_PERF_ROUND2.md`
- `INVESTIGATION_ORCH-0679_WAVE2_DIAG_AUDIT.md`
**Trigger:** Post-Wave-2.7 founder diagnostic shows 4 of 6 tabs still busting on every tap. Audit was tasked with finding the third root cause.
**Confidence:** HIGH on consumption pattern; **MEDIUM on root mechanism** — see §11 honesty note.

---

## §1 Layman Summary

The empirical pattern is unambiguous: every tab that consumes CoachMarkContext (HomePage, Discover, Connections, Profile) busts on every tab tap. The two tabs that don't consume it (Saved, Likes) hold memo correctly. **However, my static analysis of CoachMarkContext's `value = useMemo([deps])` shows ALL deps trace to stable primitives or correctly-deps'd useCallbacks** — the value SHOULD be referentially stable across renders triggered by `setCurrentPage`, which means consumers SHOULDN'T be re-rendering. There's a gap between the empirical pattern and the code analysis I cannot close at the static-analysis layer alone.

Given we've now done 4 implementation passes (Wave 2 → 2.5 → 2.6 → 2.7) chasing memo issues with each pass missing something the next had to fix, the right call is to **escalate to Path B** (switch from "all 6 tabs always mounted" to "active tab only mounted") rather than ship Wave 2.8 on a hypothesis I can't fully prove.

---

## §2 Symptom (founder diagnostic, post-Wave-2.7, verbatim)

```
[ACTION] Tab pressed: discover
[render-count] HomePage: 12      ← transitioning out (expected)
[render-count] DiscoverScreen: 10 ← transitioning in (expected)
[render-count] ConnectionsPage: 15 ← NOT transitioning (UNEXPECTED)
[render-count] ProfilePage: 13   ← NOT transitioning (UNEXPECTED)

[ACTION] Tab pressed: connections
[render-count] HomePage: 13      ← NOT transitioning (UNEXPECTED)
[render-count] DiscoverScreen: 11 ← transitioning out (expected)
[render-count] ConnectionsPage: 16 ← transitioning in (expected)
[render-count] ProfilePage: 14   ← NOT transitioning (UNEXPECTED)
```

Saved + Likes silent on these taps (Wave 2.7 fixed them — RC-1 + RC-2 plug worked for those two). Other 4 still busting on every tap, including non-transitioning taps.

---

## §3 Tab Consumption Matrix (verified by grep)

| Tab | useCoachMark / useCoachMarkContext usage | Other tab-only context | Bust on non-transition? |
|---|---|---|---|
| HomePage | `useCoachMark(1, 36)`, `useCoachMark(2, 20)`, `useCoachMark(4, 16)`, `useCoachMark(5, 18)` (4 calls, lines 206-210) | useTranslation (i18n) | YES |
| DiscoverScreen | `useCoachMark(6, 24)` (line 708) | useTranslation | (transitions both taps so can't isolate) |
| ConnectionsPage | `useCoachMark(7, 0)` (line 305) | useTranslation | YES |
| ProfilePage | `useCoachMarkContext()` direct destructure (line 136) | useTranslation | YES |
| SavedExperiencesPage | NONE | useTranslation | NO (memo holds) |
| LikesPage | NONE | useTranslation | NO (memo holds) |

**Pattern is unambiguous.** All 4 busting tabs consume CoachMarkContext. All 2 silent tabs don't. `useTranslation` is the i18n hook used by ALL 6 tabs equally — not a discriminator. Statistical evidence is overwhelming that CoachMarkContext is the bust source.

---

## §4 Per-Dep Audit on CoachMarkContext.tsx `value = useMemo(...)` (lines 390-420)

| # | Dep | Source | Verified stability | Notes |
|---|---|---|---|---|
| 1 | `currentStep` | `useState<number>(LOADING_SENTINEL)` line 70 | ✅ STABLE-PRIMITIVE | Only changes when setCurrentStep fires (init + tour navigation) |
| 2 | `isCoachActive` | inline `currentStep >= 1 && currentStep <= COACH_STEP_COUNT` line 381 | ✅ STABLE-DERIVED | Boolean primitive — Object.is by value |
| 3 | `isCoachPending` | inline `currentStep === TOUR_NOT_STARTED` line 382 | ✅ STABLE-DERIVED | Boolean primitive |
| 4 | `isCoachLoading` | inline `currentStep === LOADING_SENTINEL` line 383 | ✅ STABLE-DERIVED | Boolean primitive |
| 5 | `currentStepConfig` | inline `isCoachActive ? COACH_STEPS.find(...) ?? null : null` line 384-386 | ✅ STABLE | When inactive: `null` (identity-stable). When active: `COACH_STEPS.find` returns same array entry ref for same step ID. |
| 6 | `nextStep` | `useCallback(..., [currentStep, persistStep, navigateAndTransition])` line 325-354 | ✅ STABLE | All 3 deps stable per §5 trace |
| 7 | `prevStep` | `useCallback(..., [currentStep, navigateAndTransition])` line 357-360 | ✅ STABLE | Both deps stable |
| 8 | `skipTour` | `useCallback(..., [currentStep, persistStep])` line 363-378 | ✅ STABLE | Both deps stable |
| 9 | `targetMeasurements` | `useState(() => new Map<...>())` line 78 | ✅ STABLE | Map ref from initializer — set once, never recreated |
| 10 | `registerTarget` | `useCallback(..., [targetMeasurements])` line 197-199 | ✅ STABLE | Dep is stable Map ref |
| 11 | `registerScrollRef` | `useCallback(..., [])` line 283-285 | ✅ STABLE-PERMANENT | Empty deps → permanently stable identity |
| 12 | `registerTargetScrollOffset` | `useCallback(..., [])` line 288-290 | ✅ STABLE-PERMANENT | Empty deps |
| 13 | `overlayVisible` | `useState(false)` line 71 | ✅ STABLE-PRIMITIVE | Boolean — only changes on setOverlayVisible |
| 14 | `scrollLockActive` | `useState(false)` line 72 | ✅ STABLE-PRIMITIVE | Boolean — only changes on setScrollLockActive |

**Result:** all 14 deps trace to stable references or primitives across renders triggered by `setCurrentPage` (which doesn't touch any of CoachMarkContext's state).

---

## §5 Transitive Stability Trace (deps of deps)

### `persistStep` (line 271-280)
```ts
const persistStep = useCallback((step: number): void => {
  if (!user?.id) return;
  supabase.from('profiles').update({...}).eq('id', user.id)...;
}, [user?.id]);
```
- `user?.id` → from `const { user } = useAppStore();` line 68. Zustand selector with no filter. ✅ Stable when user state hasn't changed in store. Tab tap doesn't touch Zustand.
- **Verdict: STABLE.**

### `navigateAndTransition` (line 293-322)
```ts
const navigateAndTransition = useCallback((newStep, direction) => {...}, [currentStep, persistStep]);
```
- `currentStep` → STABLE (per #1)
- `persistStep` → STABLE (per above)
- **Verdict: STABLE.**

### `nextStep` deps trace
- `currentStep` → STABLE
- `persistStep` → STABLE
- `navigateAndTransition` → STABLE
- **Verdict: STABLE.**

Per analysis, every transitive dep is stable. The value useMemo SHOULD return Object.is-equal references across non-coach-state-change renders. Context consumers SHOULDN'T re-render due to context value change.

**Yet the diagnostic shows they DO re-render. There's a gap between code analysis and runtime behavior I cannot close.**

---

## §6 NavigationContext + MobileFeaturesProvider Per-Dep Audit

### NavigationContext.tsx (post-Wave-2)

`value = useMemo<NavigationContextType>({ ... }, [...18 deps]);`

All 18 deps are either:
- 4 `useState` boolean flags (modal open states) — stable until set
- 14 `useCallback`-wrapped handlers, all with empty `[]` or `[navigation]` deps — stable

**Verdict: STABLE.** No tab consumes this context (verified §3 grep — none of the 6 tabs grep'd for `useNavigation` or `useNavigationContext`). Even if it were unstable, no impact on tab memo.

### MobileFeaturesProvider.tsx (post-Wave-2)

`value = useMemo<MobileFeaturesContextType>({ ... }, [...12 deps]);`

All 12 deps are either:
- 5 `useState` values (location data, permissions, init flags) — stable until set
- 6 `useCallback`-wrapped service handlers — stable
- `initializationError` (string|null state) — stable

**Verdict: STABLE.** No tab consumes this context directly (no grep hits). Children of tabs (e.g., camera/location consumers) might consume it, but irrelevant to tab-level memo.

---

## §7 CardsCacheContext + RecommendationsContext Sanity Check

### CardsCacheContext.tsx (already memoized pre-Wave-2)
- `value = useMemo({...}, [getCachedCards, setCachedCards, clearCache, generateCacheKey, updateCacheEntry, isCacheLoaded])` line 289-306
- All 6 deps are useCallback-wrapped with stable inner deps.
- **Verdict: STABLE.** No tab grep'd for `useCardsCache`.

### RecommendationsContext.tsx (TS-2 deferred — NOT memoized)
- Plain `const value = { ... };` with ~30 properties — fresh object every render.
- **None of the 6 tab files** consume `useRecommendations()` directly (verified by grep — only `SwipeableCards.tsx` consumes it, and that's a child of HomePage, not a tab itself).
- **Verdict: NOT a tab-level cause.** TS-2's impact is on SwipeableCards' internal renders, not tab memo.

---

## §8 The Five-Layer Cross-Check (where the contradiction lives)

| Layer | Result |
|---|---|
| **Docs** | Wave 2 implementation report claimed "I-PROVIDER-VALUE-MEMOIZED" was achieved on CoachMarkContext via `useMemo(...)`. CI gate `check-tabs-memo-wrapped.sh` and the surrounding ones verified static patterns but DON'T verify dep stability transitively. |
| **Schema** | N/A |
| **Code** | Per §4 + §5, the `value` useMemo deps trace to stable refs/primitives. Should be referentially stable. |
| **Runtime** | Founder diagnostic shows the 4 CoachMarkContext-consuming tabs re-render on every tab tap. Empirically inconsistent with the code analysis. |
| **Data** | N/A |

**Layers contradict.** Code says "should be stable." Runtime says "tabs re-render anyway." This means either:
1. My code analysis missed an unstable dep (most likely — I've been wrong before in this campaign)
2. There's a React/Zustand/Context propagation mechanism I don't fully understand
3. The render-counter instrument itself has an artifact (unlikely — Saved + Likes show it's accurate)

I cannot resolve the contradiction with static analysis alone. **This is the honesty point: I can't prove WHY CoachMarkContext consumers are re-rendering, only that they ARE.**

---

## §9 Findings

### 🔴 RC-3 (probable, not proven) — CoachMarkContext value identity unstable in practice

**Pattern proven by:**
- 100% correlation: 4 of 4 consumers bust; 0 of 2 non-consumers bust
- No other context discriminates between busting and silent tabs
- Identical i18n usage across all 6 tabs rules out useTranslation

**Mechanism unproven by static analysis:**
- All 14 useMemo deps appear stable
- All transitive deps appear stable
- Static analysis says memo SHOULD hold

**Classification:** 🔴 Root Cause **PROBABLE** (not proven). 5 of 6 evidence fields complete; the "verification step" field cannot be filled at the code-analysis layer — would require runtime instrumentation (React DevTools Profiler, why-did-you-render, or `useEffect` to log `value` reference identity comparison) which is out of forensics scope.

### 🟡 HF-1 — Architectural pattern: god-context with 14 deps

CoachMarkContext's `value` useMemo has 14 deps. Every dep is its own potential failure point. Even with all my analysis showing stable deps, there's enough surface area that one missing dep correctness could escape audit. This is a pattern problem, not a bug. Splitting into smaller, narrower contexts would reduce the risk surface.

### 🔵 OBS-1 — `useAppStore()` with no selector inside CoachMarkProvider

`const { user } = useAppStore();` at line 68 subscribes to ALL Zustand state changes. Anti-pattern (should use `useAppStore(s => s.user)` selector). Doesn't appear to be the cause here (Zustand state doesn't change on tab tap), but worth fixing for hygiene + future-proofing.

### 🔵 OBS-2 — 4 useEffect blocks in CoachMarkProvider

None fire on tab tap based on dep analysis (deps are user.id, currentStep, []). Confirmed not the trigger.

---

## §10 Escalation Decision (per dispatch §11)

The dispatch authorized escalation to Path B if "multiple unstable contexts" were found. By that strict criterion, escalation is NOT triggered — only ONE context (CoachMarkContext) shows the empirical bust pattern, and even that's not proven via code.

**However, the spirit of the escalation clause** was: don't ship another wave on hypothesis. We've done 4 implementation passes; each missed something. **My static analysis cannot point to a specific unstable dep in CoachMarkContext to fix.** Path A would be: "wrap something in useCallback hoping that's the issue" — that's the exact hypothesis-driven approach we've been burned by.

**Recommendation: ESCALATE TO PATH B.**

Reasoning:
1. **I can't prove the fix.** Without proving WHICH dep is actually unstable, any Path A wave is a guess.
2. **Path B sidesteps the problem entirely.** If only the active tab is mounted, hidden tabs don't exist to bust. Memo concerns evaporate. Context propagation concerns evaporate. The structural complexity disappears.
3. **The current architecture (all 6 tabs always mounted) is the real problem.** It traded mount-cost-on-tab-switch for permanent re-render-on-everything cost. The original tradeoff appears to have been wrong on a memory/CPU-constrained Android device, AND the memoization barriers needed to make it work are leak-prone.
4. **5th wave risk:** if Path A guesses wrong, Wave 2.9 audit + Wave 2.9 implementation. Founder confidence will be exhausted.

**Path B cost:** ~3-4 hours rearchitecture + scroll-position-preservation registry pattern + regression sweep. **Bounded.**

**Path B risk:** Tab content state must survive unmount/remount. Most state is in React Query (survives) or Zustand (survives). React local state (e.g., active filter selection in Saved tab, expanded card state) is the risk surface. Need explicit list of preserved-vs-allowed-to-reset state per tab.

---

## §11 Honesty Note

I've been wrong before in this campaign. Wave 2 missed RC-2 (`availableFriendsForSessions`). Wave 2.5 missed RC-3 (handlers.X passing through JSX). Wave 2.6 added a Rules of Hooks bug. Wave 2.7 still left 4 tabs busting. Each pass, I claimed confidence and was incomplete.

This audit's claim: **I cannot find the unstable dep in CoachMarkContext via static analysis, despite being highly confident the empirical pattern points to it.** This is exactly the situation where Path A guessing has the worst track record.

Path B is the structurally honest answer: stop trying to make the all-mounted pattern work; switch to mount/unmount which doesn't require the same memo discipline.

---

## §12 Blast Radius (if Path B is chosen)

Files affected:
- `app-mobile/app/index.tsx` — refactor tab JSX block (lines ~2589-2703 currently) from "all 6 always mounted, visibility toggled by style" to "switch on currentPage, render only active tab"
- New file: `app-mobile/src/hooks/useTabScrollRegistry.ts` (or similar) — preserve scroll position per tab across unmount/remount
- Possibly: each tab needs to read/write its scroll position on unmount/mount

Out of scope for Path B:
- All Wave 2/2.5/2.6/2.7 work stays (memo wraps, hoists, useCallback wraps, etc.) — they become unnecessary but NOT harmful. Can be cleaned up in a follow-up after Path B ships.
- TS-1.5 (useAppHandlers god-hook) — irrelevant under Path B because there's no memo barrier to bust.
- TS-2 (RecommendationsContext) — same, irrelevant under Path B for tab-level concerns.

---

## §13 Recommended Fix Strategy

**Path B — Tab mount/unmount rearchitecture.**

High-level approach:
1. Replace the 6 always-mounted `<View style={tabVisible ? ... : tabHidden}>` wrappers with a single `switch (currentPage)` block that renders ONLY the active tab.
2. Add a scroll-position registry (similar pattern to deckStateRegistry from ORCH-0490) to preserve each tab's scroll position across remount.
3. Audit each tab for state that needs preservation:
   - HomePage: filter selection? Currently empty?
   - Discover: scroll position, deck state (already preserved via deckStateRegistry)
   - Connections: active panel, scroll position
   - Saved: filter, sort, search query, scroll position
   - Likes: active inner tab (saved/calendar)
   - Profile: scroll position
4. Either preserve via registry OR explicitly accept reset (document decision per tab).
5. Render-counter instrument stays. Diagnostic post-Path-B should show: tap tab → 1 render-count log (the new active tab); old tab simply unmounts.

---

## §14 Discoveries for Orchestrator

- **D-AUDIT2-1:** I cannot prove RC-3 at the static analysis layer. Empirical evidence is unambiguous, but the mechanism remains opaque. This is a forensics limitation, not a code defect.
- **D-AUDIT2-2:** Path B (rearchitecture) sidesteps the entire god-hook + god-context problem. Recommend it as the structurally correct fix even though it's bigger scope.
- **D-AUDIT2-3:** Wave 2/2.5/2.6/2.7 work is NOT wasted under Path B. The memo wraps, hoists, etc. become defense-in-depth (still beneficial if Path B is ever reverted). Don't roll them back.
- **D-AUDIT2-4:** OBS-1 — `useAppStore()` with no selector in CoachMarkProvider is anti-pattern but not the bug. Worth a future cleanup.
- **D-AUDIT2-5:** The render-counter instrument has been the single most valuable diagnostic tool in this campaign. Worth keeping permanently in dev builds even after Path B lands.

---

## §15 Confidence Level

- **Consumption pattern: HIGH** — proven by direct grep + behavioral correlation.
- **CoachMarkContext as bust source: HIGH** — by elimination, no other context discriminates the busting/silent split.
- **Specific unstable dep: LOW** — static analysis says all 14 deps are stable, contradicting the empirical pattern. Cannot pinpoint.
- **Path B as correct fix: HIGH** — sidesteps the entire problem class regardless of which dep is unstable.

---

## §16 Recommended Next Step

Hand to orchestrator. Orchestrator should:
1. Accept the escalation to Path B.
2. Write a SPEC dispatch for the mount/unmount rearchitecture, including:
   - Per-tab state-preservation list (decisions: register for survival vs accept reset on remount)
   - Scroll-position registry contract
   - Verification gate: post-fix diagnostic shows 1 log per tap (just the new active tab)
3. Or: write a forensics dispatch that adds runtime instrumentation (`useEffect` to log value reference identity comparisons across renders) to definitively prove which dep is unstable, then ship a tight Path A fix. This trades 1-2 hours of additional audit work for higher confidence in a smaller Path A fix.

If choosing between immediate Path B vs runtime-instrumented Path A: Path B is the structurally durable answer. Path A even with proof is a workaround for a god-hook problem.

---

**End of investigation. Pattern proven. Mechanism unproven. Path B recommended.**
