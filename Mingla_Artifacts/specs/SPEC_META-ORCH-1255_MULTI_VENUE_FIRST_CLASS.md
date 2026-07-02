# SPEC — META-ORCH-1255 [multi-venue first-class creation]

**Phase:** SPEC (binding build contract)
**Worktree:** `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1255_MULTI_VENUE_FIRST_CLASS.md` (commit 5dd33b721) — every F-# / R-# / inventory-# reference below points there.
**Design contract (BINDING, embedded):** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1255_VENUE_SURFACES.md` (commit f4962ba72, mingla-designer) — pixel-precise contract for the creator-sheet 4th row (§2, incl. the §2.2 REQUIRED TopSheet compact clamp + root-row density fix), the shared `ListingStatusChip` (§3), the venue card list `VenueListCard` (§4), the per-venue management page header/nav (§5), and the anon public venue page (§6). Where this SPEC names a component/state, the DESIGN file supplies the exact tokens, spacing, type, motion, and a11y — the implementor builds from BOTH; on any visual question the DESIGN file wins.
**Seth's binding decisions (2026-07-01, final):** D-1 per-venue rows under one brand (hidden-brand creation DECOMMISSIONED); D-2 per-venue public pages under the brand slug; D-3 FULL per-venue ops now (reservation settings, tables, waitlist, hours); D-4 admin approval state machine unchanged, re-keyed to the venue row; D-5 4th creator option + Hub venue card list + physical-location toggle REMOVED; D-6 ORCH-1256 boundary (BrandEditView section anchors + businessTodos `profile` input are 1256's — do not contradict).
**Shipping constraints in force:** COMMS-0052 (BLOCK, acked) — NO `eas update` for mingla-business; web ships via Vercel `[deploy]`, native rides the next business build. Consumer OTA also frozen (COMMS-0051/ORCH-1171). Migrations applied via the Supabase Management API only (blind `db push` UNSAFE — migration-history drift).

---

## 1. Executive summary

Today "a venue listing" IS a brand: the wizard spawns a hidden brand row born `pending_review` (F-1), and every venue system — approval, pipeline, hours, tables, reservations, public page — is keyed to that one brand (F-2..F-7). This build makes venues first-class rows under ONE brand: a new `venue_listings` table carries the claim lifecycle per venue, the authoring pipeline and the entire reservations suite re-key per venue, each venue gets its own public page at `/b/{brandSlug}/v/{venueSlug}`, the business app gains "Create venue listing" as the 4th creator option plus a Hub venue CARD LIST, and mingla-admin reviews venue rows instead of brand rows — with the state machine transitions byte-identical (D-4). Prod has 0 venue-bound brands and 0 pipeline rows (F-8), so this is effectively greenfield: no backfill, only a 3-row orphan cleanup.

**Chosen shapes (binding):**
- **Venue row:** new table `public.venue_listings` (identity + claim lifecycle per venue). The pipeline row is re-keyed by `venue_id`; all ops tables gain `venue_id NOT NULL`. `brands.claim_status` / `brands.place_pool_id` become legacy-inert (never written by venue flows again).
- **Public route:** `/b/{brandSlug}/v/{venueSlug}` — expo-router file `mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx`, following the house nested-slug pattern of `app/e/[brandSlug]/[eventSlug].tsx` and `app/t/[brandSlug]/[tripSlug].tsx` (both verified on branch). Read model: new SECURITY-DEFINER view `venue_public_view`, following the shipped precedent of `claimed_venues_public_view` + the 20260731000000 definer ruling ("anon reads only the view's scoped public-safe output, never the `brands` table").

## 2. Scope & non-goals

**In scope (three legs, dispatched sequentially):**
- **Leg A — backend:** `venue_listings` DDL + RLS; pipeline + feedback + ops re-key; venue-keyed create/review/resubmit/suspend RPCs; public read model; consumer resolvers re-key; edge functions (`run-business-place-authoring-pipeline`, `admin-review-venue-claim`, `venue-claim-submitted-email`, `venue-claim-decision-email`, 3 reservation edge fns); orphan cleanup; SQL regression tests.
- **Leg B — business client:** UniversalCreatorSheet 4th option; venue card list on the Hub venue tab; per-venue suite scoping (`VenueSuiteShell`/`VenueListingContent`/all modules take `venueId`); wizard rewire to the current brand (no brand creation, no brand switch); `draftVenueStore` per-brand multi-draft; todos re-scope; BrandEditView toggle removal; hub tab gate = ≥1 venue row.
- **Leg C — public + admin + consumer reserve-flow:** per-venue public page + brand-page venues section (buyer web); vercel bot-rewrite entry; mingla-admin claims queue re-point; app-mobile reserve-flow `venue_id` passthrough.

**Non-goals (explicit, with reason):**
- **Menus stay brand-level.** D-3 enumerates "reservation settings, tables, waitlist, hours" — menus (`menus`/`menu_items`, 20261118000000) are content, not booking inventory, and are NOT in Seth's list. Marked `[TRANSITIONAL-3]` below with exit condition. The public venue page shows the brand's menu.
- **Consumer deck serving unchanged.** Deck cards are already one-per-servable-`place_pool`-row (F-4); no deck code changes. Proof in §3.
- **No venue-level Stripe.** D-1: one brand, one Stripe account. All payment resolution stays `brand_id`-keyed (`resolve_brand_pricing_inputs(p_brand_id)` untouched); venue RPCs derive `brand_id` from the venue row server-side.
- **No SEO/OG venue-specific card.** The per-venue page's bot rewrite reuses the brand OG handler (explicit v1 simplification, §L-C).
- **`has_physical_location` DB column stays** (additive-inert; F-11 — removing the only writer makes it dead; dropping the column is a follow-on).
- **No re-investigation.** Every fact herein cites the investigation; no new findings were generated (SPEC hard rule honored — the only post-investigation reads were verbatim re-reads of files/migrations the investigation already inventoried, to extract exact DDL/signatures).

**Assumptions:** prod counts still ≈ F-8 (0 venue-brands, 0 pipeline rows, 0 venue-ops rows). Every assert-empty migration guard below RAISEs if this drifts — the migration fails loudly instead of corrupting.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched | Parity |
|---|---------|----------|-------------------------------|---------------|--------|
| 1 | Consumer iOS (`app-mobile/`) | Covered (reserve flow only) | Deck UNCHANGED. Reserve flow passes `venue_id` (from the resolver) instead of `brand_id` | `src/hooks/useVenueReservable.ts`, `useVenueAvailability.ts`, `useMyReservations.ts`, `src/services/venueReservationService.ts`, `src/components/expandedCard/VenueSlotPicker.tsx` | automatic iOS/Android (shared RN) |
| 2 | Consumer Android | Covered | same as #1 | same | automatic |
| 3 | Buyer/anon Web (`mingla-business` public) | Covered | NEW `/b/{brandSlug}/v/{venueSlug}` page; `/b/{brandSlug}` gains a "Locations" section linking venues | `app/b/[brandSlug]/v/[venueSlug].tsx` (new), `src/components/brand/PublicBrandPage.tsx`, `src/services/publicEventsService.ts`, `vercel.json` | manual (web-only section) |
| 4 | Business iOS | Covered | 4th creator option; venue card list; per-venue listing mgmt; toggle gone; per-venue todos | Leg B allowlist | automatic with #5 (shared RN) — ships on NEXT NATIVE BUILD (COMMS-0052, no OTA) |
| 5 | Business Android | Covered | same as #4 | same | automatic; same shipping note |
| 6 | Admin Web (`mingla-admin`) | Covered | Claims queue lists VENUE rows (venue name + brand name + place); approve/reject/need-info/suspend/restore work against venue rows | `src/services/adminClaimsService.js`, `src/pages/ClaimsPage.jsx` | manual |
| 7 | Business Web preview (Vercel) | Covered | same as #4/5, ships FIRST via Vercel `[deploy]` | Leg B allowlist | automatic (same code, earlier ship) |

**Consumer-deck-unchanged proof (dispatch-required):** the deck serves `place_pool` rows gated on `is_servable AND is_active` with NO brand join in the card query (F-4: "the consumer deck consumes place rows (each servable row = one card)"; deck supply keying per `20261007000000_orch_1138_rework_deck_supply.sql`). The place→brand resolvers (`pg_brand_experiences_for_place`, `pg_venue_reservable_for_place`) change ONLY their internal join (brand-pointer → venue-listing join) while preserving their return contracts (reservable resolver gains one ADDITIVE column). Axis-3 go-live (`runApproveGoLive(place_pool_id)` → re-bounce → `is_servable=true`) stays per-place, verbatim (I-CLAIM-REBOUNCE-ON-APPROVE, I-SCORER-INVOKE-HAS-SIGNAL-ID).

---

## 4. Layered specification

### LEG A — schema + RLS + RPCs + views + edge functions

#### 4.A.1 Migration plan (exact files, collision-checked)

**Prefix scan performed 2026-07-01:** `origin/main` max = `20261129000000_orch_1239_pairing_accept_limit_guard.sql`. All worktrees under `~/Desktop/mingla-orchs/` scanned (committed + uncommitted): only branch-only migration anywhere is `orch-1187`'s `20261116000000_…` (below max — no forward collision). Duplicate prefixes already on main (20260612/0615/1012/1113/1116/1117) are historical; per COMMS-0051 the implementor MUST re-run this scan at IMPLEMENT before claiming the prefixes. **Allocated (strictly monotonic):**

| File | Content |
|------|---------|
| `supabase/migrations/20261130000000_orch_1255_venue_listings_core.sql` | M1 — `venue_listings` + RLS + triggers |
| `supabase/migrations/20261130000001_orch_1255_pipeline_feedback_venue_rekey.sql` | M2 — pipeline + `venue_claim_feedback` re-key |
| `supabase/migrations/20261130000002_orch_1255_ops_rekey.sql` | M3 — hours/settings/tables/availability/blackouts/waitlist/reservations + engine RPCs |
| `supabase/migrations/20261130000003_orch_1255_claim_rpcs_public_views.sql` | M4 — create/review RPCs, public views, consumer resolvers, decommissions |
| `supabase/migrations/20261130000004_orch_1255_orphan_place_cleanup.sql` | M5 — F-8/D-1 orphan cleanup |

All applied via the Management API from MERGED main at CLOSE, in order, each verified with one read-back query (per `feedback_supabase_edge_deploy_verify_first_call` discipline). Every migration wrapped in `BEGIN;…COMMIT;`, idempotent-guarded (`IF NOT EXISTS` / `DROP … IF EXISTS`), `$function$` dollar-tags closed before GRANTs (house convention per the 1148 files).

#### 4.A.2 M1 — `venue_listings` (exact DDL)

```sql
CREATE TABLE IF NOT EXISTS public.venue_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  place_pool_id uuid NULL REFERENCES public.place_pool(id) ON DELETE SET NULL,
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9]{1,32}$'),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  address text NULL,
  city text NULL,
  country_code text NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  venue_category text NOT NULL CHECK (venue_category IN ('restaurant','play','creative_and_arts')),
  google_place_id text NULL,
  contact_email text NULL,
  contact_phone text NULL,
  cover_media_url text NULL,
  cover_media_type text NULL CHECK (cover_media_type IS NULL OR cover_media_type IN ('image','video','gif')),
  claim_status text NOT NULL DEFAULT 'none'
    CHECK (claim_status IN ('none','pending_review','verified','rejected','suspended','revoked')),
  claim_follow_up_at timestamptz NULL,
  rejection_reason text NULL,
  claim_decision_emailed_at timestamptz NULL,
  marked_called_at timestamptz NULL,
  marked_called_by uuid NULL,
  duplicate_of_venue_id uuid NULL REFERENCES public.venue_listings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_listings_brand_slug_uniq UNIQUE (brand_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS venue_listings_place_uniq
  ON public.venue_listings (place_pool_id) WHERE place_pool_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS venue_listings_brand_idx ON public.venue_listings (brand_id);
CREATE INDEX IF NOT EXISTS venue_listings_claim_status_idx ON public.venue_listings (claim_status);
```
- Slug CHECK mirrors `biz_create_venue_brand_authoring`'s `'^[a-z0-9]{1,32}$'` (1186-A re-statement, line 184) — venue slugs reuse the existing generator.
- `venue_listings_place_uniq` = one listing per place globally (preserves the 1:1 place↔listing semantics the resolvers and admin suspend rely on; inventory #14).
- Standard `updated_at` trigger `tg_venue_listings_set_updated_at` (house per-table pattern, verbatim shape of `tg_venue_tables_set_updated_at`).
- The claim state machine on this row is **exactly** the F-§Pipeline machine (D-4): `none → pending_review → verified/rejected`; `pending_review + claim_follow_up_at` = needs-fixes; `verified → suspended/revoked`; resubmit → `pending_review`. No new states, no new transitions.

**RLS (exact policies):**
```sql
ALTER TABLE public.venue_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "venue_listings brand member can read" ON public.venue_listings
  FOR SELECT TO authenticated
  USING (public.biz_is_brand_member_for_read_for_caller(brand_id));

CREATE POLICY "venue_listings admin can read" ON public.venue_listings
  FOR SELECT TO authenticated
  USING (public.is_admin_user());

GRANT SELECT ON public.venue_listings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_listings TO service_role;
-- NO grant to anon. NO INSERT/UPDATE/DELETE policies for authenticated:
-- ALL writes go through SECURITY DEFINER RPCs or service-role edge functions.
```
**Adversarial note:** anon must get `permission denied` on any direct `venue_listings` read (no anon grant — public reads only via `venue_public_view`). An authenticated user of brand X must see zero rows of brand Y (member predicate) and must be unable to INSERT/UPDATE any row at all (no write policy + no write grant) — including flipping their own `claim_status` to `verified`. RLS-RETURNING-OWNER-GAP: not reachable — the table has no client INSERT path; the create RPC is SECURITY DEFINER and returns only the new id.

**Brand-match integrity trigger** (shared by M2/M3 tables):
```sql
CREATE OR REPLACE FUNCTION public._orch1255_venue_belongs_to_brand()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.venue_listings v
     WHERE v.id = NEW.venue_id AND v.brand_id = NEW.brand_id) THEN
    RAISE EXCEPTION 'venue_brand_mismatch';
  END IF;
  RETURN NEW;
