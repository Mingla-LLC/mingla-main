# Implementation Report — ORCH-0679 Wave 2.8.1 (Per-Tab Registry Integration)

**Status:** **partially completed** (4 of 5 tabs integrated; ConnectionsPage deferred per honesty contract; LikesPage inner-tab scroll deferred — out of file scope)
**Verification:** **passed** (TS clean modulo 3 pre-existing baseline errors; 10/10 CI gates PASS; founder F-RP / F-PRES retest pending on dev-client)
**Date:** 2026-04-27
**Spec:** `Mingla_Artifacts/specs/SPEC_ORCH-0679_WAVE2_8_PATH_B_TAB_MOUNT_UNMOUNT.md` §3 (Per-Tab State Preservation Matrix)
**Dispatch:** `Mingla_Artifacts/prompts/IMPL_ORCH-0679_WAVE2_8_1_PER_TAB_REGISTRY_INTEGRATION.md`

---

## §1 Layman Summary

Wave 2.8 (the architectural fix) shipped the speed win but introduced a UX regression: scroll positions, filters, and active sub-tabs reset whenever you switch away and come back to a tab. This pass closes that gap on 4 of the 5 originally-scoped tabs:

- **ProfilePage** — scroll position remembers where you were.
- **SavedExperiencesPage** — scroll + all 5 filter values (search query, category, match score, date range, sort).
- **DiscoverScreen** — scroll + filters (date / price / genre).
- **LikesPage** — inner-tab selection (Saved vs Calendar) remembers.

ConnectionsPage was **deferred** during pre-flight per the dispatch's honesty contract — see §13 for the two structural blockers found. LikesPage's inner-tab scroll preservation was also deferred because it requires modifying child components (SavedTab.tsx, CalendarTab.tsx) that aren't in this dispatch's 5-file scope.

Founder will feel the win immediately on the 4 wired tabs. Connections will continue to behave as it did under Wave 2.8 baseline (no regression, no fix).

---

## §2 Files Changed

| File | Change | Lines |
|---|---|---|
| `app-mobile/src/components/ProfilePage.tsx` | scroll registry via callback ref composition (composes with existing coach-mark scrollRef) | +18, -1 |
| `app-mobile/src/components/SavedExperiencesPage.tsx` | scroll registry + 5-filter snapshot/sync to Zustand | +27, -5 |
| `app-mobile/src/components/DiscoverScreen.tsx` | scroll registry + filter snapshot/sync (with type-narrowing cast on read) | +29, -5 |
| `app-mobile/src/components/LikesPage.tsx` | likesActiveTab snapshot/sync to registry | +9, -1 |

Total: 4 modified, 0 new, 0 deleted. Net ~+82 lines.

**NOT modified (per dispatch §5 constraints):** `app/index.tsx`, `appStore.ts`, `useTabScrollRegistry.ts`, any CI gate files. Wave 2.8 work intact.

---

## §3 Old → New Receipts

### `ProfilePage.tsx`

**What it did before:** Held a local `scrollRef` registered with `CoachMarkContext` for coach-mark scroll-offset steps. KeyboardAwareScrollView used `ref={scrollRef}`. No tab-registry integration; scroll position lost on tab unmount.

**What it does now:** Adds `useTabScrollRegistry('profile')` returning `registryScrollRef` + `handleRegistryScroll`. A `setScrollRefs` callback ref fans the ScrollView node to BOTH the existing `scrollRef` (coach-mark integration preserved) AND `registryScrollRef.current`. KeyboardAwareScrollView now uses `ref={setScrollRefs}` + `onScroll={handleRegistryScroll}` + `scrollEventThrottle={16}`.

**Why:** Spec §3 mandates `profile` scroll preservation. The existing scrollRef can't be replaced (coach-mark step 8/9 dependency), so callback-ref composition is the right pattern.

**Lines changed:** +18, -1.

### `SavedExperiencesPage.tsx`

**What it did before:** 5 filter useState defaults hardcoded ("", null, null, "all", "newest"). Single ScrollView with no ref. All filter values reset on tab unmount.

**What it does now:**
- Snapshots `useAppStore.getState().savedFilters` once at mount via `useMemo([])`.
- Initializes the 5 useState calls from snapshot fields (with defaults when registry is null on first-ever mount).
- Single `useEffect` syncs all 5 values back to the registry on every change.
- `useTabScrollRegistry('saved')` wires the ScrollView with ref + onScroll + scrollEventThrottle.

