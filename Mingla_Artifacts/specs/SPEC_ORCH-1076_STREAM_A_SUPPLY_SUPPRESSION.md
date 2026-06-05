# SPEC — ORCH-1076 [paid-readiness-supply-and-publish-banners] · Stream A (buyer-facing supply suppression)

- **Mode:** mingla-forensics SPEC (contract — no code)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`
- **Date:** 2026-06-04
- **Investigation (binding input):** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-1076_STREAM_A_SUPPLY_SUPPRESSION.md` (committed `738f0a02e`)
- **Predecessor (binding input):** ORCH-1075 [paid-publish-integrity-guards] — `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql` defines `public.pg_brand_can_charge(uuid)`, the predicate Stream A reuses verbatim.
- **Confidence basis:** every gated object, every reader, and the graceful-CTA host were read in full (file:line cited). The leak is `proven` (live read-only probes returned the unsellable listing). Backend/SQL/edge/TS-resolver audit — no simulator repro required for the SPEC (Prime-Directive backend exemption); the tester DOES run on-device for the two client surfaces.

---

## 0. Layman summary

ORCH-1075 stopped a brand that can't take payments from *publishing* a new paid listing, and the checkout already 409s if someone tries to buy one. Stream A closes the gap in the middle: a paid listing from a not-ready brand must never *appear* to a buyer in the first place. We add one consistent filter — "free OR the brand can charge" — to the seven supply paths that feed buyers, reusing the exact same `pg_brand_can_charge()` predicate so discovery, publish, and checkout all enforce the identical rule. On discovery surfaces (deck, place-card, brand-page feeds) the listing is hidden entirely. On a deep-link/share page that someone already has the URL for, we show an honest "Booking unavailable right now" message instead of a broken Book button or a 404. It self-heals: the moment the brand finishes Stripe onboarding the listing reappears with no backfill, and auto-hides again if a brand later loses charge capability. Free listings and in-person-only paid listings are never touched.

---

## 1. Scope, Non-Goals, Assumptions

### 1.1 In scope (Stream A only)
1. Gate **seven** buyer-facing supply paths on Stripe-readiness, **paid-only** (free + in-person-only-paid pass through unchanged):
   - **DB RPCs (CREATE OR REPLACE, additive WHERE branch):**
     - `pg_eligible_experiences_for_deck` — consumer swipe deck
     - `pg_brand_experiences_for_place` — consumer claimed-venue place-card
     - `pg_public_experiences_by_brand` — public brand-page experiences feed
     - `pg_public_brand_upcoming` — public brand-page "upcoming" feed
     - `pg_public_trips_by_brand` — public brand-page trips feed (latent path)
   - **Edge-function discovery query (additive predicate):**
     - `discover-merged-events` business-event `events` source (latent path)
   - **TS resolvers (graceful-unavailable, NOT hide):**
     - `getPublicExperienceBySlug` / `getPublicExperienceById` → `bookable:false` flag for `/exp/{brandSlug}/{experienceSlug}`
     - `getPublicEventBySlug` / `getPublicEventById` → `bookable:false` flag for `/e/{brandSlug}/{eventSlug}`
2. **Display contract:** HIDE on discovery surfaces; GRACEFUL "Booking unavailable" on deep-link experience/event pages (reuse the ORCH-0946 sold-out visual language already present at `/exp/...`).
3. New invariant **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED** + a strict-grep gate (modeled on `orch-1075-paid-publish-integrity-guards.mjs`).
4. COMMS-0002 backend allowlist + COMMS-0003 inline Stripe doc URLs + safe-migration read-only invariant probe.

### 1.2 Non-Goals (explicit)
- **Do NOT change the checkout 409** (`ticket-checkout-create/index.ts:607`). It is the correct terminal guard and stays as the last line of defense.
- **Do NOT change the publish-time guards** (ORCH-1075). Stream A is the serve-time complement only.
- **Do NOT gate FREE offerings** (`price_cents = 0` / no priced sellable-online ticket) on any surface.
- **Do NOT gate in-person-only paid** (`available_online = false`) — those never sell through the online checkout, so they cannot hit the 409 (mirrors ORCH-1075 exemption).
- **Do NOT gate the shared `business_public_events_view` itself** (see §3.B for the architectural reason — it is read by both row-discovery and keyed price/theme side-fetches; gating it would null out price/theme for legitimately-chosen events). Gate per-caller instead.
- **Do NOT touch any owner/business/admin read path.** Owners MUST keep seeing their own not-ready paid listing so they can fix it (§2.3).
- **Stream B** (owner-side publish/readiness banners) is a separate stream — out of scope here.
- **No new columns, no backfill, no cron, no matview refresh** — every gated object is a live function/view/query (§7 self-healing).

### 1.3 Assumptions (proven in investigation)
- `pg_brand_can_charge(uuid)` is the current latest-definer (grep-all→sort→read-newest confirmed; investigation §1) and reads the SOURCE column `stripe_connect_accounts.charges_enabled` — never the cache.
- `business_public_events_view` is a **plain view, never materialized** (grep confirmed: zero `MATERIALIZED VIEW` definitions; latest definer `20260802000001_orch_1006_pricing_views.sql`). Self-healing requires no refresh.
- The deck RPC `eligible` CTE already computes `ticket_price_cents`; the brand-page RPCs already compute `is_free`; the trips RPC computes `has_free_tier` + `min_price_cents`. The paid-ness signal is in-hand at every surface — no new joins required for the paid test.
- Live exposure today = exactly ONE listing: Lantern & Vine (`53aaea42-0e7d-4b2a-92db-c220d78a352c`) "Raleigh Wine and Dine Crawl" ($70), `pg_brand_can_charge=false`.

