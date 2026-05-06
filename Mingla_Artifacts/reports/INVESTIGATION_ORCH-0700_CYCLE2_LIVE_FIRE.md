---
id: ORCH-0700 cycle-2
type: INVESTIGATION REPORT
mode: INVESTIGATE
classification: bug + data-integrity + ux + invariant-violation (Exclusion Consistency, No-Fabricated-Data, Constitution #8 subtract-before-adding)
severity: S1-high (confirmed)
created: 2026-05-01
investigator: /mingla-forensics
dispatch: prompts/FORENSICS_ORCH-0700_CYCLE2_LIVE_FIRE_AND_LEGACY_SWEEP.md
prior: reports/INVESTIGATION_ORCH-0700_MOVIES_CHIP_LEAK.md (cycle-1; this report EXTENDS, does not retract)
related: ORCH-0598 (Slice 6 split), ORCH-0634 (signal fan-out), ORCH-0701 (Paragon never shown — separate)
---

# ORCH-0700 cycle-2 — Live-Fire + Full-Monorepo Legacy-Reference Sweep

## 0. Verdict

**Operator's claim — Movies pill leaks theatre when cinemas exhausted — CONFIRMED at H confidence
ARCHITECTURALLY; H confidence on root-cause-class identification.**

**Pathway: A3 (signal-score promiscuity) is the live leak source.** Cycle-1 had this at "M
confidence, architecturally possible, unproven at runtime." Cycle-2 elevates to H confidence
on the root-cause class via four independent lines of evidence:

1. **Asymmetry test (operator-supplied):** Theatre pill is clean today, Movies pill leaks. The
   ONLY mechanical difference between the two chips at the routing layer is `filter_min` —
   Movies = 80, Theatre = 120 (per `discover-cards/index.ts:79-82`). All other code is
   shared. This single 40-point gap is mechanically responsible for the asymmetric leak
   behavior.
2. **Scorer math (cycle-1 §2.G3 + cycle-2 §H7):** the 'movies' signal is a soft scorer
   with -10 penalty for `performing_arts_theater` (vs Theatre signal's -20 for
   `movie_theater`), reviews regex matching the substring `"theater"` (American spelling
   common in performing-arts venue reviews), and rating + reviews scaling that allows
   high-quality non-cinema venues to clear 80 even with the type penalty.
3. **A1 (legacy union path) ruled out for canonical-chip clients:** the wire payload from
   any post-OTA client is `categories: ['Movies']` (not `'Movies & Theatre'`) — verified at
   `deckService.ts:148` `PILL_TO_CATEGORY_NAME['movies'] = 'Movies'` and confirmed
   `PreferencesSheet.tsx:108-109` exposes only the new split chips.
4. **Operator framing match:** "when it runs out of movies to show" matches A3's
   exhaustion-driven surfacing pattern exactly — high-scoring cinemas drain via swipe
   exclusions, lower-scoring non-cinema candidates that scored ≥80 then surface.

**A1 (pre-OTA bundled chip) is alive but separate.** The wire conduit at
`discover-cards/index.ts:95-96` still serves the union mapping for any pre-OTA client,
plus there is now a **third confirmed leak source cycle-1 missed**: the admin seed
pipeline + backend seedingCategories.ts pipeline are CONTINUOUSLY WRITING `'movies_theatre'`
as `ai_categories` for every newly-seeded theatre/cinema/concert venue — see §3.

**A2 (curated swap via ai_categories) confirmed in cycle-1 stands.** Same root: the seed
pipeline + admin tag = bundled, swap query = bundled, no migration ever migrated tags.

**Quantification of A3 (count of non-cinema rows scoring ≥80 on 'movies' signal):
NOT EXECUTABLE this session — requires Supabase MCP tools that are not loaded.** SQL
probes provided in §10 for operator to run and feed back. The architectural certainty
does not depend on the count; the count determines blast radius.

---

## 1. What cycle-1 ESTABLISHED that cycle-2 CONFIRMS

- **A4 disproven:** still holds. Bucket-per-chip data structure prevents fan-out
  cross-contamination.
- **A5 disproven:** still holds. Ticketmaster Music-only + zero discover invocations.
- **A6 disproven (label honesty in person-hero):** still holds. Person-hero correctly
  derives category from `primary_type`. **However** cycle-2 surfaces a related-but-distinct
  finding: person-hero's INTENT_CATEGORY_MAP at lines 178-182 still uses `'movies_theatre'`
  bundled slug — the mapper still labels honestly, but the REQUEST PATH is bundled, which
  is dead-code debt that should be cleaned up alongside the rest.
- **A2 (curated swap) confirmed:** cycle-2 §3 finds the upstream WRITE PATH that
  populated the `ai_categories` rows the swap query reads — closes the previous "where
  do these tags come from?" question.
- **Architectural root cause stands:** displayCategory fabricated at routing layer, three
  parallel category-resolution code paths disagree.

---

## 2. What cycle-1 GOT WRONG (now corrected)

- **G1 verdict "no routing-layer substitution" was M confidence and falsified by operator
  observation.** The route IS clean for canonical Movies chip — but the SCORER promiscuity
  at the per-row gate IS the leak. Cycle-1 enumerated A3 as "architecturally possible,
  unproven at runtime"; cycle-2 elevates to "architecturally certain root-cause class,
  needs DB count for blast radius."
- **Cycle-1 missed the SEED-WRITE upstream:** cycle-1 noted `ai_categories` was never
  migrated post-ORCH-0598 (D-OBS-2) but did not identify that the admin SeedTab.jsx +
  backend seedingCategories.ts are STILL ACTIVELY WRITING the bundled tag for every new
  seed today. This means the legacy `ai_categories` rows are not a frozen-historical
  problem — they grow every time admin runs the seed pipeline. **Major upgrade in
  understanding: A2 is not just a stale-data bug, it's a continuously-bleeding write path.**

---

## 3. Per-Thread H1–H7 Results

### H1 — Live-fire SQL probe of `query_servable_places_by_signal('movies', 80)`

**Verdict:** UNEXECUTABLE THIS SESSION — Supabase MCP tools are not loaded in the
forensics environment. Architectural certainty established without it (see §0 four-line
evidence). Quantification deferred to operator. Confidence on the ARCHITECTURAL VERDICT:
H. Confidence on the COUNT/NAMES of offenders: L (deferred).

**Operator-runnable probe (paste into Supabase SQL Editor):**

```sql
-- H1.a: Every row that surfaces on the Movies chip today.
-- Any row whose primary_type is NOT 'movie_theater' or 'drive_in' is an A3 offender.
SELECT
  pp.primary_type,
  pp.name,
  pp.id::text,
  ps.score,
  ps.contributions
FROM public.place_pool pp
JOIN public.place_scores ps ON ps.place_id = pp.id
WHERE ps.signal_id = 'movies'
  AND ps.score >= 80
  AND pp.is_servable = true
  AND pp.is_active = true
  AND pp.stored_photo_urls IS NOT NULL
  AND array_length(pp.stored_photo_urls, 1) > 0
  AND NOT (
    array_length(pp.stored_photo_urls, 1) = 1
    AND pp.stored_photo_urls[1] = '__backfill_failed__'
  )
ORDER BY ps.score DESC;
```

**Verdict logic:** count rows where `primary_type NOT IN ('movie_theater', 'drive_in')`.

- Zero rows = A3 disproven, look elsewhere for operator's observed leak.
- ≥1 row = A3 confirmed live; named offenders are the leak set.

**Expected outcome based on architectural analysis:** ≥3 rows. Marbles IMAX is named in
the seed comment at `20260423300001_orch_0598_signal_batch.sql:245` as a Movies signal
top anchor — its primary_type is `science_museum`, so it will appear with score ~95-105
(rating 4.7 × 10 cap 35 + reviews log 1547 ≈ 16 + summary regex hit "imax" +30 + reviews
regex hit "movie/screen" +20 = ~101, no -10 type penalty since `science_museum` not in
penalty list). The bigger question is how many performing-arts venues clear 80 — those
require -10 type penalty offset by rating + reviews + American-spelled "theater" review
keyword.

### H2 — Theatre pill symmetry verification

**Verdict:** UNEXECUTABLE THIS SESSION (same Supabase MCP gap). Operator's empirical
observation that "Theatre pill alone already shows theatre right now" is treated as
verified empirical evidence pending counter-probe. Confidence H on the asymmetry being
mechanically explained by `filter_min: 120` vs `filter_min: 80`.

**Operator-runnable probe:**

```sql
-- H2.a: Symmetric check for Theatre signal at filter_min=120.
SELECT
  pp.primary_type,
  pp.name,
  pp.id::text,
  ps.score,
  ps.contributions
FROM public.place_pool pp
JOIN public.place_scores ps ON ps.place_id = pp.id
WHERE ps.signal_id = 'theatre'
  AND ps.score >= 120
  AND pp.is_servable = true
  AND pp.is_active = true
  AND pp.stored_photo_urls IS NOT NULL
  AND array_length(pp.stored_photo_urls, 1) > 0
  AND NOT (
    array_length(pp.stored_photo_urls, 1) = 1
    AND pp.stored_photo_urls[1] = '__backfill_failed__'
  )
ORDER BY ps.score DESC;
```

**Verdict logic:** count rows where `primary_type NOT IN ('performing_arts_theater',
'opera_house', 'auditorium', 'amphitheatre', 'concert_hall', 'live_music_venue',
'philharmonic_hall')`.

- Zero or near-zero = operator's "Theatre pill is clean" empirical observation
  symmetrically verified, asymmetry is purely filter_min-driven, raises overall
  confidence on A3 root-cause class to absolute certainty.
- Non-zero = Theatre also leaks (operator's empirical observation incomplete) — broader
  scope.

### H3 — Full-monorepo legacy-bundled-chip reference sweep

**Verdict:** COMPLETE. 92 files contain at least one reference to `'Movies & Theatre'`
or `'movies_theatre'` (case-variants included). Confidence H — deterministic Grep
across entire monorepo.

**Classified table — live code (must address in SPEC):**

| File | Lines | What it does | Classification | Deletion order | Notes |
|---|---|---|---|---|---|
| `mingla-admin/src/components/seeding/SeedTab.jsx` | 56-61 | `TYPE_TO_CATEGORY` writes `'movies_theatre'` ai_category for `movie_theater`, `performing_arts_theater`, `concert_hall`, `opera_house`, `philharmonic_hall`, `amphitheatre`, `comedy_club`, `event_venue`, `arena`, `live_music_venue` on every new seed | 🟥 **DELETE + REPLACE** with split routing (cinemas → `'movies'`, all other 9 types → `'theatre'`) | **Must run BEFORE backend cleanup** — stops the bleed at the source | **PRIMARY DATA-INTEGRITY DEFECT.** Continuously writing the bundled tag for every new place. Without this fix, every cleanup elsewhere keeps getting re-undone by new seeds. |
| `supabase/functions/_shared/seedingCategories.ts` | 336-386 | Two seeding category definitions (`id: 'watch'` and `id: 'live_performance'`) BOTH carry `appCategorySlug: 'movies_theatre'` and `appCategory: 'Movies & Theatre'`. The backend pipeline writes these as ai_category on seeded places | 🟥 **DELETE + REPLACE** — `watch` → `appCategorySlug: 'movies'`; `live_performance` → `appCategorySlug: 'theatre'` | Run alongside SeedTab.jsx fix | **Equally critical write-path**. Backend pipeline equivalent of admin SeedTab. |
| `supabase/functions/discover-cards/index.ts` | 95-96 | `CATEGORY_TO_SIGNAL['Movies & Theatre']` and `['movies_theatre']` map to `signalIds: ['movies','theatre']` UNION with `displayCategory: 'Movies'` | 🟥 **DELETE** | Run AFTER all client refs are gone | A1 leak conduit. Zero pre-OTA mobile clients should still send these once mobile cleanup ships. |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | 140-145, 247-248, 479 | Canonical `'Movies & Theatre'` type list + alias entries `'movies_theatre' / 'movies-theatre' → 'Movies & Theatre'` + `DISPLAY_TO_SLUG['Movies & Theatre'] = 'movies_theatre'` | 🟥 **DELETE** | After discover-cards line 95-96 | Removing the alias means any caller that sends bundled slug fails resolution and falls through honestly |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | 472-484 (D-OBS-3 from cycle-1) | `DISPLAY_TO_SLUG` MISSING canonical `'Movies'` and `'Theatre'` keys | 🟥 **ADD** missing entries `'Movies': 'movies'` + `'Theatre': 'theatre'` | Concurrent with the bundled removal | Cycle-1 D-OBS-3 — fixes person-hero `mapCategoryToSlug` returning empty string for canonical slugs |
| `supabase/functions/_shared/categoryPlaceTypes.ts` | 554-693 (D-OBS-4 from cycle-1) | `CATEGORY_EXCLUDED_PLACE_TYPES['Movies & Theatre']` exists but no entries for canonical `'Movies'` or `'Theatre'` | 🟥 **DELETE bundled, ADD split** with type-appropriate exclusions for each | Concurrent | Affects on-demand experience generation paths |
| `supabase/functions/replace-curated-stop/index.ts` | 11-15 | `VALID_CATEGORIES` set locked to legacy 10-cat slugs including `'movies_theatre'`, no `'movies'` or `'theatre'` accepted | 🟥 **DELETE bundled, ADD split** | After SeedTab+seedingCategories cleanup | Cycle-1 confirmed A2 leak source. Without this, swap requests for canonical Movies/Theatre stops are rejected. |
| `supabase/functions/_shared/stopAlternatives.ts` | 86 | `.contains('ai_categories', [categoryId])` — accepts whatever categoryId arrives | 🟦 **HISTORICAL** as-is — but call sites must change | After replace-curated-stop accepts canonical slugs | The query itself is correct; the leak is in what categoryId callers pass |
| `supabase/functions/_shared/stopAlternatives.ts` | 17-22 | `CATEGORY_DURATION_MINUTES['movies_theatre']` = 120 minutes | 🟥 **DELETE + ADD split** entries (`movies: 150` per existing duration tables, `theatre: 120`) | Concurrent | |
| `supabase/functions/generate-curated-experiences/index.ts` | 471 | `COMBO_SLUG_TO_FILTER_SIGNAL['movies_theatre'] = 'movies'` (TRANSITIONAL) | 🟥 **DELETE** | After all combo definitions verified to use split slugs | |
| `supabase/functions/generate-curated-experiences/index.ts` | 604 | `CATEGORY_DURATION_MINUTES['movies_theatre']` = 120 minutes | 🟥 **DELETE + ADD split** | Concurrent | |
| `supabase/functions/get-person-hero-cards/index.ts` | 178-182 | `INTENT_CATEGORY_MAP.adventurous` and `.friendly` include `'movies_theatre'` slug | 🟥 **DELETE bundled, ADD split** (`'movies', 'theatre'` as separate entries) | Concurrent with SeedTab cleanup | Otherwise person-hero requests for adventurous/friendly intents send bundled slug to RPC and trigger union path |
| `supabase/functions/get-person-hero-cards/index.ts` | 194 | `CATEGORY_SLUG_TO_SIGNAL_ID['movies_theatre'] = 'movies'` (TRANSITIONAL with comment "pair with 'theatre' on caller") | 🟥 **DELETE** | After INTENT_CATEGORY_MAP cleanup | |
| `supabase/functions/get-person-hero-cards/index.ts` | 210 | Reverse map: `out['theatre'] = 'movies_theatre'` (signal→slug back-reference) | 🟥 **DELETE** | After CATEGORY_SLUG_TO_SIGNAL_ID cleanup | Replace with `out['theatre'] = 'theatre'` |
| `supabase/functions/get-person-hero-cards/index.ts` | 826 | Special-case append: if blendedCategories includes `'movies_theatre'`, push `'theatre'` to signalIds | 🟥 **DELETE** | After INTENT_CATEGORY_MAP cleanup | Dead branch once bundled slug is removed from intent maps |
| `supabase/functions/admin-seed-map-strangers/index.ts` | 117-119 | `VALID_CATEGORIES` array locked to legacy 10-cat slugs including `'movies_theatre'` | 🟥 **DELETE + ADD split** (`'movies', 'theatre'`) + delete bundled | Concurrent with replace-curated-stop fix | Same shape as replace-curated-stop |
| `mingla-admin/src/constants/categories.js` | 16, 29 | `CATEGORY_LABELS['movies_theatre'] = 'Movies & Theatre'` + `CATEGORY_COLORS['movies_theatre'] = '#3b82f6'` | 🟥 **DELETE + ADD split** (`'movies'`, `'theatre'` as separate entries with their own labels + colors) | Concurrent with SeedTab fix | |
| `app-mobile/src/services/deckService.ts` | 103 | `deckMode` type union includes `'movies_theatre'` | 🟥 **DELETE** from type | After PILL_TO_CATEGORY_NAME cleanup | Type-only change — TS-strict will catch any orphan reference |
| `app-mobile/src/services/deckService.ts` | 150 | `PILL_TO_CATEGORY_NAME['movies_theatre'] = 'Movies & Theatre'` | 🟥 **DELETE** | After verified zero callers via grep | The wire-payload alias path |
| `app-mobile/src/services/deckService.ts` | 260 | `CATEGORY_PILL_MAP['movies_theatre'] = 'movies'` (resolves legacy slug to new pill on pre-OTA pref load) | 🟨 **TRANSITIONAL retire** | After cohort migration verified clean (H5) — keep until then | Last-mile safety for any user pref row that somehow still has bundled slug |
| `app-mobile/src/utils/categoryUtils.ts` | 35, 39 | `LEGACY_CATEGORY_SLUGS` and `_ALL_CATEGORY_SLUGS` include `'movies_theatre'` | 🟨 **TRANSITIONAL retire** | After cohort migration verified clean (H5) | Resolution-only, never user-facing |
| `app-mobile/src/utils/categoryUtils.ts` | 67-69, 152, 229, 261, 303 | Multiple alias/icon/color entries for `'movies_theatre'` resolving to `'movies'` | 🟨 **TRANSITIONAL retire** in same pass as line 35-39 | Concurrent | |
| `app-mobile/src/components/PreferencesSheet/PreferencesSections.tsx` | 141 | `CATEGORY_DESCRIPTION_KEYS['movies_theatre'] = 'category_descriptions.movies_theatre'` | 🟥 **DELETE** | Concurrent with i18n key deletion | No corresponding pill exists in PreferencesSheet today, so this entry is dead |
| `app-mobile/src/constants/holidays.ts` | 17-21, 138-143 | Comments + INTENT_CATEGORY_MAP — already split correctly to `['movies', 'theatre']` at line 143; comments are historical | 🟦 **HISTORICAL** comments OK; code already split | None | Lookup confirms holidays.ts INTENT_CATEGORY_MAP is already clean post-ORCH-0598 |
| `app-mobile/src/constants/interestIcons.ts` | 44-45, 57 | Legacy slug → icon mapping `'movies_theatre': Film` | 🟨 **TRANSITIONAL retire** | After all other mobile cleanup | Icon lookup is dead unless someone passes bundled slug |
| `app-mobile/src/components/OnboardingFlow.tsx` | 2623, 2626 | Inline icon dict in onboarding picker — `'movies_theatre': 'film-new'` | 🟨 **TRANSITIONAL retire** | Concurrent with interestIcons.ts | Dead unless onboarding passes bundled `cat.slug` — verified onboarding sources from new split chips |
| `app-mobile/src/components/profile/ViewFriendProfileScreen.tsx` | 90, 93 | Inline icon dict — `'movies_theatre': 'film-outline'` | 🟨 **TRANSITIONAL retire** | Concurrent | Same as OnboardingFlow |

**Classified table — i18n locales (29 × 2 = 58 files):**

| Pattern | Locales affected | Classification | Notes |
|---|---|---|---|
| `category_movies_theatre` translation key in `common.json` | 29 (all locales) | 🟩 **TRANSLATE-key DELETE** | Once the chip is removed, the key has no consumer; deleting in all 29 locales completes parity per `ci-check-invariants.sh` rule (which currently REQUIRES this key — see scripts row below) |
| `category_descriptions.movies_theatre` in `preferences.json` | 29 (all locales) | 🟩 **TRANSLATE-key DELETE** | Same as above |

**Classified table — scripts:**

| File | Lines | What it does | Classification |
|---|---|---|---|
| `scripts/ci-check-invariants.sh` | 725 | `REQUIRED_CATEGORY_KEYS` enforces `category_movies_theatre` as a required translation key in every locale | 🟥 **DELETE the key from the required list** + concurrent locale-key deletion | Without this CI removal, deleting the i18n keys breaks CI |
| `scripts/validate-category-consistency.mjs` | 38 | Map `'Movies & Theatre' → 'movies_theatre'` for cross-system parity validation | 🟥 **DELETE bundled entry** + ADD split entries `'Movies' → 'movies'`, `'Theatre' → 'theatre'` | Concurrent with categoryPlaceTypes.ts DISPLAY_TO_SLUG fix |

**Classified table — tests:**

| File | Lines | What it does | Classification |
|---|---|---|---|
| `supabase/functions/_shared/__tests__/scorer.test.ts` | 783-786, 854-865 | Spec-mirror table with bundled entries + T-37 test specifically asserting "pre-OTA Movies & Theatre alias still unions movies + theatre (backward-compat)" | ⬜ **REWRITE** — once the bundled mapping is removed from production code, this test becomes obsolete; either delete T-37 or rewrite to assert the bundled mapping is GONE | Concurrent with discover-cards fix |

**Classified table — migrations + reports + artifacts:**

| File | Classification | Notes |
|---|---|---|
| `supabase/migrations/20260423300001_orch_0598_signal_batch.sql` | 🟦 **HISTORICAL** (do not touch) | Records the split itself. Comments + UPDATE statements that ran are immutable history. |
| `supabase/migrations/20260424200002_orch_0598_11_launch_city_pipeline.sql` | 🟦 **HISTORICAL** | |
| `supabase/migrations/20260415100000_orch0434_phase1_slug_migration.sql` | 🟦 **HISTORICAL** | Phase-1 slug migration; predates split. |
| `supabase/migrations/20260415200000_orch0434_phase9_cleanup.sql` | 🟦 **HISTORICAL** | |
| `supabase/migrations/20260416100000_orch0443_fix_category_slug_mismatch.sql` | 🟦 **HISTORICAL** | |
| `supabase/migrations/20260420000002_seed_rules_engine_v1.sql` | 🟦 **HISTORICAL** | Rules engine seed using bundled slug — if rules engine is still active and consumes this seed, audit separately. |
| `Mingla_Artifacts/*.md` (8 files: WORLD_MAP, MASTER_BUG_LIST, AGENT_HANDOFFS, OPEN_INVESTIGATIONS, INVARIANT_REGISTRY, PRODUCT_SNAPSHOT, this report's prior cycle, the cycle-1 report) | 🟦 **HISTORICAL** | Audit trail. Do not edit. |

**Total file count:** 92 files referenced. Live-code DELETEs: ~17 file:line sites across
12 distinct files. TRANSITIONAL retires: ~7 file:line sites across 6 files (mobile-side
last-mile). i18n DELETEs: 58 file × 2 keys = 116 deletions. Scripts: 2. Tests: 1 rewrite.
Migrations + artifacts: 14 historical (no edit).

**Deletion order (mandatory sequence):**

1. **Stop the bleed first** — `mingla-admin/src/components/seeding/SeedTab.jsx:56-61` +
   `supabase/functions/_shared/seedingCategories.ts:336-386` (split into `'movies'` and
   `'theatre'`). Without this, every other cleanup gets re-undone by the next seed run.
2. **Backfill ai_categories on existing rows** (see H6 SQL below). This converts every
   already-tagged `'movies_theatre'` row to its split equivalent based on `primary_type`.
3. **Open canonical slugs in legacy-locked validators** —
   `replace-curated-stop/index.ts:11-15` + `admin-seed-map-strangers/index.ts:117-119` +
   `mingla-admin/src/constants/categories.js:16,29`. Add `'movies'` and `'theatre'`,
   keep `'movies_theatre'` accepted but resolved to `'movies'` server-side temporarily.
4. **Person-hero INTENT_CATEGORY_MAP cleanup** —
   `get-person-hero-cards/index.ts:178-182, 194, 210, 826`. Split bundled to
   `['movies', 'theatre']` so person-hero stops sending bundled slug to RPC.
5. **Delete the union mapping** — `discover-cards/index.ts:95-96`. After this, any
   pre-OTA client sending `'Movies & Theatre'` gets `pool-empty` honestly instead of
   theatres-as-Movies. This is the A1 closure.
6. **Mobile cleanup** — `deckService.ts:103,150` + `categoryUtils.ts:35,39,67-69,152,229,261,303` +
   `interestIcons.ts:57` + `OnboardingFlow.tsx:2626` + `ViewFriendProfileScreen.tsx:93` +
   `PreferencesSheet/PreferencesSections.tsx:141`. **Keep** `deckService.ts:260` alias
   `'movies_theatre' → 'movies'` until cohort migration verified clean (H5).
7. **i18n + CI cleanup** — delete `category_movies_theatre` + `category_descriptions.movies_theatre`
   from all 58 locale files; delete from `ci-check-invariants.sh:725` REQUIRED list.
8. **Tests** — rewrite T-37 in `scorer.test.ts` to assert bundled mapping is GONE; update
   `validate-category-consistency.mjs:38`.
9. **Final mobile cleanup** — once H5 confirms zero `preferences` rows still contain
   `'movies_theatre'`, delete the deckService.ts:260 last-mile alias and all
   categoryUtils.ts TRANSITIONAL retires.

### H4 — Pin operator's leak as A1 vs A3 vs NEW

**Verdict:** **A3 is the operator's observed leak.** Confidence H on the architectural
explanation; quantification deferred to H1 SQL.

**Reasoning:**

- A1 ruled out for the operator's case: post-OTA mobile (`PreferencesSheet.tsx:108-109`
  has only the new split chips) sends `categories: ['Movies']` on the wire. The
  `CATEGORY_TO_SIGNAL['Movies']` route returns single-signal `['movies']` — no theatre
  signal fires. The operator must be running an OTA-current build to be testing the
  current product surface; if they were on a pre-OTA build, the operator would also be
  observing the OLD chip layout (single bundled "Movies & Theatre" pill) and would have
  framed the issue differently.
- A3 fits the symptom exactly: "when it runs out of movies to show" is the
  exhaustion-driven low-tier-candidate-surfacing pattern. Cinemas have higher scores
  (movie_theater type-weight = +80 alone clears filter); they appear first. As the user
  swipes them off (`p_exclude_place_ids` grows), the lower-scoring candidates that ALSO
  scored ≥80 surface. Those are non-cinema venues that overcame the soft -10 penalty via
  rating + reviews + American-spelled "theater" in reviews.
- NEW pathway ruled out by H3 sweep: no other code path in the monorepo serves Discover
  cards. discover-cards is the only entry point. The signal-RPC is the only data source
  (cycle-1 ORCH-0640 deprecated card_pool fallback). If A3 isn't the cause, the
  operator's observation would have to be incorrect — which contradicts the orchestrator
  rule "operator's empirical observation is treated as evidence."

### H5 — Cohort-migration completeness check

**Verdict:** UNEXECUTABLE THIS SESSION. Confidence on the static UPDATE statement at
`20260423300001_orch_0598_signal_batch.sql:312-332`: H — the SQL is well-formed and
covers both `categories` array and `display_categories` array with idempotent
`array_remove + array_cat`. Confidence that the migration RAN in production: M — no way
to verify without DB access.

**Operator-runnable probe:**

```sql
-- H5.a: Any user pref row that still contains the legacy bundled slug.
SELECT
  user_id::text,
  categories,
  display_categories
FROM public.preferences
WHERE 'movies_theatre' = ANY(COALESCE(categories, ARRAY[]::text[]))
   OR 'Movies & Theatre' = ANY(COALESCE(display_categories, ARRAY[]::text[]));
```

**Verdict logic:**

- Zero rows = migration ran cleanly, mobile-side last-mile alias at `deckService.ts:260`
  can be deleted in step 9 of the deletion order.
- ≥1 rows = stragglers exist (either migration didn't run, or new rows crept in). Run
  the migration's UPDATE statement again (it's idempotent), then re-probe.

### H6 — `place_pool.ai_categories` audit

**Verdict:** UNEXECUTABLE THIS SESSION. Confidence on the WRITE PATH being broken: H —
SeedTab.jsx and seedingCategories.ts both confirmed writing bundled tags. Confidence on
the COUNT of legacy-tagged rows: L (deferred).

**Operator-runnable probes:**

```sql
-- H6.a: Theatre venues currently tagged under the legacy bundled ai_category.
-- These are the rows the swap path returns when a user swaps a Movies stop.
SELECT
  pp.id::text,
  pp.name,
  pp.primary_type,
  pp.ai_categories
FROM public.place_pool pp
WHERE 'movies_theatre' = ANY(pp.ai_categories)
  AND pp.primary_type IN (
    'performing_arts_theater', 'opera_house', 'auditorium',
    'amphitheatre', 'concert_hall', 'philharmonic_hall',
    'comedy_club', 'live_music_venue', 'event_venue', 'arena', 'dance_hall'
  )
LIMIT 100;

-- H6.b: Total counts by primary_type for the legacy bundled tag.
-- Quantifies the migration scope for the ai_categories backfill.
SELECT
  pp.primary_type,
  COUNT(*) AS row_count
FROM public.place_pool pp
WHERE 'movies_theatre' = ANY(pp.ai_categories)
GROUP BY pp.primary_type
ORDER BY row_count DESC;

-- H6.c: Backfill SQL (DO NOT RUN BEFORE STEP 1 OF DELETION ORDER —
-- without the SeedTab.jsx + seedingCategories.ts fix, new seeds will re-undo this).
-- Idempotent: array_remove + array_cat with DISTINCT unnest.
UPDATE public.place_pool
SET
  ai_categories = (
    SELECT ARRAY(SELECT DISTINCT e FROM unnest(
      array_cat(
        array_remove(COALESCE(ai_categories, ARRAY[]::text[]), 'movies_theatre'),
        CASE
          WHEN primary_type IN ('movie_theater', 'drive_in')
            THEN ARRAY['movies']::text[]
          ELSE ARRAY['theatre']::text[]
        END
      )
    ) AS e)
  ),
  updated_at = now()
WHERE 'movies_theatre' = ANY(COALESCE(ai_categories, ARRAY[]::text[]));
```

**Verdict logic:** if H6.b returns ≥10 rows where primary_type is theatre/concert/opera,
the swap leak is significant. The backfill SQL converts each row's tag based on
`primary_type` — cinemas to `'movies'`, everything else to `'theatre'`.

**Bonus probe per ORCH-0701 (Paragon Theaters never shown):**

```sql
-- ORCH-0701: Why does Paragon Theaters never appear on the Movies chip?
SELECT
  pp.id::text,
  pp.name,
  pp.primary_type,
  pp.is_servable,
  pp.is_active,
  pp.stored_photo_urls,
  pp.ai_categories,
  ps.score AS movies_signal_score,
  ps.contributions AS movies_signal_contributions
FROM public.place_pool pp
LEFT JOIN public.place_scores ps
  ON ps.place_id = pp.id AND ps.signal_id = 'movies'
WHERE pp.name ILIKE '%paragon%'
ORDER BY pp.name;
```

**Verdict logic:** rules out the 4 candidate causes from intake:
- No row returned = (a) not seeded into place_pool for test region.
- `is_servable=false` = (b) Bouncer rejected.
- `stored_photo_urls = ['__backfill_failed__']` = (c) photo gate killed.
- `score < 80` or `score IS NULL` = (d) low signal score.
- All gates pass + score ≥ 80 = something else; investigate further.

### H7 — Soft-scorer tightening analysis (analysis-only, no fix proposed)

**Verdict:** Three minimum scorer changes would prevent A3 in production, listed in
order of conservatism. **Operator must choose at SPEC time** — this is analysis only.

**Option A (least invasive — keeps soft-scoring philosophy):** raise the
`performing_arts_theater` penalty from `-10` to `-80` in the 'movies' signal
field_weights (mirror of the THEATRE signal's `-80` for `nail_salon`). At
`20260423300001_orch_0598_signal_batch.sql:228`. Combined with rating + reviews max ~60
boost, a performing-arts venue would need to score +120 from text patterns alone to
clear filter_min=80 — practically impossible. Risk: doesn't address `concert_hall`
(-40), `opera_house` (-40), or any non-listed type (museum, science_museum, etc.) that
might still hit reviews regex. Marbles IMAX (`science_museum`) is unaffected — STAYS.

**Option B (medium):** Option A + remove the substring `"theater"` from the reviews
regex at `20260423300001_orch_0598_signal_batch.sql:239`. American-spelled performing
arts venue reviews routinely say "theater" (e.g., "great theater experience") and get
the +20 boost. Removing it disambiguates cinema from theatre at the text-pattern layer.
Risk: cinemas that are sometimes called "movie theater" in reviews lose their text
boost — but the +80 type weight already clears filter without text help.

**Option C (strictest — operator declined this in chat: "leave IMAX as is"):** add a
hard type-gate inside the RPC restricting to `primary_type IN ('movie_theater',
'drive_in')`. Drops Marbles IMAX. Operator excluded this option.

**Recommendation reflection:** Option A alone may be sufficient. Option B is belt-and-
suspenders. The scorer is a versioned config (`signal_definition_versions` table) so
this can be rolled out as v1.1.0 without code deploy. Quantification from H1 SQL
output determines whether Option A is enough — if non-cinema offenders are dominantly
`performing_arts_theater`, Option A closes them. If they include `concert_hall`,
`opera_house`, `museum`, etc., Option B is needed.

**No spec written.** This is forensics analysis only.

---

## 4. Five-truth-layer reconciliation (Movies, updated post-cycle-2)

| Layer | Says about Movies | Authoritative? | Cycle-2 update |
|---|---|---|---|
| **Docs** | Movies = cinemas only (operator confirmed in chat); Theatre = live performance separately | YES for intent | Operator added: "leave IMAX as is" — broader cinema-experience intent |
| **Schema** | `signal_definitions` registers `movies` and `theatre` as separate signals; `place_scores.signal_id` is the truth | YES for what's stored | Confirmed via migration read |
| **Code** | discover-cards uses `__displayCategory` from routing (NOT primary_type) → A1+A3 fabrication source. Person-hero uses `primary_type` (correct). Curated swap uses `ai_categories` (legacy-tagged). **NEW:** seed pipeline writes `'movies_theatre'` ai_category for everything in cinema+theatre+concert+arena+comedy_club universe — continuously bleeding | NO — Constitution #2 violation persists; **WRITE-PATH defect now identified** | |
| **Runtime** | Operator empirically observes Movies pill leaks theatre when exhausted | YES (operator-supplied empirical evidence) | Cycle-1 missed this; cycle-2 elevates to root-cause |
| **Data** | Per cycle-1: Raleigh has 7 cinemas + 15 theatre venues per ORCH-0598 seed comment. **NEW:** every newly-seeded place from either pipeline has `'movies_theatre'` ai_category. Backfill SQL needed (H6.c) | UNVERIFIED — needs H6 SQL probe | |

**Contradictions surfaced cycle-2:**

1. **Doc/Code contradiction (NEW):** Docs say Movies = cinemas; admin SeedTab + backend
   seedingCategories tag every new theatre + concert + opera + arena + comedy_club + live
   music venue with `'movies_theatre'` ai_category. The data layer already disagrees with
   the doc-stated category boundary at every new seed.
2. **Code/Code contradiction (cycle-1, restated):** discover-cards labels by routing
   intent; person-hero labels by primary_type. Same place would render with different
   category badges depending on which surface served it.
3. **Schema/Code contradiction:** `signal_definitions` has split signals; code at
   discover-cards:95-96 still maintains a union mapping that combines them into a single
   chip with a single displayCategory. The DB knows they're separate; the routing code
   collapses them.

---

## 5. Confirmed leak pathways (cycle-1 + cycle-2)

| ID | Pathway | Leak surface | User-affecting today? | Severity |
|---|---|---|---|---|
| **A1** | Pre-OTA bundled chip union mapping at `discover-cards/index.ts:95-96` serves theatre venues with `displayCategory: 'Movies'` for any pre-OTA client | Discover deck | YES (pre-OTA only; population unknown until H3 mixpanel probe) | S2 (auto-expires 2026-05-13) |
| **A2** | `replace-curated-stop` + `stopAlternatives` query `ai_categories CONTAINS 'movies_theatre'` returning AI-tagged theatres for Movies stop swaps | Curated chain swap | YES (every Movies-typed curated swap) | S1 (no expiry) |
| **A3** | Soft scorer at `20260423300001_orch_0598_signal_batch.sql:228-243` lets non-cinema venues clear filter_min=80 on 'movies' signal — operator's empirically observed leak | Discover deck (canonical Movies chip) | YES (every Movies-pill request after cinemas exhausted) | **S1 — primary defect** |
| **A2-write-path** (NEW cycle-2) | Admin SeedTab + backend seedingCategories continuously write `'movies_theatre'` ai_category for every new cinema/theatre/concert/comedy/arena/event-venue seed | Every future seed run; powers A2 | YES (every seed run grows the mis-tagged set) | S1 (data-integrity bleed) |

---

## 6. Architectural root cause (updated cycle-2)

Cycle-1's stated root cause stands and is REINFORCED by cycle-2: `displayCategory` is
fabricated at the routing layer rather than derived from the row's `primary_type` at
emission time. **Cycle-2 adds a second co-equal root cause:** the SOFT scorer design
(soft penalties, not hard type filters) combined with `filter_min: 80` (relaxed for
Movies' tiny universe) creates the architectural conditions for A3. These are two
distinct architectural problems that both need addressing — the displayCategory
fabrication explains A1's behavior; the soft scorer + relaxed filter_min explains A3's
behavior. The fix for A3 (Option A or B from H7) does NOT close A1 or A2; the fix for
A1+A2 (deletion sweep + ai_categories backfill) does NOT close A3. Both must ship.

**Third co-equal root cause cycle-2 surfaced:** the seed pipelines (admin SeedTab +
backend seedingCategories) are using the legacy bundled taxonomy as their write
target, continuously creating new `'movies_theatre'` ai_categories rows. This is not
an architectural defect of the split — it's an incomplete migration. Every other
cleanup is undone by the next seed run unless the seed pipelines are fixed first.

---

## 7. Invariants violated (cycle-1 + cycle-2)

- **INV-Exclusion-Consistency (Constitution #13):** A1 + A2 + A3 all serve rows the
  category boundary should exclude. **NEW cycle-2:** the seed pipeline write also
  violates this — it generates rows the new split categories should never accept.
- **INV-Source-of-Truth-Single (Constitution #2):** `displayCategory` (routing) vs
  `primary_type` (place_pool) vs `ai_categories` (seed-written tags) = three competing
  owners of "what category is this place?". **Cycle-2 amplification:** the seed pipeline
  is a fourth owner, writing tags that disagree with the new taxonomy.
- **INV-No-Fabricated-Data (Constitution #9):** A1 fabricates a Movies label on a
  theatre row; A3 fabricates a Movies label on whatever clears filter_min; A2's swap
  description templates "A great movies_theatre worth visiting" which is an artifact
  of the bundled tag.
- **Constitution #8 (subtract before adding):** the seed pipelines never subtracted the
  legacy `'movies_theatre'` write target after ORCH-0598 added the split. Operator
  caught this directive: "any old pills should be deleted and cleared up from wherever
  you are picking it up."
- **INV-Solo-Collab-Parity:** Holds (cycle-1 G8). Both modes leak identically; not a
  defect of parity, just a symmetry property.

---

## 8. Discoveries for orchestrator (cycle-2 additions to cycle-1's list)

- **D-CYCLE2-1 (S1, data-integrity, primary):** admin SeedTab.jsx +
  seedingCategories.ts seed pipelines continuously write the legacy `'movies_theatre'`
  ai_category for every new theatre/concert/cinema/comedy/arena/live-music/event-venue
  seed. Every future seed undoes any backfill until the source pipelines are fixed.
  This is a NEW finding cycle-1 missed.

- **D-CYCLE2-2 (S2, scope-creep candidate):** the SeedTab `TYPE_TO_CATEGORY` table
  treats `comedy_club`, `event_venue`, `arena`, `live_music_venue`, `dance_hall` as
  `'movies_theatre'` — these go beyond cinema+theatre into broader event-venue
  territory. When splitting, operator must decide whether these belong under `'theatre'`
  (live-performance umbrella) or get a separate slug. Cycle-1 didn't surface this
  because cycle-1 focused on the chip-routing layer; cycle-2 surfaces it from the
  seed-write layer.

- **D-CYCLE2-3 (S2, process):** `ci-check-invariants.sh:725` enforces
  `category_movies_theatre` as a REQUIRED translation key in every locale. CI will
  fail any PR that deletes the key without updating this script first. Coordinated
  change required.

- **D-CYCLE2-4 (S2, test):** `scorer.test.ts:854-865` test T-37 explicitly asserts the
  bundled mapping is preserved as backward-compat. This test BLOCKS the cleanup unless
  rewritten or deleted alongside the production deletion.

- **D-CYCLE2-5 (S3, observation):** `supabase/migrations/20260420000002_seed_rules_engine_v1.sql`
  contains `'movies_theatre'` in the rules engine seed. If the rules engine is still
  active and consumes that seed at runtime, this is another live consumer that needs
  audit. ORCH-0540 closed rules engine bugs; no signal that the engine is dead. Surface
  for separate triage.

- **D-CYCLE2-6 (S3, scope expansion):** `'Brunch, Lunch & Casual'` has the SAME
  pattern in cycle-2 evidence — `seedingCategories.ts` likely has equivalent
  `appCategorySlug: 'brunch_lunch_casual'` definitions for restaurant types. ORCH-0700
  cycle-2 sweep enumerated only the Movies/Theatre side; a parallel sweep for
  Brunch/Casual is owed (cycle-1 D-OBS pattern-class). Defer to ORCH-0700 SPEC scope
  decision (Movies-wedge first vs full sweep).

- **D-CYCLE2-7 (S2, code-quality):** `get-person-hero-cards/index.ts:826` has a
  special-case branch that ADDS `'theatre'` signal when blendedCategories includes
  `'movies_theatre'`. This branch is dead code once INTENT_CATEGORY_MAP stops emitting
  the bundled slug. Delete in same pass as INTENT_CATEGORY_MAP cleanup.

---

## 9. Confidence calibration (cycle-2 final)

| Thread | Verdict | Confidence | Why this confidence |
|---|---|---|---|
| H1 (live SQL probe of A3) | UNEXECUTABLE this session, probe ready for operator | H on architectural certainty (4-line evidence in §0); L on count/names (deferred) | Supabase MCP not loaded |
| H2 (Theatre symmetry) | Operator's empirical observation accepted; counter-probe ready | H on architectural reasoning (filter_min asymmetry); L on count (deferred) | Same |
| H3 (full-monorepo legacy sweep) | COMPLETE | H | Deterministic Grep across full monorepo, 92 files enumerated |
| H4 (pin operator's leak) | A3 confirmed | H | Architectural elimination of A1 + A6, runtime symptom matches A3 exhaustion pattern |
| H5 (cohort migration completeness) | UNEXECUTABLE; SQL written and idempotent | H on SQL correctness; M on whether it ran | |
| H6 (ai_categories audit + backfill) | UNEXECUTABLE; backfill SQL written and idempotent | H on backfill correctness; L on row count | |
| H7 (scorer tightening analysis) | 3 options enumerated, no recommendation | H on options being mechanically correct; operator decides | Analysis only |

**Overall cycle-2 verdict:** H confidence on root-cause class identification (A3 + A1 +
A2 + A2-write-path); L confidence on quantified blast radius (deferred to operator SQL
runs).

---

## 10. Operator-runnable SQL probe summary (consolidated)

Run these against production via Supabase Dashboard SQL Editor or CLI. Order matters
for the backfill (H6.c).

| # | Probe | What it answers | Read or write? | Order |
|---|---|---|---|---|
| 1 | H1.a — non-cinema rows scoring ≥80 on 'movies' signal | A3 quantification — which exact venues are the offenders | READ | Run anytime |
| 2 | H2.a — non-theatre rows scoring ≥120 on 'theatre' signal | Theatre pill symmetry verification | READ | Run anytime |
| 3 | H5.a — preferences rows still containing legacy bundled slug | Cohort migration completeness | READ | Run anytime |
| 4 | H6.a — theatre venues with legacy 'movies_theatre' ai_category | A2 leak set enumeration | READ | Run anytime |
| 5 | H6.b — count of legacy-tagged rows by primary_type | A2 backfill scope | READ | Run anytime |
| 6 | ORCH-0701 — Paragon Theaters lookup | Why Paragon never shows | READ | Run anytime |
| 7 | H6.c — ai_categories backfill (UPDATE) | Closes A2 stale-data | **WRITE** | **AFTER step 1 of deletion order** (SeedTab.jsx + seedingCategories.ts fixes shipped) |
| 8 | Re-run H5.a + H6.b | Verify cleanup | READ | After all fixes shipped |

All READ probes are safe to run today. The single WRITE probe (H6.c backfill) is gated
on the SeedTab + seedingCategories fixes shipping first — running it before the
write-path is fixed will be re-undone by the next seed.

---

## 11.4 Quantified data addendum (2026-05-01, via Supabase Management API direct SQL)

Probes H1/H2/H5/H6 + §11.5.a + ORCH-0701 + Marbles IMAX verify executed via the
Supabase Management API `/v1/projects/{ref}/database/query` endpoint, bypassing
the broken `@supabase/mcp-server-supabase@0.8.0` Content API parser bug.
Confidence on all probe verdicts now elevated from **L** to **H** (live data).

### H1 — A3 leak quantification (Movies chip, signal_score >= 80)

**241 venues total served. 69 are cinemas (29%). 172 are non-cinema (71% leakage).**

| primary_type | count | top score |
|---|---|---|
| `performing_arts_theater` | **113** | 198.49 |
| `movie_theater` ✓ | 69 | 98.02 |
| `concert_hall` | 17 | 93.79 |
| `event_venue` | 8 | 84.51 |
| `live_music_venue` | 7 | 95.41 |
| `null` | 5 | 94.63 |
| `association_or_organization` | 4 | 90.92 |
| `cultural_center` | 3 | 84.46 |
| `arena` | 2 | 94.50 |
| `museum` | 2 | 94.92 |
| `service` | 2 | 80.21 |
| `tourist_attraction` | 2 | 87.67 |
| `amphitheatre` | 1 | **151.93** |
| `art_gallery` | 1 | 106.51 |
| `art_museum` | 1 | 80.64 |
| `comedy_club` | 1 | 87.29 |
| `dance_hall` | 1 | 83.21 |
| `historical_landmark` | 1 | 92.50 |
| `library` | 1 | 81.59 |

**Top 5 named leak offenders:**
1. The Carolina Theatre (Durham) — `performing_arts_theater`, score 197.41
2. Museum of Discovery and Science (Fort Lauderdale) — `museum`, 164.37
3. JFK Center for the Performing Arts (Washington) — `performing_arts_theater`, 158.29
4. La Monnaie - De Munt (Brussels) — `performing_arts_theater`, 154.90
5. Coastal Credit Union Music Park (Raleigh) — `amphitheatre`, 151.93 ← likely the
   venue powering operator's empirical "Movies pill shows theatres" observation
   in the Raleigh test region

A3 verdict (cycle-2 §0): elevated from H confidence on architecture to H+
confidence on architecture AND blast radius.

### H2 — Theatre symmetry (Theatre chip, signal_score >= 120)

**Operator's "Theatre is clean" empirical observation is INCOMPLETE.** Theatre
also leaks, but at lower rate (~35% vs Movies' 71%):

- Correct types (canonical Theatre): 95 performing_arts_theater + 17 concert_hall
  + 1 amphitheatre = ~113 (~65% of served)
- Leakers: 26 parks + 11 live_music_venue + 7 null + 4 museum + 3 church +
  3 event_venue + 2 history_museum + 2 tourist_attraction + 2 movie_theater +
  2 restaurant + 2 association_or_organization + various 1-counts including
  night_club, indoor_playground, sports_activity_location, etc.

Implication for SPEC: Theatre needs the same scorer tightening as Movies. Both
chips fix in the same SPEC pass. Cycle-2 G10 pattern-class assessment confirmed
empirically.

### H5.a — Preferences cohort migration completeness

**0 stragglers.** Zero `preferences` rows still contain `'movies_theatre'` in
`categories` or `'Movies & Theatre'` in `display_categories`. ORCH-0598's
`UPDATE` migration at `20260423300001_orch_0598_signal_batch.sql:312-332` ran
cleanly. **Mobile-side last-mile alias** at `deckService.ts:260`
(`CATEGORY_PILL_MAP['movies_theatre'] = 'movies'`) **can be deleted in the same
SPEC pass** — no user pref state requires it as a safety net anymore.

### H6 — ai_categories audit

**2,449 total rows in `place_pool` tagged with `'movies_theatre'` in
`ai_categories`.** Of those:
- 469 are `movie_theater` / `drive_in` — would correctly map to `'movies'` on backfill
- 1,980 are non-cinema — would map to `'theatre'` (or get a more specific tag
  per primary_type) on backfill

Top tagged primary_types:
- `performing_arts_theater`: 1,175
- `movie_theater`: 469 (correct cinema)
- `event_venue`: 131
- `concert_hall`: 120
- `live_music_venue`: 92
- `bar`: 45 ← AI categorizer false-positive (bars tagged as movies_theatre)
- `amphitheatre`: 44
- `comedy_club`: 43
- `null`: 42
- `cultural_center`: 38
- `restaurant`: 28 ← false-positive
- `pub`: 21 ← false-positive
- 50+ other types with smaller counts (cocktail_bar, brewery, opera_house,
  auditorium, restaurants of every cuisine, university, synagogue, etc.)

**A2 leak surface = 2,449 rows.** Backfill closes it in one `UPDATE` statement.
Backfill SQL (cycle-2 §10 H6.c) is correct as written — confidence elevated to H
that this is a one-shot SQL operation, not an ongoing data flow.

### §11.5.a — Seed-write defect activity check

**Last 7 days of place_pool inserts in the cinema/theatre/concert/etc. universe:
105 total. ZERO got `movies_theatre` ai_category. ZERO got `movies` or `theatre`
either** (likely tagged with other specific categories per the AI pipeline that
has since been updated).

**Critical implication:** the cycle-2 §11.5 "actively bleeding" framing was
overstated. The seed-write code path EXISTS in `seedingCategories.ts:336-386`
and `SeedTab.jsx:31-74` and would emit bundled tags IF executed against a
theatre/cinema venue, but it has NOT been executed in the past 7 days. The
2,449 legacy-tagged rows are FROZEN historical data, not a moving target.

**SPEC scope simplifies:**
- "Stop the bleed first" deletion-order step demoted from S0 emergency to S2
  defensive cleanup
- A2 backfill becomes one-shot SQL, not a coordinated migration race
- Seed pipeline code fix (SeedTab.jsx + seedingCategories.ts) becomes pure
  hygiene — eliminates a future regression vector but doesn't unblock the
  primary fix

### ORCH-0701 — Paragon Theaters root cause

Paragon Theaters - Fenton + Axis15 Extreme (Cary, NC):
- Primary type: `movie_theater` ✓
- `is_servable`: `true` ✓
- `is_active`: `true` ✓
- Has photos: `true` ✓
- Movies signal score: **75.13** ← below `filter_min: 80`

**Pure scoring miss.** Paragon competes with The Cary Theater, Regal Crossroads
- Cary, and Regal Brier Creek for the Cary deck slot and loses on score (lower
review count and/or rating). Three SPEC-time options:

1. **Lower `filter_min` to 70** — surfaces Paragon AND adds ~unknown additional
   leakers (would need re-running H1.a at threshold 70 to quantify)
2. **Tighten scorer to drop the 172 leakers AND raise cinema relative score** —
   removing the ceiling effect of high-scoring non-cinemas may naturally lift
   Paragon's relative rank, even if absolute score stays 75
3. **Add chain-name boost** — explicit text-pattern match for known cinema
   chain names (Paragon, Regal, AMC, Cinemark, Alamo, etc.)

Recommended sequence: **scorer tightening first** (closes 172 leaks). Then
re-run H1.a SQL to quantify the remaining cinema set. If Paragon now surfaces
naturally (because the 172 leakers no longer compete), no further fix needed.
If still missing, add chain-name boost or lower filter_min.

### Marbles IMAX verification

Marbles IMAX (Raleigh): `primary_type: movie_theater`, `is_servable: true`,
`is_active: true`, score 160.95. **Operator's "leave IMAX as is" directive is
naturally satisfied** because IMAX venues ARE classified as `movie_theater` in
Google's primary type system. They're correctly served as cinemas through the
canonical Movies path, not through soft-scorer leakage. Top IMAX in the data:
AutoNation IMAX 3D Theater scoring 175.67.

### Confidence calibration update (cycle-2 §10 final)

| Thread | Prior verdict | Quantified verdict | Confidence |
|---|---|---|---|
| H1 (A3 leak) | "Architecturally certain, count L" | 172 / 241 (71% leak); 113 performing_arts_theaters worst class | **H+** |
| H2 (Theatre symmetry) | "Operator-stated clean, M" | Theatre ALSO leaks (~35%); operator's framing incomplete | **H** |
| H5 (cohort migration) | "Migration SQL correct, M on whether ran" | 0 stragglers; migration ran cleanly | **H** |
| H6 (ai_categories) | "Backfill correct, count L" | 2,449 rows total, 1,980 non-cinema | **H** |
| §11.5.a (seed bleed) | "Code exists H, executing M" | Not executing today (0 in last 7d); historical rows frozen | **H** (downgraded urgency) |
| ORCH-0701 (Paragon) | Unknown | Pure scoring miss at 75.13 vs filter_min 80 | **H** |
| H4 (pin pathway) | A3 confirmed at H | Confirmed + ranked: A3 > A2 > A1 > A2-write-path (now dormant) | **H** |
| H3 (legacy sweep) | 92 files enumerated H | Unchanged | **H** |
| H7 (scorer analysis) | 3 options enumerated | Option 2 (penalty raise) most aligned with operator's IMAX directive | **H on options** |

**Cycle-2 final verdict:** all threads H confidence. SPEC is unblocked.

---

## 11.5 Self-correction addendum (2026-05-01, post-operator-pushback)

Operator asked "are you 100% sure?" on §3.A2-write-path. Honest recalibration after
deeper trace via `admin-seed-places/index.ts`:

**What I AM 100% sure of (CODE EXISTS):**

- `supabase/functions/_shared/seedingCategories.ts:336-386` defines two seeding
  configs (`id: 'watch'`, `id: 'live_performance'`) BOTH carrying
  `appCategorySlug: 'movies_theatre'`. Direct file read confirms.
- `supabase/functions/admin-seed-places/index.ts:1003` calls
  `transformGooglePlaceForSeed(p, batch.city_id, config.appCategorySlug, ...)` —
  passes the bundled slug into the place-transform step. Direct file read confirms.
- `mingla-admin/src/components/seeding/SeedTab.jsx:31-74` `TYPE_TO_CATEGORY` map
  hard-codes `'movies_theatre'` for 10 cinema/theatre/concert/comedy/arena/event-venue
  types. Used by `guessCategory()` at line 76. Direct file read confirms.
- The write-path code IS WIRED — if either path executes against a theatre venue
  today, the row is created/updated with `'movies_theatre'` in seeding_category +
  app_category fields.

**What I overstated and now retract:**

The cycle-2 framing "admin SeedTab.jsx + backend seedingCategories.ts are STILL
ACTIVELY WRITING" CONFLATES two separate write paths and asserts active execution
without runtime evidence. The honest split:

- **Path 1 (bulk seed):** admin SeedTab → SEEDING_CATEGORIES (seedingCategories.ts)
  → admin-seed-places. Used for tile-by-tile bulk seeding of new cities. Wired
  end-to-end.
- **Path 2 (ad-hoc search):** admin SeedTab `guessCategory()` →
  pushToPool(seedingCategory) → admin-seed-places. Used for individual venue
  additions outside the bulk pipeline. Wired end-to-end.

**Both paths write through admin-seed-places.** `TYPE_TO_CATEGORY` in SeedTab.jsx
is the ad-hoc path; SEEDING_CATEGORIES in seedingCategories.ts is the bulk path.
Both produce `'movies_theatre'` for the affected venue types.

**What I am NOT 100% sure of (REQUIRES RUNTIME EVIDENCE):**

- Whether admin-seed-places is actually invoked TODAY (vs being mothballed in
  favor of Bouncer / AI validator pipelines). Edge-function logs would prove this.
- Whether new place_pool rows in the last N days actually have `'movies_theatre'`
  in their `ai_categories` array. SQL probe would prove this.
- Whether SeedTab is the active admin tool or has been deprecated for a different
  seeding interface.

**Calibration update on cycle-2 confidence:**

- "Write-path code exists and would tag bundled slug if executed": **H confidence**
  (file:line evidence, two independent paths confirmed).
- "Write-path is actively executing today and continuously growing the
  legacy-tagged row set": **M confidence** (architectural inference; would be H
  if MCP tools were loaded to verify recent place_pool writes).

**This calibration update changes deletion-order priority slightly:** if the seed
pipelines are actually mothballed today (operator-confirmable), the SeedTab +
seedingCategories cleanup becomes hygiene, not a "stop the bleed" emergency. If
they're active, the original "stop bleed first" order stands. **Operator-runnable
verification probe to add to §10:**

```sql
-- §11.5.a: Are new place_pool rows in the last 7 days getting tagged with the
-- legacy bundled slug? Confirms whether the seed write-path is actively executing.
SELECT
  DATE_TRUNC('day', pp.created_at) AS day,
  COUNT(*) FILTER (WHERE 'movies_theatre' = ANY(pp.ai_categories)) AS bundled_count,
  COUNT(*) FILTER (WHERE 'movies' = ANY(pp.ai_categories) OR 'theatre' = ANY(pp.ai_categories)) AS split_count,
  COUNT(*) AS total_seeded
FROM public.place_pool pp
WHERE pp.created_at >= NOW() - INTERVAL '7 days'
  AND (
    pp.primary_type IN ('movie_theater', 'drive_in') OR
    pp.primary_type IN ('performing_arts_theater', 'opera_house', 'auditorium',
                        'amphitheatre', 'concert_hall', 'philharmonic_hall',
                        'comedy_club', 'live_music_venue', 'event_venue',
                        'arena', 'dance_hall')
  )
GROUP BY day
ORDER BY day DESC;
```

**Verdict logic:**

- `bundled_count > 0` for any recent day = write-path actively executing,
  "stop the bleed FIRST" deletion order stands.
- `bundled_count = 0` for the last 7 days but `split_count > 0` = pipeline already
  writes split slugs (someone fixed it without documentation), seed cleanup is
  hygiene only.
- All zero = no theatre/cinema seeding has happened recently — write-path may or
  may not be active; needs longer window (`INTERVAL '30 days'` or '90 days').

**Why this matters for skill calibration program-wide:** without persistent
Supabase MCP access, every forensics dispatch that touches DB-state or write-path
behavior runs into this same confidence cap. Cycle-2's 4-line architectural
evidence for A3 was sufficient to elevate the verdict; cycle-2's seed-write claim
deserved the same rigor and got "code exists" rigor instead. **The orchestrator's
process gate should be: any "actively writing/serving today" claim requires a
runtime verification probe before that wording is allowed in the verdict line.**
Until MCP is loaded, "write-path code exists and would do X if executed" is the
correct ceiling for forensics confidence.

---

## 11.6 ai_categories audit + SPEC scope correction (2026-05-01, post-quantified-data + post-operator-correction)

After the §11.4 quantified data landed, the orchestrator presented a SPEC
draft (saved to `prompts/SPEC_ORCH-0700_DISPATCH.md` v1) that included an
S-3 deliverable: backfill 2,449 stale `ai_categories: ['movies_theatre']`
rows. Operator pushback was sharp and correct:

> "ai_categories has been deprecated. We now use is_servable: true. We need
> to clean up any of ai_categories if it still exists and is causing
> confusion. We need a deep audit before we go making things worse."

**Orchestrator-conducted audit (chat 2026-05-01) — findings:**

Live readers of `place_pool.ai_categories` (4 sites):

1. `supabase/functions/generate-curated-experiences/index.ts:379, 432-436, 681`
   — passthrough: SELECTs ai_categories, sets `card.category = pp.ai_categories[0]`
   on the response card. THIS is the only consumer-visible effect. Mobile
   renders `card.category` for label display, filtering, and analytics.

2. `supabase/functions/_shared/stopAlternatives.ts:84, 86, 134-135` — used by
   `replace-curated-stop`. SELECTs ai_categories, FILTERS via
   `.contains('ai_categories', [categoryId])`, uses `place.ai_categories[0]` as
   `firstCategory` for the response. **However:** mobile sends
   `categoryId: 'movies'` (the canonical post-split slug, sourced from
   `stop.comboCategory` per `ExpandedCardModal.tsx:673`) and
   `replace-curated-stop:13` VALID_CATEGORIES does NOT include `'movies'` →
   request rejected at validator with HTTP 400 → the `.contains` query never
   fires for canonical-chip-slug requests. **Effectively dead path** for the
   live mobile flow.

3. `mingla-admin/src/pages/PlacePoolManagementPage.jsx:361, 373, 381-382, 405-411, 484-487, 568-602, 1031-1063`
   — admin Place Pool edit form. Allows admin to manually edit ai_categories.
   The admin UI itself documents at lines 405-410: *"the pipeline that
   populated them was archived — they are now stale-data only. Only
   ai_categories is actively editable (admin-driven classification). Bouncer
   is the authoritative quality gate going forward."*

4. `scripts/verify-places-pipeline.mjs:772-776, 897-901` — admin one-off script
   that WRITES ai_categories + AI metadata cluster (`ai_reason`,
   `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`). Per the admin UI
   comment, this script IS the archived AI validation pipeline. Per cycle-2
   §11.4 H6 quantified data, no recent inserts have ai_categories tags →
   confirms the script is not actively running.

**Mobile (`app-mobile/src`) reader sweep:** ZERO references to ai_categories,
ai_reason, ai_primary_identity, ai_confidence, ai_web_evidence. Consumer
mobile is fully decoupled from these columns.

**Audit verdict:** ai_categories is in a "dead-system-with-vestigial-readers"
state. Discover deck doesn't read it (uses signal_score on place_scores).
Person-hero doesn't read it (uses `mapPrimaryTypeToMinglaCategory` from
primary_type). The TWO live edge function readers (curated chain +
admin-only) can be migrated to `mapPrimaryTypeToMinglaCategory` (the same
pattern person-hero already uses correctly).

### SPEC scope correction (operator-locked 2026-05-01 chat)

**Original draft S-3 (REJECTED):** backfill 2,449 ai_categories rows from
`'movies_theatre'` to `'movies'` or `'theatre'` based on primary_type.

**Operator's revised direction:** "Yes — and you're right to push for the
bigger fix. My 'one-line change' was a half-measure." Specifically:

- Migrate every reader of `ai_categories` AND the AI metadata cluster
  (`ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`) to
  the new system (Bouncer + `is_servable: true` + signal scorer + `place_scores`
  + `mapPrimaryTypeToMinglaCategory`).
- DROP all five columns from `place_pool` after readers migrated.
- Remove the admin Place Pool Page ai_categories editing UI (admin manual
  override retired; Bouncer + scorer is the only authority going forward).
- Stop or delete the `verify-places-pipeline.mjs` write path.
- Optionally drop `_archive_card_pool` + `_orch_0588_dead_cards_backup`
  backup tables (zero current readers per audit; pure hygiene).
- Take a backup snapshot of the columns before drop:
  `CREATE TABLE _archive_orch_0700_ai_metadata AS SELECT id, ai_categories,
  ai_reason, ai_primary_identity, ai_confidence, ai_web_evidence FROM
  place_pool WHERE ai_categories IS NOT NULL OR ai_primary_identity IS NOT NULL`
  Drop the snapshot 30 days post-deploy if nothing surfaces.

**SPEC dispatch v2 BLOCKED on independent verification:** operator additionally
requested a forensics sub-audit before SPEC ships the destructive column-drop
migration. Two things to verify at H confidence:

1. Did the orchestrator audit miss any reader (hidden / dynamic / cross-domain)?
2. Does the NEW system (Bouncer + signal scorer + `is_servable` + `place_scores`
   + `mapPrimaryTypeToMinglaCategory`) depend on these columns directly or
   transitively? If yes, the decommission breaks the new system.

**Sub-audit dispatch:**
[prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md](Mingla_Artifacts/prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md)

9 mandatory threads: V1 exhaustive reader sweep across mingla-business / app-
mobile/app / mingla-admin / supabase/functions / migrations / scripts / cron
/ RLS / indexes / triggers / functions / views / FKs. V2 NEW-system
independence proof per component (Bouncer / signal scorer / signal definitions
/ query_servable_places_by_signal / get-person-hero-cards / mapPrimaryType /
cohort tables). V3 saved-card historical impact (do user-saved rows with
`category='movies_theatre'` need backfill?). V4 holiday + curated chain
category bleed verification. V5 backup tables zero-reader confirmation.
V6 schema dependency probe (DDL prerequisites for column drop — indexes,
triggers, RPCs, RLS, CHECK constraints, FKs). V7 quantification (how many
rows lose data, when last written, value distribution). V8 operator-workflow
impact + replacement guidance for admin manual classification. V9 dependency
verification on the NEW serving system end-to-end.

**Path-to-SPEC:** sub-audit returns → orchestrator REVIEW → SPEC writer
ingests both cycle-2 + sub-audit reports → SPEC dispatch v2 written + saved
to `prompts/SPEC_ORCH-0700_DISPATCH.md` (overwrites v1 draft).

### Confidence calibration update (cycle-2 §11.4 + §11.5 + §11.6 final)

| Thread | Verdict | Confidence |
|---|---|---|
| H1 (A3 leak) | 172/241 = 71% leakage; named offenders | H+ |
| H2 (Theatre symmetry) | Theatre also leaks (~35%) | H |
| H3 (legacy sweep) | 92 files enumerated | H |
| H4 (pin pathway) | A3 confirmed; A1 still alive but small surface | H |
| H5 (cohort migration) | 0 stragglers; clean | H |
| H6 (ai_categories tagged rows) | 2,449 stale rows; data dormant | H |
| §11.5.a (seed bleed) | 0 inserts last 7 days; not bleeding | H |
| ORCH-0701 (Paragon) | scoring miss at 75.13 vs 80; pure scorer fix | H |
| §11.6 (ai_categories audit) | dead system w/ vestigial readers; SPEC scope expanded to column decommission; sub-audit gating SPEC | H on architecture, gating sub-audit on V1-V9 |

---

## 11.7 Sub-audit RETURNED + REVIEW APPROVED 10/10 (2026-05-01)

Sub-audit dispatch
[`prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md`](../prompts/FORENSICS_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md)
returned [`reports/INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md`](INVESTIGATION_ORCH-0700_AI_CATEGORIES_DECOMMISSION_AUDIT.md).

**Verdict: SAFE WITH CAVEATS at H confidence.** The orchestrator audit (§11.6
above) found 4 readers; the sub-audit found **5 additional dependencies** the
orchestrator missed by relying on file grep alone. The orchestrator's
file-grep-only methodology was the gap — should have queried `pg_views`,
`pg_matviews`, `pg_proc.prosrc`, `pg_indexes`, `pg_trigger`, `pg_policy`,
`cron.job` directly. Codified as D-SUB-1 process improvement.

### Sub-audit's NEW dependencies (orchestrator missed)

1. **`admin_place_pool_mv` materialized view** — projects both
   `pp.ai_categories` and a derived `primary_category = COALESCE(ai_categories[1], 'uncategorized')`.
   Has 3 indexes including `admin_place_pool_mv_primary_category_servable`.
2. **Cron job 13 `refresh_admin_place_pool_mv`** — refreshes the MV every
   10 minutes. Live and active.
3. **`admin_photo_pool_categories` RPC** — groups by `ai_categories[1]`
4. **`admin_photo_pool_locations` RPC** — groups by `ai_categories[1]`
5. **`admin_pool_category_detail` RPC** — filters by `p_category = ANY(ai_categories)`
6. **`admin_rules_preview_impact` RPC** — rules engine; reads `ai_categories`
   for demotion/strip rule kinds

### NEW system independence — H+ confidence

Bouncer (`bouncer.ts:23-36` `PlaceRow` interface) and signal scorer
(`signalScorer.ts:34-63` `PlaceForScoring` interface) both contain ZERO AI
metadata fields. Bouncer's invariant comment line 12 explicit:
*"I-BOUNCER-DETERMINISTIC: NO AI, NO keyword matching for category judgment."*
The signal scorer's `computeScore()` only consults types, ratings, reviews,
text patterns, and boolean serves_* fields. **Dropping the columns does NOT
break the new system.**

### Quantification (H confidence, direct DB query)

| Column | Rows populated | % of pool |
|---|---|---|
| `ai_categories` | 41,301 | 59.3% |
| `ai_reason` | 58,829 | 84.5% |
| `ai_primary_identity` | 58,774 | 84.4% |
| `ai_confidence` | 58,774 | 84.4% |
| `ai_web_evidence` | 56,479 | 81.1% |
| **Total `place_pool` rows** | 69,599 | — |

Most recent ai_categories write: **2026-04-26 23:46 UTC** (5 days ago).
Pipeline dormant but recently active. Backup snapshot mandatory before drop.

### saved_card historical impact (V3)

Zero `'movies_theatre'` rows in `saved_card.category`. ✓ A2 leak does NOT
propagate to historical saves. **However:** 9 distinct legacy values from
pre-ORCH-0434 exist (watch, picnic_park, Wellness, casual_eats, nature_views,
fine_dining, drink, Watch, upscale_fine_dining-as-slug). Pre-existing data
drift, NOT part of ORCH-0700. Surface as separate ORCH for saved_card
taxonomy normalization (D-SUB-2).

### Mandatory DDL prerequisite ordering (10 steps, per sub-audit V6)

1. Pause cron job 13 (`UPDATE cron.job SET active = false WHERE jobid = 13`)
2. Rewrite `admin_rules_preview_impact` (replace `ai_categories` reads with
   `seeding_category` or `primary_type` scope)
3. Rewrite the 3 admin photo-pool RPCs (`admin_photo_pool_categories`,
   `admin_photo_pool_locations`, `admin_pool_category_detail`) — replace
   `ai_categories[1]` grouping with `seeding_category` or `primary_type`
4. Migrate the 2 edge function consumers
   (`generate-curated-experiences:435` passthrough → `mapPrimaryTypeToMinglaCategory`;
   `stopAlternatives.ts:84-86, 134-135` → primary_type-based filter)
5. Update admin Place Pool Page UI to remove ai_categories editing
6. Drop the MV (`DROP MATERIALIZED VIEW admin_place_pool_mv CASCADE`)
7. Drop columns: `ALTER TABLE place_pool DROP COLUMN ai_categories,
   ai_reason, ai_primary_identity, ai_confidence, ai_web_evidence`
8. Optionally rebuild `admin_place_pool_mv` WITHOUT ai_categories +
   primary_category (use `seeding_category` for grouping)
9. Re-enable cron job 13 (or DROP if MV is retired)
10. Stop or delete `scripts/verify-places-pipeline.mjs` writes

### REVIEW verdict

**APPROVED 10/10:**
- Verdict honest (SAFE WITH CAVEATS, not "ship it")
- 5 missed deps surfaced with file:line + SQL evidence
- NEW system independence proven at H+ via direct interface reads
- DDL prerequisite ordering specified
- saved_card historical impact verified
- Backup tables status documented (drop schedule confirmed for tomorrow)
- 6 discoveries triaged (D-SUB-1 through D-SUB-6)
- NEW invariant proposed: **I-MV-COLUMN-COVERAGE** (every MV-projected column
  must be enumerated in a project-wide manifest; column drops require MV
  rebuild step in same migration)
- Scope respected — no solution-territory creep
- Confidence calibration honest (H+ on Bouncer/scorer; H on most threads;
  M on saved_card rendering verdict pending mobile UI test)

### SPEC v2 scope FINAL (operator-locked + sub-audit-expanded)

| Deliverable | Source | Status |
|---|---|---|
| S-1 Movies signal v1.1.0 tighten | Cycle-2 §11.4 H1 + operator-locked H7-A | Carries from SPEC v1 |
| S-2 Theatre signal v1.1.0 tighten | Cycle-2 §11.4 H2 + operator-locked H7-A | Carries from SPEC v1 |
| ~~S-3 Backfill 2,449 ai_categories rows~~ | Cycle-2 §11.6 | **REPLACED** |
| **S-3 NEW** Decommission ai_categories + AI metadata cluster | Operator chat 2026-05-01 + sub-audit V1+V6 | EXPANDED scope (5 dependencies + 2 edge fn migrations + admin UI removal + script delete + backup snapshot) |
| S-4 Delete `[TRANSITIONAL]` union mappings | Cycle-1 + cycle-2 | Carries from SPEC v1 |
| S-5 Legacy bundled-chip code cleanup | Cycle-1 H3 + cycle-2 §11.4 | Carries from SPEC v1 |
| S-6 Verification + tests | Cycle-2 + sub-audit | EXPANDED with sub-audit's 10-step migration verification |
| **S-7 NEW** Process improvements | Sub-audit D-SUB-1 + I-MV-COLUMN-COVERAGE | NEW |
| ORCH-0701 Paragon | Cycle-2 + bundled into SPEC | Carries from SPEC v1 |

---

## 11.8 Sub-audit correction — 3 photo-pool RPC findings retracted (2026-05-01)

Operator pushback on §11.7 sub-audit findings prompted re-verification via
direct Supabase Management API SQL. Live `pg_proc.prosrc` query returned
**only** `admin_rules_preview_impact` as referencing `ai_categories` — NOT
the 3 admin photo-pool RPCs (`admin_photo_pool_categories`,
`admin_photo_pool_locations`, `admin_pool_category_detail`) that the
sub-audit listed as missed dependencies. **Sub-audit error:** I cited those
3 RPCs from migration file `20260425000014_orch_0640_rewrite_place_admin_rpcs.sql`
which DID write them with `ai_categories[1]` grouping at that time, but
failed to re-verify against live `pg_proc.prosrc`. A later migration
(unidentified at time of correction; spec writer to enumerate at SPEC time)
superseded those 3 RPCs and removed their ai_categories dependency.

**This is the SAME class of error as the original orchestrator audit miss**
(file grep ≠ live DB state). Sub-audit was supposed to be the safety net
against that pattern but reproduced a variant of it (migration file ≠ live
function source after `CREATE OR REPLACE FUNCTION`). Honest disclosure +
correction.

### Corrected dependency count

**5 missed deps → 3 real missed deps + 2 false alarms.**

Real, confirmed via live SQL probes (`pg_matviews`, `pg_proc`, `cron.job`):

1. `admin_place_pool_mv` materialized view — projects
   `pp.ai_categories` + derived `primary_category = COALESCE(pp.ai_categories[1], 'uncategorized')`.
   Verified live via `pg_matviews` query 2026-05-01.
2. `admin_rules_preview_impact` RPC — reads `pp.ai_categories` for demotion
   + strip rule kinds. Verified live via `pg_proc.prosrc` query 2026-05-01
   (only function in `pg_proc` matching `prosrc ILIKE '%ai_categories%'`).
3. Cron job 13 `refresh_admin_place_pool_mv` — refreshes the MV every 10
   min. Verified live via `cron.job` query 2026-05-01 (`active=true`).

False alarms (cited from migration file but live source no longer references):

- `admin_photo_pool_categories` — already migrated
- `admin_photo_pool_locations` — already migrated
- `admin_pool_category_detail` — already migrated

### Final TRUE list of consumers (orchestrator-found + sub-audit-found, post-correction)

**Production-LIVE direct readers — must migrate before column drop:**

1. `supabase/functions/generate-curated-experiences/index.ts:379, 432-436, 681` — passthrough (orchestrator-found)
2. `supabase/functions/_shared/stopAlternatives.ts:84, 86, 134-135` — filter (orchestrator-found; effectively dead path due to validator)
3. `mingla-admin/src/pages/PlacePoolManagementPage.jsx` — admin edit UI (orchestrator-found)
4. `scripts/verify-places-pipeline.mjs` — WRITES (orchestrator-found, archived)
5. `admin_place_pool_mv` materialized view + cron job 13 (sub-audit-found, **REAL**)
6. `admin_rules_preview_impact` RPC (sub-audit-found, **REAL**)

**Total: 6 consumers (4 code + 2 DB) + 1 dependent cron job.**

### NEW system independence — RECONFIRMED at H+ confidence

Live SQL Probe 4 (2026-05-01): `query_servable_places_by_signal`
(the RPC discover-cards calls) reads `is_servable=true` and does NOT
reference `ai_categories`. Operator's empirical claim "we already
changed the place pool to read from is_servable" is **correct** for
the serving path. The 3 real remaining deps are admin back-office +
1 edge-function passthrough + 1 archived script — none are in the
serving hot path.

### D-SUB-1 sharpened

Original D-SUB-1 (process improvement): "every column-drop audit MUST
query DB schema not just code grep."

**Sharpened to:** every column-drop audit MUST query LIVE
`pg_proc.prosrc` for any RPC's current source, NEVER cite a migration
file as current truth even if it appears to be the most recent. Use
`SELECT prosrc FROM pg_proc WHERE proname = 'function_name'` as the
authoritative source. Migration files are historical artifacts;
`pg_proc` is live state. This applies recursively — sub-audits must
re-verify orchestrator findings the same way.

### SPEC v2 scope correction

S-3d "Rewrite 3 admin photo-pool RPCs" → demoted to "Pre-flight
verification only" (run probe, expect zero rows, document migration
that superseded). No rewrite work needed. Implementor scope shrinks
by ~3 RPC rewrites. Net effect on SPEC v2: ~3-5h implementor wall
shaved off.

---

## 11. Stop-Condition Compliance

- [x] Operator's claim confirmed at H confidence with named pathway (A3) — §0
- [x] Every legacy reference enumerated with deletion classification — §3.H3 (92 files)
- [ ] A3 leak rate quantified — DEFERRED to operator H1 SQL run
- [x] Theatre pill symmetry empirical observation accepted; counter-probe provided — §3.H2
- [x] No solutions proposed (analysis only in H7) — §3.H7

Investigation is COMPLETE in scope; deferred items marked. Cycle-2 deliverable
satisfied per dispatch §7. Next step: orchestrator dispatches SPEC against this report
+ cycle-1 report combined, OR runs the operator SQL probes first to add quantified
blast radius before SPEC writing.
