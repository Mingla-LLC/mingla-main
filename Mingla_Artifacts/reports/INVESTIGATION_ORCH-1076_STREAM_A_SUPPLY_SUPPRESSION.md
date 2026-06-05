# INVESTIGATION — ORCH-1076 [paid-readiness-supply-and-publish-banners] · Stream A (buyer-facing supply suppression)

- **Mode:** mingla-forensics INVESTIGATE (READ-ONLY)
- **Worktree:** `~/Desktop/mingla-orchs/ORCH-1076-[paid-readiness-supply-and-publish-banners]/` on branch `ORCH-1076-paid-readiness-supply-and-publish-banners`
- **Date:** 2026-06-04
- **Predecessor:** ORCH-1075 [paid-publish-integrity-guards] — shipped `pg_brand_can_charge(uuid)` + the publish-time guards. This investigation maps the **serve-time** counterpart (Constitution #13 exclusion-consistency).
- **Confidence:** **proven** for the leak existence (live read-only DB probes returned the unsellable listing through every implicated supply predicate). Backend/SQL/edge-fn audit — no simulator repro required per the Prime-Directive backend exemption.

---

## 0. Layman summary

A brand that can't take payments (Lantern & Vine — Stripe onboarding unfinished) has ONE live PAID experience ("Raleigh Wine and Dine Crawl", $70) that buyers can still see and tap **Book** on, only to dead-end at the checkout 409 `stripe_account_not_ready`. ORCH-1075 blocks NEW publishes but does nothing for already-live listings. I traced every place a buyer can discover a paid offering. The listing leaks through **four** supply paths (consumer swipe deck, consumer city events feed, consumer place-card, and the public `/b/{slug}` brand page + `/e/.../...` experience page). None of them filter on Stripe-readiness today. The fix is one consistent predicate — reuse `pg_brand_can_charge(brand_id)` (or the trigger-synced `brands.stripe_charges_enabled` cache) — applied **only to PAID offerings**, at the supply source. It self-heals: the listing reappears the moment the brand finishes onboarding, and auto-hides if a brand later loses charge capability.

---

## 1. The canonical predicate (already exists — reuse, don't reinvent)

**`public.pg_brand_can_charge(p_brand_id uuid) RETURNS boolean` — `LANGUAGE sql STABLE`**
Latest definer: `supabase/migrations/20260911000000_orch_1075_paid_publish_integrity_guards.sql:65-78` (grep-all → sort → read-newest confirmed; no sibling worktree or origin/main carries a newer definition — verified in the ORCH-1075 implementation report §1).

```sql
SELECT EXISTS (
  SELECT 1 FROM public.stripe_connect_accounts s
   WHERE s.brand_id = p_brand_id
     AND s.detached_at IS NULL
     AND s.stripe_account_id IS NOT NULL
     AND s.charges_enabled IS DISTINCT FROM false   -- true only
);
```

- Reads the **SOURCE** column (`stripe_connect_accounts.charges_enabled`), NOT the `brands.stripe_charges_enabled` cache. `GRANT EXECUTE … TO authenticated` (lines 80). It is STABLE and single-row-EXISTS → cheap to inline in a SQL RPC/view predicate.
- **Mirrors the checkout 409 predicate** (`ticket-checkout-create` resolves the session's `stripeAccountId`; when absent → `jsonResponse({ error: "stripe_account_not_ready" }, 409)` at `supabase/functions/ticket-checkout-create/index.ts:607`, AFTER the free-finalize branch — so the 409 is **paid-only** by construction). This is exactly the Constitution #13 contract: the same readiness rule the buyer hits at checkout, now applied at serve time.
- **Trigger-synced cache:** `brands.stripe_charges_enabled` is maintained by the B2A onboarding trigger chain (`20260508000000_b2a_stripe_connect_onboarding.sql`, `20260510000001_b2a_path_c_trigger_detach_cascade.sql`). Live probe confirms cache and source **agree** for the exposed brand (both `false`). Either is usable; **recommendation: prefer the function** for the canonical predicate so serve-time and publish-time can never drift, and reserve the column as the cheap join key where a view already selects from `brands` (see §5).

**Live readiness probe (Lantern & Vine `53aaea42-0e7d-4b2a-92db-c220d78a352c`):**
`brands.stripe_charges_enabled = false` AND `pg_brand_can_charge(brand_id) = false`. ✅ both agree.

---

## 2. "PAID" definition (consistent with ORCH-1075)

A PAID offering = the offering has at least one **sellable-online priced** ticket:
`EXISTS (ticket_types tt WHERE tt.event_id = e.id AND tt.available_online = true AND tt.deleted_at IS NULL AND tt.price_cents > 0)`.

- FREE offerings (`price_cents = 0` / `is_free`) take the free-finalize checkout path → never hit the 409 → **must remain visible** regardless of readiness.
- In-person-only paid (`available_online = false`) is exempt (matches ORCH-1075 T-16; those don't sell through `ticket-checkout-create`'s online path).
- The deck RPC already gates on the existence of one `available_online = true` sellable ticket (`pg_eligible_experiences_for_deck`), so adding `AND price_cents > 0` to a brand-readiness branch is cheap there. The brand-page RPCs already compute an `is_free`/`price_from_cents` column from the same `ticket_types` rows — the paid-ness signal is already in hand at every surface.

---

## 3. Per-surface map (with live probe results)

Every probe below was run read-only against production via `pg_brand_can_charge` and the surfaces' own predicates (the RPCs are SECURITY DEFINER and not directly executable by the MCP role, so I mirrored each RPC/view's exact WHERE clause in a direct table query — byte-checked against the migration body).

| # | Surface | Source (file:line) | Current readiness filter? | Does the live Lantern&Vine paid listing appear? | Recommended hook |
|---|---------|--------------------|---------------------------|--------------------------------------------------|------------------|
| 1 | **Consumer swipe deck** (app-mobile SOLO) | RPC `pg_eligible_experiences_for_deck` — latest definer `supabase/migrations/20260908000000_orch_1072_experience_detail_cover_availability.sql:118` (RETURNS TABLE) / WHERE block lines ~245-290. Invoked by `supabase/functions/discover-cards/index.ts:274` and `supabase/functions/generate-curated-experiences/index.ts:178`. | **NO.** Gates: `event_type='experience'`, `visibility='public'`, `status='scheduled'`, `published_at NOT NULL`, future `event_dates`, `≥1 experience_intents`, intent overlap (ORCH-1070 strict), geo radius, **EXISTS one `available_online=true` sellable ticket** — but no `pg_brand_can_charge`. | **YES** — RPC returned `Raleigh Wine and Dine Crawl` ($70.00 / `total_price_cents=7000`). **LEAK.** | Add to the RPC's `WHERE` (eligible CTE): for a **paid** experience (`ticket_price_cents > 0`), require `pg_brand_can_charge(e.brand_id)`. Both edge fns trust the RPC fully (no fn-side change needed). |
| 2 | **Consumer city events feed** (app-mobile merged discover) | `supabase/functions/discover-merged-events/index.ts:343-388` (the `events` query) — `business_event` source items; consumed by `app-mobile/src/types/mergedDiscover.ts`. | **NO.** Gates `event_type='event'`, `visibility='public'`, `status IN (scheduled,live)`, city, master `event_dates.end_at ≥ now`, left-joins `ticket_types(price_cents…)` for display. No `available_online` filter, **no brand readiness**. | **N/A for this brand** (Lantern&Vine has zero published `event_type='event'` rows). **Latent leak** for any future paid brand-event from a not-ready brand. | Add a brand-readiness + paid predicate. Cheapest: a `.not("brand_id","in",…)` is wrong (PostgREST); instead route this query's brand-event source through a readiness-aware view/RPC, OR add the predicate to `business_public_events_view` (see §5 single-point option). |
| 3 | **Consumer place-card experiences** (claimed-venue detail card) | RPC `pg_brand_experiences_for_place` — latest definer `supabase/migrations/20260906000001_orch_1072_brand_experiences_for_place.sql:16`, WHERE lines 59-65. | **NO.** Gates `place_pool_id`, `claim_status='verified'`, `event_type='experience'`, `visibility='public'`, `published_at NOT NULL`. No readiness. | **YES** — Lantern&Vine is `claim_status='verified'` with `place_pool_id=8b720912-…`; mirror-probe returned the $70 experience with `brand_can_charge=false`. **LEAK.** | Same as #1: gate paid experiences on `pg_brand_can_charge(e.brand_id)`. |
| 4 | **Public brand page `/b/{slug}`** (mingla-business Next.js) | `getPublicBrandBySlug` → `mingla-business/src/services/publicEventsService.ts:1059`, fanning to: (a) `fetchPublicBrandEvents` via `business_public_events_view` (`:946`); (b) `pg_public_trips_by_brand` (`:968`); (c) `pg_public_experiences_by_brand` — latest definer `supabase/migrations/20260729000000_meta_orch_0972_universal_authoring.sql` WHERE lines 57-62; (d) `pg_public_brand_upcoming` — same migration, WHERE lines 69-74. | **NO** on all four. Each gates `visibility='public'`, `published_at NOT NULL`, `deleted_at NULL`, lifecycle — none check readiness. (c) and (d) already SELECT an `is_free` / `price_from_cents` column. | **YES** — mirror-probes of `pg_public_experiences_by_brand` AND `pg_public_brand_upcoming` both returned the $70 experience (`is_free=false`, `brand_can_charge=false`). **LEAK** (experiences + upcoming feed). | Add a paid-only readiness branch to (c) + (d) [+ (a)/(b) for parity coverage of paid events/trips]. The RPCs already join `brands`, so `brands.stripe_charges_enabled` cache is the cheap join-key here. |
| 5 | **Public experience page `/e/{brandSlug}/{experienceSlug}`** + Book CTA | `getPublicExperienceBySlug` → `mingla-business/src/services/publicExperienceService.ts:248-289` (direct table reads, no RPC). Checkout chain twin: `getPublicExperienceById` (`:296`). | **NO.** Gates `event_type='experience'`, `status IN PUBLIC_STATUSES`, `deleted_at NULL`. Renders a bookable ticket + price; no readiness. | **YES** (page resolves & renders a bookable CTA for the leaked listing; buyer then hits the 409 at `ticket-checkout-create`). **LEAK — terminal dead-end.** | This is the page a deck/brand-page tap deep-links INTO. If #1/#3/#4 hide the listing, the only way to reach it is a direct share link. Recommend graceful "unavailable" state here (see §4), NOT a hard 404, so a share-link visitor sees an honest message rather than a broken Book button. |
| — | Public **event** page `/e/{brandSlug}/{eventSlug}` | `getPublicEventBySlug` → `publicEventsService.ts:900` via `business_public_events_view`. | NO. | N/A (no paid event for this brand). | Same as #5 for paid events — graceful unavailable CTA. |
| — | **Checkout 409 (last line of defense)** | `ticket-checkout-create/index.ts:607` | YES (this IS the readiness gate; paid-only — fires after free-finalize branch). | YES — this is the dead-end Stream A removes the path TO. | **Leave unchanged** — it is the correct terminal guard; Stream A makes it unreachable for normal navigation. |

### Confirmed live leaks (the 1 unsellable listing surfaces here NOW)
1. Consumer swipe deck (`pg_eligible_experiences_for_deck`) ✅ leaks
2. Consumer place-card (`pg_brand_experiences_for_place`) ✅ leaks
3. Public brand page experiences (`pg_public_experiences_by_brand`) ✅ leaks
4. Public brand page upcoming feed (`pg_public_brand_upcoming`) ✅ leaks
5. Public experience page + Book CTA (`getPublicExperienceBySlug`) ✅ leaks (terminal 409 dead-end)

### Latent leaks (no live data for this brand, but unguarded for any future not-ready paid brand)
6. Consumer city events feed (`discover-merged-events` business-event source) — would leak a paid brand-event
7. Public brand page paid events/trips (`fetchPublicBrandEvents` view + `pg_public_trips_by_brand`) — would leak a paid event/trip

---

## 4. Hide-entirely vs. graceful-unavailable — per-surface recommendation

The repo already has a **sold-out graceful pattern** worth reusing for display surfaces: `pg_public_ticket_types_remaining` (ORCH-0946) threads `remaining` into `mingla-business/src/components/checkout/QuantityRow.tsx` (sold-out disables the row), surfaced on `PublicEventPage.tsx`.

| Surface | Recommendation | Why |
|---------|----------------|-----|
| #1 deck, #2 events feed, #3 place-card | **HIDE ENTIRELY** | Discovery/supply surfaces. A buyer never asked for this specific listing; showing a non-bookable card is pure friction + an integrity violation (a "Book" affordance that can't book). The deck especially must not waste a swipe on a dead card. Self-healing: reappears on onboarding completion. |
| #4 brand page (experiences/upcoming) | **HIDE ENTIRELY** (default) | Same logic — the brand page is a supply list. Hiding keeps the page honest. (OPEN for SPEC/designer: a brand-OWNER viewing their own page could see a muted "Hidden until you finish payment setup" row — but that is owner-state, not buyer-state; buyer sees nothing.) |
| #5 experience page / #6 event page (direct deep-link / share link) | **GRACEFUL UNAVAILABLE** (reuse the sold-out visual language) | This is the one surface reachable by a pre-existing share link even after hiding everywhere else. A hard 404 would look broken/punitive. Render the listing read-only with the Book CTA replaced by a disabled "Booking unavailable right now" state (sold-out style), so the share-link visitor gets an honest, on-brand message instead of a 409 toast. |

---

## 5. Hook-point strategy (direction only — SPEC owns the detail)

**Single consistent predicate everywhere:** `pg_brand_can_charge(brand_id)`, applied **only when the offering is paid** (per §2). Two equivalent placements; SPEC chooses:

- **Per-RPC/view predicate (recommended, lowest blast radius):** add a `WHERE` branch to each of the four leaking RPCs/views (`pg_eligible_experiences_for_deck`, `pg_brand_experiences_for_place`, `pg_public_experiences_by_brand`, `pg_public_brand_upcoming`) of the form:
  `AND ( <offering is free> OR pg_brand_can_charge(e.brand_id) )`.
  These are all `CREATE OR REPLACE` SECURITY DEFINER functions → additive, idempotent, no schema change. The deck RPC already computes `ticket_price_cents`; the brand-page RPCs already compute `is_free` — the paid test is in-hand.
- **`discover-merged-events` (#2) + brand-page paid events/trips (#7):** these read `business_public_events_view` and `pg_public_trips_by_brand`. Cleanest single point: fold the readiness predicate into `business_public_events_view` itself (it already joins `brands`, so `brands.stripe_charges_enabled` is a free column) — but that view is consumed by **both** buyer surfaces AND the all-in price side-fetch in multiple fns, so SPEC must confirm no business-side consumer reads the same view expecting unready brands' rows. If the view is buyer-only, gating it there covers #2, #4a, and #6 in one shot. **Investigate-flag for SPEC:** enumerate every reader of `business_public_events_view` before gating the view vs. gating per-caller.

**The graceful-unavailable surfaces (#5/#6)** are client-side (TS service reads): the resolver should additionally read `pg_brand_can_charge(brand_id)` (or `brands.stripe_charges_enabled`) and the offering's paid-ness, returning a `bookable: false` flag the page renders as the disabled CTA — NOT returning `null` (which 404s and looks broken for a share-link).

---

## 6. Constitution #13 (exclusion consistency) — the spine of Stream A

Rule 13: *"the same rules in generation and serving."* ORCH-1075 put the readiness rule at **generation** (publish-time). The buyer's **checkout** already enforces it (`stripe_account_not_ready` 409). Stream A closes the gap in the middle: **serving** (supply/discovery) must use the **identical** predicate, so a buyer can never be shown a paid card that publish-time would now reject and checkout-time will reject. Reusing `pg_brand_can_charge` (the exact function the publish guard uses, which itself mirrors the checkout predicate) makes all three layers provably the same rule — that is the invariant Stream A should register:
> **NEW I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED** — every buyer-facing supply path for a paid offering filters on `pg_brand_can_charge(brand_id)`; free offerings unaffected. Mirror of I-PAID-PUBLISH-REQUIRES-CHARGES-ENABLED (ORCH-1075) at serve time. Enforce via a strict-grep gate asserting `pg_brand_can_charge(` appears in each of the four supply RPCs.

---

## 7. Self-healing properties (confirm in SPEC)

`pg_brand_can_charge` reads live `stripe_connect_accounts.charges_enabled`. The B2A webhook/trigger chain flips `charges_enabled` true when Stripe finishes onboarding and false on detach/capability-loss. Because every supply predicate is a live function call (STABLE, not materialized), the moment readiness flips:
- listing **reappears** in supply (onboarding finished), and
- listing **auto-hides** if a brand later loses capability.
No backfill, no cron, no manual toggle. (One caveat for SPEC: confirm no supply path is served from a **materialized** view that would need a refresh — `business_public_events_view` naming suggests a matview in places; if so, the readiness column must be refreshed on the same cadence as price, or the predicate must live in the per-caller query, not the matview.)

---

## 8. Five-layer cross-check

| Layer | Finding |
|-------|---------|
| **Docs** | MEMORY `project_orch_1073_paid_publish_integrity_guards.md` + ORCH-1075 artifacts establish the publish-time guard; Stream A is the registered serve-time complement. |
| **Schema** | `pg_brand_can_charge` (20260911000000) + `brands.stripe_charges_enabled` cache exist and are current (latest-definer confirmed). The four supply RPCs lack any readiness predicate. |
| **Code** | Edge fns (`discover-cards`, `generate-curated-experiences`, `discover-merged-events`) trust their RPC/query; TS resolvers (`publicEventsService`, `publicExperienceService`) do direct reads with no readiness gate. |
| **Runtime** | The checkout 409 (`ticket-checkout-create:607`) is the only live readiness gate; it fires paid-only, after free-finalize. |
| **Data** | Live probes: Lantern&Vine `can_charge=false`; the $70 experience returns through deck + place-card + brand-experiences + brand-upcoming predicates. Drafts ($80 etc.) don't leak (not published). Exactly 1 live exposure — matches dispatch. |

---

## 9. Blast radius

- **Surfaces touched by the fix:** 4 supply RPCs (DB), 1 view (optional single-point), 2 TS resolvers (graceful CTA). Consumers: app-mobile SOLO deck + merged feed + place-card; mingla-business `/b/{slug}` + `/e/.../...`.
- **Must NOT regress:** FREE offerings (any surface), in-person-only paid offerings, the checkout 409 (leave as terminal guard), and any **business-side** reader of `business_public_events_view` (the owner must still see their own unready paid listing in their dashboard — Stream A is buyer-facing only; do not gate owner/business reads).
- **Cross-surface (Phase 2.5 preview for SPEC):** Consumer iOS/Android (deck + feed + place-card — shared edge fns → parity automatic); Buyer/anon web (`/b`, `/e`, checkout-experience); Business iOS/Android & Admin = NOT covered (owner/admin must still see unready listings). Parity for the DB-RPC surfaces is automatic (single server predicate); the two TS resolver surfaces need their own per-surface success criteria.

---

## 10. Discoveries for orchestrator

1. **Two latent (not-yet-live) leaks** beyond the dispatch's enumerated three: `discover-merged-events` (consumer city events feed, brand `event_type='event'` source, `index.ts:343`) and the brand-page **paid events/trips** buckets (`fetchPublicBrandEvents` view + `pg_public_trips_by_brand`). No data for Lantern&Vine, but unguarded for any future not-ready paid brand. SPEC should cover all of event/experience/trip for completeness, not just the one experience that happens to leak today.
2. **`business_public_events_view` is a shared chokepoint** read by both buyer surfaces AND price side-fetches in multiple edge fns. Gating readiness there is the cheapest single point for #2/#4a/#6 but requires enumerating every reader first (a business/owner reader expecting unready rows would regress). Flagged for SPEC.
3. **Matview-refresh caveat** for self-healing: if any supply path is served from a materialized view, the readiness predicate must NOT live only in the matview (it'd go stale between refreshes); prefer the live per-query predicate. SPEC must confirm matview vs. plain view for each path.
4. **COMMS handling:** No cross-ORCH BLOCK/WARN matched this skill or ORCH-1076 in the active ledger (COMMS-0001 is ORCH-0955-scoped, already RESOLVED-era; COMMS-0002/0003 are backend-allowlist/docs conventions Stream A's implementor will satisfy in-commit). No new COMMS entry required from this read-only investigation.
