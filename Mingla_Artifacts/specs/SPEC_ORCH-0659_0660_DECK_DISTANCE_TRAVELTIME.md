# SPEC — ORCH-0659 + ORCH-0660: Deck Distance + Expanded-View Travel Time

**Spec author:** mingla-forensics (SPEC mode)
**Date:** 2026-04-25 (early morning)
**Severity:** S0-Critical (escalated from S1)
**Investigation reference:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`
**Orchestrator dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`

---

## §1 — Layman summary

The deck's category-card endpoint never computes distance or travel time — it ships every card with hardcoded zeros. We're going to fix that one transformer in `discover-cards` (mirroring how the curated path already does it), then clean up four mobile layers of "0 sentinel + empty string" guards that were stacked downstream to defend against the bad backend shape. After the fix, every card on the deck shows real distance + real per-mode travel time (e.g., "0.8 km" + "12 min walk"), the expanded-view shows the same plus a mode-matching icon, and the dead `hideTravelTime` prop and dead `timeAway` field are deleted (subtract before adding). One commit, one OTA. No DB migration. No new external API call.

---

## §2 — Five-truth-layer impact

| Layer | Affected? | What changes |
|-------|-----------|--------------|
| **Docs** | YES | Investigation + this spec + INVARIANT_REGISTRY entry. README untouched. |
| **Schema** | NO | No DDL. No RLS change. No migration. |
| **Code (edge fn)** | YES | `discover-cards/index.ts`, `generate-curated-experiences/index.ts`, new `_shared/distanceMath.ts`, `_shared/stopAlternatives.ts` (re-export only). |
| **Code (mobile)** | YES | `recommendation.ts`, `expandedCardTypes.ts`, `deckService.ts`, `cardConverters.ts`, `useMapCards.ts`, `usePairedMapSavedCards.ts`, `SwipeableCards.tsx`, `CardInfoSection.tsx`, `ExpandedCardModal.tsx`. |
| **Runtime** | YES (improved) | Live `discover-cards` invocation now computes haversine + per-mode estimate per card. Adds at most ~1ms per card (haversine is trivial trig). |
| **Data** | NO | No backfill (impractical per OBS-2). No persisted shape change. Saved cards retain stale empty values; rendering layer hides badges instead of fabricating. |

---

## §3 — Database layer

**No DB changes.** No migration, no RLS edit, no constraint change, no new column. This is a code-only fix.

---

## §4 — Edge function layer

### §4.1 — Create `supabase/functions/_shared/distanceMath.ts`

**Rationale:** `_shared/stopAlternatives.ts` already exports `haversineKm` + `estimateTravelMinutes` but its module also imports the supabase client at the top (cold-start cost for any consumer). Extract to a leaf module with zero side-effect imports.

**File contents (verbatim — implementor must copy):**

```typescript
// ORCH-0659 + ORCH-0660: Single owner for distance + travel-time math.
// Replaces duplicate copies in generate-curated-experiences/index.ts and
// _shared/stopAlternatives.ts. Pure leaf module — zero side-effect imports.
//
// I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME: every card emitted by any
// deck-serving edge function MUST carry haversine-computed distanceKm AND
// per-mode travelTimeMin (or explicit null when lat/lng or user-location
// is missing). Never use 0 as a sentinel for "missing".

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking' | 'bicycling';

/**
 * Great-circle distance between two lat/lng points, in kilometers.
 * Uses the haversine formula with Earth radius R=6371km.
 */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Estimated travel time in minutes for a given distance + mode.
 * Per-mode `factor` corrects for non-straight-line routes; speeds are
 * effective speeds (post-traffic, post-stop-light). Floored at 3 minutes
 * to match the curated path. Unknown modes fall back to walking.
 *
 * Sample (Raleigh-center → Williamson Preserve, 17.7 km):
 *   walking  → ~307 min  (4.5 km/h × 1.3 factor)
 *   driving  →  ~43 min  (35 km/h × 1.4 factor)
 *   transit  →  ~69 min  (20 km/h × 1.3 factor)
 *   biking   →  ~99 min  (14 km/h × 1.3 factor)
 */
export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const config: Record<string, { speed: number; factor: number }> = {
    walking:   { speed: 4.5, factor: 1.3 },
    driving:   { speed: 35,  factor: 1.4 },
    transit:   { speed: 20,  factor: 1.3 },
    biking:    { speed: 14,  factor: 1.3 },
    bicycling: { speed: 14,  factor: 1.3 },
  };
  const { speed, factor } = config[travelMode] ?? config.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}
```

### §4.2 — `supabase/functions/discover-cards/index.ts` rewrite

**§4.2.1 — Add import at top of file** (after existing imports, before `const SUPABASE_URL`):

```typescript
import { haversineKm, estimateTravelMinutes, type TravelMode } from '../_shared/distanceMath.ts';
```

**§4.2.2 — Rewrite `transformServablePlaceToCard` (lines 530-562):**

Old signature:
```typescript
function transformServablePlaceToCard(row: any, categoryLabel: string): any {
```

New signature:
```typescript
function transformServablePlaceToCard(
  row: any,
  categoryLabel: string,
  userLat: number,
  userLng: number,
  travelMode: TravelMode,
): any {
```

Replace lines 554-555 (`distanceKm: 0, travelTimeMin: 0,`) with:

