# SPEC — ORCH-0903

**Title:** "How far" filter and displayed travel-time disagree — unify SPEED tables, add 1.5× generosity radius helper, add post-radius display-aware filter, bump 50 km → 100 km clamp

**Author:** Claude `mingla-forensics` (SPEC mode), 2026-05-21
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** [`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`](../reports/INVESTIGATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md) (`root cause proven`, Prime Directive 7 backend exemption)
**Dispatch:** `Mingla_Artifacts/prompts/SPEC_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`
**Status:** binding contract for implementor + tester; design operator-locked 2026-05-21

This SPEC does NOT re-decide the design. Driving=60 km/h × 1.3 factor, 1.5× radius generosity for singles, 1.0× for curated, post-radius filter, 50 km → 100 km clamp bump — all locked. SPEC's job is to enumerate the exact contract.

---

## §0 — Cross-Surface Impact Declaration

| Surface | In scope | User-visible behavior demanded | Files touched on surface | Parity |
|---|---|---|---|---|
| **Consumer iOS** (`app-mobile/` on iOS) | YES | Deck no longer shows cards whose displayed `travelTimeMin` exceeds the user's "how far" cap. Walking/biking/transit 1.69× overshoot also disappears. | NONE on this surface — pure server-side fix. Mobile reads `card.travelTimeMin` from server payload verbatim ([`deckService.ts:166-188`](../../app-mobile/src/services/deckService.ts#L166-L188)). | Automatic (server payload identical to Android) |
| **Consumer Android** (`app-mobile/` on Android) | YES | Same as iOS. | NONE on this surface. | Automatic (shared RN code) |
| **Backend** (`supabase/functions/`) | YES — root cause location | Three files edited; one SPEED source of truth established; one new helper exported. | `_shared/distanceMath.ts`, `discover-cards/index.ts`, `generate-curated-experiences/index.ts` | N/A (one canonical source for both consumer + curated callers) |
| **Buyer/anonymous Web** (`mingla-business/` anon routes) | NO | — | — | No preferences sheet on anon checkout; buyers land on a known event/brand link, no deck served. |
| **Business iOS** (`mingla-business/` on iOS) | NO | — | — | No consumer preferences sheet in business app. |
| **Business Android** (`mingla-business/` on Android) | NO | — | — | Same. |
| **Business Web preview** (`mingla-business/` dev/web) | NO | — | — | Same. |
| **Admin Web** (`mingla-admin/`) | NO | — | — | No consumer-side admin tooling for "how far". |

**Parity model:** automatic across iOS + Android (one edge function serves both with identical payload). Tester MUST still run iOS Simulator + Android Emulator live-fire at TEST phase per parity-enforcement rule (Prime Directive 7 backend/edge-function exemption applied at INVESTIGATE does NOT carry through to TEST — TEST verifies UI rendering on each platform).

---

## §1 — Scope and non-goals

### In scope (exact change set)

1. Replace `_shared/distanceMath.ts` internal `config` object with exported module-level `TRAVEL_CONFIG`, change `driving` entry from `{ speed: 35, factor: 1.4 }` to `{ speed: 60, factor: 1.3 }`. Walking, biking, bicycling, transit entries unchanged.
2. Add `export function radiusKmForConstraint(constraintMin, mode, generosity = 1.0)` to `_shared/distanceMath.ts`.
3. Delete local `SPEED_KMH` const in `discover-cards/index.ts:131-138`.
4. Delete local `TRAVEL_SPEEDS_KMH` + bespoke radius math in `generate-curated-experiences/index.ts:585-590`.
5. `discover-cards/index.ts` imports and uses `radiusKmForConstraint(travelConstraintValue, travelMode, 1.5)`.
6. `generate-curated-experiences/index.ts` imports and uses `radiusKmForConstraint(travelConstraintValue, travelMode, 1.0)`.
7. Add post-radius filter step in `discover-cards/index.ts` between current lines 984 and 989: drop cards where `card.travelTimeMin !== null && card.travelTimeMin > travelConstraintValue`. Pass-through for `card.travelTimeMin === null` (null-coord cards per I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME).
8. Bump radius clamp ceiling in `discover-cards/index.ts:730` from `50000` to `100000`. Floor (500 m) unchanged.
9. Add `droppedByTravelTimeFilter: number` field to `sourceBreakdown` in the populated-path response only.
10. Add one `console.log` line documenting filter drop count when > 0.
11. Add protective inline comment above `TRAVEL_CONFIG` in `_shared/distanceMath.ts` per §7.
12. Write implementor happy-path regression test at `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` (NEW file; NEW directory).

### Non-goals (explicitly out of scope)

- **No external API.** No Google Distance Matrix, HERE, Mapbox, OSRM, OpenRouteService, TomTom. Operator-locked 2026-05-21 ($0 ongoing).
- **No in-house "smart engine."** No time-of-day / weather / city / density modifiers. Future ORCH-0905 [Mingla in-house travel-time engine] if pursued.
- **No UI changes.** No copy change, no constraint slider range change, no new UI affordance, no toast/badge changes. Mobile code untouched.
- **No `app-mobile/src/utils/travelTime.ts` change.** Discovery D-2 from investigation — out of scope; register follow-up ORCH if needed.
- **No `public_transit` cleanup.** Discovery D-1 from investigation — latent flaw out of scope. Note: deletion of `discover-cards`'s local `SPEED_KMH` removes the `public_transit: 20` entry; any future caller emitting `public_transit` mode now falls back to walking via the unified `TRAVEL_CONFIG`'s nullish-coalescing default. Acceptable behavior.
- **No ORCH-0904 [Solo-mode deck uses stale GPS] work.** Paused pending this CLOSE per sequential rule.
- **No schema change, no migration.** RPC unchanged.
- **No DB push.** `supabase db push --linked` not required.
- **No edge function deploy by implementor.** Orchestrator deploys post-tester-PASS per the standing ownership split.
- **No pre-existing test modification.** Both regression test files are NEW. No `[TEST-MOD-APPROVED ORCH-0903]` token expected. If during implementation a pre-existing test in `_shared/__tests__/` proves to conflict with the new `TRAVEL_CONFIG` driving entry, that's a SPEC gap — surface to operator before modifying.

