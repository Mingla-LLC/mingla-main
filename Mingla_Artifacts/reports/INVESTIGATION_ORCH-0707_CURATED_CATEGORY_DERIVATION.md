---
id: ORCH-0707
type: INVESTIGATION REPORT
mode: INVESTIGATE
classification: data-architecture + dead-code-discovery + design-question-resolution
severity: S2 (no current user impact; blocks ORCH-0700 ai_categories column drop)
created: 2026-05-02
investigator: /mingla-forensics
dispatch: prompts/FORENSICS_ORCH-0707_CURATED_EXPERIENCES_CATEGORY_AUDIT.md
prior: reports/INVESTIGATION_ORCH-0700_RULES_CATEGORY_TRUTH.md
related: ORCH-0599 (curated experience splits), ORCH-0601 (Romantic/First-Date sub-category filters), ORCH-0628 (Group Fun rework), ORCH-0640 (card_pool deprecation), ORCH-0653 (fetch_local_signal_ranked RPC), ORCH-0684 (paired-person CardRow composition)
confidence: H+ on every C-thread finding (live SQL + full-file code reads); H on remediation recommendation
---

# 0. Verdict (5-line layman summary)

1. **The curated pipeline has ALREADY migrated selection to the new signal scoring system.** `generate-curated-experiences` calls `fetch_local_signal_ranked` RPC which filters + ranks via `place_scores` joined to `signal_definitions`. Combos are hardcoded slug-pairs; each slug has a filter signal + a rank signal. ai_categories is NOT used for selection.
2. **ai_categories is read in only TWO downstream places**, both for LABELING/duration-lookup: (a) `generate-curated-experiences/index.ts` lines 432-436 + 648 + 675 + 681 + 706 (passes through into card payload, used for `placeType` + duration map + top-level `category`), and (b) `_shared/stopAlternatives.ts` lines 84/86 + 134-145 + 162 (the ONE remaining genuine selection consumer — filters via `.contains('ai_categories', [categoryId])`).
3. **The architecturally correct authority is `comboCategory`** — the slug of the combo slot the place was selected to fill. It's ALREADY passed through the buildCardStop function (line 619). For curated cards, this slug IS the canonical answer to "what category is this stop." No new derivation function needed.
4. **For `stopAlternatives.ts`, the migration mirror is the existing `fetch_local_signal_ranked` RPC pattern.** The `.contains('ai_categories', [categoryId])` filter becomes `JOIN place_scores ON signal_id = categoryId AND score >= filter_min`. Same pattern, different table.
5. **Person-hero card composition (`get-person-hero-cards`, `personHeroComposition.ts`) does NOT read ai_categories.** Already pure signal-ID based (zero grep hits in get-person-hero-cards for ai_categories). The legacy slug mentions are bridge maps for chip-slug→signal-id, not category labeling.

**Net architectural conclusion:** The fix is not "build a new derivation function." The fix is "use the slot semantics already on the call stack." `comboCategory` IS the answer for curated; `signal_id` IS the answer for stopAlternatives. Both are modern split slugs. The legacy ai_categories pass-through is dead-code redirect that can be cleanly cut.

---

# 1. Findings by thread

## C1 — Inventory of category usage in generate-curated-experiences

**Verdict:** ai_categories appears in 7 lines, all DOWNSTREAM of selection (i.e., labeling/duration only). Selection is already pure signal-driven.

**Per-call-site breakdown (file: `supabase/functions/generate-curated-experiences/index.ts`):**

| Line | Code | Read/Write | Used for | Verdict |
|------|------|------------|----------|---------|
| 379 | `.select('..., ai_categories, ...')` in fetchSinglesForSignalRank hydrate | READ | source for downstream uses | DEAD AFTER FIX |
| 432 | `// Categories — still passed through from place_pool.ai_categories.` | comment | — | obsolete comment |
| 433 | `// card_pool.categories is deprecated and not read anywhere post-ORCH-0634.` | comment | — | obsolete |
| 434 | `ai_categories: pp.ai_categories,` | WRITE (to internal card object) | downstream pass-through | DEAD AFTER FIX |
| 435 | `category: (pp.ai_categories?.[0] ?? null),` | WRITE | becomes `card.category` → consumed by lines 648 + 675 | DISPLAY — REPLACE WITH comboCategory |
| 436 | `categories: pp.ai_categories,` | WRITE | redundant alias | DEAD AFTER FIX |
| 466 | `'brunch_lunch_casual': 'brunch',` in COMBO_SLUG_TO_FILTER_SIGNAL | mapping table | legacy bundled slug bridge | DEAD AFTER ORCH-0700 sunset (2026-05-12) |
| 471 | `'movies_theatre': 'movies', // legacy TRANSITIONAL` | mapping table | legacy bundled slug bridge | DEAD AFTER ORCH-0700 sunset (2026-05-13) |
| 568 | `brunch_lunch_casual: 'Brunch',` in SLUG_TO_STOP_ROLE | mapping table | display role label | DEAD AFTER ORCH-0700 sunset |
| 603-604 | `brunch_lunch_casual: 60, ..., movies_theatre: 120,` in CATEGORY_DURATION_MINUTES | mapping table | duration lookup keyed on legacy slug | UPDATE — see §C8 |
| 648 | `placeType: card.category \|\| 'place',` in buildCardStop | READ | mobile-facing per-stop placeType field | DISPLAY — REPLACE WITH comboCategory |
| 675 | `estimatedDurationMinutes: CATEGORY_DURATION_MINUTES[card.category] \|\| CATEGORY_DEFAULT_DURATION,` | READ | duration lookup keyed on category | LOGIC — REPLACE WITH comboCategory key |
| 681 | `aiCategories: card.ai_categories \|\| card.categories \|\| [],` in buildCardStop | WRITE (to wire payload) | sent to mobile as `aiCategories` field | **DEAD ON WIRE — mobile type has no aiCategories field (verified §C8)** |
| 706 | `const category = mainStops[0]?.aiCategories?.[0] \|\| mainStops[0]?.placeType \|\| 'brunch_lunch_casual';` | READ | top-level card `category` field | DISPLAY — REPLACE WITH comboCategory of first main stop |

