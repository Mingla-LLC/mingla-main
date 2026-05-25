# INVESTIGATION — ORCH-0974 [Home (mingla-business mobile) section lock + spacing]

**Skill:** Claude `mingla-forensics` (INVESTIGATE)
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0974-[home-mobile-section-lock-and-spacing]/`
**Branch:** `ORCH-0974-home-mobile-section-lock-and-spacing`
**Date:** 2026-05-25
**Confidence:** PROVEN (source + iOS sim runtime + operator-photographed symptom)
**Sub-mode:** INVESTIGATE — paired SPEC follows in `Mingla_Artifacts/specs/SPEC_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md`.

---

## §0 Phase 0 mandatory ingest — completed

| # | Item | Path | Status |
|---|------|------|--------|
| 1 | Dispatch prompt | `Mingla_Artifacts/prompts/FORENSICS_INVESTIGATE_AND_SPEC_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md` | Read end-to-end. |
| 2 | INVARIANT_REGISTRY | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Grepped for home-screen / mobile / layout invariants. One hit: `I-HOME-NEXT-ACTION-CANONICAL` (ORCH-0965, governs `HomeNextActionCard` derivation only — does NOT constrain scroll architecture or spacing). No invariant exists today that would forbid the lock pattern. |
| 3 | `home.tsx` | `mingla-business/app/(tabs)/home.tsx` | Read all 1046 lines. |
| 4 | Spacing tokens | `mingla-business/src/constants/designSystem.ts:29-37` | Read: `xxs=2, xs=4, sm=8, md=16, lg=24, xl=32, xxl=48`. |
| 5 | `HomeNextActionCard` | `mingla-business/src/components/home/HomeNextActionCard.tsx` | Read; pure presentational component with `marginBottom: spacing.md` on its outer wrap. Relevant to A-03. |
| 6 | ORCH-0965 CLOSE entry | (in current `main` ahead of this worktree's base) | The worktree's `WORLD_MAP.md` predates ORCH-0965's close; ORCH-0965 details are derivable from the `home.tsx` file header comment + `HomeNextActionCard` source. Sufficient. |
| 7 | Existing home components | `mingla-business/src/components/home/` | Two components present: `HomeNextActionCard.tsx`, `HomeTripRow.tsx`. No existing `<HomeLockedDashboard>` or `<HomeUpcomingList>` primitive — new components would be ORCH-0974's introductions. |
| 8 | Live-fire on iOS sim | iPhone 17 Pro Max (2C3312D9-EE52-4EBD-9704-15811D49A2EC), iOS 26.4 | App already running with the exact operator-photographed state (Travel Brand + €12,625 + Active Events 2 + DC Adventure + The Sone). Two screenshots captured: `screenshots/orch-0974/ios-sim-current-state.png` (baseline) + `screenshots/orch-0974/ios-sim-after-swipe-up.png` (after Maestro swipe-up — visually identical because only 2 list cards fit within viewport with room to spare). |

**Android emu live-fire status:** No Android emulator booted at the time of this investigation. Per Phase 0 of the dispatch this is a minor gap — the architectural defect is symmetric across iOS and Android (same React Native source code, same `ScrollView` primitive, same `isWideDesktop` breakpoint at 768px); the spacing defect is identical because `spacing.*` tokens are dimensionless DIP values applied identically by RN on both platforms. Confidence label remains PROVEN because source + iOS sim + operator-attached screenshot triangulate the same conclusion; Android parity is structural-by-construction rather than independently verified. If Android-specific behaviour is a concern, raising as a tester gate at TEST phase is sufficient (no separate code path exists to diverge).

---

## §1 Scope and symptom

### 1.1 What operator reported

Two confirmed defects on the **mingla-business mobile Home tab** at `mingla-business/app/(tabs)/home.tsx`, observed on iOS:

1. **Sections look mushed up** — "Last 7 Days", "Active Events", and "Upcoming" header read as one continuous tight block; specifically, the "Upcoming" header has zero breathing room from the first list card directly below it.
2. **Entire page scrolls, not just the upcoming list** — the KPI hero card + KPI grid card + section header all scroll off the top when the buyer flicks the upcoming list; operator wants the dashboard chrome locked at the top, only the list pans underneath.

### 1.2 In scope

- `mingla-business/app/(tabs)/home.tsx` mobile path (the `!isWideDesktop` branch, where `isWideDesktop = dimensions.width >= 768`)
- Spacing tokens at `mingla-business/src/constants/designSystem.ts` (read-only — no new tokens needed; existing tokens are sufficient).

### 1.3 Out of scope

| Surface | Reason |
|---------|--------|
| Desktop / `isWideDesktop` branch | Already implements the lock via `desktopUpcomingPane` + `desktopUpcomingList`. Memory `feedback_mingla_business_desktop_web_contracts.md` explicitly forbids regressing the 16 intentional desktop contracts. |
| Top bar / `barWrap` | ORCH-0973 [Home account topbar parity] owns this lane in a parallel worktree at `~/Desktop/mingla-orchs/ORCH-0973-[home-account-topbar-parity]/`. ORCH-0974 leaves the top bar's content + layout chrome untouched. No file-line collision was found because ORCH-0973's stated scope is the top-bar `TopBar` component contents, not the dashboard body. |
| Empty / cold-cache states (`!currentBrand`) | Nothing to lock when there is nothing to scroll. Existing single-column layout preserved verbatim. |
| `app-mobile/`, `mingla-admin/`, `mingla-marketing/`, `supabase/`, `packages/` | Different surfaces. |
| Buyer-web checkout / event / brand pages | Different routes, different consumer. |

---

## §2 Investigation manifest (files read, in trace order)

| # | File | Why | Layer |
|---|------|-----|-------|
| 1 | `mingla-business/app/(tabs)/home.tsx` (1046 lines) | Primary subject. | Component |
| 2 | `mingla-business/src/constants/designSystem.ts` (spacing block) | Quantify the gap tokens. | Tokens |
| 3 | `mingla-business/src/components/home/HomeNextActionCard.tsx` | Ladder-rung card placement (A-03). | Component |
| 4 | `mingla-business/src/components/home/HomeTripRow.tsx` (existence only) | Confirm card primitive available for trip-row branch in list. | Component |
| 5 | `mingla-business/src/hooks/useResponsiveLayout.ts` (referenced) | Determine `isWideDesktop` breakpoint (768px confirmed via grep of similar usages and existing file header comment in `home.tsx`). | Hook |
| 6 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | Surface any invariant the lock would violate. | Docs |
| 7 | `.github/scripts/strict-grep/` directory listing | Confirm registry pattern + identify naming for new ORCH-0974 gate. | CI |

---

## §3 Five-truth-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | `INVARIANT_REGISTRY.md` contains exactly one home-screen invariant — `I-HOME-NEXT-ACTION-CANONICAL` — and it constrains the ladder card's data source only, not scroll architecture or layout spacing. No invariant currently forbids the lock pattern. No invariant currently requires the single-scroll architecture. The `home.tsx` file header comment documents states/branches but not scroll architecture decisions. |
| **Schema** | N/A — pure UI work, zero database, zero RPCs, zero edge functions. |
| **Code** | The defect IS the code structure (see §4 detailed reading). Outer `<ScrollView>` at line 393 with `contentContainerStyle=[styles.scroll]` wraps EVERY direct child of the populated path: optional `<HomeNextActionCard>` (line 454-456), KPI grid wrapper (line 457-550) containing KPI hero card + Active Events tile, and the "Upcoming" pane wrapper (line 552-718) containing section header + inner `<ScrollView>`. Inner ScrollView's `scrollEnabled={isWideDesktop}` is **false on mobile** — the inner is inert; only the outer scrolls. `styles.scroll` (line 767-772) uses `gap: spacing.md` (16px) between all direct children. `styles.eventsCol` (line 953-955) uses `gap: spacing.sm` (8px) between list cards. There is NO marginTop on the inner ScrollView on the mobile path (the `desktopUpcomingList.marginTop: spacing.sm` style only applies in the `isWideDesktop` branch via the conditional `style={isWideDesktop ? styles.desktopUpcomingList : undefined}` at line 565). Therefore the section header (`sectionHeaderRow` at line 553) and the first card render with NO inter-element gap on mobile beyond the section header's own intrinsic bottom box. |
| **Runtime** | iPhone 17 Pro Max (iOS 26.4) sim screenshot captured shows the exact "mushed" rhythm operator described. Operator-attached screenshot from the conversation independently confirms the same on a physical iPhone-like device. After a Maestro swipe-up the screen did not visually change — because only 2 cards fit in the visible area with ~50% empty space below; the scroll architecture defect manifests only when content overflows. The lock defect is therefore structurally provable from source (outer ScrollView wraps the lockable zones) and operator-stated future-state (more upcoming items will scroll the KPIs off-screen). |
| **Data** | Travel Brand, 2 upcoming trips (DC Adventure 16–22 Aug, The Sone 18–22 Sep), no live event, no ladder rung firing. Matches the operator's screenshot exactly. |

**Layer disagreement:** none. All five layers agree on the current state. The defect is not a contradiction between layers — it is a single architectural decision (outer-ScrollView-wraps-everything) compounded by tight gap tokens that visually compresses the locked zones into one block.

---

## §4 Findings

### 🔴 F-1 — ROOT CAUSE — Outer ScrollView wraps both lockable zones and the scrolling list

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:393-722` |
| Exact code | `<ScrollView style={isWideDesktop ? styles.desktopOuterScroll : undefined} scrollEnabled={!isWideDesktop} contentContainerStyle={[styles.scroll, isWideDesktop && styles.desktopScroll]} ...>` wraps `<HomeNextActionCard>` (conditional), `<View style={isWideDesktop ? styles.desktopKpiGrid : undefined}>` (KPI hero + Active Events), and `<View style={isWideDesktop ? styles.desktopUpcomingPane : undefined}>` (section header + inner ScrollView). |
| What it does | On mobile (`!isWideDesktop`), the outer ScrollView is the only scrollable surface (inner ScrollView at line 564 has `scrollEnabled={isWideDesktop}` = false). Every direct child — including the KPI hero, the KPI grid, the "Upcoming" section header, AND the upcoming list cards — lives inside one scrolling viewport. When content overflows the viewport, ALL of it pans up together. |
| What it should do | Per operator intent (confirmed 2026-05-25): the locked zone (KPI hero, KPI grid card, "Upcoming / See all" section header) MUST stay fixed at the top of the visible area; only the upcoming list cards (and the optional `<HomeNextActionCard>` per A-03 decision below) scroll. Mirrors the existing desktop `desktopUpcomingPane` flex pattern but expressed for mobile. |
| Causal chain | (1) RN `<ScrollView>` scrolls all of its contentContainer when content height > viewport height. (2) On mobile, KPI hero card height (~80px) + KPI grid card height (~80px) + section header (~40px) + N×card-height (~80px each) + paddings/gaps adds up to >viewport once N≥4 cards on a typical 6.1" iPhone. (3) Therefore the KPIs and section header WILL scroll off-screen once a brand accumulates more upcoming items. (4) Operator's reported "entire home page scrolls" is the direct observable consequence on a populated brand. |
| Verification step | Run a debug-build of mingla-business on iPhone 17 Pro Max with a brand holding ≥5 upcoming items; flick the upcoming list and observe the KPI hero scroll past the safe-area inset. Already proven via source-architecture reading (the inner ScrollView is inert on mobile, the outer wraps everything). |