### Assumptions (locked, not re-verified during implementation)

- `place_pool.lat/lng` are honest WGS84 coordinates (confirmed by investigation §3).
- `transformServablePlaceToCard` at `discover-cards/index.ts:548-601` correctly attaches per-card `travelTimeMin` via `estimateTravelMinutes` from `_shared/distanceMath.ts`. Post-fix: `estimateTravelMinutes` reads the new unified `TRAVEL_CONFIG` so driving display becomes 60×1.3 (not 35×1.4) automatically.
- Pre-OTA mobile clients tolerate fewer cards in a response (no UI assumption on minimum deck size — confirmed by investigation §10).
- The 500 m radius floor at line 730 is preserved (it protects against pathological zero-radius queries in DB). Only the ceiling bumps 50000 → 100000.

---

## §2 — Exact code changes (file-by-file)

### File 1 of 3: `supabase/functions/_shared/distanceMath.ts`

**Current state (full file, 46 lines — reproduced for verbatim diff):**

```ts
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

**Required state (full file post-fix — exact replacement):**

```ts
// ORCH-0659 + ORCH-0660: Single owner for distance + travel-time math.
// Replaces duplicate copies in generate-curated-experiences/index.ts and
// _shared/stopAlternatives.ts. Pure leaf module — zero side-effect imports.
//
// I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME: every card emitted by any
// deck-serving edge function MUST carry haversine-computed distanceKm AND
// per-mode travelTimeMin (or explicit null when lat/lng or user-location
// is missing). Never use 0 as a sentinel for "missing".
//
// ORCH-0903 (2026-05-21): TRAVEL_CONFIG is the SINGLE source of truth for
// travel-time speeds across ALL deck-serving edge functions. Both the
// candidate radius (via `radiusKmForConstraint`) and the displayed
// travel-time (via `estimateTravelMinutes`) read from this same constant.
// Do NOT introduce local SPEED tables in caller files — the unified table
// is enforced by `__tests__/orch_0903_travel_time_contract.test.ts`
// (grep regression checks T-07/T-08). Driving value bumped from 35×1.4 to
// 60×1.3 (effective ~46 km/h door-to-door — compromise between
// pessimistic 35-effective-25 and optimistic 100-effective-77). Walking,
// biking, transit, bicycling unchanged.

export type TravelMode = 'walking' | 'driving' | 'transit' | 'biking' | 'bicycling';

export const TRAVEL_CONFIG: Record<string, { speed: number; factor: number }> = {
  walking:   { speed: 4.5, factor: 1.3 },
  driving:   { speed: 60,  factor: 1.3 },  // ORCH-0903: was 35 × 1.4
  transit:   { speed: 20,  factor: 1.3 },
  biking:    { speed: 14,  factor: 1.3 },
  bicycling: { speed: 14,  factor: 1.3 },
};

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
 * Sample (Raleigh-center → Williamson Preserve, 17.7 km, post-ORCH-0903):
 *   walking  → ~307 min  (4.5 km/h × 1.3 factor)
 *   driving  →  ~23 min  (60 km/h × 1.3 factor — was ~43 pre-ORCH-0903)
 *   transit  →  ~69 min  (20 km/h × 1.3 factor)
 *   biking   →  ~99 min  (14 km/h × 1.3 factor)
 */
export function estimateTravelMinutes(distKm: number, travelMode: string): number {
  const { speed, factor } = TRAVEL_CONFIG[travelMode] ?? TRAVEL_CONFIG.walking;
  return Math.max(3, Math.round((distKm * factor / speed) * 60));
}

/**
 * ORCH-0903: candidate-radius helper. Returns km radius for a travel-time
 * constraint, applying the SAME speed and factor used by `estimateTravelMinutes`
 * so the filter and the display cannot drift. Caller passes generosity:
 *   - Singles deck (`discover-cards`): generosity = 1.5
 *     (50% wider candidate pool for round-robin diversity; post-filter trims
 *     to honest user cap).
 *   - Curated multi-stop (`generate-curated-experiences`): generosity = 1.0
 *     (tight, honest — multi-stop trips traverse end-to-end, radius IS the
 *     user contract for the whole itinerary).
 * Unknown modes fall back to walking via TRAVEL_CONFIG's nullish coalesce.
 */
