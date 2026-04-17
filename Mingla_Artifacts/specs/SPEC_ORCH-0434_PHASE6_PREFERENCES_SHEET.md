# SPEC: ORCH-0434 Phase 6 — Preferences Sheet Redesign

**Version:** 1.0
**Date:** 2026-04-15
**Status:** Awaiting Review
**Source:** INVESTIGATION_ORCH-0434_PHASE6_PREFERENCES_SHEET.md
**Binding:** YES — implementor follows exactly, tester verifies against

---

## Scope

Rewrite the Preferences Sheet UI: new section order, intent/category toggles, multi-day
calendar, remove budget/time slots, 8 category pills. Premium styling with Mingla design
tokens. Both solo and collab modes.

## Non-Goals

- Changing the save pipeline (AppHandlers.handleSavePreferences stays as-is)
- Changing the DB schema (columns stay, Phase 9 drops dead ones)
- Redesigning the Starting Point section (GPS/search — works fine, just moves to position 1)
- Redesigning travel mode/limit sections (work fine, just group under "Getting There")
- Adding new edge function endpoints

---

## 1. Component Architecture

### File Structure

```
app-mobile/src/components/
├── PreferencesSheet.tsx                    ← REWRITE (main orchestrator)
├── PreferencesSheet/
│   ├── PreferencesSections.tsx             ← REWRITE (remove time slots, update categories)
│   ├── PreferencesSectionsAdvanced.tsx     ← KEEP as-is
│   ├── WhenSection.tsx                    ← NEW (date pills + multi-day calendar)
│   └── ToggleSection.tsx                  ← NEW (reusable toggle wrapper)
├── ui/
│   └── MultiDayCalendar.tsx               ← NEW (replaces calendar.tsx stub)
```

---

## 2. MultiDayCalendar Component

**File:** `app-mobile/src/components/ui/MultiDayCalendar.tsx`

**Approach:** Build from scratch (no `react-native-calendars` — not in dependencies, adding
a full calendar library for one component is over-engineered). A minimal month-view grid
is ~150 lines.

### Props Interface

```typescript
interface MultiDayCalendarProps {
  selectedDates: string[];                    // ISO date strings: ['2026-04-16']
  onDatesChange: (dates: string[]) => void;  // Called on every tap
  minDate?: Date;                             // Defaults to today
  maxDate?: Date;                             // Defaults to 30 days from today
}
```

### Internal State

```typescript
const [displayMonth, setDisplayMonth] = useState<Date>(new Date()); // Current month view
```

### Visual Layout

```
┌─────────────────────────────────┐
│  ◄  April 2026  ►              │
├────┬────┬────┬────┬────┬────┬────┤
│ Su │ Mo │ Tu │ We │ Th │ Fr │ Sa │
├────┼────┼────┼────┼────┼────┼────┤
│    │    │    │  1 │  2 │  3 │  4 │
│  5 │ [6]│  7 │  8 │  9 │ 10 │ 11 │
│ 12 │ 13 │ 14 │ 15 │[16]│[17]│ 18 │
│ 19 │ 20 │ 21 │ 22 │ 23 │ 24 │ 25 │
│ 26 │ 27 │ 28 │ 29 │ 30 │    │    │
└────┴────┴────┴────┴────┴────┴────┘
[6] [16] [17] = selected dates (highlighted)
```

### Day Cell States

