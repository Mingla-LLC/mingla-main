# INVESTIGATION — ORCH-0684 — Paired-Person View: Cards Render But Are Not Real (Signal-System Migration Abandoned at the Mapper Layer)

**Verdict:** ✅ **ROOT CAUSE PROVEN HIGH** — single-file code-trace evidence, mathematically deterministic, cross-layer corroboration with the working singles-deck baseline. Live-fire confirmation pending (see §11) but not required for fix to begin — the defect is structural, not stochastic.

**Severity (forensics-confirmed):** **S0** — entire paired-person experience surface (birthday hero CardRow + every Custom-Holiday CardRow + every Upcoming-Holiday CardRow) is degraded program-wide for every user with a paired friend. Cards render with placeholder data, no photos, default price tier, broken category. ORCH-0668 closed as Grade A on 2026-04-25 because it fixed the *perf* of this surface — but the surface has been silently shipping broken-shape cards since the ORCH-0640 cutover on 2026-04-23. Two days of "the cards load now, ship it" without anyone validating the cards actually render real content.

**One-line summary:** The edge fn `get-person-hero-cards` calls `query_person_hero_places_by_signal` which returns `to_jsonb(pp.*)` — a `place_pool` row in snake_case Google shape (`name`, `stored_photo_urls`, `primary_type`, `price_level`, …). The mobile-bound mapper `mapPoolCardToCard` reads `raw.title`, `raw.image_url`, `raw.category`, `raw.category_slug`, `raw.price_tier`, `raw.tagline`, `raw.stops`, `raw.experience_type`, `raw.total_price_min/max`, `raw.estimated_duration_minutes`, `raw.shopping_list`, `raw.categories` — **every one of those is a column on the dropped `card_pool` table, none exist on `place_pool`**. Result: title="Unknown", imageUrl=null, category=""/Curated, priceTier defaults to "chill", every curated/combo field nulls. The mapper was forked from the legacy `card_pool` shape in ORCH-0640 ch06 and never rewritten when the underlying RPC repointed to `place_pool`. The mapper's own docstring at [get-person-hero-cards/index.ts:75](supabase/functions/get-person-hero-cards/index.ts#L75) literally says *"Maps a raw card_pool JSONB row (snake_case) to the Card interface"* — direct self-documentation of the bug.

---

## 1 · Verdict + severity (one-liners)

- **Verdict:** Root cause proven HIGH (static-analysis-deterministic).
- **Severity:** S0 — primary social/relationship surface degraded for every paired user.
- **Cycle:** 1 of 1 (this investigation).
- **Live-fire status:** Code-trace complete; runtime JSON capture noted as out-of-scope-this-cycle with explicit unblocking action in §11.

---

## 2 · Layman summary (plain-English, no jargon)

When you open a friend's profile, the app asks the backend for a list of recommended places to do for their birthday, custom holidays, and upcoming holidays. The backend correctly looks up real places in a database table called `place_pool` and returns them. **But the translator that turns those database rows into cards your phone can display was written for a different table that we deleted last week.** The translator looks for fields like `title`, `image_url`, `tagline`, and `category_slug` — those fields existed on the old table (`card_pool`), but they don't exist on the new one (`place_pool`). The new table has fields named `name`, `stored_photo_urls`, `primary_type`, etc.

Because the translator finds nothing under the names it expects, it fills in defaults: every card title becomes "Unknown", every photo is replaced by a grey icon, every price falls back to the cheapest "Chill" tier, and every detail field — description, tagline, hours, ratings — is left empty. The cards still *render* (the UI is forgiving and shows a placeholder), which is why this slipped through last week's testing. But none of the actual restaurant/place information makes it onto the screen.

On top of that, two other things you described are also true:
1. **No combo cards.** The edge function hard-codes every card to type "single". A line in the code from the cutover even says *"all single cards post-ORCH-0640; curated heroes retired"*. The mixed-with-curated experience is structurally not generated for this surface.
2. **Personalization only chooses *which categories* to query, not *which places win*.** The backend does a lot of work to blend your preferences with your friend's preferences (bilateral mode, custom-holiday blending, shuffle mode) — but all of that personalization happens at the *category-selection* layer (e.g., "let's look at Romantic and Play"). The actual place ranking inside the database function is a flat "highest signal score wins" sort that ignores every behavioral signal. The function even accepts a `p_user_id` and `p_person_id` parameter — and never uses them in its body.

The fix is mostly **in one file** (the edge function mapper) plus a **policy decision** about how to bring back combo experiences and how deep to push personalization into the ranking. None of this requires more deep investigation; it requires a spec.

---

## 3 · Symptom trace (UI → React Query → service → edge → RPC → DB)