export function radiusKmForConstraint(
  constraintMin: number,
  travelMode: string,
  generosity: number = 1.0,
): number {
  const { speed, factor } = TRAVEL_CONFIG[travelMode] ?? TRAVEL_CONFIG.walking;
  return (constraintMin / 60) * speed * factor * generosity;
}
```

**Verbatim diff summary:**
- Add `TRAVEL_CONFIG` exported constant (with ORCH-0903 protective comment block above it).
- Change driving entry value: `{ speed: 35, factor: 1.4 }` → `{ speed: 60, factor: 1.3 }`.
- Update the JSDoc sample comment in `estimateTravelMinutes` to reflect new driving value (~43 → ~23 min for 17.7 km).
- `estimateTravelMinutes` body changes from inline `config` to `TRAVEL_CONFIG`.
- Add new exported `radiusKmForConstraint` function at end.

No other changes to this file. `TravelMode` type unchanged. `haversineKm` unchanged.

### File 2 of 3: `supabase/functions/discover-cards/index.ts`

**Change 2A — Delete local SPEED_KMH const at lines 131-138.**

Current code (lines 130-138 verbatim):
```ts
// ── Helpers ─────────────────────────────────────────────────────────────────
const SPEED_KMH: Record<string, number> = {
  walking: 4.5,
  driving: 100,
  transit: 20,
  public_transit: 20,
  bicycling: 14,
  biking: 14,
};
```

Required state (replacement of lines 130-138):
```ts
// ── Helpers ─────────────────────────────────────────────────────────────────
// ORCH-0903 (2026-05-21): local SPEED_KMH deleted; radius math now uses
// the unified TRAVEL_CONFIG via radiusKmForConstraint() from
// _shared/distanceMath.ts. See ORCH-0903 close banner in WORLD_MAP.md.
```

**Change 2B — Import `radiusKmForConstraint` and `TravelMode` from `_shared/distanceMath.ts`.**

Current code (line 18 verbatim):
```ts
import { haversineKm, estimateTravelMinutes, type TravelMode } from '../_shared/distanceMath.ts';
```

Required state:
```ts
import { haversineKm, estimateTravelMinutes, radiusKmForConstraint, type TravelMode } from '../_shared/distanceMath.ts';
```

**Change 2C — Replace radius math at lines 728-730.**

Current code (lines 728-730 verbatim):
```ts
    // ── Calculate search radius from travel constraint ────────────────────
    const maxDistKm = (travelConstraintValue / 60) * (SPEED_KMH[travelMode] || 4.5) * 1.3;
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);
```

Required state:
```ts
    // ── Calculate search radius from travel constraint ────────────────────
    // ORCH-0903 (2026-05-21): radius computed from the unified TRAVEL_CONFIG
    // via radiusKmForConstraint(). Singles passes generosity=1.5 (50% wider
    // candidate pool than honest user cap — post-filter at line ~985 trims
    // back to user's stated constraint). Clamp ceiling bumped 50→100 km so
    // 45-60 min driving constraints can serve genuinely-long-range cards
    // when they exist; post-filter still enforces honest cap. Curated uses
    // generosity=1.0 (see generate-curated-experiences/index.ts).
    const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.5);
    const radiusMeters = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 100000);
```

**Change 2D — Insert post-radius filter step between current lines 984 and 989.**

Current code (lines 984-995 verbatim):
```ts
    });
    if (_placesMissingCoords > 0) {
      console.warn(`[discover-cards] ${_placesMissingCoords}/${rawCards.length} places had null lat/lng — distance/travelTime set to null`);
    }

    // Step 10: date/time + curated-hours filter (preserved from legacy path).
    const timeFilteredCards = dateWindows && dateWindows.length > 0
      ? filterByDateWindows(rawCards, dateWindows, datetimePref, selectedDates)
      : filterByDateTime(rawCards, datetimePref, dateOption, selectedDates);
    const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
    const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedUtcNow);
```

Required state (insert new step between the `_placesMissingCoords` warn block and "Step 10:"):
```ts
    });
    if (_placesMissingCoords > 0) {
      console.warn(`[discover-cards] ${_placesMissingCoords}/${rawCards.length} places had null lat/lng — distance/travelTime set to null`);
    }

    // ORCH-0903 (2026-05-21): post-radius display-aware filter. The
    // user's travelConstraintValue is the binding ceiling on displayed
    // travel-time. The candidate radius above is intentionally wider
    // (generosity=1.5×) than the honest user cap so round-robin
    // interleave has depth — this filter trims any candidate whose
    // computed display value exceeds the cap. Null-coord cards (travelTimeMin
    // === null) PASS because I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME hides
    // the badge on mobile and the user has no displayed value to compare
    // against. Filter and display cannot disagree because both read from
    // TRAVEL_CONFIG in _shared/distanceMath.ts.
    const constraintFilteredCards = rawCards.filter(
      (card: any) =>
        card.travelTimeMin === null || card.travelTimeMin <= travelConstraintValue,
    );
    const _droppedByTravelTimeFilter = rawCards.length - constraintFilteredCards.length;
    if (_droppedByTravelTimeFilter > 0) {
      console.log(`[discover-cards] travel-time post-filter dropped ${_droppedByTravelTimeFilter}/${rawCards.length} cards exceeding ${travelConstraintValue}-min ${travelMode} cap`);
    }

    // Step 10: date/time + curated-hours filter (preserved from legacy path).
    const timeFilteredCards = dateWindows && dateWindows.length > 0
      ? filterByDateWindows(constraintFilteredCards, dateWindows, datetimePref, selectedDates)
      : filterByDateTime(constraintFilteredCards, datetimePref, dateOption, selectedDates);
    const curatedUtcNow = datetimePref ? new Date(datetimePref) : new Date();
    const hoursFilteredCards = filterCuratedByStopHours(timeFilteredCards, curatedUtcNow);
```

Note: the `filterByDateWindows` and `filterByDateTime` calls now read from `constraintFilteredCards` instead of `rawCards`. This is a 2-line update (both lines 991-992 in the post-fix file).

**Change 2E — Add `droppedByTravelTimeFilter` field to populated-path response.**

Current code (lines 1024-1037 verbatim — the `sourceBreakdown` block of the populated response):
```ts
      sourceBreakdown: {
        fromPool: finalCards.length,
        fromApi: 0,
        totalServed: finalCards.length,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: [],
        reason: `Signal-served v2 multi-chip: ${categories.length} chips, ${rpcTasks.length} RPCs (${failedTasks.length} failed)`,
        path: 'pipeline',
        signalIds: uniqueSignalIds,
        cohort: 'NEW',
        filterMins,
      },
```

Required state (add `droppedByTravelTimeFilter` field):
```ts
      sourceBreakdown: {
        fromPool: finalCards.length,
        fromApi: 0,
        totalServed: finalCards.length,
        apiCallsMade: 0,
        cacheHits: 0,
        gapCategories: [],
        reason: `Signal-served v2 multi-chip: ${categories.length} chips, ${rpcTasks.length} RPCs (${failedTasks.length} failed)`,
        path: 'pipeline',
        signalIds: uniqueSignalIds,
        cohort: 'NEW',
        filterMins,
        droppedByTravelTimeFilter: _droppedByTravelTimeFilter,  // ORCH-0903 telemetry
      },
