# SPEC — ORCH-0828 REWORK: business-event sheet + filter render

**Mode:** SPEC (rework, revised after operator pattern question)
**Investigator:** Claude `mingla-forensics`
**Spec author:** Claude `mingla-forensics`
**Date:** 2026-05-14 (revised same day)
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0828_BRUTAL_RETEST_REPORT.md` (proven S2, probable S1, live-fire evidence in `Mingla_Artifacts/reports/orch-0828-retest/`)
**Supersedes (in this scope only):** `Mingla_Artifacts/specs/SPEC_ORCH-0828_CONSUMER_DISCOVER_TIMEZONE_AND_SHEET_BUGS.md` (only S2/S3 sheet bits — the original spec's `new Date` fix and the discriminated-union refactor are already shipped and correct).

---

## 1. Layman Summary

Two surgical fixes. (1) The Discover grid is hidden whenever Ticketmaster returns zero events, even if Mingla business events were returned — change one boolean to consider both arrays. (2) Drop the `BottomSheetModal` (portal) pattern entirely from the business-event sheet and switch to the **same inline `<BottomSheet>` pattern the Ticketmaster sheet uses** — it's the proven working path on this sim, has the right "swipe-up modal" UX feel, and doesn't require a provider, a portal, `present()` ref dance, or `enableDynamicSizing={false}` workarounds. Same component, declarative `index={visible ? 1 : -1}`, `BottomSheetScrollView` inside, multiple snap points so the sheet has a natural "preview" + "full" gesture. Zero schema changes, zero edge function changes, zero new dependencies, **deletes the `BottomSheetModalProvider`** added in Sub-A2.

---

## 2. Scope and Non-Goals

### 2.1 In scope

| # | Scope item | Source |
|---|---|---|
| S1 | `DiscoverScreen.tsx` `showEmpty` predicate considers `businessEvents.length` | Investigation R1 (proven) |
| S2 | `DiscoverScreen.tsx` `hasCache` / `showLoadingSkeleton` / `showFilterNoMatch` audit for the same flaw | Investigation R1 blast radius |
| S3 | `ExpandedBusinessEventSheet.tsx` rewritten to use **inline `<BottomSheet>` matching the proven TM pattern** at `ExpandedCardModal.tsx:1602-2066` | Operator architectural question + investigation R2 |
| S4 | `app/_layout.tsx` removes `BottomSheetModalProvider` (no longer needed — inline pattern doesn't require it) | Consequence of S3 |
| S5 | Jest contract test: `DiscoverScreen` renders the grid (not empty state) when merged response has `businessEvents > 0` AND `nightOutCards.length === 0` | Investigation regression prevention §8 |
| S6 | Expand `[NightOutService] searchMerged:` log to include `localStartEndDateTime`, `timezone`, `segmentSlug` | Investigation Contributing Factor C1 |

### 2.2 Non-goals (explicitly out of scope — register as sibling ORCHs)

| # | Non-goal | Sibling ORCH path |
|---|---|---|
| N1 | `nightOutCache` persists only TM cards (Hidden Flaw H1) — business events vanish on cache-hit re-mount | Register sibling ORCH after this rework lands |
| N2 | DiscoverScreen renders 31+ times on cold mount due to `tabScroll` Zustand cascade (Hidden Flaw H2) | Register sibling ORCH |
| N3 | iOS GPS error UX banner (Discovery #1) | Register sibling P3 ORCH |
| N4 | Missing `filter-outline` icon warning + CoachMark orphan (Discoveries #2-3) | Batch into a P3 hygiene ticket |
| N5 | Changing the shared `glass.bottomSheet` design tokens | Out of scope — business sheet uses the same tokens TM does |

### 2.3 Assumptions

- A1: The operator's iPhone 17 Pro sim still has consumer app `com.mingla.app.v2` installed from EAS build `cf5d8564-be53-46c9-a64f-e5eff9a0c0be`, Metro on `:8084` running. TEST will live-fire from there.
- A2: Deployed `discover-merged-events` continues to return Big Party for the Tonight-in-NY window (verified at `Mingla_Artifacts/reports/orch-0828-retest/13_curl_tonight_raw.json`).
- A3: The inline `<BottomSheet>` pattern is the proven working path on the operator's sim — confirmed by `Mingla_Artifacts/reports/orch-0828-retest/05_discover_now.png` showing the Linkin Park (TM) sheet open at index 1 of its `['50%', '90%']` snap point config.
- A4: `glass.bottomSheet.snapPoints = ['50%', '90%']` is the canonical token (verified at `app-mobile/src/constants/designSystem.ts:290`).

---

## 3. Per-Layer Specification

### 3.1 Database layer — N/A

No schema changes.

### 3.2 Edge function layer — N/A

`discover-merged-events` is correct (curl probe confirmed Tonight returns Big Party).

### 3.3 Service layer — `app-mobile/src/services/nightOutExperiencesService.ts`

**S6 only.** Inside `searchMerged()`, find the existing log:

```ts
console.log("[NightOutService] searchMerged:", {
  city: input.city.name,
  partyTypes: input.partyTypeSlugs,
  vibes: input.vibeTagSlugs,
  genres: input.musicGenreSlugs,
});
```

Replace with:

```ts
console.log("[NightOutService] searchMerged:", {
  city: input.city.name,
  partyTypes: input.partyTypeSlugs,
  vibes: input.vibeTagSlugs,
  genres: input.musicGenreSlugs,
  segmentSlug: input.segmentSlug,
  localStartEndDateTime: input.localStartEndDateTime,
  timezone: body.timezone, // the resolved value sent to the server
});
```

### 3.4 App root — `app/_layout.tsx`

**S4 (mandatory).** Remove the `BottomSheetModalProvider` import and wrapper. Final state matches pre-Sub-A2:

```tsx
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// (no @gorhom/bottom-sheet import)
import { StripeNativeProvider } from "@mingla/payments-native";