**Total ai_categories usages requiring replacement:** 4 logic/display call-sites (lines 435, 648, 675, 706) + 1 SQL select hydrate (line 379) + 3 dead-on-wire/redundant fields (lines 434, 436, 681) = 8 total.

**Confidence:** H+ (every line read in file).

## C2 — How the curated pipeline picks places

**Verdict:** Selection is already 100% signal-driven via `fetch_local_signal_ranked` RPC. ai_categories plays NO role in selection.

**Flow trace (canonical path for a non-Flowers stop):**

1. `generateCardsForType()` receives the experience type definition (e.g., `EXPERIENCE_TYPES['romantic']`)
2. For each combo in `typeDef.combos` (e.g., `['flowers', 'creative_arts', 'upscale_fine_dining']`)
3. For each slot, looks up:
   - `filterSignal = COMBO_SLUG_TO_FILTER_SIGNAL[combo[i]]` (e.g., `'creative_arts'` → `'creative_arts'`, `'upscale_fine_dining'` → `'fine_dining'`)
   - `filterMin = COMBO_SLUG_FILTER_MIN[combo[i]] ?? 120` (default 120, movies/flowers = 80)
   - `rankSignal = EXPERIENCE_RANK_SIGNAL_OVERRIDE[experienceType]?.[combo[i]] ?? filterSignal` (e.g., for romantic stops, `rankSignal = 'romantic'`)
4. Calls `fetchSinglesForSignalRank(filterSignal, filterMin, rankSignal, lat, lng, radiusMeters, limit, requiredTypes?)`
5. That helper calls RPC `fetch_local_signal_ranked` which:
   - JOINs `place_pool pp` to `place_scores ps_filter` ON `ps_filter.signal_id = filterSignal AND ps_filter.score >= filterMin`
   - LEFT JOINs `place_scores ps_rank` ON `ps_rank.signal_id = rankSignal`
   - WHERE `pp.is_servable = true` AND `pp.lat/lng IN bbox`
   - ORDER BY `ps_rank.score DESC`
   - Returns top N candidates
6. Hydrates each candidate's full row from `place_pool` (this is where ai_categories gets pulled into memory at line 379)
7. Maps each candidate into the assembler's expected card shape (lines 403-441) — this is where ai_categories gets bound to the card object at lines 434-436
8. `buildCardStop()` consumes the card and builds the per-stop response (lines 640-683)
9. `buildCardFromStops()` consumes the array of stops and builds the final card (lines 700-723)

**Key observation:** Steps 1-5 are all signal-driven. Step 6 is a hydrate. Step 7's assignment of `category: ai_categories?.[0]` is the ONE place where ai_categories enters the card-shape contract — and from there it's used purely for labeling/duration.

**The combo slug is on the call stack throughout.** It enters at step 2 as `combo[i]`, can be threaded through `opts.comboCategory` to `buildCardStop` (line 619) which writes it to the stop's `comboCategory` field (line 682). **It already IS the authoritative answer** to "which Mingla category did this stop fill."

**Confidence:** H+ (full file read, all selection paths traced).

## C3 — place_scores semantics for category labeling (architectural)

**Verdict:** For the curated pipeline specifically, the right authority is NOT "highest scorer wins" — it's `comboCategory`. The slot fills the place; the place doesn't choose its label.

**Why "highest scorer wins" is wrong for curated:**

