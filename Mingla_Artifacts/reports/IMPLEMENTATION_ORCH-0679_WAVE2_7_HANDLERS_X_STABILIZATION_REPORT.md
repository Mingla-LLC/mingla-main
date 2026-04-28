# Implementation Report — ORCH-0679 Wave 2.7 (handlers.X stabilization + availableFriendsForSessions useMemo)

**Status:** **implemented, partially verified** (CI gates 9/9 green, TS clean modulo 3 pre-existing errors; runtime diagnostic retest pending founder dev-client)
**Date:** 2026-04-26
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0679_WAVE2_7_HANDLERS_X_STABILIZATION.md`
**Investigation backing:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0679_WAVE2_DIAG_AUDIT.md`
**Predecessors:** Wave 2 + 2.5 + 2.6 (commit `6f2ae081`)

---

## §1 Layman Summary

Two surgical fixes landed: (1) 10 `useCallback` wrappers around `handlers.X` accesses (RC-1), and (2) a `useMemo` wrap around `availableFriendsForSessions` (RC-2). 12 JSX prop sites in the tab block now reference the stable wrappers instead of `handlers.X`. Added a 9th CI gate to permanently prevent unmemoized inline `.map()`/`.filter()` regressions in AppContent body. All 9 CI gates green; TypeScript clean (3 pre-existing errors unchanged). Founder retest of F-01 should now show 0-1 tab logs per tap (was 5-6).

---

## §2 Mission Summary

Plug the two root causes the diagnostic audit found:
- **RC-1** (TS-1.5): `handlers.X` JSX props busting memo on 5 tabs
- **RC-2** (NEW): `availableFriendsForSessions` inline `.map()` busting HomePage memo

Without both, the founder felt no tab-nav improvement after Waves 2/2.5/2.6 — every tap was re-rendering all 5-6 tabs.

---

## §3 Files Changed

| File | Change |
|---|---|
| `app-mobile/app/index.tsx` | +60 lines (10 stableHandle* useCallback wrappers + useMemo wrap on availableFriendsForSessions); -2 lines (replaced `handlers.X` JSX with `stableHandle*`); 12 JSX prop replacements |
| `app-mobile/scripts/ci/check-no-inline-tab-props.sh` | +2/-2 (region bounds 2529-2645 → 2589-2703 to track Wave 2.7 line shift) |
| `app-mobile/scripts/ci/check-no-inline-map-in-appcontent.sh` | NEW — 9th CI gate, ~60 lines |

Total: 2 modified, 1 new. Zero changes to handler bodies, zero behavioral semantics changes.

---

## §4 Old → New Receipts

### `app/index.tsx` — handlers.X stabilization (RC-1 fix)

**Before:** 12 JSX prop sites in tab block read `handlers.X` directly. Each one was a fresh function reference every render (because `useAppHandlers` returns a fresh object every render). Even one unstable prop busts a memo barrier; combined, they busted memo on 5 of 6 tabs every render.

**Now:** 10 `useCallback` wrappers added in the existing Wave 2A/2.5/2.6 hoist block (between `closeProfileOverlays` and the end of the hoist block). Each wrapper:
- Reads via `handlersRef.current.handleX(...)` (handlersRef declared in Wave 2.5, updated every render)
- Has empty `[]` dep array → permanently stable identity across all renders
- Forwards exact parameter list and return type per AppHandlers.tsx signatures

12 JSX prop sites in the 6-tab JSX block (lines 2589-2703) now reference the stable wrappers:

| Tab | Old | New |
|---|---|---|
| HomePage | `onSaveCard={handlers.handleSaveCard}` | `onSaveCard={stableHandleSaveCard}` |
| HomePage | `onShareCard={handlers.handleShareCard}` | `onShareCard={stableHandleShareCard}` |
| ConnectionsPage | `onShareSavedCard={handlers.handleShareSavedCard}` | `onShareSavedCard={stableHandleShareSavedCard}` |
| ConnectionsPage | `onRemoveFriend={handlers.handleRemoveFriend}` | `onRemoveFriend={stableHandleRemoveFriend}` |
| ConnectionsPage | `onBlockUser={handlers.handleBlockUser}` | `onBlockUser={stableHandleBlockUser}` |
| ConnectionsPage | `onReportUser={handlers.handleReportUser}` | `onReportUser={stableHandleReportUser}` |
| ConnectionsPage | `onModeChange={handlers.handleModeChange}` | `onModeChange={stableHandleModeChange}` |
| SavedExperiencesPage | `onShareCard={handlers.handleShareCard}` | `onShareCard={stableHandleShareCard}` (same wrapper as HomePage) |
| LikesPage | `onRemoveFromCalendar={handlers.handleRemoveFromCalendar}` | `onRemoveFromCalendar={stableHandleRemoveFromCalendar}` |
| LikesPage | `onShareCard={handlers.handleShareCard}` | `onShareCard={stableHandleShareCard}` (same wrapper) |
| ProfilePage | `onNavigateToActivity={handlers.handleNavigateToActivity}` | `onNavigateToActivity={stableHandleNavigateToActivity}` |
| ProfilePage | `onNotificationsToggle={handlers.handleNotificationsToggle}` | `onNotificationsToggle={stableHandleNotificationsToggle}` |

