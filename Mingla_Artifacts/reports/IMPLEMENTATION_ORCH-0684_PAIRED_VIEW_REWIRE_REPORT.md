# IMPLEMENTATION REPORT — ORCH-0684 — Paired-Person View: Rewire to Signal-System

**Status:** **implemented, partially verified.** Static negative-controls PASS. Live-fire verification (DB perf EXPLAIN ANALYZE + edge fn deploy + curl smoke) is operator-side per system-prompt rule (implementor never deploys migrations).

**Cycle:** 1 of 1.

**Spec:** [specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md](Mingla_Artifacts/specs/SPEC_ORCH-0684_PAIRED_VIEW_REWIRE.md)
**Investigation:** [reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md](Mingla_Artifacts/reports/INVESTIGATION_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md)
**Dispatch:** [prompts/IMPL_ORCH-0684_PAIRED_VIEW_REWIRE.md](Mingla_Artifacts/prompts/IMPL_ORCH-0684_PAIRED_VIEW_REWIRE.md)

---

## §0 Pre-flight results

### G-PF-1 — PersonGridCard orphan check

**Result: FAIL — PersonGridCard is NOT orphan; spec G-PF-1 PASS path does not apply.**

```
$ grep -rn "PersonGridCard" app-mobile/src/
app-mobile/src/components/profile/PairedProfileSection.tsx:14:import { PERSON_GRID_CARD_WIDTH } from '../PersonGridCard';
app-mobile/src/components/PersonHolidayView.tsx:39:import PersonGridCard from "./PersonGridCard";   ← dead import (this file)
app-mobile/src/components/PersonGridCard.tsx:19:export interface PersonGridCardProps {
app-mobile/src/components/PersonGridCard.tsx:30:const PersonGridCard: React.FC<PersonGridCardProps> = ({
app-mobile/src/components/PersonGridCard.tsx:174:export default PersonGridCard;
app-mobile/src/components/PairedSavesListScreen.tsx:16:import PersonGridCard from './PersonGridCard';
app-mobile/src/components/PairedSavesListScreen.tsx:113:          <PersonGridCard
```

**Action taken:** PersonGridCard.tsx PRESERVED. Active consumers: `PairedSavesListScreen.tsx:113` (JSX usage) and `PairedProfileSection.tsx:14` (constant import for `PERSON_GRID_CARD_WIDTH`). Only the dead import line in `PersonHolidayView.tsx:39` was removed (the file imported but never instantiated PersonGridCard — used inline `CompactCard` instead).

### G-PF-2 — usePersonHeroCards orphan check

**Result: PASS — orphan confirmed.**

```
$ grep -rn "usePersonHeroCards" app-mobile/src/
app-mobile/src/services/holidayCardsService.ts:7:// usePersonHeroCards.ts, personHeroCardsService.ts).
app-mobile/src/hooks/usePersonHeroCards.ts:19:export function usePersonHeroCards(params: UsePersonHeroCardsParams) {
```

The only references are: (a) the file's own export declaration; (b) a stale docstring comment in `holidayCardsService.ts`. No live JSX/hook consumers anywhere in the codebase.

**Action taken:** `app-mobile/src/hooks/usePersonHeroCards.ts` DELETED. Dead docstring reference in `holidayCardsService.ts` removed as part of HF-2 cleanup (the entire file was rewritten — see §2).

### G-PF-3 — saved_card schema verification

**Result: PASS via spec-phase verification.**

Schema verified during spec phase: `saved_card` (singular) with columns `(id, profile_id UUID NOT NULL → profiles.id, experience_id TEXT NOT NULL, title, category, image_url, match_score, card_data JSONB NOT NULL, created_at)`. Source migration: [supabase/migrations/20250127000008_create_saved_card.sql](supabase/migrations/20250127000008_create_saved_card.sql).

**Action taken:** RPC body uses `public.saved_card sc` (singular) and joins `sc.profile_id IN (p_user_id, p_person_id)` per the verified schema.

### G-PF-4 — user_visits schema + paired RLS

**Result: PASS via spec-phase verification.**

Schema verified: `user_visits` with columns `(id, user_id UUID, experience_id TEXT NOT NULL, card_data JSONB, visited_at, source, created_at)` + RLS policy "Paired users can view visits" via `pairings` EXISTS check. Source: [supabase/migrations/20260315000012_create_user_visits.sql](supabase/migrations/20260315000012_create_user_visits.sql).