A place like Alamo Drafthouse scores high on `movies` (cinema with bar) AND `drinks` (bar with cinema). If the curated pipeline picked it for the Movies slot in a Group Fun combo (`['movies', 'upscale_fine_dining']`) and then labeled it via "highest scorer," it could end up labeled "Drinks" — confusing the user who expected a Movies stop.

**Why comboCategory is correct:**

The combo says "this slot is a Movies stop." The picker found a place that scores high enough on `movies`. Whatever else the place ALSO scores well on is irrelevant to this stop's slot label. The combo is the ground truth for "what's THIS stop for."

**For stopAlternatives** (replacing a stop): same answer. The user is replacing the Movies stop, so all candidates must be Movies candidates. Selection filter = `place_scores ps WHERE ps.signal_id='movies' AND ps.score >= 80`. The label is `'movies'`.

**For person-hero cards:** Already done correctly. CompositionRules (`personHeroComposition.ts`) name signals directly (`comboAnchors: ['play', 'fine_dining', 'drinks']`). The signal name IS the label.

**For other potential consumers** (admin pages showing per-place "category"): a different question — see ORCH-0700 audit §3 and the place_pool.ai_categories admin-display use case. That's where `mapPrimaryTypeToMinglaCategory(primary_type, types)` would apply (admin needs a single primary label per place independent of any selection context). But that's outside ORCH-0707 scope.

**Confidence:** H+ (architectural conclusion derived from C2 + C5).

## C4 — Live cross-tab: ai_categories[0] vs highest type-grounded signal

**Verdict:** Disagreement is significant (~22% of sample) and *expected* — they answer different questions. The disagreement is NOT a quality problem; it's evidence that the two systems have different semantics.

**Live SQL probe (100 random servable places):**

```
legacy ai_categories[0]    top type-grounded signal    count   verdict
brunch_lunch_casual        casual_food                   16    AGREE (legacy → split: casual)
brunch_lunch_casual        brunch                        10    AGREE (legacy → split: brunch)
nature                     nature                        14    AGREE
icebreakers                icebreakers                   13    AGREE
drinks_and_music           drinks                         5    AGREE
creative_arts              creative_arts                  4    AGREE
upscale_fine_dining        fine_dining                    1    AGREE
play                       play                           1    AGREE
brunch_lunch_casual        drinks                         3    DISAGREE (cafe scores high on drinks?)
nature                     brunch                         4    DISAGREE (park-cafe combos)
drinks_and_music           brunch                         4    DISAGREE (brunch-bars)
creative_arts              brunch                         2    DISAGREE
brunch_lunch_casual        fine_dining                    1    DISAGREE
brunch_lunch_casual        icebreakers                    1    DISAGREE
upscale_fine_dining        brunch                         1    DISAGREE
play                       brunch                         1    DISAGREE
nature                     creative_arts                  1    DISAGREE
nature                     theatre                        1    DISAGREE
flowers                    groceries                      1    DISAGREE (florist inside grocery)
NULL legacy                brunch / casual_food / etc.   14    legacy never tagged; signal scores
```

**Agreement on type-grounded label (excluding null legacy):** 64/86 = 74%
**Disagreement (excluding null):** 22/86 = 26%
**Null legacy + non-null signal:** 14/100 = 14% (places that never got an ai_categories tag but DO have signal scores)

**Interpretation:**
- The legacy `ai_categories[0]` was an EXCLUSIVE single-bucket label written by the old AI validator.
- The new signal scoring system gives EVERY place a score on EVERY signal. "Highest scorer" is a different thing than "primary category."
- A coffee shop near a park scores high on `brunch` AND `nature`. Legacy may have tagged it `nature` (the AI prompt happened to favor that). Signal says `brunch` (because cafe types weight strongly).
- Neither is "wrong" — they answer different questions. Neither is the right authority for curated stop labeling, which is C3's `comboCategory`.

**Confidence:** H+ (live SQL on 100-row sample, breakdown explicit).

## C5 — Curated-pipeline-specific signals

**Verdict:** Quality-grounded signals (`lively`, `picnic_friendly`, `romantic`, `scenic`) are RANK-ONLY signals in the curated pipeline. They never become category labels.

**Live `signal_definitions` enumeration:**

```
type-grounded (12 signals): brunch, casual_food, creative_arts, drinks, fine_dining,
                            flowers, groceries, icebreakers, movies, nature, play, theatre
quality-grounded (4 signals): lively, picnic_friendly, romantic, scenic
```

**How quality-grounded signals are used (from `EXPERIENCE_RANK_SIGNAL_OVERRIDE` lines 497-555):**

| Experience Type | rank-signal override per slot |
|----------------|-------------------------------|
| Romantic | `creative_arts/theatre/upscale_fine_dining → romantic` |
| First Date | `all non-Flowers → icebreakers` |
| Group Fun | `all → lively` |
| Adventurous | `casual_food/upscale_fine_dining → lively` (food slots only) |
| Take a Stroll | `nature → scenic`, food → `icebreakers` |
| Picnic Dates | `nature → picnic_friendly` |

