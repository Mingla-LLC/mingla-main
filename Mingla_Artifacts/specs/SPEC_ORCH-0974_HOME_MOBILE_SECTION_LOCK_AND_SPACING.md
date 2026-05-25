# SPEC — ORCH-0974 [Home (mingla-business mobile) section lock + spacing]

**Skill:** Claude `mingla-forensics` (SPEC mode)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/`
**Branch:** `ORCH-0974-home-mobile-section-lock-and-spacing`
**Date:** 2026-05-25
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md` (this worktree)
**Status:** READY FOR ORCHESTRATOR REVIEW → DISPATCH TO IMPLEMENTOR

---

## §1 Scope, non-goals, assumptions

### 1.1 In scope
- `mingla-business/app/(tabs)/home.tsx` mobile path (`!isWideDesktop` branch).
- One new component file: `mingla-business/src/components/home/UpcomingListItem.tsx` (extracted from current inline JSX to keep the FlatList `renderItem` clean).
- One new strict-grep CI gate at `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` + workflow job in `.github/workflows/strict-grep-mingla-business.yml`.
- One new test file each for implementor happy-path + tester adversarial (paths in §8).

### 1.2 Non-goals (explicit)
- Desktop wide path (`isWideDesktop`) — already implements the lock pattern. No edit.
- Top bar (`barWrap` + `<TopBar>` contents) — ORCH-0973 lane. Untouched.
- Spacing tokens at `mingla-business/src/constants/designSystem.ts` — existing tokens (`xxs=2, xs=4, sm=8, md=16, lg=24, xl=32, xxl=48`) are sufficient. No new tokens.
- Empty-state branch (`!currentBrand`, lines 405-446) — preserved verbatim, no lock applied.
- Toast overlay, BrandSwitcherSheet, UniversalCreatorSheet, BrandDeleteSheet — untouched (sibling overlays of the dashboard body).
- `RefreshControl` semantics — preserved; only the prop placement moves to the FlatList.
- ORCH-0965 tri-kind upcoming behaviour, ORCH-0965 ladder-rung card (`<HomeNextActionCard>`) — preserved with one explicit placement decision (§6.B carve-out).
- Buyer-web routes, consumer-app, admin-web — different surfaces.
- Backend, migrations, edge functions, RPCs, external APIs — none touched. **`feedback_external_api_docs_verified.md` / COMMS-0003 are N/A for this ORCH.**

### 1.3 Assumptions
- React Native's `FlatList` supports `contentContainerStyle.gap` (RN 0.71+). The Expo SDK 54 mingla-business is on (per `mingla-business/package.json`) ships with RN ≥ 0.74 which satisfies this. Implementor must verify by reading `mingla-business/package.json` line `"react-native": "..."` before relying on `gap` on `contentContainerStyle`. If absent for any reason, fall back to `ItemSeparatorComponent` returning a 8px-tall `<View>`.
- `useResponsiveLayout().isWideDesktop` continues to evaluate `dimensions.width >= 768` (the established breakpoint; not modified by this ORCH).

---

## §2 Cross-Surface Impact (MANDATORY per orchestrator SPEC contract)

| Surface | Covered? | Behaviour change |
|---------|----------|------------------|
| **Consumer iOS** (`app-mobile/` on iOS) | ❌ NOT covered | Different app; doesn't render mingla-business Home. |
| **Consumer Android** (`app-mobile/` on Android) | ❌ NOT covered | Same reason. |
| **Buyer/anonymous Web** (`mingla-business/` `/checkout`, `/e`, `/b`) | ❌ NOT covered | Different routes; buyers don't see the Home tab. |
| **Business iOS** (`mingla-business/` on iOS) | ✅ COVERED | KPI hero + KPI grid card + section header LOCKED at top; upcoming list scrolls underneath; section header gains visible breathing room above first card; KPI inter-tile spacing rebalanced. Empty-state branch unchanged. |
| **Business Android** (`mingla-business/` on Android) | ✅ COVERED | Identical behaviour (shared RN source, no platform-specific branches in `home.tsx`). Parity is automatic, not manual — single SC suffices per surface in §7. |
| **Admin Web** (`mingla-admin/`) | ❌ NOT covered | No equivalent screen. |
| **Business Web preview** (`mingla-business/` dev/web build at narrow viewport <768px) | ⚠ AUTOMATIC | Mobile path also drives narrow-viewport web preview. Lock pattern applies via RN-web flex (first-class CSS). `RefreshControl` is a no-op on web (pre-existing behaviour; not regressed by this ORCH). No separate code path; tester eyeballs once at TEST phase per A-06. |

**Parity declaration:** business-iOS + business-Android share one code path (no `Platform.OS === ...` branching introduced). Single success-criterion column per SC item in §7. Tester runs both simulators per `feedback_tester_canonical_and_platform_parity.md`.

---

## §3 Architectural contract

### 3.1 Chosen primitive

**Option 1 from INVESTIGATE §3.3 — outer `<View flex:1>` shell with two children.**

Mirrors the existing `desktopUpcomingPane` flex pattern (`flex: 1, minHeight: 0, overflow: hidden`) used on the desktop branch but applies it to the mobile branch via a NEW wrapper element. The desktop branch is unchanged.

### 3.2 Layout sketch (mobile path, populated brand)

