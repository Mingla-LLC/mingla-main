# SPEC — META-ORCH-1059 [experiences-business-parity] · SUB-A · CREATION FOUNDATION

**ORCH:** META-ORCH-1059 [experiences-business-parity] — **Sub-A** (the structural prerequisite; unblocks Sub-D checkout, feeds Sub-B/C)
**Skill:** mingla-forensics (mode: SPEC)
**Date:** 2026-06-02
**Worktree:** `~/Desktop/mingla-orchs/meta-orch-1059-[experiences-business-parity]/` on branch `meta-orch-1059-experiences-business-parity`
**Authoritative inputs (in precedence order):**
1. `Mingla_Artifacts/design/DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md` — **AUTHORITATIVE for Sub-A** (supersedes the lifecycle design's single-venue/GA-VIP model). The stops-builder + two-mode pricing + `experience_stops` shape are locked here.
2. `Mingla_Artifacts/design/DESIGN_META-ORCH-1059_EXPERIENCES_LIFECYCLE.md` — authoritative for the **date model** (lift `CreatorStep2When`) and the AI-parser flow change.
3. `Mingla_Artifacts/reports/INVESTIGATION_META-ORCH-1059_EXPERIENCES_BUSINESS_PARITY.md` — root-cause + checkout contract + blast radius.

**Locked operator model (DO NOT re-litigate):** An experience is a **brand-authored 2–5-stop itinerary sold as ONE ticket**. Each stop has a **1–5 image gallery + order + optional time + optional price + a location**. A **LOCATION MODE** toggle (one location for all stops vs per-stop locations) and a **PRICING MODE** toggle (one whole price vs per-stop summed) govern authoring. Dates are one-off / recurring / multi-date via the lifted event `CreatorStep2When`. The address provider is **MAPBOX** — this build births a shared Mapbox picker + a `mapbox-geocode` edge function returning the normalized `{placeId, formattedAddress, city, region, countryCode, location{lat,lng}}` shape (mirroring `mingla-business/src/components/event/AddressAutocompleteInput.tsx`'s `PlaceDetails` contract).

**Comms-ledger acks (read on entry):**
- **COMMS-0014 + COMMS-0016** (BLOCK-grade): experience checkout MUST route through the existing `ticket-checkout-create` edge fn / `biz_ticket_checkout_create_session` RPC. Sub-A introduces **zero** new money functions. The whole itinerary resolves to **ONE** `ticket_types` row at the resolved total → checkout is byte-identical to the existing engine. This is the spine of the spec (§INVARIANTS I-1).
- **COMMS-0013** (web-vs-native tax basis) carried forward unchanged (Sub-D concern; not touched here).
- **COMMS-0002** (backend allowlist): the new migration + the new `mapbox-geocode` edge fn ship in the **same commit** as their `supabase/config.toml` `[functions.mapbox-geocode]` block + the strict-grep allowlist additions (§LAYER 3 + §LAYER 7).
- **COMMS-0003** (external-API docs verified inline): every Mapbox endpoint/param is cited inline in §LAYER 3.
- No new cross-ORCH discovery this turn requiring a COMMS entry.

**Confidence:** HIGH on the data shape, RPC date logic (mirrors `business_publish_event_draft` proven body), and checkout contract (DB-probe-proven in the investigation). MEDIUM on Mapbox response-field availability (the geocode fn must defensively handle absent `region`/`countryCode` — §LAYER 3.4). Runtime sim repro is the tester's job post-implement (zero experiences in prod — clean slate).

---

## 0. EXECUTIVE SUMMARY (read this; the rest is build detail)

Today both experience-creation paths (manual `ExperienceCreatorWizard.tsx:160-188` + AI `agentTools.ts:474-491`) write a **single `events` row** with pricing as raw strings in `theme.experience_meta`, and **zero `ticket_types` + zero `event_dates`** — a "published-but-unsellable" state the locked checkout engine treats as not-found (`ticket_type_not_found` / `event_no_active_dates`). Sub-A makes creation **materialize a real, sellable, multi-stop experience**.

Sub-A delivers, layer by layer:

1. **`experience_stops` table** (mirrors `CuratedStop`) + `UNIQUE(event_id, stop_order)` + RLS (brand-owner write, anon read of published only) + new `events` columns `location_mode`, `pricing_mode`, `whole_price_cents`.
2. **`biz_create_experience` RPC** (SECURITY DEFINER) that atomically writes the `events` row + 2–5 `experience_stops` + **ONE** `ticket_types` row at the resolved total + master `event_dates` row(s) (mirroring `business_publish_event_draft`'s date logic verbatim — single/recurring/multi-date).
3. **`mapbox-geocode` edge fn** (action-discriminated autocomplete + retrieve) returning the normalized `PlaceDetails`-compatible shape, behind `verify_jwt`.
4. **Client:** a shared **`MapboxAddressInput`** picker (drop-in for the existing `AddressAutocompleteInput` contract) + **`ExperienceStopsStep.tsx`** + **`ExperiencePricingStep.tsx`** + a **`useExperienceDraftAdapter`** feeding the lifted `CreatorStep2When`, all wired into `ExperienceCreatorWizard.tsx`.
5. **AI-parser reconciliation:** the `ExperienceConfirmationCard` "Accept" → **"Set up & publish"** (opens the wizard prefilled, draft-only; no one-tap publish of a dateless/stopless experience).
6. **Tests:** one happy-path (manual create → 1 ticket + N stops + master date materialized) + one **distinct** adversarial regression (one-ticket invariant: per-stop mode with N priced stops materializes exactly ONE ticket at the sum, never N tickets), at real paths.

**The consumer deck-card render is OUT of Sub-A** — Sub-A produces **deck-ready data** (stops shaped 1:1 onto `CuratedStop`; `experience_stops` + the brand fields the RPC returns). The actual consumer card (byline + "Experience" badge + "Book" CTA + `CuratedExperienceCard` brand fields) is a separate sub-track / the consumer deck ORCH (design Q-OPEN-1).

---

## 1. CONTRACT OVERVIEW (the seven deliverable layers)

| Layer | Deliverable | New / Modified | File(s) |
|---|---|---|---|
| **L1 Schema** | `experience_stops` table + RLS + `events` columns | NEW migration | `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql` |
| **L2 RPC** | `biz_create_experience(...)` SECURITY DEFINER | NEW (same migration) | same migration |
| **L3 Edge fn** | `mapbox-geocode` (autocomplete + retrieve) | NEW | `supabase/functions/mapbox-geocode/index.ts` + `supabase/config.toml` block |
| **L4 Client picker** | `MapboxAddressInput` | NEW | `mingla-business/src/components/location/MapboxAddressInput.tsx` + `mingla-business/src/services/mapboxGeocodeService.ts` |
| **L5 Client steps** | `ExperienceStopsStep` + `ExperiencePricingStep` + `useExperienceDraftAdapter` + wizard wiring | NEW + MODIFIED | `mingla-business/src/components/experience/{ExperienceStopsStep,ExperiencePricingStep}.tsx`, `mingla-business/src/hooks/useExperienceDraftAdapter.ts`, `ExperienceCreatorWizard.tsx` |
| **L6 AI parser** | Accept → "Set up & publish" (draft-only, wizard-prefill) | MODIFIED | `ExperienceConfirmationCard.tsx`, `ExperienceReviewCards.tsx`, `usePendingExperiences.ts`, `agentTools.ts:474-491` |
| **L7 Tests + gates** | 1 happy + 1 adversarial + strict-grep/config allowlist | NEW + MODIFIED | Deno test + jest test + `config.toml` + strict-grep allowlist |

Build order within Sub-A: **L1 → L2 → L3 → L4 → L5 → L6 → L7** (L3/L4 can proceed in parallel with L2 once L1's column shape is fixed).

---

## LAYER 1 — `experience_stops` TABLE + RLS + `events` COLUMNS

**File:** `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql`
**Migration prefix rationale:** highest in-flight prefix across all active worktrees is `20260823000000` (ORCH-1054). Anchor's latest is `20260810000000`. `20260824000000` is the next free, conflict-safe prefix. **Before applying, the implementor MUST re-check active worktrees** (`for d in ~/Desktop/mingla-orchs/*/; do ls "$d/supabase/migrations" | tail -1; done`) and bump if `20260824000000` was claimed since this spec was written.

### 1.1 — `events` new columns

Add three nullable columns to `public.events` (defaults keep existing event/trip rows untouched):

```sql
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS location_mode   text,            -- 'single' | 'per_stop' | NULL (non-experience rows)
  ADD COLUMN IF NOT EXISTS pricing_mode    text,            -- 'whole'  | 'per_stop' | NULL
  ADD COLUMN IF NOT EXISTS whole_price_cents integer;        -- resolved whole price in whole mode; NULL otherwise

ALTER TABLE public.events
  ADD CONSTRAINT events_location_mode_chk
    CHECK (location_mode IS NULL OR location_mode IN ('single','per_stop')) NOT VALID,
  ADD CONSTRAINT events_pricing_mode_chk
    CHECK (pricing_mode IS NULL OR pricing_mode IN ('whole','per_stop')) NOT VALID;
ALTER TABLE public.events VALIDATE CONSTRAINT events_location_mode_chk;
ALTER TABLE public.events VALIDATE CONSTRAINT events_pricing_mode_chk;
```

> **Contract:** these are experience-only fields. `event`/`trip` rows leave them NULL — no behavior change. `whole_price_cents` is **display/audit redundancy only**; the sellable price always lives in the single `ticket_types` row (§I-1). Per-stop prices live on `experience_stops.price_cents`.

### 1.2 — `experience_stops` table (mirrors `CuratedStop`)

```sql
CREATE TABLE public.experience_stops (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  stop_order      integer NOT NULL,                  -- 0-based; → CuratedStop.stopNumber/stopLabel derive from this
  place_id        text,                              -- Mapbox feature id (validated pick); NULL allowed ONLY transiently in draft
  place_name      text NOT NULL,                     -- → CuratedStop.placeName  (the stop name field)
  address         text NOT NULL,                     -- → CuratedStop.address  (Mapbox formattedAddress)
  city            text,
  region          text,
  country_code    text,
  lat             double precision,                  -- → CuratedStop.lat  (NOT NULL once validated; see RLS/RPC gate)
  lng             double precision,                  -- → CuratedStop.lng
  image_urls      text[] NOT NULL DEFAULT '{}',      -- ≤5; image_urls[0] = primary (→ CuratedStop.imageUrl)
  start_time      time,                              -- OPTIONAL per-stop intra-day time (HH:mm local)
  price_cents     integer NOT NULL DEFAULT 0,        -- per-stop price; 0 in whole-experience mode
  ai_description  text NOT NULL DEFAULT '',          -- optional blurb (design Q-OPEN-2 → '' in v1)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experience_stops_unique_order UNIQUE (event_id, stop_order),
  CONSTRAINT experience_stops_order_nonneg CHECK (stop_order >= 0),
  CONSTRAINT experience_stops_price_nonneg CHECK (price_cents >= 0),
  CONSTRAINT experience_stops_images_max5 CHECK (array_length(image_urls, 1) IS NULL OR array_length(image_urls, 1) <= 5)
);

CREATE INDEX experience_stops_event_id_idx ON public.experience_stops (event_id);
```

**Field → `CuratedStop` mapping (deck-ready authoring; design §5.3):**

| `experience_stops` column | `CuratedStop` field | Notes |
|---|---|---|
| `stop_order` | `stopNumber` (=`stop_order+1`), `stopLabel` (derived) | label = Start Here / Then / End With (design §2.6 `labelForIndex`) |
| `place_id` | `placeId` | Mapbox feature id |
| `place_name` | `placeName` | stop name field |
| `address` | `address` | Mapbox formatted address |
| `lat`/`lng` | `lat`/`lng` | for the deck pipeline's per-viewer travel-time compute |
| `image_urls` | `imageUrls` (+ `imageUrl`=`image_urls[0]`) | ≤5 |
| `price_cents` | `priceMin`/`priceMax` | both = stop price; whole-mode → 0 per stop |
| `start_time` | (intra-day schedule hint) | within-booked-date, never a separate SKU |
| `ai_description` | `aiDescription` | `''` v1 |
| — | `rating`/`reviewCount` | `0` (brand experiences not review-ranked; card hides 0 badge) |
| — | `placeType`/`priceLevelLabel`/`priceTier` | `''`/default (runtime/N-A) |
| — | `openingHours`/`isOpenNow`/`utcOffsetMinutes`/`website` | `null` (honest absence) |
| — | `distance*`/`travelTime*`/`travelMode*` | runtime per-viewer (deck pipeline) |

> **`lat`/`lng` nullability:** columns are nullable so a draft stop can persist before the brand confirms a Mapbox pick. **But** the RPC (§L2) and the publish path REJECT any stop with NULL `place_id`/`lat`/`lng` (raises `stop_address_unvalidated`). The "always-validated" invariant is enforced at write-of-a-publishable-experience, not at the column level (mirrors the event venue's `placeId != null` validity gate).

### 1.3 — RLS

```sql
ALTER TABLE public.experience_stops ENABLE ROW LEVEL SECURITY;

-- READ: brand owner/team (any status) OR anon/authenticated for PUBLISHED experiences only.
CREATE POLICY experience_stops_select_owner ON public.experience_stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  );

CREATE POLICY experience_stops_select_public ON public.experience_stops
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND e.event_type = 'experience'
        AND e.published_at IS NOT NULL
        AND e.visibility = 'public'
    )
  );

-- WRITE (INSERT/UPDATE/DELETE): brand owner/team only. Mutations normally go through the
-- SECURITY DEFINER RPC, but direct owner edit (Sub-B edit screen) needs a direct-predicate
-- policy per [[rls-returning-owner-gap]] — do NOT rely on a SECURITY DEFINER helper inside
-- a RETURNING/soft-delete WITH CHECK context.
CREATE POLICY experience_stops_write_owner ON public.experience_stops
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = experience_stops.event_id
        AND e.deleted_at IS NULL
        AND public.biz_brand_effective_rank(e.brand_id, auth.uid()) >= public.biz_role_rank('event_manager'::text)
    )
  );
```

> **[[rls-returning-owner-gap]] guard:** the write policy uses a **direct EXISTS predicate**, not a bare SECURITY DEFINER helper call as the sole gate, so owner-SELECT/UPDATE-RETURNING works. The `biz_brand_effective_rank`/`biz_role_rank` helpers are the same gate `business_publish_event_draft` uses (§L2 precedent).

### 1.4 — Layer-1 self-verify probe (fails-on-revert; design Regression Prevention)

The migration ends with an assertion block proving the structure exists (so a partial revert is caught):

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='experience_stops') THEN
    RAISE EXCEPTION 'experience_stops table missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='events' AND column_name='pricing_mode') THEN
    RAISE EXCEPTION 'events.pricing_mode column missing';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
```

### 1.5 — L1 Success criteria

- `experience_stops` exists with `UNIQUE(event_id, stop_order)`, the 5-image cap CHECK, and `ON DELETE CASCADE`.
- `events.location_mode/pricing_mode/whole_price_cents` exist; existing rows unaffected (all NULL).
- RLS: brand team reads/writes own stops at any status; anon reads stops only for published public experiences; non-owner cannot write (verified by the L7 adversarial test if extended, else a manual probe).
- `NOTIFY pgrst` issued; PostgREST schema reloaded.

---

## LAYER 2 — `biz_create_experience` RPC (atomic: events + stops + ONE ticket + master dates)

**File:** same migration (`20260824000000_…`).
**Mirror:** `business_publish_event_draft` (`20260604000001_orch_0824_publish_rpc.sql`) — specifically its **date-materialization block (lines 273-333)** and its **ticket-insert block (lines 391-445)**. Sub-A reuses that proven date logic **verbatim in shape**, collapsing the multi-tier insert to **exactly ONE** ticket.

### 2.1 — Signature

```sql
CREATE OR REPLACE FUNCTION public.biz_create_experience(
  p_brand_id   uuid,
  p_payload    jsonb,        -- the full experience draft (shape in §2.2)
  p_publish    boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $$ … $$;
GRANT EXECUTE ON FUNCTION public.biz_create_experience(uuid, jsonb, boolean) TO authenticated;
```

### 2.2 — `p_payload` shape (client builds this; §L5 adapter produces it)

```jsonc
{
  "title": "Friday Night Jazz Crawl",
  "description": "10–500 chars",
  "currency": "USD",
  "location_mode": "single" | "per_stop",
  "pricing_mode":  "whole"  | "per_stop",
  "whole_price_cents": 4500,            // required when pricing_mode='whole' & !free; null/0 if free
  "is_free": false,
  "capacity": 20,                       // null → unlimited ticket
  "pass_tax": null, "pass_mingla_fee": null, "pass_service_fee": null,  // ORCH-1006 switches (NULL=inherit)
  "stops": [                            // 2–5; in location_mode='single' all share stops[0]'s place
    { "stop_order": 0, "place_id": "mapbox.x", "place_name": "Rooftop drinks",
      "address": "12 Soho Sq, London", "city": "London", "region": "England",
      "country_code": "GB", "lat": 51.5, "lng": -0.13,
      "image_urls": ["https://…/a.jpg"], "start_time": "19:00", "price_cents": 2000, "ai_description": "" }
    // … up to 5
  ],
  "whenMode": "single" | "recurring" | "multi_date",
  "when": { "date": "2026-06-14", "doorsOpen": "19:00", "endsAt": "22:00" },   // single/recurring
  "multiDates": [ { "date": "2026-06-14", "startTime": "19:00", "endTime": "22:00" } ],  // multi_date
  "recurrence_rules": { … },            // optional; persisted to events.recurrence_rules (mirror event)
  "timezone": "Europe/London"
}
```

### 2.3 — RPC body contract (step by step)

1. **Auth + permission.** `v_user := auth.uid()`; reject `not_authenticated` if NULL. Resolve brand; reject `brand_not_found` if deleted/missing. Gate `biz_brand_effective_rank(p_brand_id, v_user) >= biz_role_rank('event_manager')` → else `insufficient_event_permission`. (Same gate as `business_publish_event_draft:105`.)
2. **Validate header.** `title` required (`experience_title_required`); `description` 10–500 chars; `currency` validated against the brand default / supported set (mirror `business_publish_event_draft:122-137` currency logic — **do NOT re-introduce a GBP-only default**; default to `v_brand.default_currency` per [[project_orch_1034_currency_de_gbp_scope]]).
3. **Validate modes.** `location_mode IN ('single','per_stop')`; `pricing_mode IN ('whole','per_stop')` → else `invalid_mode`.
4. **Validate stops (2–5).** `jsonb_array_length(stops)` BETWEEN 2 AND 5 → else `experience_stop_count_invalid`. For each stop: `place_name` non-empty (`stop_name_required`); `place_id`/`lat`/`lng` all non-null (`stop_address_unvalidated`); `array_length(image_urls,1) <= 5` (`stop_too_many_images`); `price_cents >= 0`.
   - **`location_mode='single'`:** ignore per-stop `place_id`/address/lat/lng beyond `stops[0]` and **write `stops[0]`'s place onto every stop row** (single shared location materialized N times, so the deck pipeline + public page read uniformly). Only `stops[0]` needs a validated pick in single mode; stops 2–5 inherit it. → reject only if `stops[0]` is unvalidated.
   - **`location_mode='per_stop':`** every stop needs its own validated pick.
5. **Resolve the ONE price (§I-1 — the spine).**
   ```
   v_resolved_total_cents :=
     CASE
       WHEN (p_payload->>'is_free')::boolean THEN 0
       WHEN pricing_mode='whole' THEN (p_payload->>'whole_price_cents')::int
       ELSE (SELECT COALESCE(sum((s->>'price_cents')::int),0) FROM jsonb_array_elements(stops) s)
     END;
   ```
   Reject `experience_price_invalid` if non-free and `v_resolved_total_cents <= 0` in whole mode (per-stop all-zero is a valid free total → ticket `is_free=true`).
6. **Insert the `events` row.** `event_type='experience'`, `slug` (slugify + collision-suffix loop mirroring `business_publish_event_draft:234-251`), `status = p_publish ? 'scheduled' : 'draft'`, `visibility = p_publish ? 'public' : 'draft'`, `published_at = p_publish ? now() : null`, `currency`, ORCH-1006 switches from payload, **new columns** `location_mode`, `pricing_mode`, `whole_price_cents` (NULL in per-stop mode), and `theme.experience_meta` kept for display (`venue_text` = stops[0].address, `next_occurrence_at` = computed earliest future `start_at`, `tier_name='Standard'`). Capture `v_event_id`.
7. **Insert `experience_stops` (2–5).** One row per stop, `stop_order` from payload, place fields resolved per §4 location-mode rule, `price_cents` per-stop (0 in whole mode), `image_urls`, `start_time`, `ai_description`. Honors `UNIQUE(event_id, stop_order)`.
8. **Insert the ONE `ticket_types` row (NEVER N).** `event_id=v_event_id`, `name='Standard'`, `price_cents = v_resolved_total_cents`, `currency`, `quantity_total = capacity` (NULL → `is_unlimited=true`), `is_free = (v_resolved_total_cents=0)`, `display_order=0`, plus the same column defaults `business_publish_event_draft:405-444` writes (available_online/in_person both true, allow_transfers true, etc.). **This is the only sellable SKU.** Per-stop prices are display-only on `experience_stops`.
9. **Materialize `event_dates` (ONLY when `p_publish=true`).** Reuse the `business_publish_event_draft:273-333` block **exactly**:
   - `single`/`recurring`: one `event_dates` row from `when.date` + `doorsOpen`/`endsAt`, `is_master=true`, cross-midnight `+1 day` correction.
   - `multi_date`: N rows; `is_master` on the earliest `start_at` (the `v_min_start` pattern).
   - Persist `is_recurring`/`is_multi_date`/`recurrence_rules` onto the events row (mirror `business_publish_event_draft:355-357`).
   - **Drafts persist NO `event_dates`** (design Q1 RESOLVED: materialize dates + ticket at publish only; the draft stores the wizard payload so the edit screen can rehydrate). **Exception:** the ONE `ticket_types` row + `experience_stops` ARE written for drafts too (so Sub-B KPIs + the edit-screen preview read real rows) — but a draft has `status='draft'`/no `published_at`, so the public RPC's `published_at IS NOT NULL` filter keeps it out of checkout/Upcoming. *(Rationale: tickets without a future `event_date` are harmless — the checkout edge fn's `event_no_active_dates` 422 gate keeps a dateless draft unsellable even if its `ticket_types` row exists. This satisfies "draft needs tickets for KPIs but must not be sellable.")*
10. **Return** `{ event, ticket, stops[], eventDates[], brand:{id,slug,name} }` (mirror `business_publish_event_draft:463-473` return shape).

> **Trigger note:** the existing `biz_enforce_event_has_master_date` fires only on UPDATE status-transition into scheduled/live (investigation §Triggers). `biz_create_experience` INSERTs directly at `status='scheduled'` for publish — it therefore **must itself guarantee** a master `event_date` exists when publishing (step 9 does). For drafts it INSERTs at `status='draft'` (no master date required). The RPC owns this invariant explicitly; do not rely on the trigger.

### 2.4 — Both creation paths route through the RPC

- **Manual wizard:** `ExperienceCreatorWizard.tsx:160-188` raw `.from("events").insert(...)` is **replaced** by `supabase.rpc("biz_create_experience", { p_brand_id, p_payload, p_publish })`. The wizard's local state (stops, modes, when, pricing, switches) is serialized by `useExperienceDraftAdapter` (§L5) into `p_payload`.
- **AI tool:** `agentTools.ts:474-491` raw insert is **replaced** by a `biz_create_experience` call with `p_publish=false` (AI always creates a **draft**, never a sellable row — §L6). The AI proposal has no concrete date/stops/tickets, so it CANNOT publish (would raise `experience_stop_count_invalid`). The AI tool builds a minimal draft payload (title, narrative, a single seed stop from the brand venue is NOT possible without 2 stops → the AI draft is a **shell** the brand finishes in the wizard; see §L6 for the exact reconciliation).

### 2.5 — L2 Error codes (raised by the RPC; client maps to copy)

`not_authenticated` · `brand_not_found` · `insufficient_event_permission` · `experience_title_required` · `experience_description_invalid` · `event_currency_unsupported` · `invalid_mode` · `experience_stop_count_invalid` · `stop_name_required` · `stop_address_unvalidated` · `stop_too_many_images` · `experience_price_invalid` · `event_date_required` (publish only) · `slug_taken` (23505 → friendly).

### 2.6 — L2 Success criteria

- A **publish** call writes: 1 `events` row (status scheduled/public), N `experience_stops` (2–5), **exactly 1** `ticket_types` row at the resolved total, ≥1 `event_dates` row with `is_master=true`. (Asserted by L7 happy-path.)
- A **per-stop** publish with N priced stops writes **exactly 1** `ticket_types` row whose `price_cents = sum(stop prices)` — **never N tickets** (L7 adversarial).
- A **draft** call writes events(draft) + stops + 1 ticket, **no `event_dates`** → not sellable (public RPC filters it; checkout 422s on `event_no_active_dates`).
- `location_mode='single'` materializes `stops[0]`'s place onto all stop rows.
- Feeding the returned `event.id` into `biz_ticket_checkout_create_session` reaches a session (NOT `ticket_type_not_found`) once dates exist — the COMMS-0014/0016 inheritance (investigation §5).

---

## LAYER 3 — `mapbox-geocode` EDGE FUNCTION

**File:** `supabase/functions/mapbox-geocode/index.ts` + `supabase/config.toml` block `[functions.mapbox-geocode] verify_jwt = true`.
**Mirror:** `supabase/functions/places-autocomplete/index.ts` (action-discriminated single-fn design, CORS, `verify_jwt=true`, `{error:"<code>"}` contract). The **output shape is byte-identical to `PlaceDetails`** (`googlePlacesService.ts:52-61`) so `MapboxAddressInput` is a drop-in for the existing `AddressAutocompleteInput` `onPick(details: PlaceDetails)` contract.

### 3.1 — Why a new fn (not reuse `places-autocomplete`)

The operator locked **MAPBOX** as the experience address provider. The new fn isolates Mapbox keys/quota from the Google `places-autocomplete` path (which events still use). The two coexist; experiences use Mapbox, events keep Google. (Drop-in shape means the client picker is provider-agnostic at the `PlaceDetails` boundary.)

### 3.2 — Secret

Reads `MAPBOX_ACCESS_TOKEN` from Supabase secrets (NEW secret — **flag to operator as a NEW dependency** per [[autonomy-posture-verifier-not-manager]]; provision before deploy). Missing → `500 mapbox_access_token_missing`.

### 3.3 — API surface (action-discriminated; COMMS-0003 docs cited inline)

Mapbox **Search Box API** (current recommended; the legacy Geocoding v5 `/geocoding/v5/mapbox.places` is in maintenance):

- **`action: "suggest"`** → `GET https://api.mapbox.com/search/searchbox/v1/suggest?q={query}&session_token={uuid}&access_token={token}&limit=5`
  Docs: https://docs.mapbox.com/api/search/search-box/#get-suggestions — returns `suggestions[]` each with `mapbox_id`, `name`, `full_address`/`place_formatted`. Maps to `PlaceAutocompleteSuggestion { placeId: mapbox_id, displayName: name, fullAddress: full_address ?? place_formatted }`.
- **`action: "retrieve"`** → `GET https://api.mapbox.com/search/searchbox/v1/retrieve/{mapbox_id}?session_token={uuid}&access_token={token}`
  Docs: https://docs.mapbox.com/api/search/search-box/#retrieve-a-suggested-feature — returns a GeoJSON `features[0]` with `geometry.coordinates [lng,lat]` and `properties` (`full_address`, `context.place.name` → city, `context.region.name` → region, `context.country.country_code`/`properties.context.country.country_code` → countryCode).

> **Session-token contract (COMMS-0003):** Mapbox Search Box bills `suggest`+`retrieve` as ONE session per `session_token` (a client-generated UUID reused across a suggest→retrieve pair). The edge fn accepts an optional `session_token` from the client and passes it through; the client (`mapboxGeocodeService.ts`) generates one UUID per autocomplete session. Docs: https://docs.mapbox.com/api/search/search-box/#session-billing.

### 3.4 — Normalized response (the locked shape)

```jsonc
// action:"suggest"  →  { "suggestions": [ { "placeId": "...", "displayName": "...", "fullAddress": "..." } ] }
// action:"retrieve" →  { "details": {
//     "placeId": "<mapbox_id>",
//     "formattedAddress": "<properties.full_address || place_formatted>",
//     "city": "<context.place.name>",            // REQUIRED — if absent, 500 no_locality (mirror Google contract)
//     "region": "<context.region.name || null>",
//     "countryCode": "<context.country.country_code (upper) || null>",
//     "location": { "lat": <coords[1]>, "lng": <coords[0]> }
// } }
```

**Defensive handling (the MEDIUM-confidence point):** Mapbox sometimes omits `context.place` for non-address features (POIs, regions). The fn:
- requires `geometry.coordinates` → else `500 no_location`;
- requires a derivable `city` (`context.place.name`, fallback `context.locality.name`, fallback `context.district.name`) → else `500 no_locality` (matches the Google `PlaceDetails` "city required; throws if not derivable" contract at `googlePlacesService.ts:55-56`);
- `region`/`countryCode` are nullable (the `PlaceDetails` contract already allows `region: string | null`, `countryCode: string | null`).

### 3.5 — Error codes + status

`400 invalid_request | query_too_short | mapbox_id_required` · `500 mapbox_access_token_missing | mapbox_<status> | no_locality | no_location`. CORS preflight `OPTIONS` handled (mirror `places-autocomplete`).

### 3.6 — config.toml + deploy allowlist (COMMS-0002)

Add to `supabase/config.toml` **in the same commit**:
```toml
[functions.mapbox-geocode]
verify_jwt = true
```
The `deploy-functions.yml` script auto-deploys every non-`_`-prefixed dir, so no separate allowlist file edit is needed beyond `config.toml` — but the **migration + edge fn must land in one commit** (COMMS-0002).

### 3.7 — L3 Success criteria

- `suggest` returns ≤5 normalized suggestions; `retrieve` returns a `PlaceDetails`-shaped `details` object (city required, region/countryCode nullable, location{lat,lng} from `[lng,lat]` swap).
- `verify_jwt=true`; anon calls rejected.
- Missing secret → `mapbox_access_token_missing` (loud, not silent).
- Output is a structural drop-in for `googlePlacesService.PlaceDetails`.

---

## LAYER 4 — CLIENT MAPBOX PICKER (`MapboxAddressInput`)

**Files:** `mingla-business/src/components/location/MapboxAddressInput.tsx` + `mingla-business/src/services/mapboxGeocodeService.ts`.
**Mirror:** `mingla-business/src/components/event/AddressAutocompleteInput.tsx` (verbatim UX: 250ms debounce, ≥3 chars, ≤5 suggestions dropdown, inline spinner on pick, loud pick-error "Couldn't fetch address details. Tap to try again.", silent autocomplete failures, combobox a11y). The **prop contract is identical** so it's a drop-in.

### 4.1 — `mapboxGeocodeService.ts` (mirrors `googlePlacesService.ts`)

```ts
export interface PlaceAutocompleteSuggestion { placeId: string; displayName: string; fullAddress: string; }
export interface PlaceDetails { placeId: string; formattedAddress: string; city: string;
  region: string | null; countryCode: string | null; location: { lat: number; lng: number }; }

// generates one session_token (UUID) per typing session; reuses across suggest→retrieve
export async function autocompleteMapbox(query: string, sessionToken: string): Promise<PlaceAutocompleteSuggestion[]>; // silent-fail → []
export async function retrieveMapboxPlace(placeId: string, sessionToken: string): Promise<PlaceDetails>;               // THROWS on failure
```
Both call `supabase.functions.invoke("mapbox-geocode", { body: { action, … } })`. Error codes map to the same friendly copy the Google service uses (`no_locality` → "We couldn't pin that address to a city. Pick another suggestion.").

### 4.2 — `MapboxAddressInput.tsx`

Identical to `AddressAutocompleteInput` (same `value/onChangeText/onPick/onClear/error/placeholder` props, same `Status` state machine, same StyleSheet tokens, same Android-glass-safe inputs). The **only** differences: calls `autocompleteMapbox`/`retrieveMapboxPlace` (with a per-session UUID held in a ref) instead of the Google service; `accessibilityLabel` parametrized ("Stop {n} address" passed by the parent rather than the hardcoded "Venue address").

> **Why a new component, not a `provider` prop on the existing one:** the existing `AddressAutocompleteInput` is event-wired (hardcoded "Venue address" label, Google service import). A clean sibling avoids touching the proven event path (lower blast radius). Both satisfy the same `PlaceDetails` boundary, so a future consolidation is trivial — flagged as a v1.1 cleanup, not Sub-A scope.

### 4.3 — L4 Success criteria

- Typing ≥3 chars → debounced Mapbox suggestions; pick → spinner → `onPick(PlaceDetails)`; clear → `onClear`.
- Validity gate identical to events: free-typed (no pick) = INVALID (`placeId===null`), surfaced as the stop address error.
- Session token reused across a suggest→retrieve pair (Mapbox billing).
- No Google import in the experience path.

---

## LAYER 5 — CLIENT STEPS + DRAFT ADAPTER + WIZARD WIRING

**Files:** `mingla-business/src/components/experience/ExperienceStopsStep.tsx` (NEW), `ExperiencePricingStep.tsx` (NEW), `mingla-business/src/hooks/useExperienceDraftAdapter.ts` (NEW), `ExperienceCreatorWizard.tsx` (MODIFIED).

The pixel/copy/state spec for these two steps is **fully owned by `DESIGN_META-ORCH-1059_WIZARD_STOPS_PRICING.md`** (§2 Stops, §4 Pricing, all 9 states each, all copy tables). This layer formalizes only the **data wiring + the LOCATION MODE toggle the design's stops step implies** and the adapter feeding `CreatorStep2When`.

### 5.1 — Wizard local state shape (extends `ExperienceCreatorWizard.tsx:116-131`)

Replace the single-venue/single-price state with:
```ts
type ExperienceStopDraft = {
  clientId: string;            // stable key for list reorder
  placeId: string | null; placeName: string; address: string;
  city: string | null; region: string | null; countryCode: string | null;
  lat: number | null; lng: number | null;
  imageUrls: string[];         // ≤5
  startTime: string | null;    // "HH:mm" local
  priceMajor: string;          // per-stop price (used only in per_stop pricing mode)
};
const [locationMode, setLocationMode] = useState<'single'|'per_stop'>('single');
const [pricingMode,  setPricingMode]  = useState<'whole'|'per_stop'>('whole');
const [stops, setStops] = useState<ExperienceStopDraft[]>([]);   // seeded per design §2.7
const [wholePriceMajor, setWholePriceMajor] = useState('0.00');
const [isFree, setIsFree] = useState(false);
const [capacity, setCapacity] = useState('20');
// When-step state lives in the adapter-backed DraftEvent subset (§5.4)
```

### 5.2 — LOCATION MODE toggle (operator-locked; lives in the Stops step header)

A 2-segment control above the stop list (reuse the design's `CreatorStep3Where` toggle skin / `PricingModeToggle` pattern, §0.4):
- **"One location for all stops"** (`single`): only `stops[0]` shows the `MapboxAddressInput`; stops 2–5 hide their address field and inherit `stops[0]`'s place at submit (RPC §L2 step 4 materializes it onto every row). Stop cards 2–5 still own name/photos/time/price.
- **"Each stop has its own location"** (`per_stop`): every stop card shows its own `MapboxAddressInput`.
- Non-destructive switch (preserve per-stop places when toggling back). `accessibilityRole="tablist"`. This is the **stops-step analog** of the pricing-mode toggle the design §4.2 specifies; it governs how `location_mode` is sent to the RPC.

> The design §2 stops step assumes per-stop addresses; the operator's LOCATION MODE toggle is the formalized superset. In `single` mode the design's per-stop address field is simply hidden for stops 2–5. All other stop-card anatomy (badge, name, photos, optional time, per-stop price) is unchanged from design §2.2.

### 5.3 — Stop image upload (design §6.1 — brand-keyed, event-independent)

Stop photos use the **brand-keyed device-upload path** (the `expo-image-picker` → upload flow used for brand covers), writing to `${brandId}/experience-stops/${randomId}.{ext}`, returning a public URL stored in `stops[i].imageUrls`. **Do NOT** route stop images through the `event`-kind `CoverTarget` (it requires an `eventRowId` that doesn't exist at author time). This is the only path that works before the experience row exists (drafts/pre-publish). (Implementor: reuse `uploadBrandCoverMedia`-style helper with the new key prefix.)

### 5.4 — `useExperienceDraftAdapter` (feeds the lifted `CreatorStep2When`)

Per the lifecycle design's architectural lock (A1, recommendation (a)): the **When step renders the event `CreatorStep2When` body verbatim**, fed by a synthetic `DraftEvent`. The adapter maps experience local state ⇄ the `StepBodyProps` subset `CreatorStep2When` reads (`whenMode/when{date,doorsOpen,endsAt}/timezone/recurrenceRule/multiDates`), with the experience copy overrides (design §A.2: "How often does this experience run?", "Starts"/"Ends" instead of "Doors open", segment labels "One-time / Recurring / Multiple dates"). The adapter exposes `{ draftEvent, updateDraft, errors, showErrors }` and a `toPayloadWhen()` that emits the `whenMode/when/multiDates/recurrence_rules/timezone` fields of the RPC `p_payload`.

> Do NOT extend `draftEventStore`. Do NOT fork `CreatorStep2When`. The adapter is a thin in-component object (lifecycle design A.0.3 / A1).

### 5.5 — Pricing step ⇄ stops single-source + resolved total (design §4.3)

`ExperiencePricingStep` binds per-stop prices to the **same** `stops[i].priceMajor` the stops step edits (one source). The resolved total:
```
resolvedTotalMajor = isFree ? 0 : (pricingMode==='whole' ? wholePriceMajor : sum(stops[i].priceMajor||0))
```
The `<SoldAsOneSummary>` card (design §4.4) and `WhoCoversCostsSection` (`previewBaseCents = round(resolvedTotalMajor*100)`, design §4.5) read this. The wizard footer Publish/Save calls `biz_create_experience` with `whole_price_cents = round(resolvedTotalMajor*100)` when whole, and per-stop `price_cents` on each stop when per_stop.

### 5.6 — Stepper rename

`STEPS` index-1 label "Venue" → **"Stops"** (`ExperienceCreatorWizard.tsx:78-84`), per design §0.1. Stepper labels become `Identity · Stops · When · Pricing · Cover`.

### 5.7 — Submit wiring (replaces `handleSubmit` lines 153-198)

`handleSubmit(publish)` now: (1) validates 2–5 stops + each stop validated per location mode + a valid resolved price; (2) serializes via the adapter into `p_payload` (§2.2); (3) calls `supabase.rpc("biz_create_experience", { p_brand_id: brandId, p_payload, p_publish: publish })`; (4) maps RPC error codes (§2.5) to toasts; (5) `onComplete(data.event.id)`.

### 5.8 — L5 Success criteria

- LOCATION MODE + PRICING MODE toggles drive the RPC `location_mode`/`pricing_mode`.
- When step renders the real `CreatorStep2When` (recurring/multi-date work) via the adapter, with experience copy.
- 2–5 stops enforced client-side (Continue disabled <2 or any unvalidated stop), with server enforcement as the backstop.
- Publish materializes a sellable experience; Save creates a draft (no dates).
- Stop images upload to the brand-keyed bucket path, independent of any event row.

---

## LAYER 6 — AI-PARSER RECONCILIATION ("Accept" → "Set up & publish", draft-only)

**Files:** `mingla-business/src/components/.../ExperienceConfirmationCard.tsx`, `ExperienceReviewCards.tsx`, `mingla-business/src/hooks/usePendingExperiences.ts`, `supabase/functions/_shared/agentTools.ts:474-491`.
**Authoritative:** lifecycle design §A.5.

### 6.1 — The change

Under the new always-2–5-stops + always-a-date + one-ticket rules, **AI-accept can no longer one-tap publish a sellable experience** (a proposal has no stops, no date, no ticket). Resolution (operator's stated flow): **AI proposes, brand finishes.**

- `ExperienceConfirmationCard` "Accept" button → **"Set up & publish"**. Tapping it routes to `/experience/create` with the proposal prefilled: Step 1 title+description from `title`/`narrative`; the brand then builds stops, picks a date, sets pricing, publishes. (The AI proposal's `suggested_price_*` becomes a *seed* for the whole-price field; the brand can override.)
- The AI tool (`agentTools.ts:474-491`) is changed to call `biz_create_experience` with **`p_publish=false`** producing a **draft shell** (title/narrative, `location_mode='single'`, `pricing_mode='whole'`, `whole_price_cents` from the suggested midpoint, **no stops yet** — but a draft is allowed to have <2 stops because the 2–5 gate only fires on **publish**). The brand opens the draft in the wizard to add stops + date, then publishes.

> **Draft-shell vs 2–5 gate:** §L2 step 4's `experience_stop_count_invalid` gate must apply **only when `p_publish=true`**. A draft may persist with 0–5 stops (so the AI shell + a half-built manual draft are valid). Publish requires 2–5. Encode this as: `IF p_publish THEN <enforce 2..5> END IF`.

### 6.2 — Copy + bulk removal (lifecycle design §A.5 table)

- `ExperienceConfirmationCard` Accept btn: "Accept"/"Saving…" → **"Set up & publish"**.
- `ExperienceReviewCards` heading: "Review suggested experiences" → "Suggested experiences"; new helper "AI drafted these from your {menu|activities}. Add a date and price to publish each one."
- **"Accept all" REMOVED** (can't bulk-publish dated/stopped experiences). No bulk action in v1 (operator-confirmed recommendation; if bulk wanted later, it would be "Save all as drafts" — out of Sub-A).
- `usePendingExperiences.ts`: the confirm action becomes "route to wizard prefilled" (or "create draft shell + route to its edit"), not "publish".

### 6.3 — L6 Success criteria

- No AI path produces a published, sellable, dateless experience.
- "Set up & publish" routes to the wizard prefilled; the brand completes stops+date+price+publish.
- "Accept all" gone; review heading + helper updated.

---

## LAYER 7 — TESTS + GATES

### 7.1 — Happy-path test (real path)

**File:** `supabase/functions/__tests__/biz_create_experience.happy.test.ts` (Deno) OR a SQL-level test invoked via the Management API harness the repo uses.
**Asserts:** calling `biz_create_experience(brand, payload, p_publish:=true)` with a valid 2-stop, whole-price, single-date payload writes:
1. exactly **1** `ticket_types` row with `price_cents = whole_price_cents`, `is_free=false`;
2. exactly **2** `experience_stops` rows with `stop_order` 0,1 and the UNIQUE constraint holding;
3. ≥1 `event_dates` row with `is_master=true` and `start_at > now()`;
4. the `events` row at `status='scheduled'`, `pricing_mode='whole'`, `location_mode='single'`.
5. (integration) feeding `event.id` into `biz_ticket_checkout_create_session` reaches a session, NOT `ticket_type_not_found`.

### 7.2 — Adversarial regression test (DISTINCT from happy-path — the one-ticket invariant)

**File:** `…/biz_create_experience.one_ticket_invariant.test.ts`.
**Scenario:** `pricing_mode='per_stop'`, **5 stops each priced** (e.g. £10/£20/£15/£5/£25), `location_mode='per_stop'`, multi-date (2 dates).
**Asserts:**
1. exactly **ONE** `ticket_types` row is created (NOT 5) with `price_cents = 7500` (the sum) — the COMMS-0014/0016 spine;
2. all 5 `experience_stops` carry their individual `price_cents` (display-only), summing to the ticket price;
3. 2 `event_dates` rows, exactly one `is_master=true` (earliest);
4. **negative:** a publish payload with only **1** stop raises `experience_stop_count_invalid`; a publish payload with a stop missing `place_id` raises `stop_address_unvalidated`; a **draft** payload with 1 stop SUCCEEDS (no gate on draft).

> These two tests are deliberately distinct: happy = whole-mode/single-location/single-date min-stops; adversarial = per-stop-mode/per-location/multi-date max-stops + the "never N tickets" + the publish-gate negatives.

### 7.3 — Strict-grep + audit allowlist (COMMS-0002 / regression prevention)

- Extend `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` allowlist for `app/experience/[id]/*` + the new `/experience/create` prefill route (mirror how trips were allowlisted) — *only the create/route bits Sub-A touches; the dashboard routes land in Sub-B.*
- `config.toml` carries the `[functions.mapbox-geocode]` block (§3.6).
- The migration self-verify probe (§1.4) is the fails-on-revert guard.

### 7.4 — L7 Success criteria

- Both Deno/SQL tests pass and are wired into CI.
- The one-ticket invariant is machine-asserted (never N tickets).
- The migration + edge fn + config land in one commit.

---

## INVARIANTS (encode + enforce)

| ID | Invariant | Enforcement |
|---|---|---|
| **I-1 ONE-TICKET** | No matter pricing mode, an experience materializes **exactly ONE** `ticket_types` row at the resolved total. Per-stop prices are display-only on `experience_stops`. Checkout stays on `ticket-checkout-create` (COMMS-0014/0016). | RPC §L2 step 8 (single insert) + L7 adversarial test (asserts 1 ticket, never N). |
| **I-2 2–5 STOPS ON PUBLISH** | A **published** experience has 2–5 `experience_stops`; a draft may have 0–5. | RPC `IF p_publish THEN enforce 2..5` + client gate + L7 negative. |
| **I-3 ALWAYS-VALIDATED LOCATION** | Every stop in a published experience has a non-null `place_id`/`lat`/`lng` (per-stop mode) or inherits `stops[0]`'s validated place (single mode). No fabricated geo. | RPC `stop_address_unvalidated` + client `placeId===null`=invalid. |
| **I-4 PUBLISH-TIME DATES** | `event_dates` materialize ONLY at publish; drafts carry none → unsellable (checkout 422 `event_no_active_dates`). | RPC §L2 step 9 (publish-gated) + design Q1. |
| **I-5 DECK-READY SHAPE** | `experience_stops` columns map 1:1 onto `CuratedStop` so authoring is deck-ready (consumer card is a separate sub-track). | §1.2 mapping table. |
| **I-6 NO PARALLEL MONEY FN** | Sub-A introduces zero new payment/checkout functions; the resolved-total ticket flows through the existing engine. | No edge fn touches Stripe; `mapbox-geocode` is geocoding-only. |
| **I-7 CURRENCY DE-GBP** | The RPC defaults currency to `brand.default_currency`, never a hardcoded GBP fallback. | §L2 step 2 ([[project_orch_1034_currency_de_gbp_scope]]). |

---

## AFFECTED SURFACES

- **Business iOS + Android (creation):** `ExperienceCreatorWizard.tsx` (stops/pricing steps, LOCATION/PRICING toggles, RPC submit), new `MapboxAddressInput`, new step components, AI review cards.
- **Backend:** new migration (`experience_stops` + events columns + `biz_create_experience` RPC), new `mapbox-geocode` edge fn, `config.toml`.
- **Buyer/anon Web (downstream, NOT built here):** once an experience publishes with a ticket + dates, `pg_public_experiences_by_brand` returns a real `price_from_cents` (was NULL). Sub-C/D consume the new `experience_stops` rows.
- **Shared:** `agentTools.ts` (AI tool now creates drafts). `routeForEventRow.ts` is touched in **Sub-B**, not here (Sub-A only adds the `/experience/create` prefill route param).
- **OUT of Sub-A:** consumer deck card render (separate sub-track / consumer ORCH), Sub-B dashboard, Sub-C public page, Sub-D checkout chain, Sub-E guards, Sub-F analytics.

---

## EXACT FILE PATHS (manifest)

**New:**
- `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql` (L1 + L2)
- `supabase/functions/mapbox-geocode/index.ts` (L3)
- `mingla-business/src/services/mapboxGeocodeService.ts` (L4)
- `mingla-business/src/components/location/MapboxAddressInput.tsx` (L4)
- `mingla-business/src/components/experience/ExperienceStopsStep.tsx` (L5)
- `mingla-business/src/components/experience/ExperiencePricingStep.tsx` (L5)
- `mingla-business/src/hooks/useExperienceDraftAdapter.ts` (L5)
- `supabase/functions/__tests__/biz_create_experience.happy.test.ts` (L7)
- `supabase/functions/__tests__/biz_create_experience.one_ticket_invariant.test.ts` (L7)

**Modified:**
- `mingla-business/src/components/experience/ExperienceCreatorWizard.tsx` (state, toggles, stepper rename L84, submit L153-198, step bodies)
- `supabase/functions/_shared/agentTools.ts` (createExperience L474-491 → draft-only RPC)
- `mingla-business/src/components/.../ExperienceConfirmationCard.tsx` (Accept → "Set up & publish")
- `mingla-business/src/components/.../ExperienceReviewCards.tsx` (heading, helper, remove Accept-all)
- `mingla-business/src/hooks/usePendingExperiences.ts` (confirm → wizard prefill/draft)
- `supabase/config.toml` (`[functions.mapbox-geocode]`)
- `.github/scripts/strict-grep/i-proposed-tr2-route-by-event-type.mjs` (allowlist `/experience/create` prefill route)

**Read-mirrors (do not edit):**
- `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` (date + ticket materialization template)
- `mingla-business/src/components/event/AddressAutocompleteInput.tsx` + `src/services/googlePlacesService.ts` (picker contract)
- `supabase/functions/places-autocomplete/index.ts` (edge-fn template)
- `app-mobile/src/types/curatedExperience.ts` (`CuratedStop` shape)
- `mingla-business/src/components/wizard/CreatorStep2When.tsx` (lifted When step)

---

## RESIDUAL OPERATOR DECISIONS (carried from design; confirm at/before IMPLEMENT)

| # | Decision | Sub-A recommendation |
|---|---|---|
| OD-1 | **NEW dependency:** `MAPBOX_ACCESS_TOKEN` Supabase secret + a Mapbox account/billing. Provision before deploy. | Operator provisions; flag per [[autonomy-posture-verifier-not-manager]] (NEW dependency = notify). |
| OD-2 | LOCATION MODE default = `single` (one location for all stops) — simplest mental model. | Confirm `single` default. |
| OD-3 | Draft materializes the ONE ticket + stops but NO dates (KPI preview without sellability). | Confirm (design Q1 resolved this way). |
| OD-4 | AI tool creates a **draft shell** (no stops) the brand finishes; "Accept all" removed. | Confirm (lifecycle §A.5). |
| OD-5 | Stop images → brand-keyed bucket `${brandId}/experience-stops/${rand}` (design §6.1 Q-OPEN-4). | Confirm. |
| OD-6 | Per-stop `ai_description` left `''` in v1 (design Q-OPEN-2). | Confirm. |
| OD-7 | Reorder via chevrons (design Q-OPEN-3); drag = v1.1. | Confirm. |
| OD-8 | Consumer deck-card render (byline + "Experience" badge + "Book" CTA + `CuratedExperienceCard` brand fields) is a **separate sub-track** (design Q-OPEN-1), NOT Sub-A. | Confirm tracking in the consumer deck ORCH. |
| OD-9 | New Mapbox geocode fn coexists with Google `places-autocomplete` (events keep Google). | Confirm (lower blast radius than swapping the event path). |

---

## /goal COMPLETION SELF-CHECK

1. **Layer-by-layer contracts** — L1 schema, L2 RPC, L3 edge fn, L4 picker, L5 client steps, L6 AI parser, L7 tests, each with success criteria. ✓
2. **One-ticket invariant** — I-1 + RPC step 8 + L7 adversarial assert exactly-one-ticket-at-resolved-total; checkout stays on `ticket-checkout-create`. ✓
3. **`experience_stops` mirrors `CuratedStop`** — full field-mapping table (§1.2), `UNIQUE(event_id,stop_order)`, RLS (owner write + anon-published read), new events columns. ✓
4. **`biz_create_experience`** — atomic events + 2–5 stops + ONE ticket + master dates, date logic mirrors `business_publish_event_draft` verbatim; draft vs publish materialization resolved. ✓
5. **`mapbox-geocode`** — action-discriminated, normalized `PlaceDetails` shape, Mapbox Search Box docs cited inline (COMMS-0003), `verify_jwt`, config block in same commit (COMMS-0002). ✓
6. **Client** — Mapbox picker (drop-in), Stops + Pricing steps, `useExperienceDraftAdapter` feeding `CreatorStep2When`, LOCATION + PRICING toggles. ✓
7. **AI parser** — Accept → "Set up & publish", draft-only, no dateless publish, Accept-all removed. ✓
8. **Tests** — 1 happy + 1 distinct adversarial at real paths. ✓
9. **Hard guards** — one-ticket → existing checkout (no parallel fn); backend allowlist (migration + edge fn one commit); next-free migration prefix re-checked. ✓
10. **Affected surfaces + exact paths + residual operator decisions** — present. ✓