// ...

export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeNativeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </StripeNativeProvider>
    </GestureHandlerRootView>
  );
});
```

Rationale: inline `<BottomSheet>` does NOT use `BottomSheetModalProvider`. Keeping the provider mounted is dead weight and adds complexity for nothing.

### 3.5 Component layer — `app-mobile/src/components/DiscoverScreen.tsx`

**S1 (mandatory).** Find:

```ts
const showEmpty =
    !nightOutLoading && !nightOutError && nightOutCards.length === 0;
```

Replace with:

```ts
// ORCH-0828 REWORK: empty state must consider BOTH content arrays.
// The merged endpoint can return businessEvents > 0 and nightOutCards === 0
// for tight date windows in small markets — prior version hid those events.
const showEmpty =
    !nightOutLoading &&
    !nightOutError &&
    nightOutCards.length === 0 &&
    businessEvents.length === 0;
```

**S2 (audit, fix as needed).** Same pattern across the sibling derivations:
1. `hasCache`: currently `nightOutCards.length > 0`. Change to `nightOutCards.length > 0 || businessEvents.length > 0`. Add `// ORCH-0828 REWORK` comment.
2. `showLoadingSkeleton`: currently `nightOutLoading && nightOutCards.length === 0`. Change to `nightOutLoading && nightOutCards.length === 0 && businessEvents.length === 0`.
3. `showGrid`: definitionally inverts the others — leave as is, will be correct once siblings are fixed.
4. `showFilterNoMatch`: read the full derivation and apply the same audit. If it gates on `nightOutCards.length === 0` alone, fix to consider both.

### 3.6 Component layer — `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

**S3 (mandatory) — full rewrite of the rendering pattern.**

The reference implementation is `ExpandedCardModal.tsx:1602-2066` (the TM/place path). The business sheet adopts the same primitives and conventions.

#### 3.6.1 Imports

Replace:

```ts
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
```

With:

```ts
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
```

#### 3.6.2 Constants

Replace:

```ts
const SHEET_SNAP_POINTS: string[] = ["95%"];
```

With:

```ts
// ORCH-0828 REWORK: use canonical bottomSheet snapPoints from design tokens,
// matching the TM/place path. Two snap points give the user a natural
// 50% preview + 90% full gesture (drag-up to fill, drag-down to preview,
// drag-down-again to dismiss).
import { glass } from "../../constants/designSystem";
const SHEET_SNAP_POINTS = glass.bottomSheet.snapPoints as unknown as (string | number)[];
const SHEET_INITIAL_INDEX = 1; // open at the 90% snap (full view), like the TM sheet
```

