# Feature: Curated Plan View — Animated Timeline with Stop Detail Accordions
**Date:** 2026-02-28
**Status:** Planned
**Requested by:** When expanding a curated experience card, show an animated stop-by-stop timeline where each stop is a toggleable accordion revealing AI description, opening hours with live open/closed status, address, travel time, and a "Reserve" button for fine-dining stops that opens the venue website in an in-app browser.

---

## Summary

The `CuratedPlanView` component (currently a private component inside `ExpandedCardModal.tsx`) renders a static list of stops. This feature upgrades it to an **animated accordion timeline**: each stop fades and slides in with a staggered delay on mount, then has a chevron toggle the user taps to expand a detail section. The detail section shows an AI-generated narrative description of the stop, the venue's opening hours with today's hours prominently displayed and a live Open/Closed badge, the full address, and — for fine-dining venue types only — a "Reserve" button that opens the venue's website in a full `react-native-webview` modal.

Between stops, the existing travel connector shows travel time from the previous stop. At the bottom of all stops, a summary block shows the **total estimated time** broken down as (sum of stop durations) + (sum of travel legs) displayed as "X hr Y min total."

The AI descriptions are generated server-side in the `generate-curated-experiences` edge function using a single batched OpenAI call for all three stops, keeping the API key secure and the mobile payload complete on first load.

---

## User Story

As a user exploring a Solo Adventure curated plan, I want to tap each stop and see a rich description of what to do there, today's opening hours, and — if it's a nice restaurant — a way to reserve a table, so I can plan and book the whole day from within Mingla.

---

## Architecture Impact

- **New files:**
  - `app-mobile/src/components/InAppBrowserModal.tsx` — generic in-app browser modal using `react-native-webview`

- **Modified files:**
  - `app-mobile/src/types/curatedExperience.ts` — add `aiDescription` and `estimatedDurationMinutes` to `CuratedStop`
  - `supabase/functions/generate-curated-experiences/index.ts` — add OpenAI call to generate per-stop descriptions; add `estimatedDurationMinutes` per stop
  - `app-mobile/src/components/ExpandedCardModal.tsx` — rewrite the `CuratedPlanView` private component with animated timeline, accordions, fine-dining reserve button, total time footer

- **New DB tables/columns:** None — all new data is generated at query time and returned in the API payload.

- **New edge functions:** None — extending `generate-curated-experiences`.

- **External APIs:** OpenAI GPT-4o-mini (already used in other edge functions via `OPENAI_API_KEY` env var, already provisioned).

---

## Database Changes

None required.

---

## Edge Function Changes

### `generate-curated-experiences/index.ts`

**New constant — stop duration estimates by place type:**
```typescript
const STOP_DURATION_MINUTES: Record<string, number> = {
  // Nature
  park: 60, botanical_garden: 60, hiking_area: 90, beach: 90,
  zoo: 120, national_park: 90, state_park: 90,
  // Food & Drink
  coffee_shop: 30, tea_house: 30, brunch_restaurant: 60, diner: 45,
  bar: 60, pub: 60, wine_bar: 60, food_court: 30, sandwich_shop: 30,
  seafood_restaurant: 60, vegan_restaurant: 60, pizza_restaurant: 45,
  thai_restaurant: 60, japanese_restaurant: 60, ramen_restaurant: 45,
  korean_restaurant: 60, vietnamese_restaurant: 60, mexican_restaurant: 60,
  american_restaurant: 60, mediterranean_restaurant: 60, italian_restaurant: 75,
  french_restaurant: 90, greek_restaurant: 75, steak_house: 90,
  fine_dining_restaurant: 90, upscale_restaurant: 90, chef_led_restaurant: 90,
  // Entertainment / Activities
  movie_theater: 150, art_gallery: 60, museum: 90, planetarium: 60,
  escape_room: 75, bowling_alley: 60, mini_golf_course: 45, karaoke: 90,
  comedy_club: 90, board_game_cafe: 90, video_arcade: 60,
  rock_climbing_gym: 90, trampoline_park: 60, ice_skating_rink: 60,
  virtual_reality_center: 60, billiards_hall: 60,
  sip_and_paint: 120, pottery: 90, cooking_classes: 120,
  flower_arranging_studio: 60,
};
const DEFAULT_STOP_DURATION = 45;
```

