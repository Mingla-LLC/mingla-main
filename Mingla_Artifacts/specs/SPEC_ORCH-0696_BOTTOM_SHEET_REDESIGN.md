# SPEC — ORCH-0696 ExpandedCardModal bottom-sheet redesign + EventDetailLayout

**Spec writer:** mingla-forensics (SPEC mode)
**Date:** 2026-04-29
**ORCH-ID:** ORCH-0696
**Severity:** S2 — design-quality + cross-surface UX consistency
**Predecessors:**
- Designer: [`specs/DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md`](DESIGN_ORCH-0696_EXPANDED_EVENT_MODAL.md) — REVIEW APPROVED 10/10
- Forensics audit: [`reports/INVESTIGATION_ORCH-0696_RENDER_FIRST_AUDIT.md`](../reports/INVESTIGATION_ORCH-0696_RENDER_FIRST_AUDIT.md) — REVIEW APPROVED 10/10
- ORCH-0698 closed `2026-04-29`: `app-mobile/src/components/map/` deleted entirely
- Dispatch: [`prompts/SPEC_ORCH-0696_BOTTOM_SHEET_REDESIGN.md`](../prompts/SPEC_ORCH-0696_BOTTOM_SHEET_REDESIGN.md)

---

## §1 Layman summary

Convert the centered floating ExpandedCardModal into a bottom sheet with dark glass-aligned chrome. Build a new `EventDetailLayout` for Ticketmaster events (poster hero / artist orange accent / above-fold Get Tickets CTA / secondary chip row / About / When & Where / Tags / Seat Map). Place IA section ordering preserved unchanged — only token mapping flips dark. Single chrome change cascades to all 8 mount surfaces because none passes a presentation override.

This spec resolves all 8 audit handoff items (§B.3 of dispatch). Implementable in ~10 hours per design §E-12. F-13 NEEDS-LIVE-FIRE gate is encoded as binding SC-20 — Shape 2a Modal hack at `MessageInterface.tsx:1538-1554` deletion is GATED by tester confirmation that toasts render above bottom sheet on chat-shared mount on iOS AND Android.

**Key audit-resolution outcomes baked in:**
- D-OBS-3 + D-OBS-5 RESOLVED: `DescriptionSection`, `HighlightsSection`, `MatchFactorsBreakdown` are 3 dead component files + 3 dead imports. Spec writer read CardInfoSection.tsx in full and confirmed: it composes NONE of those 5 sub-components. Place IA section ordering (per audit §3.4) lists 11 entries — none of the 3 dead ones. Therefore: 3 additional dead files to delete; sub-component dark-token re-map shrinks from 13 → 10 files.
- F-15 ExpandedCardHeader: spec locks audit's recommendation — retain conditionally on `hasNavigation` review-flow surfaces only (Discover deck + Solo deck), retire on all other 6 surfaces. Drag handle owns chrome role universally.
- OQ-6 retrofit: ZERO sheets to retrofit (locked per ORCH-0698 closure). New `glass.bottomSheet.*` token namespace serves ExpandedCardModal alone; no `MapBottomSheet`/`PersonBottomSheet` migration since both are deleted.

---

## §2 Hard locks (verbatim from dispatch §B + audit §11)

| # | Decision | Locked value |
|---|---|---|
| 1 | Presentation style | Option α — global bottom-sheet conversion. All 8 mount surfaces inherit. NO per-mount-site presentation flag. |
| 2 | Library | `@gorhom/bottom-sheet@^5.2.8` (already in `app-mobile/package.json:21`). Use `<BottomSheet>` + `<BottomSheetScrollView>` + `<BottomSheetBackdrop>`. |
| 3 | Tokens | New `glass.bottomSheet.*` sub-namespace + new `glass.surfaceDark` variant in `app-mobile/src/constants/designSystem.ts`. Follow design §H-Tokens + §E-4.3 verbatim. |
| 4 | Snap points | `['50%', '90%']`. Initial `index: 1` (90% — opens expanded). |
| 5 | Render branching | `isCurated` → CuratedBranch (existing, structurally unchanged). `isEvent` (= `card.cardType === 'event' \|\| card.nightOutData != null`) → new `<EventDetailLayout>`. else → PlaceBranch (existing, dark-token re-mapped only). |
| 6 | OQ-1 Add to Calendar | Native via `expo-calendar` `Calendar.createEventAsync` |
| 7 | OQ-2 Get Tickets | In-app browser via existing `<InAppBrowserModal>` |
| 8 | OQ-3 Sold-out CTA | Disabled with "Sold Out" label (gray bg `rgba(102,102,102,1)`, white@60% text) |
| 9 | OQ-4 Save heart on past events | Show normally |
| 10 | OQ-5 Event action set | `[Get Tickets, Save, Share, Add to Calendar]` only — no Schedule/Visit/Policies |
| 11 | OQ-6 Token retrofit | ZERO sheets (auto-evaporated post-ORCH-0698) |
| 12 | F-13 Shape 2a deletion | GATED by SC-20 live-fire confirmation (iOS + Android). Until SC-20 PASS, `MessageInterface.tsx:1538-1554` stays unchanged. |
| 13 | F-15 ExpandedCardHeader fate | Retain conditionally on `hasNavigation && navigationTotal != null && navigationIndex != null`; retire on all other surfaces. |
| 14 | Native modules | NONE added. OTA-eligible. |
| 15 | Solo / collab parity | All 8 surfaces ship same chrome. Per-data-type branching at content layer only. |

---

## §3 Scope (8 deliverables)

| ID | Item | Outcome |
|---|---|---|
| **S-1** | Bottom-sheet chrome swap in `ExpandedCardModal.tsx` | `<Modal>` → `<BottomSheet>`; `<ScrollView>` → `<BottomSheetScrollView>`; backdrop via `<BottomSheetBackdrop>`; drag handle via `handleIndicatorStyle` prop. F-01..F-06 + F-09 from audit. |
| **S-2** | New `EventDetailLayout.tsx` at `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` | Event IA per design §E-5 (peek + expanded + sold-out + presale + TBA + loading + error states). F-07 + F-10 + F-11. |
| **S-3** | Sub-component dark-token re-map across **10 files** (audit said 13; 3 deleted by S-8 below) | Per §6.4 token mapping table. F-08. |
| **S-4** | New `glass.bottomSheet.*` + `glass.surfaceDark` token sub-namespace | Per design §H-Tokens + §E-4.3. F-12. |
| **S-5** | F-13 Shape 2a Modal hack deletion at `MessageInterface.tsx:1538-1554` | **GATED by SC-20 live-fire PASS.** F-13. |
| **S-6** | `<ExpandedCardHeader>` retain-conditionally + dark-token re-map | Per §B.3.1. Conditional on review-flow navigation props. |
| **S-7** | nightOutStyles deletion list verbatim | Per §6.5. F-19 + F-20. |
| **S-8** | Delete 3 dead component files + 3 dead imports | DescriptionSection.tsx + HighlightsSection.tsx + MatchFactorsBreakdown.tsx + lines 36/37/41 in ExpandedCardModal.tsx. D-OBS-3 + D-OBS-5 audit-resolved this turn. |

---

## §4 Non-goals (explicit)

| Non-goal | Reason |
|---|---|
| Backend changes (edge fns, migrations, RLS) | Mobile-only spec |
| ORCH-0697 Pattern F isSaved parity sweep across 8 surfaces | Separate ORCH (deferred — `EventDetailLayout` becomes primary `isSaved` consumer; do that AFTER this lands) |
| ORCH-0670 Slice B currency cleanup (incl. ViewFriendProfileScreen USD hardcode) | Slice B scope; out here |
| Map view restoration | Map deleted via ORCH-0698 |
| `--platform all` EAS Update test | Ship/test concern, not spec |
| New analytics events (designer D-5 from design spec — `event_detail_opened` etc.) | Optional. Spec writer flags at §15; orchestrator decides whether to bundle. |
| Reorder place IA sections | Designer §E-6 + audit §3.4 explicitly preserve verbatim |
| Add new sections to PlaceBranch | Out of scope |

**Assumption:** designer §E-3.3 prediction ("toasts render naturally above `@gorhom/bottom-sheet`") is architecturally correct (BottomSheet is Animated.View, not native Modal portal). Spec writer accepts this as MEDIUM-confidence; SC-20 live-fire is the verification gate.

---

## §5 Per-layer specification

### §5.1 Component layer — `ExpandedCardModal.tsx`

#### §5.1.1 Imports

**Add:**
```ts
import BottomSheet, {
  BottomSheetScrollView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
```