(Import line goes with the other constants imports near the top of the file.)

#### 3.6.3 Ref + lifecycle

Replace the `BottomSheetModal` ref and the imperative `present()`/`dismiss()` useEffect with the **declarative `index` pattern**:

```ts
const sheetRef = useRef<BottomSheet>(null);
// (drop the BottomSheetModal import and ref)
```

Replace the existing mount/visible useEffect (currently calls `present()`/`dismiss()`) with the diagnostic log only:

```ts
useEffect(() => {
  console.log(
    "[ExpandedBusinessEventSheet] visible=",
    visible,
    "eventId=",
    data.eventId,
  );
}, [visible, data.eventId]);
```

(The sheet open/close is now driven by the declarative `index` prop on the `<BottomSheet>` JSX — no ref dance.)

#### 3.6.4 onChange handler

Match the TM pattern. Replace `handleDismiss` with:

```ts
const handleSheetChange = useCallback(
  (index: number) => {
    console.log("[ExpandedBusinessEventSheet] onChange index=", index);
    if (index === -1) {
      // User swiped down to dismiss OR backdrop press collapsed the sheet.
      onClose();
    }
  },
  [onClose],
);
```

#### 3.6.5 JSX

Replace the entire `<BottomSheetModal>...</BottomSheetModal>` return with:

```tsx
return (
  <BottomSheet
    ref={sheetRef}
    index={visible ? SHEET_INITIAL_INDEX : -1}
    snapPoints={SHEET_SNAP_POINTS}
    enablePanDownToClose
    onChange={handleSheetChange}
    backdropComponent={renderBackdrop}
    backgroundStyle={styles.sheetBackground}
    handleIndicatorStyle={styles.sheetHandle}
  >
    <BottomSheetScrollView
      style={styles.sheetScroll}
      contentContainerStyle={styles.sheetScrollContent}
    >
      <PublicEventPage
        event={publicEvent}
        brand={publicBrand}
        viewerRole={viewerRole}
        callbacks={callbacks}
      />
    </BottomSheetScrollView>
  </BottomSheet>
);
```

#### 3.6.6 Styles

Add `sheetScroll` and `sheetScrollContent` to the StyleSheet:

```ts
const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: "#0c0e12",
  },
  sheetHandle: {
    backgroundColor: "rgba(255,255,255,0.32)",
    width: 36,
  },
  sheetScroll: {
    flex: 1,
  },
  sheetScrollContent: {
    paddingBottom: 32,
  },
});
```

(Drop the old `sheetContent` style — the View wrapper is replaced by `BottomSheetScrollView`.)

#### 3.6.7 Backdrop

Keep the existing `renderBackdrop` definition unchanged — it works identically for `BottomSheet` and `BottomSheetModal`.

### 3.7 Hook layer — N/A

No new hooks. No query key changes.

---

## 4. Success Criteria

| # | Criterion | Layer | Test |
|---|---|---|---|
| C1 | After tapping "Tonight" with city=Raleigh, the Discover grid renders Big Party | Component | T-01 live-fire |
| C2 | "All" chip continues to show Big Party + TM cards (no regression) | Component | T-02 live-fire |
| C3 | Jest unit test: `showEmpty === false` when `businessEvents=[big]` and `nightOutCards=[]` and not loading and no error | Component | T-03 Jest |
| C4 | Jest unit test: `showEmpty === true` when BOTH arrays are empty | Component | T-04 Jest |
| C5 | Tapping Big Party card animates the inline `<BottomSheet>` to the 90% snap within 800ms with the dark `<PublicEventPage>` visible | Component | T-05 live-fire screenshot |
| C6 | Metro log on Big Party tap: `[ExpandedBusinessEventSheet] visible= true …` then `[ExpandedBusinessEventSheet] onChange index= 1` (sheet settled at index 1) | Component | T-06 live-fire |
| C7 | Swipe-down dismisses the sheet — `onChange index= -1` fires → `expansionTarget` clears in DiscoverScreen → tapping a TM card next opens TM sheet cleanly | Component | T-07 live-fire |
| C8 | `BottomSheetModalProvider` is removed from `app/_layout.tsx` and `@gorhom/bottom-sheet` is NOT imported there | Architecture | T-08 grep / read |
| C9 | `[NightOutService] searchMerged:` log now includes `localStartEndDateTime`, `timezone`, and `segmentSlug` keys | Service | T-09 live-fire grep |
| C10 | `tsc --noEmit` PASS on app-mobile with no new `any` / `@ts-ignore` / `as unknown as X` (the `glass.bottomSheet.snapPoints` cast matches the existing TM path cast and is allowed by precedent) | Type | `npx tsc --noEmit` |
| L1 (latent) | "This Month" filter continues to render Big Party + TM cards | Full stack | T-10 |
| L2 (latent) | TM card tap continues to open the existing `ExpandedCardModal` TM sheet | Component | T-11 (already proven in retest screenshot 05) |