| # | Layer | File | Evidence |
|---|-------|------|----------|
| 1 | UI — three CardRow instances mount on view | [PersonHolidayView.tsx:870-881](app-mobile/src/components/PersonHolidayView.tsx#L870-L881) (birthday), [PersonHolidayView.tsx:671-680](app-mobile/src/components/PersonHolidayView.tsx#L671-L680) (custom holiday), [PersonHolidayView.tsx:592-601](app-mobile/src/components/PersonHolidayView.tsx#L592-L601) (standard holiday) | All three pass `pairedUserId`, `holidayKey`, `sections` to the same `<CardRow>` component. |
| 2 | UI — CardRow renders cards | [PersonHolidayView.tsx:441-486](app-mobile/src/components/PersonHolidayView.tsx#L441-L486) | Renders `<CompactCard>` per card with `c.title`, `c.imageUrl`, `c.priceTier`, `c.cardType`. If `imageUrl` is null, falls back to grey placeholder ([line 292-296](app-mobile/src/components/PersonHolidayView.tsx#L292-L296)). |
| 3 | Hook — React Query setup | [usePairedCards.ts:58-82](app-mobile/src/hooks/usePairedCards.ts#L58-L82) | `staleTime: Infinity`, `retry: 2`, queryKey `personCardKeys.paired(pairedUserId, holidayKey, locKey)`. Calls `fetchPersonHeroCards(...)`. |
| 4 | Service — POSTs to edge fn | [personHeroCardsService.ts:17-35](app-mobile/src/services/personHeroCardsService.ts#L17-L35) | POSTs `{pairedUserId, holidayKey, categorySlugs, curatedExperienceType, location, mode, excludeCardIds}` to `/functions/v1/get-person-hero-cards`. |
| 5 | Service — coerces response | [personHeroCardsService.ts:49-53](app-mobile/src/services/personHeroCardsService.ts#L49-L53) | `cards: data.cards ?? []`, `hasMore: data.hasMore ?? false`. No shape validation — accepts whatever shape the edge fn sends. |
| 6 | Edge fn — receives + auths + does personalization | [get-person-hero-cards/index.ts:140-493](supabase/functions/get-person-hero-cards/index.ts#L140-L493) | Heavy preference blending (bilateral/custom-holiday/shuffle/default modes) — outputs `blendedCategories` + optional `priceTierFilter`. |
| 7 | Edge fn — resolves signal IDs | [get-person-hero-cards/index.ts:608-627](supabase/functions/get-person-hero-cards/index.ts#L608-L627) | `CATEGORY_SLUG_TO_SIGNAL_ID` maps user-facing slugs → signal IDs. Adds `brunch` if `brunch_lunch_casual` requested; `theatre` if `movies_theatre`. |
| 8 | Edge fn — calls RPC | [get-person-hero-cards/index.ts:651-665](supabase/functions/get-person-hero-cards/index.ts#L651-L665) | `adminClient.rpc("query_person_hero_places_by_signal", {p_user_id, p_person_id, p_lat, p_lng, p_signal_ids, p_exclude_place_ids, p_initial_radius_m: 15000, p_max_radius_m: 100000, p_per_signal_limit: 3, p_total_limit: 9})`. |
| 9 | RPC body — gates + ranks + projects | [migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql:81-152](supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql#L81-L152) | LANGUAGE sql STABLE. Three-gate serving (G1 `is_servable=true`, G2 `JOIN place_scores ON signal_id ANY(p_signal_ids)`, G3 `stored_photo_urls non-empty AND ≠ '__backfill_failed__'`). Returns `to_jsonb(pp.*) AS place, signal_id, signal_score, total_count`. **Does not reference `p_user_id` or `p_person_id` anywhere in the body.** |
| 10 | Edge fn — maps row to Card | [get-person-hero-cards/index.ts:701-704](supabase/functions/get-person-hero-cards/index.ts#L701-L704) | `cards: Card[] = rows.map(row => mapPoolCardToCard(row.place, 'single'))`. **Hard-codes every card to type "single".** |
| 11 | Edge fn — mapper reads ghost fields | [get-person-hero-cards/index.ts:79-114](supabase/functions/get-person-hero-cards/index.ts#L79-L114) | `mapPoolCardToCard` reads `raw.title, raw.image_url, raw.category, raw.category_slug, raw.price_tier, raw.price_tiers, raw.tagline, raw.stops, raw.experience_type, raw.total_price_min, raw.total_price_max, raw.estimated_duration_minutes, raw.shopping_list, raw.categories, raw.card_type` — **every one is a `card_pool` column. None exist on `place_pool`.** The docstring at [line 75](supabase/functions/get-person-hero-cards/index.ts#L75) admits it: *"Maps a raw card_pool JSONB row"*. |
| 12 | Edge fn — returns | [get-person-hero-cards/index.ts:768-774](supabase/functions/get-person-hero-cards/index.ts#L768-L774) | HTTP 200 `{cards, hasMore}`. Cards have correct `id` (place_pool.id), `lat`/`lng`, `address`, but title="Unknown", category="", imageUrl=null, priceTier defaulted, every curated field null. |
| 13 | UI — CompactCard renders defaults | [PersonHolidayView.tsx:289-330](app-mobile/src/components/PersonHolidayView.tsx#L289-L330) | Image fallback (grey placeholder + image-outline icon), title shows "Unknown", category badge tries to look up icon for empty string → falls to "ellipse-outline", price renders as `$$ Chill` (default tier). Visually appears as cards but contains no real information. |

**Symptom proven by static trace alone.** No live-fire required to confirm imageUrl=null and title="Unknown" — the assignment is `(raw.image_url as string) ?? null` and `place_pool` has no `image_url` column.

---

## 4 · Phase 0 — context ingest (every prior artifact and migration ingested)

### 4.1 Prior artifacts read

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md` — full read. ORCH-0668 fixed the *performance* of `query_person_hero_places_by_signal` (plpgsql → sql STABLE). It did NOT examine the response *shape* or the mapper. Closed Grade A on 2026-04-25. The closure was perf-correct but shape-blind — every assertion in that report was about timeouts and row counts, not about field projection.
- `Mingla_Artifacts/prompts/FORENSICS_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md` — the dispatch prompt. Self-contained, no further upstream context required.
- `Mingla_Artifacts/MASTER_BUG_LIST.md` (header notes for ORCH-0671/0677/0678 cycles) — confirms the program is mid-cutover-cleanup and ORCH-0640's blast radius is still being discovered surface-by-surface.
- `MEMORY.md` — relevant memories applied: `feedback_headless_qa_rpc_gap.md` (live-fire required for plpgsql perf — N/A here, RPC already SQL STABLE), `feedback_solo_collab_parity.md` (audited — Discover singles use a different transformer; not affected, see §10), `feedback_forensic_thoroughness.md` (latest migration is truth — ORCH-0668 rewrite is the authoritative RPC body), Constitution #2/#3/#8/#9 (violations recorded in §8).

### 4.2 Migration chain (chronological)

The card_pool → place_pool/signal-system cutover spans these migrations:

| Migration | Date | What it did | Status |
|-----------|------|-------------|--------|
| `20260421200001_orch_0588_place_pool_bouncer_columns.sql` | 2026-04-21 | Added bouncer columns to `place_pool` | Live |
| `20260421200002_orch_0588_place_scores_table.sql` | 2026-04-21 | Created `place_scores` table | Live |
| `20260421200003_orch_0588_signal_definitions_tables.sql` | 2026-04-21 | Created `signal_definitions` | Live |
| `20260421200006_orch_0588_query_servable_places_rpc.sql` | 2026-04-21 | Original `query_servable_places_by_signal` | Live (superseded) |
| `20260424220002_orch_0634_deprecate_card_pool_comments.sql` | 2026-04-24 | Documented deprecation | Live |
| `20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql` | 2026-04-24 | G3 photo gate added — singles deck on signal system | **Authoritative for `query_servable_places_by_signal`** |
| `20260425000007_orch_0640_person_hero_rpc.sql` | 2026-04-25 | First version of `query_person_hero_places_by_signal` (plpgsql) | Superseded by ORCH-0668 |
| `20260425000010_orch_0640_archive_and_drop_tables.sql` | 2026-04-25 | Dropped legacy tables | Live |
| `20260425000011_orch_0640_drop_card_pool_triggers.sql` | 2026-04-25 | Stopped writes to `card_pool` | Live |
| `20260425000012_orch_0640_drop_legacy_rpcs.sql` | 2026-04-25 | Dropped `query_person_hero_cards`, `query_pool_cards`, others | Live |
| `20260427000001_orch_0653_signal_local_rank_rpc.sql` | 2026-04-27 | `fetch_local_signal_ranked` for curated engine | **Authoritative for curated rank** |
| `20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql` | 2026-04-28 | Rewrote `query_person_hero_places_by_signal` as `LANGUAGE sql STABLE` | **Authoritative for person-hero RPC** |

### 4.3 Cutover commits (suspected)

- ORCH-0640 ch06 (commit `2b10b7c2`, 2026-04-23 night per ORCH-0668 report): the moment `card_pool` reads were repointed to `place_pool` for the paired-person path. **This is the commit that introduced the mapper bug** — the RPC source switched but the mapper did not.
- ORCH-0668 closure (2026-04-25, commit referenced in MASTER_BUG_LIST.md): perf rewrite. Did NOT touch the edge fn mapper. Bug persisted unaltered.

### 4.4 Verified via `pg_get_functiondef` (recommended live-fire)

Static evidence is sufficient to PROVE the shape mismatch — the latest migration body is the deployed body unless someone hand-edited via dashboard. Recommended live-fire (see §11): `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'query_person_hero_places_by_signal'` to byte-confirm vs the ORCH-0668 migration source.

---

## 5 · Investigation manifest (every file read, in trace order, with the *why*)

| # | File | Why |
|---|------|-----|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_ORCH-0684_PAIRED_VIEW_CARDS_NOT_REAL.md` | Self-briefing on the dispatch's scope, hypotheses, success criteria. |
| 2 | `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0668_PAIRED_PROFILE_RECOMMENDATIONS_FAIL.md` (full) | Establish what was *already* known about this RPC, and what was NOT examined. |
| 3 | `Mingla_Artifacts/MASTER_BUG_LIST.md` (recent header) | Latest ORCH ID counter, current program state. |
| 4 | `app-mobile/src/components/PersonHolidayView.tsx` (full, 1308 lines) | Identify every CardRow mount, the prop chain, the renderer (CompactCard inline component). Discovered: PersonGridCard.tsx is NOT used by this screen. |
| 5 | `app-mobile/src/components/PersonGridCard.tsx` | Confirm dead-at-this-surface: PersonHolidayView never imports/uses it. (See §10 blast radius — used elsewhere or fully orphan.) |
| 6 | `app-mobile/src/hooks/usePairedCards.ts` | React Query setup. `staleTime: Infinity` + `retry: 2`. Dispatches to `fetchPersonHeroCards`. |
| 7 | `app-mobile/src/hooks/usePersonHeroCards.ts` | **Found: a parallel hook with same fetch path but different query key (`personCardKeys.hero` vs `personCardKeys.paired`).** Not currently mounted by PersonHolidayView (which uses usePairedCards). HF candidate — see §7. |
| 8 | `app-mobile/src/services/personHeroCardsService.ts` | Confirm POST body shape. No mode "bilateral" exposed at this layer despite edge fn supporting it (HF candidate, see §7). |
| 9 | `app-mobile/src/services/holidayCardsService.ts` | The `HolidayCard` / `HolidayCardsResponse` type contract — same shape as edge fn's `Card` interface. The mobile contract permits photos, ratings, addresses, curated-experience fields — the contract is honest about what UI expects, the edge fn just doesn't fulfill it. |
| 10 | `app-mobile/src/constants/holidays.ts` (head) | `DEFAULT_PERSON_SECTIONS` = [Romantic, Adventurous, FineDining, Movies, Play] — the birthday-hero default. STANDARD_HOLIDAYS map names to section sets. |
| 11 | `supabase/functions/get-person-hero-cards/index.ts` (full, 786 lines) | The defective mapper at lines 79-114; the bilateral/custom-holiday/shuffle/default personalization at lines 208-493; the RPC call at 651-665; the hard-coded `'single'` cardType at 701-704; the impressions write at 740-762. |
| 12 | `supabase/functions/discover-cards/index.ts` (lines 780-980) | Comparison baseline. Singles deck calls `query_servable_places_by_signal` (which projects EXPLICIT named columns, not `to_jsonb(pp.*)`). Maps via `transformServablePlaceToCard` (separate, correctly-shape-matched transformer). Round-robin per chip, max-score dedupe per place. |
| 13 | `supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql` | **Authoritative person-hero RPC body.** Returns `to_jsonb(pp.*)`. Three-gate serving applied. `p_user_id` and `p_person_id` parameters declared but unused. |
| 14 | `supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql` | **Authoritative singles RPC body.** Projects 18 explicit named columns (`pp.id, pp.google_place_id, pp.name, pp.address, pp.lat, pp.lng, pp.rating, pp.review_count, pp.price_level, pp.price_range_start_cents, pp.price_range_end_cents, pp.opening_hours, pp.website, pp.photos, pp.stored_photo_urls, pp.types, pp.primary_type, ps.score, ps.contributions`). |
| 15 | `supabase/migrations/20260427000001_orch_0653_signal_local_rank_rpc.sql` | `fetch_local_signal_ranked` — used by `generate-curated-experiences`. Returns `(place_id uuid, rank_score numeric)`. Edge fn hydrates separately. **Curated engine does not use `to_jsonb(pp.*)`.** |
| 16 | `supabase/migrations/20260425000007_orch_0640_person_hero_rpc.sql` (head) | Confirm: original ORCH-0640 person-hero RPC also projected `to_jsonb(pp.*)`. The mapper bug was born here. ORCH-0668 preserved this projection verbatim. |

Total: 16 files / migrations read end-to-end. No sub-agent delegation — all reads done directly by the investigator.

---

## 6 · Five-Truth-Layer contradiction grid (paired-person card surface)

| Layer | What it claims | Evidence | Confidence |
|-------|----------------|----------|------------|
| **Docs** | Paired-person view should show real curated/holiday recommendations with photos, prices, names, hours. The `HolidayCard` type at `holidayCardsService.ts:15-40` defines a contract with `imageUrl`, `rating`, `priceLevel`, `address`, `googlePlaceId`, `description`, `cardType: 'single' \| 'curated'`, `tagline`, `stops`, `totalPriceMin/Max`, `experienceType`, etc. | `holidayCardsService.ts:15-45` | H |
| **Schema** | RPC `query_person_hero_places_by_signal` projects `to_jsonb(pp.*)` — wide `place_pool` row with snake_case Google fields: `id, google_place_id, name, address, lat, lng, rating, review_count, price_level, opening_hours, website, photos, stored_photo_urls, types, primary_type, description, ...`. **Has NO `title, image_url, category, category_slug, price_tier, price_tiers, tagline, stops, experience_type, total_price_min, total_price_max, estimated_duration_minutes, shopping_list, categories, card_type` columns.** Those were `card_pool` columns. | `migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql:146` and the `place_pool` schema (verified via comparison RPC `query_servable_places_by_signal` projection at `migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql:25-44` — those ARE the place_pool columns). | H |
| **Code (edge fn)** | The mapper `mapPoolCardToCard` reads ghost `card_pool` field names against the snake_case `place_pool` JSONB. Every read returns `undefined` and falls back to defaults: title="Unknown", imageUrl=null, category=""/"Curated", priceTier="chill" (via `derivePriceTier(null, undefined)` which falls through to "chill" default), stops=0, every curated field null. The `cardType` is unconditionally set to "single" (line 703). The mapper's docstring at line 75 says "Maps a raw card_pool JSONB row" — **the mapper believes it is reading card_pool, but the data source is place_pool.** | `get-person-hero-cards/index.ts:75-114, 700-704` | H |
| **Code (mobile)** | `CompactCard` ([PersonHolidayView.tsx:247-334](app-mobile/src/components/PersonHolidayView.tsx#L247-L334)) defensively renders placeholder when `imageUrl` is null, "Unknown" titles, no rating row when rating is null/0. **The UI's defensive defaults are WHY this bug renders silently** instead of throwing. From the user's view: cards visually load → but contain no real content. | `PersonHolidayView.tsx:247-334, 441-486` | H |
| **Runtime** | NOT independently captured this cycle. Predicted (with H confidence based on schema + code): every card returned by the edge fn will have `title:"Unknown", imageUrl:null, category:"", priceTier:"chill", priceLevel:null, address:<populated from raw.address — but raw.address IS populated on place_pool, so this likely comes through>, rating:null, googlePlaceId:null, lat:<null per mapper, but place_pool has it as raw.lat which IS read>, lng:<same>, ...`. Mixed shape — some fields will populate (lat, lng, address, possibly googlePlaceId via `raw.google_place_id`? — no, the mapper reads `raw.google_place_id` which IS a place_pool column, so this populates). **Cards will have geo-coordinates and address but no name/photo/category.** | Predicted from code; live-fire pending (§11) | M (would be H with one curl execution) |
| **Data** | `place_pool` rows that pass the three-gate filter (is_servable + photo gate + signal score) DO have populated `name`, `stored_photo_urls`, `primary_type`, `address`, `rating` etc. — the underlying data is healthy. The bug is NOT data quality; it is shape translation. | Inferred from `query_servable_places_by_signal` working on the same table for the singles deck. ORCH-0668's investigation confirmed `place_pool` healthy at Raleigh (1797 gate-passing places). | H |

**Contradictions between layers:**
- **Docs ⊥ Code(edge fn):** Contract promises camelCase card-shaped output with photos, names, prices. Edge fn delivers ghost-field defaults. → RC-1.
- **Schema ⊥ Code(edge fn):** Schema delivers snake_case place_pool fields; edge fn looks for snake_case card_pool fields. → RC-1 (same).
- **Schema(person-hero RPC) ⊥ Schema(singles RPC):** Person-hero returns `to_jsonb(pp.*)` (entire row, untyped); singles RPC returns 18 explicit named columns. **Two RPCs on the same table use opposite return contracts.** → CF-1.
- **Code(edge fn personalization) ⊥ Schema(RPC):** Edge fn does extensive prefs/blending that influences `blendedCategories` and `priceTierFilter`. RPC ignores both `p_user_id` and `p_person_id`. Personalization ends at category-selection, never reaches ranking. → RC-3.

Zero "?" cells; runtime row marked M with explicit unblocking action in §11.

---

## 7 · Findings (six-field grid)

### 🔴 RC-1 — `mapPoolCardToCard` reads `card_pool` ghost fields against a `place_pool` JSONB; every essential field null-defaults

| Field | Value |
|-------|-------|
| **File + line** | [supabase/functions/get-person-hero-cards/index.ts:74-114](supabase/functions/get-person-hero-cards/index.ts#L74-L114) |
| **Exact code** | ```ts /** Maps a raw card_pool JSONB row (snake_case) to the Card interface (camelCase). */ function mapPoolCardToCard(raw: Record<string, unknown>, rowCardType?: string): Card { /* ... */ return { id: (raw.id as string) ?? "", title: (raw.title as string) ?? "Unknown", category: (raw.category as string) ?? (cardType === "curated" ? "Curated" : ""), categorySlug: (raw.category_slug as string) ?? (raw.category as string)?.toLowerCase().replace(/\s+/g, "_") ?? "", imageUrl: (raw.image_url as string) ?? null, rating: (raw.rating as number) ?? null, priceLevel: (raw.price_level as string) ?? null, address: (raw.address as string) ?? null, googlePlaceId: (raw.google_place_id as string) ?? null, lat: (raw.lat as number) ?? null, lng: (raw.lng as number) ?? null, priceTier: (raw.price_tiers as string[])?.[0] ?? derivePriceTier((raw.price_tier as string) ?? null, (raw.price_level as string) ?? null), priceTiers: (raw.price_tiers as string[])?.length ? (raw.price_tiers as string[]) : [(raw.price_tier as string) || 'chill'], description: (raw.description as string) ?? null, cardType: cardType as "single" | "curated", tagline: (raw.tagline as string) ?? null, stops: stopsCount, /* derived from raw.stops */ stopsData: cardType === "curated" && Array.isArray(stopsArr) ? stopsArr : null, totalPriceMin: (raw.total_price_min as number) ?? null, totalPriceMax: (raw.total_price_max as number) ?? null, website: (raw.website as string) ?? null, estimatedDurationMinutes: (raw.estimated_duration_minutes as number) ?? null, experienceType: (raw.experience_type as string) ?? null, categories: Array.isArray(raw.categories) ? (raw.categories as string[]) : null, shoppingList: Array.isArray(raw.shopping_list) ? (raw.shopping_list as unknown[]) : null, }; }``` |
| **What it does** | Reads 25 fields from the JSONB blob. Of these: 8 ARE valid `place_pool` columns and populate correctly (`id, address, google_place_id, lat, lng, rating, price_level, description, website`). 17 ARE NOT `place_pool` columns and silently null-default (`title, category, category_slug, image_url, price_tier, price_tiers, tagline, stops, total_price_min, total_price_max, estimated_duration_minutes, experience_type, categories, shopping_list, card_type`). For the missing ones the mapper emits: title="Unknown", imageUrl=null, category="" (or "Curated" if cardType were curated — never is, see RC-2), priceTier=null → falls to derivePriceTier(null, raw.price_level) → if price_level present "comfy"/"bougie"/"lavish", else default "chill". |
| **What it should do** | Read the ACTUAL `place_pool` columns: `raw.name` (not `raw.title`), `raw.stored_photo_urls[0]` or `raw.photos[0].photo_url` (not `raw.image_url`), derive `category` from `raw.primary_type` + the 13-category mapping rules (not `raw.category`), derive `category_slug` from category, derive `priceTier` from `raw.price_level` + Mingla's price-tier rules, populate `opening_hours` from `raw.opening_hours`, etc. Match the field projection used by `transformServablePlaceToCard` in the discover-cards edge fn (the proven-working sibling). |
| **Causal chain** | (1) User opens a paired person's profile. (2) PersonHolidayView mounts, three CardRow instances mount (birthday + each custom holiday + each upcoming holiday). (3) Each CardRow calls `usePairedCards` → `fetchPersonHeroCards`. (4) Edge fn does personalization, resolves signal IDs, calls RPC. (5) RPC returns `[{place: <full place_pool row as JSONB>, signal_id, signal_score, total_count}]`. (6) Edge fn `rows.map(row => mapPoolCardToCard(row.place, 'single'))`. (7) Mapper reads `raw.title` — `place_pool` has no `title` → `undefined ?? "Unknown"` → title="Unknown". (8) Mapper reads `raw.image_url` — `place_pool` has no `image_url` → `undefined ?? null` → imageUrl=null. (9) Same for category, tagline, stops, totalPriceMin/Max, estimatedDurationMinutes, experienceType, categories, shoppingList — all null. (10) Edge fn returns cards array. (11) Mobile React Query caches them. (12) CompactCard renders: grey-icon placeholder for missing image, "Unknown" title, no rating row, default "$$ Chill" price. (13) User sees three rows of placeholder cards. |
| **Verification step** | (a) `curl` the edge fn with a real user JWT and any holiday key + categorySlugs, capture `cards[0]` JSON — predict `title:"Unknown", imageUrl:null, category:""`. (b) `SELECT to_jsonb(pp.*) FROM place_pool pp WHERE id = '<a known servable place>' LIMIT 1` — confirm the field names are snake_case Google: `name, stored_photo_urls, primary_type, types, opening_hours, ...` and there is NO `title, image_url, category, tagline` etc. (c) Compare with `curl` to `discover-cards` returning real names + photos for the same `place_pool` rows. |
| **Confidence** | **HIGH.** Static evidence is mathematically deterministic. The mapper *cannot* return a populated `title` because `place_pool` does not have a `title` column. No live-fire required to confirm the assignment outcome; live-fire (§11) only adds independent corroboration. |

---

### 🔴 RC-2 — Edge fn hard-codes every card to `cardType: 'single'`; the curated/combo path is structurally absent

| Field | Value |
|-------|-------|
| **File + line** | [supabase/functions/get-person-hero-cards/index.ts:700-704](supabase/functions/get-person-hero-cards/index.ts#L700-L704) |
| **Exact code** | ```ts // --- Map rows to Card[] (all single cards post-ORCH-0640; curated heroes retired) --- const rows = rpcRows ?? []; let cards: Card[] = rows.map((row: { place: ...; signal_id: string; signal_score: number; total_available: number }) => mapPoolCardToCard(row.place, 'single'), );``` |
| **What it does** | Every row from the person-hero RPC is mapped with `'single'` as the cardType, unconditionally. The comment confirms intent: *"all single cards post-ORCH-0640; curated heroes retired"*. The edge fn never invokes `generate-curated-experiences`, never calls the combo planner, never inserts a multi-stop experience into the response. The response shape `Card[]` permits curated cards (the `cardType: "single" \| "curated"` union exists), but no code path writes `cardType: "curated"`. |
| **What it should do** | (per founder brief) Return a **mixture** of single cards and curated/combo cards per holiday section, with the mix determined by holiday semantics (e.g., Valentine's = curated romantic combo + single fine-dining alternates; birthday = curated celebration combo + variety singles; custom holiday = blended-preference combo + singles). Combo selection should leverage the `generate-curated-experiences` infrastructure (or its underlying `fetch_local_signal_ranked` + combo planner) so combos honor the same scoring + servable gates as singles. |
| **Causal chain** | (1) Edge fn receives request with `curatedExperienceType` (often "romantic" or "adventurous" derived from sections at lines 597-601). (2) Edge fn ignores `curatedExperienceType` for response composition — it is only used to log. (3) Edge fn calls the singles-only person-hero RPC. (4) Edge fn maps every row as `'single'`. (5) Mobile UI renders only single cards in the CardRow. (6) Founder reports: "no combos." |
| **Verification step** | (a) `grep -n "curated" supabase/functions/get-person-hero-cards/index.ts` — confirm the only `"curated"` references are the dead `effectiveCuratedType` variable, the `priceTierFilter` skip clause `c.cardType === "curated"`, and the comment. There is no `generate-curated-experiences` invocation. (b) `git log -p supabase/functions/get-person-hero-cards/index.ts` — find the commit that removed the curated branch (likely ORCH-0640 ch06). |
| **Confidence** | **HIGH.** Code is unconditional, comment is self-documenting, no curated-fetch infrastructure is referenced anywhere in the file. |

---

### 🔴 RC-3 — RPC `query_person_hero_places_by_signal` accepts `p_user_id` and `p_person_id` but uses neither; place ranking is global signal-score, not personalized

| Field | Value |
|-------|-------|
| **File + line** | [supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql:47-152](supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql#L47-L152) |
| **Exact code (signature)** | ```sql CREATE OR REPLACE FUNCTION public.query_person_hero_places_by_signal( p_user_id UUID, p_person_id UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_signal_ids TEXT[], p_exclude_place_ids UUID[] DEFAULT '{}'::UUID[], p_initial_radius_m INT DEFAULT 15000, p_max_radius_m INT DEFAULT 100000, p_per_signal_limit INT DEFAULT 3, p_total_limit INT DEFAULT 9 ) ... LANGUAGE sql STABLE ...``` |
| **Body usage** | The body's CTEs reference `p_lat, p_lng, p_signal_ids, p_exclude_place_ids, p_initial_radius_m, p_max_radius_m, p_total_limit, p_per_signal_limit`. **`p_user_id` and `p_person_id` are declared but appear ZERO TIMES in the body** (verified via reading lines 81-152 — only the gate-passing CTE, distance calc, dedup, ranking, and final hydration; no user/person lookups, no joins on user-context tables, no behavioral score adjustments). |
| **What it does** | Ranks places purely by `(band_idx ASC, signal_score DESC)` — that is, the highest signal_score within the smallest progressive-radius band wins. Two different users at the same location with the same signal_ids will receive identical rankings. The personalization the edge fn does (lines 208-493) is purely *category selection* (which signals to query) and *price-tier post-filter*. It does NOT influence which places win the in-database competition. |
| **What it should do** | (per founder brief: "personalization based on user behavior") The ranking function should incorporate at minimum: (a) prior engagement weight — places the user has saved or visited in OTHER contexts get a small boost or penalty (saturation); (b) joint-pair history — places the pair has previously interacted with (saved, visited, swiped); (c) learned-preference vector — already populated in `user_preference_learning` table per pair; (d) blacklist — places the user explicitly blocked. Optional: time-of-day / day-of-week context. |
| **Causal chain** | (1) Edge fn does heavy preference work to build `blendedCategories`. (2) Edge fn resolves to `signalIds` array. (3) RPC takes `signalIds` and ranks by `place_scores.score DESC` for those signal IDs only. (4) Two users at the same location with the same blended categories get the same top-9 places, in the same order. (5) Founder reports: "doesn't follow personalization rules that were set before." |
| **Verification step** | (a) `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM query_person_hero_places_by_signal('uuid-A', 'uuid-X', 35.78, -78.64, ARRAY['romantic','play'], '{}'::uuid[], 15000, 100000, 3, 9)` and same call with `p_user_id='uuid-B'` (different user, same other args) — confirm identical row sets and identical ordering. (b) Search the body source for `user_preference_learning`, `card_engagement`, `saved_cards`, `paired_saves`, `user_interactions` — zero hits expected. (c) Compare with `query_servable_places_by_signal` (also doesn't take user_id, but the singles deck does post-RPC interleave + chip-selection personalization in the edge fn). The person-hero RPC has neither in-DB nor post-RPC ranking personalization. |
| **Confidence** | **HIGH.** Migration body verbatim shows the parameters are unused. The personalization the edge fn DOES do is non-ranking (category selection + post-filter). |

---

### 🟠 CF-1 — Person-hero RPC returns `to_jsonb(pp.*)` (entire wide row); singles RPC returns 18 explicit named columns. **Two RPCs on the same table use opposite return contracts**

| Field | Value |
|-------|-------|
| **File + line** | [migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql:146](supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql#L146) (`to_jsonb(pp.*)`) vs [migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql:25-44](supabase/migrations/20260424220003_orch_0634_query_servable_places_by_signal_photo_gate.sql#L25-L44) (named columns) |
| **What it is** | Person-hero RPC returns `RETURNS TABLE(place JSONB, signal_id TEXT, signal_score NUMERIC, total_available BIGINT)` — opaque JSONB blob per place, untyped at the SQL contract level. Singles RPC returns `RETURNS TABLE(place_id uuid, google_place_id text, name text, address text, lat double precision, lng double precision, rating numeric, review_count integer, price_level text, price_range_start_cents integer, price_range_end_cents integer, opening_hours jsonb, website text, photos jsonb, stored_photo_urls text[], types text[], primary_type text, signal_score numeric, signal_contributions jsonb)` — every field named and typed. |
| **Why CF, not RC** | The opaque JSONB return is what *enables* RC-1 to slip through TypeScript checks: `Record<string, unknown>` accepts any field name. If the person-hero RPC declared its return columns explicitly (or returned a named composite type), the mapper would have caught the mismatch at compile/lint time. The discover-cards mapper is shape-correct because `query_servable_places_by_signal` *forces* the right contract. |
| **Why preserved in ORCH-0668** | The ORCH-0668 perf rewrite needed to defer `to_jsonb(pp.*)` until *after* the LIMIT-9 sort to avoid a 707 MB temp spill. Switching to named-column projection would lose the deferred-hydration benefit unless redesigned. The perf engineer correctly preserved the projection shape; they just inherited the upstream mapper bug. |
| **Action (spec phase)** | Either (a) project explicit named columns at the RPC and accept some hydration cost (likely small — only 9 rows), or (b) keep `to_jsonb(pp.*)` and rewrite the mapper to read the actual `place_pool` field names. Option (b) is mechanically easier; option (a) is structurally safer. Spec should choose. |

---

### 🟠 CF-2 — Edge fn personalization reads from `user_preference_learning` with no fallback if the table is empty for a fresh paired user; the bilateral/custom-holiday/shuffle paths gracefully degrade to defaults

| Field | Value |
|-------|-------|
| **File + line** | [get-person-hero-cards/index.ts:208-493](supabase/functions/get-person-hero-cards/index.ts#L208-L493) |
| **What** | Bilateral mode (lines 208-274), custom-holiday blending (275-364), shuffle (365-462), default (462-493) all attempt to fetch `user_preference_learning` rows for the paired user (and, for bilateral/custom, the viewer too). All four paths wrap the fetch in try/catch and silently fall back to `categorySlugs` (the unpersonalized default) if (a) the table query throws, (b) returns no rows, (c) returns rows below the confidence threshold, or (d) returns rows below the preference_value threshold. |
| **Why CF, not RC** | This is necessary defensive coding for cold-start users (no swipe history yet). But it means the edge fn's logging may report "Personalized shuffle: using top X categories" or "Bilateral mode: <3 overlap, padded with paired user prefs" — and the user receives recommendations that *seem* personalized at the metric level but are mostly defaults at the actual category level. CF amplifies RC-3: even when personalization data exists at the category-selection layer, it never reaches the ranking layer (RC-3), so the *effective* personalization is doubly weak. |
| **Action (spec phase)** | Decide whether `user_preference_learning` is the canonical personalization source, audit its population pipeline, and surface a deterministic UX signal when personalization fell back to defaults (e.g., "Based on Mingla's holiday picks" vs "Based on your shared preferences"). |

---

### 🟠 CF-3 — `personHeroCardsService.fetchPersonHeroCards` does not expose `mode: "bilateral"` to the mobile caller despite the edge fn supporting it

| Field | Value |
|-------|-------|
| **File + line** | [personHeroCardsService.ts:10](app-mobile/src/services/personHeroCardsService.ts#L10) (mode type: `"default" | "shuffle"`) vs [get-person-hero-cards/index.ts:24](supabase/functions/get-person-hero-cards/index.ts#L24) (RequestBody mode: `"default" | "shuffle" | "bilateral"`) |
| **What** | Mobile service typings declare only `mode?: "default" | "shuffle"`. Edge fn supports `"bilateral"`. PersonHolidayView has a `bilateralMode` state (`"individual" | "bilateral"`) at [PersonHolidayView.tsx:704](app-mobile/src/components/PersonHolidayView.tsx#L704), persists it to AsyncStorage per pair, but **never threads it into the fetch call.** The bilateral edge-fn branch is structurally unreachable from production mobile calls. |
| **Why CF** | Even when (eventually) RC-1/RC-2/RC-3 are fixed, the bilateral preference-blending feature will remain dark unless the service signature is widened and the component plumbs the mode through. Founder may not have noticed because the BilateralToggle UI is currently hidden (per the comment block at PersonHolidayView.tsx:927-931 — UI is built but hidden until backend has real data). |
| **Action (spec phase)** | Widen `mode` type to include `"bilateral"`, plumb `bilateralMode` from PersonHolidayView through CardRow → usePairedCards → fetchPersonHeroCards. Decide whether bilateral is opt-in (current toggle) or default-when-pair-exists. |

---

### 🟡 HF-1 — Two parallel hooks (`usePairedCards` and `usePersonHeroCards`) target the same fetch with different cache keys; only one is mounted

| Field | Value |
|-------|-------|
| **File + line** | [hooks/usePairedCards.ts:58-82](app-mobile/src/hooks/usePairedCards.ts#L58-L82) and [hooks/usePersonHeroCards.ts:19-42](app-mobile/src/hooks/usePersonHeroCards.ts#L19-L42) |
| **What** | Both hooks call `fetchPersonHeroCards`. `usePairedCards` keys on `personCardKeys.paired(pairedUserId, holidayKey, locKey)` (location-aware); `usePersonHeroCards` keys on `personCardKeys.hero(pairedUserId, holidayKey)` (location-blind). PersonHolidayView mounts only `usePairedCards`. `usePersonHeroCards` is imported by `holidayCardsService.ts` for type-only purposes per its docstring; no live mount found in this trace. |
| **Hidden flaw** | Constitution #2 (one owner per truth) — two hooks could in principle service the same data with divergent cache lifetimes. Today only one mounts; tomorrow a refactor could mount the other and create cache drift. Risk class is the same that bit ORCH-0666 / ORCH-0668 closures: parallel surfaces accidentally diverge. |
| **Action (spec phase)** | Either delete `usePersonHeroCards` if confirmed unused, or document its intended caller and align its cache key with `usePairedCards`. |

---

### 🟡 HF-2 — `holidayCardsService.ts` is a stub (functions removed, only types remain) but still exports `supabase` and `supabaseUrl` re-imports it never uses

| Field | Value |
|-------|-------|
| **File + line** | [services/holidayCardsService.ts:9-13](app-mobile/src/services/holidayCardsService.ts#L9-L13) |
| **What** | The file's docstring says: *"Kept imports: `supabase` and `supabaseUrl` are unused after the function deletions but are safe-harmless re-exports if any future code path needs them"*. The file still imports `supabase, supabaseUrl` from `./supabase` and never references them. |
| **Hidden flaw** | Constitution #8 (subtract before adding). The file should have been collapsed in ORCH-0573 backlog (per its own TODO). The lingering re-imports are dead weight and a magnet for accidental future use. |
| **Action** | Already tracked per file's own ORCH-0573 backlog comment. Bundle into RC-1 cleanup if convenient; otherwise leave for ORCH-0573. |

---

### 🟡 HF-3 — `PersonGridCard.tsx` exists but is **not mounted** by PersonHolidayView; the screen uses an inline `CompactCard` instead

| Field | Value |
|-------|-------|
| **File + line** | [components/PersonGridCard.tsx](app-mobile/src/components/PersonGridCard.tsx) — entire file. PersonHolidayView imports it ([line 39](app-mobile/src/components/PersonHolidayView.tsx#L39)) but **never instantiates `<PersonGridCard>` anywhere in the file**. CardRow uses inline `<CompactCard>` ([lines 442-486](app-mobile/src/components/PersonHolidayView.tsx#L442-L486)). |
| **Hidden flaw** | Either PersonGridCard is dead at this surface (orphan import — Constitution #8 violation) and exists for some other surface I did not audit, or PersonGridCard was *intended* to replace CompactCard in a redesign that was never finished. Either way, having a sibling card component named `PersonGridCard` next to the inline `CompactCard` is a footgun for future refactors. |
| **Action (spec phase)** | Decide: (a) delete PersonGridCard if confirmed orphan, (b) replace CompactCard with PersonGridCard if the redesign was intended, (c) clarify ownership if PersonGridCard serves another screen (saves list? visits list? recommendations? — not audited this cycle). |

---

### 🟡 HF-4 — Edge fn applies `priceTierFilter` post-RPC against a `priceTier` field that is itself derived from null-defaulted ghost reads

| Field | Value |
|-------|-------|
| **File + line** | [get-person-hero-cards/index.ts:707-719](supabase/functions/get-person-hero-cards/index.ts#L707-L719) |
| **What** | After mapping rows to Cards, edge fn filters: `cards.filter(c => c.cardType === "curated" || !c.priceTier || priceTierFilter!.includes(c.priceTier))`. Because RC-1 guarantees `c.priceTier` is *always* derived (the `??` fallback chain ends at `derivePriceTier(null, raw.price_level)` which returns "chill" if price_level is null, or a Google→Mingla mapping if price_level is present), and there is no path that produces `c.priceTier === null` for a place_pool row, the `!c.priceTier` short-circuit never fires. Cards whose `place_pool.price_level` happens to map to a tier *not in* `priceTierFilter` are silently dropped. The filter is operating on derived (potentially fabricated) tiers, not authoritative ones. |
| **Hidden flaw** | Constitution #9 risk: `derivePriceTier` defaulting to "chill" when price_level is null is a soft fabrication. If a place legitimately has no Google price level, calling it "chill" then filtering by user's tier preference will systematically exclude or include places based on a fabricated default. |
| **Action (spec phase)** | When the mapper is rewritten (RC-1 fix), preserve `null` for unknown price tiers and let the post-filter respect the null short-circuit. Or remove `derivePriceTier` defaults entirely and surface "Price unknown" in the UI. |

---

### 🟡 HF-5 — Three CardRow instances mounted simultaneously can fire 1+N+M parallel RPC calls; staged-dedup gates only the *order*, not the *count*

| Field | Value |
|-------|-------|
| **File + line** | [PersonHolidayView.tsx:737-737](app-mobile/src/components/PersonHolidayView.tsx#L737), [716-734](app-mobile/src/components/PersonHolidayView.tsx#L716-L734), [869-881, 887-924, 933-980](app-mobile/src/components/PersonHolidayView.tsx#L869-L980) |
| **What** | Birthday CardRow (always visible if birthday set) fires immediately. After it loads, custom-holiday CardRows are enabled (with stage-1 exclusion list). After all custom holidays load, standard-holiday CardRows are enabled (with combined exclusion list). The staging is **sequential by stage** but **fully parallel within a stage** — N custom holidays = N concurrent RPC calls; M visible standard holidays = M concurrent RPC calls. At a fully expanded paired-person view with 2 custom holidays + 8 visible standard holidays, that's 1 → 2 → 8 = **up to 11 sequential-batches of RPC calls**, each batch fully parallel. |
| **Hidden flaw** | Even if every call is fast (post-ORCH-0668), this is wasteful. 11 calls fan-in at the auth gateway, contend for connection-pool slots, and each pays the per-call edge function cold-start risk. Constitution #3 risk: if any single call fails, the whole holiday section shows the offline-error UI for that holiday — fragmenting the user experience. |
| **Action (spec phase)** | Consider a single batch RPC `query_person_hero_places_for_holidays(p_user_id, p_person_id, p_holidays JSONB, p_lat, p_lng)` returning a `holiday_key → cards[]` map. Or accept current N+M concurrency and add request-level dedup at React Query (multi-query batching). Current behavior is functional but architecturally fragile. |

---

### 🟡 HF-6 — Edge fn's defensive `?? "chill"` chain in `derivePriceTier` will mask future drift when Google adds a new `PRICE_LEVEL_*` enum value

| Field | Value |
|-------|-------|
| **File + line** | [get-person-hero-cards/index.ts:58-72](supabase/functions/get-person-hero-cards/index.ts#L58-L72) |
| **What** | The `mapping` object covers `PRICE_LEVEL_FREE / INEXPENSIVE / MODERATE / EXPENSIVE / VERY_EXPENSIVE`. If Google ever introduces a new enum value (e.g., `PRICE_LEVEL_LUXURY`), the lookup falls through to `?? "chill"` — silently mis-categorizing the most expensive places as the cheapest. Constitution #3 (silent failure) + Constitution #9 (fabrication) edge case. |
| **Action** | Spec a `?? null` change here so unknown price levels surface as "unknown" rather than being misrepresented as "chill". Same fix in the discover-cards transformer for parity. |

---

### 🔵 OBS-1 — The mapper's docstring at [get-person-hero-cards/index.ts:75](supabase/functions/get-person-hero-cards/index.ts#L75) self-documents the bug

> /\*\* Maps a raw card_pool JSONB row (snake_case) to the Card interface (camelCase). \*/

The function name (`mapPoolCardToCard`), parameter name (`raw`), and the comment all reference `card_pool`. This is direct evidence the function was forked from the legacy `card_pool` shape and the rename to `place_pool` was never propagated. A simple grep for "card_pool" across `supabase/functions/get-person-hero-cards/` returns 4 hits, three of which are stale references (lines 75, 644, 725, 738) — line 738 even references a real schema rename (`person_card_impressions.card_pool_id renamed to place_pool_id`) that contradicts line 75's premise.

### 🔵 OBS-2 — `transformServablePlaceToCard` is the proven-working transformer for the same source table; it is the model for fixing RC-1

The discover-cards edge fn imports `transformServablePlaceToCard` (separate file, not in the manifest read this cycle but referenced at [discover-cards/index.ts:975](supabase/functions/discover-cards/index.ts#L975)). It correctly reads named-column outputs from `query_servable_places_by_signal` and produces card shapes with photos, names, categories, prices. The spec writer should locate that transformer and either reuse it or model the new person-hero transformer on it.

### 🔵 OBS-3 — `cardEngagementService.ts`, `card_engagement` table references, and `user_interactions` table are NOT referenced by the person-hero RPC body

The engagement signal infrastructure exists (mentioned in §2.4 of the dispatch). The person-hero RPC simply doesn't use it. Spec writer can pull from these signal sources when designing the personalization layer.

### 🔵 OBS-4 — Custom holidays funnel through `useHolidayCategories(custom_${holiday.id}, holiday.name)` at [PersonHolidayView.tsx:631](app-mobile/src/components/PersonHolidayView.tsx#L631)

The hook (not read this cycle) ostensibly maps the custom holiday's *user-typed name* to a section/category set via AI generation (`generate-holiday-categories` edge fn — also not read this cycle). So custom holidays may indeed get name-aware section selection, contradicting H-6 of the dispatch (see §8). However, even if AI gives them unique signals, those signals flow through the same defective mapper → same broken cards. The personalization-of-input layer is healthy; the data-shape-of-output layer is broken.

---

## 8 · Hypothesis ledger (each from §3 of the dispatch, marked PROVEN / DISPROVEN)

| H | Statement | Verdict | Evidence |
|---|-----------|---------|----------|
| **H-1** | Person-hero RPC SELECT clause omits photo and detail fields | **PARTIALLY PROVEN.** RPC returns `to_jsonb(pp.*)` which *carries* every place_pool field including `name, stored_photo_urls, primary_type, address, rating, opening_hours, website, description`. The fields ARE present in the JSONB. **The bug is not RPC projection — it is mapper field-name mismatch (RC-1).** The hypothesis was correct in spirit (cards lack photos) but wrong in mechanism. |
| **H-2** | Edge fn shapes response differently than discover-cards (mapper looks for `card.photo` vs `card.photoUrl` etc.) | **PROVEN HIGH.** Confirmed by RC-1 and CF-1. Discover-cards uses `transformServablePlaceToCard` against `query_servable_places_by_signal`'s named-column projection. Person-hero uses `mapPoolCardToCard` against `query_person_hero_places_by_signal`'s `to_jsonb(pp.*)` blob — but reads ghost `card_pool` field names. |
| **H-3** | Place_pool rows returned do not pass post-ORCH-0678 servable contract | **DISPROVEN.** Person-hero RPC enforces full three-gate serving including `is_servable=true AND stored_photo_urls non-empty AND ≠ '__backfill_failed__'` — see [migration:91-95](supabase/migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql#L91-L95). The data DOES pass the gate. The issue is the mapper drops the photo it received. |
| **H-4** | No personalization signals are joined in | **PROVEN HIGH.** RC-3 fully proves it: RPC parameters `p_user_id` and `p_person_id` are unused; ranking is global signal-score within radius bands. The edge fn's pre-RPC personalization is non-ranking (category selection + price post-filter only). |
| **H-5** | No curated/combo branch exists for paired | **PROVEN HIGH.** RC-2 fully proves it: every card forced to `'single'`, no `generate-curated-experiences` invocation, comment self-documents *"curated heroes retired"*. |
| **H-6** | Custom holidays fall through to a default signal set | **PARTIALLY DISPROVEN (mechanism wrong).** Custom holidays funnel through `useHolidayCategories` (OBS-4) which DOES generate per-name AI section selection (custom-holiday key prefix `custom_${id}` triggers a different cache namespace). However, the AI-derived sections still reach the same broken mapper, so custom holidays are equally broken at the *card content* level even though the *category selection* is name-aware. The founder's symptom report ("custom holiday cards are also broken") is correct; the mechanism is shared with built-in holidays (RC-1), not a separate fall-through. |
| **H-7** | Card_pool deprecation removed a denormalized convenience the paired path silently depended on | **PROVEN MEDIUM.** Yes — the `card_pool` table had pre-rendered fields (`title, image_url, category, category_slug, price_tier, price_tiers, tagline, stops, total_price_min/max, estimated_duration_minutes, experience_type, categories, shopping_list, card_type`) that the legacy paired-cards path read directly. ORCH-0640's `query_person_hero_cards` was DROPPED in `20260425000012_orch_0640_drop_legacy_rpcs.sql`. The replacement RPC (person-hero on place_pool) returned the raw place row instead, but the consumer (mapper) was never rewired. **MEDIUM not HIGH because** I did not read the dropped legacy RPC body to confirm field-by-field that the old card_pool projection matched the still-present mapper expectations — but the mapper's docstring at line 75 (OBS-1) and the field-name pattern make it a confident MEDIUM. |
| **H-8** | Two competing person-card hooks exist (`usePairedCards` + `usePersonHeroCards`) | **PROVEN HIGH (HF-1).** Both exist. PersonHolidayView mounts only `usePairedCards`. `usePersonHeroCards` is currently dead code at the runtime level but live at the type-import level. Cache-key divergence is a future-bug risk. |

---

## 9 · Migration audit table (the "brutal" deliverable)

| Migration step | What was promised | What actually happened on the paired path | Status |
|----------------|-------------------|-------------------------------------------|--------|
| Drop card_pool triggers (ORCH-0640) | Replace with signal-scored reads from `place_pool` | RPC was repointed (`query_person_hero_places_by_signal` reads `place_pool` + `place_scores` correctly). **Edge fn mapper was NOT repointed** — still reads `card_pool` field names. Mobile UI types were preserved (`HolidayCard` interface still describes the pre-cutover shape — which is fine, but no bridge code was written from the new RPC shape to that interface). | **PARTIAL — backend done, frontend mapper abandoned mid-flight** |
| Person-hero RPC introduced (ORCH-0640) | Serve birthday + holiday + custom-holiday cards via signals | RPC exists, takes signal IDs, applies three-gate serving, returns `to_jsonb(pp.*)`. Functionally serves rows. **But returns shape that no consumer correctly maps.** | **PARTIAL — RPC works, shape contract broken at consumer** |
| Person-hero RPC perf rewrite (ORCH-0668) | Same shape, faster | Shape preserved verbatim; perf improved 100x. ORCH-0668 closure was correct on its scope. **Did not detect the upstream mapper bug because the QA gate was perf-only.** | **DONE on perf; SHAPE-BUG INHERITED unchanged** |
| Photo-gate on signal queries (ORCH-0634/0678) | Only servable + photo-passing rows reach UI | RPC enforces G3 photo gate (`stored_photo_urls non-empty AND ≠ '__backfill_failed__'`). Data DOES carry photos. **Mapper drops them on the floor by reading `raw.image_url` (which doesn't exist) instead of `raw.stored_photo_urls[0]` or `raw.photos`.** | **APPLIED at DB layer; LOST at mapper layer** |
| Personalization joins (signals + behavior) | Per-user per-pair rank | Edge fn does category-selection personalization (bilateral, custom-holiday blending, shuffle, default modes — all reading `user_preference_learning`). **RPC has zero personalization joins.** Ranking is global signal-score within radius bands. `p_user_id` and `p_person_id` declared but unused. | **PARTIAL — input personalization exists, output ranking is unpersonalized** |
| Curated-combo mix in person view | Holiday-aware combos blended with singles | Comment in edge fn confirms intent: *"all single cards post-ORCH-0640; curated heroes retired"*. No invocation of `generate-curated-experiences`. Mobile `Card.cardType: "single" \| "curated"` permits curated, but no code path emits one. | **DROPPED — explicitly removed in ORCH-0640 ch06; no replacement scheduled** |
| Custom-holiday → signal mapping | Each custom name maps to a deterministic signal set | `useHolidayCategories('custom_${id}', name)` generates per-name section selection via the `generate-holiday-categories` edge fn (not read this cycle). So custom holidays do receive name-aware signals (better than H-6 predicted). **But the resulting cards still flow through the broken mapper.** | **EXISTS at section-selection layer; LOST at card-content layer** |

**Summary:** Of 7 migration commitments, **0 are fully done at the user-visible contract**. 2 are done at the immediate technical layer (RPC shape preserved across ORCH-0668; photo-gate applied at DB) but the value is lost at the mapper. 4 are partially done (consumers not rewired). 1 was deliberately dropped (curated-combo) without a replacement.

---

## 10 · Blast radius

| Surface | RPC / source | Mapper / transformer | Affected by RC-1/2/3? | Confidence |
|---------|--------------|----------------------|------------------------|------------|
| **Paired-person birthday hero CardRow** | `query_person_hero_places_by_signal` (to_jsonb) | `mapPoolCardToCard` (broken) | **YES — all three RCs** | H |
| **Paired-person Custom-Holiday CardRow** | same | same | **YES — all three RCs (custom holidays additionally have name-aware sections per OBS-4 but cards equally broken)** | H |
| **Paired-person Upcoming-Holiday CardRow** | same | same | **YES — all three RCs** | H |
| Discover singles deck (Discover screen, solo + collab) | `query_servable_places_by_signal` (named cols) | `transformServablePlaceToCard` | **NO — different RPC, different transformer, proven working** | H |
| Curated experiences (Discover curated branch) | `fetch_local_signal_ranked` + combo planner | `generate-curated-experiences` post-hydration | **NO — different RPC, separate hydration path; ORCH-0677 closed Grade A 2026-04-25 confirmed working** | H |
| Saved cards (`useSavedCards`, `usePairedSaves`) | `saved_cards` table direct read | Service maps own shape | **NO — saved card payload was persisted at save time with the *then-correct* shape; old saves may have stale category data but not the no-photo no-name issue** | M (would benefit from a targeted check that the save-time payload is whole — see §11) |
| Map cards (`useMapCards`, `usePairedMapSavedCards`) | Map-specific read paths | Map-specific renderers | **NOT INVESTIGATED** — adjacent surface, may share types but not the mapper. Spec writer should sweep when fixing. | L |
| Board cards (`boardCardService`) | Board-specific read paths | Board-specific renderers | **NOT INVESTIGATED** — same as above | L |
| Visits (`usePairedUserVisits`) | `user_visits` or similar table | Visits payload coercion | **NOT INVESTIGATED** — separate surface | L |
| Admin dashboard (place_pool browser) | Admin RPCs | Admin UI | **NO — admin reads `place_pool` directly via Supabase client** | H |
| `usePersonHeroCards` hook (parallel hook, currently unmounted) | Same edge fn | Same broken mapper | **YES if ever mounted** — currently dead-code-but-live-import (HF-1) | H |
| `PersonGridCard` component (orphan import in PersonHolidayView) | n/a — only consumes pre-shaped cards | Different render code | **YES indirectly — it's prop-fed from `imageUrl, title, category` which are exactly the broken fields**. If anyone routes broken cards into it, same render symptoms. | H |

**Single-surface immediate blast:** all three CardRow classes on the paired-person view share the same broken pipeline. **Cross-surface latent blast:** the saved-cards and map-cards paths use different mappers but share the underlying `Card`/`HolidayCard` type contract — if a future refactor consolidates mappers without thinking about RC-1, the bug propagates. **No solo/collab-parity violation** — solo Discover singles use a completely different RPC + transformer and are demonstrably healthy.

---

## 11 · What was NOT investigated and why

### Out of scope this cycle (with explicit unblocking actions)

1. **Live-fire JSON capture from a real paired user with custom + upcoming holidays.** Would byte-confirm RC-1's predicted card shape (title="Unknown", imageUrl=null, etc.) and quantify CF-2's personalization-fallback rate.
   - **Unblocking action:** `curl -X POST https://<project>.supabase.co/functions/v1/get-person-hero-cards -H "Authorization: Bearer <real user JWT>" -d '{"pairedUserId":"<real paired uuid>","holidayKey":"birthday","categorySlugs":["romantic","play","upscale_fine_dining"],"curatedExperienceType":"romantic","location":{"latitude":35.7796,"longitude":-78.6382},"mode":"default","excludeCardIds":[]}'` for 3 (user, person, holiday) tuples. Capture and inspect each card's full JSON.
   - **Why deferred:** Code-trace evidence is mathematically deterministic for RC-1 (the assignment `(raw.title as string) ?? "Unknown"` against a row that has no `title` column is provably "Unknown"). Live-fire adds independent confirmation but does not change the spec scope.

2. **`pg_get_functiondef` byte-comparison of the deployed `query_person_hero_places_by_signal` body.** Would confirm no out-of-band hand-edit since ORCH-0668 deploy.
   - **Unblocking action:** `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'query_person_hero_places_by_signal';` — diff against `migrations/20260428000001_orch_0668_person_hero_rpc_sql_rewrite.sql:47-153`.
   - **Why deferred:** ORCH-0668 closed Grade A two days ago with byte-verification implicit in deploy. Drift since then is unlikely.

3. **`transformServablePlaceToCard` source read.** Would confirm the precise field-name pattern the spec should mirror.
   - **Unblocking action:** Read the file (likely under `supabase/functions/_shared/` or `supabase/functions/discover-cards/`).
   - **Why deferred:** Not strictly needed for the investigation conclusion; needed for the spec.

4. **`generate-holiday-categories` edge fn body.** Would confirm OBS-4's claim that custom-holiday names get AI-derived sections.
   - **Unblocking action:** Read `supabase/functions/generate-holiday-categories/index.ts` and `app-mobile/src/hooks/useHolidayCategories.ts`.
   - **Why deferred:** Custom-holiday section selection is healthy enough that the RC-1/2/3 fix doesn't depend on it.

5. **`PersonGridCard` other-surface usage audit.** Would settle HF-3 (orphan vs intended-replacement).
   - **Unblocking action:** `grep -rn "PersonGridCard" app-mobile/src/`.
   - **Why deferred:** Doesn't affect the RC fix scope; cleanup item for the spec.

6. **`saved_cards` / map-cards / board-cards mapper sweeps.** Would confirm cross-surface isolation.
   - **Unblocking action:** Read `savedCardsService.ts`, `pairedSavesService.ts`, `boardCardService.ts`, and any `useMapCards.ts` data shape; verify they don't share `mapPoolCardToCard`.
   - **Why deferred:** Spec writer should sweep; investigator confidence is M-to-H that they're isolated.

7. **`person_card_impressions` table schema and the post-RC fix migration consequences.** The edge fn writes impressions keyed on `place_pool_id` — confirmed via comment at line 738 — but I did not read the table schema directly.
   - **Unblocking action:** `\d person_card_impressions` or read `migrations/20260425000008_orch_0640_person_impressions_pivot.sql`.
   - **Why deferred:** Impression-write success is orthogonal to the card-shape bug.

### Solo + collab parity

The dispatch required a parity check. **Confirmed: no parity violation.** The bug is paired-person-specific because the *RPC* (`query_person_hero_places_by_signal`) is paired-person-specific. Solo Discover singles use `query_servable_places_by_signal` + `transformServablePlaceToCard` and produce real cards (proven by ORCH-0677 / discover-cards continuing to work). Solo curated uses `fetch_local_signal_ranked` + the curated planner (proven by ORCH-0677 closure). The card_pool → place_pool migration was completed for both solo paths but abandoned mid-flight only for paired-person.

---

## 12 · Open questions for product/founder (UX intent required before spec)

1. **Combo composition (RC-2 fix scope):** When showing a CardRow under, say, "Valentine's Day" on a friend's profile — do you want (a) **mostly singles with 1-2 curated combos prepended**, (b) **alternating singles and combos**, (c) **2 curated combos at top + horizontal scroll of singles**, or (d) something holiday-driven (Valentine's = curated romantic dinner-and-drinks combo + 5 singles; birthday = curated celebration combo + variety singles; custom = blended-pref combo + singles)? Need a rule, not a one-off. Recommend (d) for richness; (c) for simplicity.

2. **Personalization depth (RC-3 fix scope):** How deep should personalization push into the *ranking*?
   - **Option A — Signal weight only:** Boost signal scores using paired user's saved-categories vector. Simple SQL change. ~80% of perceived personalization.
   - **Option B — Joint pair history:** Also boost places either user has saved/visited individually OR in this pair. Requires a join table but big perceived value.
   - **Option C — Full behavioral vector:** Plus engagement decay (places swiped-left lose rank), recency, time-of-day. Complex; probably overkill for v1.
   Recommend **Option B** as the right balance.

3. **Custom-holiday signal interpretation (re: OBS-4):** When the user creates a custom holiday named *"Mom's Birthday Dinner"*, should the system (a) keep using `useHolidayCategories` AI generation (which I haven't read but trust to do something semantic), (b) fall through to `DEFAULT_PERSON_SECTIONS`, or (c) ask the user to pick a holiday template at creation time? Currently the answer is (a) — confirm that's still the intent.

4. **Bilateral mode default (CF-3 fix scope):** When a paired-person view loads and the other user IS a Mingla user with preference data, should bilateral mode be **default-on** or **opt-in via a visible toggle**? The current toggle is hidden; the founder may have intended one or the other.

5. **`derivePriceTier` defaulting to "chill" when price unknown (HF-4/HF-6):** Should unknown price levels render as **(a) "Price unknown", (b) suppress the price line entirely, or (c) keep defaulting to "chill"**? Recommend (b) — silently suppressing avoids fabrication and visual clutter.

6. **`PersonGridCard.tsx` orphan (HF-3):** Was this component intended to replace the inline `CompactCard`? If yes, the spec should bundle the swap; if no, delete it.

7. **`usePersonHeroCards` parallel hook (HF-1):** Delete or repoint? Recommend delete after confirming no live mount.

---

## 13 · Recommended spec scope (line items, no design)

The follow-on spec should cover **at minimum**:

### Layer: Edge function `get-person-hero-cards/index.ts`

1. **Rewrite `mapPoolCardToCard`** to read actual `place_pool` field names (`name, stored_photo_urls, photos, primary_type, types, opening_hours, address, lat, lng, rating, review_count, price_level, price_range_start_cents, price_range_end_cents, website, description`). Map to existing `Card` interface honestly (no fabrication). Mirror `transformServablePlaceToCard` shape decisions.
2. **Source `category` from `primary_type` + Mingla's 13-category mapping** (per `mingla-categorizer` skill rules; `place_pool.primary_type` is Google's primary type). Decide whether to read a precomputed `place_pool.mingla_category` column (if it exists — verify) or compute live in the edge fn.
3. **Source `imageUrl` from `stored_photo_urls[0]`** (with the post-ORCH-0678 servable contract, this is guaranteed non-null and not the `__backfill_failed__` sentinel).
4. **Source `priceTier` from `price_level` + Mingla's price-tier rules** (per `mingla-price-tiers` skill); preserve `null` for unknown rather than defaulting to "chill" (HF-4/HF-6).
5. **Source `isOpenNow`** from `opening_hours.openNow` (Constitution #9 — never fabricate; this is the lesson from ORCH-0677.QA-1).
6. **Compute `distanceM` from haversine of `place_pool.lat/lng` and request location** (the RPC already computes this internally for sorting; have it project `distance_m` so the mapper doesn't recompute).
7. **Add a curated-combo branch** (RC-2 fix). When `effectiveCuratedType` is non-null, invoke the combo planner (likely call `generate-curated-experiences` internally or share its `fetch_local_signal_ranked` + planner module). Decide composition rule per Open Question #1.
8. **Plumb `mode: "bilateral"` end-to-end** (CF-3): widen the mobile `personHeroCardsService` type, plumb `bilateralMode` from PersonHolidayView through CardRow → usePairedCards → service.
9. **Tighten the `priceTierFilter` post-filter** to handle `null` priceTier without short-circuiting incorrectly (HF-4).

### Layer: Database `query_person_hero_places_by_signal`

10. **Add personalization to the ranking** (RC-3 fix). Per Open Question #2, choose Option A/B/C. If B (recommended): join `saved_cards` on `(user_id IN (p_user_id, p_person_id))` and add a small score boost; join `paired_saves` similarly; join `card_engagement` for swipe-left penalty. Decide weight constants in spec.
11. **Optionally project `distance_m` and `signal_id` onto the JSONB** so the mapper has them (or change the return contract to named columns per CF-1 option A).
12. **Either:** project named columns (CF-1 option A) for type-safety, **or:** keep `to_jsonb(pp.*)` and treat the mapper rewrite as the safety layer (CF-1 option B). Spec must choose explicitly.

### Layer: Mobile

13. **Decide `usePersonHeroCards` fate** (HF-1) — delete or align with `usePairedCards`.
14. **Decide `PersonGridCard` fate** (HF-3) — delete or wire into CardRow.
15. **Plumb `bilateralMode` through the prop chain** (CF-3, item 8 above).
16. **Refactor `holidayCardsService.ts`** to drop unused imports (HF-2; tracked under ORCH-0573).

### Layer: Constants / shared

17. **Move `INTENT_CATEGORY_MAP` and `CATEGORY_SLUG_TO_SIGNAL_ID` to a shared location** so the same mapping is used by `discover-cards`, `get-person-hero-cards`, and `generate-curated-experiences`. Currently each edge fn has its own copy (drift risk).

### Layer: CI / regression prevention

18. **Add an invariant `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER`**: any edge fn mapper that consumes a JSONB blob from an RPC must declare expected field names in a TypeScript interface that the test suite can validate against the RPC's actual projection (live DB query in CI).
19. **Add a CI smoke test** for `get-person-hero-cards`: invoke at a known-good Raleigh location with known-good signal IDs; assert every returned card has `title !== "Unknown"`, `imageUrl !== null`, `category !== ""`. This is the structural defense that would have caught the bug pre-merge.
20. **Audit other edge functions** for `to_jsonb(*)` consumers reading ghost fields — `grep -rn "to_jsonb" supabase/migrations/` and cross-check each consumer.

### Layer: Test plan

21. **Test matrix**: solo / paired × birthday / custom / standard holiday × default / shuffle / bilateral mode × known-good city (Raleigh) / sparse city (rural) × cold-start user (no preferences) / warm-start (10+ swipes). At least 24 test cases with explicit pass criteria per card field.

---

## 14 · Confidence

**Overall: HIGH.**

- RC-1: HIGH (mathematically deterministic from static analysis; field name mismatch between source schema and consumer code is non-stochastic).
- RC-2: HIGH (unconditional `'single'` argument + self-documenting comment).
- RC-3: HIGH (RPC body verbatim shows unused parameters).
- CF-1: HIGH (two migrations compared, contract diff is unambiguous).
- CF-2: HIGH (code path explicit).
- CF-3: HIGH (type-vs-type comparison).
- HFs: HIGH for code-trace items (HF-1, HF-2, HF-3, HF-4, HF-6); MEDIUM for architectural concern (HF-5).
- Hypothesis ledger: 6/8 fully resolved high; 2 partially resolved with explicit mechanism corrections (H-1 spirit-correct mechanism-wrong; H-6 mechanism is shared, not separate).
- Migration audit: HIGH on every row except H-6 corollary (custom-holiday section selection — which is OBS, not a finding).
- Blast radius: HIGH for paired surfaces; M for saved-cards; L for map/board/visits (explicit in §10).

The single uncertainty bar I would raise is the runtime JSON capture (§11 item 1). It would take ~15 minutes of curl + JSON inspection to convert the M-confidence runtime row in §6's grid to H. The investigation conclusion does not depend on it; the spec scope does not change without it; but the founder may want it as a "look, here is the actual broken card we shipped" artifact before authorizing spec dispatch. Recommend running it as a 15-minute pre-spec sanity check.

---

## 15 · Discoveries for orchestrator

| ID | Title | Severity | Notes |
|----|-------|----------|-------|
| **ORCH-0684.D-1** | Audit `usePersonHeroCards` parallel hook for any live mount | P3 | HF-1. Likely safe to delete after grep; bundle with RC-1 spec. |
| **ORCH-0684.D-2** | `holidayCardsService.ts` dead re-imports cleanup | P4 | HF-2. Already tracked as ORCH-0573 backlog. |
| **ORCH-0684.D-3** | `PersonGridCard.tsx` orphan-vs-intended-replacement audit | P3 | HF-3. Cross-surface usage check needed. |
| **ORCH-0684.D-4** | `derivePriceTier` "chill" default fabrication risk | P3 | HF-4 + HF-6. Same fix in discover-cards transformer for parity. |
| **ORCH-0684.D-5** | Cross-surface mapper sweep (saved_cards, map-cards, board-cards) | P3 | §10 blast-radius L items. 30-minute grep + read. |
| **ORCH-0684.D-6** | `INTENT_CATEGORY_MAP` + `CATEGORY_SLUG_TO_SIGNAL_ID` duplicated across edge fns | P3 | Spec line item 17. Future drift risk; consolidate to shared module. |
| **ORCH-0684.D-7** | Concurrency / fan-in concern: 1+N+M parallel RPC calls per paired-person view mount | P3 | HF-5. Functional but architecturally fragile; consider batch RPC. |
| **ORCH-0684.D-8** | ORCH-0668 closure-quality post-mortem: perf-only QA missed mapper shape bug | P3 | The ORCH-0668 QA gate did not include "captured cards display real content." Recommend adding an end-to-end visual smoke test to QA gates for any RPC-touching change. |
| **ORCH-0684.D-9** | Invariant proposal: `I-RPC-RETURN-SHAPE-MATCHES-CONSUMER` | P3 | Spec line item 18. Structural defense against this bug class. |
| **ORCH-0684.D-10** | `bilateralMode` UI hidden but state plumbed half-way (CF-3 + Open Q #4) | P3 | Need product call before fully wiring; tracked in spec scope. |

---

**End of investigation.**

This report is paper-trail-ready for the orchestrator's REVIEW gate. No code was written. No agent skills were invoked. The next step in the pipeline is **orchestrator REVIEW** of these findings, then **SPEC dispatch** with §13 as the scope skeleton.
