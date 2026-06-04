# IMPLEMENTATION — ORCH-1063 [Sheet/nav freeze class — production freeze-after-close]

**Single change:** Mount `ExpandedCardModal`, `DismissedCardsSheet`, and `CustomPaywallScreen` EXACTLY ONCE, at a stable position OUTSIDE the deck-state `switch`, in `app-mobile/src/components/SwipeableCards.tsx`.

**Status:** implemented and verified (source-structural + typecheck). Device live-fire is the only step that requires a release build and is deferred to the tester / TestFlight.

---

## 1. Root cause (confirmed from source before editing)

In `SwipeableCards.tsx` the component body ran `switch (effectiveUIState.type)` and rendered `ExpandedCardModal` (a `wrapInRNModal` RN `<Modal>`) inside only TWO branches:

- the `EMPTY`/`EXHAUSTED` case — with review-navigation props (`onNavigateNext`/`onNavigatePrevious`/`navigationIndex`/`navigationTotal`) + a `DismissedCardsSheet`, and
- the `LOADED` fall-through main render — the fuller prop set (`onCardRemoved` + currentRec-matching `onSave`) + `DismissedCardsSheet` + `CustomPaywallScreen`.

The other branches (`INITIAL_LOADING`, `MODE_TRANSITIONING`, `ERROR`, `WAITING_FOR_PARTICIPANTS`, `EMPTY_POOL`, `AUTH_REQUIRED`, `PIPELINE_ERROR`) rendered NO modal. So when a card was expanded (`isExpandedModalVisible === true`) and `effectiveUIState.type` transiently flipped (token refresh → `AUTH_REQUIRED`, transient server error → `PIPELINE_ERROR`, background refetch/realtime update, or reaching deck end → `EXHAUSTED`, or `EMPTY`↔`LOADED`), React unmounted the currently-PRESENTED `ExpandedCardModal` and either mounted a different instance or none. On a real device + release build (production TestFlight), iOS tears the presented modal window down mid-flight, leaving an invisible full-screen modal that captures every touch → total app freeze. It never reproduces on a full-deck simulator because the deck state never flips while viewing. Operator confirmed: "tapped a card, then closed it" on the Home SOLO deck freezes in production TestFlight; clean on sim.

---

## 2. The fix (single stable instance)

The deck-state `switch` + the `LOADED` fall-through main-deck JSX are now wrapped in an IIFE assigned to `const deckBody: React.ReactNode = (() => { … })();` that returns ONLY deck content. The three overlays were REMOVED from every branch (the `EMPTY`/`EXHAUSTED` case AND the main render). The component's final return is now a fragment:

```tsx
return (
  <>
    {deckBody}
    <ExpandedCardModal … />
    <DismissedCardsSheet … />
    <CustomPaywallScreen … />
  </>
);
```

Because the overlays are now siblings of `deckBody` and never live inside a switch branch, no deck-state transition can unmount/remount/swap them — only their `visible` prop changes. That removes the mechanism that tore the presented modal down on device.

The single `ExpandedCardModal` is the UNIFIED superset: the fuller main-render prop set is the base (`onCardRemoved`, the currentRec-matching `onSave`, `onPurchase`, `onShare`, `target`, `isSaved`, `currentMode`, `userPreferences`, `accountPreferences`, `canAccessCurated`, `onPaywallRequired`), PLUS the four review-navigation props from the former `EMPTY`/`EXHAUSTED` instance:

```tsx
onNavigateNext={reviewIndex < reviewCards.length - 1 ? handleReviewNext : undefined}
onNavigatePrevious={reviewIndex > 0 ? handleReviewPrevious : undefined}
navigationIndex={reviewIndex}
navigationTotal={reviewCards.length}
```

These auto-disable when `reviewCards` is empty (`reviewIndex` 0, total 0 ⇒ both callbacks `undefined`), so they are inert during a normal LOADED-deck tap and active only during the EXHAUSTED "review dismissed → tap card" flow. The modal is therefore reachable identically from both flows. `DismissedCardsSheet` props are identical in the two former spots and were unified verbatim.

No prop was dropped. The `onSave` kept is the main-render version (it already branches on currentRec match vs the collab/solo fallback); the EXHAUSTED-case `onSave` (dismissed-sheet-source analytics + collab/solo) is functionally subsumed by the main-render fallback branch, and the modal's own card-press path supplies the dismissed-card context.

---

## 3. Old → New receipts