### 🔴 F-2 — ROOT CAUSE — Section header has zero gap to first card on mobile

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:552-572` (header pane + inner list) + `mingla-business/app/(tabs)/home.tsx:798-802` (`desktopUpcomingList` styles applied conditionally) + `mingla-business/app/(tabs)/home.tsx:953-955` (`eventsCol` contentContainerStyle gap only between cards) |
| Exact code | `<ScrollView style={isWideDesktop ? styles.desktopUpcomingList : undefined} scrollEnabled={isWideDesktop} ... contentContainerStyle={[styles.eventsCol, isWideDesktop && styles.desktopEventsGrid]}>` — the only marginTop on the inner ScrollView is `desktopUpcomingList.marginTop: spacing.sm`, applied ONLY when `isWideDesktop`. Mobile gets `style={undefined}` — no marginTop. |
| What it does | On mobile, the section header `<View style={styles.sectionHeaderRow}>` (which has `paddingTop: spacing.sm` = 8px and `paddingHorizontal: spacing.xs` = 4px) renders immediately above the inner ScrollView's first card. The first card lives in `eventsCol` which has `gap: spacing.sm` (8px) — but `gap` only applies BETWEEN children of `eventsCol`, not between `eventsCol` and its parent. So the section header → first card distance is just `sectionHeaderRow`'s intrinsic bottom (no padding or margin) plus zero from `eventsCol`'s top edge. Result: header sits directly atop the first card with no visible breathing room. |
| What it should do | The section header → first card gap must be visibly larger than the inter-card gap (operator-explicit requirement: "the upcoming text also needs some breathing room from the list"). Recommend `spacing.md` (16px) minimum, ideally `spacing.lg` (24px) for a true breathing-room feel. |
| Causal chain | RN Flexbox `gap` is intra-container only. Zero margin/padding between `sectionHeaderRow` and the inner ScrollView results in literal pixel-adjacency. The eye reads this as "header is part of the card" rather than "header introduces the card list". |
| Verification step | Captured at `screenshots/orch-0974/ios-sim-current-state.png` — the "Upcoming" baseline sits ~6px above the "UPCOMING" pill on the first DC Adventure card. |

### 🟠 F-3 — CONTRIBUTING FACTOR — Inter-KPI gap of 16px on mobile is too tight for the visual hierarchy

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:767-772` (`styles.scroll.gap: spacing.md` = 16px) |
| Exact code | `scroll: { paddingHorizontal: spacing.md, paddingVertical: spacing.lg, paddingBottom: spacing.xl * 4, gap: spacing.md, }` |
| What it does | Sets a uniform 16px vertical gap between every direct child of the outer ScrollView's contentContainer — `<HomeNextActionCard>` (if present) → KPI grid wrapper → Upcoming pane wrapper. The KPI hero card (height ~80px) and Active Events tile (height ~80px) end up with 16px between them. |
| What it should do | The KPI cards should read as distinct zones, not stacked tiles. Recommend `spacing.sm` (8px) between the inter-KPI tiles WITHIN a `desktopKpiGrid`-style cell wrapper (so iOS gets the same internal logic as desktop) OR increase to `spacing.lg` (24px) between hero and grid card. Operator's "mushed" complaint maps directly to this 16px-only gap. |
| Causal chain | At 16px, the gap is exactly the same as the cards' internal padding (`spacing.md` is the GlassCard inner padding via `KpiTile`'s default), so visually the inter-card space equals the intra-card space → no z-axis separation → reads as one continuous panel. |
| Verification step | Compare side-by-side with the captured screenshot. The first observation is that "Last 7 Days" and "Active Events" feel attached. |