**Delete:**
- Line 3: `Modal,` from `react-native` import block (keep all other react-native imports — `View`, `Text`, `ScrollView`, etc. are still used)
- Line 36: `import DescriptionSection from "./expandedCard/DescriptionSection";` (D-OBS-3 dead import)
- Line 37: `import HighlightsSection from "./expandedCard/HighlightsSection";` (D-OBS-3 dead import)
- Line 41: `import MatchFactorsBreakdown from "./expandedCard/MatchFactorsBreakdown";` (D-OBS-3 dead import)

**Wait — clarification on `Modal`:** the underlying card presentation `<Modal>` at line 1537 is being replaced by `<BottomSheet>`. BUT the file ALSO uses `<Modal>` indirectly via `<InAppBrowserModal>` and `<ShareModal>` children — those are component-imports, not the `react-native` `Modal` directly. The `react-native` `Modal` import IS only used by line 1537, so it's safe to delete. **Implementor MUST verify `react-native` `Modal` has no other consumer in this file before deleting the import.**

#### §5.1.2 New ref + state

Add at component top (after existing refs, before existing state):
```ts
const bottomSheetRef = useRef<BottomSheet>(null);

// Memoize backdrop component to prevent re-creation on every render
const renderBackdrop = useCallback(
  (props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={0.55}
      pressBehavior="close"
    />
  ),
  []
);
```

**Note for implementor:** if `useCallback` is not already imported, add to React import line.

#### §5.1.3 Visibility-to-snap mapping

Replace the current `<Modal visible={visible} ...>` pattern with effect-driven open/close on the BottomSheet ref:

```ts
useEffect(() => {
  if (visible) {
    bottomSheetRef.current?.snapToIndex(1); // 90% (expanded)
  } else {
    bottomSheetRef.current?.close();
  }
}, [visible]);

const handleSheetChange = useCallback((index: number) => {
  if (index === -1) {
    onClose();  // user dismissed via drag-down or scrim tap
  }
}, [onClose]);
```

#### §5.1.4 New JSX block — chrome wrapper

Replace the entire JSX at lines 1535-2125 (`<Modal>...</Modal>`) with this skeleton:

```tsx
return (
  <>
    <BottomSheet
      ref={bottomSheetRef}
      index={visible ? 1 : -1}
      snapPoints={glass.bottomSheet.snapPoints}
      enablePanDownToClose
      onChange={handleSheetChange}
      handleIndicatorStyle={{
        backgroundColor: glass.bottomSheet.handle.color,
        width: glass.bottomSheet.handle.width,
        height: glass.bottomSheet.handle.height,
      }}
      backgroundStyle={{
        backgroundColor: glass.discover.screenBg,
        borderTopLeftRadius: glass.bottomSheet.topRadius,
        borderTopRightRadius: glass.bottomSheet.topRadius,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: glass.bottomSheet.hairline,
      }}
      backdropComponent={renderBackdrop}
    >
      {/* Conditionally render sticky header for review-flow only */}
      {hasNavigation && navigationTotal != null && navigationIndex != null && (
        <ExpandedCardHeader onClose={onClose} />
      )}

      {/* Review nav bar — preserved as before, but tokens flipped dark */}
      {hasNavigation && navigationTotal != null && navigationIndex != null && (
        <View style={styles.reviewNavBar}>
          {/* ... existing JSX, only token swaps required (see §6.4) */}
        </View>
      )}

      <BottomSheetScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) }
        ]}
      >
        {/* Render branching */}
        {isCuratedCard && curatedCard && Array.isArray(curatedCard.stops) ? (
          // ... existing CuratedBranch JSX (lines 1589-1634), token re-mapped per §6.4
        ) : isNightOut && nightOut ? (
          <EventDetailLayout
            card={card}
            nightOut={nightOut}
            isSaved={isSaved}
            onSave={onSave}
            onShare={onShare}
            onClose={onClose}
            onOpenBrowser={(url, title) => {
              setBrowserUrl(url);
              setBrowserTitle(title);
            }}
            accountPreferences={accountPreferences}
            seatMapFailed={seatMapFailed}
            setSeatMapFailed={setSeatMapFailed}
          />
        ) : (
          // ... existing PlaceBranch JSX (lines 1775-2045), token re-mapped per §6.4 only — section ordering UNCHANGED
        )}
      </BottomSheetScrollView>

      {/* InAppBrowserModal + ShareModal stay at sibling level under BottomSheet container */}
      {isNightOut && nightOut && (
        <InAppBrowserModal
          visible={ticketBrowserUrl !== null}
          url={ticketBrowserUrl ?? ''}
          title={`Tickets – ${nightOut.eventName}`}
          onClose={() => setTicketBrowserUrl(null)}
        />
      )}
      <InAppBrowserModal
        visible={browserUrl !== null}
        url={browserUrl ?? ''}
        title={browserTitle}
        onClose={() => setBrowserUrl(null)}
      />
      {isNightOut && nightOut && (
        <ShareModal
          isOpen={isNightOutShareOpen}
          onClose={() => setIsNightOutShareOpen(false)}
          // ... existing ShareModal props unchanged
        />
      )}
    </BottomSheet>
  </>
);
```

**Note on `<ExpandedCardHeader>` placement:** by design §E-3.2, the drag handle (rendered by `<BottomSheet>` itself via `handleIndicatorStyle`) is the universal chrome. `<ExpandedCardHeader>` is preserved ONLY for review-flow screens that need the back-arrow / counter UI. Spec writer puts both header + nav-bar inside a single conditional block keyed on the same `hasNavigation` flag.

#### §5.1.5 Sticky-bottom CTA — DELETE

Lines 2049-2079 (the entire sticky `nightOutStyles.stickyButtonContainer` JSX block) — DELETE. The Get Tickets CTA moves above-fold inside `<EventDetailLayout>` per design §E-5.1.

### §5.2 Component layer — `EventDetailLayout.tsx` (NEW)

**File:** `app-mobile/src/components/expandedCard/EventDetailLayout.tsx`

#### §5.2.1 Props interface

```ts
interface EventDetailLayoutProps {
  card: ExpandedCardData;
  nightOut: NonNullable<ExpandedCardData['nightOutData']>;
  isSaved: boolean;
  onSave: (card: ExpandedCardData) => Promise<void> | void;
  onShare?: (card: ExpandedCardData) => void;
  onClose: () => void;
  onOpenBrowser: (url: string, title: string) => void;
  accountPreferences?: { currency?: string; measurementSystem?: 'Metric' | 'Imperial' };
  seatMapFailed: boolean;
  setSeatMapFailed: (failed: boolean) => void;
}
```

#### §5.2.2 Layout — peek state (50% snap point, design §E-5.1)

Top→bottom inside `<View style={styles.container}>`:

1. **Hero poster** — `<ExpoImage source={{ uri: card.images?.[0] || card.image }} style={styles.heroPoster} contentFit="cover" transition={200} />`. Style: `width: '100%', aspectRatio: 16/9, maxHeight: 240, borderRadius: radius.lg, overflow: 'hidden'`. Bottom-anchored linear gradient overlay: `<LinearGradient colors={['rgba(0,0,0,0)', 'rgba(12,14,18,0.95)']} style={styles.heroGradient} />`.

2. **Genre chip overlay** — bottom-left of poster, glass background. Renders only if `nightOut.genre`. If `nightOut.subGenre` exists, append: `{nightOut.genre} · {nightOut.subGenre}`. Uses `glass.badge.tint.floor` bg + `glass.badge.border.hairline` border + `glass.badge.blur.intensity` BlurView.

3. **Event title** — `<Text style={styles.title} numberOfLines={3} accessibilityRole="header">{card.title}</Text>`. Style: `fontSize: 24, fontWeight: '700', color: colors.white, lineHeight: 30, marginTop: dsSpacing.md, marginHorizontal: dsSpacing.md`.

4. **Artist name** — `<Text style={styles.artist}>{nightOut.artistName}</Text>`. Style: `fontSize: 18, fontWeight: '500', color: colors.primary, marginTop: 4, marginHorizontal: dsSpacing.md`.

5. **Meta row** — `<Text style={styles.metaRow} numberOfLines={2} ellipsizeMode="tail">{venueName} · {date} · {time}</Text>`. Style: `fontSize: 14, color: 'rgba(255,255,255,0.70)', marginTop: dsSpacing.sm, marginHorizontal: dsSpacing.md, lineHeight: 20`.

