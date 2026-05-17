# INVESTIGATION — ORCH-0859 [Tr2 Minimum Viable Trip]

**Mode:** INVESTIGATE
**Skill:** Claude `mingla-forensics`
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Milestone brief:** `Mingla_Artifacts/milestones/Tr2_MINIMUM_VIABLE_TRIP.md`
**Upstream:** ORCH-0855 [Tr1 Trip Planner Brand Onboarding] CLOSED PASS Grade A 2026-05-17 (PR #123 merged at `436c9a6e`); ORCH-0826 [Hub Foundation + universal-plus creator] CLOSED Grade A.
**Affected Surfaces:** business iOS, business Android, buyer/anonymous web (`mingla-business` `/t/{brandSlug}/{tripSlug}`), database, edge functions (Resend confirmation template + publish RPC extension). NOT in scope: consumer iOS/Android (C1 [Consumer Discover Trips] reads Tr2's output but is its own ORCH), admin web (no admin queue for trips per DEC-4), business web preview (untouched by Tr2's mobile-first flow).

**ORCH-ID correction note:** orchestrator dispatch named this ORCH-0856 in the previous turn's handoff. ORCH-0856 was already registered at ORCH-0854 close as the legacy realtime-subscriptions audit follow-up. ORCH-0857 (Hub pills) + ORCH-0858 (Vercel) are also taken. Tr2 is registered as **ORCH-0859** going forward. Orchestrator should update WORLD_MAP + MASTER_BUG_LIST + AGENT_HANDOFFS references accordingly.

---

## 1. Executive Summary (layman)

Tr2 is **the largest milestone shipped so far on Mingla Business 1.2** — first dollar of trip revenue, 2-week scope, 18 acceptance criteria. The foundation is in place from M0 (`events.event_type` discriminator) + Tr1 (trip-planner brands exist with Stripe Connect). What's missing is everything between: a trip-creation wizard, three new sidecar tables (`trip_days`, `trip_pricing_tiers`, `trip_inclusions`), a public anon-tolerant trip page route, a buyer checkout flow specific to trips, a trip-specific confirmation email template, and an operator trip dashboard.

The good news: the **checkout layer is mostly reusable as-is**. `ticket-checkout-create` is `event_type`-agnostic — it routes Stripe charges to the brand's connected account regardless of whether the brand sells events or trips, and `ticket_types` already has the columns (`price_cents`, `currency`, `quantity_total` for capacity, `is_unlimited`) trips need for a single full-price tier. The `events` table itself accepts `event_type='trip'` rows today (verified via live MCP probe).

The hard work is **trip-specific everywhere else**: trip wizard (5 steps mirroring but diverging from the 7-step event wizard), 3 new tables with anon-tolerant RLS (read-published-only) + brand-member-write, day-by-day itinerary UX, public trip detail page with hero + dates + itinerary + inclusions + pricing + CTA, buyer flow (`/t/{brandSlug}/{tripSlug}` → tier picker → buyer info → Stripe → confirmation), confirmation email template via Resend, operator dashboard with Overview + Travelers tabs.

The riskiest unknowns are **(a)** whether the publish RPC `business_publish_event_draft` can be extended to handle trips + the 3 sidecar tables in one atomic transaction or needs a parallel `business_publish_trip_draft` RPC; **(b)** whether Stripe Connect actually routes test-mode trip orders to the trip planner's connected account correctly (per milestone brief §11 "money plumbing has to be verified, not assumed"); **(c)** anon-tolerant RLS reads on the 3 new sidecar tables (the anon role must SELECT trip_days for published trips but never for draft trips).

**Recommended direction:** mirror the event wizard pattern step-by-step. Build the migration first (3 sidecar tables + RLS). Build `tripsService` + `useTrips` to CRUD trips. Build the wizard. Build the publish path (either extend or fork the RPC). Build the public route. Build the buyer flow (reuse `ticket-checkout-create` + a new tier picker + buyer info screen + Stripe PaymentSheet). Build the confirmation email. Build the operator dashboard. Each step independently revertible.

---

## 2. Phase 0 Ingestion Checklist

| Input | Status |
|---|---|
| `Mingla_Artifacts/milestones/Tr2_MINIMUM_VIABLE_TRIP.md` (253 lines) | ✅ read end-to-end |
| Tr1 closure evidence chain (just-shipped 2026-05-17): `reports/{INVESTIGATION,IMPLEMENTATION,QA}_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING*.md` + `specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md` | ✅ read (this session) |
| M0 closure: `reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md` + `specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md` | ✅ scanned |
| Project spec: `MINGLA_BUSINESS_1_2_WORKING_DOC.md` §3.3 (data model) + §6.2 (Track 1 schedule) + §8 (DEC-4 Stripe-as-identity) | ✅ |
| Invariants: `INVARIANT_REGISTRY.md` — I-1.2-UNIFIED-EVENT-TYPE (ACTIVE) + I-1.2-BRAND-AS-CONTAINER (PROJECT_SPEC §54) + I-PROPOSED-TR1-PERSONA-INTERFACE (ACTIVE) + I-PROPOSED-TR1-KIND-IMMUTABLE (ACTIVE) | ✅ |
| Live DB probes: `events` schema, `ticket_types` schema, `brands_kind_check` constraint state (all via MCP) | ✅ |
| Existing publish RPC: latest at `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` (`business_publish_event_draft`) | ✅ scanned for event_type awareness |
| Existing event-create wizard: 7 Creator* components in `mingla-business/src/components/event/` (the pattern to mirror) | ✅ identified file list |
| Existing public event route: `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | ✅ scanned |
| Existing buyer-checkout edge fns: `ticket-checkout-create`, `ticket-checkout-confirm`, `ticket-confirmation-dispatch` (all in `supabase/functions/`) | ✅ |
| Hub > Trips placeholder: `mingla-business/app/(tabs)/hub/trips.tsx` (M0 stub) + `/trip/coming-soon.tsx` (M0 stub) | ✅ |

No prior ORCH-0859 investigation exists. Tr2 is greenfield. No DRAFT memory or prior dispatch contradicts findings below.

---

## 3. Findings (six-field evidence per section)

Legend: 🔴 gap blocking user outcome · 🟠 contributing constraint · 🟡 hidden flaw (pattern violation if implemented carelessly) · 🔵 observation (reusable as-is)

### A. `events` table accepts `event_type='trip'` rows today

🔵 **Observation A-1** — DB layer is Tr2-ready post-M0; no schema gap for the parent row.

- **File + line:** live MCP `information_schema.columns` probe 2026-05-17:
  - `event_type text NOT NULL DEFAULT 'event'` (33 columns total on `events`)
  - `brands_kind_check` admits `('physical','popup','trip_planner')` (post-ORCH-0855)
  - `events_event_type_check` admits `('event','experience','trip')` (post-ORCH-0826)
- **What it does:** `INSERT INTO events (brand_id, created_by, title, slug, event_type) VALUES (..., 'trip')` succeeds today — no schema change needed for the parent row.
- **What it should do (per Tr2):** Same. Tr2 inherits the M0 plumbing as-is.
- **Causal chain:** I-1.2-UNIFIED-EVENT-TYPE invariant ratified at M0 close — trips MUST be `events` rows. Migration `20260605000000_orch_0826_events_event_type_discriminator.sql` made this true. Tr2 has zero work on `events` itself.
- **Verification step:** post-build, `INSERT INTO events (brand_id, created_by, title, slug, event_type) VALUES (<trip-planner-brand-id>, auth.uid(), 'Test Trip', 'test-trip', 'trip')` should succeed for a trip-planner brand member; SELECT on the resulting row should return `event_type='trip'`.

### B. Trip-specific fields are NOT first-class columns

🔴 **Gap B-1 (the core Tr2 schema work)** — destination, dates, capacity, itinerary, inclusions, pricing tiers all need sidecar storage.

- **File + line:** `events` schema (live MCP) has NO native columns for: destination (`destination_place_id` / `destination_lat` / `destination_lng`), dates (start/end), capacity, day-by-day itinerary, inclusions/exclusions. Dates currently live in `theme.business_event.startAt/endAt` (per ORCH-0850 [end-not-start parity systemic] — `theme jsonb` is a generic discriminator-conditional payload).
- **What it does today:** Events use `theme.business_event.{startAt,endAt,venueName,format}`; capacity lives on `ticket_types.quantity_total` per-tier; description lives in `events.description` text.
- **What it should do (per Tr2 §5):** Three NEW sidecar tables — `trip_days` (per-day itinerary with ordinal + title + narrative + date + stops jsonb), `trip_pricing_tiers` (joins event_id to ticket_type_id with tier_name + tier_metadata), `trip_inclusions` (per-trip kind in/excluded items with ordinal). Dates can stay in `theme.business_event` (consistent with event pattern + ORCH-0850 fixes) OR move to first-class columns (cleaner but breaks pattern). SPEC must pick.
- **Causal chain:** No sidecar tables → wizard cannot persist day-by-day itinerary, inclusions/exclusions, or tier naming → trips cannot be created end-to-end → user outcome blocked.
- **Verification step:** post-migration, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('trip_days','trip_pricing_tiers','trip_inclusions')` returns 3.

🟠 **Contributing factor B-2** — `events.theme` jsonb is the existing dynamic-payload pattern.

- **File + line:** Used by event wizard for `theme.business_event = { startAt, endAt, venueName, format, ... }`.
- **What it does:** Allows event-type-specific fields without column churn on the parent table.
- **What it should do (for Tr2):** Trip-specific top-level fields (destination, capacity) MAY go into `theme.business_trip = { destinationPlaceId, destinationLat, destinationLng, capacity }` to mirror the event pattern. Alternative: first-class columns. SPEC must pick.
- **Recommendation:** stay in theme.business_trip for consistency with event pattern + zero schema churn on parent. Capacity per-tier already lives in `ticket_types.quantity_total` (Section C) — top-level "trip capacity" is the SUM across tiers, often a derived value.

### C. `ticket_types` already supports single-tier trip pricing

🔵 **Observation C-1** — Pricing layer is fully reusable.

- **File + line:** live MCP `ticket_types` schema — 27 columns including `price_cents int NOT NULL`, `currency char NOT NULL`, `quantity_total int NULL`, `is_unlimited bool NOT NULL`, `is_free bool NOT NULL`, `sale_start_at`, `sale_end_at`, `validity_start_at`, `validity_end_at`, `min_purchase_qty`, `max_purchase_qty`, `display_order`, etc.
- **What it does:** Existing tier model used by all paid events today; well-tested by ORCH-0777 + ORCH-0789/0790 [web checkout].
- **What it should do (for Tr2 §3-7):** Single ticket_types row per trip with `tier_name` recorded in `trip_pricing_tiers.tier_name` (the join row) + `quantity_total = trip capacity` (e.g., 12 for Tulum Yoga 12-person retreat).
- **Causal chain:** Trip "Double occupancy $50, capacity 12" → 1 row in `ticket_types` (price_cents=5000, currency='USD', quantity_total=12) + 1 row in `trip_pricing_tiers` (event_id, ticket_type_id, tier_name='Double occupancy'). When Tr3 adds installments, `trip_pricing_tiers.tier_metadata jsonb` holds the schedule.
- **No work needed in `ticket_types`** beyond the wizard creating rows with appropriate values.

### D. Publish RPC `business_publish_event_draft` is the divergence point

🟠 **Contributing constraint D-1** — Publish flow needs trip + sidecar awareness; biggest SPEC-time architectural decision.

- **File + line:** `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql` is the latest publish RPC migration; `mingla-business/src/services/businessEvents.ts:561` shows the client call: `supabase.rpc("business_publish_event_draft", {...})`.
- **What it does today:** Atomic publish — `draft → scheduled`, generates final slug (replaces `draft-` prefix), writes `event_dates` rows (per ORCH-0792 [publish writes event_dates]), validates required fields.
- **What it should do (for Tr2):** When `event_type='trip'`, the publish step also needs to (a) validate ≥1 `trip_days` row exists, (b) validate ≥1 `trip_pricing_tiers` row exists, (c) validate `theme.business_trip.{destinationPlaceId, capacity}` are set. SPEC must pick: extend `business_publish_event_draft` with `event_type`-discriminator branches, OR ship a parallel `business_publish_trip_draft` RPC.
- **Recommendation:** Extend the existing RPC. Keeps one publish authority (Constitution #2 one owner per truth), mirrors how M0 extended the events table rather than forking, and keeps the client-side `useCreateBrand`-style mutation single-purpose.
- **Causal chain:** Without trip-aware publish validation → trips can be marked `scheduled` with no days / no tiers → buyers hit a half-empty page → conversion broken.
- **Verification step:** post-extension, publish an event with `event_type='trip'` + zero `trip_days` rows → expect explicit error (e.g., `trip_days_required`). Publish with 1+ days + 1+ tier → success.

### E. Public buyer-anon page needs new `/t/[brandSlug]/[tripSlug]` route

🔴 **Gap E-1** — Net-new public route + render component.

- **File + line:** `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` exists (28-line shim → `<PublicEventPage>` from `@mingla/event-rendering`). `mingla-business/app/t/` directory does NOT exist.
- **What it does today:** Public event page resolves brand+event slugs, fetches via `usePublicEventBySlug`, renders `PublicEventPage` which the consumer-side shares via `packages/event-rendering`.
- **What it should do (per Tr2 §3-9..10):** Parallel `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` resolves brand+trip slugs, fetches via NEW `usePublicTripBySlug` (anon-tolerant, no `useAuth`), renders NEW `TripPreview` component (which can either live in `mingla-business/src/components/trip/` or be promoted to `packages/event-rendering` if consumer C1 will reuse it).
- **Causal chain:** No `/t/` route → planner cannot share a trip link → buyer cannot discover the trip → no purchase → no revenue.
- **Per feedback_anon_buyer_routes:** `/t/[brandSlug]/[tripSlug]` MUST live OUTSIDE `app/(tabs)/` and MUST NOT call `useAuth` or redirect to sign-in. Mirror the `/e/` + `/b/` + `/checkout/` pattern exactly.
- **Verification step:** open `/t/wandering-soul-retreats/tulum-yoga-retreat-march-2026` in a signed-out browser → expect trip page renders (not auth redirect).

### F. Anon RLS reads on 3 sidecar tables — the security gate

🔴 **Gap F-1 + Security gate** — Sidecar tables need anon-tolerant RLS that ONLY exposes published trips.

- **File + line:** Tr2 brief §5 sketches RLS — `trip_days_read_published` checks `EXISTS (SELECT 1 FROM events WHERE id = trip_days.event_id AND deleted_at IS NULL AND (status IN ('scheduled','live') OR public.is_brand_member(brand_id)))`. Same pattern for `trip_pricing_tiers` + `trip_inclusions`.
- **What it does today:** N/A (tables don't exist).
- **What it should do:** Anon role + authenticated buyers can SELECT trip_days rows where parent event is published; brand members can SELECT all (including drafts); only brand members can INSERT/UPDATE/DELETE. Anon must NEVER see draft trips' day-by-day plans (operator hasn't decided to publish yet — premature disclosure).
- **Security risk if wrong:** Without the `status IN ('scheduled','live')` filter, the RLS would expose draft trip details (operator hasn't decided to publish yet) — Constitution #9 adjacent (showing not-yet-real data to public).
- **Causal chain:** Either too permissive (leaks drafts → privacy gap + Constitution #9 risk) or too restrictive (blocks anon buyers → /t/ page is empty → no checkout). SPEC must verify the helper `is_brand_member(brand_id)` exists or substitute (`biz_is_brand_member_for_read_for_caller(brand_id)` per Tr1 investigation Section C-3 was the actual helper name on the brands table).
- **Verification step:** as anon, `SELECT * FROM trip_days WHERE event_id = '<draft-trip-id>'` → empty; same query with `<published-trip-id>` → returns rows.

🟡 **Hidden flaw F-2** — Helper function name discrepancy.

- **File + line:** Tr2 brief §5 uses `public.is_brand_member(brand_id)`. Tr1 investigation Section C-3 cited live RLS helpers: `biz_is_brand_admin_plus_for_caller(id)` + `biz_is_brand_member_for_read_for_caller(id)`.
- **What it does today:** The brand-level helpers exist; an `is_brand_member(brand_id)` helper may or may not exist at the `events`-table level — SPEC must verify.
- **What it should do:** SPEC verifies helper name + signature via `SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%brand_member%';` before writing migration.

### G. Buyer checkout flow — extend existing OR build new

🔵 **Observation G-1** — `ticket-checkout-create` is `event_type`-agnostic.

- **File + line:** `supabase/functions/ticket-checkout-create/index.ts` — no `event_type` branches in the body (verified via grep). Routes Stripe charges based on the brand's `stripe_connect_id` regardless of event type.
- **What it does:** Buyer hits `/checkout/{eventId}`, edge fn creates Stripe Checkout Session OR PaymentIntent, attaches `application_fee_amount` + `transfer_data.destination=<brand-stripe-connect-id>`, returns to confirm page.
- **What it should do (for Tr2):** Works as-is for trips. Buyer at `/t/{brandSlug}/{tripSlug}` taps "Reserve my spot" → routes to existing `/checkout/{tripEventId}` → same flow. The tier picker + buyer info screens already exist in `mingla-business/app/checkout/[eventId]/` (per ORCH-0852 [bulletproof buyer checkout] work).
- **Causal chain:** Reusing the checkout layer = ~70% of buyer-side work is already done. Tr2 mostly adds the trip-specific detail page above and the trip-specific confirmation email below.

🟠 **Contributing constraint G-2** — Buyer-flow components may need trip-shaped tier copy.

- **File + line:** existing `/checkout/[eventId]/payment.tsx` shows "Pay $X for <event>" UX; for trips the copy needs trip-shaped messaging ("Reserve your spot on <trip>" or "$50 deposit for <trip>" once Tr3 adds installments). Tr2 ships single full-price tier so the copy is simpler — but mockup needed at SPEC time.

🟡 **Hidden flaw G-3** — `Stripe Connect routing for trip orders` is unverified live.

- **File + line:** Tr2 brief §11 says "Surface to Seth before commit: Stripe Connect routing — confirm test-mode trip orders settle to the trip planner's connected account, not Mingla's main account. This is the kind of money plumbing that has to be verified, not assumed."
- **Causal chain:** If Stripe Connect routing is broken for trip-planner brands (despite working for popup brands), money flows to Mingla's main account instead of the planner — silent revenue misallocation, painful to recover.
- **Verification step:** Tr2 IMPL must do a Stripe Dashboard test-mode probe: create a trip with a trip-planner brand, buy a $1 test ticket, verify in Stripe Dashboard that the charge is on the trip planner's connected account and `application_fee_amount` accrues to Mingla's platform account. Make this an explicit Tr2 SPEC success criterion + tester verification.

### H. Confirmation email — new trip-specific template

🔴 **Gap H-1** — Resend pipeline exists but template is event-shaped.

- **File + line:** `supabase/functions/ticket-confirmation-dispatch/index.ts` is the existing confirmation pipeline (per ORCH-0851 [Consumer Tickets tab post-purchase realtime freshness] + ORCH-0852 [Bulletproof buyer checkout] work); it fires Resend with an event-shaped template (event title, date, venue, QR code, ORCH-0842 [Tickets-into-Active + PDF sheet] PDF attachment).
- **What it does:** Sends "Your ticket to <Event Title> on <date> at <venue>" with QR + PDF.
- **What it should do (per Tr2 §3-13):** Detect `event_type='trip'` and send a trip-shaped template — "Your booking for <Trip Title>, <dates>, <destination>" + day-by-day summary + inclusions + Mingla brand shell.
- **Causal chain:** Sending an event-shaped email for a trip would confuse buyers — "venue" doesn't apply to a multi-day trip; QR codes are still useful (for check-in at trip start) but the framing is wrong.
- **Per Tr2 §3-13:** "Confirmation email fires via Resend pipeline using a new trip-specific template." SPEC must define template structure.

### I. Operator trip dashboard — net-new route + components

🔴 **Gap I-1** — Tr2 §3-14 requires `/trip/{id}` with Overview + Travelers tabs.

- **File + line:** No `mingla-business/app/trip/[id]/` exists yet (only `/trip/coming-soon.tsx`). The existing event dashboard at `mingla-business/app/event/[id]/` (per `EventDetailHeroStatusPill`, `EventDetailKpiCard`, `EventDetailTicketTypeRow`, `EventDetailActivityRow`) is the pattern to mirror.
- **What it does today:** Event dashboard shows live-event hero + KPIs + ticket tiers + activity.
- **What it should do (per Tr2 §3-14):** Trip dashboard `/trip/[id]/index.tsx` shows Overview (revenue, traveler count, days-until-departure) + Travelers (per-traveler row with payment status). Eventually (Tr5+) gets Intake Forms tab, Discussion tab, etc. Tr2 ships Overview + Travelers ONLY.

### J. Wizard routing rewire — UniversalCreatorSheet + Home CTA

🔴 **Gap J-1** — Two stubs to remove.

- **File + line:**
  - `mingla-business/src/components/ui/UniversalCreatorSheet.tsx:78,80` — "Create trip or otherwise" routes to `/trip/coming-soon`. Tr2 changes to `/trip/create`.
  - `mingla-business/app/(tabs)/home.tsx:403` — "Plan a trip" CTA (Tr1) routes to `/trip/coming-soon`. Tr2 changes to `/trip/create` (or unchanged if `/trip/coming-soon` becomes a redirect to `/trip/create`).
- **What it does today:** Both route to the stub.
- **What it should do (per Tr2 §3-1):** Both route to the real wizard entry `/trip/create`.
- **Causal chain:** Without rewire → operators can't find the new wizard from the persona-fork-set-up brand.
- **Trade-off SPEC must pick:** delete `/trip/coming-soon.tsx` (cleaner) vs convert it to a redirect (preserves any deep links operators may have shared).

### K. Hub > Trips list — wire real published trips

🔴 **Gap K-1** — Hub > Trips placeholder needs real query.

- **File + line:** `mingla-business/app/(tabs)/hub/trips.tsx` is the M0 stub rendering a "Trips coming soon" placeholder card.
- **What it does today:** Renders placeholder copy.
- **What it should do (per Tr2 §9 polish item "Should published trips appear in the planner's Hub > Trips sub-tab? Yes, but UX needs design"):** Query `events` filtered to `brand_id = currentBrand.id AND event_type='trip' AND status IN ('draft','scheduled','live','ended')`, render trip list cards mirroring `EventListCard` pattern. Tap routes to `/trip/{id}` operator dashboard.

### L. Regression tests — existing event flow byte-equivalence

🔵 **Observation L-1** — Tr2 must NOT regress event creation, event checkout, brand list, marketing hub.

- **Per Tr2 §7:** Today's event creation flow (popup brands creating events) must be completely unaffected; today's event checkout (buyer flow for events) must be unchanged; brand list shows both kinds (trip_planner already shipped in Tr1); marketing hub no impact.
- **Implementor must:** add discriminator-aware branches at the few divergence points (publish RPC, confirmation email template) WITHOUT modifying the event-path semantics. Hard-guard adversarial check should grep for `event_type === 'event'` branches and verify nothing reduces existing behavior.

---

## 4. Five-Layer Cross-Check

| Layer | Says | Contradiction? |
|---|---|---|
| **Docs** | Tr2 brief §3 lists 18 acceptance criteria; project spec §6.2 budgets 2 weeks; "first dollar of trip revenue"; brand-as-container principle says any brand can author any offering type via universal "+". | — |
| **Schema** | Live DB has `events.event_type` admitting `'trip'`; `ticket_types` reusable; 3 sidecar tables (`trip_days`, `trip_pricing_tiers`, `trip_inclusions`) do NOT exist (verified via grep on migrations + live MCP). | ⚠️ Schema missing 3 sidecar tables — Tr2 migration fixes. |
| **Code** | `ticket-checkout-create` event_type-agnostic (reusable); publish RPC `business_publish_event_draft` is event-shaped; no trip wizard / public route / dashboard exists; UniversalCreatorSheet + Home CTA route to stub. | ⚠️ Code missing wizard + public route + dashboard + email template — Tr2 builds. |
| **Runtime** | Today: zero trip-type rows in `events` (verified by absence of any code path producing them); Tr1 trip-planner brands exist but have nothing to do yet. | Consistent — Tr2 is the first surface producing trip rows. |
| **Data** | Live: 12 brands all `kind='popup'` (Tr1 just shipped, no trip-planner brands created yet). | Consistent — Tr2 is greenfield; need at least one trip-planner brand created via Tr1 wizard before Tr2 smoke test. |

**Conclusion:** all 5 layers internally consistent for today's state. Tr2 builds the schema + code + runtime + data path simultaneously.

---

## 5. Risks + Unknowns (P0..P3)

**P0** — None. All foundations exist; Tr2 is additive build-out.

**P1** —
- **P1-1: Stripe Connect routing for trip orders unverified live.** Per Tr2 §11. Must be a Tr2 SPEC success criterion AND a tester verification step. Mitigation: SPEC includes "live Stripe Dashboard probe of test-mode $1 trip charge confirms transfer_data.destination = trip-planner's connected account; application_fee_amount accrues to Mingla platform" as SC-N.
- **P1-2: Anon RLS on sidecar tables — security gate.** Must SELECT only for published trips, never drafts. Mitigation: SPEC explicitly defines the `EXISTS (... status IN ('scheduled','live') OR is_brand_member(...))` predicate; tester adversarial check probes draft-trip-as-anon → expects empty.
- **P1-3: Publish RPC extension vs fork decision.** Material SPEC choice — extend `business_publish_event_draft` (recommended for Constitution #2 one owner per truth) vs fork to `business_publish_trip_draft`. SPEC must pick + commit.
- **P1-4: `events.theme.business_trip` jsonb vs first-class columns.** SPEC decision for destination + capacity storage. Recommended: theme jsonb (mirror event pattern + zero parent-schema churn).

**P2** —
- **P2-1: Day-by-day editor UX choice.** Cards stacked vs accordion vs single page with collapsible days. Per Tr2 §9-1. Recommend stacked cards with drag-reorder (mirror event date wizard).
- **P2-2: Image upload per day.** Per Tr2 §9-2 — defer to polish. SPEC narrative text only.
- **P2-3: Wizard navigation pattern.** Per Tr2 §9-3 — linear next/back vs step jumper. Recommend linear (mirror event wizard).
- **P2-4: Sidecar `tier_metadata jsonb`.** Currently empty default; Tr3 [Installment Payments] will use it for the installment schedule. Make sure column type is jsonb not text and default `'{}'::jsonb` (Tr2 brief §5 has it correctly).
- **P2-5: Helper function name.** `is_brand_member(brand_id)` cited in Tr2 brief §5 — verify exists via `pg_proc` probe before writing migration; otherwise use `biz_is_brand_member_for_read_for_caller(id)` per Tr1 investigation Section C-3.

**P3** —
- **P3-1: Trip slug uniqueness scope.** Per-brand or global? Mirror event behavior — likely per-brand (slug unique within brand).
- **P3-2: Confirmation email QR code semantics.** For events QR = scan-at-door. For trips QR is less obviously useful (multi-day, no single scan moment). SPEC may want to defer the QR or keep it as a redundant identifier.
- **P3-3: Dashboard Overview "days until departure" computation.** Edge cases at midnight in operator's vs trip's timezone. Use the same timezone helper as event end-not-start parity per ORCH-0850.
- **P3-4: Trip `kind='popup'`/`'physical'` brand restriction.** Per Tr2 §8 hard guard, only `kind='trip_planner'` brands create trips in Tr2 (despite I-1.2-BRAND-AS-CONTAINER allowing any brand to author any offering type). SPEC enforces this at the wizard entry level (UniversalCreatorSheet shows "Create trip" only when current brand kind = 'trip_planner', OR shows it always but routes non-trip-planner brands to an explanation screen). Per operator directive 2026-05-17 (Stripe-first amendment reverted), this gating is INTENTIONAL for the current milestone.

---

## 6. Files SPEC Will Need to Touch

**Database (1 file):**
1. `supabase/migrations/<timestamp>_orch_0859_trip_sidecar_tables.sql` (NEW) — `CREATE TABLE trip_days` + `trip_pricing_tiers` + `trip_inclusions` with RLS + indexes per Tr2 §5.

**Edge functions (1-2 files):**
2. `supabase/functions/_shared/<publish helper>` OR extension of existing publish RPC migration adding trip validation branches.
3. `supabase/functions/ticket-confirmation-dispatch/index.ts` (EDIT) — `event_type='trip'` discriminator branch firing a trip-shaped Resend template.

**Services (2 files NEW):**
4. `mingla-business/src/services/tripsService.ts` (NEW) — CRUD trips + sidecar tables.
5. `mingla-business/src/services/tripCheckoutService.ts` (NEW) — buyer-side checkout wrapper (or just re-export existing checkout service depending on G-2 outcome).

**Hooks (3 files NEW):**
6. `mingla-business/src/hooks/useTrips.ts` (NEW) — React Query trip list + draft mutations.
7. `mingla-business/src/hooks/usePublicTripBySlug.ts` (NEW) — anon-tolerant fetch.
8. `mingla-business/src/hooks/useTripOrders.ts` (NEW) — operator dashboard.

**App routes (4 files NEW):**
9. `mingla-business/app/trip/create.tsx` (NEW) — wizard entry, creates draft + routes.
10. `mingla-business/app/trip/[id]/edit.tsx` (NEW) — wizard host.
11. `mingla-business/app/trip/[id]/index.tsx` (NEW) — operator trip dashboard (Overview + Travelers tabs).
12. `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` (NEW) — public trip detail page (anon-tolerant, mirrors `/e/` pattern).

**Components (9 files NEW):**
13. `mingla-business/src/components/trip/TripCreatorWizard.tsx`
14-18. `TripCreatorStep1Basics.tsx`, `Step2Itinerary.tsx`, `Step3Inclusions.tsx`, `Step4Pricing.tsx`, `Step5Review.tsx`
19. `TripDayEditor.tsx` (used inside Step 2)
20. `TripPreview.tsx` (used in Step 5 + public page — could live in `packages/event-rendering/` if C1 will reuse)
21. `TripCheckoutFlow.tsx` (buyer side — if not just reusing event checkout components)

**Stub removal (2 files):**
22. `mingla-business/src/components/ui/UniversalCreatorSheet.tsx:80` (EDIT) — route Tr2 to `/trip/create`.
23. `mingla-business/app/(tabs)/home.tsx:403` (EDIT) — Tr1 "Plan a trip" CTA route to `/trip/create`.
24. `mingla-business/app/(tabs)/hub/trips.tsx` (EDIT) — wire to real trip list query.
25. `mingla-business/app/trip/coming-soon.tsx` — SPEC decides DELETE vs convert to redirect.

**Tests (5 files NEW per Tr2 §7):**
26. `mingla-business/src/services/__tests__/tripsService.test.ts`
27. `mingla-business/src/services/__tests__/tripCheckoutService.test.ts`
28. `mingla-business/src/hooks/__tests__/useTrips.test.ts`
29. `mingla-business/app/trip/__tests__/trip-create-publish.test.tsx`
30. `mingla-business/app/t/__tests__/public-trip-page.test.tsx`

**Total:** ~30 files (1 migration + 2 edge fn edits + 2 services + 3 hooks + 4 routes + 9 components + 4 stub edits + 5 tests). Largest milestone shipped in this codebase to date.

---

## 7. Recommended SPEC Sequencing (each step independently revertible)

| # | Step | Files | Revert path |
|---|---|---|---|
| 1 | **Migration** — 3 sidecar tables + RLS + indexes | (1) | DROP TABLE on the 3 new tables (no data loss — zero rows yet). |
| 2 | **Service + hook layer** — tripsService + useTrips + usePublicTripBySlug + useTripOrders | (4-8) | Pure new files; delete = revert. |
| 3 | **Wizard skeleton + autosave** — TripCreatorWizard + 5 step components + TripDayEditor | (13-19) | Pure new files. |
| 4 | **Wizard entry route + rewire UniversalCreatorSheet** | (9, 22) | Restore `/trip/coming-soon` route in UniversalCreatorSheet. |
| 5 | **Publish RPC extension** — trip validation branches | (2) | Revert migration restoring event-only behavior. |
| 6 | **Public route + TripPreview** | (12, 20) | Pure new files. |
| 7 | **Buyer checkout reuse** — confirm `/checkout/[eventId]` works for `event_type='trip'`; add trip-shaped tier copy if needed | (5, 21) | Existing `/checkout/` already trip-agnostic per G-1. |
| 8 | **Confirmation email template** | (3) | Restore single template, deploy. |
| 9 | **Operator dashboard** — Overview + Travelers tabs | (11) | Pure new files. |
| 10 | **Hub > Trips wire-up** | (24) | Restore placeholder. |
| 11 | **Home CTA rewire** | (23) | Restore `/trip/coming-soon` route. |
| 12 | **Stripe Connect test-mode probe** (operator + tester verification) — verify $1 test trip charge routes to planner's connected account | — | N/A (verification only). |
| 13 | **Tests** — 5 jest + tester adversarial CI check | (26-30 + new) | Append-only per ORCH-0840 [Regression-test enforcement + append-only CI]. |

---

## 8. Invariants

### Preserved (must not break)

| Invariant | How Tr2 preserves it |
|---|---|
| I-1.2-UNIFIED-EVENT-TYPE | Trips INSERT into `events` with `event_type='trip'` — NOT a separate `trips` table. Hard-guarded by Tr2 §8. |
| I-1.2-BRAND-AS-CONTAINER | Tr2 §8 restricts `trip_planner` brands only IN THIS MILESTONE — UI-layer gate, not capability-layer. Schema still admits trips from any brand. Future ORCH can lift the wizard restriction without DB changes. |
| I-PROPOSED-TR1-PERSONA-INTERFACE | Tr2 does NOT touch PersonaPickerCards. Adversarial check A-07 (ORCH-0855) still passes. |
| I-PROPOSED-TR1-KIND-IMMUTABLE | Tr2 does NOT modify BrandEditView kind editor. Trip-planner brands created via Tr1 wizard remain immutable. |
| Constitution #2 (one owner per truth) | Recommended: extend `business_publish_event_draft` RPC (not fork). One publish authority. |
| Constitution #3 (no silent failures) | Publish validation errors surface to wizard. Stripe Connect routing failure surfaces to operator. |
| Constitution #8 (subtract before adding) | Wizard mirrors event pattern; doesn't duplicate event-create infra. Buyer checkout reuses existing flow. |
| Constitution #9 (no fabricated data) | Anon RLS gates draft trips from public read. Stripe routing verified, not assumed. |
| Constitution #11 (one auth instance) | Public trip route uses no `useAuth`; buyer checkout uses anon-tolerant pattern. |
| `feedback_anon_buyer_routes` | `/t/[brandSlug]/[tripSlug]` lives outside `app/(tabs)/`, no useAuth, no sign-in redirect. |
| `feedback_orchestrator_deploys_edge_functions` | Tr2 touches 1-2 edge fns (`ticket-confirmation-dispatch` + possibly publish-rpc-extension). Operator runs `supabase db push`; orchestrator deploys edge fns post-implementation. |

### New (introduced by Tr2)

| ID | Status | Description |
|---|---|---|
| **I-PROPOSED-TR2-TRIP-SIDECAR-RLS-PUBLISHED-ONLY** | DRAFT — flips ACTIVE on ORCH-0859 CLOSE | Anon SELECT on `trip_days` + `trip_pricing_tiers` + `trip_inclusions` MUST gate on parent `events.status IN ('scheduled','live')` (or brand membership). No draft-trip detail leakage. Enforced by adversarial check probing anon SELECT against a draft trip. |
| **I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING** | DRAFT — flips ACTIVE on ORCH-0859 CLOSE | Trip orders MUST have `transfer_data.destination = <trip-planner-brand's stripe_connect_id>` in the Stripe Session/PaymentIntent. Enforced by tester live-Dashboard probe at CLOSE-time + structural check on Stripe call args. |
| **I-PROPOSED-TR2-UNIFIED-PUBLISH-RPC** | DRAFT — flips ACTIVE on ORCH-0859 CLOSE if SPEC picks "extend RPC" path (recommended) | `business_publish_event_draft` is the single publish authority for `event_type IN ('event','experience','trip')`. No `business_publish_trip_draft` parallel RPC. |

---

## 9. Test Cases (per Tr2 §3 acceptance criteria + new invariants)

Implementor jest + Deno tests (per Tr2 §7) + tester adversarial structural-grep + tester live-fire smoke. Full per-SC matrix to be authored at SPEC time. Key adversarial probes:

| Probe | Asserts | Layer |
|---|---|---|
| Anon SELECT on draft trip's trip_days → empty | RLS published-only gate | DB |
| Anon SELECT on published trip's trip_days → returns rows | RLS allow-anon-on-published | DB |
| Brand member SELECT on draft trip's trip_days → returns rows | brand-member-write fallback | DB |
| Publish event_type='trip' with zero trip_days → expected error | publish validation extension | Edge fn |
| Publish event_type='event' (unchanged) → succeeds | event-path no-regression | Edge fn + Regression |
| `ticket-checkout-create` for trip order → Stripe call carries `transfer_data.destination=<trip-planner-connect-id>` | I-PROPOSED-TR2-STRIPE-CONNECT-TRIP-ROUTING | Edge fn |
| Adversarial: trip-planner brand `kind` toggle in BrandEditView → still absent | I-PROPOSED-TR1-KIND-IMMUTABLE preserved | UI + Regression |
| Adversarial: any `'trip'` literal outside expected Tr2 files | scope-leak guardrail | CI |
| Adversarial: zero `business_publish_trip_draft` references (if SPEC picks extend-RPC path) | one-RPC authority | CI |

---

## 10. Blast Radius

**Direct touch (Tr2 scope):** 3 new sidecar tables + 2 edge fn edits + 2 new services + 3 new hooks + 4 new routes + 9 new components + 4 stub edits + 5 tests. Per §6 above.

**Indirect — verify no downstream consumer breaks:**
- `discover-merged-events` edge fn (consumer app Discover) — must NOT surface `event_type='trip'` events as if they were events. Confirm filter clause (or add one) to exclude trips from the consumer-event-card feed. (C1 ORCH will later add trips to a dedicated Discover sub-tab.)
- `ticketmaster-events` edge fn — independent, no impact.
- `notify-session-match` edge fn (session matching) — independent, no impact.
- `ticket-confirmation-dispatch` — extended with trip branch (Tr2 scope).
- `ticket-pdf-fetch` — fires per ORCH-0842 [Tickets-into-Active + PDF sheet] for paid tickets. For trips, PDF semantics may or may not apply — SPEC must decide if trip orders generate PDFs at all (likely YES for the parallel "ticket" sense, or NO if trips use a different confirmation artifact).
- Consumer Calendar tab (`useCalendarEntries` post-ORCH-0851) — currently shows business event orders. If a consumer buys a trip from the buyer-web flow, does it surface on their Calendar tab? Per Tr2 scope this is C1 work, not Tr2 — but flag for SPEC clarification.
- `mingla-admin` brand list — will surface trip-planner brands with their trips count if the admin dashboard queries `events`. Cosmetic; no Tr2 admin work required.

**Cross-domain:**
- `app-mobile/` (consumer) — Tr2 does NOT modify consumer code. C1 ORCH will surface trips on consumer Discover later.
- `mingla-admin/` — no admin queue / dashboard for trips per DEC-4; Tr2 ships no admin work.
- All RLS — Tr2's 3 new sidecar tables get new policies; `events` RLS unchanged; `ticket_types` RLS unchanged.

---

## 11. Discoveries for Orchestrator

- **DISCOVERY-1 [ORCH-ID correction]:** orchestrator dispatch named Tr2 as `ORCH-0856` but that ID is already taken by the legacy realtime-subscriptions audit follow-up. Use **ORCH-0859** for Tr2. Update WORLD_MAP + MASTER_BUG_LIST + AGENT_HANDOFFS at INTAKE registration.
- **DISCOVERY-2 [PDF fetch semantics for trips]:** ORCH-0842 [Tickets-into-Active + PDF sheet] established that paid orders generate PDFs via `ticket-pdf-fetch`. For trips the per-ticket PDF semantic may not map (no scan-at-door moment). SPEC must explicitly decide: trips generate PDFs (parallels event tickets, used for traveler identification) OR trips do not (use confirmation email instead). Recommend YES for consistency.
- **DISCOVERY-3 [Discover edge fn filter]:** `discover-merged-events` may need an explicit `event_type='event'` filter to exclude trips from the consumer event card feed until C1 ships a dedicated trips sub-tab. Verify at SPEC time + add to scope if needed.
- **DISCOVERY-4 [Helper function name verification]:** Tr2 brief §5 RLS sketch uses `public.is_brand_member(brand_id)`. Tr1 investigation cited `biz_is_brand_member_for_read_for_caller(id)`. SPEC must verify via `pg_proc` probe.
- **DISCOVERY-5 [Trip slug uniqueness scope]:** mirror events (per-brand uniqueness) but confirm via current `events` slug index inspection at SPEC time.
- **DISCOVERY-6 [Trip-planner kind UI gate]:** Tr2 §8 restricts trip wizard entry to `kind='trip_planner'` brands despite I-1.2-BRAND-AS-CONTAINER permitting any brand to author any offering. This is the intentional product-layer narrowing the operator chose in the ORCH-0855 mid-session amendment-reverted discussion. Document explicitly at SPEC time so a future "expand to all kinds" ORCH is a clean amendment, not a surprise change.

---

## 12. Confidence Level

**High (`proven`).** Source-only code audit + live-DB schema probes (events + ticket_types) + grep evidence on existing flow + scan of milestone brief. No UI bug reproducer exists (Tr2 is greenfield) so Prime Directive 7 sim-repro is exempt per dispatch §"Hard guards" code-audit-only. Single uncertainty is the publish-RPC extension architecture choice (D-1 — extend vs fork), which is a SPEC design decision not an investigation gap.

---

## 13. Cross-references

- Milestone brief: `Mingla_Artifacts/milestones/Tr2_MINIMUM_VIABLE_TRIP.md`
- Upstream Tr1 closure: `Mingla_Artifacts/reports/{INVESTIGATION,IMPLEMENTATION,QA}_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING*.md` + `specs/SPEC_ORCH-0855_TR1_TRIP_PLANNER_ONBOARDING.md`
- M0 closure: `reports/QA_ORCH-0826_M0_HUB_FOUNDATION.md` + `specs/SPEC_ORCH-0826_M0_HUB_FOUNDATION.md`
- Project spec: `MINGLA_BUSINESS_1_2_WORKING_DOC.md` §3.3 + §6.2 + §8
- Invariants: `INVARIANT_REGISTRY.md` I-1.2-UNIFIED-EVENT-TYPE + I-1.2-BRAND-AS-CONTAINER + ACTIVE post-ORCH-0855 invariants
- Decisions: `DECISION_LOG.md` DEC-4 + DEC-152 + DEC-160 + DEC-161
- Existing pattern files: event-create wizard in `mingla-business/src/components/event/Creator*.tsx`; public event route `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`; publish RPC migration `supabase/migrations/20260604000001_orch_0824_publish_rpc.sql`; checkout edge fn `supabase/functions/ticket-checkout-create/`; confirmation dispatch `supabase/functions/ticket-confirmation-dispatch/`
- Operator memory: `feedback_anon_buyer_routes.md` (anon route discipline), `feedback_orchestrator_deploys_edge_functions.md` (deploy split), `feedback_strict_grep_registry_pattern.md` (CI gate registration), `feedback_brand_kind_immutable_post_create.md` (Tr1 invariant), `feedback_persona_picker_locked_interface.md` (Tr1 invariant)