END; $$;
```
Attached `BEFORE INSERT OR UPDATE` to every table that carries `(brand_id, venue_id)`. **Adversarial note:** a manager of brand X (rank passes their own brand's RLS WITH CHECK) must NOT be able to point a row at brand Y's `venue_id` — the trigger closes the cross-brand splice the per-brand RLS alone cannot see.

#### 4.A.3 M2 — pipeline + feedback re-key (exact DDL)

```sql
-- Assert-empty guards (F-8: prod counts are 0; fail LOUD if drifted).
DO $$ BEGIN
  IF (SELECT count(*) FROM public.brand_place_pipeline_state) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: pipeline rows exist — re-run F-8 audit'; END IF;
  IF (SELECT count(*) FROM public.venue_claim_feedback) > 0
  THEN RAISE EXCEPTION 'orch1255_precondition: feedback rows exist — re-run F-8 audit'; END IF;
END $$;

ALTER TABLE public.brand_place_pipeline_state
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.brand_place_pipeline_state ALTER COLUMN venue_id SET NOT NULL; -- safe: table empty
ALTER TABLE public.brand_place_pipeline_state
  DROP CONSTRAINT IF EXISTS brand_place_pipeline_state_brand_unique;          -- THE F-2 lock
ALTER TABLE public.brand_place_pipeline_state
  ADD CONSTRAINT brand_place_pipeline_state_venue_unique UNIQUE (venue_id);

ALTER TABLE public.venue_claim_feedback
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_claim_feedback ALTER COLUMN venue_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vcf_venue_round
  ON public.venue_claim_feedback (venue_id, round DESC, created_at);
```
- Both tables KEEP `brand_id NOT NULL` — the existing ownership RLS (`b.account_id = auth.uid()` on pipeline; `biz_brand_effective_rank_for_caller(brand_id) >= biz_role_rank('brand_owner')` on feedback, F-6) survives verbatim and is already multi-row-safe (F-6 evidence). Attach `_orch1255_venue_belongs_to_brand` to both.
- **Adversarial note (pipeline):** owner-scoped policies are per-brand; with N rows per brand the same predicates hold per row. The silent-overwrite hazard (R-1: `onConflict:"brand_id"` clobbering venue #1 with venue #2) is now structurally impossible — the conflict target no longer exists. **Adversarial note (feedback):** D-3 discovery — `place_pool_id` existed but was absent from predicates; `venue_id` is now the keying column and the owner-read predicate still denies other-brand reads.

#### 4.A.4 M3 — per-venue ops re-key (D-3: NO shared inventory survives)

Assert-empty guard first (same `DO $$` shape) over: `brand_hours` (venue-scoped check below), `venue_reservation_settings`, `venue_tables`, `venue_capacity_rules`, `venue_availability_config`, `venue_blackouts`, `venue_waitlist`, `reservations`. (Brands were wiped 2026-06-22 with CASCADE; if any count > 0 the migration fails loudly and the implementor re-audits.)

```sql
-- HOURS — brand_hours stays the single owner (1186-A contract), now venue-scoped rows:
ALTER TABLE public.brand_hours
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.brand_hours DROP CONSTRAINT IF EXISTS brand_hours_brand_weekday_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS brand_hours_venue_weekday_uniq
  ON public.brand_hours (venue_id, weekday) WHERE venue_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS brand_hours_legacy_brand_weekday_uniq
  ON public.brand_hours (brand_id, weekday) WHERE venue_id IS NULL;   -- legacy NULL rows keep old shape