### 🟠 F-4 — CONTRIBUTING FACTOR — `paddingVertical: spacing.lg` on outer scroll creates a generous top gap but the section-to-section rhythm doesn't earn it

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:767-771` |
| Exact code | `paddingVertical: spacing.lg` applies 24px top AND bottom inside the contentContainer. Combined with `barWrap.paddingBottom: spacing.sm` (8px), the visual gap between the top bar and the first KPI is 32px. Then 16px between KPIs. Then 16px (gap) + 8px (sectionHeaderRow paddingTop) = 24px to the section header. Then 0px to the first card. |
| What it does | The vertical rhythm goes 32→16→24→0. That's a discordant cadence — the first gap is more than 2× the inter-KPI gap, and the last gap is zero. |
| What it should do | Even cadence, with rhythm emphasising the locked-section → list boundary: top → first-KPI 16-20px, inter-KPI 8-12px, KPI grid → section header 24px (this is a zone boundary), section header → first card 16-24px (operator-explicit). |
| Causal chain | A discordant gap progression reads as "the screen was not designed; it was assembled from default tokens". Cleaning this up improves perceived polish at zero functional cost. |
| Verification step | Apply the SPEC's spacing contract and re-capture; the rhythm should read as deliberate. |

### 🟡 F-5 — HIDDEN FLAW — `RefreshControl` is on the outer ScrollView; switching to FlatList-only-scrolls requires migrating it

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:401-403` |
| Exact code | `refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}` on the outer ScrollView. |
| What it does | Today the user can pull-to-refresh from any point on the home screen. Removing the outer ScrollView (or replacing it with a fixed `<View>`) breaks this — `RefreshControl` only works on scrollable surfaces. |
| What it should do | The SPEC must explicitly move `RefreshControl` onto the new `<FlatList>` that owns the only scrolling surface. The refetch wiring (`handleRefresh` invalidating brandKeys + eventOrdersKeys + upcomingKeys) stays unchanged — only the prop placement moves. |
| Causal chain | Forgotten migration → silent regression where users can't pull-to-refresh anymore. Catch in SPEC and tester. |
| Verification step | SPEC §3 must name `refreshControl` placement on the FlatList; tester's adversarial test must assert pull-to-refresh still fires `handleRefresh`. |

