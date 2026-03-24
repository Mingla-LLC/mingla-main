# Investigation: Save & Schedule Entry Points

## SAVE FLOW — 6 Entry Points

---

### Entry Point 1: SwipeableCards — Swipe Right / onCardLike

**File:** `app-mobile/src/components/SwipeableCards.tsx`

**How it works:**
- Swipe right triggers `handleSwipe("right", card)` at line ~1238
- For regular cards: calls `ExperiencesService.saveExperience()` (line 1240) to write to `saved_experiences` table, then calls `onCardLike(card)` (line 1267)
- For curated cards: skips `saveExperience`, calls `onCardLike(card)` directly (line 1208)
- `onCardLike` is a prop — it maps to `handleSaveCard` from `AppHandlers.tsx`
- "Save" button in ExpandedCardModal from deck also goes through `handleSwipe("right")` (line 1952) or `onCardLike` fallback (line 1955)
- Dismissed card sheet "Save" button: `handleSaveDismissedCard` (line 1381) calls `onCardLike(card)` directly

**Answers:**
1. **Awaited or fire-and-forget?** `ExperiencesService.saveExperience` is awaited (line 1240). `onCardLike` (→ `handleSaveCard`) is called but NOT awaited (fire-and-forget from SwipeableCards' perspective).
2. **What's written?** `saved_experiences` table: `{user_id, place_id, status: "liked", title, category, image_url, opening_hours, meta: {matchScore, reviewCount}}`. Then `handleSaveCard` writes the actual saved card (see Entry Point 2).
3. **card_data contains all render fields?** Depends on Entry Point 2 (handleSaveCard).
4. **Cache invalidated?** Done in `handleSaveCard` (Entry Point 2).
5. **Toast/feedback?** Done in `handleSaveCard` (Entry Point 2).
6. **On failure?** `saveExperience` error: 23505 (duplicate) silently ignored, other errors thrown but only logged (line 1253-1263). `onCardLike` errors are NOT caught at SwipeableCards level.
7. **Optimistic update?** No — card is removed from deck visually by swipe animation, but saved list waits for refetch.
8. **Curated stops included?** Curated card path skips `saveExperience` and goes straight to `onCardLike` → `handleSaveCard` which DOES include stops (see Entry Point 2).
9. **Collab mode?** Delegated to `handleSaveCard` which handles both (see Entry Point 2).

---

### Entry Point 2: AppHandlers — handleSaveCard

**File:** `app-mobile/src/components/AppHandlers.tsx`, line 776

**How it works:**
- Central save handler used by all swipe/save actions
- Reads latest `currentMode` from `stateRef.current` (lines 788-790)
- If `currentMode !== "solo"` → collab path (board_saved_cards)
- If `currentMode === "solo"` → solo path (saved_card)

#### Solo Path (line 978-1022):
1. **Awaited?** YES — `await savedCardsService.saveCard(user.id, card, "solo")` (line 982)
2. **What's written?** Table: `saved_card`. Fields: `{profile_id, experience_id, title, category, image_url, match_score, card_data: {...card, dateAdded, source: "solo"}}`. See `savedCardsService.ts` line 72-84. The `card_data` JSONB is a full spread of the card object.
3. **card_data contains all render fields?** YES — it spreads the entire card object (`...card`), which includes title, category, image, images, rating, reviewCount, travelTime, priceRange, description, fullDescription, address, openingHours, highlights, matchScore, etc.
4. **Cache invalidated?** YES — `queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) })` (line 1011)
5. **Toast:** `"Saved! {title} has been added to your saved experiences"` (line 1014-1018)
6. **On failure:** `Alert.alert("Save failed", "We couldn't save this experience...")` (line 1025-1028)
7. **Optimistic update?** NO — waits for invalidation/refetch.
8. **Curated stops?** The `...card` spread includes stops if present on the card object. NOT explicitly verified.
9. **Collab?** No, this is the solo path.

Also fires (fire-and-forget):
- `userActivityService.recordActivity` (savedCardsService line 99)
- `increment_user_engagement` RPC (line 108)
- `increment_place_engagement` RPC (line 117)
- Paired user notification via `notify-pair-activity` edge function (line 984-1008)

#### Collab Path (line 871-977):
1. **Awaited?** YES — `await BoardCardService.saveCardToBoard(...)` (line 921)
2. **What's written?** Table: `board_saved_cards`. Fields: `{session_id, experience_id: null, saved_experience_id: null, card_data: {...experienceData, id, experience_id}, saved_by}`. The `experienceData` is explicitly constructed (lines 872-918) with: id, title, category, categoryIcon, image, images, rating, reviewCount, travelTime, priceRange, priceTier, description, fullDescription, address, openingHours, highlights, matchScore, socialStats, matchFactors, lat, lng, website, websiteUri, phone, placeId, googleMapsUri, location, distance, tags, strollData, picnicData. For curated: also cardType, stops, tagline, totalPriceMin, totalPriceMax, estimatedDurationMinutes, pairingKey, experienceType, shoppingList.
3. **card_data contains all render fields?** YES — explicitly mapped with all fields.
4. **Cache invalidated?** YES — `queryClient.invalidateQueries({ queryKey: savedCardKeys.list(user.id) })` (line 967)
5. **Toast:** `"Added to Board! {title} has been added to {sessionName}"` (line 970-974)
6. **On failure:** Same as solo — `Alert.alert("Save failed", ...)` (line 1025-1028)
7. **Optimistic update?** NO.
8. **Curated stops?** YES — explicitly included in the curated spread block (lines 907-917).
9. **Collab?** YES — writes to `board_saved_cards`.

Also fires (fire-and-forget):
- Auto-vote "up" on `board_votes` (line 934-949)
- Board notification via `notifyCardSaved` (line 953-963)
- Realtime broadcast (inside `BoardCardService.saveCardToBoard`, line 87-94 of boardCardService.ts)

**Duplicate check:**
- Solo: queries `saved_card` by profile_id + experience_id (line 840-845). Shows toast/alert if duplicate.
- Collab: queries `board_saved_cards` by session_id, checks card_data.id in-memory (lines 813-832). Shows info toast if duplicate.

---

### Entry Point 3: DismissedCardsSheet — handleSave

**File:** `app-mobile/src/components/DismissedCardsSheet.tsx`, line 41

**How it works:**
- `handleSave` calls `onSave(card)` (line 43) — a prop
- Adds haptic feedback (line 42)
- The `onSave` prop maps back to `handleSaveDismissedCard` in SwipeableCards (line 1381), which calls `onCardLike(card)` → `handleSaveCard` in AppHandlers

**Answers:**
1. **Awaited?** NO — `onSave(card)` is fire-and-forget (no await).
2. **What's written?** Delegates to `handleSaveCard` (Entry Point 2).
3-9. **Same as Entry Point 2.**

**Note:** The dismissed card is NOT removed from the dismissed list in the sheet after saving. Only haptic feedback is provided before delegating.

---

### Entry Point 4: PersonHolidayView — Save handler

**File:** `app-mobile/src/components/PersonHolidayView.tsx`

**Finding:** PersonHolidayView does NOT have a save handler. It displays a paired user's saves (line 682-755, using `usePairedSaves` hook) but provides no UI to save cards. It is a read-only view of a partner's activity. **This is NOT a save entry point.**

---

### Entry Point 5: ExpandedCardModal — onSave (from deck)

**File:** `app-mobile/src/components/SwipeableCards.tsx`, lines 1938-1968

**How it works:**
- ExpandedCardModal's `onSave` prop is defined inline in SwipeableCards
- If the card matches the current deck card, it calls `handleSwipe("right", currentRec)` (line 1952) — which is the same as a swipe right (Entry Point 1)
- If card doesn't match: calls `onCardLike(card)` directly (line 1955)
- On success: closes modal (line 1959)
- Inside ExpandedCardModal, `ActionButtons` component wraps this: `handleSave` (ActionButtons.tsx line 360) sets `isSaving=true`, awaits `onSave(card)`, catches errors with `Alert.alert("Error", "Failed to save...")` (line 367)

**Answers:**
1. **Awaited?** YES — `await handleSwipe("right", currentRec)` at line 1952; `await onSave(card)` in ActionButtons line 365.
2. **What's written?** Same as Entry Points 1+2.
3-9. **Same as Entry Points 1+2.**

**Extra error handling:** ActionButtons catches errors (line 366-368) and shows an alert. SwipeableCards also catches and re-throws (line 960-967), with special handling for 23505 (still closes modal).

---

### Entry Point 6: SessionViewModal — Board Saved Cards (Collab Board View)

**File:** `app-mobile/src/components/SessionViewModal.tsx`

**Finding:** SessionViewModal is a READ-ONLY view of board saved cards. It loads cards from `board_saved_cards` (line 198), displays them, and supports voting/messaging, but does NOT provide a save-to-board action itself. Cards get saved to the board via `handleSaveCard` (Entry Point 2) when swiping in collab mode. **This is NOT a separate save entry point.**

---

## SCHEDULE FLOW — 3 Entry Points

---

### Schedule Entry Point 1: SavedTab — handleSchedule (Regular Cards)

**File:** `app-mobile/src/components/activity/SavedTab.tsx`, line 1101

**How it works:**
1. Checks if already scheduled (line 1103) — early return if so
2. Checks live open/closed status using `isPlaceOpenNow()` (line 1108)
3. If closed: shows Alert "Place Closed" (line 1110-1114), blocks scheduling
4. Closes ExpandedCardModal if open to prevent modal stacking (line 1118-1121)
5. Opens `ProposeDateTimeModal` (line 1124-1125)
6. User picks date/time → `handleProposeDateTime` (line 1265)
7. For regular cards: proceeds immediately to `proceedWithScheduling` (line 1322)
8. `proceedWithScheduling` (line 1326) does the actual work

**Answers:**
1. **Date/time picker:** `ProposeDateTimeModal` component (file: `app-mobile/src/components/activity/ProposeDateTimeModal.tsx`). Uses `@react-native-community/datetimepicker`. Offers options: "Now", "Today", "Weekend", "Custom". "Custom" opens native date picker then time picker.
2. **Can user pick today?** YES — "Now" and "Today" are explicit options. "Custom" date picker starts at today's date.
3. **Place hours validation?** YES — before opening the modal, checks `isPlaceOpenNow()` (line 1108). If closed, blocks with alert. NOTE: Does NOT re-validate at the selected future time — only checks current time.
4. **Curated: checks ALL stops' hours?** NO — this is `handleSchedule` for regular cards. Curated uses `handleScheduleCurated` (see Entry Point 2).
5. **After confirming:**
   - Removes from `saved_card`/`board_saved_cards` via `savedCardsService.removeCard()` (line 1353-1358)
   - Invalidates saved cards query (line 1359)
   - Creates calendar entry via `CalendarService.addEntryFromSavedCard()` (line 1433)
   - Invalidates calendar entries query (line 1440)
   - Adds to device calendar via `DeviceCalendarService` (line 1443-1458), with curated-specific handler
   - Tracks via Mixpanel + AppsFlyer (lines 1464-1476)
   - Toast: `"Scheduled! {title} has been moved to your calendar"` (line 1479-1482)
6. **Confirmation step?** NO — for regular cards, proceeds directly after date/time selection (line 1322).
7. **Calendar permission denied?** Device calendar is wrapped in try/catch (line 1443-1461). If permission denied, only `console.warn` — scheduling succeeds anyway (Supabase is source of truth).
8. **DB write failure?** `catch` at line 1485: `Alert.alert("Schedule failed", "We couldn't add this to your calendar...")`. Sets `schedulingCardId` and `cardToSchedule` to null in `finally`.

**DB write details:**
- Table: `calendar_entries` (via `CalendarService.addEntryFromSavedCard`)
- Card data is transformed to `ExpandedCardData` format (lines 1371-1425), including curated fields if present
- Source (solo/collab) is preserved

---

### Schedule Entry Point 2: SavedTab — handleScheduleCurated (Curated Cards)

**File:** `app-mobile/src/components/activity/SavedTab.tsx`, line 1235

**How it works:**
1. Checks if already scheduled (line 1237) — early return if so
2. Does NOT check if currently open (unlike `handleSchedule`)
3. Opens `ProposeDateTimeModal` (line 1246-1247)
4. User picks date/time → `handleProposeDateTime` (line 1265)
5. Detects curated card by checking `stops` array (line 1272-1274)
6. Calls `checkAllStopsOpen(stops, date)` (line 1278) — validates ALL stops
7. If ALL open: confirmation Alert `"All Stops Are Open!"` with "Schedule" button (line 1290-1296)
8. If some closed: Alert `"Some Stops Are Closed"` listing which stops and why, with "Choose New Time" button to reopen picker (line 1300-1317)
9. On confirmation: `proceedWithScheduling(date)` — same as Entry Point 1

**Answers:**
1. **Date/time picker:** Same `ProposeDateTimeModal`.
2. **Can user pick today?** YES.
3. **Place hours validation?** NO initial check (unlike regular cards).
4. **Curated: checks ALL stops' hours?** YES — `checkAllStopsOpen()` (line 1209-1233) calculates estimated arrival time at each stop using cumulative duration + travel time, then calls `checkSingleStopOpen()` (line 1142-1207) for each. Handles: closed days, open 24 hours, time range parsing ("9:00 AM - 5:00 PM"), before-open, after-close. If no hours data: assumes open.
5. **After confirming:** Same as Entry Point 1 — delegates to `proceedWithScheduling`.
6. **Confirmation step?** YES — Alert with "Schedule" / "Not Now" buttons (line 1290-1296).
7. **Calendar permission denied?** Same as Entry Point 1.
8. **DB write failure?** Same as Entry Point 1.

---

### Schedule Entry Point 3: ExpandedCardModal → ActionButtons — proceedWithScheduling

**File:** `app-mobile/src/components/expandedCard/ActionButtons.tsx`, line 502

**How it works:**
- `handleSchedule` (line 373) opens a native `DateTimePicker` (NOT `ProposeDateTimeModal`)
- On Android: date picker → time picker sequential flow (lines 388-439)
- On iOS: date picker → time picker with explicit "Done" button (lines 441-495)
- After time selection: checks place availability via `checkPlaceAvailability()` (lines 411, 467)
- If open: auto-proceeds to `proceedWithScheduling` (lines 416, 472)
- If closed: Alert with "Choose Another Time" or "Cancel" (lines 418-438, 474-494)

**Answers:**
1. **Date/time picker:** Native `DateTimePicker` from `@react-native-community/datetimepicker` (NOT ProposeDateTimeModal). Two-step: date then time.
2. **Can user pick today?** YES — `selectedDate` starts at `new Date()` (line 381).
3. **Place hours validation?** YES — `checkPlaceAvailability()` (lines 141-190 in ActionButtons.tsx). Parses opening hours, checks selected day/time against hours range. Handles: no hours (assumes open), JSON-stringified hours (unwraps up to 3x), weekday_text format.
4. **Curated: checks ALL stops' hours?** NO — `checkPlaceAvailability` only checks a single place's hours. Does NOT iterate over curated stops. For curated cards scheduled from ActionButtons, stop-level validation is MISSING.
5. **After confirming:**
   - If card is saved (`isSaved`): removes from `saved_card`/`board_saved_cards` (line 523-537), invalidates `savedCardKeys.all`
   - Creates calendar entry via `CalendarService.addEntryFromSavedCard()` (line 574)
   - Invalidates `["calendarEntries", user.id]` (line 581)
   - Adds to device calendar (lines 584-594)
   - Toast: `"Scheduled! {title} has been moved to your calendar"` (line 598-601)
   - Haptic success feedback (line 597)
   - Calls `onCardRemoved(card.id)` if provided (line 604-606) — removes from deck
   - Calls `onScheduleSuccess(card)` or `onClose()` (lines 609-613)
6. **Confirmation step?** NO — if place is open, proceeds automatically.
7. **Calendar permission denied?** try/catch around device calendar (line 584-594), only `console.warn`. Scheduling succeeds anyway.
8. **DB write failure?** catch at line 614: `Alert.alert("Schedule failed", ...)`. `isScheduling` reset in `finally` (line 621-627).

**Key difference from SavedTab:** ActionButtons uses native DateTimePicker; SavedTab uses ProposeDateTimeModal with "Now/Today/Weekend/Custom" options.

---

### Schedule Entry Point 4: AppHandlers — handleScheduleFromSaved

**File:** `app-mobile/src/components/AppHandlers.tsx`, line 1032

**How it works:**
- Called from somewhere that doesn't show a date picker at all
- Auto-generates a suggested date using `generateSuggestedDates(userPreferences)` (line 1034)
- Uses the first suggestion (line 1035)
- Does NOT show any date picker or confirmation to the user
- Directly creates calendar entry via `CalendarService.addEntryFromSavedCard()` (line 1074)
- Adds to device calendar (lines 1081-1098)
- Adds entry to `calendarEntries` local state (lines 1165-1177)
- Toast: `"Scheduled! {title} has been moved to your calendar"` (line 1180-1183)

**Answers:**
1. **Date/time picker?** NONE — auto-generates date from user preferences.
2. **Can user pick today?** NO user choice at all.
3. **Place hours validation?** NONE.
4. **Curated: checks ALL stops' hours?** NO.
5. **After confirming:**
   - Does NOT remove from saved_card (card stays in saved list)
   - Creates calendar entry in Supabase
   - Adds to device calendar (best-effort)
   - Adds to local `calendarEntries` state
   - Toast shown
6. **Confirmation step?** NONE — fully automatic.
7. **Calendar permission denied?** try/catch (line 1081-1103), only `console.warn`. Continues.
8. **DB write failure?** catch at line 1184: `Alert.alert("Schedule failed", ...)`.

**WARNING:** This handler does NOT remove the card from saved — it stays in both saved and calendar. This differs from SavedTab's `proceedWithScheduling` which removes from saved on schedule.

---

## Summary of Key Issues Found

| Issue | Severity | Location |
|-------|----------|----------|
| `handleScheduleFromSaved` does NOT remove card from saved when scheduling | Medium | AppHandlers.tsx:1032 |
| `handleScheduleFromSaved` has NO date picker, NO hours validation, NO confirmation | High | AppHandlers.tsx:1032 |
| ActionButtons schedule does NOT validate curated card stops (only single-place check) | Medium | ActionButtons.tsx:141-190 |
| SavedTab `handleSchedule` checks if place is open NOW but not at the selected future time | Medium | SavedTab.tsx:1108 |
| DismissedCardsSheet save is fire-and-forget — no await, no error feedback to user | Low | DismissedCardsSheet.tsx:43 |
| Solo save relies on `...card` spread for card_data — if card object is missing fields, they won't be in JSONB | Low | savedCardsService.ts:79 |
| Collab save explicitly maps all fields — more reliable than solo spread | Info | AppHandlers.tsx:872-918 |
| `handleScheduleFromSaved` checks for duplicate in local state only, not DB | Low | AppHandlers.tsx:1064-1072 |