```

No changes to the `buildEmptyResponse` helper or the four non-populated paths (`pool-empty`, `auth-required`, `pipeline-error`, `source:'disabled'`) — those return zero cards, no drop count to report. The field is optional in the response shape; mobile clients that don't read it are unaffected.

### File 3 of 3: `supabase/functions/generate-curated-experiences/index.ts`

**Change 3A — Delete local TRAVEL_SPEEDS_KMH + bespoke radius math at lines 585-590.**

Current code (lines 585-590 verbatim — inside an outer function whose signature appears at line 580):
```ts
  const TRAVEL_SPEEDS_KMH: Record<string, number> = {
    walking: 4.5, biking: 14, transit: 20, driving: 35,
  };
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = Math.round((speedKmh * 1000 / 60) * travelConstraintValue);
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);
```

Required state:
```ts
  // ORCH-0903 (2026-05-21): curated path uses unified TRAVEL_CONFIG via
  // radiusKmForConstraint(generosity=1.0). Curated multi-stop trips need
  // tight, honest radius because the user traverses every stop — wider
  // generosity would yield trips with ridiculous total durations.
  const maxDistKm = radiusKmForConstraint(travelConstraintValue, travelMode, 1.0);
  const clampedRadius = Math.min(Math.max(Math.round(maxDistKm * 1000), 500), 50000);