-- RESERVATION SETTINGS — PK moves brand → venue (assert-empty makes this safe):
ALTER TABLE public.venue_reservation_settings
  ADD COLUMN IF NOT EXISTS venue_id uuid REFERENCES public.venue_listings(id) ON DELETE CASCADE;
ALTER TABLE public.venue_reservation_settings ALTER COLUMN venue_id SET NOT NULL;
ALTER TABLE public.venue_reservation_settings DROP CONSTRAINT venue_reservation_settings_pkey;
ALTER TABLE public.venue_reservation_settings ADD PRIMARY KEY (venue_id);
-- brand_id loses PK but stays NOT NULL (RLS keying). Enabled partial index re-created on (venue_id).

-- TABLES / CAPACITY / AVAILABILITY / BLACKOUTS / WAITLIST / RESERVATIONS —
-- each: ADD venue_id REFERENCES venue_listings ON DELETE CASCADE; SET NOT NULL;
-- venue_availability_config: DROP CONSTRAINT venue_availability_config_brand_id_key;
--   ADD CONSTRAINT venue_availability_config_venue_id_key UNIQUE (venue_id);
-- each: CREATE INDEX <t>_venue_idx ON <t>(venue_id) (+ venue-scoped variants of the
--   existing hot indexes: reservations (venue_id, reserved_for), (venue_id, status);
--   venue_waitlist (venue_id, status, created_at); venue_tables (venue_id) WHERE is_active).
-- each: attach _orch1255_venue_belongs_to_brand BEFORE INSERT OR UPDATE.
```
**RLS on ops tables: UNCHANGED.** Every policy stays keyed on `brand_id` (`biz_is_brand_member_for_read_for_caller` / rank ≥ `event_manager` — verbatim predicates in the 1148 files). Venue scoping is data-shape (`venue_id NOT NULL` + brand-match trigger), not privilege-shape: the team of the brand manages all its venues (D-1: one team). **Adversarial note:** other-brand callers were already denied by the brand predicates; the NEW risk introduced by multi-venue — brand-X manager writing rows that reference brand-Y's venue — is closed by the trigger. Anon has no grants on any ops table (unchanged). **RETURNING-OWNER-GAP check:** ops tables allow client INSERT…RETURNING (FOR ALL policies); the writer rank (≥ event_manager) strictly implies the member-read predicate, so RETURNING always passes the SELECT policy — gap closed by construction; the M3 SQL test must still probe it (T-A6).

**Engine RPC re-key (exact signature deltas).** Each function below: re-state the LATEST definition VERBATIM from its named source file, changing ONLY the venue-scope resolution (`p_brand_id` param → `p_venue_id`; internal `WHERE brand_id =` → `WHERE venue_id =`; `brand_id` derived via `SELECT brand_id FROM venue_listings WHERE id = p_venue_id` wherever payments/currency/ownership need it; ownership checks keep the SAME rank helpers against the derived `brand_id`). `DROP FUNCTION` the old signature in the same migration (PostgREST named-arg calls would otherwise be ambiguous).

| New signature | Latest-def source (re-state from) |
|---|---|
| `pg_venue_available_slots(p_venue_id uuid, p_date date, p_party_size int)` — new name kept, param renamed | `20261008000001_orch_1148_available_slots_rpc_v2.sql` |
| `pg_venue_turn_minutes_for_party(p_venue_id uuid, …)` | same file |
| `biz_reservation_create(p_venue_id uuid, p_reserved_for timestamptz, p_party_size int, …12 params unchanged)` RETURNS `public.reservations` | `20261010000001_orch_1148_reservation_lifecycle_rpcs.sql` |
| `biz_reservation_transition(…, p_venue-scoped)` | same file |
| `biz_waitlist_convert_to_reservation`, `biz_waitlist_mark_notified` (venue-scoped) | `20261010000002_orch_1148_waitlist_rpcs_and_indexes.sql` |
| `pg_create_guest_reservation(p_venue_id uuid, … rest unchanged)` | `20261012000003_orch_1148_2_2_guest_reservation_rpc.sql` |
| `pg_finalize_guest_reservation`, `pg_cancel_guest_reservation`, `pg_cancel_my_reservation` (row-keyed already — only their settings/cutoff lookups move to `venue_id`) | same file + `20261012000005` |
| `resolve_brand_pricing_inputs(p_brand_id uuid)` — **UNTOUCHED** (payments stay brand-keyed, D-1) | n/a |

**`[TRANSITIONAL-1]` legacy consumer-binary shim:** shipped consumer binaries call `pg_venue_available_slots(p_brand_id, …)` and `venue-reservation-create` with `brand_id` (call sites: `app-mobile/src/hooks/useVenueAvailability.ts`, `src/services/venueReservationService.ts`), and consumer OTA is frozen. M3 therefore ALSO creates a compat overload `pg_venue_available_slots(p_brand_id uuid, p_date date, p_party_size int)` that resolves the brand's venue IFF the brand has exactly one venue row (else returns zero rows — fail-soft empty slot list, no crash, no dead 500), and the reservation edge fns accept `venue_id` (new) OR legacy `brand_id` (resolved the same single-venue way, else HTTP 409 `venue_ambiguous`). **Exit condition:** next consumer native build ships + OTA freeze lifts → drop the overload + legacy body path in a follow-on migration. RETURNING note: `biz_reservation_create` RETURNS `public.reservations` from a SECURITY DEFINER body — it must re-assert caller rank BEFORE the INSERT (existing pattern) so the definer RETURNING cannot leak another brand's row.

#### 4.A.5 M4 — create/review RPCs, public views, resolvers, decommissions

**New create RPC (replaces the hidden-brand path, D-1):**
```sql
CREATE OR REPLACE FUNCTION public.biz_create_venue_listing (
  p_brand_id uuid,
  p_name text, p_slug text, p_description text,
  p_google_place_id text, p_lat double precision, p_lng double precision,
  p_city text, p_country_code text, p_address text,
  p_venue_category text, p_contact_email text, p_contact_phone text,
  p_cover_media_url text, p_cover_media_type text,
  p_hours jsonb, p_place_pool_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
```
Body contract (mirrors `biz_create_venue_brand_authoring` 1186-A verbatim EXCEPT the brand insert):
1. `auth.uid()` required; `biz_brand_effective_rank_for_caller(p_brand_id) >= biz_role_rank('brand_owner')` else `forbidden`; brand must exist non-deleted.
2. Input validation IDENTICAL to the old RPC (name/slug regex/location/7-hours/category/cover-type checks, `place_pool` active + google-id match guard — lines 176–231 of the 1186-A def).
3. `INSERT INTO venue_listings (brand_id, …, claim_status) VALUES (p_brand_id, …, 'pending_review') RETURNING id INTO v_venue_id`. **NO INSERT INTO brands. Ever.** (I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE.)
4. 7 `brand_hours` rows inserted with `(brand_id, venue_id, weekday, …)`.
5. Pipeline row inserted `(brand_id, venue_id, place_pool_id, 'draft', {"tier1":"created"})` `ON CONFLICT (venue_id) DO UPDATE` (same merge shape as 1186-A lines 319–339).
6. PERFORM the hours→service-periods bridge (`biz_derive_service_periods_from_brand_hours`) re-keyed to the venue (M3 re-states that helper venue-scoped).
7. `RETURN v_venue_id`. REVOKE from public/anon; GRANT EXECUTE to authenticated.

**Adversarial note:** an authenticated user who is NOT brand-owner-rank on `p_brand_id` must get `forbidden` (a member of another brand cannot attach venues to brands they don't own); slug collisions surface as unique-violation on `(brand_id, slug)` (client maps to SlugCollisionError); duplicate place claims are blocked by `venue_listings_place_uniq` (23505 → "already in our verification queue" client copy, existing shape).

**Review RPCs re-keyed (D-4 — same states, same transitions, same side-effects, venue row):** re-state latest defs with `p_brand_id uuid` → `p_venue_id uuid` and `public.brands` claim reads/writes → `public.venue_listings`; DROP the old brand-keyed signatures in this migration.

| New signature | Re-state from | Notes |
|---|---|---|
| `biz_review_venue_claim(p_venue_id uuid, p_action text, p_rejection_reason text DEFAULT NULL)` | `20260729000000_meta_orch_0972` (lines 698+) | `mark_called/approve/reject/need_more_info` byte-identical transitions on the venue row; duplicate-claim guard now checks `google_place_id` against OTHER `venue_listings` rows verified elsewhere → sets `duplicate_of_venue_id` |
| `admin_get_claim_review_bundle(p_venue_id uuid)` | `20260901000000_orch_1064` (line 297) | bundle joins `venue_listings` + its `place_pool` + feedback rounds by `venue_id` |
| `admin_add_venue_claim_feedback(p_venue_id uuid, p_items jsonb, p_overall_message text)` | `20260901000000` line 106 / `20260909000000` redef | inserts feedback rows with `(brand_id, venue_id, round, …)`; stamps `venue_listings.claim_follow_up_at` |
| `biz_resubmit_venue_claim(p_venue_id uuid)` | `20260909000000` line 267 | same `pending_review/suspended + follow_up_at` gate + rank ≥ brand_owner on the DERIVED brand_id; clears stamp, back to `pending_review` |
| `biz_mark_feedback_item_fixed(…)` | `20260901000000` line 188 | ownership via derived brand rank; row keyed as-is |
| `admin_suspend_listing(p_place_id uuid, …3 params unchanged)` | `20260909000000` line 60 | resolve `venue_listings WHERE place_pool_id = p_place_id AND claim_status='verified'` (was `brands.place_pool_id … limit 1`, inventory #14); suspend the VENUE row + `place_pool.is_active=false` + feedback round + owner notify (owners resolved via the venue's `brand_id` team) |
| `admin_soft_delete_listing(p_place_id uuid, …)` / `admin_restore_listing(p_place_id uuid)` | same file | revoke/restore on the venue row; place soft-delete unchanged (I-1073-DELETED-PLACE-NEVER-SERVABLE trigger untouched) |

**Adversarial note (all review RPCs):** every one keeps `auth.uid()` + `is_admin_user()` (admin ones) / rank-check (biz ones) at entry — verbatim from the source defs. A brand owner must NOT be able to call `biz_review_venue_claim` (admin-only) on their own venue; an admin RPC given a venue in the wrong state must RAISE (`brand_not_pending_review` shape → `venue_not_pending_review`), never silently transition.

**Public read model (D-2) — SECURITY DEFINER view (house precedent `claimed_venues_public_view` + 20260731000000 definer ruling):**
```sql
CREATE VIEW public.venue_public_view AS
SELECT
  v.id, v.brand_id, b.slug AS brand_slug, b.name AS brand_name,
  v.slug, v.name, v.address, v.city, v.country_code, v.lat, v.lng,
  v.venue_category, v.google_place_id, v.contact_email, v.contact_phone,
  v.cover_media_url, v.cover_media_type, v.place_pool_id,
  b.theme_color, b.theme_font, b.theme_animation, b.cover_hue,
  b.default_currency,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'weekday', bh.weekday,
      'open_time', to_char(bh.open_time::interval, 'HH24:MI'),
      'close_time', to_char(bh.close_time::interval, 'HH24:MI'),
      'is_closed', bh.is_closed) ORDER BY bh.weekday), '[]'::jsonb)
     FROM public.brand_hours bh WHERE bh.venue_id = v.id) AS hours,
  pp.stored_photo_urls AS pool_photo_urls,
  v.created_at, v.updated_at
