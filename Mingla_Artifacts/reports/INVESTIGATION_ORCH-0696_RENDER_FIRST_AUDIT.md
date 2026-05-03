# INVESTIGATION_ORCH-0696_RENDER_FIRST_AUDIT

**Investigator:** mingla-forensics (INVESTIGATE-only)
**Dispatch:** [prompts/FORENSICS_ORCH-0696_RENDER_FIRST_AUDIT.md](../prompts/FORENSICS_ORCH-0696_RENDER_FIRST_AUDIT.md)
**Design target:** [specs/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md](../specs/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md) — REVIEW APPROVED 10/10
**Date:** 2026-04-28
**Confidence:** HIGH (code-deterministic for all chrome / IA / token findings · MEDIUM for runtime predictions about `@gorhom/bottom-sheet` toast stacking — labelled NEEDS-LIVE-FIRE where applicable)

---

## §1 Layman summary

The Expanded Card Modal today is one centered floating white card mounted from 8 places in the app. It opens, scrolls, closes — same chrome regardless of whether you're looking at a restaurant, a curated experience plan, or a Ticketmaster event. The audit confirms the design spec's targets are all implementable as-is and identifies the LOC delta:

- **Chrome change is small but file-localized.** Only one file (`ExpandedCardModal.tsx`) defines the chrome — replacing `<Modal>` + `styles.overlay/overlayBackground/modalContainer` with `<BottomSheet>` from `@gorhom/bottom-sheet` is a ~25-line surgical swap.
- **The IA workload is in the night-out branch + token re-map.** `nightOutStyles` block (~256 LOC at lines 2132-2388) builds the current event layout on a light-mode placecard pattern. Designer's new event IA reorganizes content (poster hero, artist accent, sticky-bottom CTA → above-fold CTA) requiring a new `EventDetailLayout` component. That's the largest IMPL chunk.
- **Token re-mapping is the biggest sweep.** 13 sub-components in `app-mobile/src/components/expandedCard/` use ~110+ hardcoded light-mode color values (`#fff` backgrounds, `#111827` titles, `#6b7280` secondary text). Each must flip to dark-on-dark equivalents per design §E-4.4. This touches every place-rendering mount surface (5 of 8 surfaces).
- **All 8 mount surfaces inherit chrome from one source.** None of the 8 sites passes a presentation-style override. Single `<Modal>` → `<BottomSheet>` swap cascades to all 8 cleanly. No per-surface presentation flag exists.
- **Only 2 of 3 candidate sheets** for OQ-6 retrofit actually exist as `@gorhom/bottom-sheet` instances (`MapBottomSheet`, `PersonBottomSheet`). `ProposeDateTimeModal` is a native `<Modal>` not a bottom sheet — designer's note is corrected here.
- **Forward-looking trigger `cardType === 'event'` has zero callers today.** Only `card.nightOutData != null` is the live event signal. Keeping the parallel trigger in the new render branching is fine (defensive) but does nothing today.

**Estimated IMPL LOC delta:** approximately +500 / −350 net (new EventDetailLayout file +~280 LOC; chrome swap −~30 LOC; sticky-bottom CTA removed −~40 LOC; nightOutStyles obsoleted partial −~150 LOC; token re-maps across 13 sub-components +~110 LOC offsets).

**Design implementable as-is:** YES. No blockers. Audit confirms designer's recommendations are achievable with current dependencies (`@gorhom/bottom-sheet@^5.2.8` + `expo-calendar@~15.0.8` both present in `app-mobile/package.json`).

---

## §2 Phase 0 — Ingestion

| Source | Read | Outcome |
|---|---|---|
| Designer spec | [`specs/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md`](../specs/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md) lines 1-300+ | Bottom-sheet chrome E-3 / token tables E-4 / event IA wireframes E-5 / place IA preservation E-6 / render branching contract E-7 / motion E-8 / a11y E-9 — all read |
| Forensics dispatch | [`prompts/FORENSICS_ORCH-0696_RENDER_FIRST_AUDIT.md`](../prompts/FORENSICS_ORCH-0696_RENDER_FIRST_AUDIT.md) | 8 mount surfaces enumerated; render-first rule, OQ-1..OQ-6 lock-ins read |
| MEMORY.md | Project memory + ORCH-0685 cycle-3 lessons | RN Modal portal pattern context confirmed |
| `package.json` | `app-mobile/package.json` lines 21 + 41 | `@gorhom/bottom-sheet@^5.2.8` ✅ present · `expo-calendar@~15.0.8` ✅ present |
| Existing reference sheets | `MapBottomSheet.tsx` + `PersonBottomSheet.tsx` | Both use `@gorhom/bottom-sheet` with `snapPoints + handleIndicatorStyle + backgroundStyle + BottomSheetScrollView` — the canonical pattern |
| ProposeDateTimeModal | `activity/ProposeDateTimeModal.tsx` | Uses native `<Modal>`, NOT `@gorhom/bottom-sheet` — designer's note that it was a bottom-sheet candidate was inaccurate; corrected here |
| InAppBrowserModal | `app-mobile/src/components/InAppBrowserModal.tsx` | ✅ exists; OQ-2 in-app browser lock satisfied |

---

## §3 Phase 1 — Render-first inventory

### §3.1 Modal chrome inventory (per dispatch §C.1)

Lines verified against current `ExpandedCardModal.tsx` (post-Slice A landing — line numbers stable; no shifts since dispatch).