### 🔵 F-6 — OBSERVATION — `desktopUpcomingPane` is the architectural reference

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:793-802` |
| Exact code | `desktopUpcomingPane: { flex: 1, minHeight: 0, overflow: "hidden" }, desktopUpcomingList: { flex: 1, minHeight: 0, marginTop: spacing.sm }` |
| What it does | On desktop wide, the upcoming pane is a flex-1 child that hides overflow (the lock), and the inner ScrollView is `flex: 1, minHeight: 0` so it consumes the remaining vertical space and scrolls within. This is the textbook RN pattern for "fixed top + scrolling bottom". |
| What it should do | Mobile should use the same pattern, with the locked-zone children placed before the upcoming-pane child inside the parent flex column, and the upcoming-pane child carrying `flex: 1 + minHeight: 0 + overflow: hidden` + an inner `<FlatList style={{flex:1, minHeight:0}}>`. |
| Causal chain | Reusing the desktop pattern means consistent behaviour, consistent styling vocabulary, and minimal new code. |
| Verification step | The SPEC §3 layout sketch mirrors `desktopUpcomingPane`. |

### 🔵 F-7 — OBSERVATION — `eventsCol.gap: spacing.sm` is the inter-card gap; new section-header gap should exceed it

| Field | Evidence |
|-------|----------|
| File + line | `mingla-business/app/(tabs)/home.tsx:953-955` |
| Exact code | `eventsCol: { gap: spacing.sm }` (= 8px between list cards) |
| What it should do | Section-header → first-card gap should be **at least 2× the inter-card gap** (i.e. ≥ 16px), ideally `spacing.lg` (24px), to make the header read as a "zone introducer" rather than a card sibling. |
| Causal chain | Visual hierarchy convention: parent labels need more breathing room than child siblings. |
| Verification step | Apply SPEC §5 spacing contract and eyeball. |

---

## §5 Blast radius

| Affected | How |
|----------|-----|
| `mingla-business/app/(tabs)/home.tsx` | The ONE file edited. |
| Buyer-web | Untouched (different routes). |
| Consumer apps `app-mobile/` | Untouched (different surface). |
| Admin web | Untouched. |
| Other mingla-business screens | Untouched (no shared component changes). |
| `RefreshControl` wiring | Prop placement moves from outer ScrollView to FlatList; semantics preserved. |
| ORCH-0965 ladder-rung behaviour | Preserved — `<HomeNextActionCard>` continues to render conditionally; placement decision (locked-zone vs scrolling-zone) in A-03 below. |
| ORCH-0826 universal creator (`<UniversalCreatorSheet>`) | Untouched (separate overlay sheet). |
| `Toast` overlay | Untouched (already absolute-positioned per `feedback_toast_needs_absolute_wrap.md`). |
| Pull-to-refresh user flow | Preserved on the only-scrollable surface (FlatList). |

**Cross-ORCH:**
- **ORCH-0973 [Home account topbar parity]** — touches the same file `home.tsx` but ORCH-0973's lane is the top-bar / `barWrap` chrome (account-related content within `<TopBar>`). ORCH-0974's lane is the dashboard body below `<TopBar>`. Confirmed by reading ORCH-0973's worktree path — its branch's HEAD commit (`6f3b03dc2`) is identical to this worktree's base, so neither has diverged on `home.tsx` yet. Whichever ORCH merges first, the other rebases. No collision expected because the file-line ranges are disjoint (lines 377-391 vs 393-722).

---

## §6 Invariant violations

**None today.** No existing invariant is violated by current behaviour or by the proposed fix. The SPEC will introduce one new DRAFT invariant: `I-PROPOSED-HOME-MOBILE-LOCK-PANE` — "On the mingla-business mobile Home tab (`!isWideDesktop`), the KPI hero card, the KPI grid card, the optional `<HomeNextActionCard>` (when placement decided as locked per A-03), and the 'Upcoming / See all' section header MUST NOT participate in the scrollable surface. Exactly one scrollable surface (the upcoming `<FlatList>`) exists on the populated mobile Home path." The DRAFT invariant flips to ACTIVE on ORCH-0974 CLOSE.

---

## §7 Adversarial answers (A-01 through A-06)

### A-01 — Max locked-section height across phone form factors

**Worst case (locked = HomeNextActionCard + KPI hero card + Active Events tile + section header):** On iPhone SE (smallest supported, viewport ~568px tall after safe-area + tab bar ≈ 480px usable), the locked zone consumes:
- HomeNextActionCard (when fired): ~110px (24 padding + ~18 title + 8 gap + ~32 body + 12 gap + ~20 CTA + 16 internal margin) = ~110px including its own marginBottom
- KPI hero card OR Live hero card: ~80-180px depending on Live vs 7-day variant. Live variant with progress bar + 3-stat row is ~180px tall.
- Active Events tile: ~80px
- Section header (with paddingTop): ~40px
- Inter-section gaps per SPEC §5: ~3 × 16px = 48px

Worst case: ~110 + 180 + 80 + 40 + 48 = **~458px** on iPhone SE — leaves ~22px for the upcoming list, which is unusably short.

**Decision (SPEC §6 §B):** When the live-hero variant is rendered AND the ladder-rung card fires AND the form factor is iPhone-SE-class (viewport ≤ 700px), the ladder-rung card MOVES into the scrolling zone (rendered as the FIRST list item). On all other form factors and all other state branches, the ladder-rung card stays in the locked zone. This is the only legitimate state-dependent placement and the SPEC encodes it explicitly. (Tester will need to verify on a small simulator: iPhone SE 3rd gen.)

### A-02 — RefreshControl migration

`RefreshControl` moves from the outer ScrollView to the FlatList. `handleRefresh` (lines 141-152) stays unchanged. Behaviour preserved: pull-down on the upcoming list still invalidates brandKeys + eventOrdersKeys + upcomingKeys. New behaviour: pull-down on the locked zone (KPI cards / section header) does NOT trigger refresh — but operator can still trigger from the list, which is the visually dominant zone. Acceptable. Tester adversarial test: assert pull-down on the list calls `handleRefresh`; documented in SPEC §6 §T-02-adv.

### A-03 — HomeNextActionCard placement (locked or scrolling?)

The card is conditional (`nextAction !== null && (upcoming.counts.live === 0 || nextAction.rung === 4)`) and represents a high-priority recommendation. Two valid placements:

- **Locked (default):** Card is part of the "dashboard chrome". Stays visible even as the buyer scrolls the list. Best for actionability — the recommendation stays in front of the buyer.
- **Scrolling (carve-out):** Card is part of the list flow. Used only when the locked-zone height would crowd the list below an unusable threshold (per A-01).

**Decision:** Locked by default. Carve-out for iPhone-SE-class viewports with live-hero + ladder-rung simultaneously firing (per A-01). Operator did not specify; this default maximises the card's "always visible" value while preserving usability on small phones.

### A-04 — Empty-state carve-out

The `!currentBrand` branch (lines 405-446) renders a single `<View style={styles.emptyCol}>` with the greeting + prompt. There is no upcoming list and nothing to scroll. SPEC preserves this branch verbatim — no lock applied. Implementor must NOT touch lines 405-446. Tester adversarial test asserts the empty state renders identically (snapshot or structural assertion).

### A-05 — FlatList parity with current inner ScrollView rendering

Inner ScrollView's children today are `upcoming.items.map((item) => ...)` (lines 583-715) plus an empty-state branch (lines 573-581). Three card variants:
1. `item.kind === "draft"` → custom inline JSX with `<EventCoverMedia>` + draft-step display
2. `item.kind === "trip"` → `<HomeTripRow>` component
3. `item.kind === "event"` or `"experience"` → custom inline JSX with `<EventCoverMedia>` + sold/revenue display

Migrating to FlatList:
- `data={upcoming.items}`
- `keyExtractor={(item) => item.key}`
- `renderItem={({item}) => <UpcomingListItem item={item} ...handlers />}` — extract the per-item rendering into a `<UpcomingListItem>` component (under `mingla-business/src/components/home/UpcomingListItem.tsx`) to keep the FlatList renderItem clean
- `ListEmptyComponent={<GlassCard variant="base" padding={spacing.lg}>...</GlassCard>}` for the empty-list state
- `ItemSeparatorComponent` or `contentContainerStyle={{gap: spacing.sm}}` for inter-card spacing (modern RN supports `gap` on contentContainerStyle)
- `contentContainerStyle={{paddingTop: spacing.lg, paddingBottom: spacing.xl * 4}}` — the top padding becomes the section-header → first-card breathing room (24px = `spacing.lg`)

All three card variants render identically because the renderItem replicates the existing JSX branches. ORCH-0965 tri-kind behaviour preserved verbatim.

### A-06 — Web preview at narrow viewport

`useResponsiveLayout` returns `isWideDesktop = dimensions.width >= 768`. A phone-sized browser hitting `business.usemingla.com` (e.g. someone testing on iPhone Safari) at <768px will hit the mobile path. With the SPEC applied:
- The locked-zone primitives use `flex: 1 + minHeight: 0` — these are first-class CSS-flex properties on RN-web. Behaviour will be identical to native.
- FlatList on RN-web uses a virtualised list; scrolling is wheel/touch as native.
- `RefreshControl` on web is a no-op (RN-web doesn't implement pull-to-refresh) — acceptable; this is pre-existing behaviour, not a regression introduced by this ORCH.

**Recommendation:** No special handling for narrow web preview. The mobile path applies and works.

---

## §8 Discoveries for orchestrator

**None.** No side issues surfaced during investigation. No new bugs discovered in adjacent code. ORCH-0973 collision-check was clean (different file-line ranges). No invariant proposed for an unrelated concern. No COMMS-NNNN entry needed.

---

## §9 Confidence and limits

**Confidence: PROVEN.**

- Source-level evidence is conclusive (1046 lines read end-to-end; defect mechanism is the architectural choice itself, not a subtle bug).
- iOS sim runtime evidence (iPhone 17 Pro Max) corroborates operator's photographed symptom exactly.
- Operator's screenshot is itself runtime evidence from a separate device, triangulating.
- Spacing token values are direct file reads, not assumed.

**Known limits:**
- Android emulator was not booted during this investigation. The architectural defect is structural and shared (same RN source, same primitives) so confidence remains PROVEN; tester at TEST phase should still exercise Android-side parity per `feedback_tester_canonical_and_platform_parity.md`.
- The visual demonstration of "KPIs scrolling off-screen" was not captured because the current dataset (2 cards) fits inside the viewport with empty space below. Captured screenshots show only the static state. Source code unambiguously confirms the outer ScrollView wraps both zones; any state with N ≥ 4-5 upcoming items would visually exhibit the defect. Mock-data tester paths or a synthetically-extended `upcoming.items` array would visualise it during TEST.

---

## §10 Hand-off to SPEC

Investigation complete. Defect mechanism: outer ScrollView wraps both zones (root cause F-1) + tight inter-section gaps (F-2, F-3, F-4) + hidden RefreshControl migration requirement (F-5). Architectural pattern: mirror the existing `desktopUpcomingPane` flex-shell + flex-1 list contract (F-6). The paired SPEC at `Mingla_Artifacts/specs/SPEC_ORCH-0974_HOME_MOBILE_SECTION_LOCK_AND_SPACING.md` (this worktree) is the next deliverable.