6. **Get Tickets CTA** — full-width, 56pt height. Behavior per design §E-5.6 status-aware:
   - `nightOut.ticketStatus === 'onsale'` AND `nightOut.ticketUrl` truthy → primary orange bg `colors.primary`, label `t('cards:expanded.get_tickets', { price: formatPriceRange(nightOut.price, accountPreferences?.currency) })`, onPress invokes `onOpenBrowser(nightOut.ticketUrl, eventName)`
   - `nightOut.ticketStatus === 'offsale'` → disabled gray bg `'rgba(102, 102, 102, 1)'`, label `t('cards:expanded.sold_out')`, no onPress
   - `nightOut.ticketStatus === 'presale'` → amber bg `'#F59E0B'`, label `t('cards:expanded.presale_opens', { date: nightOut.presaleDate })` (NEW key — see §6.6), no onPress
   - else (TBA — no `ticketUrl`) → amber bg, label `t('cards:expanded.tickets_tba')` (NEW key — see §6.6), no onPress
   - Style baseline: `flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 56, marginTop: dsSpacing.md, marginHorizontal: dsSpacing.md, borderRadius: radius.lg, gap: 8`. Text: `fontSize: 16, fontWeight: '600', color: colors.white, numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8`.

7. **Secondary action row** — three chips, equal-width via `flex: 1`, height 40pt, glass-on-dark via new `glass.surfaceDark` token. Each chip is `<TouchableOpacity>` with `<Icon>` + `<Text>` inline.
   - **Save chip** — icon `bookmark` (filled when `isSaved`) or `bookmark-outline` (otherwise). Label `t('cards:expanded.save')` / `t('cards:expanded.saved')`. Toggle invokes `onSave(card)` with bounce animation (scale 1.18 → 1.0, 250ms). Haptic `Haptics.impactAsync(Light)`. accessibilityState `{ selected: isSaved }`.
   - **Share chip** — icon `share-outline`. Label `t('cards:expanded.share')`. Invokes `onShare?.(card)` OR opens existing `<ShareModal>` (set `isNightOutShareOpen=true` via prop callback or local state lift — implementor picks; both work).
   - **Add to Calendar chip** — icon `calendar-outline`. Label `t('cards:expanded.add_to_calendar')` (NEW key — see §6.6). Invokes `handleAddToCalendar()` (see §5.2.5).

   On presale state, swap "Add to Calendar" for "Notify Me" chip per design §E-5.6 (NEW key `cards:expanded.notify_me`). On TBA state, hide the third chip entirely. Implementor enumerates the conditional logic.

#### §5.2.3 Layout — expanded state (90% snap, design §E-5.2)

Below the secondary action row, scrollable. Top→bottom:

1. **About section** — only renders if `card.description` truthy.
   - Section title `<Text style={styles.sectionTitle}>{t('cards:expanded.about')}</Text>` (NEW key)
   - Body `<Text style={styles.body} numberOfLines={collapsed ? 3 : undefined}>{card.description}</Text>`
   - "More" / "Less" toggle TouchableOpacity (only if description > 3 lines — measure via `onTextLayout` or simple line-count heuristic; spec writer recommends simple toggle)
   - Section divider above (`borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)'`).

2. **When & Where section** — always renders if event card.
   - Section title `t('cards:expanded.when_and_where')` (NEW key)
   - Date row: calendar icon (orange) + `<Text>{nightOut.date}</Text>` + (if `nightOut.doorTime`) sub-line "Doors {doorTime} · Show {time}" else just `nightOut.time`
   - Address row: pin icon (orange) + `<Text>{nightOut.venueName}</Text>` + sub-line `<Text>{card.address}</Text>` + Open in Maps link `<TouchableOpacity onPress={openDirections}><Text>{t('cards:expanded.open_in_maps')}</Text></TouchableOpacity>` — reuses existing `openDirections` helper (currently at ExpandedCardModal.tsx:1517-1533; spec writer recommends extracting to `app-mobile/src/utils/openDirections.ts` for reuse, OR leaving inline as helper closure passed via prop. **Implementor picks the simpler option — inline helper passed via `openDirections` prop is cheaper.**)
   - Section divider above.

3. **Tags section** — only renders if `nightOut.tags?.length > 0`.
   - Section title `t('cards:expanded.tags')` (NEW key)
   - Chip wrap: each tag is a `<View>` with `glass.surfaceDark` bg + tag text. `flexDirection: 'row', flexWrap: 'wrap', gap: 8`.
   - Section divider above.

4. **Seat Map section** — only renders if `nightOut.seatMapUrl` AND NOT `seatMapFailed`.
   - Section title `t('cards:expanded.seat_map')`
   - `<Image source={{ uri: nightOut.seatMapUrl }} style={{ width: '100%', height: 200, borderRadius: 12 }} resizeMode="contain" onError={() => setSeatMapFailed(true)} />`
   - Section divider above.

5. **Bottom safe-area spacer** — `<View style={{ height: insets.bottom + 16 }} />`.

#### §5.2.4 Loading state (design §E-5.3)

Skeleton shimmer when `card` data is incomplete (e.g., `card.image == null` AND `nightOut == null`). For this spec, skeleton is OPTIONAL — current code does not surface a loading state for the modal mid-render (modals always open with full data). If `card` arrives partial, render whatever fields are present and let the rest render as empty. **Spec writer flags as observation, not blocking.** Implementor can skip skeleton for v1.

#### §5.2.5 `handleAddToCalendar` implementation

```ts
import * as Calendar from 'expo-calendar';
import * as Haptics from 'expo-haptics';

const handleAddToCalendar = async () => {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('cards:expanded.calendar_permission_title'), t('cards:expanded.calendar_permission_body'));
      return;
    }

    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const defaultCal = calendars.find(c => c.allowsModifications && c.source.name !== 'Subscribed Calendars');
    if (!defaultCal) {
      Alert.alert(t('cards:expanded.calendar_unavailable'), '');
      return;
    }

    // Parse nightOut.date + nightOut.time into Date objects
    // Spec writer note: TM event time formats vary; implementor uses a date-fns parser or hand-rolled with try/catch
    const startDate = parseEventDateTime(nightOut.date, nightOut.time);
    if (!startDate) {
      Alert.alert(t('cards:expanded.calendar_date_parse_error'), '');
      return;
    }
    const endDate = new Date(startDate.getTime() + 3 * 60 * 60 * 1000); // assume 3h duration

    await Calendar.createEventAsync(defaultCal.id, {
      title: card.title,
      startDate,
      endDate,
      location: `${nightOut.venueName}${card.address ? ', ' + card.address : ''}`,
      notes: nightOut.artistName ? `Artist: ${nightOut.artistName}` : undefined,
    });

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toastManager.success(t('cards:expanded.calendar_added'), 3000);
  } catch (err: any) {
    console.warn('[EventDetailLayout] Add to Calendar failed:', err.message);
    toastManager.error(t('cards:expanded.calendar_error'), 3000);
  }
};
```

**Implementor note:** `parseEventDateTime` helper — implementor writes; spec recommends placing in `app-mobile/src/utils/parseEventDateTime.ts`. Returns `Date | null`. Test cases: `("Fri Nov 7", "8:00 PM")`, `("November 7, 2026", "20:00")`, `("Tomorrow", "TBA")` → null fallback.

### §5.3 Token layer — `app-mobile/src/constants/designSystem.ts`

#### §5.3.1 New `glass.bottomSheet` sub-namespace

Add inside the existing `glass` namespace export:

```ts
bottomSheet: {
  scrim: {
    color: 'rgba(0, 0, 0, 0.55)',
    blurIntensity: 12,
    fallbackSolid: 'rgba(0, 0, 0, 0.85)', // for reduceTransparency
  },
  handle: {
    color: 'rgba(255, 255, 255, 0.30)',
    width: 36,
    height: 4,
    radius: 2,
    marginTop: 8,
    marginBottom: 12,
  },
  hairline: 'rgba(255, 255, 255, 0.08)',
  topRadius: 28,
  snapPoints: ['50%', '90%'] as const,
  shadow: {
    color: '#000',
    offset: { width: 0, height: -4 },
    opacity: 0.4,
    radius: 16,
    elevation: 16,
  },
},
```

#### §5.3.2 New `glass.surfaceDark` variant

Add inside the existing `glass` namespace export, alongside existing `surface`:

```ts
surfaceDark: {
  backgroundColor: 'rgba(255, 255, 255, 0.10)',
  borderColor: 'rgba(255, 255, 255, 0.18)',
  borderWidth: 1,
  borderRadius: 16, // or radius.xl if defined
},
```

### §5.4 i18n layer — new keys (S-2 + S-7)

#### §5.4.1 New keys to add to `app-mobile/src/i18n/locales/en/expanded_details.json`

