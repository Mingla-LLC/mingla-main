# Investigation: Curated Card Save → Schedule → "Did You Go" Pipeline

**Date:** 2026-03-24
**Scope:** Full forensic trace of saving, scheduling, and reviewing curated cards
**Files Read:** 15+ files across services, hooks, components, handlers, migrations

---

## Plain English Summary

When you swipe right on a curated card, the save fires but isn't awaited — it's a fire-and-forget call. If it silently fails (network blip, serialization issue), you get no error and no toast. This is the most likely cause of the card not appearing.

Beyond that, the scheduling flow handles curated cards well, but the "Did you go?" review flow treats a multi-stop itinerary as a single place — losing all per-stop context.

---

## BUG 5: Curated Card Save Is Fire-and-Forget (Not Awaited)

### The Chain

```
User swipes right on curated card
  → handleSwipe() in SwipeableCards.tsx:1184
    → onCardLike(card)  ← NOT AWAITED (line 1208)
      → handleSaveCard(card)  ← ASYNC function called without await
        → savedCardsService.saveCard(userId, card, "solo")
          → supabase.from("saved_card").upsert(payload)
```

### The Problem

**File:** `app-mobile/src/components/SwipeableCards.tsx:1207-1208`
```typescript
if (direction === 'right') {
    onCardLike(card);  // ← void return, not awaited
}
```