---

## 5. Invariants

### 5.1 Preserved

| Invariant | How preserved |
|---|---|
| Const #1 No dead taps | Business-event card tap now opens the sheet (S3 inline pattern) |
| Const #2 One owner per truth | `expansionTarget` discriminated union unchanged |
| Const #3 No silent failures | Diagnostic logs surface visible + onChange lifecycle |
| Const #9 No fabricated data | Empty state only renders when both arrays are truly empty (S1) |
| I-PROPOSED-DATE-FILTER-CONTRACT | Edge function untouched |
| I-PROPOSED-EXPANSION-TARGET-UNION | Discriminated union untouched |
| I-PROPOSED-LIVE-STATUS-UTC-INPUT | eventLifecycle untouched |

### 5.2 New invariants this spec establishes

| ID | Description | Enforcement |
|---|---|---|
| `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` | Discover empty-state guard MUST consider both `businessEvents` and `nightOutCards`. Gating on only one is a P0 bug. | Jest T-03 + T-04 |
| `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` | All in-app expanded sheets (TM, place, business, future) use the inline `<BottomSheet>` + declarative-index pattern with `BottomSheetScrollView` content. The portal-based `<BottomSheetModal>` + `BottomSheetModalProvider` pattern is forbidden. | (Deferred CI gate as a strict-grep; for this rework rely on code review + the live-fire test C5/C6) |

### 5.3 Invariants explicitly DROPPED

| Invariant from prior spec | Reason for drop |
|---|---|
| `I-PROPOSED-BOTTOMSHEETMODAL-DYNAMIC-SIZING-OFF` (added in earlier draft) | We're no longer using `BottomSheetModal`. The new invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` replaces it. |

---

## 6. Test Cases

| Test ID | Scenario | Input | Expected | Layer | Auto |
|---|---|---|---|---|---|
| T-01 | Tonight chip in Raleigh | Maestro tap "Tonight" on cold-loaded Discover (chip="All") | Grid renders, Big Party visible with "On Mingla" badge | Full stack | Manual (Maestro + screenshot) |
| T-02 | All chip baseline | Tap "All" chip | Big Party + ≥1 TM card visible | Full stack | Manual |
| T-03 | showEmpty false when businessEvents > 0 | Mount DiscoverScreen with mocked state `{businessEvents:[bigParty], nightOutCards:[], nightOutLoading:false, nightOutError:null}` | `<EmptyState icon="moon-outline">` NOT in render tree; grid renders Big Party | Component | Yes (Jest + RTL/shallow) |
| T-04 | showEmpty true when both empty | Both arrays empty | `<EmptyState>` IS in render tree | Component | Yes (Jest) |
| T-05 | Sheet opens at index 1 within 800ms | Maestro tap Big Party at (26%,32%) | Screenshot at 800ms shows sheet at ~90% screen height with `<PublicEventPage>` content visible (Big Party title, cover image, ticket section, etc.) | Component | Manual (Maestro + delayed screenshot) |
| T-06 | Diagnostic log sequence | Maestro tap Big Party | Metro log contains `[ExpandedBusinessEventSheet] visible= true eventId= …` followed by `[ExpandedBusinessEventSheet] onChange index= 1` within 800ms | Component | Manual (grep) |
| T-07 | Swipe-down dismiss | Swipe sheet from 50%,10% to 50%,95% | Sheet collapses; `onChange index= -1` fires; sheet gone from screen; next TM card tap opens TM sheet cleanly (no business-event flash) | Component | Manual |
| T-08 | Provider removed | `grep BottomSheetModal app/_layout.tsx` | exit 1 (no match) | Architecture | Yes (grep) |
| T-09 | searchMerged log shape | Cold load Discover | Metro log line `[NightOutService] searchMerged:` contains keys `localStartEndDateTime`, `timezone`, `segmentSlug` | Service | Manual (grep) |
| T-10 | This Month regression | Tap This Month filter | Big Party + multiple TM cards render | Full stack | Manual |
| T-11 | TM card opens existing sheet | Tap Linkin Park card | ExpandedCardModal TM sheet opens at index 1 of its snap points | Component | Manual |
| T-12 | tsc | `cd app-mobile && npx tsc --noEmit` | exit 0 or only pre-existing unrelated errors | Type | Yes |