```
<View style={[styles.host, { paddingTop: insets.top }]}>        ← existing, flex:1
  <View style={styles.barWrap}>                                  ← UNCHANGED
    <TopBar ... />
  </View>

  {isWideDesktop ? (
    /* EXISTING desktop branch — UNCHANGED */
    <ScrollView style={styles.desktopOuterScroll} ...>
      ...existing desktop JSX...
    </ScrollView>
  ) : currentBrand === null ? (
    /* EXISTING mobile empty branch — UNCHANGED, wrapped in a single ScrollView
       so the greeting card can still scroll on small phones if needed */
    <ScrollView contentContainerStyle={styles.emptyScroll}
                refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}>
      <View style={styles.emptyCol}>
        ...existing GlassCard...
      </View>
    </ScrollView>
  ) : (
    /* NEW mobile populated branch — locked dashboard + scrolling list */
    <View style={styles.mobileBody}>                              ← NEW: flex:1, paddingHorizontal:spacing.md
      {/* LOCKED ZONE */}
      <View style={styles.lockedZone}>                            ← NEW: flexShrink:0
        {nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4) &&
         !isSmallPhoneWithLiveHero ? (                            ← NEW: A-03 §6.B carve-out
          <HomeNextActionCard action={nextAction} onPress={handleNextActionPress} />
        ) : null}

        <View style={styles.mobileKpiStack}>                      ← NEW: gap:spacing.sm
          {primaryLiveEvent !== null ? (
            <GlassCard variant="elevated" padding={spacing.lg}>...live hero JSX...</GlassCard>
          ) : (
            <KpiTile label="Last 7 days" value={...} />
          )}
          <KpiTile label="Active events" value={...} sub={...} />
        </View>

        <View style={styles.mobileSectionHeaderRow}>               ← NEW: paddingHorizontal:0, paddingTop:spacing.lg, paddingBottom:spacing.sm
          <Text style={styles.sectionTitle}>Upcoming</Text>
          <Pressable onPress={handleSeeAllEvents} ...>
            <Text style={styles.sectionLink}>See all</Text>
          </Pressable>
        </View>
      </View>

      {/* SCROLLING ZONE */}
      <FlatList                                                    ← NEW: flex:1, minHeight:0
        style={styles.mobileUpcomingList}
        data={upcoming.items}
        keyExtractor={(item) => item.key}
        renderItem={({ item }) => (
          <UpcomingListItem
            item={item}
            currentBrandCurrency={currentBrand.defaultCurrency}
            eventSalesSummaries={eventSalesSummaries}
            onOpenDraft={handleOpenDraft}
            onOpenTrip={handleOpenTrip}
            onOpenLiveEvent={handleOpenLiveEvent}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.mobileUpcomingSep} />}  ← height:spacing.sm
        ListEmptyComponent={
          <GlassCard variant="base" padding={spacing.lg}>...existing empty-list JSX...</GlassCard>
        }
        contentContainerStyle={styles.mobileUpcomingContent}        ← NEW: paddingBottom:spacing.xl*4
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        showsVerticalScrollIndicator={false}
      />

      {nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4) &&
       isSmallPhoneWithLiveHero ? (                                ← NEW: A-03 §6.B carve-out — render BELOW list as a footer if locked-zone too tall
        <View style={styles.smallPhoneLadderHost}>
          <HomeNextActionCard action={nextAction} onPress={handleNextActionPress} />
        </View>
      ) : null}
    </View>
  )}

  {/* SIBLING OVERLAYS — UNCHANGED */}
  <BrandSwitcherSheet ... />
  <UniversalCreatorSheet ... />
  <BrandDeleteSheet ... />
  <View style={styles.toastWrap}><Toast ... /></View>
</View>
```

### 3.3 Flex math

The outer `styles.host` is `flex: 1`. Inside it:
- `styles.barWrap` (intrinsic height, ~52px)
- `styles.mobileBody` is `flex: 1` — consumes remaining vertical space (`viewport - safeAreaTop - barWrapHeight - safeAreaBottom - tabBarHeight`).
- Inside `mobileBody`:
  - `styles.lockedZone` (intrinsic height, sums to the heights of its children + their margins/gaps) — `flexShrink: 0` to prevent compression on small phones (compression would push the locked zone smaller than its content height and clip)
  - `<FlatList style={{flex: 1, minHeight: 0}}>` — consumes remaining vertical space inside `mobileBody` after `lockedZone`'s intrinsic height is subtracted. `minHeight: 0` is critical on RN-web (without it, flex children default `minHeight: auto` which prevents shrinking below content).

### 3.4 A-03 §6.B small-phone carve-out condition

`isSmallPhoneWithLiveHero = primaryLiveEvent !== null && dimensions.height <= 700` — captures iPhone SE 3rd gen (667px) + similar small Android devices. When true, the `<HomeNextActionCard>` renders BELOW the FlatList (as a foot region inside `mobileBody`) instead of inside the locked zone, leaving room for the live-hero card and at least 2 list cards to be visible above the fold.

Read `dimensions.height` from `useWindowDimensions()` (already-imported pattern in mingla-business; if not currently imported in `home.tsx`, add `import { useWindowDimensions } from "react-native";` and call once at the top of `HomeTab`).

---

## §4 Component / file edit list