**New function — `generateStopDescriptions()`:**
```typescript
async function generateStopDescriptions(
  stops: any[],
  experienceType: string
): Promise<string[]>
```

- Makes ONE OpenAI call for all stops (cost-efficient).
- Prompt: tells GPT-4o-mini the experience type and stop details (name, type, rating), asks for one short paragraph (2–3 sentences) per stop describing what to do there and the vibe.
- Returns array of strings in same order as stops.
- On error, returns fallback strings like `"A great spot to visit on your ${experienceType} day."`.
- Uses `gpt-4o-mini` with `max_tokens: 400`, `temperature: 0.8`.

**Changes to `resolvePairing()`:**
After building the stops array and computing travel times, call `generateStopDescriptions(stops, experienceType)` and add:
- `stop.aiDescription = descriptions[i]`
- `stop.estimatedDurationMinutes = STOP_DURATION_MINUTES[stop.placeType] ?? DEFAULT_STOP_DURATION`

**Updated `estimatedDurationMinutes` on the card:**
Replace the current `travelTotal + 210` with:
```typescript
const stopDurationTotal = stops.reduce((s, st) => s + st.estimatedDurationMinutes, 0);
estimatedDurationMinutes: travelTotal + stopDurationTotal
```

---

## Type Changes

### `app-mobile/src/types/curatedExperience.ts`

Add two fields to `CuratedStop`:
```typescript
aiDescription: string;          // AI-generated 2-3 sentence narrative for this stop
estimatedDurationMinutes: number; // Expected time to spend at this stop
```

---

## New Component Spec

### `app-mobile/src/components/InAppBrowserModal.tsx`

**Purpose:** Generic in-app browser that opens any URL. Used for venue reservation pages.

**Props:**
```typescript
interface InAppBrowserModalProps {
  visible: boolean;
  url: string;
  title: string;
  onClose: () => void;
}
```

**Behavior:**
- Full-screen `Modal` with `animationType="slide"` and `presentationStyle="pageSheet"`.
- Header row: back-arrow close button on the left, title (venue name) centered, nothing on right.
- `WebView` fills remaining height, `source={{ uri: url }}`.
- Loading spinner overlay while `isLoading` is true (use `onLoadStart` / `onLoadEnd`).
- Header background: `#1a1a2e` (matches app dark theme). Title text: white, 15pt semibold.
- Uses existing `react-native-webview` package (already installed, used by `GoogleOAuthWebView`).

---

## Modified Component Spec

### `CuratedPlanView` (private component in `ExpandedCardModal.tsx`)

#### New local state:
```typescript
const [expandedStops, setExpandedStops] = useState<Set<number>>(new Set());
const [browserUrl, setBrowserUrl] = useState<string | null>(null);
const [browserTitle, setBrowserTitle] = useState('');
```

#### Stagger animation (mount effect):
```typescript
const stopAnims = useRef(card.stops.map(() => new Animated.Value(0))).current;

useEffect(() => {
  Animated.stagger(
    120,
    stopAnims.map(anim =>
      Animated.timing(anim, { toValue: 1, duration: 350, useNativeDriver: true })
    )
  ).start();
}, []);
```

Each stop card is wrapped in `<Animated.View>` with:
```typescript
style={{
  opacity: stopAnims[idx],
  transform: [{ translateY: stopAnims[idx].interpolate({ inputRange: [0,1], outputRange: [24, 0] }) }],
}}
```

#### Accordion toggle per stop:
```typescript
const toggleStop = (stopNumber: number) => {
  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  setExpandedStops(prev => {
    const next = new Set(prev);
    next.has(stopNumber) ? next.delete(stopNumber) : next.add(stopNumber);
    return next;
  });
};
```

The stop card header row (place name + chevron) is a `TouchableOpacity` that calls `toggleStop(stop.stopNumber)`. Chevron is `chevron-down-outline` / `chevron-up-outline` based on expanded state.

