# Implementation Report: ORCH-0406 + ORCH-0408 + ORCH-0409

> **Date:** 2026-04-13
> **Status:** Implemented, partially verified (code review + TypeScript pass; needs device testing)
> **Files changed:** 8 files, ~20 lines added/modified
> **TypeScript:** 0 errors

---

## ORCH-0406: Price Tier Missing on Every Expanded Single Card

### Changes (7 conversion sites + 2 modal fixes)

#### Site 1: SwipeableCards.tsx (line ~1173)

**Before:** `priceTier` not included in ExpandedCardData construction
**Why it was that way:** Original conversion was written before priceTier was added to ExpandedCardData type. Nobody updated the conversion when the type was extended.
**After:** Added `priceTier: currentRec.priceTier as ExpandedCardData['priceTier'],`
**Why safe:** `currentRec` is a `Recommendation` which has `priceTier?: string` (recommendation.ts:45). The cast to `ExpandedCardData['priceTier']` (which is `PriceTierSlug | undefined`) is safe because deckService.ts:80 already ensures valid tier slugs.
**Revert:** Remove the `priceTier:` line. Expanded cards will show "Chill" again.

#### Site 2: DiscoverScreen.tsx handleCardPress (line ~2398)

**Before:** `priceTier` not included
**Why:** Same as Site 1 — conversion predates type extension
**After:** Added `priceTier: (card as any).priceTier as ExpandedCardData['priceTier'],`
**Why safe:** `FeaturedCardData` doesn't have `priceTier` on its type, but the runtime data includes it from the recommendation source. `as any` is needed because the type is incomplete. The value is `undefined` if not present, which is safe.
**Revert:** Remove the line.

#### Site 3: DiscoverScreen.tsx handleGridCardPress (line ~2448)

**Before/After/Safety:** Same pattern as Site 2. `GridCardData` also lacks typed `priceTier`.

#### Site 4: DiscoverScreen.tsx map pin press (line ~2951)

**Before:** `priceTier` was ONLY in the curated spread block (line ~2962), meaning single cards from map pins never got it.
**After:** Moved `priceTier: card.priceTier as ExpandedCardData["priceTier"],` to the base object (before the curated spread). Removed it from the curated spread since the base now covers both.
**Why safe:** The `card` parameter has `priceTier: string | null` in its inline type (DiscoverScreen.tsx:2916). For curated cards, the base object sets it, and the spread no longer overrides — but the value is the same.
**Revert:** Move `priceTier` back into the curated spread. Single map-pin cards will lose it.

#### Site 5: SavedTab.tsx (line ~1511)

**Before:** Not included
**After:** Added `priceTier: card.priceTier as ExpandedCardData['priceTier'],`
**Why safe:** `SavedCard` interface has `priceTier?: string` (SavedTab.tsx:69).
**Revert:** Remove the line.

#### Site 6: CalendarTab.tsx (line ~1162)

**Before:** Not included
**After:** Added `priceTier: ((experience as any).priceTier || (entry as any).priceTier) as ExpandedCardData['priceTier'],`
**Why safe:** Calendar entry data comes from either `experience` or `entry` objects. The `as any` is needed because neither type declares `priceTier`. Falls back through both sources. If neither has it, result is `undefined` which is the safe default.
**Revert:** Remove the line.

#### Site 7: SessionViewModal.tsx (line ~557)

**Before:** Not included
**After:** Added `priceTier: (cardData as any).priceTier as ExpandedCardData['priceTier'],`
**Why safe:** `SavedCardData` interface doesn't declare priceTier but runtime data may include it. `as any` needed for access. Undefined fallback is safe.
**Revert:** Remove the line.

#### Fix B: ExpandedCardModal.tsx line 1055 — alt-stops price display

**Before:** `{alt.priceTier ? alt.priceTier.charAt(0).toUpperCase() + alt.priceTier.slice(1) : ''}`
**Why it was that way:** Quick implementation that skipped the proper tier label function. Capitalizes raw slug ("comfy" → "Comfy") instead of using the display function ("Comfy").
**After:** `{alt.priceTier ? tierLabel(alt.priceTier as PriceTierSlug) : ''}`
**Why safe:** `tierLabel` and `PriceTierSlug` are already imported at ExpandedCardModal.tsx:22. `tierLabel` returns the proper display label for any valid slug. Invalid slugs return the slug itself (no crash).
**Revert:** Revert to the charAt/slice pattern.

#### Fix C: ExpandedCardModal.tsx lines 1791-1792 — remove unsafe casts

**Before:** `priceTier={(card as any).priceTier}` / `priceLevel={(card as any).priceLevel}`
**Why it was that way:** `priceTier` was listed under "curated fields" in the type, so the developer wasn't sure it existed. `priceLevel` doesn't exist on `ExpandedCardData` at all — it was always undefined.
**After:** `priceTier={card.priceTier}` / `priceLevel={undefined}`
**Why safe:** `ExpandedCardData.priceTier` is typed as `PriceTierSlug | undefined` (expandedCardTypes.ts:133). Direct access is type-safe. `priceLevel` was always undefined via `(card as any).priceLevel`; making it explicit changes nothing at runtime.
**Revert:** Re-add the `as any` casts.