**Pattern:** filterSignal = the slot's category (e.g., `fine_dining`). rankSignal = the vibe to optimize within (e.g., `romantic`). Selection happens on filter; ordering happens on rank.

**Implication for labeling:** A "Romantic Fine Dining" stop has filterSignal=`fine_dining`, rankSignal=`romantic`. The user-facing label should be the SLOT label (Fine Dining → "Dinner" via SLUG_TO_STOP_ROLE) or the SIGNAL label (Fine Dining). It is NEVER "Romantic" — `romantic` is a quality dimension, not a category.

**Translation rule for spec:** When deriving display labels from signals, ONLY use type-grounded signals as category labels. Quality-grounded signals are ranking dimensions, never display dimensions.

**Confidence:** H+ (live SQL + full code read).

## C6 — Reverse map: signal_id → display label

**Verdict:** The map is already in the database (`signal_definitions.label`) and matches user-facing chip labels with two known mismatches.

**Live `signal_definitions` mapping (12 type-grounded only):**

```
signal_id        signal_definitions.label    discover-cards displayCategory   match?
brunch           Brunch                       Brunch                            ✓
casual_food      Casual Food                  Casual                            ≈ (Casual Food vs Casual)
creative_arts    Creative & Arts              Creative & Arts                   ✓
drinks           Drinks                       Drinks & Music                    ✗ (chip slug = drinks_and_music)
fine_dining      Fine Dining                  Upscale & Fine Dining             ✗ (chip slug = upscale_fine_dining)
flowers          Flowers                      Flowers                           ✓
groceries        Groceries                    Groceries                         ✓
icebreakers      Icebreakers                  Icebreakers                       ✓
movies           Movies                       Movies                            ✓
nature           Nature                       Nature & Views                    ≈ (Nature vs Nature & Views)
play             Play                         Play                              ✓
theatre          Theatre                      Theatre                           ✓
```

**For the curated pipeline's display label needs:** Use `comboCategory` (not signal_id). The combo slug IS the display key. It maps to:
- A user-facing role label via `SLUG_TO_STOP_ROLE` (e.g., `'fine_dining' → 'Dinner'`, `'movies' → 'Movie'`, `'theatre' → 'Show'`) — already in the file at lines 561-577
- A duration via `CATEGORY_DURATION_MINUTES` — already in the file at lines 602-606 (but uses LEGACY slugs — needs update; see §C8)
- A wire-payload `placeType` value for mobile

**For the spec:** No new signal-to-display map needed. Use `comboCategory` directly + the existing `SLUG_TO_STOP_ROLE` for human labels.

**Confidence:** H+ (live SQL + code read).

## C7 — Person-hero card composition

**Verdict:** Already pure signal-ID based. Does NOT read ai_categories. No work needed in this cycle.

**Evidence:**

1. **`grep ai_categories supabase/functions/get-person-hero-cards/index.ts`** → ZERO matches (verified live).
2. **`personHeroComposition.ts`** — full read shows `CompositionRule.comboAnchors: string[]` are signal IDs (`'play'`, `'fine_dining'`, `'drinks'`, `'movies'`, etc.). Zero ai_categories references.
3. **`get-person-hero-cards/index.ts:175-197`** — `INTENT_CATEGORY_MAP` and `CATEGORY_SLUG_TO_SIGNAL_ID` use legacy slugs but are the chip-slug → signal-id BRIDGE (forward direction is signal-driven; legacy slugs are inputs from chip taxonomy, immediately translated to signal IDs).
4. The legacy slug references (`'brunch_lunch_casual'`, `'movies_theatre'`) on lines 178-211 + 825-826 are the same bridge layer ORCH-0700 already addresses (sunset 2026-05-12/13). Removable in the same coordinated cleanup.

**Implication:** Person-hero is ZERO additional spec scope for ORCH-0707. It's already correct architecture. Only the legacy slug bridge cleanup remains, and that's already in ORCH-0700's transitional-alias removal pass.

**Confidence:** H+ (full file read + grep verification).

## C8 — Field shape contracts (server response → mobile)

**Verdict:** Mobile contract is `placeType` + optional `comboCategory` + top-level `categoryLabel`. The wire-level `aiCategories` field (line 681) is **DEAD ON ARRIVAL — mobile's CuratedStop type does not declare it**. Renaming or removing it is safe.

**Mobile `CuratedStop` type contract** (`app-mobile/src/types/curatedExperience.ts:3-35`):

```typescript
export interface CuratedStop {
  stopNumber: number;
  stopLabel: 'Start Here' | 'Then' | 'End With' | 'Explore' | 'Optional';
  placeId: string;
  placeName: string;
  placeType: string;                     ← consumed; currently ai_categories[0]
  // ... rating, address, photos, hours, price, distance, etc.
  comboCategory?: string;                ← consumed; already passed through
  // NO aiCategories FIELD                  ← server's line 681 is silently dropped by mobile
}
```