---

## 2. Definitions (consistent with ORCH-1075)

### 2.1 PAID offering
A PAID offering = the offering has at least one **sellable-online priced** ticket:
```
EXISTS (
  SELECT 1 FROM public.ticket_types tt
   WHERE tt.event_id = e.id
     AND tt.available_online = true
     AND tt.deleted_at IS NULL
     AND tt.price_cents > 0
)
```
This is identical to the checkout's "is there something to charge for" test and to ORCH-1075's PAID definition. FREE = the negation (no such row).

### 2.2 The readiness predicate (reuse verbatim — do NOT reinvent)
```sql
public.pg_brand_can_charge(<brand_id>)  -- LANGUAGE sql STABLE, returns boolean
```
Already `GRANT EXECUTE … TO authenticated` (ORCH-1075 line 80). The DB RPCs that need it are SECURITY DEFINER (they execute as the function owner, so the grant is satisfied); the edge-function path runs as service_role. **The gate predicate everywhere is exactly:**
```
( <offering is FREE>  OR  public.pg_brand_can_charge(<brand_id>) )
```
i.e. hide/disable a row only when it is paid AND the brand cannot charge.

### 2.3 Buyer-scoped, NOT owner-scoped (CRITICAL)
The suppression applies ONLY to anonymous / buyer / consumer reads. The investigation enumerated **every reader** of each shared object (§3.B). Result: **no owner/business dashboard and no admin surface reads any of the seven gated paths** — owner dashboards read the `events` table directly (and trip/experience manage screens read their own RPCs), never these public-supply RPCs/views/queries. Therefore gating these seven paths regresses **zero** owner reads by construction. Each gated object below carries an explicit per-reader impact table proving this; the implementor MUST NOT add the predicate to any object that an owner/admin path reads, and the tester MUST verify the owner still sees the not-ready listing in their dashboard (SC-OWNER, T-09).

---

## 3. The gating architecture

### 3.A The five RPCs + one edge query (HIDE) — per-object contract

For each, the implementor re-emits the RPC **verbatim from its latest-defining migration** (grep-all → sort → read-newest; cited below) and adds ONLY the readiness branch. `CREATE OR REPLACE` → additive, idempotent, no schema change, no destructive DDL. The new migration re-defines all five RPCs (and patches the one edge query in its own file).

> **🔒 LOCKED — predicate shape.** The added predicate MUST be exactly `( <free-test> OR public.pg_brand_can_charge(<brand_id>) )`, placed in the row-emitting WHERE/CTE so a paid+not-ready row produces **zero rows**. No "soft" column flag, no client-side post-filter for the HIDE surfaces.

