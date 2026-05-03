---
id: ORCH-0707
type: SPEC
mode: SPEC
title: Curated Pipeline Category Derivation Rewire (comboCategory authority + signal-driven stopAlternatives)
classification: data-architecture + dead-code-removal + regression-prevention
severity: S2 (no current user impact; unblocks ai_* column drop appendix)
created: 2026-05-02
specer: /mingla-forensics
investigation: reports/INVESTIGATION_ORCH-0707_CURATED_CATEGORY_DERIVATION.md
dispatch: prompts/SPEC_ORCH-0707_DISPATCH.md
prior_spec: specs/SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md
implements: Option A (comboCategory threading) + signal-driven stopAlternatives + shared helper extraction + CI regression check
constitution_checks: #2 (one-owner-per-truth), #3 (throw on RPC errors — preserved), #8 (subtract-before-adding), #9 (no-fabricated-data), #13 (exclusion-consistency)
status: BINDING
---

# 0. Layman Summary

The curated date-experience pipeline currently labels each stop using a legacy AI-derived
column (`place_pool.ai_categories`). This is the wrong authority — the *combo slot the
place was selected to fill* (e.g., "this is the Movies stop") already lives on the call
stack as `comboCategory` and IS the canonical answer. This spec rewires four call sites
to read `comboCategory` instead of `ai_categories`, and rewires the curated-stop replace
flow (`stopAlternatives.ts`) to use the same `place_scores` signal-ranked RPC that the
curated pipeline already uses for selection. It also extracts the shared selection helper
into `_shared/signalRankFetch.ts` so both consumers share one source of truth, centralises
the duration-by-category map into `_shared/curatedConstants.ts`, and adds a CI test that
fails the build if `ai_categories` reads ever return to the curated path.

After this ships and observes clean for 24–48 hours, the appendix migration drops the 5
deprecated `ai_*` columns from `place_pool` and rebuilds `admin_place_pool_mv` (Appendix A).

---

# 1. Scope

## 1.1 IN-SCOPE (this spec)

| ID | Layer | Change |
|----|-------|--------|
| A1 | Edge / `_shared` | Create `supabase/functions/_shared/signalRankFetch.ts` — extract `fetchSinglesForSignalRank` + the `[CRITICAL — ORCH-0643]` warning + `COMBO_SLUG_TO_FILTER_SIGNAL` + `COMBO_SLUG_TYPE_FILTER` + `COMBO_SLUG_FILTER_MIN` into shared module. |
| A2 | Edge / `_shared` | Create `supabase/functions/_shared/curatedConstants.ts` — single-source `CATEGORY_DURATION_MINUTES` + `CATEGORY_DEFAULT_DURATION` (modern slug keys). |
| B1 | Edge / curated | `generate-curated-experiences/index.ts` — make `comboCategory` REQUIRED on `buildCardStop` opts. |
| B2 | Edge / curated | `generate-curated-experiences/index.ts` — replace `card.category`/`card.ai_categories` reads at lines 648, 675, 681, 706 with `opts.comboCategory` / `mainStops[0]?.comboCategory`. |
| B3 | Edge / curated | `generate-curated-experiences/index.ts` — drop `ai_categories` from SELECT (line 379) and drop pass-through writes (lines 432–436). |
| B4 | Edge / curated | `generate-curated-experiences/index.ts` — import `CATEGORY_DURATION_MINUTES` + `signalRankFetch` from shared modules; delete local definitions. |
| B5 | Edge / curated | `generate-curated-experiences/index.ts` — `buildCardFromStops` line 706 fallback default → `null` (per OQ-1). Drop emitted `category` field on the wire (per OQ-3). |
| C1 | Edge / `_shared` | Rewrite `_shared/stopAlternatives.ts:fetchStopAlternatives` to call `fetchSinglesForSignalRank` (signal-driven, no `ai_categories` filter). |
| C2 | Edge / `_shared` | `_shared/stopAlternatives.ts` — replace `firstCategory: ai_categories?.[0]` with `categoryId`; drop `ai_categories` from SELECT; import shared `CATEGORY_DURATION_MINUTES`. |
| E1 | Wire contract | Stops no longer carry `aiCategories` field (OQ-2). Card no longer carries top-level `category` field (OQ-3). `placeType` semantic shifts to combo slug. |
| F1 | CI / Tests | Add `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts` (Deno test) — fails if any of the 3 curated-path files contain a non-comment `ai_categories` reference. |
| G1 | Invariants | Register new invariant **I-CURATED-LABEL-SOURCE** in `Mingla_Artifacts/INVARIANT_REGISTRY.md`. |
| H1 | Tests | Tester executes T-01 through T-10 (§7) against deployed edge functions. |

## 1.2 OUT-OF-SCOPE (explicit non-goals)

| ID | Item | Why deferred | Owner |
|----|------|-------------|-------|
| OOS-1 | DROP `place_pool.ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence` columns | Conservative: ship rewire first, observe 24–48h, THEN drop. SQL pre-staged in **Appendix A**. | ORCH-0707 follow-up migration |
| OOS-2 | `admin_place_pool_mv` rebuild without ai_* columns | Same deferral; SQL in Appendix A. | ORCH-0707 follow-up |
| OOS-3 | `mingla-admin/src/pages/PlacePoolManagementPage` ai_categories handling removal | Same deferral; spec stub in Appendix A. | ORCH-0707 follow-up |
| OOS-4 | Person-hero composition changes | Already pure signal-based (investigation §C7). Zero work. | — |
| OOS-5 | Rules-engine category truth fixes | ORCH-0700 / ORCH-0705 / ORCH-0710. | Other dispatches |
| OOS-6 | Casual/Brunch bar leak | ORCH-0706. | Other dispatch |
| OOS-7 | Signal slug renames (`fine_dining` → `upscale_fine_dining`, `drinks` → `drinks_and_music`) | ORCH-0711 (deferred per investigation D-CUR-6). | Other dispatch |
| OOS-8 | `replace-curated-stop/index.ts:VALID_CATEGORIES` modern-slug fix | Already in ORCH-0700 scope (investigation D-CUR-8). | ORCH-0700 |
| OOS-9 | Legacy chip-slug bridge cleanup (`brunch_lunch_casual`, `movies_theatre`) | ORCH-0700 transitional-alias removal pass. | ORCH-0700 |

## 1.3 Assumptions

1. ORCH-0700 has NOT yet flipped its kill-switch flag for the legacy bundled slugs as of
   ORCH-0707 ship; therefore `CATEGORY_DURATION_MINUTES` keeps **both** legacy bundled
   keys AND modern split keys for the brief overlap window. After ORCH-0700 sunset
   (2026-05-12/13), ORCH-0700 will remove the legacy keys.
2. Mobile builds ≥ the OTA channel that already ships `CuratedStop.comboCategory`-aware
   types are the only ones in field; investigation §C8 confirms even pre-OTA builds are
   safe (they ignore unread fields silently).
3. `fetch_local_signal_ranked` RPC remains the canonical place-by-signal query for the
   life of this spec (any rename would require its own dispatch).
4. All `buildCardStop` call sites in `generate-curated-experiences/index.ts` already
   pass `comboCategory: catId` (verified live at lines 882–886, 914–918, 964–968).
   Making the parameter REQUIRED is therefore a TypeScript-compile-only structural
   safeguard, not a behaviour change.

---

# 2. Architectural Truth (binding)