FROM public.venue_listings v
JOIN public.brands b ON b.id = v.brand_id AND b.deleted_at IS NULL
LEFT JOIN public.place_pool pp ON pp.id = v.place_pool_id
WHERE v.claim_status = 'verified';
-- security_invoker stays FALSE (definer) per the 20260731000000 ruling; then:
GRANT SELECT ON public.venue_public_view TO anon, authenticated;
```
Column exposure mirrors `claimed_venues_public_view` exactly (contact fields are intentionally public for venues — shipped precedent; hours agg format byte-identical so `PublicVenue` mapping reuses). **Adversarial note:** anon sees ONLY `claim_status='verified'` venues of non-deleted brands; `pending_review`/`rejected`/`suspended`/`revoked` rows are invisible; no Stripe/account columns cross the view; anon still has zero direct access to `venue_listings` and `brands`. This IS the security barrier the dispatch requires (definer view + WHERE scoping — same mechanism that gates `/b/{slug}` today).

**Consumer resolvers re-keyed (F-7, return contracts preserved):**
- `pg_brand_experiences_for_place(p_place_pool_id uuid)` — re-state latest def (`20261013000000_orch_1155`) changing ONLY the brand resolution: `FROM brands b WHERE b.place_pool_id = p AND b.claim_status='verified'` → `FROM venue_listings v JOIN brands b ON b.id = v.brand_id WHERE v.place_pool_id = p AND v.claim_status='verified' AND b.deleted_at IS NULL`. Same columns out.
- `pg_venue_reservable_for_place(p_place_pool_id uuid)` — re-state latest def (`20261012000006`) with the same join swap; `venue_reservation_settings` read moves to `vrs.venue_id = v.id`; RETURNS TABLE gains **additive** `venue_id uuid` (NULL when not reservable — same no-dead-tap NULL discipline as the existing `brand_id` column; I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE preserved: still only display-gate fields).

**Legacy public view `[TRANSITIONAL-2]`:** `claimed_venues_public_view` (brands-based) is KEPT UNCHANGED — it now permanently returns 0 rows (no brand will ever be `claim_status='verified'` again: the only writer path is decommissioned) so old shipped binaries' `/b/{slug}` overlay degrades gracefully to the plain brand page. **Exit condition:** drop the view after the next business+consumer native builds supersede shipped binaries.

**Decommissions (D-1):**
- `biz_create_venue_brand_authoring(…16 args)` — REPLACED with a stub of identical signature: `RAISE EXCEPTION 'venue_creation_moved:update_app'` (old binaries get the wizard's sanitized generic error — sanitizer passes non-vendor codes through `sanitizeAuthoringError` to the generic fallback, no vendor leak, no crash). Stub carries a comment naming this spec.
- `DROP FUNCTION IF EXISTS public.biz_create_venue_brand_pending_review(…)` — dead RPC (investigation D-4 discovery; live client never calls it).
- RLS predicates on `place_pool` re-keyed: `"Public can read place_pool for verified-claimed venues"` USING becomes `EXISTS (SELECT 1 FROM venue_listings v JOIN brands b ON b.id=v.brand_id WHERE v.place_pool_id = place_pool.id AND v.claim_status='verified' AND b.deleted_at IS NULL)`; `place_pool_business_owner_update`'s brand arm becomes `EXISTS (… b.id = place_pool.business_author_brand_id …) OR EXISTS (SELECT 1 FROM venue_listings v WHERE v.place_pool_id = place_pool.id AND public.biz_brand_effective_rank_for_caller(v.brand_id) >= public.biz_role_rank('event_manager'))`. **Adversarial note (R-2):** these are the anon photo/hours gate and the owner place-write gate — the SQL tests below prove (a) anon reads a place ONLY when its venue is verified, (b) brand-X members cannot UPDATE a place linked to brand-Y's venue.

#### 4.A.6 M5 — orphan cleanup (investigation D-1 side issue: INCLUDED, not deferred)

```sql
UPDATE public.place_pool pp
   SET deleted_at = now(),
       deleted_reason = 'orch-1255: 2026-06-22 wipe-leftover orphan (no brand/venue reference)',
       is_claimed = false, claimed_by = NULL
 WHERE pp.fetched_via = 'business_authored'
   AND pp.business_author_brand_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.brands b WHERE b.place_pool_id = pp.id)
   AND NOT EXISTS (SELECT 1 FROM public.venue_listings v WHERE v.place_pool_id = pp.id);
