# IMPLEMENTATION — ORCH-0997 [Friend-page cards render + open like the swipeable deck]

**Status:** implemented and verified (unit + type + on-device live-fire, Android).
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0997-[friend-card-deck-parity]/` on branch `ORCH-0997-friend-card-deck-parity` (off `origin/main` `aacf080bd`).
**Inputs:** `specs/SPEC_ORCH-0997_FRIEND_CARD_DECK_PARITY.md`, `specs/DESIGN_ORCH-0997_FRIEND_CARD.md`, `reports/INVESTIGATION_ORCH-0997_FRIEND_CARD_DECK_PARITY.md`.

## Layman summary
- Friend-profile birthday/holiday cards now look like the swipeable-deck cards (portrait photo hero + frosted glass chips, one consistent style for single and curated picks — the old dark/white split is gone), and tapping one now opens the full place detail with its hero photo + weather/traffic/distance instead of a grey "No images" box.
- Verified live on the Android device: the new tile renders correctly and the detail opens with the photo + location data.

## Cross-Surface (Step 3.5)
Consumer iOS + Consumer Android (shared `app-mobile` code → parity automatic). NOT buyer-web / business-iOS / business-Android / admin-web / business-web (no friend page exists on any of those).

## What changed — Old → New receipts

### `app-mobile/src/components/utils/holidayCardToExpandedCardData.ts` (NEW)
**Before:** did not exist; each friend-page card built an ad-hoc inline object with deck-foreign field names (`imageUrl`, flat `lat`/`lng`).
**Now:** single pure mapper `holidayCardToExpandedCardData(card, opts)` returning a fully-typed `ExpandedCardData` — maps `imageUrl→image`+`images:[imageUrl]`, flat `lat`/`lng`→`location:{lat,lng}`, fills `categoryIcon`/`reviewCount`/`highlights`/`tags`/`matchFactors`/`socialStats` honestly (zero/empty, never fabricated), and the curated branch passes `cardType:'curated'`+`stops:CuratedStop[]`+experience fields.
**Why:** RC#2 — the modal reads `image`/`images`/`location` with no normalization layer, so the old field names produced a grey "No images available" box + dead location. Typed return makes the drift a compile error (SC-7).
**Lines:** ~95 (new file).

### `app-mobile/src/components/PersonHolidayView.tsx`
**Before:** `CompactCard` = 150-wide landscape thumbnail (100px image-on-top + white text block; curated tiles inverted to `#1C1C1E`); both `onCardPress` payloads emitted the deck-foreign ad-hoc object; `onCardPress` prop typed as a bespoke inline shape.
**Now:** `CompactCard` = 168×232 portrait full-bleed hero tile (expo-image cover + 62%/0.78 bottom gradient + white 15/700 title + `GlassBadge` chips, max 2; curated distinguished by a 1px `#eb7825` top accent + "N stops"/experience chips — ONE frame, no dark/white split); branded fallback (category icon on `#fff7ed`) when no photo; press scale 0.97/120ms + light haptic + reduced-motion opacity fallback; full-tile button with composed a11y label + chip descendants hidden. Both `onCardPress` payloads now call `holidayCardToExpandedCardData(...)` (primary) / build a valid `ExpandedCardData` (fallback path); `onCardPress` retyped `(card: ExpandedCardData) => void`.
**Why:** RC#1 (tile shape, design spec) + RC#2 (open-path, functional spec §5.2a). Deleted the old `compactCard*` styles + dark-bg variant (subtract-before-add).
**Lines:** ~110 changed (component + styles + imports).

### `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx`
**Before:** `expandedCard` state + `handleCardPress` typed `any`.
**Now:** typed `ExpandedCardData | null` / `(card: ExpandedCardData) => void`; imports the type. No runtime change (the runtime fix is the shaped object from `PersonHolidayView`).
**Why:** type-safety completeness for SC-7; the modal mount (`target={{kind:"nightOut", data: expandedCard}}`) now receives a correctly-typed value.
**Lines:** ~5.

### `app-mobile/src/components/utils/__tests__/holidayCardToExpandedCardData.test.ts` (NEW)
Implementor happy-path regression (T-01/T-02 + a curated passthrough). `// @ts-nocheck` per the app-mobile test convention (friendMenu/NotificationsSheet).