```

**Change 3B — Add import for `radiusKmForConstraint`.**

The current file imports from `_shared/distanceMath.ts` at line 1249 inside a different function (`TRAVEL_SPEEDS_KMH` appears twice — confirm both occurrences). The 1249 occurrence is a SECOND local copy of the same speed table inside a different helper function within `generate-curated-experiences/index.ts`. SPEC requires:

- **Add a module-top import** (if not already present): `import { radiusKmForConstraint } from '../_shared/distanceMath.ts';`. If the file already imports from `_shared/distanceMath.ts`, extend that import line. (Implementor: verify by reading lines 1-30 of the file at implementation time; the investigation manifest established this file uses local copies, so a top-level import may not yet exist.)
- **Replace BOTH occurrences** (lines 585-590 AND lines 1249-onwards local SPEED table copy). If the line 1249 copy is in a different scope serving a different purpose (e.g., per-stop distance assembly, not initial radius), the implementor MUST inspect and apply the same unification — drop the local table, use `TRAVEL_CONFIG` or `estimateTravelMinutes` or `radiusKmForConstraint` as appropriate. Surface to operator if the second occurrence cannot be cleanly migrated (likely scope = SPEC-gap, not implementor-discretion).
- **Curated retains `generosity=1.0`** and the existing 50 km clamp ceiling (do NOT bump curated's ceiling to 100 km — multi-stop trips don't benefit from longer-range candidates).

---

## §3 — Success criteria

Numbered, observable, testable. Tester validates each at TEST phase.

- **SC-01 (filter-display agreement, all modes):** For every card in the response from `discover-cards` for any `(travelMode, travelConstraintValue, location)` tuple, `card.travelTimeMin === null` OR `card.travelTimeMin <= travelConstraintValue`. ZERO exceptions.
- **SC-02 (single source of truth):** Both `radiusKmForConstraint` and `estimateTravelMinutes` in `_shared/distanceMath.ts` read from the same exported `TRAVEL_CONFIG` constant. Modifying `TRAVEL_CONFIG.driving.speed` to a new value X causes BOTH the radius and the display to change consistently — no separate caller-side override is possible without editing this one constant.
- **SC-03 (helper math, singles generosity):** `radiusKmForConstraint(30, 'driving', 1.5)` returns `35.1` (within ±0.001 floating-point tolerance). Derivation: `(30/60) × 60 × 1.3 × 1.5 = 35.1` km.
- **SC-04 (helper math, curated generosity):** `radiusKmForConstraint(30, 'driving', 1.0)` returns `23.4` (within tolerance). Derivation: `(30/60) × 60 × 1.3 × 1.0 = 23.4` km.
- **SC-05 (helper fallback):** `radiusKmForConstraint(30, 'helicopter', 1.5)` (unknown mode) returns the walking-mode value `(30/60) × 4.5 × 1.3 × 1.5 = 4.3875` km via the `?? TRAVEL_CONFIG.walking` fallback.
- **SC-06 (no local SPEED tables):** `grep -nE "(SPEED_KMH|TRAVEL_SPEEDS_KMH)\s*[:=]\s*\{" supabase/functions/discover-cards/index.ts supabase/functions/generate-curated-experiences/index.ts` returns ZERO matches.
- **SC-07 (singles generosity wiring):** `grep -nE "radiusKmForConstraint\([^,]+,\s*[^,]+,\s*1\.?5\b" supabase/functions/discover-cards/index.ts` returns ≥1 match.
- **SC-08 (curated generosity wiring):** `grep -nE "radiusKmForConstraint\([^,]+,\s*[^,]+,\s*1\.?0\b" supabase/functions/generate-curated-experiences/index.ts` returns ≥1 match (or the call uses default `1.0` arg explicitly — implementor verifies).
- **SC-09 (clamp bumped):** `grep -nE "Math\.min\(Math\.max\(Math\.round\(maxDistKm\s*\*\s*1000\)\s*,\s*500\)\s*,\s*100000\)" supabase/functions/discover-cards/index.ts` returns ≥1 match. Curated retains 50000 ceiling.
- **SC-10 (response telemetry):** Every `discover-cards` response with `sourceBreakdown.path === 'pipeline'` has `sourceBreakdown.droppedByTravelTimeFilter` of type `number` and `>= 0`. The four empty-path responses (`pool-empty`, `auth-required`, `pipeline-error`, `disabled`) MAY omit this field (no contract violation).
- **SC-11 (null-coord pass-through):** A card with `travelTimeMin === null` (because its lat/lng were null in `place_pool`) passes the post-filter unchanged. Preserves I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME.
- **SC-12 (solo + collab parity):** SC-01 holds in BOTH `sessionId === undefined` (solo) and `sessionId === '<uuid>'` (collab) modes. Both modes pass through the same filter step.
- **SC-13 (walking/biking/transit fixed):** SC-01 holds for `travelMode ∈ {walking, biking, transit, bicycling}` too — the 1.69× compound overshoot disappears for free.
- **SC-14 (no mobile change):** `app-mobile/` source files (excluding test files) have ZERO diff in this PR. Verified by `git diff --name-only` listing only `supabase/functions/...` and `Mingla_Artifacts/...` paths.
- **SC-15 (protective comment present):** `_shared/distanceMath.ts` contains the literal substring `"ORCH-0903"` AND the literal substring `"SINGLE source of truth"` in the file body (case-insensitive on the second).

---

## §4 — Invariants

### Preserve

- **I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME** (ORCH-0659/0660 [Deck distance + travel-time honesty], INVARIANT_REGISTRY.md:2294-2302). Rule: every card carries honest haversine `distanceKm` + per-mode `travelTimeMin`, or both `null` together. Never `0` sentinel. This SPEC strengthens the invariant — `TRAVEL_CONFIG` becomes the single source for both filter and display so they cannot drift. The null-coord pass-through in SC-11 explicitly preserves the invariant's null-together rule.
- **I-COHORT-REVERSIBLE** (`discover-cards/index.ts:23`). Rule: flag=0 → all users on control. Unaffected — the new radius math runs only after the cohort check passes; the cohort logic and `getSignalServingPct` cache are unchanged.
- **Constitution #2 (One owner per truth):** `TRAVEL_CONFIG` IS the one owner for travel-time speed math. Three previous copies (discover-cards local `SPEED_KMH`, curated local `TRAVEL_SPEEDS_KMH`, shared `config` inside `estimateTravelMinutes`) collapse to one exported constant.
- **Constitution #3 (No silent failures):** drop-count is logged when > 0 (`console.log` in §2.D) AND surfaced as `sourceBreakdown.droppedByTravelTimeFilter`. Tester can verify filter impact in real time.
- **Constitution #8 (Subtract before adding):** local SPEED tables in callers are DELETED before the new unified helper is added. No layering on top of broken code.
- **Constitution #13 (Exclusion consistency):** filter (radius) and display (per-card travel time) now share the exact same speed/factor — exclusion math IS inclusion math.

### Establish (NEW)

- **I-PROPOSED-DECK-TRAVEL-TIME-RESPECTS-CONSTRAINT** (DRAFT status — flips to ACTIVE on ORCH-0903 CLOSE per orchestrator).
  - **Rule:** Every card returned by `discover-cards` MUST satisfy `card.travelTimeMin === null || card.travelTimeMin <= request.travelConstraintValue`. ZERO exceptions.
  - **Enforcement:** structural test in `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` (T-01 through T-10 below). The Deno test runs in CI per the existing `_shared/__tests__/` precedent. Append-only contract per ORCH-0840 [Regression-test enforcement + append-only CI].
  - **Exit condition:** invariant remains permanently ACTIVE; if a future change must intentionally violate it (e.g., admin-mode preview where constraint is bypassed), that change opens a new ORCH and cites a `[INVARIANT-EXEMPTION ORCH-NNNN]` token in the commit body.

### Discovery-flagged latent flaws (not in scope this ORCH)

- D-1: `public_transit` mode key has no entry in `TRAVEL_CONFIG`. Falls back to walking. SPEC does NOT add it (operator-locked scope). Latent overshoot risk if a future mobile change emits `public_transit`. Register cleanup ORCH if pursued.
- D-2: `app-mobile/src/utils/travelTime.ts` (mobile-side, driving=40 km/h, no factor) is unused by deck path but may be invoked by other contexts. Out of scope. Register audit ORCH if pursued.

---

## §5 — Test cases

### §5.1 — Implementor happy-path test (REQUIRED at Step 0.5 gate)

**Path:** `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` (NEW file; NEW `__tests__/` directory under `discover-cards/`).

**Test framework:** Deno test (`deno test --allow-read`). Matches existing `_shared/__tests__/` precedent (`bouncer.test.ts`, `scorer.test.ts`, etc.).

**Required test cases:**

| ID | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-01** [FAILS-ON-REVERT KEY] | SC-01 happy-path driving | Mock-RPC returns 10 places at varying haversine distances (1-50 km). User constraint: `travelMode='driving', travelConstraintValue=30`. | Every returned card has `card.travelTimeMin === null \|\| card.travelTimeMin <= 30`. At least one card was dropped (mock includes a 45-km place that displays > 30 min). | discover-cards integration |
| **T-02** | SC-01 happy-path walking | Mock-RPC returns 8 places at 0.5-5 km. `travelMode='walking', travelConstraintValue=15`. | Every card `travelTimeMin <= 15 \|\| null`. | discover-cards integration |
| **T-03** | SC-01 happy-path biking | Mock-RPC returns 8 places at 1-10 km. `travelMode='biking', travelConstraintValue=20`. | Every card `travelTimeMin <= 20 \|\| null`. | discover-cards integration |
| **T-04** | SC-01 happy-path transit | Mock-RPC returns 8 places at 1-30 km. `travelMode='transit', travelConstraintValue=45`. | Every card `travelTimeMin <= 45 \|\| null`. | discover-cards integration |
| **T-05** [FAILS-ON-REVERT KEY] | SC-03 helper math driving singles | `radiusKmForConstraint(30, 'driving', 1.5)` | Returns `35.1 ± 0.001`. | _shared unit |
| **T-06** | SC-04 helper math driving curated | `radiusKmForConstraint(30, 'driving', 1.0)` | Returns `23.4 ± 0.001`. | _shared unit |
| **T-07** | SC-06 grep regression — discover-cards | `Deno.readTextFileSync('supabase/functions/discover-cards/index.ts')` then assert `!/SPEED_KMH\s*[:=]\s*\{/.test(text)` | True (no match). | structural |
| **T-08** | SC-06 grep regression — curated | `Deno.readTextFileSync('supabase/functions/generate-curated-experiences/index.ts')` then assert `!/TRAVEL_SPEEDS_KMH\s*[:=]\s*\{/.test(text)` | True (no match). | structural |
| **T-09** | SC-11 null-coord pass-through | Mock-RPC returns 1 row with `lat=null, lng=null` PLUS 1 row with valid coords beyond user cap. | Null-coord card passes filter (returned with `travelTimeMin=null, distanceKm=null`). Beyond-cap card is dropped. | discover-cards integration |
| **T-10** | SC-10 response shape | Any happy-path call where 1+ cards drop. | `data.sourceBreakdown.droppedByTravelTimeFilter === typeof 'number' && >= 1`. | discover-cards integration |

**`[FAILS-ON-REVERT KEY]` anchors:**
- T-01 designated. Must FAIL when post-filter step (lines 985-994 of post-fix file) is reverted/deleted; restored fix → PASS.
- T-05 designated. Must FAIL when `TRAVEL_CONFIG.driving` is reverted from `{ speed: 60, factor: 1.3 }` to `{ speed: 35, factor: 1.4 }`; restored fix → PASS.

**Implementor MUST verify both fails-on-revert anchors at the closing commit.** Document in the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`:
- Commit hash at which fail-on-revert was tested (e.g., commit `bb74655b` style).
- For T-01: cite the temporary diff that reverts the filter step, the test output showing T-01 RED, the diff restoration, the test output showing T-01 GREEN.
- For T-05: same pattern for the driving config revert.

### §5.2 — Tester adversarial test (REQUIRED at Step 0.5 gate)

**Path:** `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.adversarial.test.ts` (NEW file).

**Test framework:** Deno test, same as above.

**Adversarial design rule:** every adversarial test MUST attack a DIFFERENT angle than the corresponding happy-path test. Renaming an `it()` block is NOT adversarial. The tester's job is to find what the happy-path missed.

**Required test cases:**

| ID | Scenario (DIFFERENT angle than happy-path) | Input | Expected | Angle attacked |
|---|---|---|---|---|
| **TA-01** | Edge constraint 1 min — boundary low + radius floor interaction | Mock-RPC returns 1 place at 0.4 km haversine (below 500m floor → place gets in via the floor clamp). `travelMode='walking', travelConstraintValue=1`. | Card displays `Math.max(3, round(0.4 × 1.3 / 4.5 × 60)) = max(3, 7) = 7 min`. Card FAILS post-filter (7 > 1). Deck is empty. | Boundary low + floor interaction |
| **TA-02** | Edge constraint 120 min — boundary high + 100 km clamp interaction | Mock-RPC returns 1 place at 95 km haversine. `travelMode='driving', travelConstraintValue=120`. | Radius compute: `(120/60) × 60 × 1.3 × 1.5 = 234 km` → clamp at 100 km. Card at 95 km displays `round(95 × 1.3 / 60 × 60) = 124 min`. FAILS post-filter (124 > 120). Mock-RPC must also include a 50-km place that displays as 65 min, which passes 120. Tester verifies cap is binding, not clamp. | Boundary high + clamp ceiling interaction |
| **TA-03** [FAILS-ON-REVERT KEY] | Solo vs collab parity | Same mock-RPC + same constraint, called once with `sessionId=undefined`, once with `sessionId='550e8400-e29b-41d4-a716-446655440000'`. | Both responses contain the same set of cards (modulo deterministic sort in collab mode), and both satisfy SC-01. | Solo/collab parity |
| **TA-04** | Curated isolation — generosity must NOT leak | Direct call to `radiusKmForConstraint(30, 'driving', 1.0)` in a curated-style scenario. | Returns 23.4 km — NOT 35.1 km. Confirms curated does NOT inherit singles' 1.5× generosity. | Generosity isolation |
| **TA-05** [FAILS-ON-REVERT KEY] | Walking 1.69× overshoot regression | Mock-RPC returns 1 place at 3 km haversine. `travelMode='walking', travelConstraintValue=30`. | Walking display at 3 km: `round(3 × 1.3 / 4.5 × 60) = 52 min`. Card FAILS post-filter (52 > 30). Mock-RPC also returns a 1.5 km card displaying 26 min that PASSES. Confirms post-filter applies to walking, not just driving. | Mode-agnosticism of post-filter |
| **TA-06** | Telemetry contract under load | Force a scenario where ≥3 cards fail post-filter. | `sourceBreakdown.droppedByTravelTimeFilter >= 3`. `console.log` line emitted with mode + constraint + drop count. | Telemetry under load |
| **TA-07** | Unknown travel mode fallback | `travelMode='helicopter'` (invalid). | No crash. Falls back to walking via `TRAVEL_CONFIG.walking` nullish coalesce. SC-01 still satisfied for walking math. Helper returns walking-radius `(30/60) × 4.5 × 1.3 × 1.5 = 4.3875 km`. | Fallback resilience |
| **TA-08** | Empty pool path interaction | Force mock-RPC to return zero rows (or all-failed). | `data.sourceBreakdown.path === 'pool-empty'` OR `'pipeline-error'`. NO crash. `droppedByTravelTimeFilter` field MAY be absent (empty paths don't surface it per SC-10). | Empty-path interaction |

**`[FAILS-ON-REVERT KEY]` anchors for tester:**
- TA-03 designated. Must FAIL when the post-filter step is applied only to solo (e.g., wrapped in `if (!sessionId)`); restored fix (filter applies to both) → PASS.
- TA-05 designated. Must FAIL when the post-filter is mode-gated (e.g., `if (travelMode === 'driving')`); restored fix → PASS.

**Tester MUST verify both adversarial fails-on-revert anchors and document in the QA report.**

### §5.3 — Append-only token requirement

Both test files (`orch_0903_travel_time_contract.test.ts` + `orch_0903_travel_time_contract.adversarial.test.ts`) are NEW files. No pre-existing tests are modified. The closing commit body does NOT need a `[TEST-MOD-APPROVED ORCH-0903]` token.

IF during implementation the implementor discovers that an existing test in `_shared/__tests__/` (e.g., a hypothetical `estimateTravelMinutes.test.ts`) asserts the old driving value (35 km/h × 1.4 factor), the implementor MUST:
1. Pause implementation.
2. Surface to the operator with the conflicting test path + current assertion.
3. Operator authorizes the test modification + commit body includes `[TEST-MOD-APPROVED ORCH-0903]`.
4. The modified test is documented in the implementation report.

This is the standard append-only escape valve per ORCH-0840.

### §5.4 — Sim live-fire (TEST phase, not implementor phase)

Investigation deferred sim repro under Prime Directive 7 backend exemption. **TEST phase does NOT inherit the exemption.** Tester MUST run:

- **iOS Simulator live-fire:** boot a current consumer-app dev build (use the runbook at `Mingla_Artifacts/IOS_DEV_BUILD_REBUILD_RUNBOOK.md`), sign in, set Simulate Location to Lagos (6.5244, 3.3792) or operator's preferred test city, open the preferences sheet, set "how far" = 30 min driving, tap Apply, screenshot the deck. VERIFY no card displays a `travelTimeMin` > 30 min.
- **Android Emulator live-fire:** same flow on a current Pixel emulator.
- Repeat for walking 15 min and transit 45 min on at least iOS.
- Capture screenshots + Metro logs showing `[discover-cards] travel-time post-filter dropped N/M cards exceeding...` lines (or zero drops if pool is sparse).

This is mandatory at TEST. If sim is blocked (no dev build, no test creds), tester STOPS and asks operator per parity-enforcement rule.

---

## §6 — Implementation order

Strict sequence. Implementor follows in order, marks each step done before proceeding.

1. **Edit `supabase/functions/_shared/distanceMath.ts`** per §2 File 1. Add `TRAVEL_CONFIG` export, change driving value to `{ speed: 60, factor: 1.3 }`, update `estimateTravelMinutes` body to read `TRAVEL_CONFIG`, add `radiusKmForConstraint` function, update JSDoc sample comment, add ORCH-0903 protective comment block. Run `deno check supabase/functions/_shared/distanceMath.ts`. Zero type errors.

2. **Write happy-path test file** at `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts` per §5.1. Implementor authors T-01 through T-10. Mock the Supabase RPC client minimally (the test file should be runnable without a live Supabase project — use `Deno.test` and inject a fake RPC return value). Run `deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts`. Expected: T-05, T-06 PASS (helper math). T-01, T-02, T-03, T-04, T-09, T-10 FAIL initially (post-filter not yet added). T-07, T-08 FAIL initially (local SPEED tables still present).

3. **Edit `supabase/functions/discover-cards/index.ts`** per §2 File 2 Changes 2A through 2E. Add the import, delete local `SPEED_KMH`, replace radius math (with 100 km clamp), insert post-filter step, add `droppedByTravelTimeFilter` to populated-path response. Run `deno check supabase/functions/discover-cards/index.ts`. Zero type errors. Re-run T-01 through T-04, T-07, T-09, T-10. Expected: T-07 PASS (no SPEED_KMH match), T-01, T-02, T-03, T-04, T-09, T-10 PASS.

4. **Edit `supabase/functions/generate-curated-experiences/index.ts`** per §2 File 3. Add import, delete local `TRAVEL_SPEEDS_KMH` (both occurrences — verify the line 1249 instance too), replace radius math with helper call at generosity=1.0 (preserve curated's 50 km clamp). Run `deno check supabase/functions/generate-curated-experiences/index.ts`. Zero type errors. Re-run T-08. Expected: PASS.

5. **Full test run:** `deno test --allow-read supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts`. Expected: T-01 through T-10 all GREEN.

6. **Fails-on-revert verification (MANDATORY per §5.1):**
   - Temporarily revert the post-filter step in `discover-cards/index.ts` (delete lines 985-994 of post-fix file). Re-run. T-01 MUST go RED. Restore. T-01 GREEN.
   - Temporarily revert `TRAVEL_CONFIG.driving` to `{ speed: 35, factor: 1.4 }` in `_shared/distanceMath.ts`. Re-run. T-05 MUST go RED. Restore. T-05 GREEN.
   - Document both revert tests in the implementation report at `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md` with the temporary diffs and the test outputs.

7. **Stage, write implementation report, commit.** Stage exactly:
   - `supabase/functions/_shared/distanceMath.ts`
   - `supabase/functions/discover-cards/index.ts`
   - `supabase/functions/generate-curated-experiences/index.ts`
   - `supabase/functions/discover-cards/__tests__/orch_0903_travel_time_contract.test.ts`
   - `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0903_HOW_FAR_FILTER_DISPLAY_MISMATCH.md`
   
   Do NOT stage any other dirty file in the worktree (e.g., the staged ORCH-0892-B v2 files — those are someone else's scope). Commit message: `ORCH-0903: unify travel-time speeds (driving 60×1.3) + 1.5× generosity radius helper + post-filter` (no `[TEST-MOD-APPROVED]` token expected; if any pre-existing test was modified per §5.3, append the token). Push to `Seth`.

8. **Hand back to orchestrator for REVIEW.** Do NOT deploy edge functions. Do NOT publish EAS OTA. Do NOT open a PR. Those are orchestrator + operator steps post-tester-PASS.

---

## §7 — Regression prevention

### Structural safeguard

After this fix, the codebase has ONE `TRAVEL_CONFIG` constant in ONE file. Three previous local copies are deleted. The new `radiusKmForConstraint` helper reads `TRAVEL_CONFIG`. `estimateTravelMinutes` reads `TRAVEL_CONFIG`. Both consumer callers (`discover-cards`, `generate-curated-experiences`) import from `_shared/distanceMath.ts`. The chain:

```
TRAVEL_CONFIG (canonical) ──┬─ radiusKmForConstraint ──┬─ discover-cards (gen=1.5)
                            │                          └─ generate-curated-experiences (gen=1.0)
                            └─ estimateTravelMinutes ──── transformServablePlaceToCard (per-card display)
```

Any future divergence requires explicitly forking the constant or bypassing the helper — both of which fail T-07 and T-08 grep tests.

### Tests that catch recurrence

- **T-01 + TA-05** detect: missing or mode-gated post-filter, or any regression that lets a `travelTimeMin > constraintMin` card through.
- **T-05** detects: any change to `TRAVEL_CONFIG.driving.speed` away from 60 (the operator-locked value).
- **T-07 + T-08** detect: reintroduction of any local SPEED table in caller files.
- **TA-03** detects: filter not applied to collab mode (or only to collab).
- **TA-04** detects: curated path accidentally inheriting singles' 1.5× generosity.

### Protective comment

The ORCH-0903 comment block in `_shared/distanceMath.ts` above `TRAVEL_CONFIG` (per §2 File 1) documents the contract for future contributors. The same block is referenced in the deletion-replacement comment in `discover-cards/index.ts` (per §2 File 2 Change 2A) and `generate-curated-experiences/index.ts` (per §2 File 3 Change 3A). Future readers seeing those callers cannot ignore the cross-reference.

### CI gate considerations (out of scope)

The strict-grep registry pattern (`feedback_strict_grep_registry_pattern.md`) is an option for elevating T-07 + T-08 to a repo-wide CI gate. Not in scope for ORCH-0903 — the Deno test in `__tests__/` is sufficient, and adding a strict-grep gate is a separate operational decision. If operator wants the gate, register ORCH-0903-B follow-up after CLOSE.

---

## §8 — DIAG-marker plan

Implementor should NOT add `[ORCH-0903-DIAG]` marker lines during normal implementation — the standard `console.log('[discover-cards] travel-time post-filter dropped...')` line specified in §2 Change 2D provides sufficient runtime telemetry without marker overhead.

IF during fails-on-revert verification (§6 step 6) the implementor adds temporary `[ORCH-0903-DIAG]` lines for debugging, those MUST be reaped before CLOSE per Step 1.5 of the orchestrator's CLOSE protocol:

```bash
grep -rn "\[ORCH-0903-DIAG\]" \
  mingla-business/src/ mingla-business/app/ \
  app-mobile/src/ \
  supabase/functions/ \
  mingla-admin/src/ 2>/dev/null
```

Required outcome before CLOSE: ZERO matches.

---

## §9 — Open questions

None. The design is operator-locked (2026-05-21 brainstorm pass). SPEC has resolved every dispatch-level open question:

- Post-filter placement: ✓ between current lines 984 and 989, post-`transformServablePlaceToCard` + post-`_placesMissingCoords` warn, pre-date/time filter. Pre-round-robin-interleave (interleave at line 957 happens BEFORE this point — confirm at implementation: the interleave produces `interleavedRows` which feed `transformServablePlaceToCard` which produces `rawCards` which is what the new filter reads). Re-checking the code flow: line 957 produces `interleavedRows`; line 974-984 transforms to `rawCards`; new filter inserts here. Composition decided by interleave is preserved; only violators are dropped post-interleave.
- `travelTimeMin === null` cards: ✓ PASS (per SC-11).
- 50 km → 100 km clamp: ✓ bumped only in `discover-cards`; curated retains 50 km.
- Curated parity: ✓ same helper, `generosity=1.0`; both occurrences of `TRAVEL_SPEEDS_KMH` migrated.
- Solo + collab parity: ✓ identical edge function path; SC-12 + TA-03 verify.
- Empty deck behavior: ✓ unchanged — `path='pool-empty'` fires when `interleavedRows.length === 0` at line 959 (pre-existing); post-filter can push pool-empty to fire more often in sparse markets. Acceptable per dispatch §9.6.
- Telemetry: ✓ `droppedByTravelTimeFilter` in `sourceBreakdown` per SC-10 + TA-06.
- Backward compat: ✓ no mobile change required; pre-OTA clients receive same response shape.
- Walking/biking/transit overshoot: ✓ explicitly in scope, SC-13 + TA-05 verify.
- Driving speed sensitivity: ✓ future tuning is a one-line change in `TRAVEL_CONFIG`.

If implementation uncovers a NEW open question (e.g., the second `TRAVEL_SPEEDS_KMH` occurrence at line 1249 cannot be cleanly migrated), implementor surfaces to operator before changing scope.

---

## §10 — Cross-Surface success criteria summary

| Surface | Success criterion | How verified |
|---|---|---|
| consumer-iOS | SC-01 through SC-15 satisfied; iOS Simulator live-fire at TEST phase shows no card displays > user's "how far" cap across 4 modes × 3 sample constraints | Tester iOS Simulator + screenshots + Metro log |
| consumer-Android | SC-01 through SC-15 satisfied; Android Emulator live-fire same as iOS | Tester Android Emulator + screenshots |
| backend (`supabase/functions/`) | SC-02 + SC-06 + SC-07 + SC-08 + SC-09 + SC-15 structural; SC-03 + SC-04 + SC-05 helper math; SC-10 + SC-11 + SC-12 + SC-13 behavioral | T-05 + T-06 (helper math) + T-07 + T-08 (grep) + T-01..T-04 + T-09 + T-10 (integration) + TA-* adversarial |
| buyer-anon-web | N/A — not in scope (no preferences sheet) | — |
| business-iOS / Android / web-preview | N/A — not in scope (no consumer preferences sheet in business app) | — |
| admin-web | N/A — not in scope | — |

---

**End of SPEC.**
