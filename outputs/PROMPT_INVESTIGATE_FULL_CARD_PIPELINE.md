# Investigation Prompt: Full Card Pipeline Forensic Audit

**Skill:** Software and Code Architect (Investigator Mode)
**Date:** 2026-03-24
**Scope:** Complete forensic trace of every card-related path in the app — preferences through rendering, saving, scheduling, and display consistency.

---

## Context

We're doing a full pre-launch sweep of the entire card pipeline. Several prior investigations exist (listed below), but this investigation covers the GAPS those missed — focusing on cross-surface consistency, logical correctness, and the user experience of every card-related interaction.

**Prior work (DO NOT re-investigate these — they're already specced/fixed):**
- Preferences race condition (invalidateQueries line 866) — root cause proven
- Collab prefs not wired through (FIX_PREFERENCES_DECK_CONTRACT_SPEC.md) — specced
- Discover speed (FIX_DISCOVER_FORYU_SPEED_SPEC.md) — specced
- Paired holiday card latency (INVESTIGATION_PAIRED_HOLIDAY_CARD_LATENCY.md) — investigated
- Curated save/schedule/review bugs (INVESTIGATION_SAVE_SCHEDULE_REVIEW_CURATED.md) — investigated
- Curated stop generation bugs (INVESTIGATION_CURATED_CARD_STOPS.md) — investigated
- 10 deck hardening passes complete (see LAUNCH_READINESS_TRACKER.md)

**What this investigation MUST cover (the gaps):**

---

## Section 1: Preferences → Deck Data Contract (Solo + Collab)

Trace the FULL chain for BOTH solo and collab modes:

**Chain to trace:**
```
PreferencesSheet.tsx (user taps Apply)
  → what data is written to DB? (which fields, which table)
  → what is set in optimistic cache? (which query keys, what shape)
  → what triggers the deck refresh? (refreshKey bump? invalidation? new query keys?)
  → RecommendationsContext.tsx reads preferences
  → useDeckCards receives params
  → discover-cards edge function receives params
  → query_pool_cards RPC filters by params
  → cards returned to client
  → cards rendered in SwipeableCards
```

**Questions to answer:**
1. Does every preference field the user can set in PreferencesSheet actually affect what cards they see? Trace each field: categories, intents, price tiers, budget min/max, travel mode, travel constraint, datetime pref, date option, time slot, exact time.
2. In collab mode: does every field come from `aggregateAllPrefs()` or from the current user's solo prefs? (Known gap: S1 spec says collab is broken for budget/travel/datetime — verify this is still true in current code)
3. After the user changes preferences and closes the sheet, how many milliseconds until the deck shows new cards? What's the sequence of events? Is there ANY flash of old cards?
4. Is there a code path where the deck could show cards that DON'T match the user's current preferences? (The race condition is known — look for OTHER paths)

**Files to read:**
- `app-mobile/src/components/PreferencesSheet.tsx` (especially the onApply/onSave handler)
- `app-mobile/src/contexts/RecommendationsContext.tsx` (the full activeDeckParams → useDeckCards chain)
- `app-mobile/src/hooks/useDeckCards.ts`
- `app-mobile/src/services/deckService.ts`
- `supabase/functions/discover-cards/index.ts`
- `supabase/migrations/*query_pool_cards*` (the RPC)

---

## Section 2: Swipe Deck Contract — What Happens on Every Swipe

Trace what happens for each swipe direction, for BOTH single cards and curated cards:

**Swipe RIGHT (save):**
1. What function is called? Is it awaited?
2. What service writes to the DB? What table? What fields?
3. What cache keys are invalidated?
4. What toast/haptic feedback does the user get?
5. Does the card appear in SavedTab immediately? (optimistic update or wait for refetch?)
6. What happens if the save fails silently? Does the user know?

**Swipe LEFT (dismiss):**
1. What function is called?
2. Is the dismissal tracked? Where? (impressions table? local state?)
3. Can the user undo? (DismissedCardsSheet — does it work for curated?)
4. Does the card come back in future batches?

**Swipe UP (if exists — schedule or other action):**
1. Does this exist? What does it do?

**Card tap (expand):**
1. What data is passed to ExpandedCardModal?
2. Is ALL the data from the swipe card available in the expanded view?
3. Are there additional fetches when expanding? What if they fail?

**Files to read:**
- `app-mobile/src/components/SwipeableCards.tsx` (the swipe handler, all branches)
- `app-mobile/src/components/AppHandlers.tsx` (handleSaveCard, handleDismissCard)
- `app-mobile/src/services/savedCardsService.ts`
- `app-mobile/src/components/DismissedCardsSheet.tsx`

---

## Section 3: Card Data Consistency Across All Surfaces

The same card can appear in 7+ different surfaces. Check if the data shown is CONSISTENT and CORRECT across all of them:

**Surfaces to check:**
1. **SwipeableCards** (deck) — the swipe card
2. **CuratedExperienceSwipeCard** — curated card in deck
3. **ExpandedCardModal** — full card detail
4. **SavedTab** — saved card list item
5. **CalendarTab** — scheduled card list item
6. **PersonHolidayView / HolidayRow / PersonGridCard / PersonCuratedCard** — paired person view
7. **SessionViewModal / BoardSessionCard** — collaboration board

**For EACH surface, verify these fields are displayed correctly:**

| Field | What to check |
|-------|--------------|
| **Title** | Is it the place name (single) or experience title (curated)? Consistent? |
| **Category label** | Is it the display name ("Fine Dining") or the slug ("fine_dining")? Known bug: slugs leak to SavedTab |
| **Category icon** | Does the ICON_MAP have an entry for every category? Any blank icons? |
| **Price display** | Format: "$X - $Y" or "$$$$" or price tier? Consistent across surfaces? |
| **Price tier** | Does it show the Google price_level enum ("PRICE_LEVEL_MODERATE") or a user-friendly label? Known bug: paired view shows enum |
| **Rating** | Stars vs number? Missing rating = 0 or hidden? |
| **Travel time** | Computed at serve-time or stale from pool? Icon matches travel mode? |
| **Travel mode icon** | Walking/driving/transit? Does it reflect user's preference or card's data? |
| **Hours / Open status** | "Open now" vs actual hours? What if hours are null? |
| **Images** | First image or gallery? What if no images? Placeholder? |
| **Distance** | Shown? Computed how? Consistent unit (mi vs km)? |
| **Description** | Truncated? Full? Different lengths on different surfaces? |
| **Curated stops** | Do all surfaces show stops correctly? Stop labels, stop icons, stop order? |
| **"Saved" indicator** | If card is already saved, is there a visual indicator on the swipe card? |

**Files to read (for each surface):**
- `app-mobile/src/components/SwipeableCards.tsx` (card render section)
- `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`
- `app-mobile/src/components/ExpandedCardModal.tsx`
- `app-mobile/src/components/expandedCard/*.tsx` (all subsections)
- `app-mobile/src/components/activity/SavedTab.tsx` (renderSavedCard, renderCuratedCard)
- `app-mobile/src/components/activity/CalendarTab.tsx` (card rendering)
- `app-mobile/src/components/PersonHolidayView.tsx`
- `app-mobile/src/components/PersonGridCard.tsx`
- `app-mobile/src/components/PersonCuratedCard.tsx`
- `app-mobile/src/components/HolidayRow.tsx`
- `app-mobile/src/components/board/BoardSessionCard.tsx`

---

## Section 4: Save Flow — Every Entry Point

There are 6 entry points where a user can save a card. Trace each one:

| # | Entry Point | Component | Handler |
|---|------------|-----------|---------|
| 1 | Swipe right on deck | SwipeableCards.tsx | onCardLike → handleSaveCard |
| 2 | Save button in ExpandedCardModal | ActionButtons.tsx | onSave callback |
| 3 | Save button in DismissedCardsSheet | DismissedCardsSheet.tsx | handleSave |
| 4 | Save from paired person view | PersonHolidayView → CardRow | onSave callback |
| 5 | Save from collaboration board | SessionViewModal | save handler |
| 6 | Auto-save on session card add | BoardCardService | saveCardToBoard |

**For each entry point, answer:**
1. Is the save awaited or fire-and-forget?
2. What exactly is written to the DB? (table, fields, JSONB shape)
3. Does the card_data JSONB contain ALL fields needed to render the card in SavedTab?
4. Is query cache invalidated? Which keys?
5. What toast/feedback does the user get on success?
6. What happens on failure? (silent, toast, alert, retry?)
7. Is there an optimistic update, or does the UI wait for refetch?
8. For curated cards: are stops included in the saved data?
9. For collab mode: does it save to `board_saved_cards` instead of `saved_card`?

---

## Section 5: Schedule Flow — Every Entry Point

There are 3 main entry points for scheduling:

| # | Entry Point | Component | Handler |
|---|------------|-----------|---------|
| 1 | Schedule button in SavedTab | SavedTab.tsx | handleSchedule / handleScheduleCurated |
| 2 | Schedule button in ExpandedCardModal | ActionButtons.tsx | handleSchedule |
| 3 | Schedule from AppHandlers | AppHandlers.tsx | handleScheduleFromSaved |

**For each entry point, answer:**
1. Does it show a date/time picker? What component?
2. Can the user pick today's date? (Known bug: "Cancel" instead of "Done" for today)
3. Does it validate the place is open at the chosen time?
4. For curated cards: does it check ALL stops' hours?
5. What happens after confirming?
   - Is the card removed from SavedTab?
   - Is it added to CalendarTab?
   - Is it synced to device calendar?
   - What toast/feedback?
6. Is there a confirmation step before scheduling? (Known bug: no confirmation from expanded card)
7. What happens if device calendar permission is denied?
8. What happens if the DB write fails?

---

## Section 6: Loading, Error, and Empty States — Every Screen

For each screen/modal below, READ the actual render logic and report:

| Screen | Loading State | Error State | Empty State |
|--------|-------------|-------------|-------------|
| DiscoverScreen | What shows? Skeleton or spinner? | Retry button? | "No experiences" with CTA? |
| SavedTab | What shows during fetch? | What if fetch fails? | What if no saved cards? |
| CalendarTab | What shows during fetch? | What if fetch fails? | What if no scheduled cards? |
| PersonHolidayView | What shows? | Retry? | Fallback cards? |
| ExpandedCardModal | What shows while loading weather/busyness? | What if supplemental data fails? | N/A |
| SessionViewModal | What shows? | Permission error? | No cards in session? |
| ProfilePage | Location loading? | Location error? | N/A |
| DismissedCardsSheet | What shows? | Error? | No dismissed cards? |

**Key questions:**
1. Are skeleton components (`LoadingSkeleton`, `SkeletonCard`) used ANYWHERE? Or only ActivityIndicator spinners?
2. Is there any screen that shows a blank/white flash before content appears?
3. Is there any screen that shows stale data from a previous session before refreshing?
4. Constitution Principle 1: "Show UI first, fetch after" — which screens violate this?

---

## Section 7: Logical Consistency — Things That Should Make Sense

Check these specific logical consistency issues:

1. **Category + icon alignment:** Does every category have a correct icon in ICON_MAP? Run through all 13 categories + curated experience types.
2. **Price display consistency:** Is price shown the same way (format, currency, tier labels) across deck, expanded, saved, calendar, paired?
3. **Travel time consistency:** Is the travel time shown on a card in the deck the same as in the expanded view? The same as in the saved tab?
4. **Hours consistency:** If a card shows "Open" in the deck but the expanded view shows "Closed", that's a lie. Check the data source for each surface.
5. **Curated card stop ordering:** Are stops always shown in the same order across all surfaces? (deck card, expanded, saved, calendar)
6. **"Already saved" detection:** If I save a card, then see it again in the deck (via paired view or different session), does it show as "already saved"?
7. **Currency:** Is the currency always correct for the user's locale? Or does it change with GPS? (Known concern from tracker)

---

## Output Format

Write findings to `outputs/INVESTIGATION_FULL_CARD_PIPELINE_AUDIT.md` with this structure:

```markdown
# Full Card Pipeline Audit

## Summary (plain English, what a non-engineer would understand)

## Section 1: Preferences → Deck Contract
### Facts (with file:line evidence)
### Bugs Found
### Inferences

## Section 2: Swipe Deck Contract
### Facts
### Bugs Found
### Inferences

## Section 3: Card Data Consistency
### Cross-Surface Comparison Table
### Bugs Found (inconsistencies)

## Section 4: Save Flow Audit
### Entry Point Comparison Table
### Bugs Found

## Section 5: Schedule Flow Audit
### Entry Point Comparison Table
### Bugs Found

## Section 6: Loading/Error/Empty States
### Screen-by-Screen Assessment Table
### Bugs Found

## Section 7: Logical Consistency
### Findings

## Master Bug List (NEW bugs only — not repeating prior investigations)
| # | Bug | Severity | File:Line | Category |
```

**Severity ratings:**
- **RED** — User-visible data loss, corruption, or crash
- **ORANGE** — User-visible lie (wrong data shown, stale state, misleading UI)
- **YELLOW** — Latent bomb (works now, will break under specific conditions)
- **GREEN** — Quality/polish issue (inconsistent formatting, missing feedback)

**CRITICAL INSTRUCTION:** Do NOT include a summary paragraph about what you did. Just the artifact. The user reads it directly.

**CRITICAL INSTRUCTION:** For every bug, cite the exact file and line number. "Somewhere in SavedTab" is not acceptable.

**CRITICAL INSTRUCTION:** Separate facts from inferences. State confidence level for each inference.

**CRITICAL INSTRUCTION:** When checking solo mode, ALWAYS also check collab mode for the same issue. Fix both or note both.
