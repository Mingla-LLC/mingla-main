# SPEC — ORCH-1186-A: Venue Hours Unification + Editable Settings Tab

**META:** META-ORCH-1186 (Venue Creation → Management Unification) · **Leg 1 of 4 (FOUNDATION, FIRST)**
**Mode:** SPEC (forensics). No product code written here — this is a binding contract.
**Worktree:** `~/Desktop/mingla-orchs/1186-[venue-unify]` · **Branch:** `1186-venue-unify` (at origin/main `89ab7f3ff`, INCLUDES the ORCH-1184 #580 venue command-center desktop redesign).
**Charter:** `Mingla_Artifacts/specs/CHARTER_META-ORCH-1186_VENUE_UNIFICATION.md`
**Locked decision honored:** DEC-B — `brand_hours` is the CANONICAL single owner of opening hours; `venue_availability_config.service_periods` SEEDS/DERIVES from it, never competes.
**Date:** 2026-06-21

> This SPEC was written against the live code in the worktree, re-verified post-#580. Every load-bearing claim is pinned to a real file:line below.

---

## 1. Executive summary

A venue created in the business app writes its 7-day opening hours to the `brand_hours` table (creation RPC `biz_create_venue_brand_authoring`, migration `20260809000000_meta_orch_1009_sub_e_business_supply_feeder.sql:400-428`). The reservation availability engine, however, reads a SEPARATE source — `venue_availability_config.service_periods` (`20261003000002_orch_1148_venue_availability_config.sql`) — that has **no seed bridge** from `brand_hours`. Result: a venue that set hours at creation shows BLANK service periods in the management Availability module, and the Settings tab shows only a dead-end read-only summary ("Your opening hours come from your venue profile…", `VenueSettingsModule.tsx:374-380`) with no editor. The engine also returns zero slots when no config row exists at all (`pg_venue_available_slots` … `IF NOT FOUND THEN RETURN`, `20261008000001_orch_1148_available_slots_rpc_v2.sql:128-133`).

This leg makes `brand_hours` the single owner and bridges it to `service_periods`:
- a **migration backfill** that seeds/creates `venue_availability_config` for every existing venue from its `brand_hours`, without clobbering operators who manually authored service periods;
- a **live bridge** so every future hours write (creation + edit) re-derives the baseline service periods;
- a **Settings tab** that becomes the single editable home for hours AND every other creation-captured field (no read-only dead-ends), reusing the existing capture components;
- retirement of the read-only "Hours" + "Venue profile" summary blocks in `VenueSettingsModule.tsx`.

Because the public venue page (`/b/{slug}`) already reads hours from `brand_hours` via the `claimed_venues_public_view` aggregate (`20260622000000_ve4_claimed_venues_public_view.sql:116-118`), editing hours in Settings updates the public page automatically through the single source — no separate write.

---

## 2. Scope & non-goals

### In scope
1. **Hours single-owner data contract** — a SQL helper `biz_derive_service_periods_from_brand_hours(p_brand_id)` invoked from BOTH hours write paths (creation + edit), a one-shot migration backfill for existing venues, and the non-clobber merge rule.
2. **Settings tab editors** — make the venue-suite Settings module the single editable home for every creation-captured field (enumerated in §4). Reuse existing capture components; deep-link reuse is acceptable for the heavy AI-scored fields where a dedicated re-run flow already exists, but the dead-end read-only summaries are replaced by real editors or live-data summaries with working edit affordances.
3. **Retire read-only summaries** — `VenueSettingsModule.tsx:357-380`.
4. A **monotonic migration** + a **fails-on-revert regression-test contract**.

### Non-goals (explicitly OUT)
- **Do NOT delete or restructure `venue_availability_config`.** Only `service_periods` derives from hours. `turn_times`, `buffer_minutes`, `max_reservations_per_slot`, `slot_granularity_minutes`, `advance_window_days`, `min_notice_minutes`, `iana_timezone`, and all `venue_blackouts` are reservation-specific config and STAY operator-owned in the Availability module (charter Leg-1 Hard guard).
- **No Overview → Intelligence work** (Leg 2 / ORCH-1186-B).
- **No menu builder** (Leg 3) and **no blast entry point** (Leg 4).
- **No new AI-scoring logic.** The "Recommend me" re-run already exists (deck-readiness flow); Settings only needs a working entry point to it, not a re-implementation.
- **No change to the consumer reserve surface or the engine's return shape** (`pg_venue_available_slots` signature is FROZEN per `20261008000001`'s header).
- **No buyer billing-address / "Calculate tax" field** (extends I-PROPOSED-1148-NO-BUYER-TAX-FORM; gate `orch-1148-no-buyer-tax-form-in-venue-settings.mjs`).

### Assumptions
- The Settings tab continues to mount inside `VenueSuiteShell` via the `settings` module (`venueModules.ts`).
- `brand_hours` keeps its **0=Monday … 6=Sunday** weekday convention (`20260613000000_ve1_physical_venue_brand_onboarding.sql:79`, `venueBrandHours.ts:1`). `service_periods.days[]` uses **Postgres `EXTRACT(dow)` = 0=Sunday … 6=Saturday** (`20261008000001:196-209`, `venueReservation.ts:154`). The bridge MUST remap. This is load-bearing and is the single most error-prone detail of this leg.

---

## 3. Cross-Surface Impact Declaration (MANDATORY)

| # | Surface | Covered | User-visible behavior | Files touched here | Parity |
|---|---------|---------|------------------------|--------------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Indirect | Reserve picker shows slots that now reflect the venue's real hours (because the config is seeded). No app-mobile code changes. | none | Automatic (shared engine RPC) |
| 2 | Consumer Android (`app-mobile/`) | Indirect | Same as iOS. | none | Automatic (shared engine RPC) |
| 3 | Buyer/anon Web (`mingla-business` `/b/{brandSlug}`) | Indirect | Public venue page hours come from `brand_hours` via `claimed_venues_public_view` already; editing hours in Settings updates the page through the single source. No buyer-web code changes. | none | Automatic (single source) |
| 4 | Business iOS (`mingla-business`) | **YES — primary** | Availability service periods are pre-seeded (no longer blank); Settings tab has a working 7-day hours editor + editors/edit-affordances for every creation field; read-only dead-ends gone. | §4 component + hook + service + migration | Manual (RN; same JS bundle as Android) |
| 5 | Business Android (`mingla-business`) | **YES — primary** | Same as Business iOS. | same as iOS | Manual (verify Android date picker path in `VenueStep4Hours` — `display="default"`) |
| 6 | Admin Web (`mingla-admin/`) | Not covered | Admin approval queue unchanged. | none | — reason: this leg does not touch the claim-review flow. |
| 7 | Business Web preview (`mingla-business` desktop) | YES (adjacent) | Settings module renders in the desktop two-column suite shell (`hub/listing.tsx` `isWideDesktop` branch); the new editors must render in that workspace too. | same Settings component | Manual (one component, two layouts) |

---

## 4. Layered specification

### 4.1 Database

#### 4.1.1 New shared derive helper (the single bridge)

Create `public.biz_derive_service_periods_from_brand_hours(p_brand_id uuid)` `RETURNS void`, `LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp`.

Contract:
1. **Ensure a config row exists.** `INSERT INTO venue_availability_config (brand_id, place_pool_id) … ON CONFLICT (brand_id) DO NOTHING`, sourcing `place_pool_id` from `brands.place_pool_id` for the brand. This is required because `pg_venue_available_slots` returns zero rows when the config row is absent (`20261008000001:128-133`). Let the `iana_timezone` default to `'UTC'`; the existing validate trigger (`20261008000000:48-68`) normalizes it. (Backfill TZ from location only in the one-shot migration — §4.1.2 — not in this per-brand helper, to avoid coupling the helper to place_pool geography.)
2. **Build derived service periods from `brand_hours`.** For each `brand_hours` row where `is_closed = false` AND `open_time IS NOT NULL` AND `close_time IS NOT NULL`, emit one service-period object:
   ```
   { "name": "Open", "days": [<pg_dow>], "start": "HH:MM", "end": "HH:MM", "type": "derived_from_hours" }
   ```
   where `pg_dow = (brand_hours.weekday + 1) % 7` (Mon=0→1, …, Sun=6→0), and `start`/`end` are `to_char(open_time,'HH24:MI')` / `to_char(close_time,'HH24:MI')`. The engine matches `days[]` against `EXTRACT(dow FROM p_date)` (`20261008000001:196-209`), so the remap is mandatory. One period per open day (do NOT attempt to collapse same-time days into shared `days[]` arrays — per-day rows are simplest, correct, and round-trip cleanly).