**Why:** Forensics audit §5 RC-1 — handlers.X JSX props bust memo on every render due to TS-1.5 (god-hook). Stable wrappers via handlersRef.current bypass the instability without touching AppHandlers.tsx (TS-1.5 still deferred for proper architectural fix).

**Lines changed:** ~50 added (10 wrappers ~5 lines each), 12 line edits in JSX.

### `app/index.tsx:1009-1027` — availableFriendsForSessions useMemo (RC-2 fix)

**Before:**
```ts
const availableFriendsForSessions: Friend[] = (dbFriends || []).map((friend: any) => ({...}));
```
Plain const declaration. Inline `.map()` ran every render → fresh array + fresh object literals → busted HomePage memo on every render.

**Now:** Same `.map()` body wrapped in `useMemo<Friend[]>(() => ..., [dbFriends])`. Identity stable across tab taps (dbFriends doesn't change on tab nav). Identity correctly invalidates only when friends list updates from React Query.

**Why:** Forensics audit §5 RC-2 — was the second root cause busting HomePage memo independently of handlers.X. Without this fix, even after RC-1, HomePage would still re-render on every parent state change.

**Lines changed:** +5 added (useMemo wrap + closing deps), 0 modified body lines.

### `scripts/ci/check-no-inline-tab-props.sh` — region bounds update

**Before:** `NR>=2529 && NR<=2645` (Wave 2.6 bounds).
**Now:** `NR>=2589 && NR<=2703` (Wave 2.7 bounds — +60 lines from new useCallback wrappers shifted the tab JSX).
**Why:** Without the update, the gate scanned earlier scaffolding code and produced false positives (CoachMarkProvider inline navigateToTab, friend-profile-overlay onBack/onMessage, etc., all of which are NOT tab JSX but matched the awk pattern in the wrong region).
**Lines changed:** 2 (comment + awk NR range).

### `scripts/ci/check-no-inline-map-in-appcontent.sh` — NEW 9th gate

**Why:** Per dispatch §9 (optional — implemented). Detects unmemoized inline `.map()` / `.filter()` declarations in AppContent body lines 144-2700. The exact pattern that surfaced RC-2 in the audit. Permanent regression prevention.

**Negative-control:** documented in script comment. Insert `const x = [].map(y => y);` at line 200 → exit 1 → revert → exit 0.

**Awk regex notes:** the original spec used grouped alternation `(.*\.map\(|.*\.filter\()` which awk doesn't support. Refactored to use awk's `||` operator across separate `/regex/` blocks. Functionally equivalent, syntactically valid.

---

## §5 Spec Traceability

| Dispatch criterion | Status | Evidence |
|---|---|---|
| §3.A — 10 useCallback wrappers added with handlersRef.current bodies | ✅ PASS | All 10 declared in app/index.tsx hoist block (verified by grep `^  const stableHandle`) |
| §3.A — 12 JSX prop sites replaced | ✅ PASS | `awk` over tab JSX region (lines 2589-2703) returns 0 `={handlers\.` matches |
| §3.B — availableFriendsForSessions useMemo with [dbFriends] dep | ✅ PASS | line 1014 `const availableFriendsForSessions = useMemo<Friend[]>(...)` with `[dbFriends]` |
| §3.C — sweep for sibling unmemoized inline maps | ✅ PASS | awk over body lines 144-2700 returns 0 violations |
| §6 Step 1 — 9 CI gates green | ✅ PASS | all 9 gates green |
| §6 Step 1 — TypeScript clean | ✅ PASS | only the 3 pre-existing errors |
| §6 Step 2 — Runtime F-01 retest | ⏳ PENDING | requires founder dev-client retest |
| §6 Step 3 — Verification gate per forensics §8 | ⏳ PENDING | gate triggers if post-fix shows >1 log per tap |
| §9 — Optional CI gate added | ✅ PASS | check-no-inline-map-in-appcontent.sh created and passes |

---

## §6 Invariant Verification

### Wave 1 (preserved)
- ✅ I-ANIMATIONS-NATIVE-DRIVER-DEFAULT
- ✅ I-LOCALES-LAZY-LOAD
- ✅ I-ZUSTAND-PERSIST-DEBOUNCED

### Wave 2 + 2.5 + 2.6 (preserved)
- ✅ I-TAB-PROPS-STABLE
- ✅ I-TAB-SCREENS-MEMOIZED
- ✅ I-SENTRY-SINGLE-INIT
- ✅ I-HOOKS-ABOVE-EARLY-RETURNS
- ✅ I-PROVIDER-VALUE-MEMOIZED (NavigationContext, MobileFeaturesProvider, CoachMarkContext, CardsCacheContext)

### New (Wave 2.7)
- **I-NO-INLINE-MAP-IN-APPCONTENT** — NEW. CI gate `check-no-inline-map-in-appcontent.sh`. Prevents recurrence of RC-2-class bugs.

### Conceptual (no formal CI gate yet, but enforced via I-TAB-PROPS-STABLE)
- **I-HANDLERS-X-STABLE** — every `handlers.X` access in JSX must go through a `useCallback` wrapper that reads via `handlersRef.current`. Currently enforced because I-TAB-PROPS-STABLE catches `={handlers.` as inline-style if it's a property access; but that's coincidental, not definitional. Worth a separate gate eventually, or fix at source (TS-1.5).

---

## §7 Parity Check

**Solo + Collab parity:** All 10 wrapped handlers preserve original semantics exactly — they forward parameters via `handlersRef.current.handleX(...)` with no transformation. `handleModeChange` (the only mode-aware handler) routes solo/collab identically before and after.

**iOS + Android parity:** N/A — pure render-perf change.

---

## §8 Cache Safety

No query keys changed. No mutation logic changed. `useMemo([dbFriends])` correctly captures dbFriends's identity from React Query — when friends list updates, the memo re-runs and produces a fresh array, which correctly busts HomePage memo for that update only (intended behavior).

---

## §9 Regression Surface (focus areas for tester / founder retest)

1. **Tab navigation render isolation (PRIMARY):** tap each tab and verify only 0-1 tabs log render-count. This is THE test that gates ship.
2. **Save card flow (HomePage):** swipe right on a card → verify save still completes successfully. `stableHandleSaveCard` forwards to handlers.handleSaveCard via ref; if anything's wrong with the wrapper, save will fail.
3. **Mode change flow:** switch from solo to a collab session and back. `stableHandleModeChange` is the wrapper. Should switch modes correctly.
4. **Remove friend / Block / Report flows:** in Connections, exercise each. All use stable wrappers now.
5. **Calendar remove:** in Likes tab, remove a calendar entry. `stableHandleRemoveFromCalendar` is the wrapper.
6. **Notification toggle:** in Profile, toggle notifications. `stableHandleNotificationsToggle` is the wrapper.
7. **Activity navigation:** from Profile, tap saved/calendar shortcut. `stableHandleNavigateToActivity` wrapper.
8. **Available friends in session creation:** open session create modal in HomePage. The friends list should populate (RC-2 fix didn't change behavior, only memoization).
9. **Wave 1, 2, 2.5, 2.6 invariants:** all 9 CI gates verify these stay intact.

---

## §10 Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #1 No dead taps | Y (memo could mask) | ✅ Wrappers preserve tap dispatch — handlersRef always reads latest |
| #3 No silent failures | N | N/A |
| #5 Server state stays server-side | N | N/A |
| #7 Label temporary fixes | Y | TS-1.5 still labeled in INVARIANT_REGISTRY for follow-up |
| #8 Subtract before adding | N | Pure addition (workaround, not new feature) |
| All others | N | N/A |

---

## §11 Transition Items

**TS-1.5 (carryover from Wave 2.5):** `useAppHandlers` god-hook still returns fresh object every render. Wave 2.7 bypasses it via call-site wrappers. Future architectural fix should stabilize at the source. Risk: if a NEW handlers.X access is added to JSX in the future without going through a stableHandleX wrapper, it'll bust memo. Mitigation: I-TAB-PROPS-STABLE gate will catch the `={handlers.` pattern as a tab-prop violation (since `handlers.handleX` includes `={handlers.` substring which the gate's awk pattern flags as inline-like). Verify this assumption holds; if not, add an explicit I-HANDLERS-X-STABLE gate.

**TS-2 (carryover):** RecommendationsContext provider value not memoized. Affects deep children inside SwipeableCards, NOT tab-level memo. Re-classified per audit: lower priority than originally thought.

**TS-3 (carryover):** Sentry sendDefaultPii / enableLogs privacy review pending founder confirmation.

---

## §12 CI Gate Summary

```
check-i18n-lazy-load.sh                      I-LOCALES-LAZY-LOAD: PASS (Wave 1)
check-no-inline-map-in-appcontent.sh         I-NO-INLINE-MAP-IN-APPCONTENT: PASS (Wave 2.7 NEW)
check-no-inline-tab-props.sh                 I-TAB-PROPS-STABLE: PASS (region bounds updated 2589-2703)
check-no-native-driver-false.sh              I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS (Wave 1)
check-react-hooks-rules.sh                   I-HOOKS-ABOVE-EARLY-RETURNS: PASS (Wave 2.6)
check-render-counter-present.sh              Render-counter instrument: PASS (Wave 2)
check-single-sentry-init.sh                  I-SENTRY-SINGLE-INIT: PASS (Wave 2)
check-tabs-memo-wrapped.sh                   I-TAB-SCREENS-MEMOIZED: PASS (Wave 2)
check-zustand-persist-debounced.sh           I-ZUSTAND-PERSIST-DEBOUNCED: PASS (Wave 1)
```

9/9 green.

---

## §13 Discoveries for Orchestrator

- **D-WAVE2.7-IMPL-1:** `check-no-inline-tab-props.sh` region bounds shifted again (2529-2645 → 2589-2703). This is the THIRD time we've had to manually update line bounds (after Wave 2.5 and Wave 2.6). Worth refactoring the gate to use marker comments (`// WAVE2_TAB_REGION_START` / `// WAVE2_TAB_REGION_END`) instead of hardcoded line numbers, so future edits don't trigger this maintenance churn. Future ORCH.

- **D-WAVE2.7-IMPL-2:** Pre-existing 3 TypeScript errors (HomePage:246, :249, ConnectionsPage:2763) UNCHANGED. Not introduced by this wave. Still recommend a focused ORCH to fix them.

- **D-WAVE2.7-IMPL-3:** ORCH-0680 (PopularityIndicators conditional `useAnimatedStyle`) STILL OPEN from Wave 2.6 audit. Separate ORCH dispatch needed.

- **D-WAVE2.7-IMPL-4:** Confirmed dispatch §3.C sweep finding ZERO additional unmemoized inline maps in AppContent body. The CI gate (now active) will catch any future regressions. The audit's hypothesis that `availableFriendsForSessions` was the only such site is verified.

- **D-WAVE2.7-IMPL-5 (TS-1.5 reclassification):** With Wave 2.7's wrappers in place, the call-site impact of TS-1.5 is now zero for the 6 tabs. TS-1.5 itself (god-hook architectural debt) only matters now for: (a) `useCustomerInfoListener()` and similar hooks called inside AppContent that consume handlers, (b) any future tab additions, (c) any future `handlers.X` usage in JSX outside the tab block. Lower priority than before; can defer to post-launch.

---

## §14 Founder Retest Instructions

To verify the fix landed:

1. **Restart Metro:** stop the running Metro process (Ctrl+C), then `cd app-mobile && npx expo start --clear`
2. **Force-quit dev-client app** on phone, reopen
3. **Wait for HomePage to load**
4. **With dev console visible, tap each tab in sequence:**
   - Tap Discover → expect `[render-count] DiscoverScreen: 1` (or similar) and NO logs from other tabs
   - Tap Connections → expect `[render-count] ConnectionsPage: 1` (or similar) and NO logs from other tabs
   - Tap Discover AGAIN → expect ZERO logs (memo holds; props unchanged)
   - Tap Home → expect `[render-count] HomePage: 1` (or similar) and NO logs from other tabs
5. **Critical sanity test:** while on HomePage, wait ~30 seconds. Realtime events may fire (DM arrival, friend request, etc.). HomePage should NOT log render-count for those events — they don't change Home's input props.

If the diagnostic shows ALL or MANY tabs logging on a tap → there's a third unstable prop the audit missed. Send the new console paste and we'll do a Wave 2.8 audit.

If the diagnostic shows ONLY the new active tab logging → we've crossed the finish line. Founder should also notice the felt speedup on tab nav, even in dev mode.

---

## §15 Recommended Next Step

Hand this report back to the orchestrator. Orchestrator should:
1. Wait for founder dev-client retest result before declaring SUCCESS.
2. If retest is clean (0-1 tab logs per tap): dispatch tester for independent verification, then run CLOSE protocol (7-artifact SYNC + commit + EAS update commands).
3. If retest still shows storm: Wave 2.8 forensics audit (hopefully will not be needed — confidence HIGH that this lands clean).
4. Queue post-launch architectural cleanup: TS-1.5 (useAppHandlers), TS-2 (RecommendationsContext), ORCH-0680 (PopularityIndicators), D-WAVE2.7-IMPL-1 (CI gate marker comments).

---

**End of report. Two surgical fixes shipped. 9/9 CI gates green. TypeScript clean. Awaiting founder retest as the runtime live-fire gate.**