**Why:** Spec §3 marks all 5 filter fields as PRESERVE plus scroll position as PRESERVE for the Saved tab.

**Lines changed:** +27, -5.

### `DiscoverScreen.tsx`

**What it did before:** `selectedFilters` useState initialized to `{date: "any", price: "any", genre: "all"}`. Single main ScrollView at line ~1285 with no ref. Filter and scroll lost on tab unmount.

**What it does now:**
- Snapshots `useAppStore.getState().discoverFilters` once at mount via `useMemo([])`.
- Initializes `selectedFilters` from the snapshot, type-narrowing the loose `string` registry shape back to `DateFilter | PriceFilter | GenreFilter` unions via `as` cast (the registry is intentionally typed loose per appStore.ts:200 to avoid circular import — the component owns the shape).
- `useEffect` syncs `selectedFilters` to the registry on change.
- `useTabScrollRegistry('discover_main')` wires the main ScrollView with ref + onScroll + scrollEventThrottle.

**Why:** Spec §3 marks `selectedFilters` as PRESERVE and `discover_main` scroll as PRESERVE.

**Lines changed:** +29, -5.

### `LikesPage.tsx`

**What it did before:** `activeTab` useState defaulted to `"saved"`. Tab selection reset to "saved" on every remount.

**What it does now:**
- Initializes `activeTab` from `useAppStore.getState().likesActiveTab` (registry default is `"saved"` so first-ever mount unchanged).
- `useEffect` syncs `activeTab` to the registry on change.

**Why:** Spec §3 marks `activeTab` as PRESERVE for LikesPage.

**Lines changed:** +9, -1.

**Per-inner-tab scroll keys (`likes_saved`, `likes_calendar`) NOT integrated this pass.** See §13 deviation.

---

## §4 Spec Traceability

| Spec criterion (matrix item) | Status |
|---|---|
| HomePage — no registry needed (deck state via `deckStateRegistry`) | ✅ N/A per dispatch §3 |
| DiscoverScreen — `discover_main` scroll | ✅ DONE |
| DiscoverScreen — `selectedFilters` | ✅ DONE |
| ConnectionsPage — `connections_friends` / `_add` / `_blocked` scroll | ❌ DEFERRED (TS-WAVE2.8.1-1) |
| ConnectionsPage — `activePanel` | ❌ DEFERRED (TS-WAVE2.8.1-1) |
| ConnectionsPage — `friendsModalTab` | ❌ DEFERRED (TS-WAVE2.8.1-1) |
| ConnectionsPage — searchQuery | ❌ DEFERRED (TS-WAVE2.8.1-1) |
| SavedExperiencesPage — `saved` scroll | ✅ DONE |
| SavedExperiencesPage — searchQuery | ✅ DONE |
| SavedExperiencesPage — selectedCategory | ✅ DONE |
| SavedExperiencesPage — matchScoreFilter | ✅ DONE |
| SavedExperiencesPage — dateRangeFilter | ✅ DONE |
| SavedExperiencesPage — sortOption | ✅ DONE |
| LikesPage — `likes_saved` / `likes_calendar` scroll | ❌ DEFERRED (TS-WAVE2.8.1-2 — out of file scope) |
| LikesPage — `activeTab` | ✅ DONE |
| ProfilePage — `profile` scroll | ✅ DONE |

**Total: 9 items DONE / 6 items DEFERRED across 2 transition tickets.**

---

## §5 Verification Matrix

| Spec SC | Status | Evidence |
|---|---|---|
| W2.8.1-01 (Discover scroll restored) | ⏳ FOUNDER-VERIFICATION-PENDING | Code shipped; needs F-RP retest |
| W2.8.1-02 (Saved search query persists) | ⏳ FOUNDER-VERIFICATION-PENDING | Code shipped; needs F-PRES retest |
| W2.8.1-03 (Connections Add panel persists) | ❌ NOT IMPLEMENTED | Connections deferred — see §13 |
| W2.8.1-04 (Likes Calendar inner tab persists) | ⏳ FOUNDER-VERIFICATION-PENDING | activeTab persists; per-tab scroll deferred |
| W2.8.1-05 (10 CI gates green) | ✅ PASS | All 10 gates verified PASS (output §11) |
| W2.8.1-06 (TypeScript clean — 3 pre-existing errors only) | ✅ PASS | `tsc --noEmit` returns exactly 3 baseline errors (§11) |
| W2.8.1-07 (F-01 still passes) | ⏳ NO ARCHITECTURAL CHANGE | IIFE switch in app/index.tsx untouched; should still pass |
| W2.8.1-08 (Logout clears tab registry) | ✅ PASS | `clearUserData` in appStore.ts already resets registry per Wave 2.8 |