| Key | English copy |
|---|---|
| `cards:expanded.save` | `"Save"` |
| `cards:expanded.saved` | `"Saved"` |
| `cards:expanded.share` | `"Share"` |
| `cards:expanded.add_to_calendar` | `"Add to Calendar"` |
| `cards:expanded.notify_me` | `"Notify Me"` |
| `cards:expanded.about` | `"About"` |
| `cards:expanded.when_and_where` | `"When & Where"` |
| `cards:expanded.tags` | `"Tags"` |
| `cards:expanded.open_in_maps` | `"Open in Maps"` |
| `cards:expanded.presale_opens` | `"Presale Opens {{date}}"` |
| `cards:expanded.tickets_tba` | `"Tickets TBA"` |
| `cards:expanded.calendar_permission_title` | `"Calendar access needed"` |
| `cards:expanded.calendar_permission_body` | `"Allow calendar access in Settings to add this event."` |
| `cards:expanded.calendar_unavailable` | `"No writable calendar found on this device."` |
| `cards:expanded.calendar_date_parse_error` | `"Couldn't read the event time."` |
| `cards:expanded.calendar_added` | `"Added to your calendar"` |
| `cards:expanded.calendar_error` | `"Couldn't add to calendar. Try again."` |
| `cards:expanded.show_more` | `"More"` |
| `cards:expanded.show_less` | `"Less"` |

**Verify before adding:** some of these keys may already exist (e.g., `save` / `saved` / `share` may live in `cards.json` or `common.json`). Implementor `grep "cards:expanded.save"` before adding; reuse existing keys where possible. Spec writer's count is upper bound — actual delta may be smaller.

#### §5.4.2 Locale parity (S-7 → S-8 chain)