3. **Merge rule — DO NOT clobber operator overrides.** Apply the derived periods ONLY when the venue has NOT manually authored service periods. Decide "manually authored" by: the existing `service_periods` is empty (`'[]'::jsonb` / NULL) **OR** every element of the existing `service_periods` carries `"type" = "derived_from_hours"` (i.e. it was previously seeded by this same helper and never operator-edited). If ANY existing element lacks `type = "derived_from_hours"`, the operator has customized the reservation clock → leave `service_periods` UNTOUCHED (the helper still ensures the row exists per step 1, but does not overwrite periods). The `"type":"derived_from_hours"` tag is the durable provenance marker that makes the helper idempotent and override-safe.
4. **Idempotent.** Running the helper twice with unchanged hours yields identical `service_periods`. Update `updated_at = now()` only when periods actually change.

`REVOKE ALL … FROM PUBLIC`; `GRANT EXECUTE … TO authenticated, service_role` (it is called from `SECURITY DEFINER` RPCs that already gate on brand membership).

#### 4.1.2 One-shot backfill (in the same migration)

After defining the helper, run a backfill DO-block / `SELECT` over every brand that has at least one `brand_hours` row:
- First ensure/seed via the TZ-aware path: for any brand WITHOUT a `venue_availability_config` row, `INSERT` one and set `iana_timezone` using the SAME country/offset mapping already proven in `20261008000000:73-111` (reuse that exact CASE expression; do not invent a new mapping). For brands that already have a config row, leave `iana_timezone` as-is.
- Then call `public.biz_derive_service_periods_from_brand_hours(b.id)` for each such brand. The non-clobber merge rule (§4.1.1 step 3) protects any venue that manually entered service periods during the ORCH-1148 era.

Expected live effect: every existing venue with hours gets a config row + `service_periods` seeded from its hours, UNLESS it already had operator-authored (non-`derived_from_hours`) periods.

#### 4.1.3 Wire the live bridge into both write paths

- **Creation:** `CREATE OR REPLACE FUNCTION public.biz_create_venue_brand_authoring(...)` — append, after the `brand_hours` insert loop (`20260809000000:400-428`) and BEFORE `RETURN v_brand_id`, a `PERFORM public.biz_derive_service_periods_from_brand_hours(v_brand_id);`. (Full `CREATE OR REPLACE` re-stating the current body verbatim with this one added line; the signature + arg list + REVOKE/GRANT block are unchanged.)
- **Edit:** `CREATE OR REPLACE FUNCTION public.biz_upsert_brand_hours(p_brand_id uuid, p_hours jsonb)` — append, after the insert loop (`20260614000000_ve1_pr_review_hardening.sql`), `PERFORM public.biz_derive_service_periods_from_brand_hours(p_brand_id);`. (Re-state the current body verbatim + this one line.) This is THE live bridge: editing hours in Settings calls `upsertBrandHours` → `biz_upsert_brand_hours` → re-derives the reservation baseline.

No RLS changes. `brand_hours` RLS already grants admin-plus write (`20260613000000:112-129`); `venue_availability_config` RLS already grants manager-plus write (`20261003000002:62-66`); the helper runs `SECURITY DEFINER` and is only reachable through already-gated RPCs.

#### 4.1.4 Migration file

`supabase/migrations/20261116000000_orch_1186_a_hours_single_owner_seed.sql`. Verified monotonic: current max in worktree is `20261115000000` (`20261115000000_orch_1183_pg_public_experience_by_slug.sql`); scanned sibling worktrees (`META-ORCH-1187-[growth-analytics-hub]`, `orch-1185-[experience-reserve-polish]`) — none claim a slot ≥ `20261116`. Apply via the Supabase Management API (never `supabase db push`) per `feedback_edge_deploy_and_migration_apply_hazards`. `BEGIN; … COMMIT;`. Additive-only (one new function + two `CREATE OR REPLACE` + one backfill).

### 4.2 Edge functions
None. (Hours + service periods are pure DB; the AI re-run uses the existing `run-business-place-authoring-pipeline` function unchanged.)

### 4.3 Service layer

`mingla-business/src/services/brandsService.ts`:
- **Reuse** `upsertBrandHours(brandId, hours)` (`:338-350`) for the hours editor save. No signature change.
- **ADD a read path** `fetchBrandHours(brandId): Promise<BrandHourEntry[]>` — there is currently NO business-app read of `brand_hours` for the brand's own management view (the only reads are the public-page view `publicEventsService.ts:646` and the creation draft). Implement as a direct `supabase.from("brand_hours").select("weekday, open_time, close_time, is_closed").eq("brand_id", brandId).order("weekday")` (RLS owner-select policy `20260613000000:98-110` admits it), mapped to `BrandHourEntry[]` (`HH:MM:SS` → keep the existing `BrandHourEntry` string shape used by `VenueHoursTable`). Return all 7 weekdays, filling any missing weekday as `{ weekday, openTime:null, closeTime:null, isClosed:true }`.
- All other creation fields (name, tagline, bio, website, contact, cover) already persist through `useUpdateBrand` → existing brand-update RPC (`BrandEditView.tsx` + `app/brand/[id]/edit.tsx`). No new service for those.

### 4.4 Hook layer

