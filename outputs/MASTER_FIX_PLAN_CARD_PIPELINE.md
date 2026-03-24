# Master Fix Plan: Card Pipeline Hardening

**Date:** 2026-03-24
**Mode:** PIPELINE (gated)
**Total bugs:** 28 new (pipeline audit) + 16 existing (prior specs/investigations) = 44
**Approach:** Truthfulness first → preferences contract → save safety → loading states → speed → generation quality

---

## Bug Inventory (Unified)

### From Pipeline Audit (NEW — 28 bugs)

| # | Bug | Severity | Pass |
|---|-----|----------|------|
| A1 | Fabricated ratings "4.5" on SavedTab + BoardSessionCard | ORANGE | 1 |
| A2 | Fabricated travel times "15m" / "12 min drive" | ORANGE | 1 |
| A3 | Fabricated price "$12-28" on BoardSessionCard | ORANGE | 1 |
| A4 | Currency conversion missing on 7/10 price surfaces | ORANGE | 1 |
| A5 | SavedTab curated title shows stop names, not experience title | ORANGE | 1 |
| A6 | PracticalDetailsSection accepts openingHours but never renders | ORANGE | 1 |
| A7 | SavedTab `handleSchedule` checks current-time, not selected-time openness | ORANGE | 3 |
| A8 | ActionButtons schedule skips curated stop-level validation | ORANGE | 3 |
| A9 | ForYou tab no Retry button on error | ORANGE | 4 |
| A10 | SavedTab no error state for initial load failure | ORANGE | 4 |
| A11 | CalendarTab no loading state for initial data | ORANGE | 4 |
| A12 | `initialData` stale batch on cold start (pill-only match) | ORANGE | 2 |
| A13 | `budgetMin` dead code through 4 layers | YELLOW | 2 |
| A14 | Collab `aggregateAllPrefs` drops dateOption/timeSlot/exactTime | YELLOW | 2 |
| A15 | Collab `collabDeckParams` aggregated values are dead code | YELLOW | 2 |
| A16 | Solo `card_data` blind spread vs collab explicit mapping | YELLOW | 3 |
| A17 | `handleSwipe` fire-and-forget = unhandled promise rejections | YELLOW | 3 |
| A18 | No haptic feedback on swipe | GREEN | 5 |
| A19 | 5 different category icon systems | GREEN | 5 |
| A20 | SavedTab/BoardSessionCard use paper-plane icon for travel | GREEN | 1 |
| A21 | Rating star color varies across 5 hex values | GREEN | 5 |
| A22 | SwipeableCards shows 0.0 for missing rating; others hide/fake | GREEN | 1 |
| A23 | Unsplash stock photo fallback only on swipe deck | GREEN | 5 |
| A24 | Optional curated stops shown on SavedTab but filtered on deck | GREEN | 5 |
| A25 | DismissedCardsSheet save no error feedback | GREEN | 3 |
| A26 | ProfilePage locationError never rendered | GREEN | 4 |
| A27 | Two skeleton components are dead code | GREEN | 4 |
| A28 | isSaved hardcoded false — no "already saved" indicator | GREEN | 5 |
| — | handleScheduleFromSaved dead code (DOWNGRADED from RED) | DEAD CODE | 3 |
| — | Save failure = card lost from deck (RED) | RED | 3 |

### From Prior Specs/Investigations (EXISTING — 16 bugs)

| # | Bug | Source | Severity | Pass |
|---|-----|--------|----------|------|
| E1 | Preferences race condition (invalidateQueries line 866) | User-reported | RED | 2 |
| E2 | Collab prefs not wired (budget/travel/datetime) | S1 Spec Gap 1 | ORANGE | 2 |
| E3 | Scoring ignores priceTier | S1 Spec Gap 2 | ORANGE | 6 |
| E4 | matchFactors hardcoded | S1 Spec Gap 3 | ORANGE | 6 |
| E5 | 12 per-category queries (speed) | S2 Spec Change 1 | PERF | 6 |
| E6 | Sequential awaits in edge function | S2 Spec Change 2 | PERF | 6 |
| E7 | Duplicate useAuthSimple (speed) | S2 Spec Change 3 | PERF | 6 |
| E8 | No warmPing on boot | S2 Spec Change 4 | PERF | 6 |
| E9 | No client timeout on discoverExperiences | S2 Spec Change 5 | PERF | 6 |
| E10 | No skeleton pills on mount | S2 Spec Change 6 | PERF | 4 |
| E11 | Paired view radius expansion loop (latency) | I1 Investigation | PERF | 7 |
| E12 | Curated save fire-and-forget | I2 BUG 5 | RED | 3 |
| E13 | Default page noop save handler | I2 BUG 6 | YELLOW | 3 |
| E14 | Stop labels wrong when optional skipped | I3 BUG 1 | RED | 7 |
| E15 | Fine dining price floor dead code | I3 BUG 2 | RED | 7 |
| E16 | google_place_id collision (curated overwrites single) | I3 BUG 3 | RED | 7 |