### app-mobile/src/components/SwipeableCards.tsx
**What it did before:** Rendered `ExpandedCardModal` + `DismissedCardsSheet` inside the `EMPTY`/`EXHAUSTED` switch branch, and a SECOND `ExpandedCardModal` + `DismissedCardsSheet` + `CustomPaywallScreen` inside the `LOADED` main render. Other deck states rendered no modal. A deck-state transition while a card was expanded unmounted/swapped the presented RN `<Modal>`.
**What it does now:** The switch + LOADED main render are wrapped in a `deckBody` IIFE that returns ONLY deck content. `ExpandedCardModal`, `DismissedCardsSheet`, and `CustomPaywallScreen` are each rendered EXACTLY ONCE in the component's final `<>{deckBody}…</>` fragment, outside the switch. The single `ExpandedCardModal` carries the unified main-render + review-navigation prop superset. Only `visible` toggles across deck-state transitions; the modal instance is never unmounted/remounted/swapped.
**Why:** Fixes the production freeze-after-close (ORCH-1063 root cause): a presented modal being torn down mid-flight on device left an invisible touch-capturing window.
**Lines changed:** 51 insertions / 84 deletions (net −33; the duplicated modal+sheet block was removed).

### app-mobile/src/components/__tests__/orch-1063-single-modal-instance.test.tsx (NEW)
**What it did before:** Did not exist.
**What it does now:** Structural regression test (project's established style for the giant SwipeableCards component, mirroring `orch-0945-dead-end-render.test.tsx`). Asserts: deck branches are wrapped in a `deckBody` value closed by `})();`; the final return renders `{deckBody}`; each overlay is rendered EXACTLY ONCE; every overlay sits AFTER the IIFE close (sibling of the switch, not inside a branch); the switch body contains ZERO overlay tags; and the single `ExpandedCardModal` carries both the `onCardRemoved` main-render prop and all four review-navigation props.
**Why:** Locks the single-stable-mount invariant; fails if any overlay is moved back inside the switch or duplicated.
**Lines changed:** new file, ~145 lines.

---

## 4. Typecheck result

`npx tsc --noEmit` in `app-mobile/`:

- **SwipeableCards.tsx: 0 errors** (`tsc … | grep -i SwipeableCards` returns empty).
- Total repo error count is **260 both WITH and WITHOUT my change** (verified by stash/pop). All 260 are pre-existing monorepo/test-config baseline noise (Deno test files lacking Deno types, `JSX` namespace in unrelated components, `packages/brand-rendering` resolving `react` under the symlinked node_modules, `@types/jest`-less payment tests, `BoardDiscussion` typing drift, etc.) — none in the touched file.

**Conclusion:** the change introduces zero new type errors; TypeScript-strict for the touched file is clean.

---

## 5. Regression test

- **Path:** `app-mobile/src/components/__tests__/orch-1063-single-modal-instance.test.tsx`
- **Run command:** `node src/components/__tests__/orch-1063-single-modal-instance.test.tsx` (from `app-mobile/`)
- **Passing-run output (on the fix):**
  ```
  PASS T-0..T-4 ORCH-1063 single stable overlay mount (ExpandedCardModal/DismissedCardsSheet/CustomPaywallScreen rendered exactly once, outside the deck-state switch)
  EXIT=0
  ```
- **fails-on-revert verified at commit `e2f250a092946b25ea980660c22978feec5ed669`** (origin/main HEAD before the fix). With `git stash push app-mobile/src/components/SwipeableCards.tsx` (reverting only the source while keeping the test), the test FAILS:
  ```
  AssertionError [ERR_ASSERTION]: T-0 deck-state branches must be wrapped in a `deckBody` value so the overlays can sit outside the switch
  EXIT_ON_REVERT=1
  ```
  Restored via `git stash pop`; test PASSES again (EXIT=0). The reverted source (modal inside the switch, two instances) fails T-0/T-1/T-2/T-3; the fixed source passes. The test genuinely exercises the bug.

### Adjacent SwipeableCards structural tests
`orch-0945-dead-end-render`, `orch-0918-message-and-deck-contract`, and `orch-0943-prefs-apply-coord-coherence` fail BOTH on my branch AND on the origin/main baseline (verified by stash/pop) — they are PRE-EXISTING stale-assertion failures (e.g. orch-0945 fails on `T-02 multi-outlier branch must render no-overlap copy`, a copy string in `getCollabDeadEndCopy`, which I did not touch). My change does not alter their pass/fail status. `orch-1029-coach-mark-fixes`, `orch_1016_nav_container_clearance`, and `orch_1025_seamless_native_cart` PASS. Registered as a discovery for the orchestrator below.

---

## 6. Spec traceability

| Dispatch criterion | Implemented | Evidence |
|---|---|---|
| Render the 3 overlays exactly once, outside the switch | YES | T-1/T-2/T-3 assert exactly-one + after-IIFE + none-in-switch-body |
| Convert switch + LOADED main JSX into `deckBody` value (IIFE), modals removed from every branch | YES | `const deckBody = (() => { switch … return (<View>…) })();`; modals removed from EMPTY/EXHAUSTED + main render |
| Final return = `<>{deckBody}<ExpandedCardModal/><DismissedCardsSheet/><CustomPaywallScreen/></>` | YES | source lines after `})();` |
| Unify the two ExpandedCardModal prop sets (main-render base + review-nav props) | YES | T-4 asserts `onCardRemoved` + all 4 nav props present on the single instance; `onSave` is the main-render version |
| DismissedCardsSheet unified to one instance | YES | single `<DismissedCardsSheet`; props identical in both former spots |
| Do NOT change BaseBottomSheet / ExpandedCardModal internals / other files | YES | only SwipeableCards.tsx + new test touched |
| Do NOT touch bottomNavStore / notifications sheet | YES | not touched |
| TypeScript strict passes | YES | §4 |
| No change to deck/collab/analytics/review-dismissed behaviour | YES | comments + logic preserved; review-nav props inert when reviewCards empty; collab onSave branch preserved |
| Modal reachable identically from LOADED tap + EXHAUSTED review flow | YES | single instance carries both prop sets; nav props auto-disable outside review |

---

## 7. Invariant preservation

- Deck state machine (`effectiveUIState` exhaustiveness, `default: never` guard): preserved — the switch and its `default` exhaustiveness guard are unchanged inside the IIFE.
- Collab quorum-safe save (ORCH-0532): preserved — the main-render `onSave` collab/solo branch is the one kept.
- Review-dismissed flow (visible-but-not-binding, ORCH-0902): preserved — nav props + `DismissedCardsSheet` + `handleReviewNext/Previous` unchanged, just relocated.
- Analytics (deck_empty/exhausted/server_error): preserved — fired inside the deck-state branches, untouched.

---

## 8. Cross-surface impact

- **Consumer iOS** + **Consumer Android** (`app-mobile/`): AFFECTED — same shared component, parity automatic. This is the freeze fix surface. The freeze manifested on iOS release builds (the dispatch's repro); the Android path uses the same RN `<Modal>` mount and inherits the same stabilization automatically.
- **Buyer/anon Web**, **Business iOS/Android**, **Admin Web**, **Business Web preview**: NOT AFFECTED — `SwipeableCards` is a consumer-app deck component; none of those surfaces render it.

Count of affected surfaces = 2, parity automatic (single shared component) → no manual cross-surface drift.

---

## 9. Regression surface (for the tester)

1. Tap a Home SOLO card → expand → close: must NOT freeze (the fix; verify on a release/TestFlight build, the only surface that reproduced).
2. EXHAUSTED deck → "Review all cards"/"Review dismissed" → tap a card: modal still opens with working next/previous navigation.
3. Collab deck: expand a card → save → quorum behaviour unchanged.
4. Paywall: tapping a curated card without access still triggers `CustomPaywallScreen`.
5. Deck-state transitions while a card is open (token refresh, background refetch, reaching deck end): modal stays presented (visible toggles), no swap.

---

## 10. Discoveries for orchestrator

- **Pre-existing stale structural tests:** `orch-0945-dead-end-render`, `orch-0918-message-and-deck-contract`, and `orch-0943-prefs-apply-coord-coherence` (all in `app-mobile/src/components/__tests__/`) FAIL on origin/main `e2f250a09` independent of this ORCH (verified by stash/pop). They assert on `getCollabDeadEndCopy`/message-contract source slices that drifted in prior ORCHs. Not in scope for ORCH-1063; flagged for a cleanup ORCH (these tests appear to run only ad hoc, not in a jest suite gate, so CI is not currently red on them).
- **Same freeze class elsewhere:** the dispatch deliberately narrowed scope to the solo deck. If the bottom-nav / notifications sheet (out of scope here) ever mounts an RN `<Modal>` conditionally on transient state, it would share this freeze mechanism — worth a forensic pass under the "sheet-nav-freeze-class" umbrella.

---

## 11. Completion condition

1. Spec criteria implemented + demonstrated — §6, all YES with cited evidence.
2. Regression test green + fails-on-revert at `e2f250a092946b25ea980660c22978feec5ed669` — §5.
3. `tsc --noEmit` clean on the touched file (260-error baseline unchanged) — §4. (No lint script exists in app-mobile beyond `expo lint`; not run — no lint-affecting constructs introduced.)
4. Constitution: no DB / edge / RLS / copy / silent-catch surfaces touched; pure structural relocation. N/A for most; PASS on "every state handled" (deck states unchanged) and "no silent failures" (error branches preserved).
5. No edge functions touched — N/A.

**Outcome:** implemented and verified at source + typecheck level. Device release-build live-fire is the tester's step.