```typescript
    // ORCH-0659/0660: honest distance + per-mode travel-time computation.
    // I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME — never 0-sentinel; if either
    // place lat/lng is null, both fields drop to null so mobile hides the
    // badge instead of fabricating a misleading value.
    const placeLat = typeof row.lat === 'number' ? row.lat : null;
    const placeLng = typeof row.lng === 'number' ? row.lng : null;
    const distanceKm: number | null = (placeLat !== null && placeLng !== null)
      ? Math.round(haversineKm(userLat, userLng, placeLat, placeLng) * 100) / 100
      : null;
    const travelTimeMin: number | null = distanceKm !== null
      ? Math.round(estimateTravelMinutes(distanceKm, travelMode))
      : null;
```

Then replace the `distanceKm: 0, travelTimeMin: 0,` field assignments in the returned object with:

```typescript
    distanceKm,
    travelTimeMin,
    travelMode,  // Mobile uses this to render the matching mode-icon
```

**§4.2.3 — Update the call site at line 932:**

Old:
```typescript
    const rawCards = interleavedRows.map((row: any) =>
      transformServablePlaceToCard(row, row.__displayCategory ?? categories[0]),
    );
```

New:
```typescript
    const rawCards = interleavedRows.map((row: any) =>
      transformServablePlaceToCard(
        row,
        row.__displayCategory ?? categories[0],
        location.lat,
        location.lng,
        travelMode as TravelMode,
      ),
    );
```