#### A-1. `pg_eligible_experiences_for_deck` (consumer swipe deck)
- **Latest definer:** `supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql` (`CREATE OR REPLACE FUNCTION public.pg_eligible_experiences_for_deck(...)`, line 68; `eligible` CTE WHERE block ends ~line 220).
- **Where to add:** inside the `eligible` CTE's final `WHERE` (the block that already filters `event_type='experience' … AND EXISTS(one available_online sellable ticket)`). Add:
  ```sql
  AND (
    NOT EXISTS (  -- offering is FREE → never gated
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = e.id
         AND tt.available_online = true
         AND tt.deleted_at IS NULL
         AND tt.price_cents > 0
    )
    OR public.pg_brand_can_charge(e.brand_id)
  )
  ```
  (`e` is the events alias in the `eligible` CTE's `FROM public.events e`.)
- **Callers (trust the RPC fully — NO fn-side change):** `supabase/functions/discover-cards/index.ts:274`, `supabase/functions/generate-curated-experiences/index.ts:178`. Both consume the RPC output as-is.
- **Per-reader impact:** both callers are consumer-app deck supply → buyer-only. No owner read.

#### A-2. `pg_brand_experiences_for_place` (consumer place-card)
- **Latest definer:** `supabase/migrations/20260906000001_orch_1072_brand_experiences_for_place.sql` (line 16). `LANGUAGE sql STABLE SECURITY DEFINER`.
- **Where to add:** the single `WHERE` (after `e.deleted_at IS NULL`, before `ORDER BY`). The function already computes `is_free` as a SELECT column; for the WHERE predicate use the same in-hand EXISTS test:
  ```sql
  AND (
    NOT EXISTS (
      SELECT 1 FROM public.ticket_types tt
       WHERE tt.event_id = e.id
         AND tt.available_online = true
         AND tt.deleted_at IS NULL
         AND tt.price_cents > 0
    )
    OR public.pg_brand_can_charge(e.brand_id)
  )
  ```
- **Grant:** preserve existing `GRANT … TO anon, authenticated, service_role`.
- **Per-reader impact:** consumer expanded venue card only (anon-safe public read) → buyer-only.

#### A-3. `pg_public_experiences_by_brand` (public brand-page experiences)
- **Latest definer:** `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` (`CREATE OR REPLACE FUNCTION public.pg_public_experiences_by_brand(p_brand_slug text)`). `LANGUAGE sql STABLE SECURITY DEFINER`.
- **Where to add:** the `WHERE b.slug = p_brand_slug … AND e.deleted_at IS NULL` block, before `ORDER BY`. Same free-OR-can-charge predicate on `e.brand_id`.
- **Grant:** preserve `REVOKE ALL … FROM PUBLIC; GRANT … TO anon, authenticated`.
- **Per-reader impact:** read by `app-mobile/src/hooks/useBrandBySlug.ts:328` (consumer brand page) and `mingla-business/src/services/publicEventsService.ts` brand-page fan-out → **buyer/anon brand page only**. No owner dashboard reads it.

#### A-4. `pg_public_brand_upcoming` (public brand-page upcoming feed)
- **Latest definer:** same migration `20260729000000_meta_orch_0972_universal_authoring.sql`.
- **Where to add:** the `offerings` CTE `WHERE b.slug = p_brand_slug … AND e.status IN ('scheduled','live')` block. The CTE spans event/trip/experience; the predicate is the same EXISTS-based free-OR-can-charge on `e.brand_id` (works uniformly for all three offering types since the PAID test reads `ticket_types`).
- **Grant:** preserve `REVOKE ALL … FROM PUBLIC; GRANT … TO anon, authenticated`.
- **Per-reader impact:** `app-mobile/src/hooks/useBrandBySlug.ts:329` (consumer brand page upcoming feed) → buyer-only.

#### A-5. `pg_public_trips_by_brand` (public brand-page trips — latent path)
- **Latest definer:** `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` (supersedes `20260728000000_orch_0963_…`; grep-confirmed the universal-authoring copy is newest).
- **Where to add:** the `trip_rows` CTE `WHERE e.event_type='trip' … AND e.deleted_at IS NULL`. The PAID test for trips reads `ticket_types` joined via `trip_pricing_tiers`; reuse the function's own pricing logic by gating on `has_free_tier OR pg_brand_can_charge`. Concretely, add to the **final** `SELECT … FROM trip_rows tr …` a `WHERE` that keeps a trip iff it is free or the brand can charge:
  ```sql
  WHERE (
    COALESCE(p.has_free_tier, false)        -- has a free tier → not gated
    OR p.min_price_cents IS NULL            -- no priced tier at all → free/unsellable-online → not a paid leak
    OR public.pg_brand_can_charge(tr.brand_id)
  )
  ```
  (`tr.brand_id` is available via `trip_rows`; if `trip_rows` does not already carry `brand_id`, add `e.brand_id` to that CTE's select — additive, no contract change to the RETURNS TABLE shape.)
- **Grant:** preserve `REVOKE ALL … FROM PUBLIC; GRANT … TO anon, authenticated`.
- **Per-reader impact:** `app-mobile/src/hooks/useBrandBySlug.ts:327` + `mingla-business` `fetchPublicBrandTrips` → buyer/anon brand page only.
- **Note:** "free tier" semantics for trips differ from single-ticket offerings (a trip can have BOTH free and paid tiers). Decision (🔒 LOCKED): a trip with ANY free tier is NOT gated (a buyer can still book the free tier) — `has_free_tier=true` ⇒ visible. Only a trip whose ALL priced tiers are paid AND the brand cannot charge is hidden.

#### A-6. `discover-merged-events` business-event source (consumer city events feed — latent path)
- **File:** `supabase/functions/discover-merged-events/index.ts`. The business-event query reads the **`events` table directly** (line ~343, `supabase.from("events").select(... ticket_types!left ...)`), NOT the view. The view is only side-fetched for `display_price_cents` keyed `.in("id", allInEventIds)` (line ~434) — **that side-fetch must NOT be gated** (it enriches already-chosen rows; gating it would null out price).
- **Where to add:** the main `events` query gains a readiness filter on the business-event source. Because PostgREST cannot express `pg_brand_can_charge` inline, the implementor adds a **post-fetch filter in the edge function**: after `rawRows` is fetched and before normalization, drop any row that is PAID (has a `ticket_types` entry with `price_cents > 0` in the embedded `ticket_types!left`) AND whose `brand_id` is not in a readiness allowset. Resolve the allowset via ONE batched read:
  ```ts
  // gate buyer-feed: paid business-events from a not-ready brand are dropped.
  const paidBrandIds = unique(rawRows.filter(isPaidRow).map(r => r.brand_id));
  // pg_brand_can_charge per brand, batched — see §3.A-6 helper RPC below.
  const readyBrandIds = await fetchReadyBrandIds(paidBrandIds);
  const gated = rawRows.filter(r => !isPaidRow(r) || readyBrandIds.has(r.brand_id));
  ```
  where `isPaidRow(r)` = `r.ticket_types?.some(t => !t.deleted_at && t.is_hidden!==true && t.is_disabled!==true && (t.price_cents ?? 0) > 0)`. **The embedded `ticket_types!left` select already returns `price_cents, deleted_at, is_hidden, is_disabled`** — note it does NOT currently select `available_online`; the implementor MUST add `available_online` to that embed so `isPaidRow` matches the §2.1 definition exactly (paid = `available_online=true AND price_cents>0`).
- **Batched readiness helper (🔒 LOCKED — new RPC, NOT a per-row function call):** add to the migration a set-returning helper so the edge fn resolves N brands in one round-trip:
  ```sql
  CREATE OR REPLACE FUNCTION public.pg_brands_can_charge(p_brand_ids uuid[])
  RETURNS TABLE (brand_id uuid)
  LANGUAGE sql STABLE
  AS $$
    SELECT bid FROM unnest(p_brand_ids) AS bid
     WHERE public.pg_brand_can_charge(bid);
  $$;
  GRANT EXECUTE ON FUNCTION public.pg_brands_can_charge(uuid[]) TO authenticated, service_role;
  ```
  (Stripe `charges_enabled` semantics cited inline per COMMS-0003 — see §9.)
- **Per-reader impact:** consumer merged discover feed → buyer-only. The keyed price side-fetch (line 434) is untouched.

### 3.B Why the shared `business_public_events_view` is NOT gated — full reader enumeration

The investigation flagged the view as a candidate single-point gate. **Decision (🔒 LOCKED): do NOT gate the view.** Every reader was enumerated:

| Reader | File:line | Read shape | Gating the view would… |
|--------|-----------|-----------|------------------------|
| Consumer brand-page events | `app-mobile/src/hooks/useBrandBySlug.ts:321` | `.eq("brand_slug", slug)` — row discovery | …correctly hide, BUT this is the experiences/upcoming-adjacent EVENT feed; gating per-caller (A-3/A-4) + the event resolver (3.C) covers it without touching the view. |
| Consumer connections meta | `app-mobile/src/components/ConnectionsPage.tsx:171` | `.in('id', eventIds)` — **keyed enrich** of events the user is already connected to | …**break**: a paid event from a now-not-ready brand that a user already has a chat/connection around would vanish from group meta → blank cards. Not a discovery surface. MUST NOT gate. |
| Consumer event theme | `app-mobile/src/hooks/useEventTheme.ts:51` | `.eq("id", eventId)` — **keyed enrich** (theme colors only) | …**break** theme resolution for an already-open event. MUST NOT gate. |
| Public event resolver | `mingla-business/src/services/publicEventsService.ts:909` (`getPublicEventBySlug`) | `.eq("brand_slug").eq("slug")` — single deep-link | Handled by graceful-CTA (3.C), NOT by hiding — share-link must show an honest message. MUST NOT 404 via view gate. |
| Public event-by-id | `publicEventsService.ts:932` (`getPublicEventById`) | `.eq("id")` — checkout chain | Same — graceful, not hidden. |
| Public brand events feed | `publicEventsService.ts:951` (`fetchPublicBrandEvents`) | `.eq("brand_slug")` — discovery | Hidden via the event-feed gate; see below. |
| Deck display-price side-fetch | `20260908000000_…:` (deck RPC scalar subquery `SELECT v.display_price_cents … WHERE v.id = e.id`) | **keyed enrich** | …**break** the deck's all-in price for legitimately-visible experiences. MUST NOT gate. |
| Merged-feed price side-fetch | `discover-merged-events/index.ts:434` | `.in("id", …)` — keyed enrich | …**break** all-in price. MUST NOT gate. |

**Conclusion:** the view serves BOTH row-discovery and keyed-enrich; a view-level gate would corrupt every keyed-enrich consumer (theme, price, connection meta). Therefore the discovery gate lives in the **per-caller query**, never the view. For the public brand-page EVENT feed (`fetchPublicBrandEvents`, `useBrandBySlug.ts:321`), gating is done **client/service-side** is rejected (a paid event row would still be fetched then dropped, but the buyer brand page already filters `event_type==='event'` post-fetch). To keep the EVENT feed honest AND avoid a view gate, add the readiness filter to the EVENT feed via a **dedicated buyer RPC** OR a post-fetch service filter:

- **Decision (🔒 LOCKED):** for the public brand-page EVENT feed, apply the readiness filter in `pg_public_brand_upcoming` (A-4, which already includes events) for the "upcoming" surface, and add a **service-layer post-fetch filter** in `fetchPublicBrandEvents` (`publicEventsService.ts:951`) + `useBrandBySlug.ts:321` mapping for the flat events list: after fetch, drop any row where `row.display_price_cents != null` (paid) OR has a paid ticket AND the brand is not chargeable. **Because the view does not expose `pg_brand_can_charge`, the service filter needs the readiness bit.** To avoid an N+1, the service layer resolves readiness via one `pg_brands_can_charge(uuid[])` RPC call (the §3.A-6 helper) over the distinct `brand_id`s in the fetched rows, then drops paid+not-ready rows. The owner never reads `fetchPublicBrandEvents` (proven §2.3), so this is buyer-only.

> **Implementor note (🔒 LOCKED):** `fetchPublicBrandEvents` is consumed by the buyer brand page only (`getPublicBrandBySlug` fan-out, `publicEventsService.ts:1059`). The mobile `useBrandBySlug` flat-events read (`:321`) is the consumer twin and gets the identical post-fetch filter. Two surfaces, two success criteria (SC-3-Web, SC-3-iOS/Android).

### 3.C The two deep-link pages (GRACEFUL UNAVAILABLE) — per-object contract

These are reachable by a pre-existing share link even after everything else is hidden. **Do NOT return `null`** (that renders "not found" / 404 and looks broken/punitive). Instead thread a `bookable: false` flag and render the ORCH-0946 sold-out visual language.

#### C-1. Experience deep-link `/exp/{brandSlug}/{experienceSlug}`
- **Resolver:** `mingla-business/src/services/publicExperienceService.ts` `getPublicExperienceBySlug` (line ~248) + `getPublicExperienceById` (line ~296). Both read `events` directly.
- **Contract change:** after resolving the experience + its ticket, compute:
  - `isPaid` = the resolved Standard ticket has `available_online=true AND price_cents > 0`.
  - `bookable` = `!isPaid OR pg_brand_can_charge(brand_id)`. Resolve readiness via one `supabase.rpc("pg_brand_can_charge", { p_brand_id: brand.id })` call (the existing fn; grant covers `authenticated`; for anon the RPC must also be granted to `anon` — **the migration MUST add `GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon;`** since these resolvers run anon, see §3.D).
  - Add `bookable: boolean` to `PublicExperiencePayload` (or the `experience` sub-shape). Default existing callers to `bookable: true` when the field is absent (back-compat).
- **Page render:** `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` already branches `isEnded` → banner, `isSoldOut` → banner, else `<ExperienceCheckoutFlow>` (lines 138–179). Add a THIRD precedence branch **between** `isSoldOut` and the checkout flow:
  ```
  isEnded → "This experience has ended" (existing)
  isSoldOut → "Sold out" (existing)
  !experience.bookable → "Booking unavailable right now" (NEW — see copy §6)
  else → <ExperienceCheckoutFlow>
  ```
  Reuse the exact `bannerWrap` / `GlassCard variant="elevated"` / `bannerTitle` / `bannerBody` styles already in the file (lines 155–172, 230–244). The NEW banner uses the SAME sold-out visual language (the `semantic.error`-tinted title + secondary body) so a share-link visitor gets an honest, on-brand message.

#### C-2. Event deep-link `/e/{brandSlug}/{eventSlug}`
- **Resolver:** `publicEventsService.ts` `getPublicEventBySlug` (line ~900, via `business_public_events_view`) + `getPublicEventById` (line ~929). `detailFromRow` (line ~889) builds `PublicEventDetail`.
- **Contract change:** `PublicEventDetail` (interface at line ~217) gains `bookable: boolean`. In `detailFromRow`, compute `isPaid` from the fetched tickets (`available_online=true AND price_cents>0`) and set `bookable = !isPaid OR <brand chargeable>`. Resolve readiness with one `pg_brand_can_charge` RPC keyed on `row.brand_id`. (The view row carries `brand_id`.)
- **Page render:** the Book CTA lives in `mingla-business/src/components/event/PublicEventPage.tsx` (route `app/e/[brandSlug]/[eventSlug].tsx` just delegates). `PublicEventPage` already branches `status === "ended"` (line ~119). Add a `!event.bookable` branch that replaces the Get-tickets / checkout CTA (the `router.push(checkoutPublicPath(...))` block, lines ~256–259) with the same "Booking unavailable right now" banner (reuse the page's existing ended/sold-out banner primitive). The page MUST still render the event details read-only; only the CTA is swapped.

> **🎨 OPEN — banner micro-craft.** Exact vertical placement of the new banner within the scroll, entrance fade timing, and whether the disabled CTA also shows a muted secondary line ("The organizer is finishing payment setup") are handed to the implementor's craft within the locked copy + the sold-out visual language. No new tokens.

### 3.D Grants (🔒 LOCKED)
The migration MUST extend the readiness predicate's reachability so the anon deep-link resolvers can call it:
```sql
GRANT EXECUTE ON FUNCTION public.pg_brand_can_charge(uuid) TO anon;          -- C-1/C-2 anon resolvers
GRANT EXECUTE ON FUNCTION public.pg_brands_can_charge(uuid[]) TO anon, authenticated, service_role;  -- batched paths
```
`pg_brand_can_charge` reads only `stripe_connect_accounts` via a single-row EXISTS and returns a boolean — it exposes **no row data** to the caller, so anon-grant leaks nothing (mirrors the anon-safe posture of the SECURITY-DEFINER supply RPCs).

---

## 4. Cross-Surface Impact (Phase 2.5 — MANDATORY)

| # | Surface | Covered? | User-visible behaviour | Files | Parity |
|---|---------|----------|------------------------|-------|--------|
| 1 | **Consumer iOS** (`app-mobile/` iOS) | YES | Deck never shows a paid not-ready experience; place-card hides it; brand page hides paid not-ready experiences/trips/upcoming; flat brand-events feed drops paid not-ready events. | DB RPCs A-1…A-5 (server) + `useBrandBySlug.ts` post-fetch filter | Automatic for the server RPCs (single predicate); the `useBrandBySlug` flat-events filter is manual → **SC-3-iOS**. |
| 2 | **Consumer Android** | YES | Identical to iOS (shared RN code + shared edge/RPC). | same | Automatic. **SC-3-Android** mirrors SC-3-iOS. |
| 3 | **Buyer/anon Web** (`mingla-business/` `/b/{slug}`, `/e/…`, `/exp/…`, checkout) | YES | Brand page hides paid not-ready experiences/trips/events; deep-link experience + event pages show "Booking unavailable right now" instead of a Book button / 404. | `publicEventsService.ts`, `publicExperienceService.ts`, `exp/[…].tsx`, `PublicEventPage.tsx` | Manual per surface → **SC-3-Web, SC-4-Web, SC-5-Web**. |
| 4 | **Business iOS** | NOT covered | Owner still sees their own not-ready paid listing in their dashboard (they must, to fix it). | — | Owner reads `events` directly; no gated path. Verified non-regression: **SC-OWNER**. |
| 5 | **Business Android** | NOT covered | Same as Business iOS. | — | Same. |
| 6 | **Admin Web** | NOT covered | Admin moderation reads `events`/admin RPCs, not the public-supply paths. | — | No gated path touched. |
| 7 | **Business Web preview** | NOT covered | No buyer-supply surface in the owner preview. | — | — |

**Manual-parity success criteria are split per surface** (SC-3-iOS / SC-3-Android / SC-3-Web etc.) so the implementor cannot ship one and skip another.

---

## 5. Success Criteria

🔒 All LOCKED. Observable, testable, unambiguous.

- **SC-1 (deck hide):** Calling `pg_eligible_experiences_for_deck` with parameters that geographically + intent-wise match Lantern & Vine's "Raleigh Wine and Dine Crawl" returns **zero** rows for that experience while `pg_brand_can_charge('53aaea42-…')=false`. A FREE experience from the same brand (if any) still returns. (Server, single predicate → covers iOS+Android.)
- **SC-2 (place-card hide):** `pg_brand_experiences_for_place('8b720912-…')` does NOT return the $70 experience while the brand can't charge; returns it again once it can.
- **SC-3 (brand page hide):**
  - **SC-3-Web:** `/b/lantern-vine` (or the live slug) buyer page shows the brand but NOT the paid not-ready experience, trip, or event; a free offering from the brand still shows.
  - **SC-3-iOS / SC-3-Android:** the consumer-app brand page (`useBrandBySlug`) shows the same — paid not-ready offerings absent, free present.
- **SC-4 (experience deep-link graceful):**
  - **SC-4-Web:** Visiting `/exp/lantern-vine/raleigh-wine-and-dine-crawl` renders the experience details read-only with a "Booking unavailable right now" banner in place of the checkout flow — NOT a 404, NOT a checkout 409 toast.
- **SC-5 (event deep-link graceful):**
  - **SC-5-Web:** Visiting a paid not-ready brand's `/e/{brand}/{event}` renders details + "Booking unavailable right now" in place of the Get-tickets CTA.
- **SC-6 (merged feed hide):** `discover-merged-events` for the relevant city does NOT include a paid business-event whose brand can't charge; includes it once the brand can charge; free business-events always included.
- **SC-7 (free never gated):** On EVERY surface, a FREE offering (no `available_online=true price_cents>0` ticket) and an in-person-only-paid offering (`available_online=false`) from a not-ready brand remain fully visible and bookable/joinable.
- **SC-8 (ready brand still shows):** A Stripe-ready brand's (`pg_brand_can_charge=true`) paid offering appears on ALL seven surfaces exactly as today (no regression).
- **SC-OWNER (no owner regression):** The brand owner, viewing their own dashboard (events/experiences/trips manage screens), STILL sees their own not-ready paid listing (so they can fix onboarding). No gated path is read by an owner/admin surface.
- **SC-9 (self-healing):** Flipping `stripe_connect_accounts.charges_enabled` true for the brand (no other change, no backfill, no refresh) makes the listing reappear on all hide surfaces and flips both deep-link pages back to a working Book CTA on the next query/refetch.
- **SC-10 (invariant gate):** The new strict-grep gate passes on this PR and would FAIL if any of the five buyer-supply RPC bodies dropped the `pg_brand_can_charge(` marker.

---

## 6. Copy (🔒 LOCKED — Mingla voice)

Deep-link "booking unavailable" banner (both `/exp` and `/e`):
- **Title:** `Booking unavailable right now`
- **Body:** `This organizer is finishing their payment setup. Check back soon — or explore their other offerings.`

Rationale: honest, non-punitive, on-brand, mirrors the existing ended/sold-out banner register (`bannerTitle` + `bannerBody`). No blame, no error-code, no "404". The body's "explore their other offerings" nudges the share-link visitor back to the brand page (where free offerings still show). 🎨 OPEN: the implementor may add a tappable "View {brand}'s page" affordance under the body (reuses the existing close→`/b/{slug}` route) — optional polish, not required.

---

## 7. Self-healing (confirm in implementation)

- Every gated object is a **live function/view/query** — `pg_brand_can_charge` is `STABLE` (re-evaluated per query), the supply RPCs are `STABLE`/SECURITY-DEFINER plain functions, `business_public_events_view` is a **plain view (NOT materialized — grep-confirmed)**, and the edge-fn + service-layer filters run on every request.
- The B2A onboarding trigger chain flips `stripe_connect_accounts.charges_enabled` true on Stripe completion and false on detach/capability-loss. Because no gated object is materialized and nothing is cached, the listing **reappears** the moment readiness flips and **auto-hides** if a brand later loses capability. **No backfill, no cron, no manual toggle, no matview refresh.**
- **Implementor MUST confirm** (read-only) at implement time that no gated path is served from a materialized view (re-grep `MATERIALIZED VIEW` against the five RPCs' source tables + `business_public_events_view`). If any becomes materialized later, the predicate must stay in the per-query path, never the matview.

---

## 8. Invariant

**NEW — I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED**
> Every buyer-facing supply path for a PAID offering filters on `public.pg_brand_can_charge(brand_id)`; FREE and in-person-only-paid offerings are unaffected; owner/admin reads are never gated. The serve-time mirror of `I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED` (ORCH-1075) and the checkout 409 (`ticket-checkout-create:607`) — all three layers enforce the identical `pg_brand_can_charge` rule (Constitution #13: same rules in generation and serving).

**Enforcement — new strict-grep gate** `.github/scripts/strict-grep/orch-1076-paid-supply-requires-charges-enabled.mjs` (modeled byte-for-byte on `orch-1075-paid-publish-integrity-guards.mjs`):
- `SUPPLY_RPCS = ["pg_eligible_experiences_for_deck", "pg_brand_experiences_for_place", "pg_public_experiences_by_brand", "pg_public_brand_upcoming", "pg_public_trips_by_brand"]`.
- For each, `findLatestDefining` (grep `CREATE OR REPLACE FUNCTION public.<name>` across `supabase/migrations` sorted descending, first hit) + `sliceFunctionBody`, then assert the sliced body `.includes("pg_brand_can_charge(")`. Fail-on-revert: if a future migration supersedes any RPC and drops the marker, the gate fails.
- Include a `--self-test` mode with inlined fixtures (a body WITH the marker passes; a body WITHOUT fails; `sliceFunctionBody` does not bleed an adjacent function's marker) — exactly the ORCH-1075 self-test shape.
- Register a workflow job in `.github/workflows/strict-grep-mingla-business.yml` mirroring the `orch-1075-paid-publish-integrity-guards` job block (self-test step + run step).

**Preserved invariants (must not regress):** I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED, I-PAID-PUBLISH-REJECTS-PAST-DATE (ORCH-1075 — untouched); I-PROPOSED-P-STRIPE-STATE-CANONICAL (`stripe_connect_accounts` is the single source — Stream A READS via `pg_brand_can_charge` which reads the canonical source column; never writes the cache); the checkout 409 contract.

---

## 9. External-API docs (COMMS-0003 — cite inline in the migration header + edge fn)

The migration header and the `discover-merged-events` edit MUST cite, inline:
- Stripe `charges_enabled` = "Whether the account can process charges." — https://docs.stripe.com/api/accounts/object
- Accounts with outstanding requirements have `charges_enabled=false` and must finish onboarding — https://docs.stripe.com/connect/onboarding
- PostgreSQL `CREATE FUNCTION` / SECURITY DEFINER — https://www.postgresql.org/docs/current/sql-createfunction.html
- Supabase RPC over PostgREST (anon/authenticated grants) — https://supabase.com/docs/guides/database/functions

(`pg_brand_can_charge` already mirrors these inline per ORCH-1075; Stream A re-uses the predicate and re-cites at each new call site.)

---

## 10. COMMS-0002 backend allowlist (same commit)

Add `ORCH_1076_BACKEND_ALLOWLIST` to `.github/scripts/strict-grep/orch-0863-marketing-hub-phase-b.mjs` in the **same commit** as the backend changes, and spread it into the master allowlist concat (the `...ORCH_1075_BACKEND_ALLOWLIST,` region near line 1722/1750-1821). Allowlist MUST list every new/changed backend file:
```js
const ORCH_1076_BACKEND_ALLOWLIST = [
  "supabase/migrations/<NEW_PREFIX>_orch_1076_paid_supply_requires_charges_enabled.sql",
  "supabase/migrations/__tests__/orch_1076_paid_supply_suppression.test.sql",   // if added
  "supabase/migrations/__tests__/orch_1076_paid_supply_suppression.test.ts",    // if added
  "supabase/functions/discover-merged-events/index.ts",
];
// ... ...ORCH_1076_BACKEND_ALLOWLIST,  ← add to the concat
```
(The strict-grep `.mjs` gate file + the workflow `.yml` are not under `supabase/functions/` so C7 does not flag them, but the migration + edge fn + any SQL tests do — they MUST be allowlisted.)

---

## 11. Safe-migration protocol

- **Filename:** strictly ABOVE the current remote head. As of this SPEC the worktree top is `20260911000000_orch_1075_…`. **Implementor MUST re-scan the live remote head at apply time** (`mcp__supabase__list_migrations` + scan sibling worktrees + origin/main per the monotonic-prefix rule) and pick the lowest prefix above the true max — ORCH-1075's header documents that the remote can carry applied-but-not-on-main migrations (e.g. `20260910000000` META-ORCH-1074) ahead of `main`. Do NOT hardcode; scan.
- **Idempotent / non-destructive:** all RPCs are `CREATE OR REPLACE`; the two new helpers are `CREATE OR REPLACE`; the grants are idempotent; NO column changes, NO data backfill, NO `DROP` of a populated object, NO pre-flight `RAISE` against existing rows. Safe to re-run.
- **Read-only invariant probe (pre-flight, in the test file — NOT in the migration):** before/after the migration, run a read-only probe asserting the predicate is wired:
  1. `SELECT public.pg_brand_can_charge('53aaea42-0e7d-4b2a-92db-c220d78a352c')` → `false` (the live not-ready brand).
  2. Mirror each gated RPC's WHERE in a direct table query (the SECURITY-DEFINER RPCs aren't directly executable by the MCP role) and assert the $70 experience is ABSENT from the gated result while PRESENT in the un-gated control. (This is exactly how the investigation proved the leak — reuse it as the regression probe.)
  3. Assert a FREE control offering and a ready-brand control offering are still PRESENT.
- **Re-emit verbatim:** each of the five RPCs is re-emitted from its latest-defining migration body VERBATIM plus the readiness branch (grep-all → sort → read-newest at implement time; confirm matches origin/main + remote). Preserve every existing comment, the `experience_intents` strict-intent logic (ORCH-1070), the cover/availability columns (ORCH-1072), the `display_price_cents` side-fetch, and all grants.

---

## 12. Test Matrix

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | Deck hides paid not-ready | deck RPC params matching Raleigh Wine & Dine Crawl, brand can't charge | 0 rows for that experience | DB RPC A-1 |
| T-02 | Place-card hides paid not-ready | `pg_brand_experiences_for_place(place_pool_id)` | $70 experience absent | DB RPC A-2 |
| T-03 | Brand-page experiences hide | `pg_public_experiences_by_brand('lantern-vine')` | paid not-ready experience absent | DB RPC A-3 |
| T-04 | Brand-page upcoming hides | `pg_public_brand_upcoming('lantern-vine')` | paid not-ready offering absent | DB RPC A-4 |
| T-05 | Brand-page trips hide | `pg_public_trips_by_brand('lantern-vine')` | paid (all-tiers-paid) not-ready trip absent; a trip with a free tier still present | DB RPC A-5 |
| T-06 | Merged feed hides paid not-ready event | `discover-merged-events` for the city | paid business-event from not-ready brand absent; price side-fetch still works for visible rows | Edge fn A-6 |
| T-07 | Experience deep-link graceful | GET `/exp/lantern-vine/{slug}` | details render + "Booking unavailable right now"; NO 404, NO 409 toast | Service C-1 + page |
| T-08 | Event deep-link graceful | GET `/e/{brand}/{event}` (paid, not-ready) | details render + "Booking unavailable right now" in place of Get-tickets | Service C-2 + page |
| T-09 | Owner still sees own listing | Owner dashboard (events/experiences/trips manage) | not-ready paid listing STILL visible to owner | Owner read (non-regression) |
| T-10 | FREE never gated | a FREE offering from the not-ready brand, every surface | fully visible + bookable/joinable | All |
| T-11 | In-person-only paid never gated | `available_online=false` paid offering from not-ready brand | visible (cannot hit online 409) | All |
| T-12 | Ready brand unaffected | flip a control brand `charges_enabled=true` | its paid offering shows on all 7 surfaces | All |
| T-13 | Self-heal reappear | flip not-ready brand → `charges_enabled=true`, no other change | listing reappears on all hide surfaces; deep-links flip to working Book on refetch | All (self-healing) |
| T-14 | Self-heal auto-hide | flip a ready brand → `charges_enabled=false` | its paid offering disappears from all 7 surfaces | All |
| T-15 | Strict-grep gate | run `orch-1076-…mjs` + `--self-test` | both exit 0; deleting the marker from any of the 5 RPCs fails the gate | CI |
| T-16 | Keyed enrich NOT broken | open an already-connected/already-chosen paid event whose brand later went not-ready (ConnectionsPage / theme / price side-fetch) | theme + price + connection meta still resolve (view NOT gated) | Regression — §3.B |

**Implementor happy-path proof:** T-01…T-08 + T-10 + T-12 + T-15.
**Tester adversarial angles (MANDATORY):**
- T-16 — prove the view-level gate was NOT applied (keyed-enrich consumers intact); a naive implementor who gates the view regresses theme/price/connections.
- T-09 + SC-OWNER — prove no owner/admin read regressed (enumerate the owner dashboard reads of `events`).
- T-05 free-tier carve-out — a trip with BOTH free + paid tiers from a not-ready brand MUST still show (buyer can book the free tier).
- T-11 in-person-only-paid — must NOT be hidden (it never hits the online 409).
- T-13/T-14 self-heal in BOTH directions (no materialized stale-row).
- Anon grant — prove the deep-link `bookable` resolver works for a logged-OUT visitor (the `anon` grant on `pg_brand_can_charge` is live), not only `authenticated`.
- Deep-link MUST NOT 404 (returning `null` from the resolver is the failure mode to catch — assert the page renders details + banner, not "not found").

---

## 13. Implementation Order

1. **DB migration** `<scan-for-prefix>_orch_1076_paid_supply_requires_charges_enabled.sql`:
   a. `pg_brands_can_charge(uuid[])` helper + grants (§3.A-6, §3.D).
   b. `GRANT … TO anon` on `pg_brand_can_charge(uuid)` (§3.D).
   c. Re-emit + gate the five supply RPCs verbatim (A-1…A-5), Stripe doc URLs inline (§9).
2. **Edge fn** `discover-merged-events/index.ts`: add `available_online` to the `ticket_types!left` embed; add the post-fetch paid+readiness drop using `pg_brands_can_charge` (A-6); leave the keyed price side-fetch untouched.
3. **Service layer:**
   a. `publicExperienceService.ts` — `bookable` flag on `getPublicExperienceBySlug`/`ById` (C-1).
   b. `publicEventsService.ts` — `bookable` on `PublicEventDetail` via `detailFromRow` (C-2); post-fetch readiness drop in `fetchPublicBrandEvents` (§3.B).
   c. `app-mobile/src/hooks/useBrandBySlug.ts` — mirror the flat-events post-fetch drop (SC-3-iOS/Android).
4. **Pages:**
   a. `exp/[brandSlug]/[experienceSlug].tsx` — third banner branch (C-1).
   b. `PublicEventPage.tsx` — `!event.bookable` CTA swap (C-2).
5. **Strict-grep gate** `.github/scripts/strict-grep/orch-1076-paid-supply-requires-charges-enabled.mjs` + workflow job (§8).
6. **Backend allowlist** `ORCH_1076_BACKEND_ALLOWLIST` in `orch-0863-marketing-hub-phase-b.mjs`, same commit (§10).
7. **Tests:** SQL/TS regression probe (§11) + the test files; allowlist them.

---

## 14. Regression Prevention

- **Structural safeguard:** the strict-grep gate (§8) makes a dropped `pg_brand_can_charge` marker in any of the five supply RPCs a CI failure (fails-on-revert).
- **Protective comments:** each gated RPC's added branch carries `-- ORCH-1076 I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED: paid-only Stripe-readiness gate (mirror of checkout 409 + ORCH-1075 publish guard). FREE + in-person-only-paid exempt. Buyer-facing only — owners read events directly.`
- **The view-NOT-gated decision** is documented in §3.B + a `// ORCH-1076: do NOT add a readiness filter to business_public_events_view — it serves keyed enrich (theme/price/connections); gate per-caller.` comment at the view's latest definer reference point (or in the new migration header) so a future engineer doesn't "simplify" by gating the chokepoint.
- **Test T-16** locks the keyed-enrich non-regression.

---

## 15. Discoveries for orchestrator

- None new beyond the investigation's three (the two latent leaks #6/#7 are now IN scope per this SPEC; the matview caveat is resolved — `business_public_events_view` is plain, gating is per-caller anyway).
- COMMS: no BLOCK/WARN matched this skill or ORCH-1076 in the active ledger this turn (COMMS-0002 backend-allowlist + COMMS-0003 docs-inline conventions are satisfied in-commit by §10/§9; COMMS-0019 ID-collision is paystack-scoped, not this ORCH). No new COMMS entry required from this SPEC.