---

## 7. Implementation Order

Implementor executes strictly:

1. **Step 1 — S6 service log expansion.** Edit `nightOutExperiencesService.ts` per §3.3.
2. **Step 2 — S4 provider removal.** Edit `app/_layout.tsx` per §3.4. Drop `BottomSheetModalProvider` import + wrapper.
3. **Step 3 — S3 business sheet rewrite.** Edit `ExpandedBusinessEventSheet.tsx` per §3.6. Six sub-steps in order: imports → constants → ref → onChange → JSX → styles. Verify against `ExpandedCardModal.tsx:1602-2066` as reference.
4. **Step 4 — S1 + S2 DiscoverScreen guards.** Edit `DiscoverScreen.tsx` per §3.5: fix `showEmpty` + audit siblings.
5. **Step 5 — Jest T-03 + T-04.** Add `app-mobile/src/components/__tests__/DiscoverScreen.empty-state.test.tsx`. Mock state, assert empty-state presence/absence.
6. **Step 6 — Local gates.** `tsc --noEmit` on app-mobile + mingla-business (no new errors). `npx jest DiscoverScreen.empty-state` PASS.
7. **Step 7 — Write implementation report.** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0828_REWORK_SHEET_AND_FILTER_RENDER.md` with old→new receipts for all 4 changed files (service, layout, business sheet, discover screen) + new test file + explicit C1–C10 + L1/L2 PASS/FAIL.

No edge function deploy. No `supabase db push`. No EAS Build. TypeScript-only — hot-reload-friendly.

---

## 8. Regression Prevention

| Bug class | Prevention | Status after rework |
|---|---|---|
| Empty-state guard ignoring sibling arrays | Jest T-03 + T-04 + new invariant `I-PROPOSED-DISCOVER-EMPTY-STATE-BOTH-ARRAYS` | New |
| Inline-vs-modal sheet pattern confusion | Business sheet now matches TM exactly; invariant `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` codified | New |
| Diagnostic noise in production | `[ExpandedBusinessEventSheet]` logs are intentional — kept until 2 TEST PASSes confirm fix, then removed via cleanup ORCH | Documented |

---

## 9. Discoveries for Orchestrator (Sibling ORCH register — AFTER this rework lands)

1. `nightOutCache` persists only TM cards (Hidden Flaw H1)
2. DiscoverScreen render-count cascade (Hidden Flaw H2)
3. iOS GPS error UX banner (P3)
4. Missing `filter-outline` icon + CoachMark orphan (P3 batch)
5. CI gate for `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` (strict-grep `<BottomSheetModal` forbidden, `<BottomSheet` allowed) — P3 hygiene

---

## 10. Open Questions Resolved

| Q | Resolution |
|---|---|
| Should the sheet use inline `<BottomSheet>` or portal `<BottomSheetModal>`? | **Inline.** Operator-confirmed UX preference + proven working pattern in TM path. Portal pattern is forbidden by new invariant. |
| Should diagnostic logs stay in production? | KEEP through 2 TEST PASS cycles. Register cleanup ORCH afterward. |
| Should snap points be 1 or multiple? | **Multiple — `['50%', '90%']`** matching TM. Opens at index 1 (90% full). Gives natural preview gesture. |
| Should `present()` and `BottomSheetModalProvider` be revived if the inline pattern fails? | NO. If inline fails, the issue is somewhere else (state, parent layout, animation) and a new investigation is warranted — DO NOT default to the portal pattern. |

---

End of spec.
