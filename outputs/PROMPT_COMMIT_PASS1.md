# Commit Prompt: Pass 1 — Kill the Lies

**Skill:** Implementor
**Scope:** All Pass 1 changes (6 fixes + 3 medium fixes = 11 files)

---

## Files to Stage

```
app-mobile/src/components/activity/SavedTab.tsx
app-mobile/src/components/board/BoardSessionCard.tsx
app-mobile/src/components/SwipeableCards.tsx
app-mobile/src/components/CuratedExperienceSwipeCard.tsx
app-mobile/src/components/expandedCard/CardInfoSection.tsx
app-mobile/src/components/ExpandedCardModal.tsx
app-mobile/src/components/PersonGridCard.tsx
app-mobile/src/components/PersonCuratedCard.tsx
app-mobile/src/components/PersonHolidayView.tsx
app-mobile/src/components/expandedCard/PracticalDetailsSection.tsx
app-mobile/src/components/board/SwipeableSessionCards.tsx
```

## Commit Message

```
fix: kill fabricated data, wire currency to all surfaces, render opening hours

- Remove hardcoded fallback ratings ("4.5"), travel times ("15m", "12 min
  drive"), and prices ("$12-28") from SavedTab, BoardSessionCard, and
  SwipeableSessionCards — hide when missing or show em dash
- Hide "0.0 ★" on swipe deck when rating is null/0
- Wire user currency to 7 surfaces via useLocalePreferences() hook and
  prop threading — CuratedExperienceSwipeCard, CardInfoSection,
  ExpandedCardModal, PersonGridCard, PersonCuratedCard, PersonHolidayView,
  BoardSessionCard. No more hardcoded $
- SavedTab curated title shows experience title instead of stop names
- PracticalDetailsSection renders opening hours (string + structured)
- Replace paper-plane icon with travel-mode-aware icon on SavedTab +
  BoardSessionCard
```

## Do NOT push — just commit locally.
