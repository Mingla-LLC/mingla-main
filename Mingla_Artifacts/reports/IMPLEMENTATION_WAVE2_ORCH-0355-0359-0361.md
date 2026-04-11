# Implementation Report: Map Wave 2

> AH-058 | Implementor | 2026-04-10
> Issues: ORCH-0355, ORCH-0359, ORCH-0361
> Investigation: INV-015 (APPROVED)

---

## Files Changed

| # | File | Change |
|---|------|--------|
| 1 | `app-mobile/src/hooks/useFriendProfile.ts` | `.single()` → `.maybeSingle()`, null return for RLS-blocked profiles |
| 2 | `app-mobile/src/components/map/providers/ReactNativeMapsProvider.tsx` | Timeout-based `tracksViewChanges` for person markers (3s true → false) |
| 3 | `app-mobile/src/components/map/PlacePin.tsx` | Added name label below every place pin |
| 4 | `app-mobile/src/components/map/PersonBottomSheet.tsx` | Added shared categories pills for all relationships |

---

## Old → New Receipts

### useFriendProfile.ts
**What it did before:** Used `.single()` which throws "Cannot coerce the result to a single JSON object" when RLS blocks the read (strangers, seeds, private profiles). This crashed the ViewFriendProfileScreen.
**What it does now:** Uses `.maybeSingle()` which returns null for 0 rows. Returns `FriendProfileData | null` from the queryFn. The existing `!profile` check in ViewFriendProfileScreen (line 134) handles the null case with a graceful error screen.
**Why:** ORCH-0355 — prevents crash when viewing stranger/seed profiles.
**Lines changed:** 3

### ReactNativeMapsProvider.tsx
**What it did before:** All person markers had `tracksViewChanges={false}` permanently. If an avatar image failed to load on first render, the marker was stuck showing the fallback forever.
**What it does now:** `tracksViewChanges` starts as `true` for 3 seconds (allowing images to load and re-render), then flips to `false` for performance. Uses component-level state, not per-marker.
**Why:** ORCH-0361 — prevents avatar disappearance from failed initial image loads.
**Lines changed:** 8

### PlacePin.tsx
**What it did before:** Rendered colored circles with category icons. No text label. User had to tap to identify a pin.
**What it does now:** Adds a small truncated text label below every pin. For curated cards, shows the first stop name (split on arrow characters). For single cards, shows the place name. Max 15 chars with ellipsis. Wrappers resized to accommodate label (52x48 for singles, 64x62 for curated).
**Why:** ORCH-0359 — pins are now identifiable without tapping.
**Lines changed:** ~20

### PersonBottomSheet.tsx
**What it did before:** Showed avatar, name, relationship, activity status, and taste match (strangers only). Friends/paired had no interests displayed. The "You both enjoy" text was nested inside the taste match section (strangers only).
**What it does now:** Adds a shared categories pills section above the taste match, visible for ALL relationships when `sharedCategories` is non-empty. Orange-tinted pills with category names. The taste match section for strangers now shows only the percentage (the "You both enjoy" text was redundant with the new pills).
**Why:** ORCH-0355 — enriches the bottom sheet with interests data already available from `NearbyPerson`.
**Lines changed:** ~18

---

## Verification Matrix

| SC | Criterion | Status | Verification |
|----|-----------|--------|-------------|
| SC-01 | Stranger profile tap doesn't crash | PASS | `.maybeSingle()` returns null, ViewFriendProfileScreen handles `!profile` at line 134 |
| SC-02 | Friend profile still works | PASS | `.maybeSingle()` returns data for valid rows, same as `.single()` |
| SC-03 | No TS errors from return type change | PASS | Verified: 0 TS errors in useFriendProfile.ts |
| SC-04 | Category pills for friends | PASS | `person.sharedCategories` rendered for all relationships when non-empty |
| SC-05 | Category pills for strangers | PASS | Same code path, no relationship filter on pills section |
| SC-06 | No empty interests section | PASS | Guarded by `person.sharedCategories.length > 0` |
| SC-07 | Pills visually consistent | PASS | Uses orange-tinted style matching Mingla brand (bg #fff7ed, border #fed7aa, text #c2410c) |
| SC-08 | Every place pin has a label | PASS | `truncatedLabel` rendered when non-empty (all cards have titles) |
| SC-09 | Labels truncated at 15 chars | PASS | `pinLabel.length > 15 ? pinLabel.slice(0, 14) + '…' : pinLabel` |
| SC-10 | Curated pins show first stop name | PASS | Splits on arrow chars, takes first segment |
| SC-11 | Single pins show place name | PASS | Uses `card.title` directly |
| SC-12 | Labels don't break tap | PASS | Label is inside the Marker wrapper, onPress is on the Marker |
| SC-13 | Labels readable at default zoom | UNVERIFIED | fontSize 8 should be visible but needs device confirmation |
| SC-14 | Avatars render on first load | UNVERIFIED | `tracksViewChanges={true}` for 3s allows image loads; needs device test |
| SC-15 | tracksViewChanges false after 3s | PASS | `setTimeout(() => setPeopleTrackChanges(false), 3000)` verified |
| SC-16 | Initials fallback works | PASS | No change to fallback path — only `tracksViewChanges` prop changed |
| SC-17 | No performance degradation | UNVERIFIED | 3s window is brief; needs device profiling to confirm |

**Summary:** 14 PASS, 3 UNVERIFIED (need device/runtime testing)

---

## Regression Surface

1. **PlacePin tap interaction** — verify tapping pins still opens MapBottomSheet (label is inside the wrapper, should be fine)
2. **AnimatedPlacePin animation** — verify spring animation still works with larger wrapper
3. **PersonBottomSheet scroll** — verify bottom sheet scrolls properly with new interests pills
4. **Map performance** — verify no jank from 3s tracksViewChanges window
5. **ViewFriendProfileScreen** — verify friend profiles still load normally after maybeSingle change

---

## Discoveries for Orchestrator

None. All changes were within scope.