---

## §6 Invariants

### Preserved
All 10 Wave 1 + 2 + 2.5 + 2.6 + 2.7 + 2.8 invariants — none of those areas modified.
- `I-ONLY-ACTIVE-TAB-MOUNTED`: PASS
- `I-LOCALES-LAZY-LOAD`: PASS
- `I-NO-INLINE-MAP-IN-APPCONTENT`: PASS
- `I-TAB-PROPS-STABLE`: PASS
- `I-ANIMATIONS-NATIVE-DRIVER-DEFAULT`: PASS
- `I-HOOKS-ABOVE-EARLY-RETURNS`: PASS
- Render-counter instrument: PASS
- `I-SENTRY-SINGLE-INIT`: PASS
- `I-TAB-SCREENS-MEMOIZED`: PASS
- `I-ZUSTAND-PERSIST-DEBOUNCED`: PASS

### New
None introduced.

---

## §7 Parity Check

**Solo + Collab:** All 4 tabs integrated are mode-agnostic. `selectedFilters` / `searchQuery` / `activeTab` apply identically in solo and collab. Switching mode does not unmount the tab; only changing `currentPage` does (and the registry preserves state across that).

**iOS + Android:** N/A — pure React component-level state work. No platform-specific code.

**ConnectionsPage parity:** N/A — deferred entirely (no fix means no parity concern; matches Wave 2.8 baseline).

---

## §8 Cache Safety

No React Query keys changed. No mutations changed. No data-shape changes.

The Zustand registry is **session-scoped only** (NOT in `partialize` per Wave 2.8 design). On app restart, the registry resets to defaults and tabs initialize fresh. This is intentional — restoring a 30-day-old scroll position would be more confusing than helpful.

---

## §9 Constitutional Compliance

| Principle | Touched? | Status |
|---|---|---|
| #1 No dead taps | N | N/A |
| #2 One owner per truth | Y | ✅ For Saved/Discover/Likes/Profile, the registry is the source of truth between tab unmount/remount cycles; local useState is the source within a mount session. The useEffect-write pattern flows local → registry, never registry → local except at mount snapshot. **For ConnectionsPage, this principle is the reason for deferral** — `activePanel` is `[TRANSITIONAL] legacy — being replaced by showFriendsModal`; wiring a registry to deprecated state would create a competing source of truth on dying code. See §13. |
| #5 Server state stays server-side | Y | ✅ Filter values (searchQuery / selectedCategory / etc.) and UI flags (activeTab) are CLIENT state — correct Zustand usage |
| #6 Logout clears everything | Y | ✅ Already enforced by Wave 2.8 `clearUserData` extension |
| #7 Label temporary | Y | TS-WAVE2.8.1-1 (ConnectionsPage) and TS-WAVE2.8.1-2 (LikesPage inner-tab scroll) documented in §13 with exit conditions |
| #8 Subtract before adding | N | No code subtracted — all additions to existing pattern |
| #9 No fabricated data | N | N/A |

---

## §10 Regression Surface (focus areas for tester)

