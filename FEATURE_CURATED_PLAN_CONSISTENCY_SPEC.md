# Feature: Curated Plan Consistency, Premium Collapsed Card & Smart Scheduling
**Date:** 2026-03-01
**Status:** Planned
**Requested by:** User — "Let saved curated plans retain their expanded structure, redesign collapsed card to be premium, and make the schedule button check opening hours for a user-chosen date/time."

## Summary
Three interconnected improvements to the curated experience (multi-stop itinerary) flow:

1. **Expanded View Consistency** — When a saved curated plan is opened from the Saved tab or Calendar tab, it currently renders as a plain single-place card instead of the CuratedPlanView with the multi-stop timeline. The root cause: `handleCardPress()` and `proceedWithScheduling()` in SavedTab.tsx strip curated-specific fields (`cardType`, `stops`, `tagline`, etc.) when transforming `SavedCard` → `ExpandedCardData`. Fix both transformation points so ExpandedCardModal detects `cardType === 'curated'` and renders CuratedPlanView everywhere.

2. **Premium Collapsed Card** — Curated plans in the Saved tab currently render identically to regular single-place cards (one image, generic stats). Redesign the collapsed card to show a premium multi-stop layout: 3-image strip with numbered badges, all stop names, total price range, total duration, average rating, stop count badge, and the tagline.

3. **Smart Schedule with Opening Hours Validation** — Replace the current "Schedule" button (which only checks `isOpenNow` for a single place) with a proper date/time picker flow. When the user selects a date/time, validate ALL stops' opening hours against that time. If all are open → confirm → add to device calendar → move to Calendar tab. If any stop is closed → show which stop(s) are closed and prompt the user to pick a different time.

## User Stories

**US-1:** As a user, I want to see the full multi-stop plan view when I open a saved curated plan from my Saved or Calendar tabs, so I don't lose the rich experience view.

**US-2:** As a user, I want the saved curated plan card to look premium and informative at a glance, showing all stop names, images, total cost and time, so I can quickly assess it.

**US-3:** As a user, I want to pick a specific date and time for my curated plan, have the app verify all stops are open at that time, and add it to my phone calendar if everything checks out.

---

## Architecture Impact

### Modified Files
| File | Change |
|------|--------|
| `app-mobile/src/components/activity/SavedTab.tsx` | Fix `handleCardPress()` + `proceedWithScheduling()` to preserve curated fields; new `renderCuratedCard()` for premium collapsed layout; new `handleScheduleCurated()` with opening hours validation |
| `app-mobile/src/components/activity/CalendarTab.tsx` | Fix card-press handler to preserve curated fields for ExpandedCardModal |
| `app-mobile/src/components/ExpandedCardModal.tsx` | No changes needed — already handles `cardType === 'curated'` correctly |
| `app-mobile/src/components/activity/ProposeDateTimeModal.tsx` | No changes needed — already supports date/time selection |
| `app-mobile/src/services/deviceCalendarService.ts` | Add `createEventFromCuratedCard()` method for multi-stop calendar events |

### New Files
None — all changes are modifications to existing files.

### External APIs
- **expo-calendar** (already installed) — for device calendar integration
- No new external APIs required

### Database Changes
None — curated card data (including `stops[]` with `openingHours`) is already stored in `card_data` JSONB column of `saved_card` and `calendar_entries` tables.

---

## Part 1: Expanded View Consistency