**Note:** `location.lat` / `location.lng` are validated non-null at line 605 (`if (!location?.lat || !location?.lng)` returns 400). So the singles-served path is guaranteed to pass real numbers. The `placeLat`/`placeLng` null-guard inside the transformer covers the hypothetical case where `query_servable_places_by_signal` returns a row with null lat/lng (defensive — the RPC should never do this, but Constitution #3 requires we don't silently fabricate).

**§4.2.4 — Telemetry:**

Inside the transformer, if `placeLat === null || placeLng === null`, increment a per-request counter and log ONCE at the end of the request:

```typescript
// Place this counter accumulation in the .map() loop:
let _placesMissingCoords = 0;
const rawCards = interleavedRows.map((row: any) => {
  const card = transformServablePlaceToCard(row, row.__displayCategory ?? categories[0], location.lat, location.lng, travelMode as TravelMode);
  if (card.distanceKm === null) _placesMissingCoords++;
  return card;
});
if (_placesMissingCoords > 0) {
  console.warn(`[discover-cards] ${_placesMissingCoords}/${rawCards.length} places had null lat/lng — distance/travelTime set to null`);
}
```

### §4.3 — `supabase/functions/generate-curated-experiences/index.ts` migrate to shared

**§4.3.1 — Add import at top of file:**

```typescript
import { haversineKm, estimateTravelMinutes } from '../_shared/distanceMath.ts';
```

**§4.3.2 — DELETE lines 1034-1052** (local `haversineKm` + `estimateTravelMinutes` definitions). Net -19 LOC. The two callers at L612-613 and L617-618 already use the same identifiers — they now resolve to the shared imports.

### §4.4 — `supabase/functions/_shared/stopAlternatives.ts` re-export from canonical owner

**§4.4.1 — Replace lines 6-24** (local definitions of `haversineKm` + `estimateTravelMinutes`) with:

```typescript
// Re-export from the canonical owner. ORCH-0659/0660 enforces I-DECK-CARD-
// CONTRACT-DISTANCE-AND-TIME: a single source of truth for distance + travel-
// time math across all edge functions.
export { haversineKm, estimateTravelMinutes } from './distanceMath.ts';
```

(`TRAVEL_SPEEDS_KMH` constant at line 26 is unused outside this file per grep — implementor: confirm with `git grep "TRAVEL_SPEEDS_KMH"` before deleting; if unused outside, delete it too. If used, leave alone — out of scope.)

---

## §5 — Service / hook / type layer (mobile)

### §5.1 — `app-mobile/src/types/recommendation.ts`

**§5.1.1 — Change line 19:**

Old: `timeAway: string;`

New: **DELETE the line entirely.** `timeAway` is a write-only field with zero consumers (verified: `grep timeAway` returns 5 hits, all writes; no reads). Removing it is pure subtraction (Constitution #8).

**§5.1.2 — Change line 26:**

Old: `distance: string;`

New: `distance: string | null;`

**§5.1.3 — Change line 27:**

Old: `travelTime: string;`

New: `travelTime: string | null;`

### §5.2 — `app-mobile/src/services/deckService.ts` `unifiedCardToRecommendation`

**§5.2.1 — Replace lines 150-152** (defensive coercion):

Old:
```typescript
  // Defensive: ensure numeric fields are never undefined (edge fn may omit them)
  const distanceKm = card.distanceKm ?? 0;
  const travelTimeMin = card.travelTimeMin ?? 0;
```

New:
```typescript
  // ORCH-0659/0660: honest null propagation. Backend now emits real distance
  // + per-mode travel time (or null if location can't be resolved). Never
  // coerce null → 0; the UI branches on null to hide the badge instead of
  // fabricating "nearby" or "0 min".
  const distanceKm: number | null = typeof card.distanceKm === 'number' ? card.distanceKm : null;
  const travelTimeMin: number | null = typeof card.travelTimeMin === 'number' ? card.travelTimeMin : null;
```

**§5.2.2 — DELETE line 167** (the `timeAway` field assignment). The field no longer exists in the type. Net -1 line in this file.

**§5.2.3 — Replace lines 174-175:**

Old:
```typescript
    distance: distanceKm > 0 ? `${distanceKm.toFixed(1)} km` : '',
    travelTime: travelTimeMin > 0 ? `${Math.round(travelTimeMin)} min` : '',
```

New:
```typescript
    distance: distanceKm !== null ? `${distanceKm.toFixed(1)} km` : null,
    travelTime: travelTimeMin !== null ? `${Math.round(travelTimeMin)} min` : null,
```

### §5.3 — `app-mobile/src/utils/cardConverters.ts` curated converter parity

**§5.3.1 — DELETE line 75** (the `timeAway` field assignment). Field no longer exists in type.

**§5.3.2 — Replace lines 82-83:**

Old:
```typescript
    distance: firstStop && (firstStop.distanceFromUserKm ?? 0) > 0 ? `${firstStop.distanceFromUserKm.toFixed(1)} km` : '',
    travelTime: firstStop && (firstStop.travelTimeFromUserMin ?? 0) > 0 ? `${Math.round(firstStop.travelTimeFromUserMin)} min` : '',
```

New:
```typescript
    distance: firstStop && typeof firstStop.distanceFromUserKm === 'number'
      ? `${firstStop.distanceFromUserKm.toFixed(1)} km`
      : null,
    travelTime: firstStop && typeof firstStop.travelTimeFromUserMin === 'number'
      ? `${Math.round(firstStop.travelTimeFromUserMin)} min`
      : null,
```

### §5.4 — `app-mobile/src/hooks/useMapCards.ts`

**§5.4.1 — DELETE line 45** (`timeAway: card.travelTime || '',`). Field no longer exists in type. Net -1 line.

### §5.5 — `app-mobile/src/hooks/usePairedMapSavedCards.ts`

**§5.5.1 — DELETE line 50** (`timeAway: typeof cardData.timeAway === 'string' ? cardData.timeAway : '',`). Net -1 line.

**Note for implementor:** `cardData.timeAway` may exist in already-saved-card JSONB rows from before this fix (pre-2026-04-25 saves). The field will silently be ignored on read post-fix. No backfill needed — saved cards rendering goes through `card.travelTime` not `card.timeAway`.

---

## §6 — Component layer (mobile)

### §6.1 — `app-mobile/src/components/SwipeableCards.tsx`

**§6.1.1 — Replace lines 2168-2188** (next-card distance + travel-time badges):

Old (next card):
```tsx
                    <View style={styles.detailsBadges}>
                      <GlassBadge iconName="location">
                        {parseAndFormatDistance(nextCard.distance, accountPreferences?.measurementSystem) || t('cards:swipeable.nearby')}
                      </GlassBadge>
                      {nextCard.travelTime && nextCard.travelTime !== '0 min' ? (
                        <GlassBadge iconName={getTravelModeIcon(nextCard.travelMode ?? effectiveTravelMode)}>
                          {nextCard.travelTime}
                        </GlassBadge>
                      ) : null}
```

New:
```tsx
                    <View style={styles.detailsBadges}>
                      {/* ORCH-0659: honest null propagation — hide the badge entirely when
                          distance is missing. No "nearby" placeholder (Constitution #9). */}
                      {nextCard.distance != null && (
                        <GlassBadge iconName="location">
                          {parseAndFormatDistance(nextCard.distance, accountPreferences?.measurementSystem)}
                        </GlassBadge>
                      )}
                      {/* ORCH-0660: render only when real value present. Mode-icon matches
                          card.travelMode (set server-side per user preference). */}
                      {nextCard.travelTime != null && (
                        <GlassBadge iconName={getTravelModeIcon(nextCard.travelMode ?? effectiveTravelMode)}>
                          {nextCard.travelTime}
                        </GlassBadge>
                      )}
```

**§6.1.2 — Replace lines 2302-2310** (current-card distance + travel-time badges):

Old (current card):
```tsx
                      <View style={styles.detailsBadges}>
                        <GlassBadge iconName="location" entryIndex={0}>
                          {parseAndFormatDistance(currentRec.distance, accountPreferences?.measurementSystem) || t('cards:swipeable.nearby')}
                        </GlassBadge>
                        {currentRec.travelTime && currentRec.travelTime !== '0 min' ? (
                          <GlassBadge iconName={getTravelModeIcon(currentRec.travelMode ?? effectiveTravelMode)} entryIndex={1}>
                            {currentRec.travelTime}
                          </GlassBadge>
                        ) : null}
```

New:
```tsx
                      <View style={styles.detailsBadges}>
                        {/* ORCH-0659: see §6.1.1. */}
                        {currentRec.distance != null && (
                          <GlassBadge iconName="location" entryIndex={0}>
                            {parseAndFormatDistance(currentRec.distance, accountPreferences?.measurementSystem)}
                          </GlassBadge>
                        )}
                        {/* ORCH-0660: see §6.1.1. */}
                        {currentRec.travelTime != null && (
                          <GlassBadge iconName={getTravelModeIcon(currentRec.travelMode ?? effectiveTravelMode)} entryIndex={1}>
                            {currentRec.travelTime}
                          </GlassBadge>
                        )}
```

**Note on `entryIndex` reordering:** the original code passed `entryIndex={0}` to the location badge and `entryIndex={1}` to the travel-time badge for staggered entry animation. With the new conditional, if `distance` is null but `travelTime` is non-null, the travel-time badge would have `entryIndex={1}` with no `entryIndex={0}` sibling — slightly unusual but harmless (the animation still fires; just one badge instead of two). Acceptable. Do not over-engineer.

### §6.2 — `app-mobile/src/components/expandedCard/CardInfoSection.tsx`

**§6.2.1 — Replace lines 138-149** (distance + travel-time pills in metrics row):

Old:
```tsx
        {distance && (
          <View style={styles.metricPill}>
            <Icon name="location-outline" size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{parseAndFormatDistance(distance, measurementSystem) || t('expanded_details:card_info.nearby')}</Text>
          </View>
        )}
        {travelTime && travelTime !== '0 min' && (
          <View style={styles.metricPill}>
            <Icon name={getTravelModeIcon(travelMode)} size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{travelTime}</Text>
          </View>
        )}
```

New:
```tsx
        {/* ORCH-0659: honest null propagation; no "nearby" fallback. */}
        {distance != null && (
          <View style={styles.metricPill}>
            <Icon name="location-outline" size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{parseAndFormatDistance(distance, measurementSystem)}</Text>
          </View>
        )}
        {/* ORCH-0660: travelMode prop now threaded; icon matches user's selected mode. */}
        {travelTime != null && (
          <View style={styles.metricPill}>
            <Icon name={getTravelModeIcon(travelMode)} size={12} color="#eb7825" />
            <Text style={styles.metricPillText}>{travelTime}</Text>
          </View>
        )}
```

**§6.2.2 — Update prop types** at lines 16-17:

Old:
```typescript
  distance?: string;
  travelTime?: string;
```

New:
```typescript
  distance?: string | null;
  travelTime?: string | null;
```

### §6.3 — `app-mobile/src/components/ExpandedCardModal.tsx`

**§6.3.1 — DELETE line 1225** (`hideTravelTime,` from destructured props). Constitution #8 — dead prop subtraction.

**§6.3.2 — Replace lines 1778-1793** (CardInfoSection invocation in regular-card path):

Old:
```tsx
                <CardInfoSection
                  title={card.title}
                  category={card.category}
                  categoryIcon={card.categoryIcon}
                  tags={card.tags}
                  rating={card.rating}
                  distance={card.distance}
                  travelTime={hideTravelTime ? undefined : card.travelTime}
                  measurementSystem={accountPreferences?.measurementSystem}
                  priceRange={card.priceRange}
                  priceTier={card.priceTier}
                  priceLevel={undefined}
                  description={card.description}
                  tip={card.tip}
                  currency={accountPreferences?.currency}
                />
```

New:
```tsx
                <CardInfoSection
                  title={card.title}
                  category={card.category}
                  categoryIcon={card.categoryIcon}
                  tags={card.tags}
                  rating={card.rating}
                  distance={card.distance}
                  travelTime={card.travelTime}
                  travelMode={card.travelMode ?? accountPreferences?.travel_mode}
                  measurementSystem={accountPreferences?.measurementSystem}
                  priceRange={card.priceRange}
                  priceTier={card.priceTier}
                  priceLevel={undefined}
                  description={card.description}
                  tip={card.tip}
                  currency={accountPreferences?.currency}
                />
```

**Net change:** `hideTravelTime` ternary deleted; `travelMode` prop added (HF-2 fix).

### §6.4 — `app-mobile/src/types/expandedCardTypes.ts`

**§6.4.1 — DELETE line 264** (`hideTravelTime?: boolean;`). Constitution #8 — dead prop subtraction.

---

## §7 — Realtime layer

**N/A.** No realtime channel touched.

---

## §8 — Telemetry / logging

| Location | Behavior |
|----------|----------|
| `discover-cards/index.ts` (after `interleavedRows.map`) | Aggregated warning: `[discover-cards] N/M places had null lat/lng — distance/travelTime set to null` (only if N>0). One line per request, not per card. |
| Mobile | No new logging. UI silently hides badges when null. |

---

## §9 — Success criteria

| ID | Criterion | Verifiable by |
|----|-----------|---------------|
| **SC-1** | Live invocation of `discover-cards` at Raleigh with `travelMode: walking` returns ≥1 card with `distanceKm > 0` AND `travelTimeMin > 0`. | MCP `execute_sql` probe of edge fn response (or curl with valid JWT). |
| **SC-2** | Same invocation with `travelMode: driving` returns the same card with `travelTimeMin` strictly less than the walking estimate (driving is faster). | Side-by-side curl comparison. |
| **SC-3** | Walking estimate for Raleigh-center (35.7796, -78.6382) → Williamson Preserve (35.7327, -78.4469) is between 280 and 320 minutes (haversine 17.7 km × 1.3 factor / 4.5 km/h × 60 ≈ 307 min). | Unit math in commit message + live curl. |
| **SC-4** | Driving estimate for the same pair is between 38 and 50 minutes (17.7 × 1.4 / 35 × 60 ≈ 43 min). | Same. |
| **SC-5** | Mobile collapsed deck card on iOS Simulator displays "X.X km" and "X min walk/drive/etc." for at least one Raleigh nature card — NOT the literal text "nearby" and NOT a missing travel-time badge. | Device smoke. |
| **SC-6** | Expanded card top section displays the travel-time pill with a mode-matching icon: walk-shoe / car / bus / bicycle — NOT the default compass (`navigate-outline`). | Device smoke + visual. |
| **SC-7** | When a hypothetical malformed `place_pool` row is returned by the RPC with null lat/lng, the resulting card has `distanceKm: null` AND `travelTimeMin: null` AND mobile renders the card with both badges hidden (no "nearby" placeholder, no compass-icon-no-time pill). | Code path inspection + mock-row test. |
| **SC-8** | Curated cards (Romantic, Picnic, Adventurous, Stroll, Group-Fun, Take-A-Stroll, First-Date) still render distance + travel-time correctly post-fix (regression check — curated path migrated to shared helpers). | Live curl + device smoke. |
| **SC-9** | `git grep "timeAway" app-mobile/` returns ZERO matches. | Grep gate. |
| **SC-10** | `git grep "hideTravelTime" app-mobile/` returns ZERO matches. | Grep gate. |
| **SC-11** | `git grep "!== '0 min'" app-mobile/` returns ZERO matches. | Grep gate. |
| **SC-12** | `scripts/ci-check-invariants.sh` extended with 3 new blocks (see §12); negative-control reproduction proves each fires (exit 1) on regression injection and recovers (exit 0) when removed. | Manual reproduction in retest. |
| **SC-13** | `INVARIANT_REGISTRY.md` contains a new section `### I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME` with rule, enforcement, and test fields populated per existing pattern. | File diff. |
| **SC-14** | Net LOC change is negative (subtract before adding — extracted helpers + dead code deletions outweigh new code). Expected: -25 to -45 lines net, +1 new file (`distanceMath.ts`). | `git diff --stat`. |
| **SC-15** | `cd app-mobile && npx tsc --noEmit` exits 0. `cd mingla-admin && npm run build` exits 0 (admin untouched but defensive). | CI. |

---

## §10 — Test cases

| ID | Scenario | Input | Expected | Layer |
|----|----------|-------|----------|-------|
| **T-LIVE-01** | Singles Raleigh walking | POST `/discover-cards` with location={35.7796,-78.6382}, travelMode='walking', categories=['Nature & Views'] | Returns ≥1 card with `distanceKm > 0`, `travelTimeMin > 0`, `travelMode: 'walking'`. | Edge fn |
| **T-LIVE-02** | Singles Raleigh driving | Same but travelMode='driving' | Same card; `travelTimeMin` strictly less than T-LIVE-01. | Edge fn |
| **T-LIVE-03** | Singles Raleigh transit | Same but travelMode='transit' | Same card; `travelTimeMin` between walking and driving. | Edge fn |
| **T-LIVE-04** | Singles Raleigh biking | Same but travelMode='biking' | Same card; `travelTimeMin` between walking and driving. | Edge fn |
| **T-LIVE-05** | Auth-required short-circuit | POST without Authorization header | Returns 400 (validation hits before transformer); transformer never called. | Edge fn |
| **T-LIVE-06** | Curated regression | POST `/generate-curated-experiences` with a Picnic-Dates Raleigh request | Returns curated cards with first-stop `distanceFromUserKm > 0`, `travelTimeFromUserMin > 0` — unchanged behavior post-shared-helper migration. | Edge fn |
| **T-DEVICE-01** | Mobile collapsed deck nature | Open app in Raleigh, swipe to nature category | Front card shows distance pill (e.g., "0.8 km"), travel-time pill (e.g., "12 min walk"), NOT "nearby". | Component |
| **T-DEVICE-02** | Mobile collapsed deck driving | Set travel mode to driving in PreferencesSheet, refetch deck | Same card now shows car icon + driving-time estimate. | Component + service |
| **T-DEVICE-03** | Mobile expanded card | Tap a category card | Top section shows distance pill + travel-time pill with mode-matching icon. | Component |
| **T-DEVICE-04** | Mobile expanded curated card | Tap a Romantic curated card | Top section shows correct distance + travel-time + matching icon (regression check). | Component |
| **T-NULL-01** | Defensive null propagation | Inject a place_pool row with null lat into discover-cards mock | Card emitted with `distanceKm: null, travelTimeMin: null`; warning logged. | Edge fn unit |
| **T-NULL-02** | Mobile null branch | Pass `card.distance: null, card.travelTime: null` to SwipeableCards | Both badges hidden; no "nearby" text rendered; no `0 min` pill. | Component |
| **T-PARITY-01** | Collab session | Start a collab session, swipe through deck | Same distance + travel-time behavior as solo (deckService is shared). | Full stack |
| **T-CI-01** | Negative control: edge fn regression | Inject `distanceKm: 0,` literal into discover-cards transformer | `scripts/ci-check-invariants.sh` exits 1 with clear message. Remove → exits 0. | CI |
| **T-CI-02** | Negative control: mobile fallback regression | Inject `\|\| t('cards:swipeable.nearby')` in SwipeableCards.tsx | CI script exits 1. Remove → exits 0. | CI |
| **T-CI-03** | Negative control: timeAway resurrection | Inject `timeAway: 'something',` in any deckService write site | CI script exits 1 (new grep for `timeAway` outside test fixtures). Remove → exits 0. | CI |
| **T-TYPE-01** | Type safety | `npx tsc --noEmit` on mobile | Exit 0. New `string \| null` types propagate cleanly to all consumers. | Type system |

---

## §11 — Implementation order (numbered, exact)

Execute in this order. Each step lists exact files. Do not interleave.

1. **Create `supabase/functions/_shared/distanceMath.ts`** with the contents from §4.1 (verbatim).
2. **Edit `supabase/functions/_shared/stopAlternatives.ts`** — replace lines 6-24 with the re-export per §4.4.1.
3. **Edit `supabase/functions/generate-curated-experiences/index.ts`** — add import per §4.3.1, delete lines 1034-1052 per §4.3.2.
4. **Edit `supabase/functions/discover-cards/index.ts`** — add import per §4.2.1, rewrite transformer per §4.2.2, update call site per §4.2.3, add telemetry per §4.2.4.
5. **User action: deploy edge functions:** `cd supabase && supabase functions deploy discover-cards generate-curated-experiences`. Verify both deploy successfully (no import resolution errors).
6. **Edit `app-mobile/src/types/recommendation.ts`** — delete line 19 (`timeAway`), change lines 26-27 to `string | null` per §5.1.
7. **Edit `app-mobile/src/types/expandedCardTypes.ts`** — delete line 264 (`hideTravelTime`) per §6.4.1.
8. **Edit `app-mobile/src/services/deckService.ts`** — apply §5.2.1 + §5.2.2 + §5.2.3.
9. **Edit `app-mobile/src/utils/cardConverters.ts`** — apply §5.3.1 + §5.3.2.
10. **Edit `app-mobile/src/hooks/useMapCards.ts`** — apply §5.4.1.
11. **Edit `app-mobile/src/hooks/usePairedMapSavedCards.ts`** — apply §5.5.1.
12. **Edit `app-mobile/src/components/SwipeableCards.tsx`** — apply §6.1.1 + §6.1.2.
13. **Edit `app-mobile/src/components/expandedCard/CardInfoSection.tsx`** — apply §6.2.1 + §6.2.2.
14. **Edit `app-mobile/src/components/ExpandedCardModal.tsx`** — apply §6.3.1 + §6.3.2.
15. **Edit `scripts/ci-check-invariants.sh`** — append the 3 new blocks per §12.
16. **Edit `Mingla_Artifacts/INVARIANT_REGISTRY.md`** — register `I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME` per §12.
17. **Run gates:** `cd app-mobile && npx tsc --noEmit` (must exit 0); `cd mingla-admin && npm run build` (must exit 0); `./scripts/ci-check-invariants.sh` (must exit 0).
18. **Run negative-control:** in a temp branch, inject `distanceKm: 0,` into discover-cards → ci-check-invariants.sh exits 1 → revert. Same for the other two new gates. Document results in implementation report §G.
19. **User action: commit + EAS Update.** Commit message per §14. Then `cd app-mobile && eas update --branch production --platform ios --message "ORCH-0659/0660 honest distance + per-mode travel time"`. Then same with `--platform android`.

---

## §12 — Regression prevention

### §12.1 — CI gate extension (`scripts/ci-check-invariants.sh`)

Append after the existing N/A block (after line 111, before the final `if [ $FAIL -eq 1 ]` block):

```bash
# ─── ORCH-0659/0660: I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME ────────────────
# Forbid hardcoded distanceKm: 0 / travelTimeMin: 0 sentinels in any
# deck-serving edge function transformer. The transformer must compute
# haversine + per-mode estimate, or set both to null. Never 0.
echo "Checking I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (edge fn)..."
DECK_ZERO_HITS=$(grep -rEn 'distanceKm:\s*0,|travelTimeMin:\s*0,' \
    supabase/functions/discover-cards/ \
    supabase/functions/generate-curated-experiences/ \
    supabase/functions/get-person-hero-cards/ \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$DECK_ZERO_HITS" ]; then
  echo "FAIL: I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME violated. ORCH-0659/0660"
  echo "   forbids 'distanceKm: 0,' or 'travelTimeMin: 0,' literals in edge"
  echo "   fn card transformers. Compute haversine + estimate, or set null."
  echo "   Hit lines:"
  echo "$DECK_ZERO_HITS"
  FAIL=1
fi

# ─── ORCH-0659: forbid '|| t(...nearby)' fallback in render code ───────────
# Constitution #9 — never fabricate display values. Hide the badge when
# distance is null instead of showing a "nearby" placeholder.
echo "Checking I-NO-NEARBY-FALLBACK..."
NEARBY_HITS=$(grep -rEn "\|\|\s*t\(['\"]cards:swipeable\.nearby['\"]\)|\|\|\s*t\(['\"]expanded_details:card_info\.nearby['\"]\)" \
    app-mobile/src/components/SwipeableCards.tsx \
    app-mobile/src/components/expandedCard/CardInfoSection.tsx \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$NEARBY_HITS" ]; then
  echo "FAIL: I-NO-NEARBY-FALLBACK violated. ORCH-0659 forbids"
  echo "   '|| t(...nearby)' fallback in render path — hide the badge"
  echo "   on null instead. Hit lines:"
  echo "$NEARBY_HITS"
  FAIL=1
fi

# ─── ORCH-0659/0660: forbid timeAway field resurrection ────────────────────
# Constitution #2 — single owner per truth. timeAway was deleted; travelTime
# is the single source. Reintroduction would re-create the dual-shape bug.
echo "Checking timeAway field resurrection..."
TIMEAWAY_HITS=$(git grep -nE "timeAway\s*[:=]" \
    app-mobile/src/ \
    2>/dev/null \
  | grep -v '__test_gate' \
  || true)
if [ -n "$TIMEAWAY_HITS" ]; then
  echo "FAIL: timeAway field reintroduced. ORCH-0659/0660 deleted it because"
  echo "   it duplicated travelTime with a '0 min' sentinel. Use travelTime"
  echo "   only. Hit lines:"
  echo "$TIMEAWAY_HITS"
  FAIL=1
fi
```

Also update the final summary lines (113-119) to reference 0659/0660:

```bash
if [ $FAIL -eq 1 ]; then
  echo ""
  echo "ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 invariant check FAILED."
  exit 1
fi

echo "All ORCH-0640 / ORCH-0649 / ORCH-0659 / ORCH-0660 invariant gates pass."
exit 0
```

### §12.2 — INVARIANT_REGISTRY entry

Append to `Mingla_Artifacts/INVARIANT_REGISTRY.md` (after the last existing entry):

```markdown
---

### I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME

**Rule:** Every card emitted by any deck-serving edge function (`discover-cards`,
`generate-curated-experiences`, `get-person-hero-cards`) MUST carry a
haversine-computed `distanceKm` (number, kilometers) AND a per-mode estimated
`travelTimeMin` (number, minutes) computed from the user's selected travel mode.

If either the user's location OR the place's lat/lng is missing/malformed, the
edge function MUST emit `distanceKm: null` AND `travelTimeMin: null` (both,
together — never one without the other). Mobile UI MUST branch on `null` and
hide the corresponding badge.

NEVER emit `distanceKm: 0` or `travelTimeMin: 0` as sentinels for "missing".
NEVER emit empty-string sentinels in service-layer converters. NEVER use
`|| t(...nearby)` or `|| "0 min"` as render-layer fallbacks.

**Enforcement:**
- Single source of truth for math: `supabase/functions/_shared/distanceMath.ts`
  exports `haversineKm` + `estimateTravelMinutes` + `TravelMode` type. Other
  edge functions import; `_shared/stopAlternatives.ts` re-exports.
- CI gate `scripts/ci-check-invariants.sh` blocks 3 patterns: (a) literal
  `distanceKm: 0,` / `travelTimeMin: 0,` in edge fn transformers, (b)
  `|| t(...nearby)` fallback in `SwipeableCards.tsx` / `CardInfoSection.tsx`,
  (c) any `timeAway` field reintroduction in `app-mobile/src/`.
- Type system: `Recommendation.distance` and `Recommendation.travelTime` are
  `string | null`. `CardInfoSectionProps.distance` and `.travelTime` are
  `string | null`. TypeScript flags any `0`-string conversion.

**Test:** Live invocation of `discover-cards` at any launch city with each of
the 4 supported travel modes (walking/driving/transit/biking) returns cards
with `distanceKm > 0` AND `travelTimeMin > 0` for places with valid lat/lng.
Inverse test: mock a place_pool row with null lat → card has `distanceKm: null`
AND `travelTimeMin: null` AND mobile renders without "nearby" or compass-icon
fallback.

**Established:** ORCH-0659 + ORCH-0660 (2026-04-25). Investigation:
`reports/INVESTIGATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`. Spec:
`specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md`.
```

### §12.3 — Protective comments in code

Add the comment block to `discover-cards/index.ts` immediately above the
`transformServablePlaceToCard` function (between lines 525-530):

```typescript
// ─── ORCH-0659 + ORCH-0660 ──────────────────────────────────────────────────
// [CRITICAL] This transformer enforces I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME.
// Pre-fix (2026-04-22 → 2026-04-25), this function hardcoded distanceKm=0 and
// travelTimeMin=0, causing every category card to display "nearby" placeholder
// + missing travel-time pill on mobile. The fix: compute haversine distance
// against the user's resolved location + per-mode estimate via shared helpers.
// If you need to "skip" distance/time computation, set both fields to null —
// NEVER 0. The mobile UI hides the badges on null but fabricates "nearby" and
// "0 min" on 0. See:
//   - reports/INVESTIGATION_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md
//   - specs/SPEC_ORCH-0659_0660_DECK_DISTANCE_TRAVELTIME.md
//   - INVARIANT_REGISTRY.md → I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME
// ────────────────────────────────────────────────────────────────────────────
```

---

## §13 — Rollback plan

| Failure mode | Rollback |
|--------------|----------|
| Edge fn deploy fails (import error, runtime error) | `supabase functions deploy --version <previous>` for both `discover-cards` and `generate-curated-experiences`. Pre-fix versions still on prod. |
| Mobile build fails or device smoke fails | Revert the commit. Re-run `eas update --branch production --platform ios` (and android) with the previous-good commit. Saved cards continue rendering as before. |
| Live-fire shows distances are wrong (math bug) | Same as mobile rollback. Math is a leaf module — easy to bisect. |
| Negative-control CI gate doesn't fire | Block commit; refine grep. No prod risk. |

No DB migration → no DB rollback. No data corruption risk (no writes).

---

## §14 — Commit message (ready-to-use)

```
fix(deck): ORCH-0659+0660 honest distance + per-mode travel time

Backend transformer in discover-cards hardcoded distanceKm=0 / travelTimeMin=0
for every category card since 2026-04-22 (ORCH-0588 cohort path → ORCH-0634
promoted to all chips). Mobile collapsed 0 → empty string → "nearby" placeholder
on the swipeable deck, and the entire travel-time pill was suppressed in the
expanded view. Curated path was unaffected (already had haversine in place).

This commit:
- Extracts haversineKm + estimateTravelMinutes + TravelMode to a new shared
  leaf module supabase/functions/_shared/distanceMath.ts (single owner —
  Constitution #2). _shared/stopAlternatives.ts re-exports from it.
- Rewrites discover-cards transformServablePlaceToCard to accept userLat,
  userLng, travelMode; computes honest haversine + per-mode estimate per card.
  Defensive null propagation when place lat/lng is missing.
- Migrates generate-curated-experiences to import from shared; deletes 19
  lines of duplicate helpers.
- Tightens mobile contract: Recommendation.distance and .travelTime are now
  `string | null`; deckService + cardConverters propagate honest null instead
  of empty-string sentinels.
- Deletes dead `timeAway` field from Recommendation type + 4 write sites
  (zero readers — Constitution #8 subtraction).
- Deletes dead `hideTravelTime` prop from ExpandedCardModalProps + threading
  (zero callers — Constitution #8).
- Threads `travelMode` prop ExpandedCardModal → CardInfoSection so the icon
  matches walk/drive/transit/bike instead of defaulting to compass.
- Drops 4 layered "0 min" / `|| nearby` truthy guards from SwipeableCards
  + CardInfoSection.
- Extends scripts/ci-check-invariants.sh with 3 new gates (edge fn zeros,
  mobile nearby fallback, timeAway resurrection). Negative-control verified.
- Registers new invariant I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME in
  INVARIANT_REGISTRY.md.

Closes: ORCH-0659, ORCH-0660
Files: 1 new (distanceMath.ts), 12 edited
LOC: net -X (subtract before adding)

Deploy notes:
1. supabase functions deploy discover-cards generate-curated-experiences
2. eas update --branch production --platform ios --message "ORCH-0659/0660"
3. eas update --branch production --platform android --message "ORCH-0659/0660"
   (separate invocations per memory rule — never combined platform flag).

QA verdict: pending tester PASS.
```

(The implementor fills in `-X` LOC delta from `git diff --stat`.)

---

## §15 — Memory feedback compliance

| Rule | Compliance |
|------|------------|
| Detail in files, summary in chat | ✅ Spec is detailed; chat summary in §1 + final reply will be ≤20 lines. |
| No Co-Authored-By in commit messages | ✅ Commit message in §14 has no AI attribution. |
| Layman first | ✅ §1 leads with plain-English impact. |
| Diagnose-first | ✅ Investigation already complete and approved. |
| Always offer commit message | ✅ §14 ready-to-paste. |
| VS Code-renderable markdown | ✅ Standard CommonMark, no exotic extensions. |
| Two-step EAS update (ios then android) | ✅ §11 step 19 + §14 commit body. |
| Severity reflects reality (not softened) | ✅ S0 escalation explicit. |

---

## §16 — Hidden flaw remediation crosswalk

| Investigation finding | Spec section | Status |
|-----------------------|--------------|--------|
| 🔴 RC-1 (singles transformer hardcoded zeros) | §4.1, §4.2 | RESOLVED |
| 🟠 CF-1 (mobile sentinel-string conversion) | §5.1, §5.2 | RESOLVED |
| 🟠 CF-2 (triple-redundant truthy guards) | §6.1, §6.2 | RESOLVED |
| 🟡 HF-1 (`hideTravelTime` dead prop) | §6.3.1, §6.4.1 | RESOLVED (deleted) |
| 🟡 HF-2 (`travelMode` prop never threaded) | §6.3.2 | RESOLVED |
| 🟡 HF-3 (`timeAway` "0 min" sentinel) | §5.1.1, §5.2.2, §5.3.1, §5.4.1, §5.5.1 | RESOLVED (deleted everywhere) |
| 🔵 OBS-1 (curated path correct) | §4.3 | LEVERAGED (migration to shared helpers) |
| 🔵 OBS-2 (saved-card persistence) | §5.5 note | ACCEPTED (no backfill — distance is user-relative) |
| 🔵 OBS-3 (travel-mode mid-view reactivity) | OUT OF SCOPE | DEFERRED → ORCH-0662 |

Every investigation finding is either resolved by this spec or explicitly deferred with an ORCH-ID.

---

## §17 — Discoveries already filed (no new ones)

This SPEC pass surfaces no new discoveries beyond what the investigation already filed (D-1, D-2 → ORCH-0662, D-3, 0660.D-1, 0660.D-2). All are addressed above or deferred.

---

## §18 — Acceptance checklist for orchestrator REVIEW

Orchestrator reviewing this spec must confirm:

- [ ] Every investigation finding is in §16 with status RESOLVED, LEVERAGED, ACCEPTED, or DEFERRED.
- [ ] §3 confirms no DB migration (matches investigation §11 fix-direction §0).
- [ ] §4.1 file contents are byte-exact (no missing imports, no missing types).
- [ ] §4.2.2 transformer rewrite preserves all other fields (id, placeId, title, ..., signal_score) — verify by diffing.
- [ ] §11 implementation order is database-first / edge-fn / mobile / CI / docs — followed.
- [ ] §14 commit message has no Co-Authored-By line.
- [ ] §11 step 19 has TWO separate `eas update` invocations (per memory rule).
- [ ] CI gate negative-control is required in §11 step 18 and §12.1.
- [ ] No new ORCH-IDs filed beyond 0662 (already registered).
- [ ] Spec is implementable verbatim — implementor reads §4-§6 and writes code.

If any checkbox fails, REJECT the spec and request narrow rework. Do NOT dispatch to implementor with a spec that has gaps.

---

**SPEC complete. READY FOR ORCHESTRATOR REVIEW.**