---

## Pass Sequence

### Pass 1: Kill the Lies (6 fixes — Truthfulness)

**Theme:** Remove every piece of fabricated data. Make the UI show truth or nothing.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 1a | A1+A2+A3 | Remove ALL hardcoded fallbacks on SavedTab + BoardSessionCard. If rating/travel/price is null → show nothing or "—", not fake data. |
| 1b | A22 | SwipeableCards: hide rating section when rating is null/0 (don't show "0.0 ★") |
| 1c | A4 | Wire `currencySymbol` + `currencyRate` through to ALL 7 missing price surfaces: CuratedExperienceSwipeCard, CardInfoSection, ExpandedCardModal curated header, PersonGridCard, PersonCuratedCard, PersonHolidayView, BoardSessionCard |
| 1d | A5 | SavedTab curated: show `card.title` (experience title) instead of `stops.map(s => s.placeName).join(' -> ')` |
| 1e | A6 | PracticalDetailsSection: actually render `openingHours` (it's already in props) |
| 1f | A20 | SavedTab + BoardSessionCard: use `getTravelModeIcon(card.travelMode)` instead of `paper-plane` |

**Constitution compliance:** Principle 1 (no dead taps → truthful data), Principle 8 (subtract fabricated fallbacks).

**Files touched:** SavedTab.tsx, BoardSessionCard.tsx, SwipeableCards.tsx, CuratedExperienceSwipeCard.tsx, CardInfoSection.tsx, ExpandedCardModal.tsx, PersonGridCard.tsx, PersonCuratedCard.tsx, PersonHolidayView.tsx, PracticalDetailsSection.tsx

---

### Pass 2: Fix the Preferences Contract (4 fixes)

**Theme:** What you pick is what you get. No stale cards, no dead code, no race conditions.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 2a | E1 | Remove destructive `invalidateQueries(["userPreferences"])` from PreferencesSheet lines 863-866. AppHandlers already does optimistic cache + refreshKey bump. |
| 2b | A12 | useDeckCards.ts: expand `initialData` match to include priceTiers + travelMode + datetimePref (not just pills/categories) |
| 2c | A13+A14+A15 | Dead code cleanup: remove `budgetMin` from 4 layers; remove dead `collabDeckParams` fields; add dateOption/timeSlot/exactTime to `aggregateAllPrefs` (or document as solo-only) |
| 2d | E2 | Wire collab aggregated prefs into useDeckCards (S1 Spec Gap 1 — mode-aware resolution block) |

**Constitution compliance:** Principle 2 (one owner per truth), Principle 8 (subtract dead code).

**Files touched:** PreferencesSheet.tsx, useDeckCards.ts, deckService.ts, discover-cards/index.ts, RecommendationsContext.tsx, sessionPrefsUtils.ts

---

### Pass 3: Save Safety + Schedule Integrity (4 fixes)

**Theme:** Saves must succeed or the user must know. Schedules must validate.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 3a | RED (save rollback) + E12 | SwipeableCards: don't remove card from deck until save succeeds. If save fails, snap card back + show error toast. Await the save promise. |
| 3b | A17 + E13 | Fix unhandled promise rejections in handleSwipe. Remove default noop handler in index.tsx (or guard against it). |
| 3c | A7 | SavedTab handleSchedule: validate at SELECTED time, not current time. Pass scheduled datetime to hours check. |
| 3d | A8 + A16 + dead code | ActionButtons: add curated stop-level hours validation. Solo card_data: explicit field mapping (match collab pattern). Remove dead `handleScheduleFromSaved`. |

**Constitution compliance:** Principle 1 (no dead taps — save must work or tell you it didn't), Principle 5 (server state server-side — save confirmation from server, not optimistic removal).

**Files touched:** SwipeableCards.tsx, AppHandlers.tsx, index.tsx, SavedTab.tsx, ActionButtons.tsx, savedCardsService.ts

---

### Pass 4: Loading & Error States (4 fixes)

**Theme:** Every screen must handle loading, error, and empty truthfully. Show UI first.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 4a | A9 | DiscoverScreen ForYou: add Retry button to error state (matching NightOut pattern) |
| 4b | A10 + A26 | SavedTab: add error state with retry. ProfilePage: render locationError. |
| 4c | A11 + A27 | CalendarTab: add loading state. Replace ActivityIndicator with existing SkeletonCard component (revive dead code). |
| 4d | E10 | DiscoverScreen: add skeleton pills on mount (S2 Spec Change 6) |

**Constitution compliance:** Principle 1 (show UI first, fetch after).

**Files touched:** DiscoverScreen.tsx, SavedTab.tsx, CalendarTab.tsx, ProfilePage.tsx (or ProfileHeroSection), SkeletonCard.tsx, LoadingSkeleton.tsx

---

### Pass 5: Visual Consistency Polish (4 fixes)

**Theme:** Same card, same look, everywhere.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 5a | A19 | Consolidate 5 icon systems into 1 canonical `CATEGORY_ICON_MAP` in a shared util. All surfaces import from there. |
| 5b | A21 | Unify star color to single design-system color (from designSystem.ts). |
| 5c | A18 | Add haptic feedback on swipe right (success) and swipe left (light). Match DismissedCardsSheet pattern. |
| 5d | A23+A24+A28+A25 | Unify image fallback (gray placeholder everywhere). Fix optional stop display consistency. Add "already saved" indicator. Add error feedback to DismissedCardsSheet save. |

**Files touched:** New shared util (categoryIconMap.ts), SwipeableCards.tsx, all surfaces that render icons, SavedTab.tsx, BoardSessionCard.tsx, DismissedCardsSheet.tsx, ExpandedCardModal.tsx

---

### Pass 6: Speed + Scoring (existing specs — S1 Gaps 2-3 + S2)

**Theme:** Sub-1s discover, real scoring, real matchFactors.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 6a | E3 | Add priceTierMatch to scoringService (S1 Spec Gap 2) |
| 6b | E4 | Wire real scoringFactors into matchFactors (S1 Spec Gap 3) |
| 6c | E5+E6 | Edge function: consolidate 12→1 query, parallelize awaits (S2 Changes 1+2) |
| 6d | E7+E8+E9 | Client: remove duplicate auth, add warmPing, add 10s timeout (S2 Changes 3+4+5) |

**Files touched:** scoringService.ts, deckService.ts, discover-experiences/index.ts, DiscoverScreen.tsx, AppStateManager.tsx, experienceGenerationService.ts

---

### Pass 7: Generation Quality + Paired Latency (existing investigations — needs specs first)

**Theme:** Fix card generation bugs + paired view speed.

| Fix | Bug | What Changes |
|-----|-----|-------------|
| 7a | E14 | Stop labels: use actual stops.length, not typeDef.stops.length |
| 7b | E15 | Fine dining: add `return false` to empty if-block |
| 7c | E16 | Curated google_place_id: use synthetic ID (`curated_{type}_{hash}`) |
| 7d | E11 | Replace radius expansion loop with single indexed query (needs new migration spec) |

**NOTE:** Pass 7 needs specs written for 7a-7c (from I3 investigation) and 7d (from I1 investigation) before implementation.

**Files touched:** generate-curated-experiences/index.ts, new migration for query_person_hero_cards RPC

---

## Execution Rules

1. **Each pass gets its own spec → approve → implement → test → commit cycle**
2. **3-4 fixes per pass max** (Passes 1 and 6 are larger because fixes are tightly related)
3. **No pass starts until the previous pass is committed**
4. **If a fix in Pass N breaks something tested in Pass N-1, stop and fix before continuing**
5. **Tracker updated after each pass with test evidence**

---

## Ready to Start

**Pass 1 is ready for spec.** All 6 fixes are straightforward subtractions (remove fake data, wire existing currency system). No new features, no schema changes, no edge function changes.

Should I write the Pass 1 spec prompt?