```
The `_orch1073` trigger force-holds `is_servable=false AND is_active=false` on soft-delete (verified invariant), which also answers the investigation's "verify is_servable first" caveat structurally. Predicate is self-limiting to true orphans (currently the 3 F-8 rows: Lumen Wine Bar, The Tuscanny Place, Lantern & Vine).

#### 4.A.7 Edge functions (Leg A)

- **`run-business-place-authoring-pipeline`** — keying changes ONLY:
  - Request body: `venue_id uuid` REQUIRED on every action (validated at entry next to `brand_id`; the venue must belong to the authed brand — reuse `loadOwnedBrand` then assert `venue.brand_id === brand.id` via a `loadOwnedVenue` helper).
  - `upsertPipelineState` (index.ts:652–674): row gains `venue_id`; `.upsert(row, { onConflict: "venue_id" })` (was `"brand_id"`, line 673 — R-1 kill).
  - The 6 `body.place_pool_id ?? brand.place_pool_id` fallbacks (lines 1158/1339/1456/1522/1591/1618) become `body.place_pool_id ?? venue.place_pool_id`.
  - `handleTier1`'s brand-pointer writes (`brands.place_pool_id`, index.ts:545–552, 612–623) → write `venue_listings.place_pool_id` instead. **`brands.place_pool_id` gains NO new writers — one owner per truth: the venue row IS the truth** (no dual-write; the brand column is legacy-inert, readers migrate in Legs B/C).
  - Everything else (Gemini stages, bouncer, scoring, sanitized errors) byte-identical. `x-client-info` CORS header preserved (COMMS-0056 rule).
- **`admin-review-venue-claim`** — body `brand_id` → `venue_id` on every action; RPC calls use the new venue-keyed signatures; approve/reject decision email guard reads/stamps `venue_listings.claim_decision_emailed_at` (once-per-VENUE, R-7); push idempotency key becomes `business.claim_decision:{venueId}:{decision}`; deep links (lines 651, 686) become `mingla-business://brand/{brandId}/listing?venue={venueId}` (+`&focus=feedback` where present) — the kept alias route forwards (Leg B). `runApproveGoLive(place_pool_id)` internals untouched (axis 3 per-place, invariants I-CLAIM-REBOUNCE-ON-APPROVE + I-SCORER-INVOKE-HAS-SIGNAL-ID verbatim).
- **`venue-claim-submitted-email`** — body `brand_id` → `venue_id`; asserts `venue_listings.claim_status = 'pending_review'`; email copy fields (venue name, brand name) read from the venue row + its brand.
- **`venue-claim-decision-email`** — same re-key (venue name + per-venue public URL `https://usemingla.com/b/{brandSlug}/v/{venueSlug}` in the approve template).
- **`venue-reservation-create` / `venue-reservation-confirm` / `venue-reservation-cancel`** — scope param `venue_id` (with the `[TRANSITIONAL-1]` legacy `brand_id` single-venue resolution + 409 `venue_ambiguous`); fee/payment resolution unchanged via the venue's derived `brand_id` (D-1 one-Stripe-per-brand).

Deploy: all 7 via `supabase functions deploy --project-ref gqnoajqerqhnvulmnyvv`, each verified with one live curl (edge-deploy discipline).

### LEG B — business-app client

**File-by-file contract (allowlist = exactly these + their tests):**

1. **`src/components/ui/UniversalCreatorSheet.tsx`** — 4th ROOT_OPTIONS entry appended (F-9):
   `{ key: "venue", iconName: "location", title: "Create venue listing", subtitle: "A physical place — get discovered and take bookings.", route: "/venue/create", testID: "universal-creator-venue" }`.
   Type deltas: `RootOption.key` union += `"venue"` (line 93); local `IconName` union (line 90) += `"location"` (glyph exists — `BrandEditView` uses `leadingIcon="location"`). Renders UNCONDITIONALLY for every brand (I-BRAND-UNIVERSAL-AUTHORING — investigation flagged this as the sibling-consistent choice; binding here). Route uses the existing `pushRoute` close+push path (lines 216–227) — no new logic. Copy + row geometry per DESIGN §2.1/§2.2. **REQUIRED fit fix (DESIGN §2.2 verdict: 4 rows do NOT fit on SE/short-Android/phone-web):** (a) root-step rows only: `paddingVertical` 16 → 12 + subtitle `numberOfLines={2}`; (b) **`src/components/ui/TopSheet.tsx`** compact mode gains a viewport clamp `min(measured + 24, screenHeight − panelTop − spacing.xl)` with conditional content scroll ONLY when clamped (`fixed-70` + Brand Switcher untouched). Both parts are in-allowlist.