## Spec traceability
- **SC-1 (hero shows, not grey box):** PASS — device: tapping the single tile opened the detail with the Nike Art Gallery hero photo (was grey "No images available"). `/tmp/o997_open_fixed.png`. Unit: T-01 asserts `image`/`images` set.
- **SC-2 (no-image honesty):** PASS — T-02: `imageUrl:null → image:'' , images:[]`, no throw; the modal renders its own empty state.
- **SC-3 (location populates):** PASS — device: detail now shows distance (5523.6 mi — correct for a Lagos place viewed from Raleigh) + Weather/Traffic/Busy, all location-derived and previously dead. Unit: T-01 `location:{lat,lng}`.
- **SC-4 (curated opens multi-stop):** PASS (data) — T-03a: `cardType:'curated'`+`stops` passthrough; device curated tile labels "Yenwa Art Gallery → Nest Lagos, Celebration, 2 stops". Full multi-stop layout render to be confirmed by tester.
- **SC-5 (tile shape):** PASS — device: both tiles render portrait hero + glass chips, unified frame, curated accent hairline. `/tmp/o997_fix2.png`.
- **SC-6 (no regression):** birthday hero, "Your Special Days" empty state, vibe pills, tab bar all unchanged on device.
- **SC-7 (type guard):** PASS — mapper returns `ExpandedCardData`; reverting the `image`/`location` mapping fails T-01 (proven) and would also break tsc.

## Regression Test
- Path: `app-mobile/src/components/utils/__tests__/holidayCardToExpandedCardData.test.ts`
- Passing run: `Tests: 3 passed, 3 total` (`npx jest <path>`).
- **fails-on-revert verified at `aacf080bd`** (origin/main, pre-fix): reverting the mapper's `image`/`images`/`location` mapping → `Tests: 1 failed` (T-01: `Expected "https://cdn.example/0.jpg", Received ""`). Restored → 3 passed.

## Verification gates
- **tsc:** my 3 touched production files + test = **zero new errors** (`npx tsc --noEmit` shows none for PersonHolidayView/ViewFriendProfileScreen/holidayCardToExpandedCardData). The package has 270 pre-existing errors unrelated to this ORCH (not introduced here).
- **On-device live-fire:** Android (`R58R54YV7JT`), Metro 8099, fix temporarily applied to the anchor + reverted after (anchor clean, per `feedback_testing_handoff_just_run_expo_start.md`). Screenshots `/tmp/o997_fix2.png` (tiles), `/tmp/o997_open_fixed.png` (hero-photo detail).
- **Edge functions:** none touched — N/A.

## Constitution (touched rules)
- #2 one-owner-per-truth: mapper is the single `ExpandedCardData` producer for the friend page — PASS.
- #8 subtract-before-add: removed old `CompactCard` layout/styles before adding the hero tile — PASS.
- #9 no fabrication: missing image→`''`/`[]`+branded fallback, missing rating→`0` (chip hidden), missing coords→`location:undefined`, neutral matchFactors/socialStats — PASS.
- #10 currency-aware: price chip via `formatTierLabel(tier, currencySymbol, currencyRate)` — PASS.
- Others N/A.

## Parity
Solo-only surface (friend profile); no collab variant. iOS + Android share the code (parity automatic) — Android verified live; iOS pending tester (the iOS sim dev build lacks `expo-video` and crashes at load, COMMS-0007 — tester needs a build with expo-video or an iOS device with the launch build).

## Discoveries for orchestrator
- **D-A (locale):** `ViewFriendProfileScreen.tsx:817` hard-codes `accountPreferences={{ currency:'USD', measurementSystem:'Imperial' }}` for the friend-page ExpandedCardModal — so distances show in miles regardless of user locale (visible as "5523.6 mi"). Design spec marked fixing this 🎨 OPEN/optional; left out of scope to avoid creep. Recommend a follow-up to wire the real locale hook (consumer-wide, likely affects other modal mounts too).
- **D-B (a11y):** chips carry their own `content-desc` in the uiautomator dump despite the container's `no-hide-descendants`; likely fine for TalkBack focus order but tester should confirm TalkBack/VoiceOver reads ONE label per tile on both platforms.
- **D-C (carryover from investigation):** three separate recommendation-card renderers still exist (deck inline / this tile / `PersonGridCard`) — a future shared-component consolidation ORCH (was the rejected Option A).

## Deploy notes
Client-only (app-mobile). No migration, no edge function, no `[deploy]` web tag needed. Rides the next app build/OTA (note `feedback_ota_deferred_until_new_build` — Seth's fresh native build; this change ships with it).