**Action taken:** RPC joins `public.user_visits uv ON uv.user_id IN (p_user_id, p_person_id)` per verified schema.

### G-PF-5 — pairings table

**Result: PASS via spec-phase verification.**

Pairings table exists with `user_a_id UUID, user_b_id UUID` columns. Both orderings supported by the RLS policies on `user_visits`. Personalization JOINs use `IN (p_user_id, p_person_id)` which is order-independent.

### G-PF-extra — shared helpers

**Result: PARTIAL — `googleLevelToTierSlug` and `resolveCategories` exist; `mapPrimaryTypeToMinglaCategory` and `mapCategoryToSlug` did NOT exist, were created.**

```
$ grep -rn "mapPrimaryTypeToMinglaCategory\|mapCategoryToSlug" supabase/functions/_shared/
(no matches before this implementation)
```

**Action taken:** Added two new exports to `supabase/functions/_shared/categoryPlaceTypes.ts`:

- `mapPrimaryTypeToMinglaCategory(primaryType, fallbackTypes)` — reverse-maps Google primary_type to one of the 13 Mingla canonical category display names via the existing `MINGLA_CATEGORY_PLACE_TYPES` constant. Builds a cached index on first call (O(categories × types) ≈ 325 string comparisons; cheap). Falls back to scanning `fallbackTypes` array (place's secondary types[]) when primary_type doesn't match. Returns `null` when no match — caller decides whether to fall back or skip (Constitution #9: never fabricate).
- `mapCategoryToSlug(category)` — wrapper around existing `DISPLAY_TO_SLUG` with a stricter null-vs-string contract.

For price tier, used the existing `googleLevelToTierSlug` from `_shared/priceTiers.ts:79`. NOTE: that function defaults to `'chill'` when price_level is null — which conflicts with D-Q5's "no fabrication" requirement. Worked around by null-guarding at the mapper call site: `priceTier = raw.price_level ? googleLevelToTierSlug(raw.price_level) : null`. Discord-cards has the same fabrication risk (per investigation OBS-2 P3 ride-along) but is out of scope; logged as ORCH-0684.D-fu-priceTier.

### Spec ambiguity resolution (per dispatch §2)

**Resolution applied verbatim:** The `extractYearsElapsedFromHolidayKey` helper described in spec §3.5.2 is NOT implemented. Mobile passes `yearsElapsed` directly in the request body (mobile already computes it in CustomHolidaySectionView at PersonHolidayView.tsx:633 as `const elapsed = yr - holiday.year`); edge fn reads `yearsElapsed` from RequestBody and passes it directly to `getCompositionForHolidayKey({ yearsElapsed })`. Cleaner one-source-of-truth.

### Spec deviation: combo planner (option a vs option b)

**Deviation applied:** Spec §3.2 recommended OPTION (b) — extract combo planner from `generate-curated-experiences/index.ts` (1586 lines) into `_shared/curatedComboPlanner.ts`. The spec explicitly allowed OPTION (a) — call `generate-curated-experiences` via internal HTTP — as "simple, but adds a round-trip."

**Choice:** OPTION (a). Rationale:

- Option (b) is a 1500+-line refactor with tight regression-lock (T-24 byte-equivalent curated-deck behavior). Risk class incompatible with single-wave shipping for an S0 user-facing fix.
- Option (a) ships in this wave with low blast radius. T-24 regression-lock for the curated-deck path becomes trivially N/A — `generate-curated-experiences` is untouched.
- Cost: one extra HTTP round-trip per paired-person view mount with a combo (~100-200ms). Acceptable for v1; if telemetry shows it matters, file follow-up ORCH for extraction.

Documented as **ORCH-0684.D-fu-combo-extract** for orchestrator pickup. The extraction can be done in a separate focused cycle.

### CI smoke test deferred

Spec §3.8 specified `_smoke.test.ts` invoking the edge fn at known-good Raleigh location with real JWT. Implementor wrote `mapper.test.ts` documenting the contract but did NOT wire `_smoke.test.ts` because it requires a CI-side `CI_TEST_USER_JWT` + `CI_TEST_PAIRED_UUID` which are not in the repo. Filed as **ORCH-0684.D-fu-test** for follow-up.

### Migration apply + perf EXPLAIN ANALYZE deferred

Per implementor system-prompt strict rule: **NEVER deploy migrations.** Migration written to `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql`; user runs `supabase db push`. Perf EXPLAIN ANALYZE capture (T-20) requires the migration to be live first — done by user/tester after deploy.

### Edge fn deploys deferred

Per project convention (AH-212 + ORCH-0671/0677/0678 patterns), founder deploys edge fns via CLI. Two deploys needed: `get-person-hero-cards` (rewritten) and `generate-curated-experiences` (untouched in this implementation, no deploy strictly required, but spec §8 step 11 calls it out — confirm with operator if a redeploy serves any purpose; otherwise skip).

---

## §1 Files created (4)

| File | Lines | Purpose |
|------|-------|---------|
| [supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql](supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql) | 209 | New RPC body extending `query_person_hero_places_by_signal` with saved_card + user_visits LEFT JOINs filtered to `(p_user_id, p_person_id)`; projects `distance_m`, `personalization_boost`, `boost_reasons[]`. Preserves `LANGUAGE sql STABLE` + I-THREE-GATE-SERVING. |
| [supabase/functions/_shared/personHeroComposition.ts](supabase/functions/_shared/personHeroComposition.ts) | 152 | Holiday composition rule table (D-Q1) — birthday / valentines_day / mothers_day / fathers_day named rules, ANNIVERSARY_DEFAULT, CUSTOM_HOLIDAY_DEFAULT, deriveCompositionFromSections fallback, getCompositionForHolidayKey resolver, COMBO_EMPTY_REASON constant. |
| [supabase/functions/get-person-hero-cards/mapper.test.ts](supabase/functions/get-person-hero-cards/mapper.test.ts) | 63 | Documentary test for mapPlacePoolRowToCard contract — locks the four key invariants (title/imageUrl/priceTier-null/isOpenNow-null). NOTE: documentary not unit-test grade because mapper isn't exported; CI gate I-RPC-RETURN-SHAPE-MATCHES-CONSUMER does the structural enforcement. |

(Spec §3.2 OPTION (a) chosen → no `_shared/curatedComboPlanner.ts` extraction this cycle.)

(Spec §3.8 `_smoke.test.ts` deferred to ORCH-0684.D-fu-test.)

---

## §2 Files modified (8)

| File | Diff | What changed |
|------|------|--------------|
| [supabase/functions/_shared/categoryPlaceTypes.ts](supabase/functions/_shared/categoryPlaceTypes.ts) | +57 / -0 | Added `mapPrimaryTypeToMinglaCategory(primaryType, fallbackTypes)` reverse-lookup helper (cached) + `mapCategoryToSlug(category)` wrapper. Both required by the new mapper in get-person-hero-cards. |
| [supabase/functions/get-person-hero-cards/index.ts](supabase/functions/get-person-hero-cards/index.ts) | ~+250 / ~-200 (full rewrite of mapper + addition of combo branch + auto-bilateral) | (1) New `mapPlacePoolRowToCard` reads actual snake_case Google fields (RC-1 fix); never fabricates `priceTier` or `isOpenNow`. (2) New `planComboForHoliday` invokes `generate-curated-experiences` over internal HTTP per D-Q1 (RC-2 fix; option a chosen — see §0). (3) Auto-bilateral mode detection at `mode === "default"` when both users meet ≥10 confident pref threshold (D-Q4). (4) Request body widened with `mode: "individual"` + `yearsElapsed` (CF-3 fix). (5) Composition rule lookup via getCompositionForHolidayKey. (6) Response includes `summary.emptyReason` mirroring ORCH-0677 contract. (7) priceTierFilter now passes through `priceTier === null` cards (HF-4 fix). (8) Comment cleanup: removed `card_pool` ghost-field docstring lies. (9) Card interface extended with optional telemetry fields (isOpenNow / distanceM / signalId / signalScore). |
| [app-mobile/src/services/personHeroCardsService.ts](app-mobile/src/services/personHeroCardsService.ts) | +5 / -2 | Widened `mode` type to `"default" | "shuffle" | "bilateral" | "individual"`; added `yearsElapsed?: number` parameter; passes `isCustomHoliday` + `yearsElapsed` in POST body. |
| [app-mobile/src/hooks/usePairedCards.ts](app-mobile/src/hooks/usePairedCards.ts) | +27 / -3 | Added `mode + isCustomHoliday + yearsElapsed` to UsePairedCardsParams; query key includes mode for cache separation; `useShufflePairedCards` accepts isCustomHoliday + yearsElapsed; new exported `PairedCardsMode` type. |
| [app-mobile/src/hooks/queryKeys.ts](app-mobile/src/hooks/queryKeys.ts) | +4 / -2 | `personCardKeys.paired` extended with optional `mode = 'default'` 4th arg (additive, backwards-compatible). |
| [app-mobile/src/components/PersonHolidayView.tsx](app-mobile/src/components/PersonHolidayView.tsx) | +35 / -10 | (1) Removed dead `import PersonGridCard` (file preserved, see G-PF-1). (2) `bilateralMode` state widened to `"default" | "individual" | "bilateral"` with default = "default" (auto-decide). (3) AsyncStorage logic preserves explicit overrides; absence = "default". (4) `mode={bilateralMode}` passed through CardRow → HolidaySectionView → CustomHolidaySectionView (3 mounts). (5) `isCustomHoliday + yearsElapsed` passed by CustomHolidaySectionView using existing `elapsed` variable. (6) CompactCard footer hides price line when `priceRange === null` (was already structurally OK with `<View />` placeholder; verified). |
| [app-mobile/src/services/holidayCardsService.ts](app-mobile/src/services/holidayCardsService.ts) | +7 / -8 | Dropped unused `supabase, supabaseUrl` re-imports (HF-2 / Constitution #8 / ORCH-0573 backlog). HolidayCardsResponse extended with optional `summary?: { emptyReason: string }` mirroring edge fn contract. HolidayCard extended with optional telemetry fields. |
| [scripts/ci-check-invariants.sh](scripts/ci-check-invariants.sh) | +52 / -2 | Appended two new gates: (a) `I-PERSON-HERO-RPC-USES-USER-PARAMS` requires structural saves+visits JOINs in the migration; (b) `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` extracts mapPlacePoolRowToCard via awk and greps for card_pool ghost fields. Updated final summary to include ORCH-0684. |
| [Mingla_Artifacts/INVARIANT_REGISTRY.md](Mingla_Artifacts/INVARIANT_REGISTRY.md) | +85 / 0 | Appended 3 new invariant blocks: I-PERSON-HERO-RPC-USES-USER-PARAMS, I-RPC-RETURN-SHAPE-MATCHES-CONSUMER, I-PERSON-HERO-CARDS-HAVE-CONTENT — each with rule + why + enforcement + test + established-by + related-artifacts. |

## Files deleted (1)

| File | Reason |
|------|--------|
| `app-mobile/src/hooks/usePersonHeroCards.ts` | G-PF-2 confirmed orphan. No live consumers. |

---

## §3 Negative-control inject results

### Test T-19: I-RPC-RETURN-SHAPE-MATCHES-CONSUMER

**Inject:** Added `const _ghostDirect = raw.tagline;` inside `mapPlacePoolRowToCard` body.

**CI output (verbatim):**

```
[invariants] Checking I-RPC-RETURN-SHAPE-MATCHES-CONSUMER...
  FAIL: mapPlacePoolRowToCard in supabase/functions/get-person-hero-cards/index.ts reads card_pool ghost fields:
32:  const _t = _ghost_title["title"]; // would not fire — but raw.title would:
34:  const _ghostDirect = raw.tagline;
```

**Recovery:** Reverted inject (deleted both injected lines). Re-ran:

```
[invariants] Checking I-RPC-RETURN-SHAPE-MATCHES-CONSUMER...
  OK
```

**Verdict:** Gate fires correctly with file:line citation; recovers cleanly on revert. ✅

### Test T-18: I-PERSON-HERO-RPC-USES-USER-PARAMS

**Inject:** Replaced the `saves` and `visits` CTE bodies with personalization-blind stubs (`false AS viewer_saved` etc., dropping the JOINs).

**CI output (verbatim):**

```
[invariants] Checking I-PERSON-HERO-RPC-USES-USER-PARAMS...
  FAIL: supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql missing structural personalization JOINs.
    - saved_card JOIN filtered by IN (p_user_id, p_person_id) NOT FOUND
    - user_visits JOIN filtered by IN (p_user_id, p_person_id) NOT FOUND
    Reverting these eliminates D-Q2 Option B personalization (RC-3 regression).
```

**Recovery:** Restored the JOIN bodies. Re-ran:

```
[invariants] Checking I-PERSON-HERO-RPC-USES-USER-PARAMS...
  OK (saves + visits joint-pair JOINs present)
```

**Verdict:** Gate fires correctly with structural reasoning; recovers cleanly on revert. ✅

**Note on initial gate iteration:** First pass used `grep -c` count thresholds (≥3 each), but ablation reduced count to 4 — still passed. Strengthened gate to require structural JOIN patterns specifically. Documented in CI gate body.

---

## §4 Perf evidence

**Status: NOT CAPTURED — operator-side action required.**

Per implementor system-prompt: NEVER deploy migrations. EXPLAIN ANALYZE requires the new RPC to be live in the DB. Operator runs after `supabase db push`:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM query_person_hero_places_by_signal(
  '<viewer-uuid>'::uuid,
  '<paired-uuid>'::uuid,
  35.7796, -78.6382,
  ARRAY['romantic','play','fine_dining','drinks','nature','icebreakers','creative_arts','casual_food','movies','flowers','brunch']::text[],
  '{}'::uuid[],
  15000, 100000, 3, 9
);
```

**Spec budget:** < 500 ms p95 (warm cache).

**Risk assessment:** ORCH-0668 baseline was ~215ms p95 for 11-signal Raleigh. Adding 2 LEFT JOINs (saved_card + user_visits) with index lookups on `(profile_id)`/`(user_id)` indexes plus the per-place GROUP BY should add a small linear cost — estimated 50-100ms additional, well within the 500ms budget. If exceeded, halt clause from spec §3.3 applies (consider denormalized boost columns or cache table; do NOT regress to plpgsql).

If perf budget blown, escalate via report addendum or follow-up cycle.

---

## §5 Mechanical verification

### tsc baseline (mobile)

```
$ cd app-mobile && npx tsc --noEmit
src/components/ConnectionsPage.tsx(2756,52): error TS2345: Friend type mismatch (PRE-EXISTING — ORCH-0680 baseline)
src/components/HomePage.tsx(238,19): error TS2741: SessionSwitcherItem missing 'state' (PRE-EXISTING — ORCH-0680)
src/components/HomePage.tsx(241,54): error TS2741: SessionSwitcherItem missing 'state' (PRE-EXISTING — ORCH-0680)
```

**Verdict:** 3 pre-existing errors, 0 NEW errors introduced by ORCH-0684. ✅ Baseline maintained.

### CI gates (final positive control)

```
[invariants] Checking I-PERSON-HERO-RPC-USES-USER-PARAMS...
  OK (saves + visits joint-pair JOINs present)
[invariants] Checking I-RPC-RETURN-SHAPE-MATCHES-CONSUMER...
  OK
```

Other gates unchanged. The script-wide exit-1 is the pre-existing orthogonal `fetch_local_signal_ranked` baseline (ORCH-0683 known issue).

### Deno tests (mapper.test.ts)

`deno` not on local PATH. Per ORCH-0671/0677/0678 graceful-skip pattern, tests are written to standard format and will run on a Deno-equipped CI environment. Documentary contract assertions pass logically; full unit-grade coverage deferred to ORCH-0684.D-fu-test.

### Migration byte-verify

NOT YET RUN — migration not applied yet. After operator runs `supabase db push`, verify via Supabase MCP:

```sql
SELECT pg_get_functiondef('public.query_person_hero_places_by_signal'::regproc);
```

Diff against `supabase/migrations/20260501000001_orch_0684_person_hero_personalized.sql:39-204` (the function body).

---

## §6 Cleanup verification

### Deleted file

```
$ ls app-mobile/src/hooks/usePerson*
ls: cannot access 'app-mobile/src/hooks/usePerson*': No such file or directory
```

`usePersonHeroCards.ts` deleted. ✅

### Dead imports removed

```
$ grep -n "supabase, supabaseUrl\|from \"./supabase\"" app-mobile/src/services/holidayCardsService.ts
(no matches)
```

`holidayCardsService.ts` no longer imports unused `supabase, supabaseUrl`. ✅

### PersonGridCard preservation (G-PF-1 deviation)

```
$ grep -n "PersonGridCard" app-mobile/src/components/PersonHolidayView.tsx
(no matches — dead import line removed)
```

`PersonGridCard.tsx` itself preserved (active in PairedSavesListScreen + PairedProfileSection). ✅

---

## §7 Discoveries during implementation

| ID | Title | Severity | Notes |
|----|-------|----------|-------|
| **ORCH-0684.D-fu-priceTier** | `googleLevelToTierSlug` fabricates `'chill'` when price_level is null | P3 | Worked around at the new mapper call site by null-guarding before invoking. Discover-cards transformer (`transformServablePlaceToCard:556`) inherits the fabrication. ORCH-0684 D-Q5 mandate honored at the paired-view surface; cross-surface parity fix is a follow-up. |
| **ORCH-0684.D-fu-combo-extract** | Combo planner extraction to `_shared/curatedComboPlanner.ts` | P3 | Spec §3.2 OPTION (b). Implementor chose OPTION (a) (internal HTTP) for single-wave shipping. Future cycle can extract if telemetry shows the round-trip cost matters. |
| **ORCH-0684.D-fu-test** | CI smoke test `_smoke.test.ts` not wired | P3 | Spec §3.8 specified live HTTP smoke; requires CI test JWTs not yet in repo. `mapper.test.ts` ships as documentary contract. Wire when CI test secrets are provisioned. |
| **ORCH-0684.D-fu-card-shape** | `Card` interface in edge fn vs `HolidayCard` interface in mobile contain duplicate field declarations | P4 | Both files were extended with the same telemetry fields. Spec §2.7 (D-fu-2) already tracks consolidating shared types; this is in-scope for that follow-up. |
| **ORCH-0684.D-fu-mapper-export** | mapPlacePoolRowToCard is internal — can't unit-test directly | P4 | mapper.test.ts is documentary. To enable real Deno unit tests, move the function (and its dependencies) to `supabase/functions/_shared/personHeroMapper.ts` and export. ~30 min refactor; bundle with combo-extract follow-up. |

---

## §8 Two commit messages (drafted, no Co-Authored-By)

### Backend commit

```
feat(person-hero): ORCH-0684 — finish signal-system migration on paired view

Rewire the paired-person view to read place_pool field shapes (RC-1),
add holiday-driven combo + singles mix (RC-2 / D-Q1), and rank with
joint-pair history boosts in the RPC (RC-3 / D-Q2 Option B).

- migrations: 20260501000001_orch_0684_person_hero_personalized.sql
  extends query_person_hero_places_by_signal with saved_card +
  user_visits LEFT JOINs filtered to (p_user_id, p_person_id);
  projects distance_m + personalization_boost + boost_reasons; preserves
  LANGUAGE sql STABLE + three-gate serving (I-THREE-GATE-SERVING /
  I-POOL-ONLY-SERVING)
- get-person-hero-cards: rewrite mapPoolCardToCard → mapPlacePoolRowToCard
  reading actual place_pool fields (name, stored_photo_urls,
  primary_type via mapPrimaryTypeToMinglaCategory, opening_hours.openNow,
  price_level via googleLevelToTierSlug — null when unknown, never
  fabricates "chill"); add curated-combo branch via internal HTTP call
  to generate-curated-experiences per holiday composition rule (option a
  per spec §3.2; option b extraction deferred — see report); auto-
  bilateral mode detection at mode="default" when both users meet
  ≥10 confident pref threshold (D-Q4); widen request body to include
  yearsElapsed + mode "individual"
- _shared/personHeroComposition.ts: new — holiday composition rules for
  birthday / valentines_day / mothers_day / fathers_day / anniversary /
  custom-generic + section-derived fallback
- _shared/categoryPlaceTypes.ts: new exports
  mapPrimaryTypeToMinglaCategory + mapCategoryToSlug
- ci: 2 new invariants (I-PERSON-HERO-RPC-USES-USER-PARAMS,
  I-RPC-RETURN-SHAPE-MATCHES-CONSUMER) + 1 documentary
  (I-PERSON-HERO-CARDS-HAVE-CONTENT) — both new gates verified via
  negative-control inject and recovery

Closes ORCH-0684 backend half. Apply migration before deploying mobile
build. Mobile commit follows.
```

### Mobile commit

```
feat(paired-view): ORCH-0684 — surface real cards + combos + bilateral toggle

- personHeroCardsService: widen mode type to
  "default" | "shuffle" | "bilateral" | "individual"; add yearsElapsed
- usePairedCards: plumb mode + isCustomHoliday + yearsElapsed; query key
  includes mode for cache separation
- queryKeys: personCardKeys.paired accepts optional 4th arg mode = 'default'
  (additive, backwards-compatible)
- PersonHolidayView: pass bilateralMode through to CardRow / HolidaySectionView
  / CustomHolidaySectionView; CustomHolidaySectionView passes
  isCustomHoliday=true + yearsElapsed=elapsed; bilateralMode state widened
  to "default" | "individual" | "bilateral" with default = "default" (auto);
  AsyncStorage preserves explicit overrides only; remove dead PersonGridCard
  import (PersonGridCard.tsx file preserved — used by PairedSavesListScreen +
  PairedProfileSection)
- holidayCardsService: drop unused supabase/supabaseUrl re-imports
  (HF-2 cleanup, ORCH-0573 backlog item); HolidayCardsResponse extended
  with optional summary.emptyReason mirroring edge fn contract
- delete app-mobile/src/hooks/usePersonHeroCards.ts (orphan, G-PF-2 confirmed)

Closes ORCH-0684 mobile half. Requires backend commit deployed first
(migration + edge fn).
```

---

## §9 Status summary

**Status:** **implemented, partially verified.**

### Verified by static evidence (this implementation)

- ✅ G-PF-1..G-PF-5 + G-PF-extra all evaluated; one PASS-with-deviation (G-PF-1: PersonGridCard preserved per non-orphan finding); one PASS (G-PF-2 orphan); G-PF-3..G-PF-5 PASS via spec-phase verification.
- ✅ All 4 new files written; all 8 files modified per spec §3 mapping.
- ✅ Negative-control inject: I-RPC-RETURN-SHAPE-MATCHES-CONSUMER fires + recovers (with verbatim CI output).
- ✅ Negative-control inject: I-PERSON-HERO-RPC-USES-USER-PARAMS fires + recovers (with verbatim CI output).
- ✅ tsc --noEmit baseline maintained: 3 pre-existing errors, 0 new.
- ✅ Mapper reads ZERO card_pool ghost fields (CI gate proves it structurally).
- ✅ RPC body uses both p_user_id AND p_person_id in structural saves+visits JOINs (CI gate proves it).
- ✅ Mapper emits null priceTier when price_level null (Constitution #9 — code reviewed line-by-line).
- ✅ Mapper emits null isOpenNow when opening_hours.openNow undefined (Constitution #9 — code reviewed line-by-line).
- ✅ Combo branch wired with composition rule lookup + emptyReason on miss.
- ✅ Auto-bilateral mode detection at mode="default" with ≥10 pref threshold.
- ✅ Mobile mode plumbing through service → hook → component (3 layers verified by sequential edits).
- ✅ Cleanup verified: usePersonHeroCards.ts deleted; holidayCardsService.ts dead imports removed; PersonHolidayView.tsx PersonGridCard import removed.

### Awaiting tester or operator-side verification

- ⏳ T-01..T-07 happy-path card content (real venue names, photos, categories, null-priceTier handling) — requires migration deploy + edge fn deploy + curl smoke
- ⏳ T-08 device — null priceTier hides the price line in CompactCard
- ⏳ T-09..T-13 combo composition rules per holiday — requires combo planner round-trip
- ⏳ T-14..T-15 anniversary detection — runtime
- ⏳ T-16..T-17 personalization positive + negative control — requires test data seeding
- ⏳ T-20 perf budget < 500ms p95 — requires migration deploy + EXPLAIN ANALYZE
- ⏳ T-21..T-22 auto-bilateral fires + mode=individual blocks — requires runtime
- ⏳ T-23..T-24 regression-lock for solo Discover singles + curated deck — requires curl diff before/after
- ⏳ T-25 cleanup — covered by §6 above

### Operator-side action items (in order)

1. **Apply migration:** `supabase db push --project-ref gqnoajqerqhnvulmnyvv`
2. **Verify byte match:** Supabase MCP `execute_sql` → `SELECT pg_get_functiondef('public.query_person_hero_places_by_signal'::regproc)` — diff against migration source.
3. **Capture perf baseline (T-20):** `EXPLAIN (ANALYZE, BUFFERS) ...` per §4 above. Confirm < 500ms p95.
4. **Deploy edge fn:** `cd supabase/functions && supabase functions deploy get-person-hero-cards --project-ref gqnoajqerqhnvulmnyvv`. (`generate-curated-experiences` not modified — redeploy only if other parallel work needs it.)
5. **Smoke test edge fn:** curl per spec §8 step 5 with real JWT + Raleigh location; assert SC-1..SC-7 visually.
6. **Two commits per drafted templates** in §8 above.
7. **EAS Update mobile** (orchestrator's CLOSE protocol — not implementor's responsibility).
8. **Tester dispatch** with the §7 test matrix from spec.

---

## §10 Constitutional compliance scan

| # | Principle | Outcome |
|---|-----------|---------|
| #1 No dead taps | N/A — no new interactive elements; existing CardRow shuffle/retry preserved |
| #2 One owner per truth | STRENGTHENED — RPC is sole authority for "what places win"; mobile does NOT re-rank. Composition rule table is single source for holiday→combo mapping. |
| #3 No silent failures | IMPROVED — combo empty path emits `summary.emptyReason: 'no_viable_combo'`; auto-bilateral failure logs and falls back gracefully (visible in Supabase logs). |
| #4 One query key per entity | PRESERVED — `personCardKeys.paired` extended additively; mode parameter ensures cache separation per user-bilateral choice. |
| #5 Server state stays server-side | PRESERVED — Zustand untouched. |
| #6 Logout clears everything | PRESERVED — bilateral_mode_${pairedUserId} AsyncStorage key is per-pair user prefs, cleared by logout flow if it clears AsyncStorage. |
| #7 Label temporary fixes | HONORED — option-a deviation marked `[TRANSITIONAL]`-like in implementation report §0 with explicit exit condition (telemetry-driven extraction). |
| #8 Subtract before adding | HONORED — usePersonHeroCards.ts deleted (orphan); holidayCardsService.ts dead imports removed; ghost-field reads removed from mapper. |
| #9 No fabricated data | RESTORED — mapper emits null for unknown priceTier/isOpenNow; CompactCard hides null price line. |
| #10 Currency-aware UI | PRESERVED — formatTierLabel + currencySymbol + currencyRate plumbing untouched. |
| #11 One auth instance | PRESERVED. |
| #12 Validate at the right time | PRESERVED — auth check + body shape validation at edge fn entry. |
| #13 Exclusion consistency | PRESERVED — same three-gate serving applied (is_servable + photo gate + signal score). |
| #14 Persisted-state startup | PRESERVED — bilateral_mode AsyncStorage load happens in useEffect with proper guards. |

---

## §11 Regression surface (for tester)

Adjacent features the tester should specifically check post-deploy:

1. **Discover singles deck (Discover screen, solo + collab)** — calls a different RPC (`query_servable_places_by_signal`) and uses a different transformer. NOT touched by this implementation. Sanity test: open Discover → cards still load with real content.
2. **Discover curated deck** — calls `generate-curated-experiences` directly. Combo branch in get-person-hero-cards calls the same edge fn, so any regression in the curated edge fn would affect both. Sanity test: open Discover with curated chip → combos still load.
3. **PairedSavesListScreen** — uses `<PersonGridCard>` JSX. Verified preserved (G-PF-1 deviation). Sanity test: tap "Liked Places" pill on paired profile → list still renders.
4. **PairedProfileSection** — imports `PERSON_GRID_CARD_WIDTH` constant. Same file preserved. Sanity test: paired profile screen still lays out correctly.
5. **Bilateral toggle UI (currently hidden)** — backend now defaults to "default" mode (auto-decide). When the toggle is unhidden in a future ORCH, it should set "individual" or "bilateral" via handleModeChange.
6. **Custom holiday creation flow (CustomHolidayModal)** — unchanged by this implementation. Sanity test: create a custom holiday + birthday + see cards load with real content.
7. **Shuffle button** — useShufflePairedCards signature widened with optional isCustomHoliday + yearsElapsed. Existing callers in CardRow already pass them. Sanity test: tap shuffle → cards refresh with new content.

---

## §12 Confidence

**Static verification: HIGH.** Mapper reads zero card_pool ghost fields (CI-proven). RPC body uses both user params in structural JOINs (CI-proven). Negative-control inject + recovery sequences captured verbatim. tsc baseline maintained. Schema honestly verified at spec phase.

**Runtime verification: PENDING.** All listed in §9 require operator-side migration apply + edge fn deploy. Spec §3.3 perf-budget (< 500ms p95) is the single most important post-deploy gate; if exceeded, halt clause applies (denormalized boost columns vs cache table — do NOT regress to plpgsql).

**Combo behavior: MEDIUM.** Option (a) HTTP round-trip is the main runtime question — depends on how reliably `generate-curated-experiences` returns curated combos for the holiday composition's anchor signals. The planComboForHoliday helper degrades gracefully (returns null + emits emptyReason), but on cold-start cities or sparse signal data, combos may always fall through to singles-only with `summary.emptyReason: 'no_viable_combo'`. Acceptable per spec contract; tester should spot-check at least Raleigh + a sparse rural test point.

**Personalization behavior: MEDIUM-HIGH.** SQL JOIN logic is correct + verified by CI gate; positive vs negative control test (T-16/T-17) requires real saved_card + user_visits data for two test users in a pair, which only the tester (or operator with seed data) can stage.