### Root Cause
In [SavedTab.tsx:1098-1151](app-mobile/src/components/activity/SavedTab.tsx#L1098-L1151), `handleCardPress()` builds an `ExpandedCardData` object but does NOT include:
- `cardType: 'curated'`
- `stops: CuratedStop[]`
- `tagline`, `pairingKey`
- `totalPriceMin`, `totalPriceMax`
- `estimatedDurationMinutes`
- `experienceType`

Same issue in `proceedWithScheduling()` at line 1008-1050.

When `ExpandedCardModal` checks `(card as any).cardType === 'curated'` — it's `undefined` → falls through to regular card layout.

### Fix

In `handleCardPress()`, after building the base `ExpandedCardData`, spread curated-specific fields if the card has `stops`:

```typescript
const handleCardPress = (card: SavedCard) => {
  const matchScore = getMatchScore(card);

  // Detect curated card by presence of stops array
  const isCurated = Array.isArray((card as any).stops) && (card as any).stops.length > 0;

  const expandedCardData: ExpandedCardData = {
    // ... existing base fields ...
    id: card.id,
    title: card.title,
    // ... all existing fields stay the same ...

    // Curated-specific fields (pass through if present)
    ...(isCurated && {
      cardType: 'curated',
      stops: (card as any).stops,
      tagline: (card as any).tagline,
      pairingKey: (card as any).pairingKey,
      totalPriceMin: (card as any).totalPriceMin,
      totalPriceMax: (card as any).totalPriceMax,
      estimatedDurationMinutes: (card as any).estimatedDurationMinutes,
      experienceType: (card as any).experienceType,
      matchScore: (card as any).matchScore,
    }),
  };

  setSelectedCardForModal(expandedCardData);
  setOriginalSavedCard(card);
  setIsModalVisible(true);
};
```

Apply the **identical pattern** in:
1. `proceedWithScheduling()` — the `cardData` construction at line 1008
2. `CalendarTab.tsx` — wherever it opens ExpandedCardModal for a calendar entry

### Verification
- Save a curated plan from the swipe deck
- Open it from the Saved tab → should see CuratedPlanView with stop timeline, NOT regular card
- Schedule it → open from Calendar tab → same CuratedPlanView

---

## Part 2: Premium Collapsed Card for Curated Plans

### Current State
In `renderCard()` (SavedTab.tsx line 1275), ALL cards render identically:
- Single thumbnail image
- Title + category subtitle
- Stats row: rating, travel time, price
- Source badge
- Schedule/Share/Delete buttons

### Redesigned Layout
When `renderCard` detects a curated card (has `stops[]`), render a premium layout:

```
┌─────────────────────────────────────────────┐
│ ┌──────────┬──────────┬──────────┐          │
│ │  IMG 1   │  IMG 2   │  IMG 3   │          │
│ │   ①      │   ②      │   ③      │          │
│ └──────────┴──────────┴──────────┘          │
│                                              │
│  Solo Adventure · 3 Stops                    │
│  Golden Gate Park → Zephyr Cafe → City...    │
│  "Three stops, zero plans needed"            │
│                                              │
│  ⭐ 4.3 avg  ·  ⏱ 2h 30min  ·  💰 $25-$75  │
│                                              │
│  [📅 Schedule Plan]  [↗]  [🗑]              │
└─────────────────────────────────────────────┘
```

**Design specs:**
- **Card background:** Dark gradient (`#1C1C1E` → `#2C2C2E`) with subtle border `rgba(255,255,255,0.08)`
- **Image strip:** 3 images in a row, each with numbered circle badge (amber `#F59E0B`)
- **Experience type badge:** `Solo Adventure` or relevant type, with amber accent
- **Stop count badge:** "3 Stops" pill
- **Title:** All stop names joined with ` → `, white, bold, 2 lines max
- **Tagline:** Card's `tagline` field, muted text `rgba(255,255,255,0.6)`
- **Stats row:** Average rating (star icon), total duration (time icon), total price range (cash icon)
- **Schedule button:** Amber accent (`#F59E0B` background), "Schedule Plan" text

### Implementation

```typescript
const renderCard = ({ item: card }: { item: SavedCard }) => {
  const isCurated = Array.isArray((card as any).stops) && (card as any).stops.length > 0;

  if (isCurated) {
    return renderCuratedCard(card);
  }

  // ... existing regular card rendering ...
};

const renderCuratedCard = (card: SavedCard) => {
  const stops = (card as any).stops as CuratedStop[];
  const avgRating = (stops.reduce((s, st) => s + st.rating, 0) / stops.length).toFixed(1);
  const totalPrice = `$${(card as any).totalPriceMin ?? 0}–$${(card as any).totalPriceMax ?? 0}`;
  const totalMin = (card as any).estimatedDurationMinutes ?? 0;
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  const durationLabel = hrs > 0 ? `${hrs}h ${mins > 0 ? mins + 'min' : ''}` : `${mins}min`;
  const experienceLabel = ((card as any).experienceType || 'solo-adventure')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (l: string) => l.toUpperCase());

  return (
    <View style={curatedSavedStyles.card}>
      {/* 3-image strip */}
      <View style={curatedSavedStyles.imageStrip}>
        {stops.slice(0, 3).map((stop, idx) => (
          <View key={stop.placeId} style={curatedSavedStyles.imageContainer}>
            <ImageWithFallback
              source={{ uri: stop.imageUrl }}
              alt={stop.placeName}
              style={curatedSavedStyles.stopImage}
            />
            <View style={curatedSavedStyles.stopBadge}>
              <Text style={curatedSavedStyles.stopBadgeText}>{idx + 1}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Content */}
      <TouchableOpacity onPress={() => handleCardPress(card)} activeOpacity={0.7}>
        <View style={curatedSavedStyles.content}>
          {/* Type + stop count */}
          <View style={curatedSavedStyles.badgeRow}>
            <View style={curatedSavedStyles.typeBadge}>
              <Ionicons name="map-outline" size={12} color="#F59E0B" />
              <Text style={curatedSavedStyles.typeBadgeText}>{experienceLabel}</Text>
            </View>
            <View style={curatedSavedStyles.stopCountBadge}>
              <Text style={curatedSavedStyles.stopCountText}>{stops.length} Stops</Text>
            </View>
          </View>

          {/* Title: stop names joined */}
          <Text style={curatedSavedStyles.title} numberOfLines={2}>
            {stops.map(s => s.placeName).join(' → ')}
          </Text>

          {/* Tagline */}
          {(card as any).tagline && (
            <Text style={curatedSavedStyles.tagline} numberOfLines={1}>
              {(card as any).tagline}
            </Text>
          )}

          {/* Stats row */}
          <View style={curatedSavedStyles.statsRow}>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="star" size={13} color="#F59E0B" />
              <Text style={curatedSavedStyles.statText}>{avgRating} avg</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={curatedSavedStyles.statText}>{durationLabel}</Text>
            </View>
            <Text style={curatedSavedStyles.statDot}>·</Text>
            <View style={curatedSavedStyles.statItem}>
              <Ionicons name="cash-outline" size={13} color="rgba(255,255,255,0.6)" />
              <Text style={curatedSavedStyles.statText}>{totalPrice}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      {/* Actions */}
      <View style={curatedSavedStyles.actions}>
        <TouchableOpacity
          onPress={() => handleScheduleCurated(card)}
          style={curatedSavedStyles.scheduleButton}
        >
          <Ionicons name="calendar" size={16} color="#1C1C1E" />
          <Text style={curatedSavedStyles.scheduleButtonText}>Schedule Plan</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onShareCard(card)} style={curatedSavedStyles.iconButton}>
          <Ionicons name="share-social-outline" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleRemoveSaved(card)} style={curatedSavedStyles.iconButton}>
          <Ionicons name="trash-outline" size={18} color="rgba(255,255,255,0.7)" />
        </TouchableOpacity>
      </View>
    </View>
  );
};
```

**StyleSheet for premium curated card:**
```typescript
const curatedSavedStyles = StyleSheet.create({
  card: {
    backgroundColor: '#1C1C1E',
    borderRadius: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  imageStrip: {
    flexDirection: 'row',
    height: 100,
  },
  imageContainer: {
    flex: 1,
    position: 'relative',
  },
  stopImage: {
    width: '100%',
    height: '100%',
  },
  stopBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  content: {
    padding: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  typeBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#F59E0B',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  stopCountBadge: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  stopCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.5)',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 4,
    lineHeight: 22,
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.5)',
    fontStyle: 'italic',
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '500',
  },
  statDot: {
    color: 'rgba(255,255,255,0.3)',
    marginHorizontal: 6,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  scheduleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F59E0B',
    paddingVertical: 10,
    borderRadius: 10,
  },
  scheduleButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
```

---

## Part 3: Smart Schedule with Opening Hours Validation

### Current Behavior
- `handleSchedule()` checks ONLY `isOpenNow` for a single place (not stops)
- Uses `ProposeDateTimeModal` to pick date/time
- `proceedWithScheduling()` immediately creates calendar entry without validating stop hours

### New Behavior

#### Flow
```
User taps "Schedule Plan"
    ↓
ProposeDateTimeModal opens (existing component — supports Now, Today, Weekend, Custom)
    ↓
User selects date + time → handleProposeDateTime() fires
    ↓
NEW: checkAllStopsOpen(stops, selectedDateTime)
    ├── All stops open → Show confirmation Alert:
    │     "All 3 stops are open at [time]! Add to your calendar?"
    │     [Yes] → proceedWithScheduling() → device calendar → Calendar tab
    │     [No]  → dismiss
    │
    └── One or more stops closed → Show Alert:
          "Some stops aren't open at [time]:
           • Zephyr Cafe (closed Sundays)
           • City Lights (opens 10 AM)
           Please choose a different time."
          [Choose New Time] → reopen ProposeDateTimeModal
          [Cancel] → dismiss
```

#### Opening Hours Validation Logic

Each `CuratedStop` has `openingHours: Record<string, string>` like:
```json
{
  "Monday": "9:00 AM – 5:00 PM",
  "Tuesday": "9:00 AM – 5:00 PM",
  "Sunday": "Closed"
}
```

**Validation function:**

```typescript
interface StopAvailability {
  stopName: string;
  isOpen: boolean;
  reason?: string; // e.g., "Closed on Sundays", "Opens at 10:00 AM"
}

function checkAllStopsOpen(
  stops: CuratedStop[],
  scheduledDate: Date
): { allOpen: boolean; results: StopAvailability[] } {
  const dayName = scheduledDate.toLocaleDateString('en-US', { weekday: 'long' });
  const scheduledHour = scheduledDate.getHours();
  const scheduledMinute = scheduledDate.getMinutes();
  const scheduledTotalMinutes = scheduledHour * 60 + scheduledMinute;

  const results: StopAvailability[] = stops.map(stop => {
    const hoursString = stop.openingHours[dayName];

    // No hours data — assume open (can't validate)
    if (!hoursString) {
      return { stopName: stop.placeName, isOpen: true };
    }

    // Explicitly closed
    if (hoursString.toLowerCase() === 'closed') {
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Closed on ${dayName}s`,
      };
    }

    // Parse "9:00 AM – 5:00 PM" format
    const match = hoursString.match(
      /(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*[–-]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i
    );
    if (!match) {
      return { stopName: stop.placeName, isOpen: true }; // Can't parse → assume open
    }

    const openHour = to24Hour(parseInt(match[1]), match[3]);
    const openMinute = parseInt(match[2] || '0');
    const closeHour = to24Hour(parseInt(match[4]), match[6]);
    const closeMinute = parseInt(match[5] || '0');

    const openTotal = openHour * 60 + openMinute;
    const closeTotal = closeHour * 60 + closeMinute;

    // Account for cumulative offset: this stop starts after previous travel + activity
    // For simplicity, check if the stop's time slot falls within open hours
    // (The edge function already calculates estimatedDurationMinutes per stop)

    if (scheduledTotalMinutes < openTotal) {
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Opens at ${match[1]}:${match[2] || '00'} ${match[3]}`,
      };
    }

    if (scheduledTotalMinutes >= closeTotal) {
      return {
        stopName: stop.placeName,
        isOpen: false,
        reason: `Closes at ${match[4]}:${match[5] || '00'} ${match[6]}`,
      };
    }

    return { stopName: stop.placeName, isOpen: true };
  });

  return {
    allOpen: results.every(r => r.isOpen),
    results,
  };
}

// Helper
function to24Hour(hour: number, ampm: string): number {
  const isPM = ampm.toUpperCase() === 'PM';
  if (hour === 12) return isPM ? 12 : 0;
  return isPM ? hour + 12 : hour;
}
```

**Important: Offset-aware validation**

For a 3-stop itinerary, the user's chosen time is the START time. Each subsequent stop starts after the previous stop's duration + travel time. The validation must check each stop against its actual estimated arrival time:

```typescript
function checkAllStopsOpenWithOffsets(
  stops: CuratedStop[],
  startTime: Date
): { allOpen: boolean; results: StopAvailability[] } {
  let cumulativeMinutes = 0;

  const results: StopAvailability[] = stops.map((stop, idx) => {
    // Calculate this stop's estimated arrival time
    const arrivalTime = new Date(startTime.getTime() + cumulativeMinutes * 60000);

    // Validate against this stop's opening hours at arrival time
    const availability = checkSingleStopOpen(stop, arrivalTime);

    // Add this stop's duration + next travel time for the next stop
    cumulativeMinutes += (stop.estimatedDurationMinutes ?? 45);
    if (idx < stops.length - 1 && stops[idx + 1].travelTimeFromPreviousStopMin) {
      cumulativeMinutes += stops[idx + 1].travelTimeFromPreviousStopMin!;
    }

    return availability;
  });

  return {
    allOpen: results.every(r => r.isOpen),
    results,
  };
}
```

### Device Calendar Event for Curated Plan

Add to `DeviceCalendarService`:

```typescript
static createEventFromCuratedCard(
  card: any, // CuratedExperienceCard
  startDate: Date,
  totalDurationMinutes: number
): DeviceCalendarEvent {
  const stops = card.stops || [];
  const stopNames = stops.map((s: any) => s.placeName).join(' → ');
  const notes = stops
    .map((s: any, i: number) => `Stop ${i + 1}: ${s.placeName}\n${s.address}`)
    .join('\n\n');

  return {
    title: `Mingla: ${card.title || stopNames}`,
    startDate,
    endDate: new Date(startDate.getTime() + totalDurationMinutes * 60000),
    notes: `${card.tagline || ''}\n\n${notes}`,
    location: stops[0]?.address || '',
    alarms: [{ relativeOffset: -30, method: Calendar.AlarmMethod.ALERT }],
  };
}
```

---

## Test Cases

### Part 1: Expanded View Consistency
1. **Swipe → Save → Open from Saved tab** — Save a curated plan by swiping right, switch to Likes → Saved tab, tap it. Expected: CuratedPlanView renders with all stops, travel connectors, and timeline.
2. **Schedule → Open from Calendar tab** — Schedule a curated plan, switch to Calendar tab, tap it. Expected: CuratedPlanView renders (not regular card layout).
3. **All stop data preserved** — Verify opening hours, images, ratings, AI descriptions are all visible in the saved/calendar expanded view.

### Part 2: Premium Collapsed Card
4. **Visual distinction** — In Saved tab, curated plans render with dark card, 3-image strip, and stop names. Regular cards render with light card and single image.
5. **Data accuracy** — Verify average rating, total duration, total price, and stop count displayed correctly.
6. **Truncation** — Long stop names truncate gracefully with `→` separators.

### Part 3: Smart Scheduling
7. **All stops open** — Pick a Wednesday at 2 PM for a plan where all stops are open mid-day. Expected: confirmation prompt → user confirms → added to device calendar + Calendar tab.
8. **One stop closed** — Pick a Sunday for a plan where one stop is closed Sundays. Expected: alert shows closed stop name + reason → "Choose New Time" reopens picker.
9. **Stop opens later** — Pick 7 AM for a plan where stop 2 opens at 10 AM. Expected: alert shows "Opens at 10:00 AM" for that stop.
10. **No opening hours data** — Some stops may lack `openingHours`. Expected: those stops are treated as "open" (no false negatives).
11. **Offset-aware check** — Pick 4 PM for a plan where stop 1 takes 60 min + 15 min travel, and stop 2 closes at 5 PM, and stop 2 takes 45 min. Stop 2 arrival = 5:15 PM. Expected: alert shows stop 2 is closed.
12. **Device calendar event** — After scheduling, check phone calendar. Expected: event with curated plan title, all stop addresses in notes, correct duration.

---

## Success Criteria
- [ ] Saved curated plans open with CuratedPlanView (stops + timeline) from both Saved and Calendar tabs
- [ ] Curated cards in Saved tab render with premium dark multi-stop layout distinct from regular cards
- [ ] Schedule button opens date/time picker, validates all stops' opening hours with time offsets
- [ ] Closed stops are listed by name with reason in the alert
- [ ] Successful scheduling adds multi-stop event to device calendar with all stop info
- [ ] Scheduled curated plan appears in Calendar tab and is removed from Saved tab
- [ ] Regular (non-curated) cards continue to work exactly as before (no regressions)