2. **`src/services/venueListingsService.ts` (NEW)** — `fetchVenueListings(brandId): Promise<VenueListing[]>` (SELECT on `venue_listings` via owner RLS, ordered `created_at`); `createVenueListing(input): Promise<string /*venueId*/>` calling RPC `biz_create_venue_listing` (arg mapping mirrors `createVenueBrandPendingReview`, brandsService.ts:441–495, incl. 23505→SlugCollisionError mapping and the AppsFlyer event renamed `mingla_venue_listing_submitted`); `invokeVenueClaimSubmittedEmail(venueId)` body `{ venue_id }`. `VenueListing` type: `{ id, brandId, placePoolId, slug, name, address, city, countryCode, venueCategory, coverMediaUrl, coverMediaType, claimStatus, claimFollowUpAt, rejectionReason, createdAt }`.
3. **`src/hooks/useVenueListings.ts` (NEW)** — query key factory `venueListingKeys.byBrand(brandId)` (no hardcoded strings); `useVenueListings(brandId)`; `useCreateVenueListing()` mutation invalidating `byBrand` + pipeline keys; `onError` REQUIRED.
4. **`src/hooks/useBrandPlacePipelineState.ts`** — add venue-keyed variants: `byVenue(venueId)` key + `useVenuePipelineState(venueId)` (`.eq("venue_id", venueId).maybeSingle()`), and `useBrandPipelineStates(brandId)` list fetch (per-venue statuses for cards/todos). `byBrand` single-row read DELETED (its `.maybeSingle()` is wrong the moment N rows exist — F-2 client leg).
5. **`src/services/businessPlaceAuthoringService.ts`** — `fetchBrandPlacePipelineState` re-shaped per #4; every pipeline edge-fn action payload gains required `venue_id`; `upsertTier1Place` signature gains `venueId` (passed to the edge fn).
6. **`src/components/venue/VenueCreatorWizard.tsx`** — submit path (lines 85–255) rewired: `useCreateVenueListing().mutateAsync({ brandId: currentBrand.id, … })` (venue attaches to the CURRENT brand — F-1 kill); then `upsertTier1Place({ brandId, venueId, … })`; **DELETE** the `setCurrentBrandId(brand.id)` active-brand switch (lines 220–225 + comment); success state carries `{ venueId, placePoolId }` into `VenueDeckReadinessSetup` (prop re-shape). ALL ≥4 `sanitizeAuthoringError` call sites preserved (I-PROPOSED-1218 strict-grep gate counts them — do not drop below 4).
7. **`src/store/draftVenueStore.ts`** — multi-draft fix (F-13c, R-5): persisted shape becomes `{ drafts: Record<string /*brandId*/, DraftVenueState> }` (persist name bumped to `mingla-business-draft-venue-v2`; v1 blob abandoned — prod-safe, it's a pre-submit draft). API: `useDraftVenueStore(brandId)` selectors; `reset(brandId)` clears only that brand's draft. Wizard + todos pass the current brand id. Two brands can now hold concurrent drafts without collision.
8. **`src/hooks/useHubTabs.ts`** — `HubVenueVisibility` → `{ venueCount: number }`; `deriveHubVisibleTabs` venue arm becomes `if (venue.venueCount > 0) visible.push("venue")` (D-5: ≥1 venue row ANY state; `hasPhysicalLocation`/`hasPlacePool` drop out — F-10).
9. **`app/(tabs)/hub/_layout.tsx`** — `venueVisibility` memo (lines 83–93) replaced by `useVenueListings(currentBrand.id)` count. LOCKED DECISION 5 pill-row bridge (lines 103–114, 285–306) untouched.
10. **`app/(tabs)/hub/listing.tsx`** — becomes the VENUE CARD LIST tab (DESIGN §4). It no longer mounts the suite and no longer activates `venueSuiteStore` (Hub offering pills stay visible over the list — DESIGN §5.4a). Card list component `src/components/venue/VenueListCard.tsx` + list host (NEW, DESIGN §4 anatomy/states binding — modeled 1:1 on `EventListCard`):
    - Data: `useVenueListings(brandId)` + `useBrandPipelineStates(brandId)`.
    - Card contents (D-5, NO fabricated fields): venue `name`; cover = `coverMediaUrl` else first `place_pool` photo else the DESIGN §4 neutral placeholder tile (never a stock/fabricated image); status chip = shared `ListingStatusChip` (NEW extraction of the proven badge at `VenueListingContent.tsx:269-274, 462-472`, zero restyle — DESIGN §3) fed by `listingStatusView({ hasVenue: true, status: pipelineByVenue[id]?.status ?? null, claimStatus })` REUSED UNCHANGED (F-10: already produces Live/In review ("pending admin approval")/Needs fixes/Draft/Processing/Changes needed/Suspended/Removed); secondary line = `address ?? city` (omit line when both null — no placeholder text).
    - States per DESIGN §4.3/4.6–4.9: loading (skeleton), error (retry), empty (headline + "Create venue listing" button → `/venue/create`), populated. Tap → `router.push("/venue/{id}")` (DESIGN §5.1). Trailing "+ Add another venue" row. Desktop ≥1024 = 4-column `DESKTOP_HUB_GRID_COLUMNS` grid (DESIGN §4.4). Every tappable ≥44pt, `accessibilityRole="button"`, label "{name}, {status label}" (I-38/I-39). `StyleSheet.create`; no inline color literals outside hex/rgb/hsl/hwb.
10b. **`app/venue/[venueId]/index.tsx` (NEW)** — the per-venue management PAGE (DESIGN §5, binding): pushed route `/venue/{venueId}` carrying the venue scope; header row per DESIGN §5.2 (back chevron "Back to your venues" → card list, venue name h3 truncating, trailing `ListingStatusChip` never truncating); mounts `VenueSuiteShell(brandId, venueId, focus)`. `venueSuiteStore.activate()/deactivate()` moves HERE (mount/unmount — LOCKED DECISION 5 consequences per DESIGN §5.4; if the layout bridge can't reach a pushed page on native, the shell's documented inline pill-row fallback applies). Back retains card-list scroll position. No venue switcher in the header (one venue on screen — zero wrong-venue writes).
11. **`src/components/venue/VenueSuiteShell.tsx`** — props `{ brandId, venueId, focus?, initialModule? }`; `useVenueReservationSettings(venueId)`, `useSetReservationsEnabled(venueId)`; passes `venueId` to every module; zero visual redesign of the modules (DESIGN §5.2). **All 7 modules + their hooks/services** (`VenueListingContent`, `VenueSettingsModule`, `VenueIntelligenceModule`, `VenueMenuModule`*, `VenueTablesModule`, `VenueAvailabilityModule`, `VenueReservationsModule`, `VenueWaitlistModule`; `useVenueReservationSettings`, `useVenueTables`, `useVenueAvailability`, `useVenueWaitlist`, `useBrandHours`) re-key reads/writes to `venue_id` (query keys gain venueId; table filters `.eq("venue_id", …)`; RPC calls pass `p_venue_id`). *`VenueMenuModule` keeps `brandId` (menus brand-level, `[TRANSITIONAL-3]`).
12. **`src/components/venue/VenueListingContent.tsx`** — `{ brandId, venueId, … }`; claim fields read from the VENUE row (`useVenueListing(venueId)` from #3) not `useBrand` (lines 104–120 re-point); `useVenueClaimOpenCount(venueId, followUpAt)`; resubmit calls `biz_resubmit_venue_claim({ p_venue_id })` (`src/services/venueClaimService.ts` re-key, incl. `venueClaimBannerLogic` input mapping — logic itself unchanged).
13. **`app/brand/[id]/listing.tsx`** (kept alias, F-12) — with `?venue={venueId}` forwards to `/venue/{venueId}?focus=…`; without it → the card list (`/(tabs)/hub/listing`), EXCEPT when the brand has exactly ONE venue → forward straight to that venue's page (DESIGN §5.6, decided here). Admin push/email deep-links (Leg A §4.A.7) carry `?venue=`.
14. **`src/utils/businessTodos.ts` + `src/hooks/useBusinessTodos.ts`** — venue rows ONLY (D-6 boundary — the `profile` input and any section-anchor work belong to ORCH-1256; do not touch any non-venue row or add/rename other inputs):
    - `add_venue` row DELETED (its only gate was `hasPhysicalLocation`, F-13b; creation now lives in the creator sheet — an unconditional nag for every brand is exactly what ORCH-1040 forbade).
    - `finish_venue` kept: gated on the CURRENT brand's in-progress draft (`venueDraftInProgress` from the per-brand draft store, #7); route `/venue/create`.
    - `get_venue_live` becomes PER-VENUE: input `venuePipelines: Array<{ venueId, venueName, status, route }>`; one row per venue with `status ∈ processing|needs_fix|failed`; label `Get {venueName} live` when the brand has >1 venue, else the existing copy; route = `routeForPipelineStateFix` fed the venue's pipeline row (deck-readiness route already accepts `place_pool_id` — F-10).
    - `venue_claim_review` becomes PER-VENUE: one row per venue with claim `pending_review|follow_up` (input `venueClaims: Array<{ venueId, venueName, variant, openCount }>`); badge per venue; routes `/brand/{brandId}/listing?venue={venueId}[&focus=feedback]`. Labels gain the venue name when >1 venue.
    - `hasPhysicalLocation` input field DELETED from `BusinessTodosInput`.
15. **`src/components/brand/BrandEditView.tsx`** — REMOVE ONLY (D-5/D-6): the PHYSICAL LOCATION GlassCard block (~lines 501–539: InlineToggle + inline "Add your venue" CTA), `handleClaimVenue` (~385–394), the now-orphaned styles, and the `draft.hasPhysicalLocation` field wiring. NO structural/section reshuffle (ORCH-1256 is adding section anchors here — delete whole blocks in place; if 1256 merges first, rebase and delete its anchored version of the same blocks).
16. **`src/utils/brandPatch.ts`** (lines 66–67) + **`src/services/brandMapping.ts`** (lines 449–450 write-mapping) — delete the `hasPhysicalLocation` WRITE paths (read mapping at brandMapping.ts:316 + `types/brand.ts:329–335` field may stay — harmless read of an inert column, per F-11).
17. **`src/services/publicEventsService.ts`** — see Leg C (#3) — shared file, single change set.

**DO-NOT-TOUCH (Leg B):** `app/(tabs)/home.tsx` creator mounts (inherit the 4th row automatically, F-9), `HubSubNav`, the nav-lock redirect/HUB_TAB_ROUTES, `venueSuiteStore` shape, TopSheet `fixed-70` mode + Brand Switcher (only the compact clamp of #1 is allowed), `sanitizeAuthoringError.ts`, all non-venue todo rows, everything under `app-mobile/` (Leg C owns its reserve-flow files), `packages/`, all Stripe/payment services, `businessTodos` `profile`/anchor work (ORCH-1256).

### LEG C — public surfaces + admin re-point + consumer reserve flow

1. **`mingla-business/app/b/[brandSlug]/v/[venueSlug].tsx` (NEW)** — house pattern clone of `app/b/[brandSlug]/index.tsx` (params → query → page/not-found/loading/error states, `captureWeb("web_public_offering_viewed", { offering_type: "venue", … })`). Renders `PublicVenuePage`.
2. **`src/components/venue/PublicVenuePage.tsx` (NEW)** — anon-safe page, DESIGN §6 BINDING (cover §6.1, identity block §6.2, about §6.3, address + static-map §6.4 via the existing server static-map proxy, hours §6.5, menu/price tiers + gallery §6.6, reserve affordance both variants §6.7, not-found/not-live §6.8, loading/error §6.9, desktop sticky panel §6.10): venue name + brand link back to `/b/{brandSlug}`, hours from the view's agg, photos from `pool_photo_urls`, brand menu section (existing `fetchPublicMenus(brandSlug)` — `[TRANSITIONAL-3]`), brand experiences/upcoming buckets (existing public fetchers by brandSlug). NO checkout/auth requirement; NO `useAuth` (anon-route rule — this route lives outside `(tabs)` exactly like `/b`). Every element without data is OMITTED (no fabricated placeholders). Currency-aware: any price badge uses that row's currency field (existing formatters) — never a hardcoded symbol.
3. **`src/services/publicEventsService.ts`** — NEW `getPublicVenue(brandSlug, venueSlug)` → `.from("venue_public_view").select("*").eq("brand_slug", brandSlug).eq("slug", venueSlug).maybeSingle()`; NEW `getPublicBrandVenues(brandSlug)` list. `getPublicBrandBySlug` (lines 1336–1400): the legacy `claimed_venues_public_view` overlay read is REPLACED by `getPublicBrandVenues` — return type `venue: PublicVenue | null` → `venues: PublicVenueSummary[]` (PublicBrandPage renders a "Locations" card list linking each `/b/{brandSlug}/v/{slug}`; empty array → section omitted). One owner per truth: after this change NO client code reads `claimed_venues_public_view` (the view survives only for old binaries, `[TRANSITIONAL-2]`).
4. **`src/components/brand/PublicBrandPage.tsx`** — "Locations" section per #3 (cards: name, address/city, photo thumb; tap → venue page). Omitted at 0 venues.
5. **`mingla-business/vercel.json`** — bot rewrite entry for `/b/:brandSlug/v/:venueSlug` (same UA matcher as the existing `/b/:brandSlug` block) → the existing brand SSR/OG destination with `brandSlug` (explicit v1 simplification: venue pages share the brand OG card).
6. **`mingla-admin/src/services/adminClaimsService.js`** — queue queries move `.from("brands")` → `.from("venue_listings")` with embedded joins `brand:brand_id(id,name,slug)`, `place_pool:place_pool_id(…same vetting fields…)`; the three `.eq("claim_status", …)` tab filters unchanged (state names identical, D-4). RPC/edge calls pass `venue_id` (bundle: `{ p_venue_id }`; edge body `{ venue_id, action, … }`). Admin reads pass RLS via the M1 `is_admin_user()` SELECT policy.
7. **`mingla-admin/src/pages/ClaimsPage.jsx`** — row rendering gains the parent brand name column ("{venue name} — {brand name}"); tab semantics/actions unchanged. The admin review UX keeps working end-to-end (D-4 hard requirement).
8. **`app-mobile` reserve flow** — `useVenueReservable.ts` consumes the additive `venue_id` column; `useVenueAvailability.ts` calls `pg_venue_available_slots({ p_venue_id })`; `venueReservationService.ts` + `VenueSlotPicker.tsx` pass `venue_id` to `venue-reservation-create`; `useMyReservations.ts` display unaffected (row-keyed). Deck code untouched.

**DO-NOT-TOUCH (Leg C):** `app-mobile` deck/discover components, `discover-cards` supply, checkout/payment flows, `mingla-admin` non-claims pages, `mingla-marketing`.

---

## 5. Success criteria (numbered, observable; per-surface where parity is manual)

- **SC-1 (Leg A):** `SELECT` two `biz_create_venue_listing` calls for the same brand → two `venue_listings` rows + two pipeline rows with distinct `venue_id`; `brands` row count UNCHANGED by both calls.
- **SC-2 (Leg A):** anon (`SET ROLE anon`) `SELECT * FROM venue_listings` → permission denied; anon `SELECT * FROM venue_public_view` → only `verified` rows; a `pending_review` venue is absent.
- **SC-3 (Leg A):** the full D-4 machine on ONE venue row while a SIBLING venue of the same brand holds a different state: `pending_review → need_more_info (follow_up stamped) → resubmit → approve → verified → suspend → resubmit → approve` — each transition via the re-keyed RPCs, sibling row unchanged after every step.
- **SC-4 (Leg A):** pipeline edge fn tier-1 for venue B of a brand whose venue A is `deck_eligible` → venue A's pipeline row is byte-identical before/after (R-1 clobber dead).
- **SC-5 (Leg A):** anon can read `place_pool` photos/hours ONLY for a place whose venue is `verified`; flipping that venue to `suspended` removes anon access on the next read.
- **SC-6-Web / SC-6-iOS / SC-6-Android (Leg B):** creator sheet shows 4 rows for EVERY brand; tapping "Create venue listing" lands on `/venue/create`; completing the wizard creates a venue under the CURRENT brand and the active brand does NOT switch.
- **SC-7-Web / SC-7-iOS / SC-7-Android (Leg B):** Hub venue tab appears iff the brand has ≥1 venue row (any state); tab shows the card list; each card shows name, cover-or-placeholder, correct `ListingStatusChip` label (a `pending_review` venue shows "In review"), and address/city; tapping a card pushes `/venue/{id}` scoped to THAT venue; back returns to the list with scroll retained.
- **SC-7b-iOS (Leg B):** on the smallest supported viewport (iPhone SE class), the 4-row creator sheet renders fully on screen with visible scrim below the panel (DESIGN §2.2 clamp proven), and event/experience chooser steps are visually unchanged.
- **SC-8 (Leg B):** BrandEditView contains no physical-location toggle and no "Add your venue" CTA; saving a brand profile emits NO `has_physical_location` in the patch.
- **SC-9 (Leg B):** with venue A `processing` and venue B claim-`pending_review` on one brand, the to-do list shows exactly one `get_venue_live` row naming A and one `venue_claim_review` row naming B; resolving each removes only its row. Brand with 0 venues + no draft → NO venue todo rows.
- **SC-10 (Leg B):** two brands can hold independent wizard drafts; switching brands mid-draft and back resumes the correct draft (v2 store).
- **SC-11-Web (Leg C):** `/b/{brandSlug}/v/{venueSlug}` renders anon (logged-out browser) for a verified venue: name, hours, photos, brand link; a `pending_review` venue's URL renders the not-found state (no data leak).
- **SC-12-Web (Leg C):** `/b/{brandSlug}` shows a Locations section listing all verified venues, each linking to its venue page; 0 venues → section absent.
- **SC-13 (Leg C):** mingla-admin Claims queue lists the pending VENUE row (venue+brand names); approve flows end-to-end: venue `verified`, place re-bounced + `is_servable=true`, decision email stamped once on the venue row, push deep-link carries `?venue={id}`.
- **SC-14 (Leg C):** consumer expanded card on the venue's deck card resolves reservable + `venue_id`; slot fetch + reservation create succeed venue-keyed; a second venue of the same brand with reservations OFF shows no Reserve affordance (per-venue settings proven end-to-end).
- **SC-15 (Leg A):** the 3 orphan places carry `deleted_at` + reason, `is_servable=false`, `is_active=false`.

## 6. Invariants

**Preserved (how):** I-VENUE-CLAIM-OPTIONAL (venue option adds a row; event/experience/trip authoring ungated); I-CLAIM-REBOUNCE-ON-APPROVE + I-SCORER-INVOKE-HAS-SIGNAL-ID (`runApproveGoLive` untouched); I-PROPOSED-1218-VENUE-AUTHORING-NO-VENDOR-LEAK (≥4 `sanitizeAuthoringError` calls kept; its strict-grep gate must stay green); I-BRAND-UNIVERSAL-AUTHORING (4th row unconditional); I-1073-DELETED-PLACE-NEVER-SERVABLE (trigger untouched; M5 leans on it); I-38/I-39 (card list + sheet row a11y/44pt); 16 desktop-web contracts + LOCKED DECISION 5 (pill-row bridge untouched); I-PROPOSED-1148-RESERVABLE-RESOLVER-EXPOSES-ONLY-DISPLAY-GATE (additive venue_id only); I-PROPOSED-1205-EDGE-CORS-X-CLIENT-INFO (all touched edge fns keep `_shared/cors.ts`).

**NEW (DRAFT — flip to ACTIVE at CLOSE, orchestrator owns the flip):**
- **I-PROPOSED-1255-VENUE-APPROVAL-PER-VENUE-ROW (DRAFT):** the unit of venue admin review is a `venue_listings` row; claim lifecycle columns live there; review/resubmit RPCs are venue-keyed; NO code path writes `brands.claim_status` from any venue flow. **Enforcement:** strict-grep gate `.github/scripts/strict-grep/orch-1255-venue-approval-per-venue-row.mjs` (`--self-test`, GOOD + BAD fixtures): FAILS if `supabase/functions/admin-review-venue-claim` or `venue-claim-*-email` reference `brands.claim_status` / `from("brands")` claim writes, or if `mingla-business/src/services/venueClaimService.ts` calls a `p_brand_id`-keyed review RPC. Wired into `strict-grep-mingla-business.yml`.
- **I-PROPOSED-1255-NO-HIDDEN-BRAND-ON-VENUE-CREATE (DRAFT):** venue creation never inserts a `brands` row. **Enforcement:** (a) SQL test `supabase/migrations/orch_1255_no_hidden_brand.test.sql` — call `biz_create_venue_listing`, assert `brands` count delta = 0 and `pg_get_functiondef('public.biz_create_venue_listing'::regproc)` contains no `INSERT INTO public.brands`; (b) strict-grep gate `orch-1255-no-hidden-brand-on-venue-create.mjs`: FAILS if `VenueCreatorWizard.tsx` / `venueListingsService.ts` reference `biz_create_venue_brand_authoring|biz_create_venue_brand_pending_review`, or if any migration ≥ 20261130000000 adds a functional (non-stub) body to those RPCs.
- **I-PROPOSED-1255-PER-VENUE-OPS-NO-SHARED-INVENTORY (DRAFT):** every row of `brand_place_pipeline_state`, `venue_reservation_settings`, `venue_tables`, `venue_capacity_rules`, `venue_availability_config`, `venue_blackouts`, `venue_waitlist`, `reservations` carries `venue_id NOT NULL` matching its `brand_id`'s venue. **Enforcement:** (a) SQL probe test `orch_1255_ops_venue_not_null.test.sql` (information_schema NOT NULL assertions + cross-brand-splice trigger probe expecting `venue_brand_mismatch`); (b) strict-grep `orch-1255-pipeline-no-brand-onconflict.mjs`: FAILS on `onConflict: "brand_id"` in `run-business-place-authoring-pipeline/index.ts`.
- **I-PROPOSED-1255-PUBLIC-VENUE-PAGE-ANON-SAFE (DRAFT):** anon venue reads flow ONLY through `venue_public_view` (security-definer, verified-only); `venue_listings` has no anon grant. **Enforcement:** (a) adversarial SQL test `orch_1255_public_view_anon.test.sql` (anon role: table read denied, view shows verified-only); (b) strict-grep `orch-1255-public-venue-anon-safe.mjs`: FAILS if `publicEventsService.ts` / `PublicVenuePage.tsx` query `from("venue_listings")` directly.

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-A1 (happy) | create 2 venues, one brand | 2× `biz_create_venue_listing` | 2 venue rows + 2 pipeline rows + 14 hours rows; brands delta 0 | DB |
| T-A2 (error) | non-owner creates | rank < brand_owner caller | `forbidden`; no rows | DB/RLS |
| T-A3 (edge) | duplicate place | 2nd venue with same `place_pool_id` | unique violation on `venue_listings_place_uniq` | DB |
| T-A4 (adversarial) | cross-brand splice | INSERT `venue_tables` row (brand X, venue of Y) as X-manager | `venue_brand_mismatch` | DB/trigger |
| T-A5 (adversarial) | anon harvest | anon SELECT `venue_listings`, `venue_public_view`, place photos of pending venue | denied / verified-only / denied | RLS/view |
| T-A6 (adversarial) | RETURNING gap probe | event_manager INSERT…RETURNING on each ops table | row returned (writer implies reader) | RLS |
| T-A7 (state machine) | SC-3 full walk + sibling isolation | RPC sequence | states per D-4; sibling untouched | DB |
| T-A8 (regression) | pipeline clobber | tier1 venue B with A `deck_eligible` | A's row unchanged | edge+DB |
| T-A9 (error) | stubbed legacy RPC | call `biz_create_venue_brand_authoring` | `venue_creation_moved:update_app` raise; 0 rows | DB |
| T-B1 (happy) | 4th option render+route | open sheet, any brand | 4 rows; venue row routes `/venue/create` | component (jest) |
| T-B2 (happy) | hub gate | `deriveHubVisibleTabs(counts, { venueCount: 1 })` / `{ venueCount: 0 }` | venue tab present / absent | unit |
| T-B3 (happy) | card status mapping | pending_review venue fixture | card label "In review" | unit |
| T-B4 (error) | card list query fails | reject fetch | error state with retry, no crash | component |
| T-B5 (edge) | per-brand drafts | draft under brand 1, switch to brand 2 | brand 2 draft empty; brand 1 resumes | unit (store) |
| T-B6 (todos) | SC-9 matrix | 2-venue pipeline/claim fixtures | exactly the per-venue rows | unit |
| T-B7 (removal) | toggle gone | render BrandEditView; build brandPatch | no toggle testID; no `has_physical_location` key | component/unit |
| T-C1 (happy) | venue page anon | logged-out fetch `/b/x/v/y` verified fixture | page renders name/hours/photos | web runtime |
| T-C2 (error) | unverified venue URL | pending venue slug | not-found state, zero venue data in payload | web runtime |
| T-C3 (happy) | admin approve E2E | pending venue in queue | SC-13 chain | admin+edge+DB |
| T-C4 (edge) | legacy consumer shim | `pg_venue_available_slots(p_brand_id)` on 1-venue and 2-venue brands | slots / empty set; reservation edge legacy body → 200 / 409 `venue_ambiguous` | DB/edge |
| T-C5 (per-venue settings) | SC-14 two-venue reservable split | venue A on, venue B off | Reserve shown only on A's card | consumer runtime |

## 8. Implementation order

1. **Leg A:** M1 → M2 → M3 → M4 → M5 (files §4.A.1) + SQL tests (`supabase/migrations/orch_1255_*.test.sql`, house `.test.sql` pattern) → edge fns (§4.A.7). Nothing client-visible until applied at CLOSE.
2. **Leg B:** types/services/hooks (#2–5) → store (#7) → wizard (#6) → hub gate+list (#8–10, new `VenueCardList`) → suite scoping (#11–12) → alias (#13) → todos (#14) → removals (#15–16) → jest suites + strict-grep gates.
3. **Leg C:** publicEventsService (#3) → venue page + route + brand section (#1,2,4) → vercel.json (#5) → admin (#6,7) → app-mobile reserve flow (#8) → runtime tests.
4. **CLOSE (orchestrator):** merge legs (ALL CI green) → apply M1–M5 via Management API in order (read-back verify each) → deploy 7 edge fns (curl-verify each) → Vercel `[deploy]` → NO `eas update` (COMMS-0052; native rides next builds) → flip DRAFT invariants → registry row removal + worktree reap.

**Merge-order awareness (D-6):** ORCH-1256 touches `BrandEditView.tsx` + `businessTodos.ts`. Whichever lands second rebases; this ORCH's edits are pure DELETIONS in BrandEditView and venue-row-only re-shapes in businessTodos, so conflicts are mechanical. If 1256's `?section=` anchors reference the physical-location section, that anchor dies with the section — flag to the orchestrator at rebase time, do not re-add the section.

## 9. Regression prevention (per leg, fails-on-revert, append-only aware)

All new test files are APPEND-ONLY once landed (I-test-append-only gate token discipline); gates wired into `strict-grep-mingla-business.yml` with `--self-test`.

- **Leg A:** implementor happy-path = T-A1/T-A7 as `.test.sql`; tester adversarial = T-A4/T-A5/T-A6/T-A8/T-A9. **Fails-on-revert:** restoring `UNIQUE (brand_id)` or `onConflict:"brand_id"` fails T-A8 + the `orch-1255-pipeline-no-brand-onconflict.mjs` gate; restoring a functional hidden-brand RPC body fails `orch_1255_no_hidden_brand.test.sql`. Protective comments in M2/M4 name R-1/F-1 and this spec.
- **Leg B:** implementor happy-path = T-B1/T-B2/T-B3 (jest, `mingla-business/__tests__/`); tester adversarial = T-B4/T-B5/T-B6/T-B7 + a Maestro flow (sheet → wizard → card list on sim). **Fails-on-revert:** re-adding the toggle block fails T-B7 + the strict-grep BrandEditView rule; re-pointing the wizard at `biz_create_venue_brand_authoring` fails the no-hidden-brand gate; reverting the hub gate to `hasPhysicalLocation` fails T-B2 (the flag no longer exists in the input type — compile-fail).
- **Leg C:** implementor happy-path = T-C1/T-C3; tester adversarial = T-C2/T-C4/T-C5 + logged-out browser run against the deployed preview (biz-web authed runtime is capped — anon pages are fully verifiable). **Fails-on-revert:** deleting the venue route file fails T-C1; re-pointing admin at `from("brands")` fails the per-venue-row gate + T-C3.

## 10. Open questions

- **OQ-1:** venue-page OG card shares the brand OG (v1 simplification, §L-C.5). Acceptable, or want a venue-specific OG card as a fast follow? (Does not block any leg.)
- **OQ-2:** `finish_venue` todo resumes the per-brand draft; with N in-flight venue ideas per brand we still keep ONE draft per brand (D-5 doesn't demand N parallel drafts). Confirm acceptable v1.
- **OQ-3:** menus `[TRANSITIONAL-3]` stay brand-level (D-3 list excludes them); exit = follow-on ORCH re-keying `menus.venue_id` + `public_menus_view`. Confirm.

## 11. Downstream routing + test-data note

**Routing:** orchestrator dispatches `mingla-implementor` per leg (A → B → C, sequential; each leg's report + gates green before the next), then `mingla-tester` per leg (adversarial angles §9), then orchestrator CLOSE per §8.4. Working tree: `~/Desktop/mingla-orchs/orch-1255-[venue-first-class-multi]` on branch `orch-1255-venue-first-class-multi`.

**Tester live-fire fixtures (prod has 0 venue rows):** create ONE dedicated test brand ("ORCH-1255 QA — do not approve" in the name) under Seth's operator account; create 2 venue listings with real-looking but clearly-test data in a low-traffic city; walk SC-3/SC-13 on venue A INCLUDING approve (venue briefly `verified` + place servable — acceptable minutes-long exposure); IMMEDIATELY `admin_soft_delete_listing` (revokes + trigger force-unserves), then hard-clean via Management API SQL: `DELETE FROM venue_listings WHERE brand_id = :testBrand` (cascades pipeline/feedback/ops), soft-delete the authored place rows, delete the test brand. Verify-clean query appended to the test report. No Stripe charges anywhere in scope (reservations fee paths not exercised beyond free-tier fixtures; Mingla Stripe is TEST mode regardless).

**Scoped allowlist / DO-NOT-TOUCH:** per-leg lists in §4 are BINDING. Implementor must stop-and-amend (SPEC_AMENDMENT file) before touching anything outside them — never silently widen.