| State | Background | Text Color | Pressable | Design Token |
|-------|-----------|------------|-----------|-------------|
| Normal (future) | transparent | `colors.text.primary` | YES | — |
| Today (not selected) | `colors.primary[50]` | `colors.primary[600]` | YES | — |
| Selected | `colors.accent` (#eb7825) | `colors.text.inverse` (#fff) | YES | — |
| Disabled (past) | transparent | `colors.gray[300]` | NO | opacity 0.4 |
| Outside month | hidden | — | NO | — |

### Interaction

- **Tap a future date:** Toggle selected/deselected. Add/remove from `selectedDates` array.
- **Tap a past date:** No-op (visually disabled).
- **Tap today:** Selectable.
- **Month nav:** `◄` goes to previous month (but never before current month). `►` goes to next month (max 2 months ahead = ~60 days).

### Accessibility

- Each day cell: `accessibilityLabel="{Month} {Day}, {Year}"`, `accessibilityState={{ selected, disabled }}`
- Month nav buttons: `accessibilityLabel="Previous month"` / `"Next month"`

### Styling Tokens

- Month header: `typography.lg`, `fontWeights.semibold`, `colors.text.primary`
- Day of week headers: `typography.xs`, `fontWeights.medium`, `colors.text.tertiary`
- Day cells: `typography.sm`, `fontWeights.regular` (normal) / `fontWeights.semibold` (selected)
- Selected circle: `radius.full` (999), 36×36
- Nav arrows: `colors.text.secondary`, 24×24 touch target 44×44
- Container: `spacing.md` padding, `colors.background.primary` bg

---

## 3. ToggleSection Component

**File:** `app-mobile/src/components/PreferencesSheet/ToggleSection.tsx`

### Props Interface

```typescript
interface ToggleSectionProps {
  title: string;
  subtitle: string;
  isOn: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean;       // Prevents toggling OFF when it's the last active toggle
  children: React.ReactNode; // The pills content
}
```

### Behavior

- Renders a row: title + subtitle on left, switch on right
- When `isOn`: children rendered, animated in with `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)`
- When `!isOn`: children hidden (height 0, overflow hidden)
- When `disabled` and user tries to toggle OFF: no-op + short shake animation or toast

### Styling Tokens

- Title: `typography.md`, `fontWeights.semibold`, `colors.text.primary`
- Subtitle: `typography.sm`, `fontWeights.regular`, `colors.text.tertiary`
- Switch track ON: `colors.accent` (#eb7825)
- Switch track OFF: `colors.gray[300]`
- Container: `spacing.md` horizontal padding, `spacing.sm` vertical between title and pills

---

## 4. WhenSection Component

**File:** `app-mobile/src/components/PreferencesSheet/WhenSection.tsx`

### Props Interface

```typescript
interface WhenSectionProps {
  dateOption: DateOptionId | null;
  onDateOptionChange: (option: DateOptionId) => void;
  selectedDates: string[];
  onDatesChange: (dates: string[]) => void;
}

type DateOptionId = 'today' | 'this_weekend' | 'pick_dates';
```

### Renders

1. Section title: `t('preferences:datetime.title')` ("When")
2. Section subtitle: `t('preferences:datetime.question')` ("When are you heading out?")
3. Three pills in a row:
   - Today — `t('preferences:date_options.today')`
   - This Weekend — `t('preferences:date_options.this_weekend')`
   - Pick Date(s) — `t('preferences:date_options.pick_dates')`
4. If "This Weekend" selected: weekend info card (reuse existing pattern)
5. If "Pick Date(s)" selected: `<MultiDayCalendar>` rendered inline below the pills

### Pill Styling

| State | Background | Text | Border |
|-------|-----------|------|--------|
| Unselected | `colors.background.tertiary` | `colors.text.secondary` | none |
| Selected | `colors.accent` | `colors.text.inverse` | none |

Pill shape: `radius.lg` (16), `spacing.sm` vertical padding, `spacing.md` horizontal padding

---

## 5. Section Order (JSX structure)

```tsx
<KeyboardAwareScrollView>
  {/* 1. Starting Point */}
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{t('preferences:starting_point.title')}</Text>
    <Text style={styles.sectionSubtitle}>{t('preferences:starting_point.subtitle')}</Text>
    <LocationInputSection ... />
  </View>

  {/* 2. When */}
  <WhenSection
    dateOption={selectedDateOption}
    onDateOptionChange={handleDateOptionChange}
    selectedDates={selectedDates}
    onDatesChange={setSelectedDates}
  />

  {/* 3. Intents */}
  <ToggleSection
    title={t('preferences:intents_toggle.title')}
    subtitle={t('preferences:intents_toggle.subtitle')}
    isOn={intentToggle}
    onToggle={handleIntentToggleChange}
    disabled={!categoryToggle}
  >
    <ExperienceTypesSection ... />
  </ToggleSection>

  {/* 4. Categories */}
  <ToggleSection
    title={t('preferences:categories_toggle.title')}
    subtitle={t('preferences:categories_toggle.subtitle')}
    isOn={categoryToggle}
    onToggle={handleCategoryToggleChange}
    disabled={!intentToggle}
  >
    <CategoriesSection ... />
  </ToggleSection>

  {/* 5. Getting There */}
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{t('preferences:travel_mode.title')}</Text>
    <TravelModeSection ... />
    <TravelLimitSection ... />
  </View>
</KeyboardAwareScrollView>
```

---

## 6. State Variables (complete list)

### KEEP (exact same names)

| Variable | Type | Default |
|----------|------|---------|
| `selectedIntents` | `string[]` | `[]` |
| `selectedCategories` | `string[]` | `[]` |
| `selectedDate` | `Date \| null` | `null` |
| `showCalendar` | `boolean` | `false` |
| `travelMode` | `string` | `'walking'` |
| `constraintValue` | `number \| ""` | `30` |
| `useLocation` | `"gps" \| "search"` | `"gps"` |
| `searchLocation` | `string` | `""` |
| `useGpsLocation` | `boolean` | `true` |
| `selectedCoords` | `{lat,lng} \| null` | `null` |
| `isSaving` | `boolean` | `false` |
| `initialPreferences` | `any` | `null` |
| `minSelectionMessage` | `boolean` | `false` |
| `suggestions` | `AutocompleteSuggestion[]` | `[]` |
| `isLoadingSuggestions` | `boolean` | `false` |
| `showSuggestions` | `boolean` | `false` |
| `isInputFocused` | `boolean` | `false` |

### REMOVE

| Variable | Reason |
|----------|--------|
| `selectedPriceTiers` | Budget removed |
| `selectedTimeSlots` | Time slots removed |

### ADD

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `intentToggle` | `boolean` | `true` | Intent section ON/OFF |
| `categoryToggle` | `boolean` | `true` | Category section ON/OFF |
| `selectedDates` | `string[]` | `[]` | Multi-day date selections (ISO strings) |

### REWRITE

| Variable | Old Type | New Type | New Default |
|----------|----------|----------|-------------|
| `selectedDateOption` | `DateOption \| null` = `"Now"` | `DateOptionId \| null` = `'today'` | `'today'` |

---

## 7. Constants to Replace

### `categories` array (line 88-101) → REPLACE

```typescript
const categories = [
  { id: 'nature',             label: 'Nature & Views',         icon: 'trees' },
  { id: 'icebreakers',        label: 'Icebreakers',            icon: 'sparkles' },
  { id: 'drinks_and_music',   label: 'Drinks & Music',         icon: 'wine-outline' },
  { id: 'brunch_lunch_casual',label: 'Brunch, Lunch & Casual', icon: 'utensils-crossed' },
  { id: 'upscale_fine_dining',label: 'Upscale & Fine Dining',  icon: 'chef-hat' },
  { id: 'movies_theatre',     label: 'Movies & Theatre',       icon: 'film-new' },
  { id: 'creative_arts',      label: 'Creative & Arts',        icon: 'color-palette-outline' },
  { id: 'play',               label: 'Play',                   icon: 'game-controller-outline' },
];
```

### `dateOptions` array (lines 112-117) → REPLACE

```typescript
const dateOptions: { id: DateOptionId; labelKey: string; descKey: string }[] = [
  { id: 'today',        labelKey: 'date_options.today',        descKey: 'date_options.today_desc' },
  { id: 'this_weekend', labelKey: 'date_options.this_weekend', descKey: 'date_options.this_weekend_desc' },
  { id: 'pick_dates',   labelKey: 'date_options.pick_dates',   descKey: 'date_options.pick_dates_desc' },
];
```

### `timeSlots`, `TimeSlot` type → DELETE entirely

### `DateOption` type → REPLACE

```typescript
type DateOptionId = 'today' | 'this_weekend' | 'pick_dates';
```

### `DATE_OPTION_TO_KEBAB` → REPLACE

```typescript
const DATE_OPTION_TO_DB: Record<DateOptionId, string> = {
  today: 'today',
  this_weekend: 'this_weekend',
  pick_dates: 'pick_dates',
};
```

### `KEBAB_TO_DATE_OPTION` → REPLACE

```typescript
const DB_TO_DATE_OPTION: Record<string, DateOptionId> = {
  today: 'today',
  this_weekend: 'this_weekend',
  pick_dates: 'pick_dates',
  // Legacy compat
  now: 'today',
  'this-weekend': 'this_weekend',
  weekend: 'this_weekend',
  'pick-a-date': 'pick_dates',
  custom: 'pick_dates',
};
```

### `defaultPreferences` → REPLACE

```typescript
const defaultPreferences = {
  selectedIntents: [] as string[],
  selectedCategories: [] as string[],
  selectedDateOption: 'today' as DateOptionId,
  selectedDates: [] as string[],
  travelMode: 'walking',
  constraintType: 'time' as const,
  constraintValue: 30,
  searchLocation: '',
  intentToggle: true,
  categoryToggle: true,
};
```

---

## 8. Save Flow

### Solo Mode Save Payload (passed to `onSave` → `AppHandlers.handleSavePreferences`)

```typescript
const preferences = {
  selectedIntents: string[],
  selectedCategories: string[],
  dateOption: DateOptionId | null,
  selectedDates: string[],              // ISO date strings
  selectedDate: string | null,          // datetime_pref ISO string
  travelMode: string,
  constraintType: 'time',
  constraintValue: number,
  useLocation: 'gps' | 'search',
  searchLocation: string,
  useGpsLocation: boolean,
  custom_location: string | null,
  custom_lat: number | null,
  custom_lng: number | null,
  intentToggle: boolean,
  categoryToggle: boolean,
};
```

### Collab Mode DB Write Payload

```typescript
const rawDbPrefs = {
  categories: string[],
  intents: string[],
  travel_mode: string,
  travel_constraint_type: 'time',
  travel_constraint_value: number,
  datetime_pref: string | null,
  date_option: string,                  // DATE_OPTION_TO_DB[selectedDateOption]
  selected_dates: string[] | null,      // Multi-day selections
  use_gps_location: boolean,
  custom_location: string | null,
  custom_lat: number | null,
  custom_lng: number | null,
  intent_toggle: boolean,
  category_toggle: boolean,
};
```

**Removed from both:** `price_tiers`, `budget_min`, `budget_max`, `time_slot`, `time_slots`, `time_of_day`, `priceTiers`, `budgetMin`, `budgetMax`, `selectedTimeSlots`.

### normalizePreferencesForSave receives

```typescript
normalizePreferencesForSave({
  date_option: rawDbPrefs.date_option,
  datetime_pref: rawDbPrefs.datetime_pref,
  use_gps_location: rawDbPrefs.use_gps_location,
  custom_location: rawDbPrefs.custom_location,
});
```

---

## 9. Load Flow

### Fields to Read from DB

| DB Field | Maps to State | Default if null |
|----------|-------------|-----------------|
| `categories` | `selectedCategories` (via `normalizeCategoryArray`) | `[]` |
| `intents` | `selectedIntents` | `[]` |
| `date_option` | `selectedDateOption` (via `DB_TO_DATE_OPTION`) | `'today'` |
| `selected_dates` | `selectedDates` | `[]` |
| `datetime_pref` | `selectedDate` (parse ISO → Date) | `null` |
| `travel_mode` | `travelMode` | `'walking'` |
| `travel_constraint_value` | `constraintValue` | `30` |
| `use_gps_location` | `useGpsLocation` | `true` |
| `custom_location` | `searchLocation` | `''` |
| `custom_lat` + `custom_lng` | `selectedCoords` | `null` |
| `intent_toggle` | `intentToggle` | `true` |
| `category_toggle` | `categoryToggle` | `true` |

### Legacy Handling

| Legacy DB Value | Maps To |
|----------------|---------|
| `date_option = 'now'` | `'today'` |
| `date_option = 'weekend'` | `'this_weekend'` |
| `date_option = 'this-weekend'` | `'this_weekend'` |
| `date_option = 'custom'` | `'pick_dates'` |
| `date_option = 'pick-a-date'` | `'pick_dates'` |

**Do NOT read:** `price_tiers`, `budget_min`, `budget_max`, `time_slot`, `time_slots`, `time_of_day`.

---

## 10. Lock In Button Logic

### `isFormComplete`

```typescript
const isFormComplete = useMemo(() => {
  // At least one toggle must be ON with selections
  const hasIntentPills = intentToggle && selectedIntents.length > 0;
  const hasCategoryPills = categoryToggle && selectedCategories.length > 0;
  const hasPills = hasIntentPills || hasCategoryPills;

  // Date option must be selected
  const hasDate = selectedDateOption !== null;

  // If pick_dates, at least one date must be selected
  const hasDateDetails = selectedDateOption === 'pick_dates'
    ? selectedDates.length > 0
    : true;

  // Travel time must be valid
  const hasTravel = typeof constraintValue === 'number' && constraintValue >= 5;

  return hasPills && hasDate && hasDateDetails && hasTravel;
}, [intentToggle, categoryToggle, selectedIntents, selectedCategories,
    selectedDateOption, selectedDates, constraintValue]);
```

### `ctaHintText`

```typescript
const ctaHintText = useMemo(() => {
  if (isFormComplete) return null;

  if (selectedDateOption === 'pick_dates' && selectedDates.length === 0) {
    return t('preferences:sheet.pick_date_hint');
  }
  if (typeof constraintValue !== 'number' || constraintValue < 5) {
    return t('preferences:sheet.set_travel_hint');
  }
  return t('preferences:sheet.complete_hint');
}, [isFormComplete, selectedDateOption, selectedDates, constraintValue, t]);
```

---

## 11. Toggle Behavior Contract

### Mutual Exclusion Guard

```typescript
const handleIntentToggleChange = useCallback((newValue: boolean) => {
  if (!newValue && !categoryToggle) {
    // Can't turn both off — show warning
    toastManager.warning(t('preferences:experience_types.min_message'), 2000);
    return;
  }
  setIntentToggle(newValue);
}, [categoryToggle, t]);

const handleCategoryToggleChange = useCallback((newValue: boolean) => {
  if (!newValue && !intentToggle) {
    toastManager.warning(t('preferences:categories.min_message'), 2000);
    return;
  }
  setCategoryToggle(newValue);
}, [intentToggle, t]);
```

### Animation

Use `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` before each
toggle state change. This animates the height change of the pills section.

### Persistence

Selections are PRESERVED when toggled OFF. Toggling ON restores them.
`intentToggle` and `categoryToggle` are saved to DB and loaded on reopen.

---

## 12. Sub-Component Changes

### PreferencesSections.tsx

**`ExperienceTypesSection`:** No structural changes. Remove the `marginTop: 20` from the section
since it's now wrapped in `ToggleSection` which handles spacing.

**`CategoriesSection`:** No structural changes. Receives `filteredCategories` prop — pass the
new 8-entry `categories` array.

**`DateTimeSection`:** DELETE entirely. Replaced by `WhenSection`.

**`TravelModeSection`:** No changes.

**Remove:** `TIME_SLOT_KEYS` constant, all time slot rendering logic.

### PreferencesSectionsAdvanced.tsx

No changes.

---

## 13. Sequential Section Animation

On sheet open (`visible` transitions false → true), sections should animate in with a
staggered delay. Implementation:

```typescript
const [sectionVisible, setSectionVisible] = useState([false, false, false, false, false]);

useEffect(() => {
  if (visible && !preferencesLoading) {
    const delays = [0, 80, 160, 240, 320]; // 80ms stagger
    delays.forEach((delay, i) => {
      setTimeout(() => {
        setSectionVisible(prev => {
          const next = [...prev];
          next[i] = true;
          return next;
        });
      }, delay);
    });
  } else if (!visible) {
    setSectionVisible([false, false, false, false, false]);
  }
}, [visible, preferencesLoading]);
```

Each section wrapper uses `opacity` and `translateY` animated by the visibility flag.
Use `Animated.timing` with `duration: 300`, `useNativeDriver: true`.

---

## 14. Imports to Clean Up

### REMOVE these imports from PreferencesSheet.tsx

```typescript
import { PRICE_TIERS, TIER_BY_SLUG, PriceTierSlug } from '../constants/priceTiers';
import { getCurrencySymbol, formatNumberWithCommas } from "../utils/currency";
import { getRate } from "../services/currencyService";
```

### ADD these imports

```typescript
import { WhenSection, DateOptionId } from './PreferencesSheet/WhenSection';
import { ToggleSection } from './PreferencesSheet/ToggleSection';
```

---

## 15. Success Criteria

| ID | Criterion | How to Test |
|---|---|---|
| SC-6.1 | Sheet opens with 5 sections: Starting Point → When → Intents → Categories → Getting There | Visual: open sheet, verify order |
| SC-6.2 | No time slot pills visible anywhere | Grep for `timeSlot` in PreferencesSheet files + visual |
| SC-6.3 | No budget/price tier section visible | Visual: no budget section in sheet |
| SC-6.4 | 8 category pills with new slugs | Count pills, verify slug IDs |
| SC-6.5 | Intent toggle collapses/expands pills with animation | Toggle OFF → pills hide animated, toggle ON → pills show |
| SC-6.6 | Category toggle collapses/expands pills with animation | Same |
| SC-6.7 | Lock In disabled when active toggle section has 0 selections | Turn intents ON with 0 selected, verify button disabled |
| SC-6.8 | Lock In saves correctly in solo mode | Save, close, reopen → selections persist |
| SC-6.9 | Lock In saves correctly in collab mode | Same in collab session |
| SC-6.10 | Returning user sees previous selections (categories, intents, date, travel) | Close and reopen sheet |
| SC-6.11 | "Pick Date(s)" shows multi-day calendar inline | Select pick_dates pill → calendar appears |
| SC-6.12 | Multi-day calendar allows selecting/deselecting multiple dates | Tap 3 dates, verify all highlighted. Tap one again, verify deselected |
| SC-6.13 | Selected dates persist through save/reload | Save with 2 dates, close, reopen → same dates selected |
| SC-6.14 | Past dates disabled in calendar | Verify yesterday is greyed out and non-tappable |
| SC-6.15 | Sections animate in sequentially on sheet open | Visual: sections fade in with stagger |

---

## 16. Invariants

| ID | Invariant | Verification |
|---|---|---|
| INV-3 | Solo and collab modes produce identical UI | Open sheet in both modes, verify same sections/order |
| INV-C9 | No fabricated data: if no date selected, `selected_dates` is `[]`, not a fake date | Check DB write when no dates picked |
| INV-C2 | One owner per truth: `selectedDates` state → `selected_dates` DB. No Zustand copy | Grep for `selectedDates` in store — must be 0 |
| NEW | At least one of {intentToggle, categoryToggle} is always ON | Toggle guard prevents both OFF |

---

## 17. Implementation Order

1. **`ui/MultiDayCalendar.tsx`** — new component, standalone, no dependencies on PreferencesSheet
2. **`PreferencesSheet/ToggleSection.tsx`** — new component, reusable wrapper
3. **`PreferencesSheet/WhenSection.tsx`** — new component, uses MultiDayCalendar
4. **`PreferencesSheet/PreferencesSections.tsx`** — remove `DateTimeSection`, remove `TIME_SLOT_KEYS`, remove time slot styles
5. **`PreferencesSheet.tsx`** — the main rewrite:
   a. Replace constants (categories, dateOptions, types, mappings)
   b. Replace state variables (remove budget/time, add toggles/dates)
   c. Rewrite load flow (both modes)
   d. Rewrite save flow (both modes)
   e. Rewrite `isFormComplete` and `ctaHintText`
   f. Rewrite JSX section order
   g. Add sequential animation
   h. Remove all budget/price/time imports and code

---

## 18. Test Cases

| Test | Scenario | Expected |
|------|----------|----------|
| T-01 | Open sheet fresh (no prefs) | 5 sections visible, both toggles ON, date = Today, empty pills |
| T-02 | Select 2 intents + 3 categories + This Weekend + Walk + 30min → Lock In | Saves to DB, reopen shows same |
| T-03 | Select Pick Date(s) → tap 3 dates → Lock In | `selected_dates` has 3 ISO strings in DB |
| T-04 | Toggle intents OFF → verify pills collapse → Lock In | `intent_toggle: false` in DB, selections preserved |
| T-05 | Try toggling both OFF | Second toggle refuses, warning shown |
| T-06 | Returning user with legacy `date_option = 'now'` | Loads as `'today'` |
| T-07 | Returning user with `selected_dates = ['2026-04-20', '2026-04-21']` | Calendar shows those dates selected |
| T-08 | Tap past date in calendar | Nothing happens, date stays unselected |
| T-09 | Open sheet in collab mode | Same UI, saves to board_session_preferences |
| T-10 | Lock In with pick_dates selected but 0 dates | Button disabled, hint shows "Pick a date to continue" |