`mingla-business/src/hooks/` — ADD `useBrandHours.ts`:
- `useBrandHours(brandId: string | null): UseQueryResult<BrandHourEntry[]>` — query key `["brandHours", brandId]` from a small key factory `brandHoursKeys.byBrand(brandId)`; `enabled = isAuthReady && brandId` (mirror the `useVenueAvailability` enabled/disabled-key pattern at `useVenueAvailability.ts:88-101`); `staleTime: 30_000`; `queryFn` → `fetchBrandHours`.
- `useUpsertBrandHours(brandId): UseMutationResult<void, Error, BrandHourEntry[]>` — `mutationFn` → `upsertBrandHours`; `onSuccess` → invalidate `brandHoursKeys.byBrand(brandId)` AND `venueAvailabilityKeys.config(brandId)` (the live bridge changed `service_periods`, so the Availability module's cached config is now stale — this cross-invalidation is REQUIRED for §5 SC-3). Optional optimistic update of the hours cache; correctness-required is the invalidation of BOTH keys.

Do NOT park hours in Zustand (constitution #14 / ownership) — server state belongs in React Query.

### 4.5 Component layer

#### 4.5.1 Extract a reusable presentational hours editor (subtract-before-adding)

`VenueStep4Hours.tsx` is hard-wired to `useDraftVenueStore` (`:69-71`) so it cannot be reused as-is for a live brand. Refactor:
- Extract the row-rendering + time-picker UI into a controlled component `mingla-business/src/components/venue/BrandHoursEditor.tsx` with props `{ hours: BrandHourEntry[]; onChange: (next: BrandHourEntry[]) => void; showErrors?: boolean }`. Move the existing JSX (`VenueStep4Hours.tsx:168-345`), the bulk-set bar, the iOS/Android `DateTimePicker` modal logic, and the `hmToDate`/`dateToHm` helpers into it. Preserve every behavior (bulk weekday set, per-day open/close pickers, validation copy `:104-116`).
- Rewrite `VenueStep4Hours.tsx` as a THIN wrapper that binds the draft store to `<BrandHoursEditor hours={draftHours} onChange={setDraftHours} showErrors={showErrors} />`. The wizard's behavior must be byte-equivalent (existing wizard tests must still pass).

This satisfies the charter's "reuse creation step components (subtract-before-adding)" hard guard: one editor, two consumers (wizard draft + live Settings).

#### 4.5.2 Settings module rework — `VenueSettingsModule.tsx`

Keep sections 1, 2, 6 (Reservations toggle, Reservation fee, Cancellation/no-show — `:212-353`) UNCHANGED.

Replace the read-only dead-ends:
- **DELETE the read-only "Hours" section (`:374-380`).** Replace with a real **"Opening hours"** section that:
  - reads via `useBrandHours(brandId)`;
  - renders `<BrandHoursEditor hours={data} onChange={setLocalHours} />` inside a local draft state, with a **Save** button that calls `useUpsertBrandHours(brandId).mutate(localHours)`;
  - shows loading / error / saving states (constitution); a manager-plus gate (`canMutate`, already computed `:100`) disables the editor for non-managers with the existing read-only note (`:405-409`);
  - on save success, surfaces a short confirmation and relies on the dual cache invalidation (§4.4) so the Availability module re-reads the seeded periods.
- **Replace the read-only "Venue profile" section (`:357-372`)** — keep a compact live summary (name/city) but make the editing first-class. Two acceptable patterns; pick (a) unless design says otherwise:
  - (a) **Inline editors** for the lightweight brand fields the Settings tab should own directly — tagline, description (bio), website, contact email, contact phone, cover media — reusing the SAME input controls + save path as `BrandEditView` (`useUpdateBrand`). This makes Settings the single editable home (charter goal #2) without a navigation dead-end.
  - (b) If inlining all of (a) is too large for this leg, retain a single **"Edit venue details"** affordance that opens the existing edit surface, BUT only for fields not inlined — and the section must NOT read "editing routes to existing surfaces" as a dead-end; it must show the live values and a working control. The charter's "no read-only-summary dead-ends" (goal #2, Done-when (c)) is the bar: a summary with a working edit control passes; a summary with only prose does not.
- **AI signal scores + "Recommend me" re-run, vibe chips, price tiers, gallery, category** — these are the heavy authoring fields surfaced today in the Overview module (`VenueListingContent.tsx`: scores `:340-363`, recommend-edits `:366-375`, gallery/price `:323-328`, edit handler routing to `/venue/deck-readiness` `:174-179`). For this leg, Settings must expose a **working entry point** to each (a "Manage listing & AI scores" / "Re-run Recommend me" / "Edit photos & vibes" control routing into the existing deck-readiness flow with the same `brand_id` + `place_pool_id` params), NOT a re-implementation. This honors charter goal #2 (every creation field is reachable/editable from Settings) while staying inside Leg-1 scope and not entangling with Leg-2's Overview rework. The full relocation of listing-recap content from Overview to Settings is Leg-2's job (charter Leg-2 Done-when); Leg-1 must not LOSE any edit path.

> Note on `place_pool` vs `brands` ownership (per §4 enumeration): hours → `brand_hours`; name/tagline/bio/website/contact/cover → `brands` columns (`types/brand.ts`); gallery/AI signal scores/vibe chips/price tiers/website-for-AI/facets → `place_pool` (`ai_signal_scores`, `business_authoring_inputs`, `stored_photo_urls`) via the authoring pipeline. Settings editors must write to the correct owner table for each field — do not duplicate any field across both.

#### 4.5.3 Field-by-field Settings ownership table (the contract for goal #2)

| Field | Capture component to reuse | Settings location | Read | Write | Table |
|-------|---------------------------|-------------------|------|-------|-------|
| Opening hours (7-day) | `BrandHoursEditor` (extracted §4.5.1) | Settings "Opening hours" section (new) | `useBrandHours` | `useUpsertBrandHours` → `biz_upsert_brand_hours` (+ live bridge) | `brand_hours` |
| Tagline | `BrandEditView` tagline input | Settings "Venue profile" (inline) or edit affordance | `useCurrentBrand`/brand query | `useUpdateBrand` | `brands.tagline` |
| Description (bio) | `BrandEditView` bio input | same | brand query | `useUpdateBrand` | `brands.bio` (combined w/ tagline in `description`) |
| Website | `BrandEditView` website input | same | brand query | `useUpdateBrand` | `brands.website` (`links.website`) |
| Contact email | `BrandEditView` email input | same | brand query | `useUpdateBrand` | `brands.contact_email` |
| Contact phone | `BrandEditView` phone input | same | brand query | `useUpdateBrand` | `brands.contact_phone` |
| Hero cover media | `CoverPickerSheet` | same | brand query | `useUpdateBrand` (+ `syncHeroMedia` for place_pool) | `brands.cover_media_url/type` (+ `place_pool`) |
| Category | (pre-wizard chip; immutable-ish) | Settings read summary + edit affordance | brand query | `useUpdateBrand` (`venue_category`) | `brands.venue_category` |
| Gallery (5–20) | deck-readiness gallery picker (`venueGalleryService`) | Settings "Photos & vibes" entry → deck-readiness | `useBrandPlaceAuthoringContext` | `syncGallery` | `place_pool` |
| Vibe chips | deck-readiness vibe chips | same entry | authoring context | `runTier2Pipeline` | `place_pool.ai_signal_scores` inputs |
| Price tiers | deck-readiness price chips | same entry | authoring context | `runTier2Pipeline` | `place_pool` (`business_authoring_inputs`) |
| AI signal scores + "Recommend me" re-run | deck-readiness review flow | Settings "AI scores / Recommend me" entry → `/venue/deck-readiness` | `useBrandPlaceAuthoringContext` (`ai_signal_scores`, `recommend_edits_remaining`) | `run-business-place-authoring-pipeline` (existing cap = 4) | `place_pool.ai_signal_scores` |
| Website-for-AI / facets | deck-readiness | same entry | authoring context | `runTier2Pipeline`/`confirmAiOutputs` | `place_pool` |

### 4.6 Realtime
N/A.

---

## 5. Success criteria

- **SC-1 (seed on create):** A venue created via `biz_create_venue_brand_authoring` with hours (e.g. Mon–Fri 09:00–17:00, Sat 10:00–14:00, Sun closed) immediately has a `venue_availability_config` row whose `service_periods` contains a `derived_from_hours` entry for each open day, with `days[]` in Postgres-dow (Mon→`[1]`, …, Sat→`[6]`), and NO entry for the closed day.
- **SC-2 (backfill existing):** After the migration, every existing venue with `brand_hours` and no operator-authored periods has a config row with `service_periods` seeded from its hours; the Availability module no longer renders blank service periods for such venues.
- **SC-2b (non-clobber):** A venue whose `service_periods` contains at least one element WITHOUT `type = "derived_from_hours"` (operator-authored) is left UNTOUCHED by both the backfill and the live bridge (the row is ensured to exist, periods preserved).
- **SC-3-iOS / SC-3-Android (live bridge on edit):** Editing hours in the Settings "Opening hours" editor and tapping Save persists to `brand_hours`, and the Availability module (after cache invalidation) shows the re-derived service periods reflecting the change.
- **SC-4 (public-page parity):** After SC-3, the public venue page `/b/{brandSlug}` shows the edited hours (same `brand_hours` source via `claimed_venues_public_view`). No extra write needed.
- **SC-5 (single owner):** There is no code path that writes "venue opening hours" to `service_periods` independently of `brand_hours`; the ONLY producers of `derived_from_hours` periods are the create RPC and the edit RPC, both via the shared helper.
- **SC-6 (no dead-ends):** The Settings tab has no read-only prose-only summary for hours or venue profile; every creation-captured field (§4.5.3) is reachable from Settings with a working editor or working edit affordance, gated by manager-plus rank.
- **SC-7 (engine config exists):** No venue with hours returns zero slots solely because its `venue_availability_config` row was absent (the helper/backfill always ensures the row).
- **SC-8 (idempotent):** Re-running the helper with unchanged hours produces byte-identical `service_periods`.

---

## 6. Invariants

### Preserved
- **I-PROPOSED-1148-AVAILABILITY-ENGINE-SOLE-SLOT-SOURCE** — unchanged; the engine RPC stays the sole slot source. The bridge only WRITES `service_periods`; it does not generate slots. Verified by the engine signature staying frozen.
- **I-PROPOSED-1148-NO-BUYER-TAX-FORM** (gate `orch-1148-no-buyer-tax-form-in-venue-settings.mjs`) — the reworked Settings module must not introduce any billing-address / "Calculate tax" field. Verified by the existing gate continuing to pass.
- **`i-curated-hours-via-canonical-reader.mjs`** — confirm the new `fetchBrandHours` does not violate the curated-hours canonical-reader gate (the gate targets consumer curated hours; verify the new business-app reader is out of its scope or compliant).
- **Constitution #2 (one owner)**, **#8 (subtract before adding)**, **#12 (datetime)**, **#14 (hydration)** — see §9 notes.

### New (DRAFT — flip ACTIVE on CLOSE; orchestrator owns the flip)
- **I-PROPOSED-1186-HOURS-SINGLE-OWNER** (charter) — opening hours are read/written only via `brand_hours`; `service_periods` derived periods carry `type = "derived_from_hours"` and are produced ONLY by `biz_derive_service_periods_from_brand_hours`, called ONLY from the two hours-write RPCs. **Verification:** the regression test in §9 + a strict-grep gate asserting no other source writes `derived_from_hours` and that both RPCs `PERFORM` the helper.
- **I-PROPOSED-1186-SETTINGS-EDITS-ALL-CREATION-FIELDS** (charter) — every creation-captured field has a Settings editor or working edit affordance (no read-only prose dead-end). **Verification:** a component test asserting the Settings module renders a hours editor (not the retired summary string) and edit controls for the §4.5.3 fields.

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T1 (happy) | Create venue w/ mixed hours | Mon–Fri 09–17, Sat 10–14, Sun closed | config row exists; `service_periods` has 6 `derived_from_hours` entries; Sat `days=[6]`, Mon `days=[1]`; Sun absent | DB (SQL test) |
| T2 (weekday remap) | Single open day Sunday | Sun 12–18 only | one period, `days=[0]` (pg-dow Sunday), start `12:00` end `18:00` | DB |
| T3 (edit bridge) | Edit hours via `biz_upsert_brand_hours` | change Mon to 08:00–16:00 | re-derived period for Mon now `08:00`/`16:00`; old removed | DB |
| T4 (non-clobber) | Operator-authored period present | `service_periods` has `[{name:'Dinner',days:[5],…}]` (no `type`) | helper leaves periods untouched; row still exists | DB |
| T5 (idempotent) | Run helper twice, unchanged hours | call helper, call again | identical `service_periods`; `updated_at` unchanged on 2nd call | DB |
| T6 (config absent) | Brand w/ hours but no config row | run backfill | row created w/ TZ from location mapping; periods seeded | DB (migration) |
| T7 (error) | All days closed | 7 closed rows | `service_periods = []`; row still exists; engine returns no slots (not an error) | DB |
| T8 (hook invalidation) | Save hours in Settings | `useUpsertBrandHours.mutate` | both `["brandHours",id]` and `venueAvailabilityKeys.config(id)` invalidated | hook (jest) |
| T9 (settings no dead-end) | Render `VenueSettingsModule` | brand w/ hours, manager rank | renders `BrandHoursEditor`; does NOT render the retired "come from your venue profile" string | component (jest) |
| T10 (rank gate) | Non-manager opens Settings | rank < event_manager | hours editor disabled; read-only note shown | component |
| T11 (wizard parity) | Existing wizard hours flow | run existing `VenueCreatorWizard` hours tests | still pass after `BrandHoursEditor` extraction | component (regression) |

---

## 8. Implementation order

1. **DB migration** `20261116000000_orch_1186_a_hours_single_owner_seed.sql`: helper `biz_derive_service_periods_from_brand_hours` → `CREATE OR REPLACE biz_create_venue_brand_authoring` (+1 line) → `CREATE OR REPLACE biz_upsert_brand_hours` (+1 line) → one-shot backfill (TZ ensure + helper call per brand). Apply via Management API; verify with T1–T7 SQL probes.
2. **Service** `brandsService.ts`: add `fetchBrandHours`.
3. **Hook** `hooks/useBrandHours.ts`: `useBrandHours` + `useUpsertBrandHours` (dual invalidation).
4. **Component (reuse)** extract `BrandHoursEditor.tsx` from `VenueStep4Hours.tsx`; rewrite `VenueStep4Hours.tsx` as a thin draft-store wrapper.
5. **Component (Settings)** rework `VenueSettingsModule.tsx`: delete read-only Hours + Venue-profile dead-ends; add hours editor section + profile editors/edit-affordances + AI/listing entry point.
6. **Tests**: SQL test (T1–T7), hook test (T8), component tests (T9–T11), strict-grep gate for I-PROPOSED-1186-HOURS-SINGLE-OWNER.
7. Run the venue-suite gates (`venueModules.test.ts`, `venueShellScroll.test.ts`, `venueSuiteLeakAndExit.tester.adversarial.test.ts`, `orch-1148-no-buyer-tax-form-in-venue-settings.mjs`) + full pre-merge gate.

---

## 9. Regression prevention (fails-on-revert)

**Structural safeguard:** the shared helper `biz_derive_service_periods_from_brand_hours` is the SINGLE producer of reservation baseline periods, invoked from both hours-write RPCs.

**Primary regression test (SQL, must FAIL on revert):** `supabase/migrations/__tests__/orch_1186_hours_single_owner_seed.test.sql` —
1. seed a brand + 7 `brand_hours` rows (mixed open/closed);
2. call `biz_create_venue_brand_authoring` (or directly seed hours then call the helper) and ASSERT `venue_availability_config.service_periods` contains the expected `derived_from_hours` entries with the correct pg-dow remap (T1/T2);
3. call `biz_upsert_brand_hours` with changed hours and ASSERT the periods re-derive (T3 — proves the live bridge);
4. set an operator-authored (no-`type`) period and ASSERT it survives a helper call (T4 — proves non-clobber).
This test PASSES with the fix and FAILS when any of the three pieces (helper, create-RPC `PERFORM`, edit-RPC `PERFORM`) is reverted (service_periods stays `[]`, assertion fails).

**Strict-grep gate (must FAIL on revert):** `.github/scripts/strict-grep/orch-1186-hours-single-owner.mjs` — assert (a) the migration defines `biz_derive_service_periods_from_brand_hours`; (b) both `biz_create_venue_brand_authoring` and `biz_upsert_brand_hours` `PERFORM public.biz_derive_service_periods_from_brand_hours`; (c) no source outside that helper writes the literal `derived_from_hours`. Wire it into `strict-grep-mingla-business.yml`.

**Component regression (must FAIL on revert):** T9 asserts the retired read-only string `"Your opening hours come from your venue profile"` is GONE and `BrandHoursEditor` is present — reverting the Settings rework re-introduces the dead-end and fails the test.

**Protective comments:** the migration header explains DEC-B + the weekday remap + the `derived_from_hours` non-clobber marker so a future edit cannot silently re-fork the source of truth.

---

## 10. Open questions

- **OQ-1 (profile inlining depth):** §4.5.2 offers pattern (a) full inline editors vs (b) a working edit affordance for the lightweight brand fields. Recommend (a) for tagline/website/contact (cheap, true single-home) and (b)→deck-readiness for the AI-scored heavy fields. **Needs a designer pass** (`mingla-designer`) for the Settings tab layout before IMPLEMENT — invoke designer to spec the section order, the hours-editor placement within the command-center workspace, and the desktop two-column rendering. Flag to orchestrator: DESIGN should run before IMPLEMENT for this leg's component layer.
- **OQ-2 (category editability):** is `venue_category` intended to be editable post-creation, or display-only (it gates AI facet questions + parser routing)? Charter lists it as a creation field that needs a Settings editor, but changing it could invalidate existing AI scores. Recommend: editable but with a re-run-AI nudge. Confirm with Seth.
- **OQ-3 (TZ in the per-brand helper):** the helper ensures the config row but defaults `iana_timezone='UTC'` (TZ backfill only in the one-shot migration). For a NEWLY created venue, its TZ will be `'UTC'` until the operator sets it in Availability. Acceptable for Leg 1? Or should creation also map TZ from `country_code`/lat-lng? Recommend deferring real-TZ-on-create to Leg-1 only if cheap (reuse the same CASE on `brands.country_code`); otherwise note it as a known limitation. Confirm scope.

---

## 11. Downstream routing

- **Next = `mingla-designer`** (per OQ-1): spec the Settings-tab layout (section order, hours-editor placement, desktop two-column rendering, all states), embed into this SPEC's §4.5 as a Design subsection. THEN:
- **Next = `mingla-implementor`** (business side): build §8 in order inside the worktree `~/Desktop/mingla-orchs/1186-[venue-unify]` on branch `1186-venue-unify`; apply the migration via the Supabase Management API; prove the §9 fails-on-revert tests; write the implementation report.
- **Then = `mingla-tester`**: adversarial verification of SC-1…SC-8 incl. the weekday-remap (the highest-risk defect), non-clobber, and Business iOS+Android device runs (seed-on-create, edit-bridge, blank-no-more, public-page parity).
- **Then = `mingla-orchestrator` CLOSE**: flip I-PROPOSED-1186-HOURS-SINGLE-OWNER + I-PROPOSED-1186-SETTINGS-EDITS-ALL-CREATION-FIELDS to ACTIVE; artifact sync; sequence to Leg 2 (ORCH-1186-B).

### Scoped allowlist (implementor may modify ONLY these)
- `supabase/migrations/20261116000000_orch_1186_a_hours_single_owner_seed.sql` (NEW)
- `supabase/migrations/__tests__/orch_1186_hours_single_owner_seed.test.sql` (NEW)
- `.github/scripts/strict-grep/orch-1186-hours-single-owner.mjs` (NEW) + `.github/workflows/strict-grep-mingla-business.yml` (wire-in only)
- `mingla-business/src/services/brandsService.ts` (add `fetchBrandHours`)
- `mingla-business/src/hooks/useBrandHours.ts` (NEW)
- `mingla-business/src/components/venue/BrandHoursEditor.tsx` (NEW, extracted)
- `mingla-business/src/components/venue/VenueStep4Hours.tsx` (refactor to wrapper)
- `mingla-business/src/components/venue/VenueSettingsModule.tsx` (rework)
- `mingla-business/src/components/venue/__tests__/` (new tests T8–T11)

### DO-NOT-TOUCH (stop-and-amend before changing)
- `pg_venue_available_slots` (any version) — engine signature FROZEN.
- `venue_availability_config` table schema, `turn_times`/blackouts/`iana_timezone` columns, `VenueAvailabilityModule.tsx`, `useVenueAvailability.ts` (except cache invalidation already covered indirectly).
- `biz_create_venue_brand_authoring` body BEYOND the single appended `PERFORM` line.
- `VenueListingContent.tsx` / the Overview module (Leg 2 owns it).
- The deck-readiness flow / `businessPlaceAuthoringService.ts` / `run-business-place-authoring-pipeline` (reuse via entry point only).
- `app-mobile/`, `mingla-admin/`, buyer-web public-page code (parity is automatic).
- The anchor checkout `~/Desktop/mingla-main`.

---

## DESIGN (ORCH-1186-A)

**Author:** `mingla-designer` · **Date:** 2026-06-21 · **Mode:** SCREEN (resolves SPEC §4.5 + OQ-1).
**Scope:** the reworked `VenueSettingsModule.tsx` rendered in BOTH the desktop two-column suite (`VenueSuiteShell` `isWideDesktop` branch) AND native / web-phone single-column. No product code here — this is the binding visual contract the implementor builds without guessing.
**Reuse-only mandate (charter "subtract before adding"):** every control below maps to an EXISTING primitive — `GlassCard` (`variant="base"|"elevated"`), `Input` (`text`/`email`/`phone`/`number` variants, 48px, `accent.warm` focus border), `InlineTextArea` (BrandEditView pattern), `Button` (`primary`/`secondary`/`ghost`, `sm`/`md`), `Switch` (RN core, `accent.warm` track), `CoverPickerSheet`, `BrandHoursEditor` (extracted §4.5.1), the segmented control already in this module, and the AI score-bar pattern already in `VenueListingContent.tsx:346-361`. **No new visual system, no new tokens.** All values resolve to `constants/designSystem.ts`.

**Conductor decisions honored:** (1) editors are INLINE — one editable home, no routing away for the lightweight brand fields; (2) `venue_category` IS editable post-creation (with an AI-rescore nudge — resolves OQ-2); (3) a new per-venue `timezone` control exists (resolves OQ-3's UI half).

---

### D.0 — Decisions this design locks (forensics OQ resolutions)

- **OQ-1 (inlining depth) → RESOLVED: pattern (a) inline for the lightweight brand fields.** Tagline, description/pitch, website, contact email, contact phone, hero cover, category, AND timezone are edited INLINE in Settings (no navigation dead-end). Only the heavy AI-pipeline fields (gallery 5–20, vibe chips, price tiers, AI signal scores + "Recommend me" re-run) keep a working ENTRY-POINT into the existing deck-readiness flow (re-implementing them is Leg-1-out-of-scope and Leg-2's relocation job). This is the single-editable-home bar (SC-6) without forking the AI pipeline.
- **OQ-2 (category) → RESOLVED: editable inline, with a non-blocking "Re-run Recommend me" nudge** shown only after the operator changes the category (because category gates AI facets). Nudge routes to the same deck-readiness entry point; it never auto-mutates scores.
- **OQ-3 (timezone) → RESOLVED at the UI layer: a dedicated picker control in the "Opening hours" section header area** (TZ is conceptually "the clock these hours are read in"). It writes `venue_availability_config.iana_timezone` via the Availability config write path the SPEC already owns; whether creation maps TZ from country stays the SPEC's data decision — the control here lets the operator set/correct it regardless. Default display when unset: "UTC (set your timezone)".

---

### D.1 — Information architecture & section order

The moment: an operator is in their venue command-center, on the **Settings** rail item, to FIX or POLISH the venue they created — most often opening hours (the #1 reason this leg exists), occasionally a tagline / photo / contact / category. The IA is ordered by **frequency of edit × operational consequence**, and split into two intent bands so the page reads as "run the venue" then "tune the listing":

**Band 1 — RESERVATIONS (operational, conditional).** Unchanged from today.
1. **Reservations** (the canonical toggle) — `:212-232` UNCHANGED.
2. **Reservation fee** (only when reservations ON) — `:236-312` UNCHANGED.
3. **Cancellation & no-show** (only when reservations ON) — `:314-353` UNCHANGED.

**Band 2 — VENUE PROFILE (always visible; the new editable home).** This is the rework.
4. **Opening hours** (NEW real editor — replaces the dead-end `:374-380`). Highest-priority edit, so it leads Band 2.
5. **Venue details** (NEW inline editors — replaces the read-only `:357-372`): cover, name (read-only display + URL), tagline, description/pitch, website, contact email, contact phone, category.
6. **Photos & vibes & AI** (NEW entry-point card): gallery, vibe chips, price tiers, AI signal scores readout + "Recommend me" re-run with remaining-runs counter.
7. **Team roles** (scaffold) — `:382-403` UNCHANGED.
8. **Non-manager read-only note** — `:405-409` UNCHANGED (footer).

Rationale for the band split: Reservations config is "is this venue even taking bookings + money rules" — a different cognitive task than "what does my listing say." Putting hours FIRST in Band 2 (not buried under profile) matches the leg's entire reason for existing. Photos/vibes/AI is LAST because it is the heaviest, least-frequent edit and the only one that leaves the page.

**Section dividers:** between Band 1 and Band 2, insert ONE band caption row (`labelCap` token, `text.tertiary`, the SAME treatment as the existing `sectionTitle`) reading `VENUE PROFILE`. Reservations sections already self-caption per-card; no caption above Band 1 (it's the page's default subject). This is the ONLY new structural chrome and it reuses the existing `sectionTitle` style verbatim — no new token.

---

### D.2 — Layout & spacing grid (shared, both platforms)

Grid: the existing 4/8pt system (`spacing` tokens). The module host already supplies `paddingHorizontal: spacing.md (16)`, `paddingTop: spacing.md`, `gap: spacing.md (16)` between sections (`:414-419`) — KEEP verbatim. Every section is a `GlassCard variant="base"` with internal `gap: spacing.sm (8)` (the existing `styles.section`, `:420-422`) — KEEP, every new section reuses it.

Per-section internal layout:

- **Opening hours card:** `sectionTitle` "Opening hours" → TZ control row → `<BrandHoursEditor>` body → Save row.
  - TZ row: a full-width `Pressable` styled as a field (height 44, `radius.sm`, `backgroundColor: rgba(255,255,255,0.04)`, `borderWidth:1 borderColor: rgba(255,255,255,0.12)` — IDENTICAL to the `Input` container so it reads as a field), left label `Timezone` (`bodySm`, `text.secondary`), right value (`body`, `text.primary`) + trailing `chevD` icon 14 `text.tertiary`. Tapping opens a `Sheet snapPoint="full"` IANA picker reusing the EXACT search-list pattern from `Input`'s country picker (`Input.tsx:683-737`) — search bar + scrolling selectable rows + `check` icon on the selected. `marginBottom: spacing.sm` below the row before the editor.
  - `<BrandHoursEditor>` renders the 7 day rows + bulk bar EXACTLY as `VenueStep4Hours.tsx:168-345` (extracted). Inside the Settings card, REMOVE the editor's own outer `paddingHorizontal: spacing.lg` / `paddingBottom: spacing.xl` host padding (the `GlassCard` already pads `spacing.md`); the extracted `BrandHoursEditor` must therefore NOT carry the wizard host's outer padding — the wizard wrapper re-adds it. Keep the editor's internal `gap: spacing.sm`.
  - Save row: full-width `Button variant="primary" size="md" label="Save hours"` with `marginTop: spacing.md`, `disabled` until the local draft differs from server (`isDirty`) AND `canMutate`. A `bodySm` `semantic.success` confirmation line ("Hours saved.") appears `marginTop: spacing.sm` for 2.5s after success (mirrors the existing `feePreview` success-line treatment `:445-449`).
- **Venue details card:** vertical stack, `gap: spacing.sm (8)` between fields (matches BrandEditView `fieldsCol` `:977-979`). Order top→bottom: cover preview+CTA → name display row → tagline `Input` → description `InlineTextArea` → website `Input` (leadingIcon `globe`) → contact email `Input` (variant `email`, leadingIcon `mail`) → contact phone `Input` (variant `phone`) → category field-row. A single `Button variant="primary" size="md" label="Save details"` at the card foot (`marginTop: spacing.md`), `disabled` unless dirty + `canMutate`. Cover preview block: `height:120, borderRadius: radius.lg, overflow:"hidden"` (BrandEditView `coverPreviewWrap` `:1023-1028`) + a centered `Button variant="secondary" size="md" leadingIcon="upload" label="Change cover"|"Add cover"`.
- **Photos & vibes & AI card:** three stacked sub-blocks separated by a `StyleSheet.hairlineWidth` top border in `glass.border.profileBase` (the existing `dangerZone` separator pattern `:1090-1091`):
  1. **Photos & vibes** mini-summary row: `{n} photos · {vibe chips count} vibes · {price tier labels}` (`bodySm`, `text.secondary`, reusing the `metaLine` composition from `VenueListingContent.tsx:323-328`) + `Button variant="secondary" size="md" leadingIcon="image" label="Edit photos & vibes"`.
  2. **AI signal scores** readout: title `bodyLg` "How you match Mingla moments" + the EXACT score-bar list from `VenueListingContent.tsx:346-361` (label + track + fill + value). Read-only display (scores are computed, never hand-edited).
  3. **Recommend me** block: a `bodySm` `text.secondary` line = the remaining-runs counter copy from `VenueListingContent.tsx:369-373` (`You can re-run "Recommend me" {n} more time(s).` / used-all copy) + `Button variant="primary" size="md" leadingIcon="sparkle" label="Re-run Recommend me"`, **disabled when `editsRemaining <= 0`** (button `disabled` greys to opacity per the Button primitive). All three CTAs route to the existing deck-readiness flow with `brand_id` + `place_pool_id`.

Density rationale: Reservations + Venue-details are EDIT-dense (the operator is comparing field values against reality) → tight `spacing.sm` field rhythm. Photos/vibes/AI is CHOOSE-sparse (it launches a flow) → larger `spacing.md` block rhythm + hairline separators.

---

### D.3 — Desktop two-column rendering (`isWideDesktop` branch)

The shell already gives Settings the right frame: `DesktopRail` (220px, `venueRailWidth`) on the left, a `flex:1` workspace on the right wrapped in a `ScrollView` (`VenueSuiteShell.tsx:198-212`, because Settings is NOT a self-scrolling module — `moduleSelfScrolls("settings") === false`). The Settings module renders INSIDE that workspace `ScrollView`. **No changes to the shell are needed or permitted** (the shell is on the DO-NOT-TOUCH list); the design works within the existing container.

Desktop-specific deltas the Settings module applies via `useResponsiveLayout().isWideDesktop`:

- **Readable measure cap.** The workspace `flex:1` absorbs the full page width (ORCH-1184 removed the 1200 cap), so on a wide monitor the cards would stretch to an unreadable line length. Cap the Settings content column at **`maxWidth: 720`, `alignSelf:"flex-start"`** on the host `View` when `isWideDesktop` (720 keeps the 65–75 char body measure for the description textarea and keeps field rows from becoming absurdly wide; left-anchored to match the rail/Chrome left edge). This is a layout value local to the module — propose token `venueSettingsMaxWidth = 720` in `designSystem.ts` (sibling of the existing `venueRailWidth`) so no raw number lives in the component.
- **Two-up field pairing on wide.** Within Venue-details, the two contact fields (email, phone) render side-by-side in a `flexDirection:"row", gap: spacing.md` row when `isWideDesktop` (each `flex:1`), stacking vertically on phone. Tagline, description, website, category stay full-width (they need the measure). This is the only responsive reflow; everything else is a single column at both sizes (cards already look correct full-width up to the 720 cap).
- **Hours editor on desktop.** The 7 day-rows stay a vertical list (a calendar-grid rework is out of scope). The bulk-set day chips already wrap (`flexWrap` not set on `bulkDayRow` — they fit at 720). The time-pickers: on web there is no native `DateTimePicker` spinner modal; the extracted `BrandHoursEditor` MUST, on `Platform.OS === "web"`, render the time control as a `<input type="time">`-backed field OR a lightweight text field accepting `HH:MM` — **flag to implementor: VenueStep4Hours today only handles iOS/Android pickers; the web branch needs a web time control.** Visual: same `timeBtn` chip (`accent.tint` fill, `radius.sm`) showing the value; tapping focuses the web time input. Keep `timeLbl`/`timeVal` typography.
- **Hover (web only).** Save buttons + secondary CTAs + the rail rows get the existing `cursor:"pointer"` (already on `railRow` `:348`); add `cursor:"pointer"` to the TZ field-row and the photo/vibe CTAs. No hover background-shift on cards (the app's restrained desktop convention — `feedback_mingla_business_desktop_web_contracts`); the only hover affordance is the cursor + the Button primitive's built-in press/hover state. NO layout shift on hover.

---

### D.4 — Native / web-phone single-column rendering

The shell wraps Settings in its own `ScrollView` with `paddingBottom = venueScrollBottomPad(insets.bottom)` for floating-nav clearance (`VenueSuiteShell.tsx:223-241`) — Settings renders as the existing single column at full width minus the `spacing.md` host gutters. No `maxWidth` cap on phone. Contact fields stack. The hours editor uses the native `DateTimePicker` paths already in `VenueStep4Hours` (iOS spinner-in-Modal `:314-336`, Android default `:338-345`) — preserved by the extraction. The TZ picker `Sheet` and the CoverPickerSheet mount INSIDE the module host `View` (I-SUB-SHEET-INSIDE-PARENT — sibling native Modals compete at the OS root; BrandEditView already follows this `:847-885`).

---

### D.5 — Type scale (every text element → token)

| Element | Token | Size/LH/Weight | Color |
|---|---|---|---|
| Band caption "VENUE PROFILE" | `typography.labelCap` | 12 / 16 / 600, +1.4 tracking | `text.tertiary` |
| Section title ("Opening hours", "Venue details", "Photos & vibes & AI") | `typography.labelCap` (existing `sectionTitle`) | 12 / 16 / 600 | `text.tertiary` |
| AI block heading "How you match Mingla moments" | `typography.bodyLg` | 18 / 28 / 500 | `text.primary` |
| Field label inside a row (TZ "Timezone", "Fee amount") | `typography.bodySm` (existing `fieldLabel`) | 14 / 20 / 400 | `text.secondary` |
| Input typed text | `typography.body` (Input primitive) | 16 / 24 / 400 | `text.primary` |
| Input placeholder | `typography.body` | 16 / 24 | `text.quaternary` |
| Day name (hours row) | `typography.body` 600 (existing `dayName`) | 16 / 24 / 600 | `text.primary` |
| Time chip label / value | `caption` / `body` 600 (existing `timeLbl`/`timeVal`) | 12 / 16 ; 16 / 24 600 | `text.secondary` / `text.primary` |
| Venue name display | `typography.rowTitle` (existing, =`bodyLg`) | 18 / 28 / 500 | `text.primary` |
| City / sub | `typography.bodySm` (existing `rowSub`) | 14 / 20 / 400 | `text.secondary` |
| AI score label / value | existing `scoreLabel` / `scoreValue` | per VenueListingContent | `text.secondary` / `text.primary` |
| Recommend-me remaining-runs line | `typography.bodySm` | 14 / 20 / 400 | `text.secondary` |
| Save-success confirmation | `typography.bodySm` | 14 / 20 / 400 | `semantic.success` |
| Inline error (hours invalid / save failed) | `typography.bodySm` | 14 / 20 / 400 | `semantic.error` |
| Non-manager read-only note | `typography.caption` (existing `readOnlyNote`) | 12 / 16 / 500 | `text.tertiary` |

**Dynamic Type:** all sizes are RN `fontSize` points → scale with OS text-size on native; the 44px field-row min-heights use `minHeight` not fixed `height` where text can grow (TZ row, Save buttons via Button primitive). The `Input` primitive is fixed 48px (existing constraint, accepted). Multi-line `InlineTextArea` grows with content (`minHeight:120`).

---

### D.6 — Color & token mapping (dark theme is the only theme in this surface)

The business venue suite renders on the dark canvas (`canvas.discover #0c0e12`). Every surface = `GlassCard` (already opaque-safe on Android — see D.9). Token map + contrast (text-on-surface; the composited card surface over `#0c0e12` is ≈ `#16181c`):

- Section/band captions `text.tertiary (rgba 255 .52)` on card → ~5.0:1 ✓ (AA for the 12px+600 caption).
- Field labels `text.secondary (.72)` → ~9.2:1 ✓.
- Primary text `text.primary (.96)` → ~14:1 ✓.
- Placeholder `text.quaternary (.32)` → ~2.6:1 — placeholder only (not load-bearing), acceptable per the established Input primitive; real values use `text.primary`.
- Input idle border `rgba(255,255,255,0.12)`; focus border `accent.warm #eb7825` 1.5px (Input primitive, 120ms `durations.fast`).
- Active segmented item fill `accent.warm`, label `#0c0e12` (existing `segmentItemActive`/`segmentLabelActive` — the dark-on-warm pairing already in this module ~8:1 ✓).
- Switch track ON `accent.warm`, OFF `rgba(255,255,255,0.16)`, thumb `#ffffff` (existing, KEEP).
- AI score-bar track `glass`/neutral fill + warm fill — reuse `VenueListingContent` `scoreBarTrack`/`scoreBarFill` verbatim.
- Save-success `semantic.success #22c55e` on dark ~ AA ✓; error `semantic.error #ef4444` ~4.0:1 — pair with an icon/text not color-only (D.7).
- Day-row card `glass.tint.profileBase` fill + `glass.border.profileBase` border + `overflow:"hidden"` (existing `dayRow` `:429-437`) — Android-opaque-safe.
- **No raw hex in the new component** beyond the `#0c0e12` on-warm text already tokenized in this module and the `#ffffff` switch thumb (both pre-existing in this file).

---

### D.7 — Every interactive state (the full state machine)

For EACH editable section the states are: **loading → loaded(default) → editing(dirty) → saving → success → error → disabled(non-manager).**

**Opening hours section**
- **Loading** (`useBrandHours` pending): the card renders the title + a skeleton of 7 day-rows — each a `dayRow`-shaped `View` at `opacity:0.4` with no text, height matching a collapsed day row (~52px). No spinner needed; the skeletons communicate "hours are loading." (Reduced-motion: static skeleton, no shimmer.)
- **Loaded/default:** 7 day rows from server data; Save button `disabled` (not dirty).
- **Editing/dirty:** any open/close/closed change makes the local draft differ → Save button enables (`primary`, full opacity). The validation copy (`VenueStep4Hours:104-116`: "Open and close times are required for open days." / "Close time must be after open time.") shows as a `semantic.error` line above the day list when `showErrors` and invalid; Save stays disabled while invalid.
- **Saving** (`useUpsertBrandHours.isPending`): Save button shows `loading` (Button primitive spinner) + label stays "Save hours"; the editor rows are `pointerEvents:"none"` + `opacity:0.6` to prevent edits mid-write.
- **Success:** Save button returns to disabled (draft now equals server); the `semantic.success` "Hours saved." line appears for 2.5s; the dual cache invalidation (§4.4) silently refreshes Availability — no UI jump in Settings.
- **Error** (mutation throws): a `semantic.error` line "Couldn't save hours. Tap Save to try again." appears under the Save button; button re-enables; edits preserved (no data loss). Mirrors BrandEditView's catch-and-retain pattern (`:300-308`).
- **Disabled/non-manager** (`!canMutate`): the WHOLE editor renders at `opacity:0.6`, `pointerEvents:"none"`; the TZ row + Save button are not interactive; the existing footer read-only note (`:405-409`) explains why. (Matches the SPEC §4.5.2 "manager-plus gate disables the editor for non-managers.")

**Venue-details section** — same six states, per the BrandEditView save model:
- **Loading** (brand query pending): fields render disabled with placeholder-only; or a 3-line skeleton if brand is null.
- **Editing/dirty:** `isDirty` via shallow compare of the local field draft vs the brand record → "Save details" enables.
- **Saving:** "Save details" → loading; fields `editable={false}` (Input `disabled` → opacity 0.5 per primitive `:586`).
- **Success:** Toast "Saved" (reuse the `Toast` primitive exactly as BrandEditView `:834-840`) + button disables.
- **Error:** Toast "Couldn't save: {message}" (BrandEditView `:301-305`), fields retain edits.
- **Disabled/non-manager:** all `Input`s `disabled`, cover CTA hidden, Save hidden; footer note explains.
- **Cover sub-state:** picking via `CoverPickerSheet` updates the preview immediately (optimistic, like BrandEditView `handleCoverPicked`) and marks dirty; the actual persist happens on "Save details" (or the sheet's own write path if `CoverPickerSheet` self-persists — match BrandEditView's wiring).
- **Category sub-state:** changing the category chip/picker shows a non-blocking `infoTint` nudge row beneath it: `bodySm` "Changing your category can change which moments we recommend you for. Re-run Recommend me to refresh your scores." + a `Button variant="secondary" size="sm" label="Re-run Recommend me"` routing to deck-readiness. The nudge appears ONLY after a category change in this session; it never blocks Save.

**Photos & vibes & AI section**
- **Loading** (`useBrandPlaceAuthoringContext` pending): the summary line + score list render as 3 skeleton bars (`scoreBarTrack` at `opacity:0.4`); CTAs disabled.
- **Loaded:** real summary, real score bars, real remaining-runs counter.
- **Re-run available** (`editsRemaining > 0`): "Re-run Recommend me" primary, enabled; counter reads the remaining count.
- **Re-run exhausted** (`editsRemaining <= 0`): button `disabled` (opacity per primitive); counter reads the used-all copy ("You've used all your changes. Contact support if you need more." — `VenueListingContent:372`).
- **Empty scores** (no `ai_signal_scores` yet — never re-run): the score sub-block hides (matches `scoreRows.length > 0` guard `:340`); show a `bodySm text.secondary` "Run Recommend me to see how you match Mingla moments." above the enabled re-run button.
- **Error / no place_pool:** if `place_pool_id` is null the whole AI card hides (can't route); the Photos/vibes summary also hides — Settings shows only the editable brand fields. (Defensive: a venue without a place pool has no AI surface.)
- **Disabled/non-manager:** CTAs hidden; the score readout still renders (viewing is allowed); footer note explains editing is gated.

**Reservations / fee / cancellation / team** — UNCHANGED; their states are already specified in the live file (`:212-403`).

---

### D.8 — Motion spec

Motion is minimal and functional (this is a settings surface, not a hero):
- **Section mount:** none beyond the parent ScrollView. Cards do not animate in (avoids jank on a long form).
- **Input focus border:** idle 1px → focus 1.5px `accent.warm`, `transitionProperty:"border-color"`, `durations.fast` (120ms) — built into the `Input` primitive (`:753-754`). KEEP.
- **Save button press:** the `Button` primitive's existing press scale/opacity micro-interaction. No override.
- **Save-success line:** fade-in over `durations.normal` (200ms) `easings.out`, hold 2.5s, fade-out 180ms (`durations.exit`). Reduced-motion: appears/disappears with no fade (instant), still auto-dismisses at 2.5s.
- **Toast (venue-details save):** the `Toast` primitive's own slide/fade — unchanged.
- **TZ picker / Cover sheet open:** the `Sheet` primitive's existing spring slide-up. Unchanged. Reduced-motion: the `Sheet` already respects the platform reduced-motion (no new fallback needed here).
- **Skeletons:** static `opacity:0.4` blocks, NO shimmer (cheaper, and shimmer would need a reduced-motion fallback — static avoids it entirely).
- **Category nudge:** appears instantly (no animation) so it can't be missed; it's a state, not a flourish.

`prefers-reduced-motion`: the only motion is the success-line fade and the Sheet/Toast/Button built-ins — the success-line fade has the instant fallback above; the primitives carry their own reduced-motion handling. No bespoke animation is introduced that lacks a fallback.

---

### D.9 — Accessibility

- **Contrast:** all text-on-surface pairings pass AA (D.6 table). Error state pairs `semantic.error` with explicit text (never color-only); the category nudge uses `infoTint` background + text (not color-only); AI scores show a numeric value beside each bar (not color/length-only).
- **Touch targets ≥44pt:** TZ field-row `minHeight:44`; day-row open/close chips inherit the existing `timeBtn` padding (≥44 effective); Switches are RN core (44+); all `Button`s `size="md"` are ≥44; the bulk day-letter chips are 34×34 today (`bulkDayChip` `:387-396`) — **flag: below 44pt; add `hitSlop:{6,6,6,6}` in the extracted `BrandHoursEditor` to reach 46pt effective** (no visual change). The cover pencil/CTA use the existing ≥44 Button.
- **Roles & labels:** TZ row `accessibilityRole="button"`, label "Timezone, currently {value}. Tap to change."; Save buttons label "Save hours" / "Save details"; each day Switch keeps its existing `${DAY} open` label; the segmented no-show control keeps its existing selected-state labels; the score bars get `accessibilityLabel="{signal}: {score} out of 100"`; the Re-run button label "Re-run Recommend me, {n} runs remaining" (or "no runs remaining" when exhausted, with `accessibilityState={{disabled:true}}`).
- **Reading order (top→bottom):** Reservations → (fee → cancel when on) → VENUE PROFILE caption → Opening hours (title → TZ → days → Save) → Venue details (cover → name → tagline → description → website → email → phone → category → Save) → Photos/vibes/AI → Team → read-only note. This is the literal DOM/native view order (no absolute repositioning that breaks it).
- **Non-manager:** the read-only note is announced; disabled controls carry `accessibilityState={{disabled:true}}` so screen readers say "dimmed/unavailable."
- **One-handed reach (phone):** the primary actions (Save buttons) sit at each card's foot, within the natural scroll-thumb arc; nothing critical is pinned top-only.

---

### D.10 — Per-platform deltas

| Concern | iOS | Android | Web (desktop) | Web-phone |
|---|---|---|---|---|
| Glass surface | translucent `BlurView` 30/34 intensity + tints (GlassCard) | **opaque fallback** auto-applied: `GlassChrome` paints `FALLBACK_BACKGROUND` instead of `BlurView`, `styles.clip` `overflow:"hidden"`, shadows zero `elevation` via `androidSafeElevation` — **policy satisfied by reuse; no new code** | translucent if width ≥768, else opaque (`shouldUseRealBlur(windowWidth)`) | **opaque fallback** (width <768 → `shouldUseRealBlur` false) |
| Time picker (hours) | `DateTimePicker` spinner in fade `Modal` (existing `:314-336`) | `DateTimePicker` `display="default"` dialog (existing `:338-345`) | **needs a web time control** (`<input type="time">` or HH:MM field) — IMPLEMENTOR ADD in `BrandHoursEditor` | same as web-desktop |
| TZ / Cover sheets | `Sheet` mounted inside host View | same | `Sheet` renders as centered/overlay per primitive | same |
| Contact field pairing | stacked | stacked | side-by-side (D.3) | stacked |
| Content width | full minus gutters | full minus gutters | capped `venueSettingsMaxWidth (720)`, left-anchored | full minus gutters |
| Hover | n/a | n/a | cursor:pointer on actionable rows; no card hover shift | n/a |
| Shadows under rounded glass | iOS shadow tokens | **zeroed** (`androidSafeElevation`) | iOS-style | zeroed when opaque |

**Android glass gate (`ANDROID_GLASS_USES_OPAQUE_FALLBACK`) — explicit compliance:** every new section is a `GlassCard`, and `GlassCard`→`GlassChrome` already (1) paints an opaque fill on Android/mobile-web instead of a translucent surface, (2) clips with `overflow:"hidden"`, and (3) zeroes Android `elevation`. The day-row sub-cards use `glass.tint.profileBase` + `overflow:"hidden"` (existing). The TZ field-row and `InlineTextArea` use solid `rgba(255,255,255,0.04)` fills (the established Input look) with no Android shadow. **No translucent Android fill is introduced anywhere.** New custom fills introduced by this design: NONE beyond the already-opaque-safe reuses.

---

### D.11 — Copy (Mingla voice — clear, warm, never jargon)

| Slot | Copy |
|---|---|
| Band caption | `VENUE PROFILE` |
| Opening hours title | `Opening hours` |
| Hours helper | `These are the hours guests see — and the baseline for reservation slots.` (replaces the dead-end prose; explains the single-source consequence) |
| Timezone label | `Timezone` · unset value `UTC (set your timezone)` |
| Save hours | `Save hours` / saving `Save hours` (spinner) / success `Hours saved.` / error `Couldn't save hours. Tap Save to try again.` |
| Venue details title | `Venue details` |
| Tagline placeholder | `Short tagline` |
| Description placeholder | `Tell guests about your venue` |
| Website placeholder | `Paste your website link here` |
| Email placeholder | `hello@yourvenue.com` |
| Phone placeholder | `7700 900 312` |
| Category label | `Category` |
| Category nudge | `Changing your category can change which moments we recommend you for. Re-run Recommend me to refresh your scores.` |
| Cover CTA | `Add cover` / `Change cover` |
| Save details | `Save details` / success Toast `Saved` / error Toast `Couldn't save: {message}` |
| Photos/vibes title | `Photos & vibes` |
| Photos/vibes summary | `{n} photos · {m} vibes{ · price tiers}` |
| Edit photos CTA | `Edit photos & vibes` |
| AI heading | `How you match Mingla moments` |
| AI empty | `Run Recommend me to see how you match Mingla moments.` |
| Remaining-runs | `You can re-run "Recommend me" {n} more time{s}.` / exhausted `You've used all your changes. Contact support if you need more.` |
| Re-run CTA | `Re-run Recommend me` |
| Non-manager note | `You can view these settings. Ask a manager or owner to make changes.` (existing, KEEP) |

---

### D.12 — Build-ready handoff

- **Reused tokens (exist):** `spacing.*`, `radius.*`, `typography.*` (`labelCap`, `bodyLg`, `body`, `bodySm`, `caption`), `accent.warm/tint/border`, `text.*`, `glass.tint/border.profileBase/Elevated`, `semantic.success/error/warning/info` + `*Tint`, `durations.fast/normal/exit`, `easings.out`.
- **Propose ONE new layout token** in `designSystem.ts` (sibling of `venueRailWidth`): `export const venueSettingsMaxWidth = 720 as const;` — the desktop readable-measure cap. No other new token.
- **Reused primitives/components (exist):** `GlassCard`, `Input` (text/email/phone/number), `InlineTextArea` (extract from BrandEditView OR inline-compose identically — implementor's call; it is a 30-line pattern, not a primitive today), `Button`, RN `Switch`, the existing segmented control (in-file), `CoverPickerSheet`, `Sheet`, `Toast`, `Icon` (`globe`/`mail`/`chevD`/`upload`/`image`/`sparkle`/`check`/`search`), the AI score-bar markup (copy from `VenueListingContent.tsx:346-361`), `BrandHoursEditor` (NEW extraction §4.5.1).
- **New component (this leg):** `BrandHoursEditor.tsx` (extracted, controlled) — MUST gain a web time-input branch (D.3/D.10) and `hitSlop` on the 34px bulk chips (D.9). The wizard wrapper re-adds the host padding the editor sheds.
- **State sources the module wires (per SPEC §4.3/§4.4):** `useBrandHours` + `useUpsertBrandHours` (hours), brand query + `useUpdateBrand` (details), `useBrandPlaceAuthoringContext` (photos/vibes/AI readout), the TZ write via the Availability config path, `canMutate = rank >= event_manager` (existing `:100`) gating every editor.
- **Sheets mount inside the module host `View`** (I-SUB-SHEET-INSIDE-PARENT).
- **Tests this design must satisfy** (SPEC §7): T9 (renders `BrandHoursEditor`, NOT the retired "come from your venue profile" string), T10 (non-manager → editor disabled + read-only note), T11 (wizard parity after extraction). The component test should also assert the Venue-details inline editors and the Photos/vibes/AI entry CTAs render (I-PROPOSED-1186-SETTINGS-EDITS-ALL-CREATION-FIELDS).
- **Invariant compliance:** NO buyer billing-address / "Calculate tax" field anywhere (I-PROPOSED-1148-NO-BUYER-TAX-FORM — this design adds none); `ANDROID_GLASS_USES_OPAQUE_FALLBACK` satisfied by GlassCard reuse (D.10); manager-plus gating on every mutation (D.7).

**Design verdict:** every section earns its place against the operator's actual moment (fix hours first, then polish the listing). Nothing decorative is added. The one structural addition (the band caption) and the one new token (`venueSettingsMaxWidth`) are the minimum needed to make Settings the single editable home without a new visual system. The single real implementation risk this design surfaces is the **web time-control gap** in the extracted `BrandHoursEditor` — called out explicitly for the implementor.