| # | File | Action | Lines / scope |
|---|------|--------|---------------|
| 1 | `mingla-business/app/(tabs)/home.tsx` | EDIT | Replace lines 393-722 (outer ScrollView + entire populated-path body) with the structure in §3.2. Preserve lines 376-391 (host + barWrap), 724-754 (sibling overlays + toast). Add `useWindowDimensions` import. Add new styles (§5) and DELETE no-longer-used styles (`styles.scroll`, mobile-only references in `styles.desktopOuterScroll` stay because used in desktop branch). |
| 2 | `mingla-business/src/components/home/UpcomingListItem.tsx` | CREATE | Extract the per-item renderer (draft + trip + event/experience variants) from current `home.tsx:584-715` into a memoised functional component. Props interface in §4.1 below. |
| 3 | `mingla-business/app/(tabs)/home.tsx` | EDIT (already in #1) | Replace inline `upcoming.items.map(...)` with FlatList using new `UpcomingListItem`. |
| 4 | `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` | CREATE | New CI gate. Detail in §10. |
| 5 | `.github/workflows/strict-grep-mingla-business.yml` | EDIT | Add one new job wrapping `orch-0974-home-mobile-lock-pane.mjs` (registry pattern per `feedback_strict_grep_registry_pattern.md`). |
| 6 | `mingla-business/app/(tabs)/__tests__/home.orch_0974.test.tsx` | CREATE | Implementor happy-path test (§8). |
| 7 | `mingla-business/app/(tabs)/__tests__/home.orch_0974.adversarial.test.tsx` | CREATE | Tester adversarial test (§8) — written AFTER implementor; reserved here for path declaration. |

### 4.1 `<UpcomingListItem>` props

```ts
import type { UpcomingItem } from "../../hooks/useUpcomingForBrand";
import type { EventSalesSummary } from "../../hooks/useEventOrders";
import type { DraftEvent } from "../../store/draftEventStore";
import type { LiveEvent } from "../../store/liveEventStore";
import type { Trip } from "../../services/tripsService";

export interface UpcomingListItemProps {
  item: UpcomingItem;
  currentBrandCurrency: string | undefined;
  eventSalesSummaries: Record<string, EventSalesSummary | undefined>;
  onOpenDraft: (draft: DraftEvent) => void;
  onOpenTrip: (trip: Trip) => void;
  onOpenLiveEvent: (event: LiveEvent) => void;
}
```

The component is `React.memo`-wrapped to avoid re-renders on parent scroll (FlatList recycles cells — `renderItem` is invoked many times; without memo, every scroll tick re-renders all visible rows). Implementor: use `React.memo(UpcomingListItem, (prev, next) => prev.item.key === next.item.key && prev.eventSalesSummaries[prev.item.id ?? ""] === next.eventSalesSummaries[next.item.id ?? ""])` or equivalent shallow check.

---

## §5 Spacing contract (concrete token values)

| Boundary | Token | Pixels | Rationale |
|----------|-------|--------|-----------|
| TopBar bottom (`barWrap.paddingBottom`) | `spacing.sm` | 8 | UNCHANGED from current |
| `barWrap` → `mobileBody` (first child of locked zone) | `mobileBody.paddingTop: spacing.md` | 16 | Down from current `spacing.lg` (24) — the barWrap's own bottom-padding already provides 8px; total 24px stays the same but cleaner allocation |
| Inside `lockedZone`: `<HomeNextActionCard>` bottom margin (when present) | `spacing.md` | 16 | Existing `HomeNextActionCard.styles.wrap.marginBottom = spacing.md` — UNCHANGED |
| Inside `mobileKpiStack`: KPI hero ↔ Active Events tile gap | `mobileKpiStack.gap: spacing.sm` | **8** | Down from current 16 (F-3 fix). Cards read as distinct tiles, not a stacked panel. |
| `mobileKpiStack` → `mobileSectionHeaderRow` (top padding) | `mobileSectionHeaderRow.paddingTop: spacing.lg` | **24** | Up from current 8+16-derived (F-4 fix). This is a ZONE BOUNDARY — locked-chrome ends, list-zone begins. The visual weight signals "new section". |
| `mobileSectionHeaderRow` bottom padding (section header → first card) | `mobileSectionHeaderRow.paddingBottom: spacing.md` | **16** | Up from current 0 (F-2 / operator-explicit fix). Visibly larger than the 8px inter-card gap. This is the "Upcoming text needs breathing room from list" requirement. |
| Inter-card gap inside FlatList | `mobileUpcomingSep` height = `spacing.sm` | 8 | UNCHANGED from current `eventsCol.gap: spacing.sm`. Preserves established list-item rhythm. |
| Last card → bottom of viewport (tab bar dead space) | `mobileUpcomingContent.paddingBottom: spacing.xl * 4` | 128 | UNCHANGED from current. Operator-confirmed: dead space, no bounce footer. |
| `mobileSectionHeaderRow.paddingHorizontal` | `0` | 0 | Down from current `spacing.xs` (4). The parent `mobileBody.paddingHorizontal: spacing.md` (16) already provides side padding; no nested horizontal padding needed. |
| `mobileBody.paddingHorizontal` | `spacing.md` | 16 | Inherits the screen-edge inset from current `styles.scroll.paddingHorizontal: spacing.md`. |

### 5.1 Vertical-rhythm summary (mobile populated path, no ladder rung)

```
[TopBar — height ~52]
[8px paddingBottom from barWrap]
[16px mobileBody.paddingTop]
[KPI hero card / live hero — height ~80 or ~180]
[8px gap]
[Active Events tile — height ~80]
[24px paddingTop on sectionHeaderRow]   ← ZONE BOUNDARY
[Upcoming / See all — height ~30]
[16px paddingBottom on sectionHeaderRow]   ← OPERATOR-EXPLICIT BREATHING ROOM
[First card — height ~80]
[8px ItemSeparator]
[Second card — height ~80]
…
[FlatList scrolls; 128px paddingBottom at end]
```

Rhythm reads as: chrome (tight, 8px), boundary (24px), header (16px), list (8px). Deliberate, hierarchical, polished.

---

## §6 State branch matrix

### 6.A Empty / cold-cache (`!currentBrand`)

- Lock NOT applied.
- Render existing `<View style={styles.emptyCol}>` inside a single ScrollView with the same `RefreshControl` wiring (so the user can pull-to-refresh from the empty state to re-fetch brands).
- DO NOT touch the empty-state JSX (lines 405-446 in current source). Implementor moves the JSX block under the new structural conditional verbatim.

### 6.B Populated, no live event (`primaryLiveEvent === null`)

- Locked zone contains: optional `<HomeNextActionCard>` (default placement — locked) + `<KpiTile label="Last 7 days">` + `<KpiTile label="Active events">` + section header.
- Scrolling zone: FlatList with all upcoming items + `ListEmptyComponent` when `upcoming.items.length === 0`.
- Small-phone carve-out: NOT triggered (no live hero → locked zone fits comfortably on iPhone SE).

### 6.C Populated, with live event (`primaryLiveEvent !== null`)

- Locked zone contains: optional `<HomeNextActionCard>` (rendered ONLY when `nextAction.rung === 4` AND viewport is NOT small-phone; otherwise hidden because `upcoming.counts.live > 0` already eats the ladder gate) + live hero `<GlassCard>` (taller, ~180px) + `<KpiTile label="Active events">` + section header.
- Scrolling zone: FlatList with all upcoming items.
- Small-phone carve-out: When `dimensions.height <= 700` AND `nextAction.rung === 4`, the `<HomeNextActionCard>` renders as a foot region BELOW the FlatList (inside `mobileBody`, after the FlatList) — see §3.2 + §3.4.

### 6.D Populated + ladder rung fires (`nextAction !== null`)

- Default: `<HomeNextActionCard>` IS in the locked zone (rendered ABOVE the KPI stack).
- Carve-out: per 6.C, on small phones with live hero present, it moves to the foot region.
- The card NEVER renders both above-list AND below-list simultaneously; the §3.2 JSX has two mutually-exclusive conditionals on `isSmallPhoneWithLiveHero`.

---

## §7 Success criteria

| SC# | Statement | Verification |
|-----|-----------|--------------|
| SC-1 | On the mingla-business mobile Home tab with a selected brand and ≥1 upcoming item, the KPI hero card, the Active Events tile, and the "Upcoming / See all" section header are visible at the top of the screen AND do not translate vertically when the user flicks the upcoming list upward or downward. | Tester swipe-up + swipe-down via Maestro on iPhone 17 Pro Max + Pixel emu; capture before/after screenshots; assert pixel position of the "Upcoming" text and the bottom of the Active Events tile is unchanged between baseline and post-swipe. |
| SC-2 | On the mingla-business mobile Home tab, the gap between the "Upcoming" section header baseline and the top of the first upcoming list card is ≥ 16px (2× the inter-card gap). | Tester visual inspection + measurement against captured screenshot; OR implementor unit test asserting `styles.mobileSectionHeaderRow.paddingBottom === spacing.md`. |
| SC-3 | On the mingla-business mobile Home tab, the gap between the KPI hero card and the Active Events tile is exactly 8px (down from current 16px). | Unit test asserting `styles.mobileKpiStack.gap === spacing.sm`. |
| SC-4 | On the mingla-business mobile Home tab, the gap between the bottom of the Active Events tile and the top of the "Upcoming" section header is ≥ 24px (zone boundary). | Unit test asserting `styles.mobileSectionHeaderRow.paddingTop === spacing.lg`. |
| SC-5 | Pull-to-refresh continues to fire `handleRefresh` (which invalidates `brandKeys.all`, `eventOrdersKeys.all`, `upcomingKeys.all`) when triggered from the upcoming list. | Tester adversarial test: mock `useQueryClient.invalidateQueries`; render Home in populated state; simulate `RefreshControl.onRefresh`; assert all three keys invalidated. |
| SC-6 | The mobile empty-state branch (`!currentBrand`) renders unchanged: `<View style={styles.emptyCol}>` with `<GlassCard variant="elevated">` containing the greeting + appropriate empty / loading / chooser body. No lock applied. | Tester snapshot test asserting the empty-state branch JSX subtree is structurally identical pre/post change (or a focused render test asserting `getByText("No brands yet")` / `getByText("Choose a brand")` / `getByText("Loading brands")` reach the screen). |
| SC-7 | The mobile populated path renders all three upcoming-item variants (draft, trip, event/experience) via the new `<UpcomingListItem>` with identical visual output to the current implementation. | Implementor unit test: render Home with mocked `useUpcomingForBrand` returning one of each `item.kind`; assert each card variant renders its expected pill ("Draft" / "Upcoming" / "Live") and its expected sold/revenue or step display. |
| SC-8 | On iPhone SE 3rd gen viewport (375×667) with a live hero AND `nextAction.rung === 4`, the `<HomeNextActionCard>` renders BELOW the FlatList (foot region), not inside the locked zone. On larger viewports it renders inside the locked zone above the KPI stack. | Implementor unit test: mock `useWindowDimensions` returning `{height: 667}` + mock `useUpcomingForBrand` returning a live primary item + mock `pickHomeNextAction` returning a rung-4 action; assert the `<HomeNextActionCard>` is rendered AFTER the FlatList in the tree. Repeat with `{height: 844}` and assert it's rendered BEFORE the FlatList. |
| SC-9 | The desktop wide path (`isWideDesktop === true`) renders unchanged. | Implementor unit test: mock `useResponsiveLayout` returning `{isWideDesktop: true}`; assert presence of the `desktopUpcomingPane`-wrapped layout (or assert the new mobile primitives `<View style={styles.mobileBody}>` are NOT in the rendered tree). |
| SC-10 | Exactly one scrollable surface exists on the mobile populated path. | Strict-grep gate `orch-0974-home-mobile-lock-pane.mjs` (§10): asserts that `mingla-business/app/(tabs)/home.tsx` contains at most one `<ScrollView` and at most one `<FlatList` token in the populated mobile JSX subtree. The empty-state branch's ScrollView is permitted (different conditional branch). |
| SC-11 | The ORCH-0965 `HomeNextActionCard` rendering condition (`nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4)`) is preserved bit-for-bit; SPEC §6.D only adds the `isSmallPhoneWithLiveHero` placement decision, never changes the rendering condition. | Tester adversarial test: snapshot the condition logic via a unit that exercises rung-1, rung-2, rung-3, rung-4 × (live-hero, no-live-hero) × (small-phone, large-phone). |
| SC-12 | No new external dependencies introduced. No backend / migration / edge-function / RPC / external-API touched. | Implementor diff inspection; `git diff` shows no changes under `supabase/`, `packages/`, `app-mobile/`, `mingla-admin/`. |

---

## §8 Regression-test plan (Step 0.5 — MANDATORY)

### 8.A Implementor happy-path test

**Path:** `mingla-business/app/(tabs)/__tests__/home.orch_0974.test.tsx`

**Coverage (single test file, ≥ 5 `it()` blocks):**
- T-01: Render Home with `useResponsiveLayout` returning `{isWideDesktop: false}` + mocked populated brand + 5 mocked upcoming items + `useWindowDimensions` returning `{height: 844}`. Assert: locked zone primitives are present (`styles.mobileBody`, `styles.lockedZone`, `styles.mobileKpiStack`). FlatList is present. ScrollView count in tree ≤ 1 (the empty-state branch's ScrollView is in the other conditional, not rendered).
- T-02: Same mock as T-01 but assert `styles.mobileSectionHeaderRow.paddingBottom === spacing.md` (= 16) and `styles.mobileSectionHeaderRow.paddingTop === spacing.lg` (= 24). The visible "Upcoming" Text and the first `<EventCoverMedia>` are both present.
- T-03: Same mock as T-01 but assert `styles.mobileKpiStack.gap === spacing.sm` (= 8).
- T-04: Render Home with `!currentBrand`. Assert empty-state branch unchanged: `<View style={styles.emptyCol}>` present + appropriate empty/loading/chooser copy + `RefreshControl` present.
- T-05: Render Home populated + mock `pickHomeNextAction` returning a rung-4 action + `useWindowDimensions` returning `{height: 844}`. Assert `<HomeNextActionCard>` renders inside the locked zone (i.e. its tree position is before the FlatList).
- T-06: Same as T-05 but `useWindowDimensions` returning `{height: 667}` AND mock `useUpcomingForBrand` returning a live primary item. Assert `<HomeNextActionCard>` renders AFTER the FlatList (small-phone carve-out).

**Fails-on-revert verification (mandatory per ORCH-0840):** Implementor commits T-01..T-06 in the IMPLEMENTATION commit. Then in a follow-up "verification" commit (same PR), implementor temporarily reverts the F-1 / F-2 / F-3 fixes (`git revert` of the structural change OR locally restoring the old outer ScrollView wrapper), runs `npm test home.orch_0974`, captures the FAILING test output, then restores the fix in a fix commit. The verification commit references the failing-test capture hash in the implementation report's "fails-on-revert verified at <commit>" line. Implementor must verify failures for AT LEAST T-01 (structural — fails when outer ScrollView returns) + T-02 (paddingBottom — fails when spacing reverts) + T-05 (carve-out — fails when small-phone branch removed). T-03/T-04/T-06 verification is optional but recommended.

### 8.B Tester adversarial test

**Path:** `mingla-business/app/(tabs)/__tests__/home.orch_0974.adversarial.test.tsx`

**Coverage (single test file, ≥ 4 `it()` blocks; attack a DIFFERENT angle than 8.A):**
- A-01: Pull-to-refresh assertion — render Home populated, find the FlatList, fire its `onRefresh` callback, assert `queryClient.invalidateQueries` was called with each of `brandKeys.all`, `eventOrdersKeys.all`, `upcomingKeys.all`. Specifically guards F-5 hidden flaw — implementor must not break refresh by forgetting to move RefreshControl onto the FlatList.
- A-02: Render Home with `upcoming.items` of length 0 in populated state. Assert `<ListEmptyComponent>` renders the "No upcoming events" GlassCard with the "+" emphasis copy. Specifically guards regression where ListEmptyComponent placement is wrong (e.g. inside ListHeaderComponent or wrapped in an unmounted conditional).
- A-03: Cross-state guard — render Home with `!currentBrand` (empty path) AND `nextAction` mocked to a rung-4 action. Assert `<HomeNextActionCard>` is NOT rendered (because the empty path doesn't include it; the locked-zone code only runs in the populated branch). Specifically guards regression where the implementor accidentally hoists the ladder-card render out of the populated conditional.
- A-04: ORCH-0965 condition-preservation — exhaustively assert `<HomeNextActionCard>` rendering for the matrix: (rung=1,2,3,4) × (live=0, live=1) × (smallPhone=false, smallPhone=true). Sixteen cases. Specifically guards SC-11 — bit-for-bit preservation of the rule-ladder gate.
- A-05: Snapshot of the populated-path tree at `useResponsiveLayout = {isWideDesktop: false}` with 3 upcoming items (1 draft, 1 trip, 1 event). Specifically guards regression in `<UpcomingListItem>` extraction — if the extracted component diverges from the inline JSX, the snapshot diff catches it.

**Fails-on-revert verification:** Tester commits A-01..A-05 in the TEST commit. Tester runs the tests, then temporarily reverts the implementor's F-5 RefreshControl migration (revert prop placement from FlatList back to ScrollView), runs the suite, captures the FAILING A-01 output, restores the fix, and references the failing-test commit hash in the QA report's "fails-on-revert verified at <commit>" line. Minimum: A-01 verified-on-revert (the unique tester angle); A-02..A-05 verification optional but recommended.

### 8.C Test discipline

Both files are immutable post-merge per `.github/workflows/tests-append-only.yml`. Future modifications require `[TEST-MOD-APPROVED ORCH-NNNN]` in commit body. Deletions are forbidden.

---

## §9 Invariants

### 9.1 New DRAFT invariant introduced by this SPEC

**`I-PROPOSED-HOME-MOBILE-LOCK-PANE` (DRAFT → ACTIVE on ORCH-0974 CLOSE).**

> **Rule:** On the mingla-business mobile Home tab (`!isWideDesktop` branch of `mingla-business/app/(tabs)/home.tsx`), the KPI hero card (`<KpiTile label="Last 7 days">` or live-hero `<GlassCard>`), the Active Events `<KpiTile>`, and the "Upcoming / See all" `sectionHeaderRow` MUST NOT participate in the scrollable surface. Exactly one scrollable surface (the upcoming `<FlatList>`) exists on the populated mobile Home path. The empty-state branch (`!currentBrand`) is exempt and retains its single-`ScrollView` layout.

**Why it matters:** Locking the dashboard chrome at the top of the visible area preserves at-a-glance KPI visibility regardless of how many upcoming items a brand accumulates. Reverting to a single outer-ScrollView would re-introduce the operator-reported defect.

**Enforcement:** Strict-grep CI gate (§10) + Step 0.5 happy-path test T-01 + Step 0.5 adversarial test A-05 (snapshot).

### 9.2 Existing invariants this SPEC preserves

- `I-HOME-NEXT-ACTION-CANONICAL` (ORCH-0965): `<HomeNextActionCard>` derivation source preserved (no kind-specific CTAs introduced).
- `I-AUTH-USER-ID-OPTIONAL` (general): no auth changes.
- Memory rules: `feedback_mingla_business_desktop_web_contracts.md` (desktop branch untouched), `feedback_rn_color_formats.md` (no inline color tokens), `feedback_keyboard_never_blocks_input.md` (no inputs on Home — N/A but cited for completeness), `feedback_toast_needs_absolute_wrap.md` (Toast wrap untouched).

---

## §10 Strict-grep CI gate

**File:** `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs`

**Rules to enforce (all P1 fail-the-build on hit):**

| Check ID | Rule | Detection |
|----------|------|-----------|
| C1: single-scrollable-surface-mobile-populated | In `mingla-business/app/(tabs)/home.tsx`, between the comment marker `// orch-0974-lock-pane:begin-mobile-populated` and `// orch-0974-lock-pane:end-mobile-populated`, count occurrences of `<ScrollView` and `<FlatList`. C1 PASS if `<ScrollView` count = 0 AND `<FlatList` count = 1. C1 FAIL otherwise. |
| C2: locked-zone-style-present | `mingla-business/app/(tabs)/home.tsx` MUST contain the literal style key `mobileBody:` AND `lockedZone:` AND `mobileKpiStack:` AND `mobileSectionHeaderRow:` in the styles block. |
| C3: spacing-contract-explicit | Within `styles.mobileSectionHeaderRow` block, MUST contain `paddingBottom: spacing.md` AND `paddingTop: spacing.lg`. Within `styles.mobileKpiStack` block, MUST contain `gap: spacing.sm`. |
| C4: refresh-control-on-list | `mingla-business/app/(tabs)/home.tsx` mobile populated branch: the `<FlatList` opening element MUST contain a `refreshControl=` prop within the next 30 lines of its declaration. |
| C5: upcoming-list-item-extracted | `mingla-business/src/components/home/UpcomingListItem.tsx` MUST exist AND be imported by `mingla-business/app/(tabs)/home.tsx`. |

**Implementor:** add comment markers `// orch-0974-lock-pane:begin-mobile-populated` and `// orch-0974-lock-pane:end-mobile-populated` around the new mobile populated branch JSX to scope C1's detection.

**Workflow wiring:** add one new job in `.github/workflows/strict-grep-mingla-business.yml` (do NOT create a parallel workflow file — registry pattern per `feedback_strict_grep_registry_pattern.md`) named `ORCH-0974: Home mobile lock pane` invoking `node .github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs`.

---

## §11 Implementation order

1. **Read `mingla-business/package.json`** — confirm RN version supports `gap` on `contentContainerStyle` (RN ≥ 0.71). If not, plan to use `ItemSeparatorComponent` instead (already the chosen pattern in §3.2; this is just a sanity check).
2. **Pre-flight `/ui-ux-pro-max`** — invoke the skill with the spacing contract from §5 + the layout sketch from §3.2 as inputs. Confirm the rhythm reads polished on the chosen tokens; do NOT widen scope.
3. **Create `mingla-business/src/components/home/UpcomingListItem.tsx`** — extract per-item rendering from current `home.tsx:584-715` verbatim. Apply `React.memo` shallow-eq.
4. **Edit `mingla-business/app/(tabs)/home.tsx`** — replace lines 393-722 with the structure in §3.2. Add `useWindowDimensions` import. Add new styles + delete `styles.scroll` (no longer used). Add `// orch-0974-lock-pane:begin-mobile-populated` and `// orch-0974-lock-pane:end-mobile-populated` markers around the new mobile populated branch JSX.
5. **Verify on iOS sim** — `cd mingla-business && npx expo start --port 8092` → boot iPhone 17 Pro Max sim → relaunch app → eyeball populated state with mocked extra cards (if possible) → confirm lock + spacing. Also boot iPhone SE 3rd gen sim, repeat, confirm small-phone carve-out fires correctly with a mocked live event.
6. **Verify on Android emu** — same loop on Pixel 6 emulator.
7. **Write tests** — implement T-01..T-06 in `home.orch_0974.test.tsx`. Run. Confirm pass. Verify fails-on-revert per §8.A.
8. **Create strict-grep gate** — write `orch-0974-home-mobile-lock-pane.mjs` per §10. Add workflow job. Run locally: `node .github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` → PASS.
9. **Run full local test suite** — `cd mingla-business && npm test` → all green (no regression elsewhere).
10. **Commit** — single commit on `ORCH-0974-home-mobile-section-lock-and-spacing` branch with message body following established patterns; include path to implementation report + tests + fails-on-revert hashes.

---

## §12 Hard constraints (implementor MUST honour)

- NO touch to: `app-mobile/`, `mingla-admin/`, `mingla-marketing/`, `supabase/`, `packages/`, any other route under `mingla-business/app/`, any other file under `mingla-business/src/` EXCEPT the one new `UpcomingListItem.tsx`.
- NO new dependencies (no new `npm install` of any package).
- NO migration, NO edge function, NO API change, NO RPC, NO external-API touch.
- NO new spacing tokens in `mingla-business/src/constants/designSystem.ts`.
- NO touch to the desktop branch (`isWideDesktop` block in `home.tsx`).
- NO touch to the top bar (`barWrap` JSX or `<TopBar>` props).
- NO touch to the empty-state JSX (lines 405-446 in current source) beyond moving it under a new structural conditional verbatim — same children, same props, same styles.
- NO touch to sibling overlays (`BrandSwitcherSheet`, `UniversalCreatorSheet`, `BrandDeleteSheet`, `Toast`).
- NO regression of ORCH-0965 ladder-rung condition (`nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4)`) — this exact expression must remain in the source.
- NO regression of ORCH-0965 tri-kind rendering (draft / trip / event/experience variants).
- NO `Platform.OS === ...` branches introduced (iOS/Android parity is shared-source).
- NO inline color values violating `feedback_rn_color_formats.md` (use existing accent/text/glass tokens).
- NO oklch/lab/lch/color-mix anywhere (same rule).
- PRESERVE `RefreshControl` semantics — `handleRefresh` invalidates exactly `brandKeys.all`, `eventOrdersKeys.all`, `upcomingKeys.all`.
- PRESERVE pull-to-refresh availability on the populated path (now via FlatList) AND on the empty path (now via the wrapping ScrollView).
- PRESERVE every existing `testID` on the home screen (`home-universal-creator-button`, `home-live-hero-scan-button`, `home-next-action-rung-N`). Do not rename or remove.
- PRESERVE every existing `accessibilityLabel` and `accessibilityRole` on interactive elements.
- USE `/ui-ux-pro-max` pre-flight per `feedback_implementor_uses_ui_ux_pro_max.md` (this SPEC IS UI work).
- If any DIAG markers are added during implement, prefix with `[ORCH-0974-DIAG]`. CLOSE Step 1.5 reaps; gate is ZERO matches at CLOSE.

---

## §13 Smoke-test plan for operator (post-implement, post-EAS-OTA-publish)

1. Open the mingla-business app on iPhone (physical or iPhone 17 Pro Max sim). Sign in. Select the "Travel Brand" (or any brand with ≥ 1 upcoming event/trip).
2. Confirm the dashboard shows: top bar (Travel Brand chip + search/bell/+), then "Last 7 Days" card, then "Active Events" card (with ~8px gap between them — visibly tighter than before), then a clear 24px gap, then "Upcoming / See all" header, then a clear 16px gap (visibly larger than before), then the first upcoming card.
3. Flick the upcoming list upward. Confirm: the KPI cards and "Upcoming / See all" header DO NOT move; only the list cards translate up. Flick down; same — only the list moves.
4. Pull down on the upcoming list to trigger refresh. Confirm: the standard iOS refresh spinner appears and the brand data refetches (KPI values may update if any sales happened).
5. (If you have a brand with no upcoming items) confirm the empty-list state inside the FlatList shows "No upcoming events" / "Tap + to create…" exactly as before.
6. (If you have a brand with no brands at all — i.e. signed in but no brand created) confirm the empty-brand state ("No brands yet" / "Choose a brand" / "Loading brands") renders exactly as before with no lock applied.

If any of those checks fails → REWORK signal to implementor.

---

## §14 External APIs

NONE. Zero external API surface touched by this SPEC. COMMS-0003 (`feedback_external_api_docs_verified.md`) and `feedback_stripe_skill_mandatory.md` are N/A. No provider docs URL citations required. Stated explicitly to satisfy the ack chain.

---

## §15 Pipeline routing after this SPEC

1. Orchestrator REVIEWS this SPEC (Claude `mingla-orchestrator`).
2. If APPROVED → DISPATCH to Claude `mingla-implementor` (Claude side preferred because `/ui-ux-pro-max` pre-flight is mandatory per `feedback_implementor_uses_ui_ux_pro_max.md`).
3. Implementor writes code per §3-§12; ships T-01..T-06 with fails-on-revert verification.
4. Orchestrator REVIEWS implementation.
5. If APPROVED → DISPATCH to Claude `mingla-tester` for TEST on iPhone 17 Pro Max + Pixel emu + iPhone SE 3rd gen (small-phone carve-out) + business-web narrow viewport eyeball.
6. Tester writes A-01..A-05 with fails-on-revert verification; produces verdict.
7. If PASS / CONDITIONAL PASS → orchestrator CLOSE:
   - Step 0.5 regression-test gate: BOTH test files cited with paths + fails-on-revert hashes.
   - Step 1: update WORLD_MAP + MASTER_BUG_LIST + COVERAGE_MAP + PRODUCT_SNAPSHOT + PRIORITY_BOARD + AGENT_HANDOFFS + OPEN_INVESTIGATIONS (or document SYNC-deferred reason in CLOSE banner).
   - Step 1.5: DIAG-marker reap (zero `[ORCH-0974-DIAG]` matches required).
   - Step 1.7: reap worktree via `scripts/orch-worktree/reap.sh`.
   - Step 2: commit message — Vercel `[deploy]` tag REQUIRED (touches `mingla-business/src/`).
   - Step 3: EAS OTA publish — `cd mingla-business && eas update --branch production --platform ios,android --message "ORCH-0974: Home mobile section lock + spacing"`.
   - Flip `I-PROPOSED-HOME-MOBILE-LOCK-PANE` DRAFT → ACTIVE in INVARIANT_REGISTRY.
   - Update memory file index: add a one-line entry under "Mingla Business desktop-web — 16 intentional contracts" memory's sibling section noting the new mobile lock contract (or create a new memory file if appropriate — orchestrator decides).

---

## §16 Deliverables checklist (for implementor)

- [ ] `mingla-business/app/(tabs)/home.tsx` edited per §3.2 + §4 + §5 with `// orch-0974-lock-pane:begin/end` markers
- [ ] `mingla-business/src/components/home/UpcomingListItem.tsx` created per §4.1
- [ ] `.github/scripts/strict-grep/orch-0974-home-mobile-lock-pane.mjs` created per §10
- [ ] `.github/workflows/strict-grep-mingla-business.yml` extended with `ORCH-0974: Home mobile lock pane` job
- [ ] `mingla-business/app/(tabs)/__tests__/home.orch_0974.test.tsx` created with T-01..T-06; fails-on-revert verified on T-01 + T-02 + T-05 minimum
- [ ] iOS sim eyeball confirmed (iPhone 17 Pro Max + iPhone SE 3rd gen for carve-out)
- [ ] Android emu eyeball confirmed (Pixel 6 or equivalent)
- [ ] No diff under `app-mobile/`, `mingla-admin/`, `mingla-marketing/`, `supabase/`, `packages/`
- [ ] No diff in `mingla-business/src/constants/designSystem.ts`
- [ ] `/ui-ux-pro-max` pre-flight invoked
- [ ] Implementation report written at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md` with: file list, fails-on-revert hashes, sim screenshots before/after, `/ui-ux-pro-max` invocation summary.