| # | Element | Current (file:line + verbatim) | Design target | Status |
|---|---|---|---|---|
| 1 | Modal wrapper | [`ExpandedCardModal.tsx:1537-1542`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1537-L1542) — `<Modal visible={visible} animationType="fade" transparent={true} onRequestClose={onClose}>` | `<BottomSheet ref index={1} snapPoints={['50%','90%']} enablePanDownToClose handleIndicatorStyle backgroundStyle ...>` per design §E-3 | 🟠 DIVERGES — needs change |
| 2 | Backdrop scrim | [`:2410-2415`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2410-L2415) — `styles.overlay = { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0, 0, 0, 0.5)' }` | `rgba(0, 0, 0, 0.55)` + `BlurView intensity={12}` per design §E-3.2; reduced-transparency fallback to `rgba(0,0,0,0.85)` | 🟠 DIVERGES — needs change |
| 3 | Backdrop tap-to-dismiss | [`:1544-1548`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1544-L1548) — `<TouchableOpacity style={styles.overlayBackground} activeOpacity={1} onPress={onClose} />` | `BottomSheetBackdrop` component from `@gorhom/bottom-sheet` (handles tap-to-close natively) | 🟠 DIVERGES — needs change · 🔵 DEAD CODE post-redesign |
| 4 | Sheet container | [`:2423-2436`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2423-L2436) — `styles.modalContainer = { width: '95%', maxWidth: 600, height: SCREEN_HEIGHT*0.9, maxHeight: SCREEN_HEIGHT*0.9, backgroundColor: '#ffffff', borderRadius: 20, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 10 }` | Full-width, fixed to bottom, `backgroundColor: rgba(12,14,18,1)` matches `glass.discover.screenBg`, `borderTopLeftRadius: 28, borderTopRightRadius: 28`, top hairline `borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: rgba(255,255,255,0.08)`, shadow upward (negative y offset) | 🟠 DIVERGES — needs change · 🔵 DEAD CODE post-redesign |
| 5 | Drag handle | NONE today | 36×4pt rounded pill, `rgba(255,255,255,0.30)`, centered, marginTop 8 / marginBottom 12. Use `handleIndicatorStyle` prop on `<BottomSheet>` | NEW — must add |
| 6 | Sticky header | [`:1554`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1554) — `<ExpandedCardHeader onClose={onClose} />` (X button, `#ffffff` bg, `#f3f4f6` button bg, `#6b7280` icon) | Drag handle replaces this for chrome role; design D-3 says ExpandedCardHeader can be retired entirely OR retained for in-sheet "go back" navigation in review-flow | 🟠 DIVERGES — needs change · 🟡 PRESERVES (header may stay if review nav needs it; spec writer decides) |
| 7 | Review nav bar | [`:1556-1579`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1556-L1579) — `styles.reviewNavBar = { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, paddingHorizontal: 16, backgroundColor: '#f9fafb', borderBottomWidth: 1, borderBottomColor: '#f3f4f6' }` + `<Icon chevron-back/forward color="#eb7825 OR #d1d5db">` + `reviewNavCounter color="#6b7280"` | Design didn't address. Preserve as separate concern; tokens MUST re-map for dark sheet (`#f9fafb` → dark variant; `#d1d5db` disabled chevron stays light enough — needs check) | 🟠 DIVERGES — token re-map required (color values not structure) |
| 8 | Inner ScrollView | [`:1582-1586`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1582-L1586) — `<ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>` | `<BottomSheetScrollView>` from `@gorhom/bottom-sheet` — gestures fight without it | 🟠 DIVERGES — needs change (mandatory for sheet to work) |

### §3.2 Per-data-type render branch inventory (per dispatch §C.2)

Three branches confirmed in current code:

| # | Branch trigger | Lines | Renders |
|---|---|---|---|
| 1 | `(card as any).cardType === 'curated'` (verified at [`:1501`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1501) — `const isCuratedCard = (card as any).cardType === 'curated'`) | [`:1589-1634`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1589-L1634) | `<CuratedPlanView>` + `<WeatherSection>` + `<BusynessSection>` + `<TimelineSection>` |
| 2 | `!isCuratedCard && (isNightOut && nightOut)` where `isNightOut = !isCuratedCard && !!card.nightOutData` ([`:1513-1514`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1513-L1514)) | [`:1653-1774`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1653-L1774) | Title + venue/artist row + genre/subGenre badges + ticket status badge + Date/Price info-cards + Vibe tags + Venue card + Seat map (conditional) |
| 3 | else (place fallback) | [`:1775-2045`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1775-L2045) | `<CardInfoSection>` + Stroll/Picnic "See Full Plan" buttons + `<WeatherSection>` + `<BusynessSection>` + `<PracticalDetailsSection>` + `<CompanionStopsSection>` (conditional) + grocery store inline (conditional) + `<TimelineSection>` (conditional) + `<ActionButtons>` |

**`cardType === 'event'` reality check:** `grep cardType\\s*[:=]\\s*['\"]event['\"]\\|cardType\\s*===\\s*['\"]event['\"]` across `app-mobile/` returns **0 matches**. The forward-looking trigger from designer §E-7 is currently inactive — only `card.nightOutData != null` is the live event signal today.