---

## ORCH-0408: Quoted Message Compressed to Invisibility

### Change: ReplyQuoteBlock.tsx lines 110-113

**Before:**
```typescript
content: {
  flex: 1,
  minWidth: 0,
},
```
**Why it was that way:** `flex: 1` is the standard "fill remaining space" pattern. `minWidth: 0` is a common CSS trick to allow text truncation in flex containers. Together they work well when the parent has a fixed width — but the parent bubble auto-sizes to its content.
**After:**
```typescript
content: {
  flexGrow: 1,
  flexShrink: 1,
  flexBasis: 'auto' as const,
  minWidth: 0,
},
```
**Why safe:** `flexBasis: 'auto'` makes the content area calculate its intrinsic width from its text children, forcing the parent bubble to expand to fit. `flexGrow: 1` still fills remaining space. `flexShrink: 1` still allows shrinking (for very long quotes). `minWidth: 0` kept for proper `numberOfLines` truncation. The `as const` satisfies TypeScript's string literal type for `flexBasis`.
**Revert:** Change back to `flex: 1, minWidth: 0`. Short-reply quote blocks will compress again.

---

## ORCH-0409: Map Avatars Disappearing — Periodic Heartbeat

### Change: ReactNativeMapsProvider.tsx (after line 56)

**Before:** No heartbeat. `tracksViewChanges` was true for 3s on data change, then false permanently until next data change.
**Why it was that way:** ORCH-0361 (2026-04-10) added the 3s window to allow avatar image loading. Freezing after 3s is a standard react-native-maps optimization to prevent per-frame bitmap rendering of every marker, which causes scroll jank on older devices.
**After:** Added a `useEffect` with `setInterval(45_000)` that sets `setPeopleTrackChanges(true)` then `setTimeout(false, 3000)`. This creates a 3s re-thaw window every 45 seconds.
**Why safe:**
1. The existing fingerprint-based effect (lines 52-56) still handles data-change-triggered re-thaws
2. The heartbeat's `setPeopleTrackChanges(true)` and the fingerprint effect's both set the same state — no conflict
3. If both fire simultaneously, `tracksViewChanges` stays true for max(remaining timers) then goes false — no harm
4. The `useEffect` cleanup returns `clearInterval`, preventing leaks on unmount
5. CPU cost: 3s out of 45s = ~7% overhead. With <50 markers, negligible
**Revert:** Remove the heartbeat `useEffect` block. Markers may intermittently vanish as before.

---

## Verification Matrix

| Criterion | Method | Result |
|-----------|--------|--------|
| TypeScript passes | `npx tsc --noEmit` | **PASS** — 0 errors |
| No new imports needed | Verified all files already import ExpandedCardData and tierLabel/PriceTierSlug | **PASS** |
| ORCH-0406 SC1: Bougie card shows Bougie expanded | Code trace: priceTier now flows through all 7 paths | **UNVERIFIED** — needs device test |
| ORCH-0406 SC2: All 7 entry points | All 7 sites now include priceTier | **PASS** (code verified) |
| ORCH-0406 SC3: Alt-stops show proper label | tierLabel() replaces charAt pattern | **PASS** (code verified) |
| ORCH-0406 SC4: No `as any` priceTier casts in ExpandedCardModal | Replaced with typed access | **PASS** (code verified) |
| ORCH-0408 SC1: Quote visible with "ok" reply | flexBasis:'auto' forces bubble expansion | **UNVERIFIED** — needs device test |
| ORCH-0408 SC2: Quote visible with emoji + image | Same mechanism | **UNVERIFIED** — needs device test |
| ORCH-0408 SC3: Long quote truncates properly | minWidth:0 + numberOfLines preserved | **UNVERIFIED** — needs device test |
| ORCH-0409 SC1: Markers don't disappear | Heartbeat re-thaws every 45s | **UNVERIFIED** — needs 48h device test |
| ORCH-0409 SC2: No frame drops during heartbeat | 3s window with <50 markers | **UNVERIFIED** — needs device test |

---

## Regression Surface

1. **Collapsed card price display** — verify price tier still shows correctly on swipeable deck cards (no regression from the expansion-only fix)
2. **Curated card expanded view** — verify main stops still show correct tier (only alt-stops changed)
3. **DM long message quotes** — verify long quotes still truncate properly (minWidth:0 kept)
4. **Map panning performance** — verify no jank during heartbeat window
5. **Map initial avatar load** — verify ORCH-0361 behavior preserved (avatars still load in first 3s)

---

## Discoveries for Orchestrator

None. All changes within scope. Fabricated socialStats (ORCH-0413) intentionally not addressed per constraints.