Per ORCH-0685 cycle-1 + ORCH-0690 cycle-1 + ORCH-0670 Slice A precedent: full 29-locale translation pass via single-pass Python script `scripts/orch-0696-translate-locales.py` (modeled on `scripts/orch-0670-translate-locales.py`). Idempotent. Adds keys × 28 non-en locales; deletes 0 orphans (this spec adds; doesn't subtract i18n).

Estimated translation count: up to 19 keys × 28 non-en locales = **up to 532 new translations** (will be smaller after grep dedup).

### §5.5 Service / hook / DB / edge fn / RLS layers

**ALL N/A.** Mobile-only. OTA-eligible. No state-shape changes; no DB; no edge fn; no RLS; no native module additions.

---

## §6 Verbatim deletion + token-swap directives

### §6.1 Files to DELETE (S-8 + S-7 dead code)

| # | File | Reason |
|---|---|---|
| 1 | `app-mobile/src/components/expandedCard/DescriptionSection.tsx` | Dead — never rendered (D-OBS-3 confirmed by spec writer reading CardInfoSection.tsx + grep) |
| 2 | `app-mobile/src/components/expandedCard/HighlightsSection.tsx` | Dead — same |
| 3 | `app-mobile/src/components/expandedCard/MatchFactorsBreakdown.tsx` | Dead — same |

### §6.2 ExpandedCardModal.tsx import-line deletions

| Line | Verbatim |
|---|---|
| 36 | `import DescriptionSection from "./expandedCard/DescriptionSection";` |
| 37 | `import HighlightsSection from "./expandedCard/HighlightsSection";` |
| 41 | `import MatchFactorsBreakdown from "./expandedCard/MatchFactorsBreakdown";` |

Plus delete `Modal` from line 3 react-native import block (verify no other consumer in this file first).

### §6.3 ExpandedCardModal.tsx style entries to DELETE (F-18 + F-19)

These styles serve only the old centered-card chrome / sticky CTA. After bottom-sheet swap, all are unreachable.

| Style entry | Lines | Reason |
|---|---|---|
| `styles.overlay` | ~2410-2415 | Centered-card scrim — replaced by `<BottomSheetBackdrop>` |
| `styles.overlayBackground` | ~2416-2422 | Tap-to-dismiss touchable — replaced by `BottomSheetBackdrop pressBehavior="close"` |
| `styles.modalContainer` | ~2423-2436 | Centered-card chrome — replaced by `<BottomSheet backgroundStyle>` |

### §6.4 Token swap mapping table (S-3) — universal rule + per-file directives

#### §6.4.1 Canonical color → token mapping (light → dark)

Apply this mapping to every hardcoded color found in the 10 sub-component files + nightOutStyles + ExpandedCardModal styles + reviewNavBar:

| Old (light) value | New (dark) value | Rationale |
|---|---|---|
| `#fff` / `#FFF` / `#ffffff` / `#FFFFFF` (background) | `glass.surfaceDark.backgroundColor` (`rgba(255,255,255,0.10)`) | white card → glass-on-dark surface |
| `#fff7ed` (cream/orange-50 background) | `glass.surfaceDark.backgroundColor` | accent card → glass-on-dark |
| `#fef3e2` / `#fef7f0` (orange-50/100) | `glass.surfaceDark.backgroundColor` | same |
| `#f9fafb` (gray-50) | `glass.surfaceDark.backgroundColor` | same |
| `#f3f4f6` (gray-100, divider/divider-bg) | `'rgba(255,255,255,0.10)'` (section divider rule) | dark-bg divider |
| `#e5e7eb` (gray-200, borders) | `'rgba(255,255,255,0.18)'` (= `glass.surfaceDark.borderColor`) | dark-bg border |
| `#fed7aa` (orange-200, accent border) | `colors.primary` (`#eb7825`) at 0.45 opacity = `'rgba(235,120,37,0.45)'` | accent border on dark |
| `#111827` (gray-900, primary text) | `colors.white` (`#FFFFFF`) | dark text → white text |
| `#1f2937` (gray-800, secondary text) | `colors.white` | same |
| `#374151` (gray-700, body text) | `'rgba(255,255,255,0.80)'` | body text on dark |
| `#4b5563` (gray-600, body) | `'rgba(255,255,255,0.70)'` | same |
| `#6b7280` (gray-500, muted) | `'rgba(255,255,255,0.70)'` | muted on dark |
| `#78350f` / `#92400e` / `#9a3412` (amber/orange-text) | `colors.primary` (`#eb7825`) | brand orange on dark |
| `#c2410c` / `#d97706` / `#ea580c` (orange variants) | `colors.primary` | brand orange canonical |
| `#9ca3af` / `#9CA3AF` / `#d1d5db` (gray-300/400, light muted) | `'rgba(255,255,255,0.50)'` | very-muted on dark |
| `#15803d` (green-700, success) | `colors.success` if exists, else `'#10B981'` | success preserved |
| `#22c55e` (green-500) | `colors.success` or `'#10B981'` | same |
| `#ef4444` (red-500, error) | `colors.error` if exists, else `'#EF4444'` | error preserved |
| `#fef2f2` (red-50, error bg) | `'rgba(239,68,68,0.10)'` | error bg on dark |
| `#991b1b` (red-700, error text) | `colors.error` or `'#FCA5A5'` (red-300, lighter for dark) | error text legible on dark |
| `#fbbf24` (yellow-400, star rating) | UNCHANGED — stars stay yellow regardless of bg | rating star is brand-agnostic |
| `#000000` / `#000` (lightbox bg) | UNCHANGED — black is correct for image lightbox | lightbox is light-source-agnostic |
| `rgba(0,0,0,X)` / `rgba(255,255,255,X)` overlays | UNCHANGED unless context suggests otherwise | overlay tints typically already correct |
| `#6366F1` (indigo, ActionButtons rare) | UNCHANGED — accent for specific action; not theme-bound | preserve unless visual review says re-tone |
| `#666` (sticky-CTA disabled gray, line 2064) | `'rgba(102, 102, 102, 1)'` from design §E-4.2 | preserved literal — design lock |
| `#ebe6e7` (BusynessSection mini-bar track) | `'rgba(255,255,255,0.18)'` (= `glass.surfaceDark.borderColor`) | track on dark |
| `#fef7f0` / `#fff7ed` accent bgs already mapped above | (see above) | — |

#### §6.4.2 Per-file IMPL directives

Implementor opens each file, runs `Grep` for hardcoded colors, applies the mapping table verbatim. Files in scope (10):

| # | File | Audit grep count | Notes |
|---|---|---|---|
| 1 | `app-mobile/src/components/expandedCard/ActionButtons.tsx` | ~38 | Highest density. Action chip colors + Schedule mode-button tints + closed-place warning bg. Apply mapping verbatim. Special case: line 1226 `#ea580c` is the orange-600 hover/active variant — map to `colors.primary` (#eb7825 ≈ orange-500). Line 1012 `#1f2937` (Cancel button bg) — map to `glass.surfaceDark.backgroundColor`. |
| 2 | `app-mobile/src/components/expandedCard/BusynessSection.tsx` | ~7 | All amber/orange text + bgs. Mini-bar track `#ebe6e7` → `glass.surfaceDark.borderColor`. Mini-bar fill `#eb7825` → UNCHANGED (`colors.primary` already). |
| 3 | `app-mobile/src/components/expandedCard/CardInfoSection.tsx` | ~8 | Title `#111827` → white. Category text `#d97706` → `colors.primary`. Bullet/tag `#6b7280` → muted. Metric pill bg `#fff7ed` + border `#fed7aa` + text `#92400e` → glass-dark surface + accent border + primary orange text. Description `#374151` → 80% white. Tip `#9CA3AF` → 50% white. |
| 4 | `app-mobile/src/components/expandedCard/CompanionStopsSection.tsx` | ~13 | Card bg `#ffffff` → glass-dark. Title `#111827` → white. Subtitle `#6b7280` → muted. Border `#e5e7eb` → glass-dark border. Active border `#eb7825` → UNCHANGED. Distance/secondary text `#9ca3af` → 50% white. |
| 5 | `app-mobile/src/components/expandedCard/ExpandedCardHeader.tsx` | ~3 | Header bg `#ffffff` → TRANSPARENT (let bottom-sheet bg show through; spec writer locks `backgroundColor: 'transparent'`). Close button bg `#f3f4f6` → `glass.surfaceDark.backgroundColor`. Close icon `#6b7280` → `colors.white`. |
| 6 | `app-mobile/src/components/expandedCard/ImageGallery.tsx` | ~7 | Lightbox bg `#000000` UNCHANGED. Placeholder bg `#f3f4f6` → glass-dark surface. Indicator bg `rgba(0,0,0,0.6)` UNCHANGED. Indicator-active dot `#ffffff` UNCHANGED (white-on-dark-overlay). Indicator-inactive `rgba(255,255,255,0.3)` UNCHANGED. |
| 7 | `app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx` | ~5 | Bg `#fef7f0` → glass-dark. Accent bg `#fff7ed` → glass-dark. Body text `#374151` → 80% white. |
| 8 | `app-mobile/src/components/expandedCard/StopImageGallery.tsx` | ~3 | Placeholder bgs `#f3f4f6` → glass-dark. Active dot `#ffffff` UNCHANGED. |
| 9 | `app-mobile/src/components/expandedCard/TimelineSection.tsx` | ~12 | Largest after ActionButtons. Step circles + connectors + body text — apply mapping. Connector line bg likely `#e5e7eb` → glass-dark border. |
| 10 | `app-mobile/src/components/expandedCard/WeatherSection.tsx` | ~1 | Minimal — apply single mapping. |

**11th file (DELETED, not re-mapped):** ExpandedCardHeader stays for review-flow only — already in the table above.

**12th-14th files (DELETED, not re-mapped):** DescriptionSection / HighlightsSection / MatchFactorsBreakdown deleted per §6.1.

#### §6.4.3 Inline styles in ExpandedCardModal.tsx (S-1)

In addition to the file-level deletions in §6.3, inline styles inside the curated branch (lines 58-100+ `curatedStyles`) need re-mapping. Audit covered partially:

| Style key | File:line | Old | New |
|---|---|---|---|
| `curatedStyles.header.backgroundColor` | ~66 | `'#1C1C1E'` | UNCHANGED — already dark |
| `curatedStyles.title.color` | ~71 | `'#ffffff'` | UNCHANGED |
| `curatedStyles.tagline.color` | ~76 | `'rgba(255,255,255,0.7)'` | UNCHANGED |
| (rest of curatedStyles) | various | mostly already dark-ready | spot-check via grep |

**The curated branch is already dark-themed.** Implementor mostly leaves it alone; spot-checks for any light-mode regressions.

#### §6.4.4 reviewNavBar style re-map (S-6 sub-piece)

| Style key | File:line | Old | New |
|---|---|---|---|
| `styles.reviewNavBar.backgroundColor` | ~2397 | `'#f9fafb'` | `'rgba(255,255,255,0.05)'` |
| `styles.reviewNavBar.borderBottomColor` | ~2399 | `'#f3f4f6'` | `'rgba(255,255,255,0.10)'` |
| `styles.reviewNavCounter.color` | ~2407 | `'#6b7280'` | `'rgba(255,255,255,0.70)'` |
| Inline JSX chevron color (`onNavigatePrevious ? '#eb7825' : '#d1d5db'`) | ~1565 | `#d1d5db` (disabled) | `'rgba(255,255,255,0.30)'` (disabled). Active stays `#eb7825`. |

### §6.5 nightOutStyles deletion list verbatim (S-7)

Located in `ExpandedCardModal.tsx:2132-2388`. After EventDetailLayout.tsx supersedes the inline night-out branch (lines 1652-1774), these style entries become unreachable.

**DELETE these entries:**

| # | Style entry | Audit reference |
|---|---|---|
| 1 | `nightOutStyles.container` | superseded by EventDetailLayout.styles.container |
| 2 | `nightOutStyles.title` | superseded by EventDetailLayout.styles.title |
| 3 | `nightOutStyles.categoryHostRow` | superseded by EventDetailLayout meta row |
| 4 | `nightOutStyles.categoryText` | same |
| 5 | `nightOutStyles.dotSep` | same |
| 6 | `nightOutStyles.hostText` | same |
| 7 | `nightOutStyles.infoCardsRow` | superseded by Get Tickets CTA + secondary row pattern |
| 8 | `nightOutStyles.infoCard` | same |
| 9 | `nightOutStyles.infoCardHeader` | same |
| 10 | `nightOutStyles.infoCardLabel` | same |
| 11 | `nightOutStyles.infoCardPrimary` | same |
| 12 | `nightOutStyles.infoCardSecondary` | same |
| 13 | `nightOutStyles.infoCardPrice` | same |
| 14 | `nightOutStyles.goingBadge` | unreferenced (audit D-OBS-4) |
| 15 | `nightOutStyles.goingText` | same |
| 16 | `nightOutStyles.divider` | superseded by section divider rule in EventDetailLayout |
| 17 | `nightOutStyles.sectionTitle` | superseded — implementor decides whether to keep as reusable token-mapped style or inline in EventDetailLayout. Recommend DELETE — define fresh in EventDetailLayout. |
| 18 | `nightOutStyles.descriptionText` | superseded |
| 19 | `nightOutStyles.tagsRow` | superseded |
| 20 | `nightOutStyles.vibeBadge` | superseded by tag chip glass-dark pattern |
| 21 | `nightOutStyles.vibeBadgeText` | same |
| 22 | `nightOutStyles.musicGenreContainer` | unreferenced (audit D-OBS-4) |
| 23 | `nightOutStyles.musicGenreHeader` | same |
| 24 | `nightOutStyles.musicGenreLabel` | same |
| 25 | `nightOutStyles.musicGenreValue` | same |
| 26 | `nightOutStyles.venueCard` | superseded by When & Where address row |
| 27 | `nightOutStyles.venueIconRow` | same |
| 28 | `nightOutStyles.venueIcon` | same |
| 29 | `nightOutStyles.venueDetails` | same |
| 30 | `nightOutStyles.venueName` | same |
| 31 | `nightOutStyles.venueAddress` | same |
| 32 | `nightOutStyles.directionsButton` | superseded by Open in Maps link in When & Where |
| 33 | `nightOutStyles.directionsText` | same |
| 34 | `nightOutStyles.stickyButtonContainer` | F-19 — sticky CTA deleted entirely |
| 35 | `nightOutStyles.stickyButtonRow` | same |
| 36 | `nightOutStyles.getTicketsButton` | superseded by EventDetailLayout above-fold CTA |
| 37 | `nightOutStyles.getTicketsText` | same |
| 38 | `nightOutStyles.shareButton` | superseded by secondary action row Share chip |
| 39 | `nightOutStyles.ticketStatusBadge` | replaced by status-aware Get Tickets CTA label |
| 40 | `nightOutStyles.ticketStatusText` | same |

**DELETE the entire `const nightOutStyles = StyleSheet.create({ ... })` block at lines 2132-2388.** All 40 entries unreachable post-EventDetailLayout.

**Net deletion in this block: ~256 LOC.**

### §6.6 New i18n key names (canonical list per §5.4.1)

Already enumerated in §5.4.1. Implementor verifies none already exist in `cards.json` or `expanded_details.json` before adding.

---

## §7 Success criteria (numbered, testable, observable)

| # | SC | Verification |
|---|---|---|
| **SC-1** | Modal opens as bottom sheet (slides up from bottom) on every mount surface | Manual visual on each of 8 surfaces × iOS + Android |
| **SC-2** | Drag handle visible (36×4pt rounded pill, white@30%) at top of sheet | Manual visual |
| **SC-3** | Drag-down past 50% snap point dismisses sheet | Manual gesture |
| **SC-4** | Scrim tap dismisses sheet | Manual tap |
| **SC-5** | Android back button dismisses sheet | Manual hardware-back press |
| **SC-6** | Close X button (review-flow only) dismisses sheet | Manual on Discover deck + Solo deck |
| **SC-7** | Sheet bg matches `glass.discover.screenBg` rgba(12,14,18,1) | Visual + reading rendered style |
| **SC-8** | Top corners radius 28pt; bottom flush to screen | Visual |
| **SC-9** | Top hairline visible (rgba(255,255,255,0.08)) | Visual close-up |
| **SC-10** | Scrim is rgba(0,0,0,0.55) + BlurView intensity 12 | Visual close-up |
| **SC-11** | EventDetailLayout renders for cards with `nightOutData != null`: hero poster + genre chip + title + artist + meta row + Get Tickets CTA + secondary action row visible at peek (50%) | Manual: open any Discover event card, snap to 50% |
| **SC-12** | EventDetailLayout below-fold sections (About / When&Where / Tags / Seat Map) render at expanded (90%) snap point | Manual: drag handle up to 90% |
| **SC-13** | Get Tickets CTA opens `InAppBrowserModal` for onsale tickets | Manual: tap button on onsale event |
| **SC-14** | Sold-out events show disabled gray "Sold Out" CTA | Manual: open offsale event card |
| **SC-15** | Save chip toggles `isSaved` state + bounces on tap (scale 1.18 → 1.0) + fires haptic Light | Manual + dev tools observation |
| **SC-16** | Share chip invokes existing share flow | Manual |
| **SC-17** | Add to Calendar chip invokes `expo-calendar` `Calendar.createEventAsync` AND surfaces device calendar event after success | Manual: tap → check native Calendar app |
| **SC-18** | Place IA section ordering preserved verbatim in PlaceBranch (audit §3.4 11-step list) | Visual + grep verify section order in code |
| **SC-19** | All 10 sub-components render correctly on dark sheet bg (no white blocks; no unreadable dark-text-on-dark) | Manual visual on each of 5 place-rendering mount surfaces |
| **SC-20** | F-13 LIVE-FIRE: toast appears above bottom sheet on chat-shared mount × iOS AND Android | Manual: open chat-shared card, tap Save, observe toast |
| **SC-21** | Shape 2a Modal hack at MessageInterface.tsx:1538-1554 deleted — **GATED by SC-20 PASS** | grep returns 0 matches for `notificationsContainer` after deletion |
| **SC-22** | tsc clean — zero new errors above baseline (3 pre-existing: ConnectionsPage:2763 + HomePage:246 + HomePage:249) | `cd app-mobile && npx tsc --noEmit` |
| **SC-23** | All 8 mount surfaces inherit chrome — no per-surface presentation override exists | grep verify: no `<BottomSheet` or `<Modal` instance in any of the 8 mount-site files for ExpandedCardModal |
| **SC-24** | Locale parity: every new copy key from §5.4.1 (after grep dedup) translates to all 29 locales | Custom Python parity check across `app-mobile/src/i18n/locales/*/expanded_details.json` |
| **SC-25** | 3 dead component files DELETED (DescriptionSection / HighlightsSection / MatchFactorsBreakdown) + 3 dead imports DELETED in ExpandedCardModal.tsx | `git status` shows the 3 deletions; grep returns 0 for the import strings |
| **SC-26** | nightOutStyles block DELETED entirely (40 entries / ~256 LOC) | grep returns 0 for `nightOutStyles.` after IMPL |
| **SC-27** | New `glass.bottomSheet.*` + `glass.surfaceDark` tokens present in designSystem.ts | grep verify exports |
| **SC-28** | EventDetailLayout file exists at `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` with all peek + expanded layout per §5.2 | File-level read; visual smoke per SC-11 + SC-12 |
| **SC-29** | Visit Mapbox traffic data still loads in busyness sections post-redesign (regression check — Mapbox token kept) | Manual: open Discover place card, observe BusynessSection traffic info |
| **SC-30** | Get Tickets price label inherits currency from accountPreferences (regression check — currency formatting unchanged) | Visual: open event in non-USD locale, verify price renders correctly |

---

## §8 Test cases (mapped to SCs)

### §8.1 Per-mount-surface chrome verification (16-cell smoke matrix per audit §B.3.5)

| ID | Surface | Platform | Maps to SC |
|---|---|---|---|
| T-01 | Chat-shared (MessageInterface.tsx:1523) | iOS | SC-1 + SC-23 |
| T-02 | Chat-shared | Android | SC-1 + SC-23 |
| T-03 | Discover deck (DiscoverScreen.tsx:1385) | iOS | SC-1 + SC-6 (review nav) |
| T-04 | Discover deck | Android | SC-1 + SC-6 |
| T-05 | Saved tab (SavedTab.tsx:2145) | iOS | SC-1 |
| T-06 | Saved tab | Android | SC-1 |
| T-07 | Calendar tab (CalendarTab.tsx:1866) | iOS | SC-1 |
| T-08 | Calendar tab | Android | SC-1 |
| T-09 | Friend profile (ViewFriendProfileScreen.tsx:473) | iOS | SC-1 |
| T-10 | Friend profile | Android | SC-1 |
| T-11 | Collab session (SessionViewModal.tsx:848) | iOS | SC-1 |
| T-12 | Collab session | Android | SC-1 |
| T-13 | Solo deck (SwipeableCards.tsx:1926) | iOS | SC-1 + SC-6 |
| T-14 | Solo deck | Android | SC-1 + SC-6 |
| T-15 | Collab deck (SwipeableCards.tsx:2452) | iOS | SC-1 |
| T-16 | Collab deck | Android | SC-1 |

### §8.2 EventDetailLayout behavior

| ID | Scenario | Expected | Maps to SC |
|---|---|---|---|
| T-17 | Open onsale event card (Discover) | Get Tickets CTA orange, label includes price; tap opens InAppBrowserModal | SC-11 + SC-13 |
| T-18 | Open offsale event card | Get Tickets CTA gray disabled, label "Sold Out", non-tappable | SC-14 |
| T-19 | Open presale event card | Get Tickets CTA amber, label "Presale Opens [date]", non-tappable; secondary row swaps Add to Calendar for Notify Me | SC-14 |
| T-20 | Open TBA event card (no ticketUrl) | Get Tickets CTA amber "Tickets TBA", non-tappable; secondary row hides third chip | SC-14 |
| T-21 | Tap Save chip on event | Bookmark icon flips to filled, scale animation, haptic, isSaved persists | SC-15 |
| T-22 | Tap Share chip on event | ShareModal opens with event data | SC-16 |
| T-23 | Tap Add to Calendar chip | Calendar permission prompt → on grant, native calendar event created with title + venue + start time + end time | SC-17 |
| T-24 | Drag handle from peek to 90% expanded | About + When & Where + Tags + Seat Map sections become visible | SC-12 |
| T-25 | Tap About "More" toggle when description > 3 lines | Description expands fully | SC-12 |
| T-26 | Tap Open in Maps link | Native maps app opens with venue address | SC-12 |

### §8.3 Place-branch regression checks

| ID | Scenario | Expected | Maps to SC |
|---|---|---|---|
| T-27 | Open place card on Saved tab — verify all 11 sections render in correct order on dark bg | Section order: CardInfoSection → Stroll/Picnic plan button → WeatherSection → BusynessSection → PracticalDetailsSection → CompanionStopsSection (cond) → Grocery (cond) → TimelineSection (cond) → ActionButtons. All readable on dark sheet. | SC-18 + SC-19 |
| T-28 | Open curated card on Discover deck — verify CuratedBranch renders normally | CuratedPlanView + Weather + Busyness + Timeline | (curated branch unchanged structurally) |
| T-29 | Open Stroll card with timeline data | StrollSection renders correctly on dark bg | SC-19 |
| T-30 | Open Picnic card with grocery store | Grocery store section renders correctly on dark bg | SC-19 |

### §8.4 F-13 NEEDS-LIVE-FIRE gate

| ID | Scenario | Expected | Maps to SC |
|---|---|---|---|
| **T-31** | **CHAT-SHARED MOUNT × iOS** — share a card to a friend, recipient taps card, modal opens, recipient taps Save chip | **TOAST APPEARS ABOVE BOTTOM SHEET** with success message | **SC-20 (BLOCKING for SC-21)** |
| **T-32** | **CHAT-SHARED MOUNT × Android** — same scenario | **TOAST APPEARS ABOVE BOTTOM SHEET** | **SC-20 (BLOCKING for SC-21)** |
| T-33 | If T-31 or T-32 FAIL: implementor reverts S-5 (keeps Shape 2a Modal hack) and adds new exit-condition `[ORCH-0696 F-13]` comment block at MessageInterface.tsx:1538 | Shape 2a Modal hack remains; spec-writer marks F-13 as NEEDS-FOLLOW-UP for separate ORCH | (fallback path) |

### §8.5 Build + i18n + tsc

| ID | Scenario | Expected | Maps to SC |
|---|---|---|---|
| T-34 | tsc baseline check | 3 baseline errors only; 0 new | SC-22 |
| T-35 | i18n parity script | All new keys × 29 locales = 0 missing | SC-24 |
| T-36 | Grep banned imports + dead style references | 0 matches for `DescriptionSection` / `HighlightsSection` / `MatchFactorsBreakdown` / `nightOutStyles.` / `styles.overlay` / `styles.modalContainer` | SC-25 + SC-26 |
| T-37 | Grep new tokens | `glass.bottomSheet.handle` etc. present in designSystem.ts | SC-27 |
| T-38 | Mapbox traffic regression | `busynessService.fetchMapboxTraffic` still works | SC-29 |

---

## §9 Implementation order (numbered — implementor follows verbatim)

| # | Step | Files |
|---|---|---|
| **1** | Read full ExpandedCardModal.tsx + all 10 sub-components in scope (per §6.4.2) + MessageInterface.tsx + designSystem.ts + all 8 mount surface JSX. | (read-only) |
| **2** | Add new `glass.bottomSheet.*` + `glass.surfaceDark` tokens to designSystem.ts per §5.3 verbatim. | designSystem.ts |
| **3** | Verify pre-flight gates: tsc baseline at 3 errors; Grep for `Modal` reachability in ExpandedCardModal.tsx (should only be the line 1537 instance + child `<InAppBrowserModal>`/`<ShareModal>`); confirm `<DiscoverMap>` does NOT exist (post-ORCH-0698). | (verify) |
| **4** | Create `EventDetailLayout.tsx` — full layout per §5.2.1-§5.2.5. Implementor writes ~280 LOC. Includes peek state + expanded state + status-aware Get Tickets CTA + secondary action row + About/When&Where/Tags/Seat Map. | EventDetailLayout.tsx (NEW) |
| **5** | Add new i18n keys to en/expanded_details.json per §5.4.1 (after grep dedup). | en/expanded_details.json |
| **6** | Translate all new keys × 28 non-en locales via `scripts/orch-0696-translate-locales.py` (modeled on `scripts/orch-0670-translate-locales.py`). Idempotent. | scripts/orch-0696-translate-locales.py + 28 locale files |
| **7** | Modify ExpandedCardModal.tsx: add new imports per §5.1.1; delete dead imports (lines 36/37/41) + Modal import; add bottomSheetRef + renderBackdrop + visibility-to-snap effects per §5.1.2-§5.1.3. | ExpandedCardModal.tsx |
| **8** | Modify ExpandedCardModal.tsx: replace `<Modal>...</Modal>` JSX (lines 1535-2125) with `<BottomSheet>...</BottomSheet>` skeleton per §5.1.4. Wire EventDetailLayout into render branching. | ExpandedCardModal.tsx |
| **9** | Modify ExpandedCardModal.tsx: delete sticky-bottom CTA JSX (lines 2049-2079) per §5.1.5. | ExpandedCardModal.tsx |
| **10** | Modify ExpandedCardModal.tsx: delete entire `nightOutStyles` block (lines 2132-2388) per §6.5. ~256 LOC deletion. | ExpandedCardModal.tsx |
| **11** | Modify ExpandedCardModal.tsx styles: delete `styles.overlay` + `styles.overlayBackground` + `styles.modalContainer` per §6.3. Re-map `styles.reviewNavBar` per §6.4.4. | ExpandedCardModal.tsx |
| **12** | Re-token 10 sub-components per §6.4.2 — ActionButtons, BusynessSection, CardInfoSection, CompanionStopsSection, ExpandedCardHeader, ImageGallery, PracticalDetailsSection, StopImageGallery, TimelineSection, WeatherSection. Apply mapping table from §6.4.1 to each hardcoded color found via `Grep`. | 10 sub-component files |
| **13** | DELETE 3 dead component files: DescriptionSection.tsx + HighlightsSection.tsx + MatchFactorsBreakdown.tsx per §6.1. | 3 file deletions |
| **14** | Run `cd app-mobile && npx tsc --noEmit` — verify 3 baseline errors only, zero new (gate). | (verify) |
| **15** | First-pass smoke: implementor runs Metro dev build, opens 4 of 8 mount surfaces (chat-shared, Discover, Saved, Solo deck) on iOS + Android, verifies sheet opens, drags work, content renders. | (manual on dev build) |
| **16** | **F-13 LIVE-FIRE GATE (T-31 + T-32):** chat-shared mount × iOS AND Android. Send a card from a friend, recipient taps Save chip, observe toast appears above sheet. Both platforms must pass. | (manual + operator) |
| **17** | **IF AND ONLY IF SC-20 PASS** at step 16: delete Shape 2a Modal hack at `MessageInterface.tsx:1538-1554` per §S-5. Add protective comment per §10.3 if successful. | MessageInterface.tsx |
| **18** | **IF SC-20 FAIL:** preserve Shape 2a hack; add new exit-condition `[ORCH-0696 F-13 NEEDS-FOLLOW-UP]` comment block; flag in IMPL report for orchestrator. | MessageInterface.tsx |
| **19** | Run `cd app-mobile && npx tsc --noEmit` final check — 3 baseline errors only. | (verify) |
| **20** | Operator-driven full smoke matrix T-01 through T-38 on a Metro dev build (16 cells per §8.1 + EventDetailLayout T-17..T-26 + place regression T-27..T-30 + F-13 already done at step 16 + build/i18n/tsc T-34..T-38). | (operator manual) |
| **21** | Write `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0696_REPORT.md` per implementor template — old → new receipts (1 component + 1 NEW + 10 re-tokened + 1 i18n + 28 locales + 1 NEW script + 3 deleted + 1 token namespace = ~45 files) + SC-1..SC-30 verification matrix + transition register (F-13 fallback path if SC-20 failed) + discoveries for orchestrator. | report |

---

## §10 Invariants

### §10.1 Existing invariants — preserved

| ID | Invariant | Status post-fix |
|---|---|---|
| C-1 | No dead taps | UPHELD — every chip + CTA + drag affordance responds |
| C-2 | One owner per truth | STRENGTHENED — `glass.bottomSheet.*` is canonical chrome source |
| C-3 | No silent failures | UPHELD — error / sold-out / presale / TBA states render explicit copy; toast on Add to Calendar failure |
| C-7 | Label temporary fixes | UPHELD — F-13 fallback path explicitly labeled |
| C-8 | Subtract before adding | UPHELD — F-18..F-22 + nightOutStyles + 3 dead components deleted before EventDetailLayout new code |
| C-12 | Validate at right time | UPHELD — render branching at modal entry, not deeper |
| C-14 | Persisted-state startup | UPHELD — sheet handles cold cache normally via existing `isSaved` prop chain |
| **I-LOCALE-CATEGORY-PARITY** (ORCH-0685 cycle-1) | UPHELD — adds new keys per established 29-locale parity contract |

### §10.2 New invariants — none

The redesign is a one-shot chrome + IA change. Future bottom sheets in the app will adopt `glass.bottomSheet.*` tokens by reference; that's structural-prevention enough.

---

## §11 Regression prevention

### §11.1 Structural safeguards

- `glass.bottomSheet.*` token namespace makes future bottom-sheet additions consistent (Constitution #2)
- `EventDetailLayout` extracted to its own file → easier to audit without touching modal chrome
- F-13 SC-20 mandatory live-fire prevents ORCH-0685 cycle-2 dead-tap regression class

### §11.2 Tests

T-31 + T-32 (F-13 live-fire on iOS + Android) are the regression sentinels for chat-shared toast visibility. T-01..T-16 are the per-surface chrome regression sentinels.

### §11.3 Protective comments

Add to ExpandedCardModal.tsx render branching (post-IMPL):
```ts
// [ORCH-0696 S-2 lock-in] Event branch fires on `card.nightOutData != null`
// OR `card.cardType === 'event'`. Do NOT change without spec approval.
// `cardType === 'event'` has 0 callers today (audit-verified) — kept as
// forward-looking guard. Live trigger is `nightOutData != null`.
```

Add to MessageInterface.tsx (post S-5 deletion only if SC-20 PASS):
```ts
// [ORCH-0696 F-13 lock-in] Shape 2a Modal hack deleted post-bottom-sheet
// conversion verified by tester live-fire on iOS + Android (2026-04-29).
// DO NOT re-introduce — toasts now render naturally above @gorhom/bottom-sheet
// (Animated.View, not native Modal portal).
```

If SC-20 fails, add this comment instead at MessageInterface.tsx:1538:
```ts
// [ORCH-0696 F-13 NEEDS-FOLLOW-UP] Shape 2a Modal hack preserved.
// Designer §E-3.3 predicted toasts render above bottom sheet via React-tree
// z-ordering, but live-fire on (iOS|Android) showed toast hidden below sheet
// on (date). New ORCH required to investigate Animated.View overlay behavior
// on (platform). Until resolved, this Modal hack remains the only way to
// surface toasts above the chat-shared ExpandedCardModal.
```

### §11.4 No new CI gate

The redesign is a one-shot structural change. Per-surface chrome inheritance is structurally enforced by absence of override (no `<BottomSheet>` instance in any of the 8 mount-site files — grep verifies). Token consolidation is enforced by the new `glass.bottomSheet.*` namespace. No CI gate needed.

---

## §12 Constitution + invariants checklist (post-fix)

| # | Principle | Pre-fix | Post-fix |
|---|---|---|---|
| 1 | No dead taps | Spirit-fine (sticky CTA is sticky-bottom but works) | UPHELD (structurally same; chip + drag affordances new) |
| 2 | One owner per truth | OK | STRENGTHENED (`glass.bottomSheet.*` canonical) |
| 3 | No silent failures | OK | UPHELD (Add to Calendar surface error explicitly) |
| 4 | One query key per entity | N/A | N/A |
| 5 | Server state stays server-side | OK | OK |
| 6 | Logout clears everything | N/A | N/A |
| 7 | Label temporary fixes | OK | UPHELD (F-13 fallback path labeled) |
| 8 | Subtract before adding | (~256 LOC nightOutStyles + 3 dead components weren't deleted) | STRONGLY UPHELD |
| 9 | No fabricated data | OK | OK |
| 10 | Currency-aware UI | (Slice B currency double-conversion exists) | UNCHANGED |
| 11 | One auth instance | N/A | N/A |
| 12 | Validate at right time | OK | UPHELD |
| 13 | Exclusion consistency | N/A | N/A |
| 14 | Persisted-state startup | OK | OK |

---

## §13 Open questions (BLOCKING IMPL DISPATCH if any)

**NONE.** All 8 audit handoff items resolved verbatim in this spec. F-13 has a fallback path encoded — no operator decision blocks IMPL.

Spec writer flags 2 minor optional items for orchestrator awareness, NOT blocking:

1. **Analytics events from designer §G-D5** — designer recommended 4 new Mixpanel events (`event_detail_opened`, `event_get_tickets_tapped`, `event_added_to_calendar`, `event_modal_dismissed`). NOT included in this spec scope. Operator may approve adding inline during IMPL (~30 min cost) or defer to separate ORCH.

2. **Place IA section ordering preservation** — per §6.4.2 / §6.4.3, the existing Place branch (lines 1775-2045) gets dark-token re-mapped only. Implementor should NOT touch the JSX structure during S-3 work — only style values. Spec recommends a `git diff --stat` check at step 12 to confirm only style entries changed in the place branch JSX.

---

## §14 Output contract

Implementor produces:

- `app-mobile/src/components/ExpandedCardModal.tsx` — chrome swap + nightOutStyles deletion + 3 dead imports + render branching wired (modified)
- `app-mobile/src/components/expandedCard/EventDetailLayout.tsx` — NEW
- `app-mobile/src/components/expandedCard/{ActionButtons, BusynessSection, CardInfoSection, CompanionStopsSection, ExpandedCardHeader, ImageGallery, PracticalDetailsSection, StopImageGallery, TimelineSection, WeatherSection}.tsx` — dark-token re-mapped (10 modified)
- `app-mobile/src/components/expandedCard/{DescriptionSection, HighlightsSection, MatchFactorsBreakdown}.tsx` — DELETED (3 file deletions)
- `app-mobile/src/constants/designSystem.ts` — new `glass.bottomSheet.*` + `glass.surfaceDark` (modified)
- `app-mobile/src/components/MessageInterface.tsx` — Shape 2a deletion (gated) + protective comment (modified)
- `app-mobile/src/i18n/locales/en/expanded_details.json` — new keys (modified)
- `app-mobile/src/i18n/locales/{ar, bin, bn, de, el, es, fr, ha, he, hi, id, ig, it, ja, ko, ms, nl, pl, pt, ro, ru, sv, th, tr, uk, vi, yo, zh}/expanded_details.json` — translated keys (28 modified)
- `scripts/orch-0696-translate-locales.py` — NEW (idempotent translation script per ORCH-0670/0685/0690 precedent)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0696_REPORT.md` — NEW

**Total file deltas:** ~45 files (1 component + 10 re-tokened + 3 deleted + 1 token + 1 i18n + 28 locales + 1 script + 1 modal + 1 report).

**Estimated total wall:** ~9-12h IMPL + 30-45 min operator manual smoke + 10 min EAS Update = **~10-13 hours end-to-end** (matches design §E-12 + audit §12 estimates).

---

## §15 Risk areas

1. **Place layout dark-token re-mapping (S-3, §6.4).** ~70 swaps × 10 files = highest regression risk. Implementor opens each file, runs Grep, applies mapping table verbatim. Tester smoke matrix T-01..T-30 catches misses but only at IMPL completion.

2. **F-13 NEEDS-LIVE-FIRE gate (SC-20).** SC-20 is genuinely uncertain — designer's prediction architecturally well-founded but unverified at runtime. Spec encodes both pass and fail paths. If fail, fallback path preserves Shape 2a hack with a new `[ORCH-0696 F-13 NEEDS-FOLLOW-UP]` exit condition; orchestrator dispatches separate ORCH.

3. **`<ExpandedCardHeader>` retire decision (F-15 / S-6).** Conditional retain on review-flow surfaces (Discover deck + Solo deck only). If ExpandedCardHeader is removed elsewhere AND review-flow surfaces' navigation arrow alignment breaks, the implementor adjusts header height / margin in those 2 surfaces only. Rare path; spec writer recommends visual check on T-03 + T-13 specifically.

4. **`<BottomSheet>` gesture conflicts with inner scroll.** `@gorhom/bottom-sheet` requires `<BottomSheetScrollView>` not regular `<ScrollView>` — implementor MUST replace at line 1582-1586. If missed: scroll content scrolls AND drags sheet simultaneously, fight gestures. This is the most common mistake in `@gorhom/bottom-sheet` adoptions; pattern is well-documented + reference sheets in `MapBottomSheet.tsx` (now deleted by ORCH-0698 — implementor cannot reference it). Spec writer locks at §5.1.4.

5. **Place IA section ordering preservation.** During S-3 token re-map, implementor must NOT touch JSX structure of place fallback branch (lines 1775-2045). Step 12 of IMPL order says "apply mapping table from §6.4.1 to each hardcoded color found via Grep" — color swaps only, not JSX edits. Risk: implementor accidentally moves a section while editing inline `style={...}` props. Mitigation: `git diff --stat ExpandedCardModal.tsx` at step 12 should show only the night-out branch lines + nightOutStyles deletion + style entry changes; if place fallback JSX shows insertion lines, that's a regression.

6. **EventDetailLayout edge cases (status: presale, TBA, sold-out).** Spec writer enumerated all 4 status paths in §5.2.2 step 6 + §8.2 T-17..T-20. Implementor verifies each by mocking `nightOut.ticketStatus` in dev mode if no live event reaches all states.

7. **Date parsing for Add to Calendar (`parseEventDateTime` helper).** TM event time formats vary widely (`"Fri Nov 7"`, `"November 7, 2026"`, `"Tomorrow"`, etc.). Implementor writes a defensive parser; surfaces `t('cards:expanded.calendar_date_parse_error')` on failure rather than fabricating a date. Spec writer locks the failure-path UX in §5.2.5.

---

End of spec.