#### Expanded stop detail section (visible when `expandedStops.has(stop.stopNumber)`):
Rendered inline, no extra component needed.

Contains (in order):
1. **AI Description** — `stop.aiDescription` in a body text style.
2. **Opening Hours** — iterate `Object.entries(stop.openingHours)`. Highlight today's day name. Show as "Mon 9:00 AM – 10:00 PM". Use `new Date().toLocaleDateString('en-US', { weekday: 'long' })` to get today's full day name (e.g., "Saturday"), then check if the key matches. Open/Closed badge uses `stop.isOpenNow`: green chip "Open Now" or red chip "Closed".
3. **Address** — `stop.address` with location pin icon (already exists in collapsed view, move it here into expanded).
4. **Reserve button** (fine dining only) — shown only if `FINE_DINING_TYPES.has(stop.placeType)` AND `stop.website` is non-null. Button label: "Reserve a Table". On press: `setBrowserTitle(stop.placeName); setBrowserUrl(stop.website)`.

#### Fine dining type set:
```typescript
const FINE_DINING_TYPES = new Set([
  'fine_dining_restaurant',
  'steak_house',
  'french_restaurant',
  'greek_restaurant',
  'italian_restaurant',
  'chef_led_restaurant',
  'upscale_restaurant',
]);
```

#### Total time estimate footer (after all stops):
```typescript
const totalStopMinutes = card.stops.reduce((s, st) => s + st.estimatedDurationMinutes, 0);
const totalTravelMinutes = card.stops
  .slice(1)
  .reduce((s, st) => s + (st.travelTimeFromPreviousStopMin ?? 0), 0);
const grandTotal = totalStopMinutes + totalTravelMinutes;
const totalHrs = Math.floor(grandTotal / 60);
const totalMins = grandTotal % 60;
```

Displayed as a card/footer block below the last stop, with:
- Label: "Total Time Estimate"
- Value: `${totalHrs > 0 ? totalHrs + 'h ' : ''}${totalMins}min`
- Sub-breakdown: `${totalStopMinutes}min at stops + ${totalTravelMinutes}min travel`
- Icon: `time-outline`

#### `InAppBrowserModal` at bottom of return:
```tsx
<InAppBrowserModal
  visible={browserUrl !== null}
  url={browserUrl ?? ''}
  title={browserTitle}
  onClose={() => setBrowserUrl(null)}
/>
```

---

## Test Cases

1. **Animation plays on open:** Open any curated card — stops should fade and slide up sequentially with ~120ms stagger. First stop appears immediately, second at 120ms, third at 240ms.

2. **Accordion toggles:** Tap any stop header → detail section animates open showing description, hours, address. Tap again → collapses. Multiple stops can be open simultaneously.

3. **Opening hours today highlight:** If today is Saturday and `openingHours.Saturday` exists, that row is shown in white/bold; other days in muted color.

4. **Reserve button appears for fine dining only:** A stop with `placeType: 'steak_house'` and `website: 'https://...'` shows the Reserve button. A stop with `placeType: 'park'` does not.

5. **In-app browser opens:** Tap "Reserve a Table" → `InAppBrowserModal` opens full-screen with the venue URL loaded in WebView. Close button dismisses it.

6. **Total time footer:** With 3 stops of 60/45/90 min and travel of 10/15 min → footer shows "3h 40min" with "195min at stops + 25min travel".

7. **AI description present:** Every stop in the expanded section has a 2–3 sentence non-empty description (either AI-generated or fallback).

8. **No crash if website null:** A fine-dining stop with `website: null` does NOT show the Reserve button (guard exists).

---

## Success Criteria

- [ ] Stops animate in with staggered entry on card expand
- [ ] Each stop has a tap-to-expand accordion
- [ ] AI-written description visible in expanded section
- [ ] Opening hours shown with today's day highlighted and Open/Closed badge
- [ ] Fine-dining stops with website show "Reserve a Table" button
- [ ] Reserve button opens venue website in full-screen in-app WebView modal
- [ ] Travel connectors between stops show time + mode icon
- [ ] Total time estimate footer shows after all stops
- [ ] No TypeScript errors
- [ ] No regression in non-curated card flow