| Surface | Authority | Source on call stack |
|---------|-----------|---------------------|
| Curated stop `placeType` | `comboCategory` (combo slot slug) | `combo[i]` → `opts.comboCategory` of `buildCardStop` |
| Curated stop `estimatedDurationMinutes` | `CATEGORY_DURATION_MINUTES[comboCategory]` | shared map keyed by combo slug |
| Curated card top-level (no longer wire-emitted) | n/a | dropped — mobile uses `categoryLabel` from `CURATED_TYPE_LABELS[experienceType]` |
| stopAlternatives selection filter | `place_scores.signal_id = resolveSignal(categoryId)` AND `score >= filterMin` | RPC `fetch_local_signal_ranked` |
| stopAlternatives `placeType` per result | `categoryId` (the slot the user is replacing) | RPC parameter |
| Person-hero composition | signal_id directly | already correct — no change |

`ai_categories` is **never** an authority in the curated pipeline after this spec lands.

---

# 3. Per-Layer Specification

## 3.A `_shared/signalRankFetch.ts` (NEW FILE)

**Path:** `supabase/functions/_shared/signalRankFetch.ts`

**Purpose:** single source of truth for "fetch and rank places by signal scores."
Imported by `generate-curated-experiences/index.ts` AND `_shared/stopAlternatives.ts`.

**Exports (verbatim signatures):**

```typescript
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface SignalRankParams {
  filterSignal: string;
  filterMin: number;
  rankSignal: string;
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  limit: number;
  requiredTypes?: string[];
}

// Shape preserved verbatim from generate-curated-experiences/index.ts:403-441 mapping,
// minus the dropped ai_categories/category/categories triple.
export interface SignalRankResult {
  id: string;
  place_pool_id: string;
  google_place_id: string;
  title: string;
  address: string;
  lat: number;
  lng: number;
  rating: number;
  review_count: number;
  price_level: number | null;
  price_min: number | null;
  price_max: number | null;
  price_tier: string | null;
  price_tiers: string[] | null;
  opening_hours: Record<string, unknown> | null;
  website: string | null;
  images: string[] | null;
  image_url: string | null;
  city_id: string | null;
  city: string | null;
  country: string | null;
  utc_offset_minutes: number | null;
  types: string[] | null;
  primary_type: string | null;
  _rankScore: number;
}

export async function fetchSinglesForSignalRank(
  supabaseAdmin: SupabaseClient,
  params: SignalRankParams,
): Promise<SignalRankResult[]>;

// Curated-pipeline mapping tables — moved from generate-curated-experiences/index.ts
// so both consumers (curated + stopAlternatives) share one source of truth.
//
// [CRITICAL — ORCH-0643] Every signal named in this map MUST have:
//   (1) a row in signal_definitions with is_active=true and current_version_id set
//   (2) at least one row in place_scores (via run-signal-scorer)
// (Full warning block from generate-curated-experiences/index.ts:448–460 moves here verbatim.)
export const COMBO_SLUG_TO_FILTER_SIGNAL: Record<string, string>;
export const COMBO_SLUG_TYPE_FILTER: Record<string, string[]>;
export const COMBO_SLUG_FILTER_MIN: Record<string, number>;

// Resolves a combo slug to its underlying signal_id. Throws on unknown slug
// (Constitution #3: never silently fall back). Used by stopAlternatives.
export function resolveFilterSignal(comboSlug: string): string;

// Resolves the per-slug filter_min override (default 120; movies/flowers = 80).
export function resolveFilterMin(comboSlug: string): number;
```

**Implementation rules:**

1. **Body of `fetchSinglesForSignalRank`** is moved VERBATIM from
   `generate-curated-experiences/index.ts:323-446` with two surgical edits:
   - **Line 379 SELECT:** REMOVE `ai_categories` from the column list.
     New SELECT: `'id, google_place_id, name, address, lat, lng, rating, review_count, price_level, price_range_start_cents, price_range_end_cents, opening_hours, website, stored_photo_urls, photos, types, primary_type, utc_offset_minutes, city_id, city, country'`
   - **Lines 432–436 row mapping:** REMOVE the three lines:
     ```typescript
     // Categories — still passed through from place_pool.ai_categories.
     // card_pool.categories is deprecated and not read anywhere post-ORCH-0634.
     ai_categories: pp.ai_categories,
     category: (pp.ai_categories?.[0] ?? null),
     categories: pp.ai_categories,
     ```
     Replace with a single comment line:
     ```typescript
     // ai_categories deprecated post-ORCH-0707 — comboCategory is the authority.
     ```
2. **Function signature change** — accept `supabaseAdmin` as first parameter (instead
   of relying on the closure-captured admin client in the original). All call sites
   pass the same `supabaseAdmin` instance they already have in scope.