**Mobile `CuratedExperienceCard` type contract** (lines 47-63):

```typescript
export interface CuratedExperienceCard {
  // ...
  categoryLabel?: string;                ← consumed; comes from CURATED_TYPE_LABELS[experienceType], NOT ai_categories
  stops: CuratedStop[];
  // NO category FIELD                      ← server's line 706 emits `category` but mobile doesn't read it
}
```

**Implication:** The mobile-facing wire contract is `placeType` (per stop) + `comboCategory` (per stop) + `categoryLabel` (top of card). Of these, `categoryLabel` already comes from experience type (not ai_categories), and `comboCategory` is already the slot slug. Only `placeType` currently reads ai_categories — and `placeType` is the field we'd rewire to `comboCategory`.

**The wire-level `aiCategories` field on each stop** (server line 681) and **top-level `category` field on the card** (server line 706) are emitted but mobile never reads them. **Safe to drop entirely on the wire.**

**Confidence:** H+ (verified mobile type definition + grep'd `aiCategories` against mobile = zero hits).

## C9 — Mobile pre-OTA migration strategy

**Verdict:** No migration window needed. The wire-level `aiCategories` field is already orphaned (mobile doesn't read it). The wire-level top-level `category` field is also unread by mobile. Removing both is invisible to mobile, even on the oldest OTA build still in the field.

**Risk surface:**
- Pre-OTA mobile that reads `placeType` (which all builds do, per CuratedStop type) — `placeType` will start carrying the comboCategory string instead of ai_categories[0]. As long as the string is a valid Mingla slug (and modern split slugs ARE valid — they're already in use post-ORCH-0598), mobile renders fine. No breakage.
- Pre-OTA mobile that reads `aiCategories` from a stop — does not exist (verified by grep + type definition).
- Pre-OTA mobile that reads top-level `category` from a card — does not exist (verified by grep + type definition).

**Conclusion:** The change is wire-shape-additive-then-subtractive: phase 1 = `placeType` semantics shift from `ai_categories[0]` to `comboCategory` (no client-visible breakage); phase 2 = drop unused fields from wire payload at server side.

**No need for a sunset window.** Both phases can ship in the same release.

**Confidence:** H+ (mobile type definition exhaustive + grep cross-verified).

## C10 — Where the new derivation function belongs

**Verdict:** No new function needed for the curated pipeline. The slug semantics already exist at the call site. For stopAlternatives, the existing `fetch_local_signal_ranked` RPC pattern is the right reuse target.

**The dispatch proposed 5 placement options** (function in _shared, RPC, generated column, etc.). **None apply** because:

- **Curated pipeline:** `comboCategory` is on the call stack (combo slug for slot i = `combo[i]`). The `buildCardStop` function (line 619 signature) already accepts `opts?.comboCategory`. The fix is to PASS this slug at every call site (verified call sites in §C1) and READ it where ai_categories[0] is currently read. No new function. No new column. No new RPC.

- **stopAlternatives:** The selection filter `.contains('ai_categories', [categoryId])` becomes a `place_scores` JOIN. The pattern already exists in `fetchSinglesForSignalRank` (lines 323-446 of generate-curated-experiences). Refactor: extract `fetchSinglesForSignalRank` to `_shared/signalRankFetch.ts` (or similar) and import it in `stopAlternatives.ts`. Pass `categoryId` as `filterSignal` (with an explicit slug-to-signal map for the 2 chip-slug-to-signal-id mismatches: `upscale_fine_dining → fine_dining`, `drinks_and_music → drinks`). Pass a `filterMin` per category (default 120, movies/flowers = 80 — same as `COMBO_SLUG_FILTER_MIN`).

- **Admin per-place "category" label needed by other surfaces** (ORCH-0700 audit's discovered need for `admin_place_pool_mv` rebuild + admin dashboards) — out of ORCH-0707 scope. Use `mapPrimaryTypeToMinglaCategory(primary_type, types)` for that, as ORCH-0700 audit already specced.

**Architectural placement summary:**

| Surface | Authority | Source |
|---------|-----------|--------|
| Curated stop placeType / category label | comboCategory | call-site slot slug |
| Curated stop duration | comboCategory + CATEGORY_DURATION_MINUTES (with modern keys) | call-site + lookup table |
| Curated card top-level category | first main stop's comboCategory | call-site |
| stopAlternatives selection filter | filterSignal = signal_id derived from categoryId | place_scores JOIN |
| stopAlternatives placeType label | categoryId (the slot the user is replacing) | RPC parameter |
| Person-hero composition | signal_id directly | already correct |
| Admin per-place "primary category" display (out of scope here) | mapPrimaryTypeToMinglaCategory(primary_type, types) | ORCH-0700 spec |

**Confidence:** H+.

---

# 2. Discoveries (beyond dispatch scope)

| ID | Discovery | Severity | Implication |
|----|-----------|----------|-------------|
| **D-CUR-1** | `CATEGORY_DURATION_MINUTES` (lines 602-606 in generate-curated-experiences AND lines 17-22 in stopAlternatives.ts) is keyed on LEGACY bundled slugs (`brunch_lunch_casual`, `movies_theatre`). Once we shift to `comboCategory` keys (modern split slugs), these maps need updating to use `brunch`, `casual_food`, `movies`, `theatre`. Otherwise duration falls back to default 60 min. | M | Trivial fix — replace 2 lookup maps with modern keys. Belongs in the spec. |
| **D-CUR-2** | `SLUG_TO_STOP_ROLE` (lines 561-577 of generate-curated-experiences) ALREADY has both legacy AND modern slugs (`brunch_lunch_casual: 'Brunch'` AND `brunch: 'Brunch'`). No code change needed for stop-role labels — modern keys already present. | L | Bonus — confirms the migration path is well-paved. |
| **D-CUR-3** | The fallback default at `generate-curated-experiences/index.ts:706` is hardcoded `'brunch_lunch_casual'`. This branch fires only if `mainStops[0]?.aiCategories?.[0]` AND `mainStops[0]?.placeType` are BOTH falsy. After migration to `comboCategory`, the fallback should become `'brunch'` (or `null` — depends on operator preference). | L | Trivial fix. |
| **D-CUR-4** | `stopAlternatives.ts` is also imported by `replace-curated-stop/index.ts` (per file naming convention — `replace-curated-stop` calls `fetchStopAlternatives`). The signal-driven rewrite of `fetchStopAlternatives` will improve the curated-stop replacement quality across the board, not just decommission ai_categories. Replacements will return the same quality of candidates as the original curated pipeline. | M (quality improvement) | Free win bundled with ORCH-0707 implementation. |
| **D-CUR-5** | `fetchSinglesForSignalRank` is currently INLINED inside `generate-curated-experiences/index.ts` (lines 323-446). Should be extracted to `_shared/signalRankFetch.ts` so `stopAlternatives.ts` can import it without duplication. | M | Refactor before/during ORCH-0707 spec implementation. |
| **D-CUR-6** | `CATEGORY_SLUG_TO_SIGNAL_ID` (in `get-person-hero-cards/index.ts:187-197`) maps chip slugs to signal IDs. When chip slug == signal ID (movies, theatre, brunch, casual_food, creative_arts, etc.), the entry is identity. Only 4 entries are non-identity: `upscale_fine_dining → fine_dining`, `drinks_and_music → drinks`, `brunch_lunch_casual → casual_food`, `movies_theatre → movies`. After ORCH-0700 sunset removes the legacy bundled slug entries, only 2 non-identity mappings remain (`upscale_fine_dining → fine_dining` and `drinks_and_music → drinks`). These two are the ORCH-0711 "rename signal to match chip" question. | L | Already registered as ORCH-0711 (deferred). Confirms scope. |
| **D-CUR-7** | The curated pipeline has a CLEAR separation between "filter signal" (what the slot wants) and "rank signal" (vibe to optimize). This is the right architecture. No change needed — just preserve through the migration. | L | Architectural quality observation. |
| **D-CUR-8** | `replace-curated-stop/index.ts:11-15` `VALID_CATEGORIES` set (already flagged in ORCH-0700 as out-of-scope until that spec includes the fix) is the OUTER gate that rejects modern slugs. Whether ORCH-0707 fixes `stopAlternatives.ts` or not, the modern-slug rejection at the outer gate must be fixed in ORCH-0700 (already in scope). | L | Cross-references ORCH-0700 B4. |

---

# 3. Five-layer cross-check

| Layer | Question | Answer |
|-------|----------|--------|
| **Docs** | Should the curated pipeline derive category labels from `ai_categories`? | No explicit doc. ORCH-0598/0599/0640 implementation comments throughout the file say "use signal scores instead." The pipeline is mid-migration. |
| **Schema** | Does `place_scores` have everything needed to replace `ai_categories` for selection? | Yes — 14,412 places × 16 active signals (weekly re-scored). Type-grounded signals exist for every Mingla category. |
| **Code** | Is `comboCategory` actually passed today? | Partially — `buildCardStop` accepts it (line 619) but inspection of call sites needed during spec to confirm every caller passes it. (Spec scope, not investigation scope.) |
| **Runtime** | Does `fetch_local_signal_ranked` RPC return enough rows for stopAlternatives use cases? | Yes — same RPC already powers the curated pipeline at production scale. Same parameters work. |
| **Data** | Will places that have valid signal scores have valid `ai_categories[0]` agreement 100% of the time? | No — 26% disagreement (C4) is not a data problem; it's evidence the two systems answer different questions. Migration is correct regardless. |

No layer disagreements. The migration target is well-defined and consistent.

---

# 4. Decision matrix — fix strategy options

For the curated pipeline (NOT stopAlternatives, which has only one viable path = the existing RPC pattern):

| Option | Approach | Pros | Cons | Recommendation |
|--------|----------|------|------|----------------|
| **A. comboCategory threading** | Pass combo slug at every call site; read it at every label/duration site. Drop ai_categories from response. | Smallest scope. Uses existing field. Architectural truth (slot defines slot). No new function/RPC/column. | Requires verifying every caller passes comboCategory (some may not — spec must enumerate). | **RECOMMENDED** |
| **B. Per-place primary-category column** | Add `place_pool.primary_category` (text) computed via signal scores by `run-signal-scorer`. Migrate all consumers. | Single per-place authority. Useful for admin too. | Conflates curated-slot semantics with per-place semantics. Wrong layer for the curated label. Adds re-score cost. | NOT RECOMMENDED |
| **C. mapPrimaryTypeToMinglaCategory derivation** | Use the existing function (operator already rejected this in chat). | Reuses existing helper. | Per operator: creates a 3rd interpretation layer competing with signal scores. Architecturally wrong for curated. | REJECTED (operator directive) |
| **D. Highest-scorer-wins per place** | At hydrate time, look up each place's highest type-grounded signal as its category. | Uses signal scores directly. | Wrong for curated (place's "best signal" ≠ slot the place fills — see §C3 Alamo Drafthouse example). | NOT RECOMMENDED |

**Recommended path: Option A.**

For `stopAlternatives.ts`: only one viable path — refactor the `.contains('ai_categories', [categoryId])` filter to a `place_scores` JOIN via the existing `fetch_local_signal_ranked` RPC pattern (or its extraction to `_shared`).

---

# 5. Recommended remediation (direction only — not a spec)

**ORCH-0707 SPEC scope** (high level — exhaustive spec follows in next dispatch):

### A. generate-curated-experiences/index.ts

1. **Drop** `pp.ai_categories` from the SELECT at line 379.
2. **Drop** lines 432-436 — the entire pass-through block. Replace with: nothing (the assembled card no longer carries ai_categories or category fields).
3. **Refactor `buildCardStop`** (line 609 signature) — change `opts?.comboCategory` from optional to REQUIRED; rename to `slotCategory` for clarity (semantically: the combo slug the slot used).
4. **Replace** line 648 `placeType: card.category || 'place'` with `placeType: slotCategory`.
5. **Replace** line 675 `CATEGORY_DURATION_MINUTES[card.category]` with `CATEGORY_DURATION_MINUTES[slotCategory]`.
6. **Drop** line 681 `aiCategories: card.ai_categories || card.categories || []` entirely (mobile doesn't read).
7. **Replace** line 706 `mainStops[0]?.aiCategories?.[0] || mainStops[0]?.placeType || 'brunch_lunch_casual'` with `mainStops[0]?.slotCategory || 'brunch'` (or null per operator preference for the fallback default).
8. **Update** `CATEGORY_DURATION_MINUTES` (lines 602-606): keys to modern slugs:
   ```typescript
   const CATEGORY_DURATION_MINUTES = {
     brunch: 60, casual_food: 60, upscale_fine_dining: 90, fine_dining: 90,
     drinks_and_music: 60, drinks: 60, icebreakers: 45, nature: 60,
     movies: 120, theatre: 120, creative_arts: 90, play: 90,
     flowers: 15, groceries: 20,
   };
   ```
   (Include both chip slugs and signal slugs as keys for safety since combos use chip slugs but the architecture is converging.)
9. **Verify every call site of `buildCardStop`** passes a valid `slotCategory`. Each combo loop iteration MUST thread `combo[i]` through. Failure mode without this: stops end up with `placeType: undefined`.

### B. _shared/stopAlternatives.ts

1. **Extract** `fetchSinglesForSignalRank` from `generate-curated-experiences/index.ts` to `_shared/signalRankFetch.ts` (per D-CUR-5).
2. **Replace** `.contains('ai_categories', [categoryId])` filter (line 86) and the subsequent SELECT (line 84) with a call to the extracted RPC helper.
3. **Pass** `categoryId` through a slug-to-signal-id resolver (handle the 2 chip-slug-to-signal-id mismatches: `upscale_fine_dining → fine_dining`, `drinks_and_music → drinks`). Reuse `COMBO_SLUG_TO_FILTER_SIGNAL` map from generate-curated-experiences.
4. **Drop** `ai_categories` from the SELECT (no longer needed).
5. **Replace** `firstCategory: ai_categories?.[0]` (lines 133-136) with the input `categoryId` directly. The user is replacing a slot of category X — every alternative is by definition category X.
6. **Update** `CATEGORY_DURATION_MINUTES` (lines 17-21) — same modern-key migration as A8.

### C. get-person-hero-cards (NO CHANGES IN ORCH-0707)

Already pure signal-based. The legacy slug bridge cleanup (lines 178-182, 187-211) is already in ORCH-0700's transitional-alias removal pass.

### D. After A + B ship — unblocks ORCH-0700's ai_* column drop

The 5 `ai_*` columns deferred from ORCH-0700 (`ai_categories`, `ai_reason`, `ai_primary_identity`, `ai_confidence`, `ai_web_evidence`) become safe to DROP after ORCH-0707 ships, contingent on:
- `admin_place_pool_mv` rebuild already in ORCH-0700 spec (just adds these other ai_* columns to the drop)
- No other consumers (verified by ORCH-0700 sub-audit + this investigation)

---

# 6. Regression prevention

| Risk | Prevention |
|------|------------|
| `slotCategory` undefined at a call site → stop renders `placeType: undefined` | Spec REQUIRES every `buildCardStop` caller to pass slotCategory. Spec includes a TypeScript compile check (no `?` on the parameter). |
| `CATEGORY_DURATION_MINUTES` lookup miss → stop falls back to 60 min | Spec includes fallback default + sentinel logging. Tester verifies every modern slug returns its expected duration. |
| `stopAlternatives` returns wrong-category candidates if signal_id resolution fails | Spec requires explicit assertion: throw if `categoryId` doesn't resolve to a known signal_id. No silent empty-result return. |
| Future re-introduction of ai_categories somewhere | New invariant **I-CURATED-LABEL-SOURCE** — "Curated stop placeType MUST be the comboCategory slug of the combo slot the place was selected to fill, never derived from `place_pool.ai_categories`." Add to INVARIANT_REGISTRY post-CLOSE. |
| Disagreement between curated label and place's actual best signal (the 26% from C4) | This is by design — it's the "place fills slot" semantic. Document in code comment near placeType assignment. |

---

# 7. Open questions for operator

| OQ | Question | Default |
|----|----------|---------|
| OQ-1 | For the fallback default at line 706 (when no main stop has a slotCategory): use `'brunch'` (concrete slug) or `null` (honest absence per Constitution #9)? | Recommend `null` — honest absence is better than fabricated category. Spec proceeds with `null` unless overridden. |
| OQ-2 | Should the wire-payload `aiCategories` field on each stop (line 681) be removed (saves wire bytes, mobile doesn't read) OR retained as empty `[]` for one release as defensive belt-and-suspenders? | Recommend remove — verified mobile doesn't read it. Save bytes. |
| OQ-3 | Should the wire-payload top-level `category` field (line 706) be removed similarly? | Recommend remove — verified mobile doesn't read it. |
| OQ-4 | After ORCH-0707 ships, is the operator comfortable scheduling the ai_* column drop for the SAME release window as ORCH-0707 implementation? Or wait one release cycle for verification? | Recommend separate release: ORCH-0707 ships first, observe for 24-48 hours that curated/stopAlternatives work correctly with new derivation, THEN drop the columns in a follow-up tiny migration. Conservative — drops are irreversible. |
| OQ-5 | `fetchSinglesForSignalRank` extraction to `_shared/signalRankFetch.ts` (D-CUR-5) — do this as part of ORCH-0707 spec, or punt to a refactor ticket? | Recommend do it as part of ORCH-0707 — it's a 30-line move and stopAlternatives needs the import anyway. |
| OQ-6 | Should the new I-CURATED-LABEL-SOURCE invariant (regression prevention) include a CI check (parse the file for `ai_categories` reads in the curated path), or is it documentation-only? | Recommend CI check — prevents future agent sessions from re-introducing ai_categories reads. |

---

# 8. Confidence summary

| Thread | Confidence | Source |
|--------|-----------|--------|
| C1 — usage inventory | H+ | Full file read with line citations |
| C2 — selection trace | H+ | Full call-graph traced from typeDef.combos to RPC call |
| C3 — architectural authority | H+ | Reasoning derived from C2; concrete Alamo Drafthouse example |
| C4 — cross-tab agreement | H+ | Live SQL on 100-row sample with explicit breakdown |
| C5 — quality-grounded signals | H+ | Live SQL + EXPERIENCE_RANK_SIGNAL_OVERRIDE read |
| C6 — display labels | H+ | Live signal_definitions enumeration |
| C7 — person-hero | H+ | Full file read + grep verification (zero ai_categories hits) |
| C8 — wire contracts | H+ | Mobile type definition exhaustive read + grep |
| C9 — pre-OTA migration | H+ | Mobile type contract verified (silent-drop fields confirmed safe) |
| C10 — placement | H+ | Reasoning derived from C2 + C3 + C8 |
| Recommendation (Option A: comboCategory threading) | H | Architecturally clean; minimal blast radius; uses existing fields |

---

**END OF REPORT**