`onCardLike` is typed as `(card: any) => void` but calls `handleSaveCard` which is `async`. The returned promise is discarded. If the save fails:
- No error shown to user
- No retry
- AppsFlyer event already logged (`af_add_to_wishlist` fires BEFORE save on line 1169)
- Card removed from deck (user thinks it's saved)

**Compare with non-curated cards (line 1238-1267):**
Non-curated cards call BOTH `ExperiencesService.saveExperience()` (awaited) AND `onCardLike(card)`. The awaited call provides a backup save. Curated cards have NO backup — only the fire-and-forget `onCardLike`.

### Evidence From Logs

The user's logs show:
```
LOG  [AppsFlyer] Event logged (af_add_to_wishlist): Success
```
But there is NO subsequent toast message like `"❤️ Saved! ... has been added to your saved experiences"`. The toast fires at `AppHandlers.tsx:1014-1018` AFTER a successful save. Its absence suggests the save either failed silently or completed after the user navigated away.

### Severity: RED — user-visible data loss

---

## BUG 6: Default Page Renders Save as Console.log Placeholder

### The Problem

**File:** `app-mobile/app/index.tsx`

Two renderings of `<HomePage>` exist:

| Case | Line | `onSaveCard` Handler |
|------|------|---------------------|
| `case "home":` | 1664 | `handlers.handleSaveCard` ← **PROPER** |
| `default:` | 1823 | `(card) => console.log("Save card:", card)` ← **NOOP** |

If `currentPage` is ever anything other than the exact string `"home"` (e.g., `undefined`, `null`, empty string, or a typo), the default case renders a HomePage where saving does LITERALLY NOTHING except log to console.

### Risk Assessment

The user's logs show `[NAV] Page: home` which means they should hit `case "home":`. But this is a latent bomb — any navigation bug that fails to set `currentPage` exactly to `"home"` silently disables saving.

### Severity: YELLOW — latent, but catastrophic when triggered

---

## BUG 7: Post-Experience Review Treats Curated Card as Single Place

### The Problem

The "Did you go?" flow (`usePostExperienceCheck` → `PostExperienceModal` → `voiceReviewService`) is designed for single-place cards. For curated cards:

1. **`placeName`** = card title (all stop names joined with "→") — e.g., "UA Indoor SkyDiving → RushHour Karting → G.58 Cuisine"
2. **`placePoolId`** = always `undefined` — curated card_data has no `place_pool_id` field (not in CalendarService's allowlist)
3. **`googlePlaceId`** = falls through to `cardData.id` — the curated card ID, NOT an actual Google Place ID
4. **One review for entire itinerary** — asks "Did you go?" once for 3-4 stops. No per-stop feedback.
5. **`place_reviews` table** stores ONE `place_pool_id`, ONE `google_place_id`, ONE `place_name` — structurally cannot represent a multi-stop review.

**Consequence:** Reviews for curated cards are stored with:
- `place_name` = the full title string (not useful for per-stop analytics)
- `google_place_id` = a curated card ID (breaks any join to `place_pool` or Google data)
- `place_pool_id` = NULL (no linkage to venue data)

This means curated card reviews are **analytically useless** — you can't determine which stops users actually visited or which venues got good/bad ratings.

### Severity: RED — analytics data corruption

---

## BUG 8: Dual ID Problem — Same Card Gets Different IDs

### The Problem

Curated cards have two ID formats depending on how they're served:

| Source | ID Format | Example |
|--------|-----------|---------|
| Fresh generation | Synthetic | `curated_adventurous_1774328297215_a64ebo` |
| Pool serving | UUID | `dea120e5-2bc6-4c0b-a4a2-7681bbe02bdb` |

The same underlying card (same stops, same venues) gets a **different ID** each time.

**Impact:**
- User saves card with synthetic ID → card gets stored in pool with UUID → next session shows same card with UUID → duplicate check by `experience_id` misses it → user can save the same itinerary twice
- `isSaved` check in SwipeableCards won't detect previously saved version
- Calendar dedup check won't detect previously scheduled version
- Impression tracking won't recognize the card as previously seen

### Severity: YELLOW — duplicate saves, broken "already saved" detection

---

## Scheduling Flow — Works But Has Minor Gaps

### What Works
- `CalendarService.addEntryFromSavedCard` allowlist includes all curated fields (lines 47-57): `cardType`, `stops`, `tagline`, `totalPriceMin`, `totalPriceMax`, `estimatedDurationMinutes`, `experienceType`, `pairingKey`, `shoppingList`
- SavedTab checks all stops' opening hours before scheduling (lines 1209-1228)
- Shows which stops are closed and why
- Device calendar creates a proper event

### What Doesn't
- **Duration estimate** uses only `estimatedDurationMinutes` from the card — doesn't account for travel time between stops when creating the device calendar event
- **No per-stop calendar entries** — one calendar event for the whole itinerary. No reminders for individual stop times.
- **Scheduled curated cards share the same unique constraint issue** as BUG 8 (dual IDs)

---

## "Did You Go" Flow — Structurally Incompatible With Multi-Stop Cards

### What Works
- `usePostExperienceCheck` correctly finds past curated calendar entries
- Modal opens and accepts rating + voice recording
- Submission creates a `place_reviews` record

### What Doesn't
- **Single-place model** — Cannot record per-stop attendance
- **No "which stops did you visit?" step** — Binary yes/no for entire itinerary
- **placePoolId always NULL** for curated reviews
- **googlePlaceId is the card ID**, not any venue ID
- **No venue-level analytics** possible from curated reviews
- **Voice review transcription** ties to card_id, not individual venues — can't extract per-stop sentiment

---

## ALL CURATED BUGS (Complete List)

| # | Bug | Severity | Category |
|---|-----|----------|----------|
| 1 | Stop label "End With" wrong when optional stops skipped | RED | Generation |
| 2 | Fine dining price floor is dead code (empty if-block) | RED | Generation |
| 3 | Curated cards collide with single cards on google_place_id | RED | Storage |
| 4 | Category type leakage — dual-typed venues in wrong stops | RED | Generation |
| 5 | Save is fire-and-forget, not awaited — silent data loss | RED | Save |
| 6 | Default case renders save as console.log noop | YELLOW | Save |
| 7 | Review treats multi-stop card as single place | RED | Review |
| 8 | Dual ID problem — same card gets different IDs | YELLOW | Identity |

---

## FILE MANIFEST

**Save flow:**
- `app-mobile/src/components/SwipeableCards.tsx` — Swipe handler, curated branch
- `app-mobile/src/components/AppHandlers.tsx` — handleSaveCard
- `app-mobile/src/services/savedCardsService.ts` — saveCard, fetchSavedCards
- `app-mobile/src/hooks/useSavedCards.ts` — React Query hook
- `app-mobile/src/components/activity/SavedTab.tsx` — Saved cards display
- `app-mobile/app/index.tsx` — Page routing, onSaveCard prop wiring

**Schedule flow:**
- `app-mobile/src/services/calendarService.ts` — addEntryFromSavedCard
- `app-mobile/src/services/deviceCalendarService.ts` — Native calendar integration
- `app-mobile/src/components/activity/ProposeDateTimeModal.tsx` — Date/time picker

**Review flow:**
- `app-mobile/src/hooks/usePostExperienceCheck.ts` — Pending review detector
- `app-mobile/src/components/PostExperienceModal.tsx` — "Did you go?" modal
- `app-mobile/src/services/voiceReviewService.ts` — Review submission
- `supabase/migrations/20260303000015_voice_reviews.sql` — place_reviews schema