3. **Throw-on-RPC-error preserved verbatim** (Constitution #3) — keep the existing
   error messages unchanged so log greps still work.
4. **`COMBO_SLUG_TO_FILTER_SIGNAL`** moved verbatim from
   `generate-curated-experiences/index.ts:463-484`.
5. **`COMBO_SLUG_TYPE_FILTER`** moved verbatim from `index.ts:489-492`.
6. **`COMBO_SLUG_FILTER_MIN`** moved verbatim from `index.ts:593-596`.
7. **`resolveFilterSignal(slug)`** body:
   ```typescript
   export function resolveFilterSignal(comboSlug: string): string {
     const sig = COMBO_SLUG_TO_FILTER_SIGNAL[comboSlug];
     if (!sig) {
       throw new Error(
         `[signalRankFetch] Unknown combo slug '${comboSlug}' — no entry in COMBO_SLUG_TO_FILTER_SIGNAL. ` +
         `Add it (with verified place_scores rows) before using.`,
       );
     }
     return sig;
   }
   ```
8. **`resolveFilterMin(slug)`** body:
   ```typescript
   export function resolveFilterMin(comboSlug: string): number {
     return COMBO_SLUG_FILTER_MIN[comboSlug] ?? 120;
   }
   ```

**Imports of `signalRankFetch` consumers** (caller side, both files):
```typescript
import {
  fetchSinglesForSignalRank,
  COMBO_SLUG_TO_FILTER_SIGNAL,
  COMBO_SLUG_TYPE_FILTER,
  COMBO_SLUG_FILTER_MIN,
  resolveFilterSignal,
  resolveFilterMin,
} from '../_shared/signalRankFetch.ts';
```

**Constitution checks for §3.A:**
- #2 one-owner-per-truth: ✓ single helper, two consumers
- #3 throw-on-error: ✓ preserved verbatim
- #8 subtract-before-adding: ✓ no new behaviour, only relocates

---

## 3.B `_shared/curatedConstants.ts` (NEW FILE)

**Path:** `supabase/functions/_shared/curatedConstants.ts`

**Body (exact, complete file):**

```typescript
// Single source of truth for curated-pipeline duration lookups.
// Keyed by combo slug (the canonical authority post-ORCH-0707).
//
// Includes BOTH modern split slugs AND legacy bundled slugs during the
// ORCH-0700 sunset window. After ORCH-0700 sunset (2026-05-12/13), the
// legacy keys will be removed by that ORCH cleanup pass.
export const CATEGORY_DURATION_MINUTES: Record<string, number> = {
  // Modern split slugs (post-ORCH-0597/0598)
  brunch: 60,
  casual_food: 60,
  movies: 120,
  theatre: 120,
  // Modern chip slugs (unchanged)
  upscale_fine_dining: 90,
  drinks_and_music: 60,
  icebreakers: 45,
  nature: 60,
  creative_arts: 90,
  play: 90,
  flowers: 15,
  groceries: 20,
  // Signal slug aliases (defensive: in case a caller passes the underlying signal id)
  fine_dining: 90,
  drinks: 60,
  // ORCH-0601 sub-category slugs (reuse signal but distinct duration semantics)
  hiking: 60,
  museum: 90,
  // Legacy bundled slugs (REMOVED at ORCH-0700 sunset)
  brunch_lunch_casual: 60,
  movies_theatre: 120,
};

export const CATEGORY_DEFAULT_DURATION = 60;
```

**Constitution checks for §3.B:**
- #2 one-owner-per-truth: ✓ replaces two duplicated definitions
- #9 no-fabricated-data: ✓ default duration is documented, not silent

---

## 3.C `generate-curated-experiences/index.ts` (REFACTOR)

**Path:** `supabase/functions/generate-curated-experiences/index.ts`

### 3.C.1 Imports

**ADD** at top of file (alongside existing imports):
```typescript
import {
  fetchSinglesForSignalRank,
  COMBO_SLUG_TO_FILTER_SIGNAL,
  COMBO_SLUG_TYPE_FILTER,
  COMBO_SLUG_FILTER_MIN,
} from '../_shared/signalRankFetch.ts';
import {
  CATEGORY_DURATION_MINUTES,
  CATEGORY_DEFAULT_DURATION,
} from '../_shared/curatedConstants.ts';
```

### 3.C.2 Deletions

**DELETE** the following blocks verbatim:

| Lines (current file) | Reason |
|---------------------|--------|
| 323–446 | `fetchSinglesForSignalRank` function definition (moved to shared module) |
| 448–460 | `[CRITICAL — ORCH-0643]` warning block (moved with the function) |
| 463–484 | `COMBO_SLUG_TO_FILTER_SIGNAL` (moved) |
| 489–492 | `COMBO_SLUG_TYPE_FILTER` (moved) |
| 593–596 | `COMBO_SLUG_FILTER_MIN` (moved) |
| 602–607 | local `CATEGORY_DURATION_MINUTES` + `CATEGORY_DEFAULT_DURATION` (moved) |

After deletion, all existing call sites of `fetchSinglesForSignalRank(...)`,
`COMBO_SLUG_TO_FILTER_SIGNAL[...]`, `COMBO_SLUG_TYPE_FILTER[...]`, and
`COMBO_SLUG_FILTER_MIN[...]` continue to compile because the imports re-bind
the same identifiers. The implementor MUST update each call to pass
`supabaseAdmin` as the first argument to `fetchSinglesForSignalRank`
(grep the file for every invocation; expected ≥ 4 sites).

### 3.C.3 `buildCardStop` signature — `comboCategory` REQUIRED

**Current (line 609):**
```typescript
function buildCardStop(
  card: any,
  stopNumber: number,
  totalStops: number,
  role: string,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
  opts?: { optional?: boolean; dismissible?: boolean; comboCategory?: string },
): any {
```

**Replace with:**
```typescript
function buildCardStop(
  card: any,
  stopNumber: number,
  totalStops: number,
  role: string,
  userLat: number,
  userLng: number,
  prevLat: number | null,
  prevLng: number | null,
  travelMode: string,
  opts: { optional?: boolean; dismissible?: boolean; comboCategory: string },
): any {
```

**Structural safeguard:** TypeScript will fail compilation at any call site that
omits `comboCategory`. This is the regression-prevention substrate (alongside §3.F
CI test).

### 3.C.4 `buildCardStop` body — replace four `card.category` / `card.ai_categories` reads

| Line (current) | Current code | New code |
|---------------|--------------|----------|
| 648 | `placeType: card.category \|\| 'place',` | `placeType: opts.comboCategory,` |
| 675 | `estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[card.category] \|\| CATEGORY_DEFAULT_DURATION,` | `estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[opts.comboCategory] ?? CATEGORY_DEFAULT_DURATION,` |
| 681 | `aiCategories: card.ai_categories \|\| card.categories \|\| [],` | **DELETE the entire line** (per OQ-2) |
| 682 | `...(opts?.comboCategory ? { comboCategory: opts.comboCategory } : {}),` | `comboCategory: opts.comboCategory,` (always emitted; never spread-conditional) |

**Note on line 675:** changed `||` → `??` so a literal `0` duration (theoretical edge
case) is not coerced to default. Honest absence per Constitution #9.

**Note on placeType comment:** add a one-line comment immediately above line 648
(structural safeguard / future-proofing):
```typescript
// ORCH-0707 / I-CURATED-LABEL-SOURCE: comboCategory is the authority for the
// stop's category label. NEVER derive from place_pool.ai_categories — that
// column is deprecated and dropped in the ORCH-0707 follow-up migration.
placeType: opts.comboCategory,
```

### 3.C.5 `buildCardFromStops` line 706 — fallback default = `null`

**Current (line 706):**
```typescript
const category = mainStops[0]?.aiCategories?.[0] || mainStops[0]?.placeType || 'brunch_lunch_casual';
```

**Replace with:** **DELETE** the entire `const category = ...` line and the
`category,` line in the returned object (line 715).

The mobile `CuratedExperienceCard` type does NOT declare a top-level `category`
field (verified investigation §C8). Removing this field saves wire bytes and
eliminates the only remaining `mainStops[0]?.aiCategories?.[0]` read in the file.

**KEEP** line 716: `categoryLabel: CURATED_TYPE_LABELS[experienceType] || 'Explore',`
(this is the consumed field, sourced from experience type — no `ai_categories`).

### 3.C.6 Verification — every `buildCardStop` call site already passes `comboCategory`

Implementor MUST verify (grep `buildCardStop\(` across the file) that the following
known call sites already pass `comboCategory: catId`:

| Line (current) | Call context | Already passes? |
|---------------|--------------|----------------|
| 882–886 | reverse-anchor branch, anchor stop | ✅ verified live (`comboCategory: catId`) |
| 914–918 | reverse-anchor branch, companion stop | ✅ verified live (`comboCategory: catId`) |
| 964–968 | standard branch | ✅ verified live (`comboCategory: catId`) |

If the implementor finds any new call site not listed above, it MUST pass the
combo slug currently in scope (`combo[i]` or equivalent). TypeScript will fail
compilation if the parameter is omitted.

### 3.C.7 SELECT line 379 — already removed via §3.A relocation

The original SELECT containing `ai_categories` lives at line 379 inside the
function body that §3.C.2 deletes. After deletion + import from `signalRankFetch`,
the file no longer references `ai_categories` anywhere. CI test §3.F enforces this.

**Constitution checks for §3.C:**
- #2 one-owner-per-truth: ✓ comboCategory is the single authority for stop label
- #8 subtract-before-adding: ✓ remove `ai_categories` reads before columns dropped
- #9 no-fabricated-data: ✓ no fallback to invented `'brunch_lunch_casual'`; null absent

---

## 3.D `_shared/stopAlternatives.ts` (REWRITE `fetchStopAlternatives`)

**Path:** `supabase/functions/_shared/stopAlternatives.ts`

### 3.D.1 Imports

**REPLACE** the imports block (lines 1–8) with:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { slugMeetsMinimum } from './priceTiers.ts';
import {
  fetchSinglesForSignalRank,
  resolveFilterSignal,
  resolveFilterMin,
} from './signalRankFetch.ts';
import {
  CATEGORY_DURATION_MINUTES,
  CATEGORY_DEFAULT_DURATION,
} from './curatedConstants.ts';

// ORCH-0659/0660: Re-export from the canonical owner. I-DECK-CARD-CONTRACT-
// DISTANCE-AND-TIME enforces a single source of truth for distance + travel-
// time math across all edge functions.
export { haversineKm, estimateTravelMinutes } from './distanceMath.ts';

const TRAVEL_SPEEDS_KMH: Record<string, number> = {
  walking: 4.5, biking: 14, transit: 20, driving: 35,
};
```

### 3.D.2 Delete the local `CATEGORY_DURATION_MINUTES` block

**DELETE** lines 14–22 (local `CATEGORY_DURATION_MINUTES` + `CATEGORY_DEFAULT_DURATION`).
The shared imports replace them.

### 3.D.3 Rewrite `fetchStopAlternatives` body

**Replace** the entire function body (lines 61–169) with:

```typescript
/**
 * ORCH-0707: Rewritten to use signal-driven selection (place_scores) instead of
 * place_pool.ai_categories. Mirrors the curated pipeline's selection contract —
 * any candidate that scores ≥ filter_min on the slot's filter signal is
 * eligible. categoryId IS the authoritative label for every alternative
 * (the user is replacing a slot of category X — every alternative is by
 * definition category X).
 *
 * Three-gate serving still enforced:
 *   G1: pp.is_servable = true (RPC WHERE)
 *   G2: ps_filter.score >= filter_min (RPC INNER JOIN ON)
 *   G3: real stored_photo_urls (post-block .filter, unchanged)
 */
export async function fetchStopAlternatives(
  supabaseAdmin: ReturnType<typeof createClient>,
  params: {
    categoryId: string;
    refLat: number;
    refLng: number;
    travelMode: string;
    budgetMax: number;
    excludePlaceIds: string[];
    limit: number;
  },
): Promise<{ alternatives: StopAlternativeResult[]; totalAvailable: number }> {
  const { categoryId, refLat, refLng, travelMode, budgetMax, excludePlaceIds, limit } = params;

  // Compute search radius (same formula as curated generator)
  const speedKmh = TRAVEL_SPEEDS_KMH[travelMode] ?? 4.5;
  const radiusMeters = Math.round((speedKmh * 1000 / 60) * 30); // 30min constraint
  const clampedRadius = Math.min(Math.max(radiusMeters, 500), 50000);

  // Resolve combo slug → filter signal. Throws on unknown slug (Constitution #3).
  // Same map the curated pipeline uses; no silent fallback.
  const filterSignal = resolveFilterSignal(categoryId);
  const filterMin = resolveFilterMin(categoryId);

  // Use the same RPC the curated pipeline uses for selection. rankSignal =
  // filterSignal preserves the legacy "rating-then-distance" approximation
  // (no vibe override for replace flow — user is replacing within a slot,
  // not picking a new vibe).
  const candidates = await fetchSinglesForSignalRank(supabaseAdmin, {
    filterSignal,
    filterMin,
    rankSignal: filterSignal,
    centerLat: refLat,
    centerLng: refLng,
    radiusMeters: clampedRadius,
    limit: 100,
    requiredTypes: undefined,
  });

  // Filter: not in exclude list, within budget, fine-dining tier floor.
  const excludeSet = new Set(excludePlaceIds);
  const filtered = candidates.filter((c) => {
    if (excludeSet.has(c.google_place_id)) return false;
    if ((c.price_min ?? 0) > budgetMax) return false;

    // Fine dining price floor — match curated-pipeline gate
    if (categoryId === 'upscale_fine_dining') {
      const tiers: string[] = Array.isArray(c.price_tiers) ? c.price_tiers : [];
      const bestTier = tiers.length ? tiers[tiers.length - 1] : c.price_tier;
      if (bestTier && !slugMeetsMinimum(bestTier, 'bougie')) return false;
    }
    return true;
  });

  const totalAvailable = filtered.length;

  // Sort by distance from reference point (closest first) — same UX contract
  // as the prior implementation.
  filtered.sort((a, b) => {
    const distA = haversineKm(refLat, refLng, a.lat ?? 0, a.lng ?? 0);
    const distB = haversineKm(refLat, refLng, b.lat ?? 0, b.lng ?? 0);
    return distA - distB;
  });

  const selected = filtered.slice(0, limit);

  // Map to response format. categoryId IS the authoritative label —
  // every alternative is, by selection contract, of category=categoryId.
  // ORCH-0707 / I-CURATED-LABEL-SOURCE: NEVER derive label from ai_categories.
  const alternatives: StopAlternativeResult[] = selected.map((c) => {
    const dist = haversineKm(refLat, refLng, c.lat ?? 0, c.lng ?? 0);
    const photos: string[] = Array.isArray(c.images) ? c.images : [];
    const description: string =
      `A great ${categoryId.replace(/_/g, ' ')} worth visiting.`;
    return {
      placeId: c.google_place_id || '',
      placePoolId: c.id,
      placeName: c.title || 'Unknown Place',
      placeType: categoryId,
      address: c.address || '',
      rating: c.rating ?? 0,
      reviewCount: c.review_count ?? 0,
      imageUrl: photos[0] || '',
      imageUrls: photos,
      priceLevelLabel: c.price_tiers?.[0] || c.price_tier || 'chill',
      priceTier: c.price_tiers?.[0] || c.price_tier || 'chill',
      priceTiers: c.price_tiers?.length ? c.price_tiers : (c.price_tier ? [c.price_tier] : ['chill']),
      priceMin: c.price_min ?? 0,
      priceMax: c.price_max ?? 0,
      openingHours: (c.opening_hours as Record<string, unknown>) || {},
      website: c.website || null,
      lat: c.lat ?? 0,
      lng: c.lng ?? 0,
      distanceFromRefKm: Math.round(dist * 100) / 100,
      aiDescription: description,
      estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[categoryId] ?? CATEGORY_DEFAULT_DURATION,
      city: c.city || null,
      country: c.country || null,
    };
  });

  return { alternatives, totalAvailable };
}
```

### 3.D.4 Behavioural changes vs. prior implementation

| Aspect | Before | After |
|--------|--------|-------|
| Selection filter | `.contains('ai_categories', [categoryId])` (deprecated column) | `place_scores JOIN signal_id=resolveFilterSignal(categoryId) AND score >= resolveFilterMin(categoryId)` |
| `placeType` per result | `ai_categories[0]` (could be ANY of place's categories) | `categoryId` (the slot the user is replacing) — **always the right answer** |
| `aiDescription` | `generative_summary || editorial_summary || \`A great ${ai_categories[0]} worth visiting.\`` | `\`A great ${categoryId} worth visiting.\`` |
| Sort | distance-only after rating-only fetch | distance-only after signal-rank fetch (improvement: ranks higher-quality candidates first within distance band) |
| Error on unknown categoryId | silent empty-result (`.contains` matches nothing) | THROWS with clear message (Constitution #3) |
| `signal_definitions`/`place_scores` precondition | n/a | every `categoryId` value MUST resolve via `COMBO_SLUG_TO_FILTER_SIGNAL` (verified at file load via the throwing resolver — caller must catch) |

**Note on `aiDescription` regression risk:** the prior code prefers
`generative_summary` and `editorial_summary` when present; the new code
always uses the templated string. This is intentional simplification —
`generative_summary` and `editorial_summary` columns are not part of the
ORCH-0707 scope, but are also not declared on the mobile contract for
replace-flow alternatives; the templated string is the contract per
investigation §C8. If operator wants to preserve summary-when-present,
re-add `c.generative_summary || c.editorial_summary || \`A great ...\``
AFTER adding those two columns to the SELECT in `signalRankFetch.ts`
(out-of-scope for this spec; flag as a follow-up if needed).

**Constitution checks for §3.D:**
- #2 one-owner-per-truth: ✓ categoryId is the single authority for label
- #3 throw-on-error: ✓ resolveFilterSignal throws on unknown slug
- #8 subtract-before-adding: ✓ removes `ai_categories` filter
- #13 exclusion-consistency: ✓ same selection filter as curated pipeline

---

## 3.E Wire-Shape Contract (binding)

### 3.E.1 What changes on the wire

| Field | Position | Before | After | Mobile impact |
|-------|----------|--------|-------|---------------|
| `aiCategories` | per stop in `stops[]` | emitted (string array) | **REMOVED** | None — mobile `CuratedStop` type has no `aiCategories` field (verified §C8); mobile already silently drops it |
| `category` | top-level on card | emitted (string, e.g., `'fine_dining'`) | **REMOVED** | None — mobile `CuratedExperienceCard` type has no `category` field (verified §C8); mobile already silently drops it |
| `placeType` | per stop in `stops[]` | `ai_categories[0]` (e.g., `'upscale_fine_dining'`) | `comboCategory` slug (e.g., `'upscale_fine_dining'`) | **None for valid combos** — semantic equivalence in 100% of cases where combo slug is in `COMBO_SLUG_TO_FILTER_SIGNAL`; the value is the SAME slug shape |
| `comboCategory` | per stop in `stops[]` | conditionally emitted (only when `opts.comboCategory` truthy) | **always emitted** (now required) | None — mobile already declares it as optional; presence-always is contract-compatible |
| `categoryLabel` | top-level on card | emitted, sourced from `CURATED_TYPE_LABELS[experienceType]` | **unchanged** (same value, same source) | None |

### 3.E.2 stopAlternatives wire shape

| Field | Before | After | Mobile impact |
|-------|--------|-------|---------------|
| `placeType` per alternative | `ai_categories[0]` of the candidate | `categoryId` (the slot being replaced) | **Tighter** — guaranteed equal to the slot category, never drifts |
| `aiDescription` | `generative_summary` or `editorial_summary` or templated | always templated (`A great ${categoryId.replace(/_/g, ' ')} worth visiting.`) | **Quality regression possible** if generative/editorial summaries were better; flagged in §3.D.4 |

### 3.E.3 No backward-compat shim

Per investigation §C9, no sunset window is needed. Pre-OTA mobile builds tolerate the
field removals silently because the mobile types never declared them. Ship in one
release.

---

## 3.F CI Regression Test

### 3.F.1 Test file

**Path:** `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts`

**Body:**

```typescript
// ORCH-0707 / I-CURATED-LABEL-SOURCE: Regression check.
// The curated pipeline (generate-curated-experiences + stopAlternatives +
// signalRankFetch) MUST NOT read place_pool.ai_categories. The authority is
// comboCategory. If this test fails, a code change re-introduced the
// deprecated column read — find and remove it.
//
// Run: deno test supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts

import { assertEquals } from 'https://deno.land/std@0.208.0/assert/mod.ts';

const CURATED_PATH_FILES = [
  'supabase/functions/generate-curated-experiences/index.ts',
  'supabase/functions/_shared/stopAlternatives.ts',
  'supabase/functions/_shared/signalRankFetch.ts',
];

// Strip line-comments and block-comments before checking. We only care about
// CODE references to ai_categories, not historical comments noting the
// deprecation.
function stripComments(src: string): string {
  // remove /* ... */ block comments (non-greedy, dot matches newline)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // remove // line comments
  out = out.replace(/\/\/.*$/gm, '');
  return out;
}

Deno.test('no_ai_categories_reads_in_curated_pipeline', async () => {
  for (const filePath of CURATED_PATH_FILES) {
    const src = await Deno.readTextFile(filePath);
    const stripped = stripComments(src);
    const matches = stripped.match(/ai_categories/g) ?? [];
    assertEquals(
      matches.length,
      0,
      `[ORCH-0707 regression] ${filePath} contains ${matches.length} non-comment 'ai_categories' reference(s). ` +
      `Curated path must NOT read place_pool.ai_categories — comboCategory is the authority. ` +
      `Find and remove the references.`,
    );
  }
});
```

### 3.F.2 Wiring into existing test runner

The Mingla repo's existing `deno test` invocation (run by the implementor's CI step
or local dev script) automatically discovers `__tests__/*.test.ts` files. No new CI
workflow needed.

If the repo lacks a `deno test` step, the implementor MUST add one to the existing
test workflow (file: `.github/workflows/*.yml` if present; otherwise pre-commit hook).

### 3.F.3 Acceptance for the CI test

1. PRE-IMPLEMENTATION: running `deno test ...no_ai_categories_in_curated.test.ts`
   FAILS (because lines 379, 432–436, 681, 706, 84, 86, 134, 140 still contain
   `ai_categories`). Tester verifies this baseline failure as part of T-07.
2. POST-IMPLEMENTATION: running it PASSES (zero non-comment references).
3. RE-INTRODUCTION: tester manually re-adds one `ai_categories` read in any of
   the 3 files, confirms test FAILS, then reverts.

---

## 3.G Invariant Registry Update

**File:** `Mingla_Artifacts/INVARIANT_REGISTRY.md`

**ADD** a new entry (insert in alphabetical order with other I-CURATED-* entries
if present; else append at the end of the active invariants section):

```markdown
### I-CURATED-LABEL-SOURCE — Curated stop label authority

**Status:** ACTIVE (registered 2026-05-02 by ORCH-0707)

**Statement:** The `placeType` field on every curated stop (response of
`generate-curated-experiences`) AND every alternative (response of
`replace-curated-stop`) MUST be the comboCategory slug — i.e., the slug of the
combo slot the place was selected to fill. It MUST NEVER be derived from
`place_pool.ai_categories`, `place_pool.ai_primary_identity`, or any other
deprecated AI-derived per-place column.

**Rationale:** A place can score high on multiple signals (e.g., Alamo Drafthouse
on both `movies` and `drinks`). The "best signal" of a place is not the same
question as "which slot did this place fill." The combo defines the slot; the
slot defines the label.

**Enforcement:**
1. **Structural (TypeScript):** `buildCardStop` opts.comboCategory is required —
   compilation fails if any call site omits it.
2. **CI test:** `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts`
   asserts zero non-comment `ai_categories` references in
   `generate-curated-experiences/index.ts`,
   `_shared/stopAlternatives.ts`,
   `_shared/signalRankFetch.ts`.
3. **Runtime:** `resolveFilterSignal(categoryId)` throws if the slug is not
   registered in `COMBO_SLUG_TO_FILTER_SIGNAL` — no silent empty-result fallback.

**Tests:** T-01, T-02, T-04, T-05, T-07 (see SPEC_ORCH-0707).

**Related invariants:** I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME (single owner for
distance/time math), I-CURATED-SELECTION-3-GATE (G1/G2/G3 serving gates).
```

---

# 4. Sequencing (binding)

| Phase | What | Files touched | Verification gate |
|-------|------|---------------|-------------------|
| **Phase 1** | Extract shared helpers | CREATE `_shared/signalRankFetch.ts`, CREATE `_shared/curatedConstants.ts` | `deno check` passes on both new files; no consumers updated yet (build of edge functions still uses inlined definitions until phase 2) |
| **Phase 2** | Refactor `generate-curated-experiences/index.ts` | `generate-curated-experiences/index.ts` (imports added; lines 323–446, 448–460, 463–484, 489–492, 593–596, 602–607 deleted; buildCardStop signature + body edits per §3.C) | `deno check supabase/functions/generate-curated-experiences/index.ts` passes; grep confirms zero non-comment `ai_categories` in this file |
| **Phase 3** | Refactor `_shared/stopAlternatives.ts` | `_shared/stopAlternatives.ts` (imports replaced; local map deleted; `fetchStopAlternatives` body rewritten per §3.D) | `deno check _shared/stopAlternatives.ts` passes; grep confirms zero non-comment `ai_categories` in this file |
| **Phase 4** | CI regression test | CREATE `_shared/__tests__/no_ai_categories_in_curated.test.ts` | `deno test ...no_ai_categories_in_curated.test.ts` PASSES post-phase-2-and-3 |
| **Phase 5** | Deploy edge functions | `supabase functions deploy generate-curated-experiences && supabase functions deploy replace-curated-stop` | Smoke probe T-01 + T-04 against production endpoints |
| **Phase 6** | Invariant registry update | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (entry per §3.G) | grep confirms `I-CURATED-LABEL-SOURCE` present |
| **Phase 7** | 24–48 hour observation window | n/a (operational) | Monitor logs for `placeType: undefined` or `[signalRankFetch] Unknown combo slug` errors. Zero occurrences = green-light Phase 8. |
| **Phase 8** | (FOLLOW-UP — APPENDIX A) Drop `ai_*` columns + rebuild matview + admin UI clean | (Appendix A — separate dispatch) | Out of THIS spec's scope; SQL pre-staged. |

**Hard rule:** Phases must execute in this order. Phase 1 helpers MUST exist before
Phase 2/3 imports are added (no broken intermediate states). Phase 4 CI test MUST
land in the SAME PR as Phase 2/3 to prevent regression in the merge window.

---

# 5. Success Criteria

Each criterion is observable, testable, and unambiguous.

1. **SC-1:** `supabase/functions/_shared/signalRankFetch.ts` exists and exports
   `fetchSinglesForSignalRank`, `COMBO_SLUG_TO_FILTER_SIGNAL`,
   `COMBO_SLUG_TYPE_FILTER`, `COMBO_SLUG_FILTER_MIN`, `resolveFilterSignal`,
   `resolveFilterMin`. (Verified: `import { ... } from '...'` succeeds in both
   consumers.)
2. **SC-2:** `supabase/functions/_shared/curatedConstants.ts` exists and exports
   `CATEGORY_DURATION_MINUTES` (with all 14 keys per §3.B) and
   `CATEGORY_DEFAULT_DURATION = 60`.
3. **SC-3:** `generate-curated-experiences/index.ts` contains zero non-comment
   references to `ai_categories` (verified by §3.F CI test).
4. **SC-4:** `_shared/stopAlternatives.ts` contains zero non-comment references
   to `ai_categories`.
5. **SC-5:** `signalRankFetch.ts` SELECT statement does NOT contain `ai_categories`
   in the column list. (Verified by reading the file.)
6. **SC-6:** `buildCardStop` signature has `opts: { ... comboCategory: string }`
   (REQUIRED, no `?`). TypeScript compiles cleanly.
7. **SC-7:** Live POST to `generate-curated-experiences` for a Romantic experience
   in a populated region returns ≥ 1 card; every stop on every card has
   `placeType` ∈ valid combo slugs (per `COMBO_SLUG_TO_FILTER_SIGNAL` keys);
   no stop has `placeType: undefined` or `placeType: null`.
8. **SC-8:** Live POST to `generate-curated-experiences` returns NO `aiCategories`
   field on any stop and NO top-level `category` field on any card. (JSON probe.)
9. **SC-9:** Live POST to `replace-curated-stop` for a Movies stop returns ≥ 1
   alternative; every alternative has `placeType === 'movies'` (or whatever the
   request's `categoryId` was). No alternative has the placeType "drift" the
   prior `ai_categories[0]` could produce.
10. **SC-10:** Live POST to `replace-curated-stop` for an unknown `categoryId`
    (e.g., `'made_up_slug'`) returns HTTP 5xx (or the function-level error
    path) with a clear `[signalRankFetch] Unknown combo slug` message in logs.
11. **SC-11:** `Mingla_Artifacts/INVARIANT_REGISTRY.md` contains an entry titled
    `I-CURATED-LABEL-SOURCE` per §3.G.
12. **SC-12:** `deno test supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts`
    passes post-implementation; manually re-introducing a `ai_categories` read
    in any of the 3 watched files makes the test fail.
13. **SC-13:** Live SQL probe `SELECT 1 FROM information_schema.columns WHERE
    table_name='place_pool' AND column_name LIKE 'ai_%'` returns **5 rows**
    (columns NOT dropped this cycle — confirms Phase 8 deferral).

---

# 6. Invariants

## 6.1 Preserved (must remain true)

| ID | Description | How preserved |
|----|-------------|---------------|
| I-CURATED-SELECTION-3-GATE (G1/G2/G3) | Servable + filter-signal-min + real photos | `fetchSinglesForSignalRank` body unchanged in shared module; same RPC, same gates |
| I-DECK-CARD-CONTRACT-DISTANCE-AND-TIME | Single distance/time math owner | `_shared/distanceMath.ts` re-export unchanged in stopAlternatives |
| I-CONSTITUTION-#3-THROW-ON-RPC | RPC errors throw, never silent | `fetchSinglesForSignalRank` throws preserved verbatim; `resolveFilterSignal` throws on unknown slug |
| I-CONSTITUTION-#9-NO-FABRICATED-DATA | Honest absence > invented values | `??` instead of `||` on duration; null/no-emit for missing top-level category |

## 6.2 Established (new)

| ID | Description |
|----|-------------|
| **I-CURATED-LABEL-SOURCE** | Curated stop & alternative `placeType` MUST be the comboCategory slug, NEVER derived from `place_pool.ai_categories`. Enforced by required TypeScript parameter + CI test + throwing resolver. (See §3.G for the full registry entry.) |

---

# 7. Test Cases

| ID | Scenario | Input / Setup | Expected Output | Layer | Maps to SC |
|----|----------|---------------|-----------------|-------|-----------|
| **T-01** | Romantic 3-stop curated card | POST `generate-curated-experiences` with experienceType=`romantic`, lat/lng=NYC center, valid budget | Response `cards[0].stops[i].placeType` matches the i-th combo slot of the chosen combo (one of the registered Romantic combos: e.g., `['flowers','creative_arts','upscale_fine_dining']` → stop[0].placeType=`flowers`, stop[1].placeType=`creative_arts`, stop[2].placeType=`upscale_fine_dining`) | Edge + RPC | SC-7 |
| **T-02** | Group Fun combo where ai_categories[0] would have differed | POST with experienceType=`group-fun` in a region with known places that have `ai_categories=['drinks']` but high `movies` signal score (Alamo Drafthouse type case). Verify Movies stop returns Movies-slot label | Stop with role 'Movie' has `placeType='movies'` regardless of place's ai_categories[0]. Stop with role 'Dinner' has `placeType='upscale_fine_dining'` | Edge | SC-7, I-CURATED-LABEL-SOURCE |
| **T-03** | Wire-shape probe | Capture raw JSON response from T-01 | `JSON.stringify(card)` does NOT contain `"aiCategories":` substring; does NOT contain top-level `"category":` (note: `"categoryLabel":` is allowed and expected) | Wire | SC-8 |
| **T-04** | stopAlternatives Movies replacement | POST `replace-curated-stop` with categoryId=`movies`, valid lat/lng | All `alternatives[*].placeType === 'movies'`. Length ≥ 1 (assuming populated region). All candidates have `place_scores.score ≥ 80` on the `movies` signal (verifiable by SQL probe of returned placeIds) | Edge + RPC | SC-9 |
| **T-05** | stopAlternatives upscale_fine_dining slug-resolution | POST `replace-curated-stop` with categoryId=`upscale_fine_dining` | All `alternatives[*].placeType === 'upscale_fine_dining'`. SQL probe of returned placeIds shows `place_scores.score ≥ 120` on the `fine_dining` signal (slug→signal resolution working) | Edge + RPC | SC-9, slug resolver |
| **T-06** | Empty case (zero matches) | POST `generate-curated-experiences` for an experience type in a region with zero matching places | Response shape returns `summary.emptyReason='pool_empty'` (or applicable reason); no crash; no `placeType: undefined` (because zero stops emitted); HTTP 200 | Edge | SC-7 robustness |
| **T-07** | CI regression test — green | Run `deno test supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts` post-Phase 4 | Test PASSES | CI | SC-12 |
| **T-08** | CI regression test — red after manual re-introduction | Manually add `ai_categories: pp.ai_categories,` somewhere in `signalRankFetch.ts`. Re-run the CI test | Test FAILS with the templated error message; revert the manual edit; test PASSES again | CI | SC-12 |
| **T-09** | Person-hero non-regression | Build with a paired-person CardRow active. Trigger curated pipeline via the personHeroComposition path. | Curated combo generates correctly (no errors related to `comboCategory` undefined; `personHeroComposition.ts:825-826` legacy slug bridge still functional pre-ORCH-0700 sunset) | Mobile + Edge | I-CURATED-LABEL-SOURCE non-violation |
| **T-10** | SQL probe — ai_* columns NOT dropped | `SELECT column_name FROM information_schema.columns WHERE table_name='place_pool' AND column_name LIKE 'ai_%'` against production | Returns 5 rows: `ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`. Confirms Phase 8 deferral. | DB | SC-13 |
| **T-11** | Unknown categoryId resolution | POST `replace-curated-stop` with categoryId=`'made_up_slug_xyz'` | Edge function returns 5xx OR a clean error response. Logs contain `[signalRankFetch] Unknown combo slug 'made_up_slug_xyz'`. NOT a silent empty-result. | Edge | SC-10 |
| **T-12** | Duration map coverage | For every key in `EXPERIENCE_TYPES.*.combos.flat()`, assert `CATEGORY_DURATION_MINUTES[key]` is a number (not undefined). Run as a one-shot Deno script post-deploy. | Zero misses (every combo slug has a duration entry; no fallback to default for any in-use slug) | Logic | SC-2 |
| **T-13** | Constitution #9 honest-absence | POST `generate-curated-experiences` and observe a stop where `c.opening_hours.openNow` is genuinely absent | `isOpenNow: null` emitted (NOT `true`/`false` fabricated). Pre-existing behavior preserved by §3.C edits. | Wire | I-CONSTITUTION-#9 |

---

# 8. Implementation Order (file-by-file)

| Step | File | Action |
|------|------|--------|
| 1 | `supabase/functions/_shared/signalRankFetch.ts` | CREATE (new file per §3.A) |
| 2 | `supabase/functions/_shared/curatedConstants.ts` | CREATE (new file per §3.B) |
| 3 | `supabase/functions/generate-curated-experiences/index.ts` | EDIT (per §3.C: add imports, delete blocks 323–446 / 448–460 / 463–484 / 489–492 / 593–596 / 602–607, change `buildCardStop` signature + body, drop `category` field at line 706) |
| 4 | `supabase/functions/_shared/stopAlternatives.ts` | EDIT (per §3.D: replace imports block, delete local duration map, rewrite `fetchStopAlternatives` body) |
| 5 | `supabase/functions/_shared/__tests__/no_ai_categories_in_curated.test.ts` | CREATE (new file per §3.F) |
| 6 | local: `deno check` on every edited / created file | VERIFY clean |
| 7 | local: `deno test ...no_ai_categories_in_curated.test.ts` | VERIFY PASSES |
| 8 | `supabase functions deploy generate-curated-experiences` | DEPLOY |
| 9 | `supabase functions deploy replace-curated-stop` | DEPLOY (required: it imports `_shared/stopAlternatives.ts`, so re-deploy with bundle change) |
| 10 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` | EDIT (insert I-CURATED-LABEL-SOURCE entry per §3.G) |
| 11 | Smoke test T-01 + T-04 against production endpoints | VERIFY |
| 12 | Begin 24–48 hour observation window | OPERATE (logs grep for `placeType: undefined` and `Unknown combo slug` errors) |

**Note for step 9:** `replace-curated-stop` re-deploys are mandatory whenever
`_shared/*` changes — Supabase edge bundles `_shared` into each consumer at
build time. Cross-check: also re-bundle any other `_shared/stopAlternatives.ts`
or `_shared/signalRankFetch.ts` consumer (per `grep stopAlternatives|signalRankFetch
supabase/functions/`).

---

# 9. Regression Prevention

| Risk | Prevention | Mechanism |
|------|-----------|-----------|
| `comboCategory` not passed at a future call site | Required TypeScript parameter | Compile-time error |
| `ai_categories` re-introduced in curated path | CI test in Deno runner | `no_ai_categories_in_curated.test.ts` per §3.F |
| Unknown `categoryId` causes silent empty result in stopAlternatives | `resolveFilterSignal` throws | Constitution #3 enforcement |
| `CATEGORY_DURATION_MINUTES` lookup miss → wrong default | Explicit T-12 coverage check | Tester verifies every in-use combo slug has an entry |
| `place_scores` lacks rows for a registered signal | Pre-existing `[CRITICAL — ORCH-0643]` warning preserved at top of helper | Documentation / human gate |
| Future PR re-adds top-level `category` field on the card | Wire-shape probe T-03 | Integration test against staging |
| Mobile starts reading `aiCategories` again | Mobile type stays absent (no field declared) | Type system enforces |

**New invariant** I-CURATED-LABEL-SOURCE (registered per §3.G) is the
auditable record-of-truth.

---

# 10. Discoveries Resolution (from investigation §2)

| ID | Discovery | Resolution in this spec |
|----|-----------|-------------------------|
| D-CUR-1 | `CATEGORY_DURATION_MINUTES` keyed on legacy bundled slugs | RESOLVED — §3.B replaces with modern split keys + signal-id aliases + (transitional) legacy keys; ORCH-0700 sunset removes the legacy keys later |
| D-CUR-2 | `SLUG_TO_STOP_ROLE` already has both legacy + modern keys | OBSERVED — no change needed; left in `index.ts` |
| D-CUR-3 | Hardcoded fallback `'brunch_lunch_casual'` at line 706 | RESOLVED — §3.C.5 deletes the entire `category` derivation; mobile uses `categoryLabel` (sourced from experience type) |
| D-CUR-4 | `replace-curated-stop` quality improvement bundled | RESOLVED — §3.D rewrite uses signal-ranked candidates; quality improves "for free" |
| D-CUR-5 | `fetchSinglesForSignalRank` should be extracted | RESOLVED — §3.A creates `_shared/signalRankFetch.ts` |
| D-CUR-6 | Chip-slug → signal-id remaining 2 mappings (`upscale_fine_dining`/`drinks_and_music`) | OBSERVED — out of scope; routed to ORCH-0711 |
| D-CUR-7 | filter-signal vs. rank-signal architecture is correct | OBSERVED — preserved verbatim |
| D-CUR-8 | `replace-curated-stop:VALID_CATEGORIES` modern-slug rejection | OBSERVED — out of scope; routed to ORCH-0700 |

---

# 11. Open Questions

**None.** All 6 OQs from the investigation were pre-resolved by operator
directive in chat 2026-05-02:

- OQ-1: fallback default = `null` (honest absence)
- OQ-2: drop wire `aiCategories` field
- OQ-3: drop wire top-level `category` field
- OQ-4: ai_* column drops in separate follow-up after observation
- OQ-5: extract `fetchSinglesForSignalRank` to `_shared/`
- OQ-6: include CI regression check

If new questions surface during implementation, implementor MUST stop and
escalate; do NOT silently choose.

---

# 12. APPENDIX A — Follow-Up Migration (DO NOT APPLY YET)

**Status:** PRE-STAGED. To be applied AFTER ORCH-0707 ships + 24–48 hour clean
observation window completes (per Phase 7).

**Scope:** drop the 5 deprecated `ai_*` columns from `place_pool`; rebuild
`admin_place_pool_mv`; remove `mingla-admin/src/pages/PlacePoolManagementPage`
ai_categories handling.

## Appendix A.1 — Migration SQL

**Migration filename:** `supabase/migrations/<NEXT_TIMESTAMP>_orch_0707_followup_drop_ai_columns.sql`

```sql
-- ORCH-0707 follow-up — Drop deprecated ai_* columns from place_pool.
-- Pre-conditions verified before applying (operator gate):
--   1. ORCH-0707 edge functions deployed (Phase 5 of SPEC_ORCH-0707).
--   2. 24–48 hour observation window passed with zero `placeType: undefined`
--      and zero `[signalRankFetch] Unknown combo slug` errors in logs.
--   3. CI test `no_ai_categories_reads_in_curated_pipeline` PASSES.
--   4. ORCH-0700 transitional-alias removal pass complete (legacy slugs
--      already cleaned from CATEGORY_DURATION_MINUTES, SLUG_TO_STOP_ROLE,
--      etc.) — confirm no stub references remain.

BEGIN;

-- Step 1: drop the matview that depends on these columns (recreated below).
DROP MATERIALIZED VIEW IF EXISTS public.admin_place_pool_mv CASCADE;

-- Step 2: drop the 5 deprecated columns.
ALTER TABLE public.place_pool
  DROP COLUMN IF EXISTS ai_categories,
  DROP COLUMN IF EXISTS ai_reason,
  DROP COLUMN IF EXISTS ai_primary_identity,
  DROP COLUMN IF EXISTS ai_confidence,
  DROP COLUMN IF EXISTS ai_web_evidence;

-- Step 3: rebuild admin_place_pool_mv WITHOUT the 5 dropped columns.
-- IMPORTANT: this body MUST be regenerated from the LAST migration that
-- created/replaced admin_place_pool_mv (whatever its timestamp) MINUS the
-- 5 dropped columns. The implementor MUST grep for the most recent
-- `CREATE MATERIALIZED VIEW ... admin_place_pool_mv` in
-- supabase/migrations/ and use that body verbatim, dropping only the
-- references to ai_categories / ai_reason / ai_primary_identity /
-- ai_confidence / ai_web_evidence.
--
-- Placeholder body (REPLACE before applying):
CREATE MATERIALIZED VIEW public.admin_place_pool_mv AS
SELECT
  pp.id,
  pp.google_place_id,
  pp.name,
  pp.address,
  pp.lat,
  pp.lng,
  pp.rating,
  pp.review_count,
  pp.price_level,
  pp.price_range_start_cents,
  pp.price_range_end_cents,
  pp.price_min,
  pp.price_max,
  pp.price_tier,
  pp.price_tiers,
  pp.opening_hours,
  pp.website,
  pp.stored_photo_urls,
  pp.photos,
  pp.types,
  pp.primary_type,
  pp.utc_offset_minutes,
  pp.city_id,
  pp.city,
  pp.country,
  pp.is_servable,
  pp.created_at,
  pp.updated_at
FROM public.place_pool pp;

CREATE UNIQUE INDEX admin_place_pool_mv_id_idx ON public.admin_place_pool_mv (id);
CREATE INDEX admin_place_pool_mv_servable_idx ON public.admin_place_pool_mv (is_servable);

REFRESH MATERIALIZED VIEW public.admin_place_pool_mv;

COMMIT;
```

## Appendix A.2 — Admin UI Cleanup Spec

**File:** `mingla-admin/src/pages/PlacePoolManagementPage.jsx` (or equivalent)

**Changes required (post-Appendix A.1 deploy):**

1. Remove any UI that displays `ai_categories`, `ai_reason`, `ai_primary_identity`,
   `ai_confidence`, or `ai_web_evidence` columns. (Grep the file for these names.)
2. Remove any inline editor / write path for these columns.
3. If a "Categories" display column is still desired in the admin table, source it
   from `mapPrimaryTypeToMinglaCategory(primary_type, types)` per ORCH-0700's
   admin-facing category-derivation utility (already specced in
   `SPEC_ORCH-0700_MOVIES_CINEMAS_ONLY_AND_PARTIAL_DECOMMISSION.md`).
4. Remove any Supabase queries that SELECT the 5 columns. Replace with the
   reduced column set.

**Test:** Manual smoke — open PlacePoolManagementPage post-deploy, verify it
loads without errors and displays expected data.

## Appendix A.3 — Apply Order

1. Confirm pre-conditions (§A.1 header).
2. Generate the actual matview body from the latest pre-existing
   `CREATE MATERIALIZED VIEW ... admin_place_pool_mv` migration (replace
   placeholder body in §A.1 step 3).
3. Apply migration via `supabase db push` (or via the Supabase Management API
   per the user's standard workflow).
4. Verify column drops via T-10's reverse: `SELECT 1 FROM information_schema.columns
   WHERE table_name='place_pool' AND column_name LIKE 'ai_%'` returns ZERO rows.
5. Apply admin UI cleanup (§A.2).
6. Smoke-test admin dashboard.
7. CLOSE ORCH-0707 follow-up.

---

# 13. Hard Rules (governing this spec)

1. **No code changes outside the files explicitly listed in §3.** Any other change
   is out of scope and must be re-spec'd.
2. **Every line edit cited.** Implementor cannot interpret. If a directive seems
   ambiguous, escalate.
3. **Sequencing is binding.** Phase 1 helpers BEFORE Phase 2/3 consumers. Phase 4
   CI test in the SAME PR as Phase 2/3.
4. **No ai_* column drops in this spec.** Appendix A is documentation only —
   a separate follow-up dispatch executes it.
5. **Constitution #3 preserved.** Throws on RPC errors. Throws on unknown combo
   slug. NEVER silent empty-result fallback.
6. **Constitution #9 preserved.** No fabricated category labels. `null` over
   invented defaults at line 706 (resolved by deletion).

---

# END OF SPEC
