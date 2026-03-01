# Implementation Report: Curated Plan View — Animated Timeline with Stop Detail Accordions
**Date:** 2026-02-28
**Status:** Complete
**Implementer:** Senior Engineer Skill

---

## What Was There Before

### Existing Files Modified
| File | Purpose Before Change |
|------|-----------------------|
| `app-mobile/src/types/curatedExperience.ts` | Defined `CuratedStop` and `CuratedExperienceCard` interfaces |
| `supabase/functions/generate-curated-experiences/index.ts` | Generated 3-stop curated cards with places + travel times; used flat `estimatedDurationMinutes: travelTotal + 210` |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Static `CuratedPlanView` — plain list of stops with address + directions only |

### Pre-existing Behavior
Opening a curated experience card showed a static, non-interactive list of three stops. Each stop had an image, name, type, rating, price, open/closed text, address, and a Get Directions button. No animations, no detail expansion, no AI descriptions, no opening hours detail, no reserve button, no total time footer.

---

## What Changed

### New Files Created
| File | Purpose | Key Exports |
|------|---------|-------------|
| `app-mobile/src/components/InAppBrowserModal.tsx` | Generic in-app browser for venue reservation pages | `default InAppBrowserModal` |

### Files Modified
| File | Change Summary |
|------|---------------|
| `app-mobile/src/types/curatedExperience.ts` | Added `aiDescription: string` and `estimatedDurationMinutes: number` to `CuratedStop` |
| `supabase/functions/generate-curated-experiences/index.ts` | Added `OPENAI_API_KEY`, `STOP_DURATION_MINUTES` map, `DEFAULT_STOP_DURATION`, `generateStopDescriptions()` function; updated `resolvePairing()` to call it and populate per-stop fields; fixed `estimatedDurationMinutes` formula |
| `app-mobile/src/components/ExpandedCardModal.tsx` | Added `useRef`, `Animated`, `LayoutAnimation` imports; added `InAppBrowserModal` import; added `FINE_DINING_TYPES` constant; rewrote `CuratedPlanView` with animations/accordions/reserve button/total time footer; added 19 new `curatedStyles` entries |

### Database Changes
None.

### Edge Functions
| Function | Change | Key Addition |
|----------|--------|--------------|
| `generate-curated-experiences` | Modified | `generateStopDescriptions()` — single batched OpenAI GPT-4o-mini call per card for all 3 stop descriptions |

### New Style Keys Added to `curatedStyles`
`stopHeaderRow`, `openBadge`, `openBadgeText`, `expandedSection`, `aiDescription`, `hoursSection`, `hoursSectionLabel`, `hoursRow`, `hoursDay`, `hoursDayToday`, `hoursTime`, `hoursTimeToday`, `reserveButton`, `reserveButtonText`, `totalTimeCard`, `totalTimeTextBlock`, `totalTimeLabel`, `totalTimeValue`, `totalTimeBreakdown`

---

## Implementation Details

### Architecture Decisions

**Single batched OpenAI call:** `generateStopDescriptions()` calls GPT-4o-mini once per card (not per stop), keeping API cost minimal. Returns a JSON array of 3 strings. Falls back to generic strings if the key is missing or the response is malformed.

**`gap` avoided for new styles:** New style entries use explicit `marginLeft`/`marginBottom` instead of `gap` to avoid potential issues on older RN versions. Existing styles with `gap` (already working) were left unchanged.

**`estimatedDurationMinutes` on `CuratedStop` is required (not optional):** The edge function always populates it. On the mobile side, the `CuratedPlanView` uses `?? 45` as a defensive fallback for old cached cards that lack the field.

**`FINE_DINING_TYPES` defined outside `CuratedPlanView`:** Defined as a `const Set` at module scope so it's not recreated on every render.

**Stagger animation via `useRef`:** `stopAnims` array is created once on mount using `useRef(card.stops.map(() => new Animated.Value(0))).current`, preventing recreation on re-renders.

**`LayoutAnimation` for accordion:** Native-driver smooth height animation for the expand/collapse of stop detail sections. Multiple stops can be open simultaneously (Set-based state).

---

## Test Results

| Test | Result | Notes |
|------|--------|-------|
| `npx tsc --noEmit` — curatedExperience.ts | ✅ Pass | No new errors |
| `npx tsc --noEmit` — ExpandedCardModal.tsx | ✅ Pass | Only pre-existing TimelineSection.currency errors (unrelated) |
| `npx tsc --noEmit` — InAppBrowserModal.tsx | ✅ Pass | No errors |
| Pre-existing TS errors unchanged | ✅ Confirmed | Same errors as before, no regression |

---

## Success Criteria Verification
- [x] Stops animate in with staggered entry on card expand — `Animated.stagger(120, ...)` with `translateY + opacity`
- [x] Each stop has a tap-to-expand accordion — `TouchableOpacity` on `stopHeaderRow` calls `toggleStop()`
- [x] AI-written description visible in expanded section — `stop.aiDescription` rendered in expanded section
- [x] Opening hours shown with today's day highlighted and Open/Closed badge — `todayName` match highlights in orange; `openBadge` chip shows green/red
- [x] Fine-dining stops with website show "Reserve a Table" button — guarded by `FINE_DINING_TYPES.has(stop.placeType) && stop.website`
- [x] Reserve button opens venue website in full-screen in-app WebView modal — `InAppBrowserModal` with `react-native-webview`
- [x] Travel connectors between stops show time + mode icon — preserved, mode now also handles `biking`/`transit`
- [x] Total time estimate footer shows after all stops — `totalTimeCard` block with stop/travel breakdown
- [x] No TypeScript errors (introduced by this feature) — verified
- [x] No regression in non-curated card flow — `CuratedPlanView` is only rendered for `isCuratedCard` branch