1. **ProfilePage scroll:** scroll Profile, switch tabs, return → scroll position should restore. **Most importantly: coach-mark steps 8 and 9 must still work** — the callback ref composition is the most novel change in this pass and could break coach marks if the ref isn't properly fanned out. Test: trigger coach mark tour on Profile, advance to step 8 (Account Settings) and step 9 (Beta Feedback) — verify spotlight cutout is correctly positioned.
2. **SavedExperiencesPage filter persistence:** type a search query, set a category filter, switch tabs, return → both should still be applied. Bonus: verify the sortOption persists too.
3. **SavedExperiencesPage initial load:** first-ever mount (no registry data) should default to `("", null, null, "all", "newest")` — same as before.
4. **DiscoverScreen filter persistence:** set date/price/genre filters via the filter modal, switch tabs, return → filter pills/chip count should still match.
5. **DiscoverScreen scroll on a long grid:** scroll deep, switch, return → scroll position restored.
6. **LikesPage inner tab:** switch to Calendar inner tab, switch tabs, return to Likes → still on Calendar. (Note: scroll inside Calendar/Saved inner tabs will NOT be preserved — that's TS-WAVE2.8.1-2.)
7. **Logout flow:** sign out → registry cleared (Wave 2.8 behavior); sign back in → all tabs initialize fresh.

---

## §11 CI Gate + TypeScript Output (verbatim)

```
=== scripts/ci/check-active-tab-only.sh ===
I-ONLY-ACTIVE-TAB-MOUNTED: PASS
=== scripts/ci/check-i18n-lazy-load.sh ===
I-LOCALES-LAZY-LOAD: PASS (23 static en imports, 28 lazy loaders)
=== scripts/ci/check-no-inline-map-in-appcontent.sh ===
I-NO-INLINE-MAP-IN-APPCONTENT: PASS
=== scripts/ci/check-no-inline-tab-props.sh ===
I-TAB-PROPS-STABLE: PASS
=== scripts/ci/check-no-native-driver-false.sh ===
I-ANIMATIONS-NATIVE-DRIVER-DEFAULT: PASS
=== scripts/ci/check-react-hooks-rules.sh ===
I-HOOKS-ABOVE-EARLY-RETURNS: PASS
=== scripts/ci/check-render-counter-present.sh ===
Render-counter instrument: PASS (6/6 tabs instrumented)
=== scripts/ci/check-single-sentry-init.sh ===
I-SENTRY-SINGLE-INIT: PASS (1 Sentry.init found)
=== scripts/ci/check-tabs-memo-wrapped.sh ===
I-TAB-SCREENS-MEMOIZED: PASS (6/6 tabs memoized)
=== scripts/ci/check-zustand-persist-debounced.sh ===
I-ZUSTAND-PERSIST-DEBOUNCED: PASS
```

```
$ npx tsc --noEmit
src/components/ConnectionsPage.tsx(2763,52): error TS2345: ...   [PRE-EXISTING]
src/components/HomePage.tsx(246,19): error TS2741: ...           [PRE-EXISTING]
src/components/HomePage.tsx(249,54): error TS2741: ...           [PRE-EXISTING]
```
3 errors total — all pre-existing, identical to Wave 2.8 baseline. Zero new errors.

---

## §12 Founder Retest Instructions

1. Stop Metro: Ctrl+C
2. `cd app-mobile && npx expo start --clear`
3. Force-quit dev-client app, reopen
4. Sign in. Land on Home.

**F-RP-1 (Discover scroll restore):**
- Tap Discover. Scroll the grid down ~50%. Tap Home. Tap Discover.
- Expected: scroll position is where you left it (NOT top).

**F-RP-2 (Saved scroll restore):**
- Tap Saved (must have ≥10 saved cards for visible scroll).
- Scroll down. Tap Home. Tap Saved.
- Expected: scroll position restored.

**F-RP-3 (Profile scroll + coach-mark integration):**
- Tap Profile. Scroll down. Tap Home. Tap Profile.
- Expected: scroll position restored.
- Optional: trigger coach-mark tour, advance to steps 8 and 9. Spotlight should still align correctly on Account Settings + Beta Feedback (callback-ref composition didn't break the coach-mark integration).

**F-PRES-1 (Saved filters):**
- Tap Saved. Type "pizza" in search. Set category to a non-default. Tap Home. Tap Saved.
- Expected: search query still says "pizza", category filter still set.

**F-PRES-2 (Discover filters):**
- Tap Discover. Open filter modal. Set date / price / genre to non-defaults. Apply.
- Tap Home. Tap Discover.
- Expected: filter pill chip count matches what you set; reopening modal shows the same values.

**F-PRES-3 (Likes inner tab):**
- Tap Likes. Switch to Calendar inner tab. Tap Home. Tap Likes.
- Expected: still on Calendar.
- KNOWN LIMITATION: scroll inside Calendar/Saved inner tabs WILL reset (TS-WAVE2.8.1-2).

**F-01 (regression check):**
- Tap each tab in sequence. Expected: 1 `[render-count]` log per tap (Wave 2.8 invariant unchanged).

**F-LOGOUT (Constitution #6):**
- Scroll Discover. Sign out. Sign back in. Tap Discover.
- Expected: scroll position is at top (registry was cleared on logout).

---

## §13 Spec Deviations + Transition Items

### TS-WAVE2.8.1-1 (P1, ConnectionsPage deferred entirely): Two structural blockers

**What's NOT done:** ConnectionsPage tab integration (per-panel scroll keys + `activePanel` + `friendsModalTab` + searchQuery preservation). All four entries in spec §3 for ConnectionsPage are deferred.

**Blocker 1 — Constitution #2 risk on `activePanel`:**
[ConnectionsPage.tsx:355](app-mobile/src/components/ConnectionsPage.tsx#L355) declares:
```ts
const [activePanel, setActivePanel] = useState<PanelId>(null); // [TRANSITIONAL] legacy — being replaced by showFriendsModal
```
The state is explicitly flagged transitional. Wiring a Zustand registry to a state being deprecated by an in-flight refactor would create a competing source of truth on dying code. Per the dispatch's honesty contract: "If filter state is currently passed up to a parent or stored elsewhere, STOP and report — don't create a competing source of truth (Constitution #2)."

**Blocker 2 — Type schema mismatch:**
- Zustand registry type at [appStore.ts:211](app-mobile/src/store/appStore.ts#L211): `connectionsFriendsModalTab: 'friend-list' | 'requests' | 'add' | null`
- Actual state at [ConnectionsPage.tsx:361](app-mobile/src/components/ConnectionsPage.tsx#L361): `useState<FriendsModalTab>("friend-list")` where `FriendsModalTab` resolves to `'friend-list' | 'sent' | 'requests' | 'blocked'`

`'sent'` and `'blocked'` exist in code but not in the registry type. `'add'` exists in registry but not in code. Either the spec is stale, or the component diverged after the spec was written. Force-fitting via `as any` cast would be a Constitution violation; reconciling requires either updating the registry type or refactoring the component — both expand scope beyond per-tab integration.

Plus: Connections has 3+ scroll regions and the per-panel scroll-key mapping (`connections_friends` / `connections_add` / `connections_blocked`) doesn't cleanly map to the actual two-state architecture (`activePanel` outer + `friendsModalTab` inner).

**Risk impact:**
- ConnectionsPage continues to behave as it did under Wave 2.8 baseline — scroll/panel/sub-tab/searchQuery all reset on tab switch.
- No regression vs. yesterday; just no fix in this pass.

**Exit condition:**
A scoped follow-up wave (Wave 2.8.2 or separate ORCH) that:
1. Resolves the `activePanel` transitional status (either commit to the legacy state OR complete the showFriendsModal refactor).
2. Reconciles the `friendsModalTab` type schema (update registry type to match component, OR refactor component to match registry).
3. Then wires the registry per spec §3 row "ConnectionsPage."

Recommend orchestrator-side decision: registers as separate ORCH for proper triage rather than a TS- ticket inside ORCH-0679.

### TS-WAVE2.8.1-2 (P2, LikesPage inner-tab scroll deferred): Out of file scope

**What's NOT done:** `likes_saved` and `likes_calendar` per-inner-tab scroll preservation.

**Why deferred:** LikesPage delegates rendering to `<SavedTab />` (line 314) and `<CalendarTab />` (line 329). The actual ScrollView/FlatList for each inner tab lives inside those child components — `app-mobile/src/components/activity/SavedTab.tsx` and `CalendarTab.tsx`. Wiring `useTabScrollRegistry('likes_saved')` and `('likes_calendar')` requires modifying child files NOT in this dispatch's 5-file scope.

**Risk impact:** Inner-tab scroll resets on tab switch. Visible if user scrolls deep into Saved or Calendar list, switches away, returns.

**Exit condition:** Separate small dispatch wiring `useTabScrollRegistry` into SavedTab.tsx and CalendarTab.tsx. ~5 lines per file. Doesn't conflict with anything else.

### Honesty disclosure

Both deferrals were surfaced in chat at pre-flight time and acknowledged by the orchestrator before code was written. They are not silent skips. The user-perceived gap (Connections behavior unchanged from Wave 2.8 + scroll inside Likes inner tabs unchanged from Wave 2.8) is documented for the founder to make a clear-eyed decision on follow-up scope.

---

## §14 Discoveries for Orchestrator

- **D-WAVE2.8.1-IMPL-1:** ConnectionsPage `activePanel` is marked `[TRANSITIONAL] legacy — being replaced by showFriendsModal` at line 355. There is in-flight refactor work implied; an orchestrator-side decision is needed on whether to complete or roll back the showFriendsModal direction. Recommend a separate ORCH for that decision.

- **D-WAVE2.8.1-IMPL-2:** Type schema mismatch between Zustand `connectionsFriendsModalTab` (allows `'add'`) and actual code (allows `'sent'` and `'blocked'`). Either the registry type or the component is stale. Both are wrong simultaneously — neither can claim authority. Needs reconciliation as part of the ConnectionsPage follow-up.

- **D-WAVE2.8.1-IMPL-3:** Profile coach-mark `registerScrollRef('profile', scrollRef)` at line 142 is keyed by the string `'profile'`. The new tab-registry hook is keyed by the string `'profile'` too (different namespace). No collision currently, but if the coach-mark and tab-scroll registries ever merge, the namespace clash needs explicit resolution. Document for future auditors.

- **D-WAVE2.8.1-IMPL-4:** `useState` initial-value computation in LikesPage uses `useAppStore.getState().likesActiveTab` directly (no `useMemo`). React's useState ignores subsequent initial-value computations after first render — works correctly but recomputes on every render. Negligible perf impact (single object property read), but if future code adds expensive snapshot computation, wrap in `useMemo([])` like SavedExperiencesPage / DiscoverScreen do. Note for code reviewers, not a fix.

- **D-WAVE2.8.1-IMPL-5:** The `as React.RefObject<ScrollView>` cast on the registry hook's `scrollRef` (used in DiscoverScreen and SavedExperiencesPage) papers over the hook's union ref type (`ScrollView | FlatList | null`). Could be avoided by tightening the hook's return type to a generic, but that's a hook-API change out of this dispatch's scope. Document for hook-refactor follow-up.

---

## §15 Recommended Next Step

Hand to orchestrator. Orchestrator should:

1. **Decide on TS-WAVE2.8.1-1 (Connections deferral):** ACCEPT (register Connections follow-up as separate ORCH for proper triage of the `activePanel` transitional + type-schema reconciliation) OR send back (force a resolution path now).
2. **If ACCEPT:** dispatch founder F-RP / F-PRES retest on dev-client. On PASS → commit Wave 2.8.1, hold OTA, await ORCH-0694 fix to bundle.
3. **If SEND BACK:** I'd need an orchestrator decision on the `activePanel` transitional direction and the `friendsModalTab` type reconciliation BEFORE I can proceed — this is not implementation choice, it's program direction.
4. Recommend ACCEPT — the 4 wired tabs deliver the bulk of the user-visible win; ConnectionsPage was always the most architecturally compromised tab (per Wave 2.7+ history); a clean separate ORCH gets it the rigor it deserves rather than being smuggled into a follow-up wave.

---

## §16 Commit Message (ready to use)

```
perf(android): ORCH-0679 Wave 2.8.1 — per-tab registry integration (4 of 5 tabs)

Wire ProfilePage, SavedExperiencesPage, DiscoverScreen, LikesPage to the
Zustand tab registry shipped in Wave 2.8 so scroll positions, filters, and
inner-tab selections survive Path B's mount-only-active-tab unmount/remount.

- ProfilePage: callback-ref composition (registry + existing coach-mark ref)
- SavedExperiencesPage: scroll + 5-filter snapshot/sync (search, category,
  match score, date range, sort)
- DiscoverScreen: scroll + filter snapshot/sync (date/price/genre)
- LikesPage: activeTab snapshot/sync (saved vs calendar)

ConnectionsPage DEFERRED (TS-WAVE2.8.1-1): activePanel marked
[TRANSITIONAL] in code (Constitution #2 risk); friendsModalTab type
schema mismatch between Zustand registry and component state. Needs
separate ORCH for proper triage.

LikesPage inner-tab scroll DEFERRED (TS-WAVE2.8.1-2): requires modifying
SavedTab.tsx and CalendarTab.tsx (out of dispatch's 5-file scope).

10/10 CI gates green. TypeScript clean (3 pre-existing baseline errors only).
```

---

**End of report. 4 of 5 tabs wired. 2 deferrals documented honestly. CI + TS clean. F-RP/F-PRES retest is the verification gate. Orchestrator decides on TS-WAVE2.8.1-1 acceptance.**