**`nightOutData` plumbing:** set only in `DiscoverScreen.tsx` at [`:1003`](../../app-mobile/src/components/DiscoverScreen.tsx#L1003) and [`:1042`](../../app-mobile/src/components/DiscoverScreen.tsx#L1042). No other surface populates it. Confirms event cards reach the modal exclusively via the Discover path today (relevant for the per-mount-surface delta in §3.5).

### §3.3 Sticky-bottom Get Tickets CTA inventory (per dispatch §C.3)

Current sticky CTA at [`:2049-2079`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2049-L2079):

```tsx
{isNightOut && nightOut && (
  <View style={nightOutStyles.stickyButtonContainer}>
    <View style={nightOutStyles.stickyButtonRow}>
      {nightOut.ticketUrl && nightOut.ticketStatus === "onsale" ? (
        <TouchableOpacity style={nightOutStyles.getTicketsButton}
          activeOpacity={0.8}
          onPress={() => setTicketBrowserUrl(nightOut.ticketUrl)}>
          <Icon name="ticket-outline" size={18} color="#fff" />
          <Text style={nightOutStyles.getTicketsText} numberOfLines={1} adjustsFontSizeToFit>
            {t('cards:expanded.get_tickets', { price: formatPriceRange(nightOut.price, accountPreferences?.currency) })}
          </Text>
        </TouchableOpacity>
      ) : (
        <View style={[nightOutStyles.getTicketsButton, { backgroundColor: '#666' }]}>
          <Text style={nightOutStyles.getTicketsText}>
            {nightOut.ticketStatus === "offsale" ? t('cards:expanded.sold_out') : t('cards:expanded.tickets_coming_soon')}
          </Text>
        </View>
      )}
      <TouchableOpacity style={nightOutStyles.shareButton} ...>
        <Icon name="share-2" size={20} color="#111827" />
      </TouchableOpacity>
    </View>
  </View>
)}
```

Style — [`:2323-2371`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2323-L2371):
- `stickyButtonContainer`: `position: absolute, bottom: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#f3f4f6'`
- `getTicketsButton`: `flex: 1, backgroundColor: '#eb7825', borderRadius: 12, paddingVertical: 16` + shadow
- `getTicketsText`: `fontSize: 14, fontWeight: '700', color: '#fff', flexShrink: 1`
- `shareButton`: `width: 50, height: 50, borderRadius: 12, backgroundColor: '#fff'`

**Design target maps the CTA to ABOVE-the-fold position** (peek state, after meta row), not sticky-bottom. Audit confirms current position is sticky-bottom-absolute via `stickyButtonContainer.position: 'absolute'`. The dead style block (`stickyButtonContainer`, `stickyButtonRow`, `getTicketsButton`, `getTicketsText`, `shareButton`) is candidate for full deletion when `EventDetailLayout` is built.

### §3.4 Place IA section inventory in render order (per dispatch §C.4)

Verified by reading `ExpandedCardModal.tsx` lines 1775-2045 in full:

| Order | Sub-component / inline | File:line | Conditional |
|---|---|---|---|
| 1 | `<CardInfoSection>` | [`:1779-1795`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1779-L1795) | always (else branch) |
| 2 | "See Full Plan" button (Stroll) | [`:1798-1832`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1798-L1832) | `isStrollCard && !(strollData && strollData.timeline)` |
| 3 | "See Full Plan" button (Picnic) | [`:1835-1869`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1835-L1869) | `isPicnicCard && !(picnicData && picnicData.timeline)` |
| 4 | `<WeatherSection>` | [`:1872-1884`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1872-L1884) | always |
| 5 | `<BusynessSection>` | [`:1887-1891`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1887-L1891) | always |
| 6 | `<PracticalDetailsSection>` | [`:1894-1899`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1894-L1899) | always |
| 7 | `<CompanionStopsSection>` | [`:1902-1906`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1902-L1906) | `strollData && strollData.companionStops` |
| 8 | Grocery Store (inline) | [`:1909-1990`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1909-L1990) | `picnicData && picnicData.groceryStore` |
| 9 | `<TimelineSection>` (Stroll) | [`:1993-2004`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1993-L2004) | `isStrollCard && strollData && strollData.timeline` |
| 10 | `<TimelineSection>` (Picnic) | [`:2007-2018`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2007-L2018) | `isPicnicCard && picnicData && picnicData.timeline` |
| 11 | `<ActionButtons>` | [`:2021-2043`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2021-L2043) | always |

**Design §E-6 notes that `<MatchFactorsBreakdown>`, `<DescriptionSection>`, `<HighlightsSection>`, `<StopImageGallery>`, `<ImageLightbox>` are also part of place IA.** Audit observation: in the current code these sub-components ARE imported ([`:35-46`](../../app-mobile/src/components/ExpandedCardModal.tsx#L35-L46)) but **NONE of them is rendered in the place fallback branch** (lines 1775-2045). They appear only inside `<CardInfoSection>` (which composes `<DescriptionSection>` internally — verify in spec phase) or inside `<CuratedPlanView>` (curated branch). Spec writer must confirm. **🔵 DEAD CODE candidate IF none of those sub-components is reachable.** Status flagged but NOT confirmed dead — needs Phase 2 grep verification (see §4).

**Curated branch sub-components ([`:1591-1633`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1591-L1633)):**

| Order | Component | File:line | Conditional |
|---|---|---|---|
| 1 | `<CuratedPlanView>` | [`:1591-1603`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1591-L1603) | `isCuratedCard && curatedCard && Array.isArray(curatedCard.stops)` |
| 2 | `<WeatherSection>` (first stop) | [`:1606-1612`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1606-L1612) | (within curated) |
| 3 | `<BusynessSection>` (first stop) | [`:1615-1619`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1615-L1619) | (within curated) |
| 4 | `<TimelineSection>` (curated) | [`:1623-1633`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1623-L1633) | `curatedCard.stops && curatedCard.stops.length > 0` |

**ImageGallery in non-curated branch:** [`:1637-1650`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1637-L1650) — `!isCuratedCard && (card.images && card.images.length > 0 ? <ImageGallery /> : <View>{t('cards:expanded.no_images')}</View>)`. Renders for BOTH place fallback AND night-out branches (it's outside the night-out conditional). Spec writer must decide whether `EventDetailLayout` keeps the same `<ImageGallery>` component or builds a new hero-poster pattern.

### §3.5 Per-mount-surface delta inventory (per dispatch §C.5)

8-row table — every mount site read; props captured verbatim:

| # | Surface | File:line | visible | card | onClose | onSave | onShare | onPurchase | isSaved | currentMode | accountPreferences | userPreferences | onCardRemoved | onPaywallRequired | onScheduleSuccess | onOpenBrowser | onNavigateNext / onNavigatePrevious | onStrollDataFetched / onPicnicDataFetched | canAccessCurated | navigationIndex / navigationTotal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Chat-shared | [MessageInterface.tsx:1523](../../app-mobile/src/components/MessageInterface.tsx#L1523) | `showExpandedCardFromChat` | `expandedCardFromChat` | clears state | `handleSaveSharedCard` | — | — | `sharedCardIsSaved` | `"solo"` | — | — | — | — | — | — | — | — | — | — |
| 2 | Discover deck | [DiscoverScreen.tsx:1385](../../app-mobile/src/components/DiscoverScreen.tsx#L1385) | `isExpandedModalVisible` | `selectedCardForExpansion` | `handleCloseExpandedModal` | inline async (`saveCard` + `invalidateQueries` + Haptics) | `() => {}` (no-op stub) | — | `savedCardIds.has(...)` | `"solo"` | yes | — | — | — | — | — | yes (review-flow) | — | — | yes (`expandedCardIndex` + `expandedCardListRef.current.length`) |
| 3 | Saved tab | [SavedTab.tsx:2145](../../app-mobile/src/components/activity/SavedTab.tsx#L2145) | `isModalVisible` | `selectedCardForModal` | `handleCloseModal` | `handleModalSave` | `handleModalShare` | `handleModalPurchase` | `true` (always) | — | — | `userPreferences` | — | yes (paywall flow) | — | — | — | yes (Stroll + Picnic) | yes | — |
| 4 | Calendar | [CalendarTab.tsx:1866](../../app-mobile/src/components/activity/CalendarTab.tsx#L1866) | `isExpandedModalVisible` | `selectedCardForExpansion` | `handleCloseExpandedModal` | `handleSaveFromModal` | `handleShareFromModal` | `handlePurchaseFromModal` | `true` (always) | conditional `"solo" \| "collaboration"` (per calendarEntries source lookup) | — | `userPreferences` | — | yes (paywall flow) | — | — | — | — | yes | — |
| 5 | Friend profile | [ViewFriendProfileScreen.tsx:473](../../app-mobile/src/components/profile/ViewFriendProfileScreen.tsx#L473) | `!!expandedCard` | `expandedCard` | clears state | inline async (`handleSaveCard`) | `() => {}` (stub) | — | `false` (always) | `"solo"` | hardcoded `{ currency: 'USD', measurementSystem: 'Imperial' }` | — | — | — | — | — | — | — | — | — |
| 6 | Collab session | [SessionViewModal.tsx:848](../../app-mobile/src/components/SessionViewModal.tsx#L848) | `isExpandedModalVisible` | `selectedCardForExpansion` | clears state | `async () => {}` (no-op — already in board) | inline (sets `shareData` + opens `ShareModal`) | — | `true` (always) | `localName \| "board"` | yes | — | — | — | — | — | — | — | — | — |
| 7 | Solo deck (review/dismissed) | [SwipeableCards.tsx:1926](../../app-mobile/src/components/SwipeableCards.tsx#L1926) | `isExpandedModalVisible` | `selectedCardForExpansion` | `handleCloseExpandedModal` | inline (collab routing + Mixpanel + close) | inline (`onShareCard?.(card)`) | inline (`onPurchaseComplete?.(card, bookingOption)`) | `savedCards.some(...)` lookup | `currentMode` (prop) | yes | `userPreferences` | — | — | — | — | yes (review-flow) | — | — | — |
| 8 | Collab deck | [SwipeableCards.tsx:2452](../../app-mobile/src/components/SwipeableCards.tsx#L2452) | `isExpandedModalVisible` | `selectedCardForExpansion` | `handleCloseExpandedModal` | inline (advance deck + handleSwipe + collab routing) | inline | inline | same lookup | `currentMode` | — | — | yes (`cardId => removedCards.add` + advance deck) | — | — | — | — | — | — | — |

**Per-surface variations to preserve:**

- **Chat-shared (1)** — uses `currentMode="solo"` literal + the `handleSaveSharedCard` deduplication wrapper. The `notifications` Modal hack at [MessageInterface.tsx:1538-1554](../../app-mobile/src/components/MessageInterface.tsx#L1538-L1554) is the Shape 2a load-bearing for toast visibility above the modal — see §4.D-3 (becomes obsolete post-conversion per design §E-3.3 prediction).
- **Discover deck (2) + Solo deck (7)** — both pass review-flow props (`navigationIndex/navigationTotal/onNavigateNext/onNavigatePrevious`). The `<ExpandedCardHeader>` review-nav row at [`:1556-1579`](../../app-mobile/src/components/ExpandedCardModal.tsx#L1556-L1579) renders only when `hasNavigation && navigationTotal != null && navigationIndex != null` — which means D-3 (retire ExpandedCardHeader entirely?) needs the `reviewNavBar` to survive. Header itself can retire; `reviewNavBar` is a separate inline JSX block that just happens to follow the header.
- **Saved tab (3) + Calendar (4)** — both pass `canAccessCurated` + `onPaywallRequired` for the curated experience paywall flow. Critical: paywall callback closes modal first, then surfaces paywall — no race conditions to preserve.
- **Saved tab (3)** — only surface that passes `onStrollDataFetched/onPicnicDataFetched`. These handlers update parent state to remember fetched stroll/picnic data across modal closes. Spec writer must confirm `EventDetailLayout` doesn't break this — it shouldn't (event cards never have stroll/picnic data).
- **Friend profile (5)** — hardcodes `accountPreferences={{currency:'USD',measurementSystem:'Imperial'}}`. **🟡 HIDDEN FLAW (preexisting, out-of-scope):** users in non-USD locales viewing friend profiles see USD prices. Discovered, registered as orchestrator-side issue (see §10).
- **Friend profile (5)** — passes `isSaved={false}` always. If user has already saved a card and views it via friend profile, the modal shows "Save" button when it should show "Saved." **🟡 HIDDEN FLAW (preexisting, out-of-scope):** Pattern F precedent from ORCH-0685 — `isSaved` not derived from query cache. Discovered, registered as orchestrator-side issue (see §10).
- **Collab session (6)** — `onSave` is `async () => {}` no-op (cards on collab board are already saved). New design's Save chip needs to either be hidden in this surface OR call a no-op cleanly. Spec writer must specify.
- **Collab deck (8)** — uses `onCardRemoved` to advance deck on Schedule. New event design has no Schedule action (per OQ-5), so `onCardRemoved` is event-irrelevant. But place-branch on this surface still uses it, and event-branch in this surface doesn't fire `onCardRemoved` ever — no break.

**Conclusion of §3.5:** all 8 sites pass at least `visible + card + onClose`. None overrides chrome. Single source of truth for chrome change is preserved by design. The Save+Share+Purchase callback shapes vary but don't intersect with chrome.

---

## §4 Phase 2 — Dead code enumeration

### §4.D-1 Style entries unused after redesign

Per dispatch §D.1, grep for callers outside `ExpandedCardModal.tsx`:

```
styles.overlay   → 0 callers outside ExpandedCardModal.tsx (confirmed via Grep)
styles.overlayBackground   → 0 callers outside ExpandedCardModal.tsx
styles.modalContainer   → 0 callers outside ExpandedCardModal.tsx
nightOutStyles.stickyButtonContainer / .stickyButtonRow / .getTicketsButton / .getTicketsText / .shareButton → 0 callers outside ExpandedCardModal.tsx
```

**🔵 DELETION list (post-redesign):**
- `styles.overlay` ([`:2410-2415`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2410-L2415))
- `styles.overlayBackground` ([`:2416-2422`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2416-L2422))
- `styles.modalContainer` ([`:2423-2436`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2423-L2436))
- `nightOutStyles.stickyButtonContainer` ([`:2323-2333`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2323-L2333))
- `nightOutStyles.stickyButtonRow` ([`:2334-2338`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2334-L2338))
- `nightOutStyles.getTicketsButton` ([`:2339-2352`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2339-L2352))
- `nightOutStyles.getTicketsText` ([`:2353-2358`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2353-L2358))
- `nightOutStyles.shareButton` ([`:2359-2371`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2359-L2371))

Aggregate: ~75 LOC deletable on chrome+sticky-CTA conversion.

### §4.D-2 Hardcoded color values across modal sub-sections

Across the 13 files in `app-mobile/src/components/expandedCard/`, audit counted **77+ hardcoded color values** that match light-mode patterns (subset shown):

| File | Hardcoded color count | Sample |
|---|---|---|
| `ActionButtons.tsx` | ~38 (lines 949-1247) | `#ffffff` bg, `#111827` title, `#6b7280` muted, `#374151` body, `#fff7ed` accent bg, `#9a3412 / #ea580c` orange shades, `#fef2f2 / #fef3e2` warning tints, `#22c55e / #15803d / #ef4444 / #1f2937 / #6366F1` action colors |
| `BusynessSection.tsx` | ~7 | `#fef7f0` card bg, `#fff7ed` chip bg, `#78350f / #c2410c / #ea580c` text shades, `#ebe6e7` track, `#eb7825` fill |
| `CardInfoSection.tsx` | ~8 (lines 176-238) | `#111827` title, `#d97706` rating star color, `#6b7280` muted ×2, `#fff7ed` price chip bg, `#fed7aa` price chip border, `#92400e / #374151 / #9CA3AF` text shades |
| `CompanionStopsSection.tsx` | ~13 (lines 149-243) | `#ffffff` card bg, `#111827` title, `#6b7280` body, `#f9fafb / #e5e7eb` placeholder, `#fef3e2 / #eb7825` accent, ×3 muted shades |
| `DescriptionSection.tsx` | ~4 (lines 63-82) | `#ffffff` bg, `#111827` title, `#374151` body, `#eb7825` accent |
| `ExpandedCardHeader.tsx` | ~3 (lines 34-44) | `#ffffff` header bg, `#f3f4f6` close button bg, `#6b7280` close icon color |
| `HighlightsSection.tsx` | ~5 (lines 57-93) | `#ffffff` bg, `#111827` title, `#fef3e2 / #fed7aa` chip bg+border, `#eb7825` chip text |
| `ImageGallery.tsx` | ~7 (lines 163-226) | `#000000` lightbox bg, `#f3f4f6` placeholder bg, `#6b7280 / #ffffff` icons, `rgba(0,0,0,0.6) / rgba(255,255,255,0.3)` overlays |
| `MatchFactorsBreakdown.tsx` | ~5 (lines 166-260) | `#ffffff` bg, `#111827` title, `#e5e7eb` track, `#6b7280` muted |
| `PracticalDetailsSection.tsx` | ~5 (lines 102-145) | `#fef7f0` bg ×2, `#fff7ed` accent, `#374151` body ×2 |
| `StopImageGallery.tsx` | ~3 (lines 156-196) | `#f3f4f6` placeholder ×2, `#ffffff` |
| `TimelineSection.tsx` | ~12 | (sample only — full enumeration in spec phase) |
| `WeatherSection.tsx` | ~1 | (minimal; light-bg pattern but compact) |

**🟠 DIVERGES — needs change:** every entry above must remap to a dark-on-dark equivalent per design §E-4.4. Implementor effort estimate per file: ~5-15 min token swap depending on density. Aggregate: **~3 hours** (matches design §E-12.5 estimate). High regression risk if any file is missed — tester must visually verify every place-rendering mount surface (5 of 8 surfaces).

### §4.D-3 Shape 2a Modal block in MessageInterface.tsx

Confirmed at [MessageInterface.tsx:1538-1554](../../app-mobile/src/components/MessageInterface.tsx#L1538-L1554) — verbatim:

```tsx
{/* Mount notifications above the chat-shared ExpandedCardModal portal: RN
    Modal portals over sibling Views regardless of zIndex/elevation, so a
    second transparent Modal is the only way to surface toasts on top.
    pointerEvents="box-none" lets taps pass through to the underlying modal. */}
{showExpandedCardFromChat && notifications.length > 0 && (
  <Modal
    visible={true}
    transparent={true}
    animationType="fade"
    presentationStyle="overFullScreen"
    onRequestClose={() => { /* no-op — auto-dismiss handles cleanup */ }}
  >
    <View style={styles.notificationsContainer} pointerEvents="box-none">
      {notifications.map((notification) => renderNotificationCard(notification, true))}
    </View>
  </Modal>
)}
```

Once `<ExpandedCardModal>` stops using native `<Modal>` (replaced by `<BottomSheet>` which is an Animated View), the toast Modal hack becomes obsolete. **🔵 DELETE** in IMPL.

**NEEDS-LIVE-FIRE caveat:** designer §E-3.3 predicts toasts render naturally above bottom sheet via React-tree z-ordering. This is **architecturally correct** (BottomSheet from `@gorhom/bottom-sheet` is `Animated.View`, not native Modal portal — siblings with higher tree position will paint over it). But it has not been runtime-verified on a device. Tester must verify on iOS + Android: toast appears above sheet on chat-shared mount post-redesign. Confidence: HIGH-architectural / MEDIUM-runtime.

### §4.D-4 Schedule action for events

`<ActionButtons>` at [`:2021-2043`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2021-L2043) is gated to the `else` (place fallback) branch — it never renders for events under current code. Under new design's render branching contract `if (isEvent) return EventDetailLayout` — `<ActionButtons>` will continue to never render for events. The internal `handleSchedule` handler in `ActionButtons.tsx` is therefore **structurally unreachable for events** under both old AND new code. Not deletion candidate (place branch still uses it). Mark as design-intent — out of redesign scope.

### §4.D-5 Existing nightOutStyles StyleSheet block

Block at [`:2132-2388`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2132-L2388) — 256 LOC.

**Survives in new EventDetailLayout (token re-mapped):**
- `directionsButton`, `directionsText` — Address-row "Open in Maps" link (per design §E-5.2 When & Where)
- `venueAddress` — text reused for address row body
- (potentially) `divider` — section divider concept reused; tokens flip
- (potentially) `sectionTitle` — reusable title style; tokens flip

**Obsoleted by new event IA:**
- `infoCardsRow`, `infoCard`, `infoCardHeader`, `infoCardLabel`, `infoCardPrimary`, `infoCardSecondary`, `infoCardPrice` — replaced by meta row + above-fold CTA pattern
- `goingBadge`, `goingText` — never visible currently (unrendered today; verify with grep `goingBadge` — appears unused entirely; flag for deletion)
- `categoryHostRow`, `categoryText`, `dotSep`, `hostText` — replaced by venue · date · time meta row pattern
- `tagsRow`, `vibeBadge`, `vibeBadgeText` — replaced by Tags section chip pattern
- `musicGenreContainer`, `musicGenreHeader`, `musicGenreLabel`, `musicGenreValue` — appear unused entirely (no JSX consumer found in lines 1653-1774); flag for deletion
- `ticketStatusBadge`, `ticketStatusText` — moved into Get Tickets CTA itself (status-aware label)
- `venueCard`, `venueIconRow`, `venueIcon`, `venueDetails`, `venueName` — replaced by When & Where address row pattern
- `stickyButtonContainer`, `stickyButtonRow`, `getTicketsButton`, `getTicketsText`, `shareButton` — already covered in §4.D-1

**🔵 DELETION list — entries to remove or refactor:** approximately 18 of the 28 nightOutStyles entries. Net deletion ~150-180 LOC. Spec writer locks the exact migration list.

**Audit grep verification of suspected unused entries (`goingBadge`, `musicGenreContainer/...`):** within ExpandedCardModal.tsx scope, no JSX references to these styles exist in the night-out branch (1653-1774). They appear to be legacy from earlier iterations. Spec writer / implementor confirms in IMPL phase.

---

## §5 Phase 3 — Per-finding classification + critique

### §5.1 🔴 ROOT CAUSES

NONE in the bug sense — this is a redesign audit, not a defect audit. The current modal is functional but design-quality-deficient (centered light-card chrome doesn't match the rest of the app's dark glass language; place-derived event IA inherits hardcoded values that aren't event-optimized). All findings classify as 🟠 / 🟡 / 🔵 — no production "bug" root cause to fix.

### §5.2 🟠 DIVERGES — needs change (six-field anchored)

| ID | Finding | File:line | Current | Design target | Effort | Verification |
|---|---|---|---|---|---|---|
| **F-01** | Modal wrapper | `ExpandedCardModal.tsx:1537-1542` | `<Modal animationType="fade" transparent>` | `<BottomSheet ref index={1} snapPoints={['50%','90%']} enablePanDownToClose>` | ~25-line swap + 2 imports | Open modal from any of 8 mount sites; verify slide-up animation, drag handle visible, drag-to-dismiss works | LOW (single file) |
| **F-02** | Backdrop scrim color + blur | `ExpandedCardModal.tsx:2410-2415` (`styles.overlay.backgroundColor: 'rgba(0,0,0,0.5)'`) | `rgba(0,0,0,0.55)` + `BlurView intensity={12}`; reduced-transparency fallback `rgba(0,0,0,0.85)` | ~15 LOC change (swap to `BottomSheetBackdrop` with custom render) | Visual: scrim is darker + blurred when sheet is open | LOW |
| **F-03** | Sheet container chrome | `ExpandedCardModal.tsx:2423-2436` (`styles.modalContainer` — centered card pattern) | Full-width bottom-attached, `bg: rgba(12,14,18,1)`, `borderTopLeftRadius: 28, borderTopRightRadius: 28`, top hairline | DELETE entire `styles.modalContainer`; replaced by `<BottomSheet backgroundStyle>` prop | Visual: dark sheet rises from bottom, not centered card | LOW |
| **F-04** | Drag handle missing | NONE today | 36×4pt rounded pill via `handleIndicatorStyle` prop | Single-prop addition to `<BottomSheet>` | Visual: white pill visible at top of sheet | LOW |
| **F-05** | Sticky bottom CTA | `ExpandedCardModal.tsx:2049-2079` | Above-fold position in event peek per design §E-5.1 | DELETE 31 LOC sticky CTA + add `<EventDetailLayout>` containing CTA above fold | Visual: CTA appears in peek state, not at bottom | MEDIUM (depends on EventDetailLayout) |
| **F-06** | Inner ScrollView | `ExpandedCardModal.tsx:1582-1586` | `<BottomSheetScrollView>` from `@gorhom/bottom-sheet` (mandatory — gestures fight otherwise) | 1-import swap + JSX rename | Functional: scroll inside sheet works without fighting drag-to-dismiss gesture | LOW (mandatory; no choice) |
| **F-07** | Night-out content layout | `ExpandedCardModal.tsx:1653-1774` (122 LOC inline in `nightOutStyles.container`) | Build new `<EventDetailLayout>` per design §E-5 IA — hero poster, artist accent, above-fold CTA, secondary chip row, About/When&Where/Tags/Seat-Map below fold | Extract to new file `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` (~280 LOC); IMPL-time effort ~3h | Visual: poster hero + artist orange + sticky CTA gone + secondary chips visible | HIGH (largest single chunk) |
| **F-08** | Sub-component dark token re-map | 13 files in `app-mobile/src/components/expandedCard/` (~77 hardcoded values) | Each light-mode value → dark-on-dark per design §E-4.4 | Token swap pass; ~3h aggregate IMPL | Visual: every section reads cleanly on dark sheet bg (white-ish text, transparent-glass cards, orange accents preserved) | HIGH (regression risk) |
| **F-09** | Review nav bar tokens | `ExpandedCardModal.tsx:1556-1579` + `styles.reviewNavBar` (`#f9fafb` bg, `#f3f4f6` border, `#6b7280` counter) | Re-map: `bg: rgba(255,255,255,0.05)`, `border: rgba(255,255,255,0.10)`, `counter: rgba(255,255,255,0.70)` | ~5-line change | Visual: review nav row reads on dark bg | LOW |
| **F-10** | Save heart absent on event modal | `ExpandedCardModal.tsx:1653-1774` (no Save UI) | Add Save chip in `<EventDetailLayout>` secondary action row per design §E-5.1 + OQ-4 (always shown) | ~10 LOC + wire to existing `onSave` prop | Visual: Save chip visible in secondary row; toggles on tap | LOW |
| **F-11** | Add to Calendar action absent | `ExpandedCardModal.tsx` (no Add-to-Calendar UI for events) | Add chip per design §E-5.1 + OQ-1 native calendar via `expo-calendar` | ~30 LOC (UI + handler invoking `Calendar.createEventAsync`) | Functional: tap → native calendar app opens with prefilled event | MEDIUM |
| **F-12** | OQ-6 token namespace missing | `designSystem.ts` has no `bottomSheet` sub-namespace | Add `glass.bottomSheet.{handle, scrim, hairline, topRadius}` per design §H-Tokens; retrofit `MapBottomSheet.tsx` + `PersonBottomSheet.tsx` to consume | New sub-namespace + 2 file updates | Run app; both reference sheets render identical chrome to new ExpandedCardModal | LOW |
| **F-13** | MessageInterface Shape 2a Modal hack | `MessageInterface.tsx:1538-1554` | DELETE block — toasts render naturally above `@gorhom/bottom-sheet` (Animated View, not native Modal) | ~17 LOC deletion + cleanup of `renderNotificationCard(notification, true)` second-mount logic if used only here | NEEDS-LIVE-FIRE: send a chat card share + open it + tap Save → toast must appear above sheet on iOS + Android | LOW deletion / MEDIUM verification |

### §5.3 🟡 DIVERGES — preserves intentionally

| ID | Finding | Why preserved |
|---|---|---|
| **F-14** | `<ImageGallery>` reused (not replaced by hero poster pattern) | Designer §E-6 places ordering preserved. `ImageGallery` survives for place branch unchanged. EventDetailLayout may build its own hero block but `ImageGallery` isn't deleted — used in place branch via line 1638. |
| **F-15** | `<ExpandedCardHeader>` (potentially retired vs preserved for review-flow) | Design D-3 — header may stay for review-flow nav (Discover deck + Solo deck pass `navigationIndex/navigationTotal`). Spec writer decides: retire entirely vs preserve in expanded-snap-point-only with re-mapped tokens. Audit recommends preserve the header conditionally for review-flow surfaces only; chrome role goes to drag handle. |
| **F-16** | `cardType === 'event'` parallel branch trigger | Design §E-7 includes it as forward-looking guard. Today no card has `cardType === 'event'` set (grep returns 0 matches). Keep in branching code as defensive — costs nothing, safer if future code paths plumb it. |
| **F-17** | Place IA section ORDERING (Phase 3.4 enumeration) | Design §E-6 explicit preservation. Spec writer locks the 11-step ordering verbatim; implementor cannot reorder, add, remove. |

### §5.4 🔵 DEAD CODE (safely deletable)

| ID | Item | Lines | Net delete |
|---|---|---|---|
| **F-18** | `styles.overlay`, `styles.overlayBackground`, `styles.modalContainer` | `:2410-2436` | ~27 LOC |
| **F-19** | nightOutStyles sticky CTA cluster (`stickyButtonContainer/Row, getTicketsButton, getTicketsText, shareButton`) | `:2323-2371` | ~49 LOC |
| **F-20** | nightOutStyles obsolete entries (`infoCardsRow / infoCard*, goingBadge*, categoryHostRow*, dotSep, hostText, tagsRow, vibeBadge*, musicGenreContainer*, ticketStatusBadge*, venueCard*, venueIconRow, venueIcon, venueDetails, venueName`) | within `:2132-2388` block | ~140 LOC (estimate; spec writer locks exact list) |
| **F-21** | Shape 2a Modal hack | `MessageInterface.tsx:1538-1554` | ~17 LOC |
| **F-22** | Inline place-fallback `<TouchableOpacity style={styles.overlayBackground}>` JSX | `ExpandedCardModal.tsx:1544-1548` | ~5 LOC |

Aggregate delete: **~238 LOC** removable post-redesign. Net code delta after additions (+EventDetailLayout ~280 LOC, +new chrome ~30 LOC, +token swaps ~110 LOC) = **+182 LOC net** (matches §1 estimate of +500/-350).

---

## §6 Five-truth-layer reconcile

| Layer | Verified | Status |
|---|---|---|
| **Docs** | Designer spec §E-1..§E-12 read in full; this audit's targets reference design sections by E-N number | ✅ aligned |
| **Schema** | N/A — modal is mobile-only; no DB shapes touched | ✅ N/A |
| **Code** | All findings file:line-anchored against current code as of this commit | ✅ verified |
| **Runtime** | Designer §E-3.3 prediction ("toasts render naturally above `@gorhom/bottom-sheet`") is architecturally correct (BottomSheet is Animated.View not Modal portal) but UNVERIFIED on device | 🟡 NEEDS-LIVE-FIRE — must verify on iOS + Android post-IMPL via tester smoke |
| **Data** | N/A — modal renders client-side from props | ✅ N/A |

No layer contradictions found. Designer's runtime predictions are architecturally well-founded but require device verification — explicitly labelled.

---

## §7 Risk surface for IMPL (top 5)

Extending designer §E-12 risk areas:

1. **Place layout dark-token re-mapping (F-08).** 13 sub-components × ~5-15 token swaps each. Easy to miss one and ship a bright-white card on a dark sheet. Tester must verify every place-rendering mount surface (5 of 8). HIGH IMPACT, MEDIUM PROBABILITY.

2. **Bottom-sheet gesture conflicts with inner scroll (F-06).** `@gorhom/bottom-sheet` requires `BottomSheetScrollView` not `<ScrollView>`. Implementor MUST replace, not just wrap. If missed: scroll content scrolls AND drags sheet simultaneously, creating fight gestures. CRITICAL. HIGH IMPACT, LOW PROBABILITY (pattern is well-documented + reference sheets exist).

3. **Toast stacking on chat-shared mount (F-13).** Designer predicts the Shape 2a Modal hack becomes obsolete. If runtime contradicts (toasts hidden below sheet despite z-ordering): user can't see Save success after tapping Save in chat-shared mount → reverts to ORCH-0685 cycle-2 dead-tap class of bug. **NEEDS-LIVE-FIRE smoke test mandatory before deleting the hack.** HIGH IMPACT, LOW PROBABILITY.

4. **Per-mount-surface delta preservation (§3.5).** 8 surfaces have varying prop shapes. The chrome swap is single-source-of-truth (good); the per-surface callback shapes vary widely (risky). E.g., Calendar's `currentMode` is computed via lookup — if the new `EventDetailLayout` re-renders that lookup prematurely, perf degrades. Spec writer must confirm `EventDetailLayout` doesn't run additional hooks that the place branch doesn't. MEDIUM IMPACT, LOW PROBABILITY.

5. **`<ExpandedCardHeader>` retire decision (F-15).** Designer D-3 leaves this open. If retired entirely: review-flow loses the `<View style={styles.headerSpacer}>` symmetry, may visually break the review nav row alignment. Spec writer locks; tester verifies on review-flow surfaces (Discover deck + Solo deck). LOW IMPACT, MEDIUM PROBABILITY.

---

## §8 Confidence summary per finding

| Class | Findings | Confidence |
|---|---|---|
| 🔴 Root causes | 0 | N/A |
| 🟠 Diverges-needs-change (chrome / IA / token swaps) | F-01 through F-12 | HIGH (code-deterministic) |
| 🟠 F-13 (Shape 2a delete) | 1 | HIGH-architectural / MEDIUM-runtime — NEEDS-LIVE-FIRE |
| 🟡 Diverges-preserves | F-14 through F-17 | HIGH |
| 🔵 Dead code | F-18 through F-22 | HIGH (zero callers verified via grep) |

Overall investigation confidence: **HIGH** — every finding has file:line + verbatim code + design-target reference. Only F-13 is partially HIGH-architectural / MEDIUM-runtime; mitigated by mandatory live-fire smoke gate before deleting the Shape 2a hack.

---

## §9 OQ-derived constraint validation

Per dispatch §H — audit verifies:

| OQ | Locked value | Audit confirmation |
|---|---|---|
| OQ-1 | Add to Calendar = native via `expo-calendar` | ✅ `expo-calendar@~15.0.8` present in `app-mobile/package.json:41`. No blocker. |
| OQ-2 | Get Tickets = in-app browser | ✅ `InAppBrowserModal.tsx` exists at `app-mobile/src/components/`. Already imported and used by ExpandedCardModal at lines 48 + 2084-2098. No additional dependency. |
| OQ-3 | Sold-out CTA = disabled with label | ✅ Current code already supports `nightOut.ticketStatus === "offsale"` branch at [`:2063-2068`](../../app-mobile/src/components/ExpandedCardModal.tsx#L2063-L2068) — disabled gray bg `'#666'` + label `t('cards:expanded.sold_out')`. Design §E-5.6 changes the bg color to per-design palette and matches existing pattern semantically. |
| OQ-4 | Save heart shows on past events | ✅ No code path filters past events from save. `savedCardsService.saveCard(card)` is called regardless of `card.localDate`. New design adds Save chip — no existing filter to remove. |
| OQ-5 | Action set: `[Get Tickets, Save, Share, Add to Calendar]` only | ✅ No event-specific code expects Schedule/Visit/Policies&Reservations. Those are place-only via `<ActionButtons>` which is gated to the place fallback branch. New EventDetailLayout owns its own action set; no conflict. |
| OQ-6 | New `glass.bottomSheet.*` tokens + retrofit MapBottomSheet/PersonBottomSheet | ✅ Both files use `@gorhom/bottom-sheet`. Migration list: `MapBottomSheet.tsx:122` (`#d1d5db` handle) + `:128-129` (`#FFF` bg + `borderTopLeftRadius: 20`); `PersonBottomSheet.tsx:177-178` (same pattern: `#d1d5db` handle, `#FFF` bg, `borderTopLeftRadius: 20`). Spec writer locks migration. **CORRECTION TO DESIGNER:** ProposeDateTimeModal does NOT use `@gorhom/bottom-sheet` — it's a native `<Modal>`. Designer's note that it was a third candidate is incorrect. Only 2 sheets retrofit, not 3. |

All 6 OQ resolutions verified implementable.

---

## §10 Discoveries for orchestrator

Side issues found during audit, OUT OF ORCH-0696 scope but registered for later triage:

1. **D-OBS-1 (preexisting, MEDIUM):** `ViewFriendProfileScreen.tsx:484` hardcodes `accountPreferences={{ currency: 'USD', measurementSystem: 'Imperial' }}`. Users in non-USD locales viewing friend profiles see USD prices on cards. This is the same currency-handling class as ORCH-0670 CF-2. Recommend: orchestrator registers as new ORCH or folds into ORCH-0670 Slice B currency cleanup.

2. **D-OBS-2 (preexisting, MEDIUM):** `ViewFriendProfileScreen.tsx:482` passes `isSaved={false}` always — modal renders "Save" even if user has already saved this card via another surface. Same Pattern F class as ORCH-0685 (`isSaved` not derived from query cache). Recommend: orchestrator registers as new ORCH (S2) or folds into a future "isSaved derivation parity" cleanup that audits all 8 mount sites for the same drift.

3. **D-OBS-3 (architectural HIDDEN, LOW):** ExpandedCardModal imports `<MatchFactorsBreakdown>`, `<DescriptionSection>`, `<HighlightsSection>`, `<StopImageGallery>`, `<ImageLightbox>` ([`:35-46`](../../app-mobile/src/components/ExpandedCardModal.tsx#L35-L46)) but the place fallback branch at lines 1775-2045 does NOT render any of them. Spec writer should grep within `<CardInfoSection>` to confirm whether they're composed there. If unreferenced anywhere in the modal's render path, they're dead imports + dead components. Action: audit during spec phase; if confirmed dead, delete imports + flag components for deletion.

4. **D-OBS-4 (legacy CSS, LOW):** Several `nightOutStyles` entries (`goingBadge / goingText`, `musicGenreContainer / musicGenreLabel / musicGenreValue`) appear unreferenced in current night-out branch JSX. Audit could not find consumers within `:1653-1774`. Likely dead from earlier iterations. Spec writer/implementor verifies + deletes during IMPL.

5. **D-OBS-5 (CardInfoSection composition unknown):** The current modal mounts `<CardInfoSection>` for ALL place cards including Stroll/Picnic/Nature subtypes. New design §E-6 says "place IA section ordering preserved" but `<CardInfoSection>` itself may compose `<DescriptionSection>` + `<HighlightsSection>` + `<RatingDisplay>` internally — i.e., the "preserved sections" may live INSIDE one component, not be 11 sibling sections. Audit did not enumerate `CardInfoSection.tsx` lines 1-300+. Spec writer must read `CardInfoSection.tsx` in full to lock the actual section structure before claiming "preserved."

6. **D-PROC-1 (process invariant — already codified per ORCH-0670):** Audit confirms the render-first-not-code-first rule is essential here. Designer §E-3.3 stated "ProposeDateTimeModal" was a third bottom-sheet candidate — code grep proves it's a native `<Modal>`. This is the same class as ORCH-0670 stale-claim where designer's spec made an unverified architectural claim. Audit corrected the record. Recommend orchestrator add this to the design-spec-acceptance gate: "Every architectural claim about existing code MUST be grep-verified before designer hands off."

---

## §11 Spec writer handoff notes

What the design + this audit didn't already lock — the spec writer must address:

1. **F-15 ExpandedCardHeader fate** — retire entirely OR preserve for review-flow only? Audit recommends: retain conditionally on `hasNavigation && navigationTotal != null && navigationIndex != null` (i.e., review-flow surfaces only — Discover deck + Solo deck), retire on all other surfaces. Drag handle owns chrome role universally.

2. **D-OBS-3 confirmation** — read `CardInfoSection.tsx` in full to determine whether the listed "place IA preserved" sections are siblings or compose inside `<CardInfoSection>`. Affects sub-component scope of token re-mapping.

3. **Exact deletion list for nightOutStyles** — audit identified ~18 candidates but spec writer must lock the verbatim list per IMPL deliverable. Implementor cannot guess.

4. **`reviewNavBar` token re-map values** — design §E-4.4 covers section dividers + body text but doesn't specify the review-nav-row's chevron + counter colors against dark bg. Spec writer locks per design §E-4 token table extension.

5. **Per-surface chrome verification matrix for tester** — 8 mount surfaces × iOS + Android = 16 visual tests. Spec writer's test cases section must enumerate all 16 with expected outcomes.

6. **F-13 NEEDS-LIVE-FIRE gate** — spec writer must include explicit success criterion: "Toast appears above bottom sheet on chat-shared mount (MessageInterface) on iOS AND Android — verified by tester live-device smoke; until verified, the Shape 2a Modal hack at MessageInterface.tsx:1538-1554 cannot be deleted." This protects against ORCH-0685 cycle-2 dead-tap regression class.

7. **D-OBS-5 CardInfoSection enumeration** — spec writer reads CardInfoSection.tsx in full and either confirms section-ordering claim or amends the deletion/preservation list.

8. **OQ-6 retrofit migration list** — spec writer locks: `MapBottomSheet.tsx:122` + `:128-129`; `PersonBottomSheet.tsx:177-178`. Both files ~3-line edits. Designer's "3 sheets" claim corrected to "2 sheets" + native `<Modal>` ProposeDateTimeModal noted as out-of-scope.

---

## §12 Confidence + final recommendation

**Investigation confidence: HIGH.** Every finding code-anchored. Only F-13 (Shape 2a delete) carries MEDIUM runtime prediction confidence; mitigated by mandatory live-fire gate.

**Design implementable as-is: YES.** No blockers. Two minor designer corrections (3-sheet → 2-sheet retrofit; ProposeDateTimeModal not a candidate) noted for spec writer.

**Recommendation to orchestrator:** dispatch spec writer with this audit + the designer spec. Spec writer's primary tasks:
1. Lock the deletion list per F-18..F-22.
2. Lock `EventDetailLayout` API + props + rendered IA per design §E-5.
3. Lock per-sub-component token swap list (13 files × N values) per F-08.
4. Lock OQ-6 retrofit migration list (2 sheet files).
5. Resolve the spec writer handoff notes §11.1-§11.8.
6. Define mandatory live-fire gate for F-13.
7. Define 16 tester smoke checks (8 surfaces × 2 platforms).

Estimated spec wall: ~1.5-2 hours per design §E-12.

**Implementation effort estimate (extending designer):**
- Bottom-sheet chrome swap: ~1.5h (F-01 through F-06 + F-09)
- New EventDetailLayout component: ~3h (F-07 + F-10 + F-11)
- Sub-component dark token re-map: ~3h (F-08; highest regression risk)
- Token namespace + retrofit: ~1h (F-12 + 2 sheet files)
- Shape 2a Modal hack delete + live-fire verification: ~30m (F-13)
- 8-surface verification + tsc + report: ~1h
- **Total IMPL wall: ~10h** (matches design §E-12 mid-range estimate)

End of investigation report.
