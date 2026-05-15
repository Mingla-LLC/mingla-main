# Mingla Business 1.2 — Working Document

> **Status:** PROJECT-LOCKED, ready for execution. Living document.
> **Last updated:** 2026-05-13 (project lock-in pass — milestone briefs + project spec + handbook all written).
> **Owners:** Seth (operator + product), Taofeek (co-founder, engineer), Claude `mingla-orchestrator` (program), Claude `mingla-forensics` (this doc).
> **Scope:** Mingla Business app extension to support four seller personas (physical venues, popup organizers, trip planners, multi-type hybrids) with a unified offering model, AI-driven content generation, and consumer-side surfacing.
>
> **Companion artifacts:**
> - **Operating manual:** `Mingla_Artifacts/PROJECT_SPEC_MINGLA_BUSINESS_1_2.md` — architecture, pipeline, close protocol, artifact system
> - **Engineering handbook:** `Mingla_Artifacts/MINGLA_ENGINEERING_HANDBOOK.md` — for any engineer outside the Claude/agent pipeline (incl. Taofeek)
> - **Source audit:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`
> - **Per-milestone briefs:** `Mingla_Artifacts/milestones/` (M0 + Tr1-Tr8 + Ve1-Ve7 + C1-C2 = 18 briefs)

---

## 0. Executive Summary

Mingla Business 1.2 transforms the business app from an events-only operator surface into a **multi-offering marketplace engine** capable of hosting four seller personas through one unified architecture. The core insight that makes this tractable: **everything we're building is either a typed extension of an existing system, or a multi-party variant of an existing pattern.** No new payment processor, no new auth model, no new state machine, no new email vendor.

**The four seller personas:**
1. **Physical venues** — restaurants, bars, galleries, studios, arcades. Identity-rich, place-anchored, AI-generates single-intent experiences from menu/activities/schedule snaps.
2. **Popup organizers** — DJs, promoters, comedians, party throwers. Today's default persona, mostly unchanged.
3. **Trip & itinerary planners** — retreat hosts, wine-tour operators, weekend-getaway packagers, bachelorette curators. Multi-day packaged offerings with installment payments, intake forms, and group communication.
4. **Hybrid / multi-type brands** — any brand can grow into any combination of the above (a restaurant that throws events, a trip planner who runs single experiences, a popup organizer who opens a physical location).

**The single unifying data model:** every sellable thing is a row in the existing `events` table with an `event_type` discriminator (`event` / `experience` / `trip`) and type-specific sidecar tables. Tickets, orders, refunds, marketing audiences, scanners — everything flows through one engine. Trips are just events with day-by-day structure, installment-aware tickets, intake-form-aware orders, and an attached multi-party discussion thread.

**The architectural simplification (operator's insight):**
> "A trip is nothing but a complex ticket and a discussion board."

This collapses what would have been a parallel WeTravel-clone build into **typed extensions of the engine that already powers Mingla Business today.**

**Build philosophy:** incremental, end-to-end-testable milestones organized into **three parallel persona tracks** that share one foundation milestone. Each milestone within a track is sequential; tracks run concurrently. Both engineers (operator + co-founder) float across milestones based on weekly capacity — no personal track ownership, no idle time. Each milestone ships independently to TestFlight and delivers real user value standalone.

**Popup events are excluded as a track** — today's popup-organizer event flow is already shipped and sufficient. They benefit indirectly from the unified data model but get no new persona-specific work in 1.2.

**Estimated build:** ~14 weeks wall-clock across 17 milestones in 3 parallel tracks. M0 shared foundation week 1, trip planners (Tr1-Tr8) and physical venues (Ve1-Ve7) run weeks 2-13 in parallel, consumer surfacing (C1-C2) joins mid-cycle and finishes by ~week 14. **5-7x faster wall-clock than a fully sequential plan** because two tracks always run concurrently.

---

## 1. The Unifying Architectural Insight

Everything in Mingla Business 1.2 is a variant of three things already shipped:

| Existing system | What it becomes in 1.2 |
|-----------------|------------------------|
| `brands` (organizer identity, stripe-connected, team-aware, public-page-aware) | Gains `kind='trip_planner'` value, ~6 structured-place columns for physical venues. Stripe Connect inherited unchanged. |
| `events` + ticket types + orders + refund engine (single-event ticketing engine) | Gains `event_type` discriminator (`event` / `experience` / `trip`). Sidecar tables for trip-specific structure. Tickets extended with installment schedules. Orders extended with intake-form data. Refund engine extended with cascading date tiers. |
| Ari's chat infrastructure (`agent_messages`, RLS, OneSignal notifications) | Multi-party fork: `event_threads` + `event_thread_messages` tables. RLS scopes to confirmed buyers + brand members. Same notification pattern. Same Ari summarization potential. |

**There is no parallel WeTravel-clone build.** There is only a careful extension of one engine.

---

## 2. Brand-as-Flexible-Container Principle (Operator Correction, 2026-05-13)

**A brand is a container, not a fixed type.** The persona pick at brand creation is a starting identity that determines initial setup defaults — but **never locks the brand into a single offering type.**

Real-world examples:
- A **popup organizer** ("Late Night Lou's Comedy Shows") may later open a physical comedy club. Their brand grows: `kind` evolves from `popup` → `physical`, structured place data fills in, AI experiences get generated from the club's menu/schedule.
- A **physical restaurant** ("Joe's Pizza") may decide to throw a Halloween party. They create an event under their existing brand using the same event-creation flow popup organizers use today.
- A **trip planner** ("Wandering Soul Retreats") may run a one-off single experience ("yoga in the park, $30, drop-in") between trips. They create an experience under their existing brand.

This means:
- `brands.kind` represents **initial classification + primary identity for public display**, not a capability gate
- **Any brand can author any offering type** at any time
- Multiple offering types coexist under one brand cleanly
- The top-bar "+" creator is universal — operator picks the offering type per creation, not per brand

This principle directly contradicts an earlier framing in the ORCH-0825 audit that suggested persona was a lock-in. **This document supersedes that framing.**

### 2.1 Migration paths (brand grows into a new persona)

Three migration scenarios need clean UX:

1. **Popup → Physical** — operator adds a venue claim to an existing popup brand. UX: an entry in the brand's edit screen "Got a physical location? Add it." → runs the venue claim flow (pool search → comparison or no-match → structured place data + photos + hours) → kicks off admin phone validation. Brand `kind` flips to `physical` after approval.
2. **Physical → Trip planner adjunct** — physical venue starts offering trips. UX: no migration needed — the top-bar "+" lets them create a trip immediately. `brand.kind` stays `physical`; trips coexist alongside their existing physical-venue identity.
3. **Trip planner → Physical** — trip planner opens a physical headquarters. Same as popup → physical migration. Adds venue claim to existing brand.

In all cases, the **single source of truth is the brand**. Offerings (events, experiences, trips) attach to it. The brand's public page renders the union of identities — a Joe's Pizza brand page shows the restaurant identity + a "Upcoming events" section + a "Trips Joe's runs" section if applicable.

---

## 3. Tab Architecture (Updated 2026-05-13)

The business app's bottom navigation evolves from today's 5 tabs to a restructured 5 tabs with the **Hub tab absorbing the current Events tab and becoming the home for all three offering types.**

### 3.1 Current bottom nav (as of ORCH-0815-B, pre-1.2)

```
Home  |  Events  |  Ari  |  Blast  |  Account
```

Source: `mingla-business/app/(tabs)/_layout.tsx:23-39`

### 3.2 New bottom nav (Mingla Business 1.2)

```
Home  |  Hub  |  Ari  |  Blast  |  Account
```

- **Home** — unchanged. Brand selector, hero, KPIs, recent activity.
- **Hub (NEW, replaces Events)** — unified surface for all offerings. Sub-navigation inside Hub:
  - **Events** — today's event list, unchanged
  - **Experiences** — single-intent menu-derived offerings (Restaurant + Play + Creative & Arts)
  - **Trips** — multi-day curated trips
- **Ari** — unchanged. AI assistant.
- **Blast** — unchanged. Marketing Hub composer + audiences.
- **Account** — unchanged. Settings + brand list.

### 3.3 Hub sub-navigation — open polish question

Three patterns possible, decision deferred:

- **A — Hard sub-tabs at the top of Hub** (most explicit, cleanest mental model)
- **B — Filter pills like the existing Events tab** (lighter UX, consistent with current pattern)
- **C — Unified card stream with offering-type badges, filter chips on top** (least disruption, most density)

Operator-acknowledged: "this needs more polish and maybe the grouping is off." Resolution in Phase A SPEC.

### 3.4 Top-bar "+" universal creator (NEW)

The top-bar (`TopBar` component) gains a "+" action button that opens a small sheet with **three options:**

1. **Create event** → existing event-creation flow (today's `/event/create`)
2. **Create experience** → new single-intent experience creation flow (or, when arriving from a menu snap, the AI-review confirmation cards)
3. **Create trip or otherwise** → trip-creation wizard

This is a **universal creator** — visible on Home and Hub at minimum, possibly other surfaces. Operator can create any offering type regardless of how their brand was initialized. Confirms the brand-as-flexible-container principle.

The "+" sheet may grow more options later (Create class, Create tour, Create retreat-package, etc.) — the data model accommodates additive `event_type` values without table-level changes.

---

## 4. End-to-End Workflow

The full lifecycle from brand creation through buyer purchase, across all four personas. Each section flags reuse vs new.

### 4.1 Entry — Brand Creation Sheet

Operator opens existing `BrandSwitcherSheet` (from Home or Account). Single name field. As they type, real-time lookup against `place_pool`.

**File:** `mingla-business/src/components/brand/BrandSwitcherSheet.tsx` (existing, ~446 lines, will gain wizard branches)

### 4.2 Branch on pool match

#### Branch A — Pool match found

Surfaced card: "We found Joe's Pizza, 123 Main St. Is this you?"

- **Yes** → comparison flow fires immediately. We know they're physical, we know their category (via `pg_map_primary_type_to_mingla_category` SQL helper). Persona/category fork is skipped. Wizard prefills.
- **No** → name conflict resolved by slug variant, proceeds as no-match flow.
- **Skip** → no-match flow with their typed name.

#### Branch B — No match

Operator sees three big choice cards: **"What are you starting with on Mingla?"**

- 🏪 **A place** — "I run a venue: restaurant, bar, gallery, studio, arcade, anything with a fixed address"
- 🎉 **An event** — "I throw events: parties, concerts, comedy nights, one-time happenings"
- ✈️ **A trip** — "I plan curated trips and multi-day experiences"

Critical UX note per §2: the choice is **"what are you starting with,"** not **"what are you."** Operators can add other offering types later from the top-bar "+" without changing this initial pick.

### 4.3 Path A — "A place" (physical venue)

Sub-fork: **"What kind of place?"** — three pills with descriptions, **UI copy from consumer preferences sheet** (per operator directive — reuse exact component or close visual replica):

- **Restaurant**
- **Play** (bowling, arcade, escape room, mini-golf, sport, etc.)
- **Creative & Arts** (gallery, studio, dance school, pottery, music venue, etc.)

Wizard (single autosaved screen, multi-step):

| Step | Field | Source | Status |
|------|-------|--------|--------|
| 1 | Address | Google Places autocomplete | Reuses `googlePlacesService.ts` (existing, ORCH-0824) |
| 2 | Name + slug | Prefilled if pool match, blank otherwise | Existing `createBrand` service |
| 3 | Photos (1-6) | Image picker + crop | Reuses `brand_covers` bucket + upload pipeline (ORCH-0805) |
| 4 | Hours of operation | Structured weekly schedule | **NEW** `brand_hours` sidecar table |
| 5 | Contact info | Phone, email, website, socials | Existing `brands.custom_links` JSONB |
| 6 | Description | Short intro paragraph | Existing `brands.description` |
| 7 | **Snap your menu / activities / schedule** | Category-specific image upload | **NEW** AI parser pipeline |

Submit → admin review queue in `mingla-admin` → admin phone callback to Google-listed number → 4-hour SLA, business-hours-aware → approve / reject.

After approval:
- Public brand page at `/b/{slug}` goes live with full structured listing
- AI parses the snap (Gemini, structured output, Ari pattern) → generates 8-15 candidate single-intent experiences
- Operator reviews each in the Hub > Experiences sub-tab as a confirmation card (accept / edit / reject) — same pattern as Ari today
- Approved experiences become `events` rows with `event_type='experience'`, owned by the venue brand
- Experiences surface in consumer Discover and feed Mingla's internal multi-stop composer

### 4.4 Path B — "An event" (popup organizer, today's flow)

Wizard:
1. Brand name + slug
2. Cover image
3. Stripe Connect onboarding — optional now, required before publishing paid event

Lands on Home, "+ Create event" CTA active, existing event-creation wizard takes over (`/event/create` → `/event/{id}/edit?step=0`). `brand.kind = 'popup'`, no venue identity, no place data.

**This persona is largely unchanged from today.** The 1.2 work for popup organizers is: the new top-bar "+" lets them also create experiences and trips without changing their brand kind.

### 4.5 Path C — "A trip" (trip planner)

Brand creation:
1. Brand name + slug ("Wandering Soul Retreats")
2. Bio — who you are, what kind of trips you build (becomes the planner's about-page content)
3. Cover image
4. **Stripe Connect — REQUIRED here, not optional.** Trips collect deposits + installments; planner can't proceed past brand creation without it. Stripe Connect doubles as identity proof — no admin phone-callback needed since they're not claiming a Google-registered storefront.
5. Optional: snap any past brochures / itineraries so we have starting templates for future trips

Lands on Home, "+ Create trip" CTA active.

### 4.6 Trip-creation wizard (11 steps, autosaved)

Lives at `/trip/create` and `/trip/{id}/edit?step=N` — parallels the event-creation wizard pattern.

**Step 1 — Basics**
- Title ("Tulum Yoga Retreat — March 2026")
- Dates (start, end — multi-day flag auto-set)
- Destination (Google Places — city, country, lat/lng captured)
- Capacity (8-30 typical, hard max 100 for Phase 1 small-group focus)

**Step 2 — Itinerary** (AI moment)
- Option A: "Got an existing itinerary brochure? Snap it." → image/PDF upload → Gemini parses → returns structured day-by-day → operator reviews each day as confirmation card
- Option B: "Build it day by day" → manual entry: per-day title, narrative, time slots, mapped locations (each location can autocomplete from `place_pool` to enrich with Mingla venue data when stops happen to be Mingla-known places)

**Step 3 — Inclusions & exclusions**
- Checkbox + custom items
- Example: "Included: lodging, all meals, yoga classes, airport transfer. Not included: flights, alcohol, optional excursions."

**Step 4 — Pricing tiers**
- Base price (e.g., $1,800 double-occupancy)
- Additional tiers (single supplement +$400, early-bird -$200 before Jan 15)
- Each tier is essentially a ticket type — reuses existing `ticket_types` model with `pricing_tier_metadata` JSONB extension

**Step 5 — Payment plan**
- Full payment now / installments
- If installments: deposit % + N additional payments + due dates ("25% deposit on booking, 50% at 60 days out, balance at 30 days out")
- Stored as ticket-type-level `installment_schedule` JSONB

**Step 6 — Booking deadline**
- Cutoff date (no bookings after)
- Optional auto-cancel-if-min-capacity-not-met logic

**Step 7 — Refund policy**
- Cascading date tiers ("100% refund before X, 50% before Y, 0% after Z")
- Template defaults: "standard / strict / flexible" presets
- Custom override allowed

**Step 8 — Traveler intake form**
- Schema builder — drag-drop questions: short text, long text, single-choice, multi-choice, file upload, date, phone
- Required vs optional per field
- Template defaults: passport number, dietary, emergency contact, room-share preference, T-shirt size
- Stored as JSON schema on the trip; rendered dynamically at buyer checkout

**Step 9 — Group thread settings**
- Auto-create discussion thread for confirmed travelers (default ON)
- Posting permissions: everyone / planner broadcast only / disabled

**Step 10 — Pre-trip documents** (optional)
- Upload PDFs to share with confirmed travelers (waiver, packing list, visa info)
- Set "shared on booking" vs "shared X days before trip"

**Step 11 — Review & publish**
- Full preview as buyer will see it
- Publish → trip live → shareable link generated at `/t/{brandSlug}/{tripSlug}`
- Marketing nudge: "Blast your past trip-takers about this new trip?" → routes to Marketing Hub composer with auto-built audience

### 4.7 Buyer journey for trips

Consumer side, anonymous-tolerant route at `/t/{brandSlug}/{tripSlug}`:

1. Buyer discovers trip via consumer Discover (Trips tab) OR shareable link
2. Trip detail page renders: hero photos + dates + day-by-day itinerary + inclusions + pricing tiers + booking deadline + planner attribution
3. "Reserve my spot" → checkout flow
4. **Pricing tier picker** (same pattern as ticket types today)
5. **Buyer info** — standard fields (name, email, phone) PLUS the trip's custom intake form rendered dynamically from the JSON schema
6. **Room-share opt-in** if applicable
7. **Payment** — Stripe PaymentSheet captures deposit + saves card; installment schedule displayed inline ("$450 now, $900 on Jan 15, $450 on Feb 15")
8. **Confirmation** — order created, payment scheduled, traveler auto-added to group thread, confirmation email + first pre-trip documents shared per planner's schedule

### 4.8 Operator dashboard for an active trip

Trip detail page at `/trip/{id}` (parallels today's event detail page at `/event/{id}`):

- **Overview** — confirmed travelers vs capacity, total revenue, next installment-collection date, days-until-departure
- **Travelers** — per-row: name, intake-form completeness, installment status, room-share match. Tap → full intake responses + payment history
- **Discussion** — group thread UI. Planner posts announcements, shares updates. Travelers post questions. Document attachments. Ari summarization on request.
- **Money** — deposits collected, upcoming installments per traveler, refunded amounts, payouts to Stripe Connect
- **Manage** — edit itinerary (notifies travelers), cancel trip (triggers refund cascade), close bookings early
- **Marketing** — blast confirmed travelers (urgent updates) or blast past trip-takers about future trips (Marketing Hub integration)

### 4.9 Money lifecycle (installments + refunds)

- **Booking:** Stripe captures deposit immediately + saves payment method (SetupIntent attached to PaymentIntent or Stripe Subscription Schedule)
- **Installment N (scheduled):** cron job + edge function fires next PaymentIntent per installment schedule
- **Failed installment:** existing dunning email pattern from ORCH-0785 fires; 7-day grace period; planner notified; if still fails, booking moves to "at-risk" status
- **Cancellation:** refund engine reads cascading policy, computes refund based on what's been collected, fires partial/full refund via Stripe (existing `refund-order` edge function from ORCH-0787, extended with installment-aware refund math)

**Stripe does the heavy lifting.** Mingla wraps it in a tidy schema and timeline UI.

### 4.10 The discussion board

For each `events` row (any `event_type`), an optional `event_thread` exists:

- One thread per event/trip
- RLS: only confirmed buyers + brand members can read/write
- Optional "broadcast-only" mode (only brand members post; everyone reads)
- Messages: author, body, optional attachments (Supabase Storage bucket with RLS)
- OneSignal notifications on new messages (existing pipeline)
- Optional Ari integration: "Ari, summarize the last 50 messages" or "Ari, who hasn't filled in their passport info yet"

Threading not required for v1 — flat message list is sufficient. Polish in later phase.

### 4.11 Consumer surfacing

Discover side gets:

- **Main feed (existing)** — venue cards + event cards + Mingla-composed multi-stop curated cards (built from approved single-intent experiences across venues). Attribution chips for venue-authored content.
- **New Trips tab** — trip cards as their own surface. Filterable by city, dates, price range, group size, intent (yoga / food / culture / adventure / etc.)
- Pairing engine adds three new content sources, uses same intent-matching scoring

---

## 5. Data Model Summary (Reuse vs New)

| Already shipped | Extended in 1.2 | Net new for 1.2 |
|---|---|---|
| `brands` + `kind` discriminator | Adds `kind='trip_planner'` value + structured place columns (`place_pool_id`, `google_place_id`, `lat`, `lng`, `city`, `country_code`, `claim_status`, `verified_at`) for physical | `brand_hours` sidecar table |
| Brand creation sheet | Adds persona fork on no-match, real-time `place_pool` lookup | Category pills component (copy from consumer prefs sheet) |
| Stripe Connect on brands | No change | — |
| `events` table | Adds `event_type` discriminator (`event` / `experience` / `trip`) | `trip_days`, `trip_pricing_tiers`, `trip_intake_schema`, `trip_installment_plan`, `trip_refund_policy`, `trip_inclusions` sidecar tables |
| Ticket types | Adds `installment_schedule` JSONB | — |
| Orders | Adds `intake_form_data` JSONB, `room_share_preference` JSONB | `order_installments` ledger table |
| Refund engine (ORCH-0787) | Extended with cascading date-tier policy | — |
| Resend email pipeline (ORCH-0785) | New templates: trip-booked, installment-due, installment-failed, document-shared, thread-message-digest | — |
| Marketing Hub audiences | New audience kind: `trip_alumni` (per `marketing_audiences` CHECK constraint additive extension) | — |
| Ari chat infrastructure (`agent_messages`) | Multi-party variant pattern | `event_threads`, `event_thread_messages` tables |
| Storage buckets | — | `trip_documents` bucket with RLS scoped to thread participants |
| Consumer Discover | Adds Trips tab + trip-card rendering, attribution chips | — |
| Public routes (`/b/`, `/e/`) | — | `/t/{brandSlug}/{tripSlug}` for trip detail |
| Google Places autocomplete (ORCH-0824) | Reused as-is for itinerary location capture | — |
| `BrandSwitcherSheet` | Wizard extension + persona fork | Top-bar "+" universal creator sheet |
| Events tab | Becomes Hub tab with sub-navigation | Hub > Experiences sub-tab, Hub > Trips sub-tab |

**No new authentication. No new payment processor. No new email vendor. No new image pipeline. No new RLS pattern.** Every piece is a typed extension of running production infrastructure.

---

## 6. Project Timeline — 3 Parallel Tracks, ~14 Weeks Wall-Clock

### 6.0 Principles

1. **Three persona tracks run in parallel after one shared foundation milestone.** No sequential persona ordering — Trip planners (Tr) and Physical venues (Ve) build concurrently after M0. Consumer surfacing (C) joins mid-cycle when its dependencies land.
2. **Popup events are NOT a track.** Today's event flow is already shipped and sufficient. Popup organizers benefit indirectly from the shared data model but get no persona-specific work in 1.2.
3. **Floating milestone ownership — no personal track lock.** Both engineers float across milestones based on weekly capacity. If one engineer has a light week, they pull the next available milestone from any track that's ready. If one has a heavy week elsewhere, the other carries more. Track ownership is fluid; the milestone is the unit of work.
4. **Sequential within tracks, parallel between tracks.** Tr2 doesn't start until Tr1 is in TestFlight. Ve2 doesn't start until Ve1 is in TestFlight. But Tr2 and Ve3 can run in the same week.
5. **Each milestone is end-to-end testable.** A real user can complete a real task in a real session at the end of every milestone. No half-built features.
6. **Each milestone ships to TestFlight independently.** EAS Update at the end of every milestone — no long-running feature branches.
7. **Definition of Done per milestone** = code merged on `Seth` branch + TestFlight build pushed + smoke test passed end-to-end by a human.

### 6.1 Shared Foundation (M0 — both engineers, before any track starts)

#### M0 — Hub Tab + Universal Creator + Unified Data Model (1 week)

**User outcome:** today's events users see the same content under the new Hub tab. Nothing breaks. The new "+" sheet shows three options. Only "Create event" creates anything for now; the other two stub to "Coming soon." Underneath, the database now supports tagging any event as `event` / `experience` / `trip` so Tr and Ve tracks can write their own types from day one.

**Smoke test:** Open the app, tap Hub in the bottom bar, see today's events listed. Tap the "+" at the top, see three options. Tap Create event, end up in the same event creation flow as today. Try the other two options, see friendly "Coming soon" screens. Underneath, run a SQL probe confirming `events.event_type` column exists with `event` default backfilled to all existing rows.

**Work in M0 (both engineers together):**
- Rename Events tab → Hub tab; add Events / Experiences / Trips sub-tabs (Events shows today's content; other two are empty placeholders)
- Top-bar universal "+" creator sheet with three options
- Migration: `events.event_type` discriminator column (values `event` / `experience` / `trip`), backfill existing rows to `event`, sidecar table scaffolding ready for Tr and Ve to populate
- Brand creation persona fork stub (three cards visible but only "An event" works for now)

**Done when:** TestFlight build live with Hub tab + universal creator + data model migration applied to remote DB. Existing operators see no regressions.

---

### 6.2 Track 1 — Trip Planners (Tr1-Tr8, ~12 weeks within the track)

The trip planner track. Sequential within the track. Runs in parallel with Track 2 starting week 2.

**Track 1 builds these shared infrastructure pieces that Track 2 also benefits from (free upgrades):** the `events.event_type='trip'` extension pattern, installment payment engine, refund tier engine, intake form schema, discussion board tables, document storage RLS pattern.

#### Tr1 — Trip Planner Brand Onboarding (1 week)

**User outcome:** A trip planner downloads the app, signs in, picks "A trip" from the persona cards, enters brand name + bio + cover image, completes Stripe Connect, and lands on Home with a "Plan a trip" button waiting. They're a recognized seller. They can't make a trip yet but they exist.

**Smoke test:** Fresh install. Sign in with a new account. Open BrandSwitcherSheet, tap "A trip" persona card. Enter brand name + bio + upload cover image. Get routed to Stripe Connect onboarding, complete the Stripe paperwork. Come back to Mingla, land on Home with "Plan a trip" CTA visible. Run a DB probe confirming brand exists with `kind='trip_planner'` and Stripe Connect attached.

**Files:** `BrandSwitcherSheet.tsx`, new wizard component, `brandsService.ts`, migration adding `'trip_planner'` to `brands.kind` CHECK.

#### Tr2 — Minimum Viable Trip (2 weeks)

**User outcome:** A trip planner publishes a real trip — title, dates, destination, manual day-by-day itinerary, what's included, capacity, single full-price ticket. They share the link with a friend. Friend taps it, sees the trip, taps "Reserve my spot," fills in name/email/phone, pays via Apple Pay or card, gets a confirmation email, appears in the planner's traveler list. **First revenue event in Mingla Business 1.2.**

**Smoke test:** Tap "Plan a trip." Walk through 5 wizard steps (basics → itinerary → inclusions → price → review). Publish. Copy share link. Open on a second phone signed out. Reserve a spot, fill the form, pay $50 in Stripe test mode. Land on confirmation. Back on planner's phone, refresh dashboard — see the new traveler. Both phones receive the right emails.

**Files:** Trip wizard component, public route `/t/[brandSlug]/[tripSlug].tsx`, buyer checkout, migrations for `trip_days` + `trip_pricing_tiers` + `trip_inclusions` sidecars.

#### Tr3 — Installment Payments (2 weeks)

#### Tr3 — Installment Payments (2 weeks)

**User outcome:** Trip planner sets "$300 deposit + 2 more installments of $400 each at 30 days and 60 days." Buyer at checkout sees the full schedule plainly. Deposit charges now. Future installments auto-charge per schedule. Failed installments fire dunning emails. **First WeTravel-parity feature.**

**Smoke test:** Create a trip with a 3-payment installment plan. Buyer pays deposit on day 1. Use Stripe's test clock to fast-forward 30 days — confirm second installment auto-charges successfully. Use a card that fails on charge #3 — confirm dunning email fires and the booking flips to "at risk" status. Planner manually retries the failed installment from dashboard with a fresh card — confirm it succeeds.

**Files:** Wizard payment-plan step, buyer checkout schedule display, operator Money tab. Migrations: `ticket_types.installment_schedule jsonb` + `order_installments` ledger. Edge function: scheduled payment runner + cron.

#### Tr4 — Refund Tiers + Booking Deadline (1 week)

**User outcome:** Trip planner picks a refund policy from three templates (flexible / standard / strict) or builds custom cascading tiers. Bookings auto-close at the cutoff date. If a buyer cancels, Mingla automatically calculates the correct refund based on what they've paid and when they cancelled.

**Smoke test:** Create a trip with "100% refund before 60 days, 50% before 30, none after" + a booking cutoff date. Book the trip. Cancel as buyer at three time points (before 60, between 60-30, after 30) — verify each refund amount matches policy. Try booking after the cutoff — confirm the button is disabled with "Bookings closed" message. Verify the cron auto-closes bookings at midnight on cutoff.

**Files:** Wizard refund-policy + deadline steps, buyer cancel flow, operator refund actions. Edge function: extend `refund-order` with cascading logic + booking-deadline cron.

#### Tr5 — Traveler Intake Forms (1.5 weeks)

**User outcome:** Trip planner builds a custom intake form (passport number, dietary, emergency contact, T-shirt size, room-share preference) using a drag-drop question builder. Buyer fills it at checkout. Planner sees all answers neatly per traveler in dashboard. **Second WeTravel-parity feature.**

**Smoke test:** Build a trip with 5 custom questions including a file upload (passport photo) and multi-choice (dietary). Book the trip as buyer, fill all 5 questions, upload a passport photo. Planner opens Travelers tab — sees all answers cleanly displayed including the photo. Try booking without filling required questions — confirm form blocks submission with clear error messages.

**Files:** Schema-builder UI in wizard, dynamic form rendering at buyer checkout, operator Travelers tab. Migrations: `trip_intake_schema` JSONB on trips, `orders.intake_form_data` JSONB.

#### Tr6 — Discussion Board / Group Chat (2 weeks)

**User outcome:** After a buyer books, they auto-join a per-trip group chat with the planner and everyone else on the trip. Planner posts updates ("flight info attached"). Travelers ask questions. Push notifications fire. PDFs attach. Planner can optionally lock posting to broadcast-only. **Third WeTravel-parity feature.**

**Smoke test:** Two travelers book the same trip. Both auto-added to the trip chat. Planner posts a message with a PDF attachment. Both travelers receive a push notification, open the app, see the message + download the PDF. Reply from one traveler appears for everyone. Flip chat to broadcast-only — confirm travelers can no longer post but can still read. Try reading another trip's chat as an unconfirmed user — confirm RLS blocks it.

**Files:** Operator Discussion + Documents tabs, buyer-side group chat UI, OneSignal fan-out. Migrations: `event_threads` + `event_thread_messages` tables, `trip_documents` storage bucket with RLS.

#### Tr7 — Room-Share Matching (1 week)

**User outcome:** Buyers opt into room-share at checkout. Planner sees opted-in pool and manually pairs travelers ("Sarah + Jen share a queen"). When planner confirms a pair, both travelers get a notification with their roommate's name and pricing recalculates to remove the single supplement.

**Smoke test:** Two travelers book the same trip, both opt into room-share with compatible preferences. Planner sees both in Room-Share tab. Tap "Pair these two." Both travelers' pricing drops by the single-supplement amount. Both get notifications telling them who they're roomed with. One traveler unpairs — confirm pricing reverts and the other is notified.

**Files:** Buyer opt-in UI at checkout, operator matching dashboard, pricing recalc edge function. Migration: `orders.room_share_preference jsonb`.

#### Tr8 — AI Itinerary Scaffolding (1.5 weeks)

**User outcome:** Instead of typing the day-by-day from scratch, planner photographs or uploads their existing brochure / Google Doc / PDF. AI reads it and generates a structured day-by-day. Planner reviews each day as a confirmation card ("Day 1: Arrive Tulum, welcome dinner at Hartwood at 7pm — accept / edit / reject"). Way faster than typing 7 days manually.

**Smoke test:** Upload a real brochure PDF for an existing trip. Confirm AI returns the right number of days with sensible titles + narratives. Edit one day's narrative inline. Reject one day. Accept the rest. Trip publishes with the AI-derived itinerary populated correctly. Verify `agent_pending_actions` is used for review state per `I-ARI-CONFIRM-AUTHORITY`.

**Files:** Snap-input UI in Tr2 wizard step 2, per-day confirmation cards. Edge function: Gemini parser with structured JSON output.

**🎯 Track 1 complete at Tr8.** Trip planners have full WeTravel parity + AI shortcut WeTravel doesn't offer.

---

### 6.3 Track 2 — Physical Venues (Ve1-Ve7, ~7 weeks within the track)

The physical venue track. Sequential within the track. Runs in parallel with Track 1 starting week 2. **Ve5-Ve7 (AI experience generation) write `events.event_type='experience'` rows; the discriminator column ships in M0 so no cross-track dependency exists.**

#### Ve1 — Physical Venue Brand Onboarding (1.5 weeks)

**User outcome:** Restaurant owner downloads the app, signs in, types their business name into the BrandSwitcherSheet. If we don't recognize them (no `place_pool` match yet — that's Ve2), they pick "A place" → category pills (Restaurant / Play / Creative & Arts) copied from the consumer preferences sheet → walk through wizard capturing photos, hours, contact, description. Submit lands in admin queue.

**Smoke test:** Search for a fake venue not in our database. Pick "A place" → "Restaurant" category pill. Walk through wizard: upload 3 photos, set Mon-Sat 11am-10pm hours, enter contact info, write description. Submit. Confirm submission appears in `mingla-admin` admin queue with all data populated and a 4-hour countdown. Verify brand row has `kind='physical'`, `claim_status='pending_review'`, and is not publicly visible yet.

**Files:** BrandSwitcherSheet extension, category pills component, hours editor, photo uploader. Migrations: structured place columns on `brands` (`place_pool_id`, `google_place_id`, `lat`, `lng`, `city`, `country_code`, `claim_status`, `verified_at`), new `brand_hours` sidecar.

#### Ve2 — Pool Match Comparison Flow (1 week)

**User outcome:** When the operator types a name that matches a venue we have in our `place_pool` database, a comparison card fires immediately ("We have Joe's Pizza at 123 Main St — is this you?"). Tap Yes and the wizard prefills every field with our Google-seeded data; they just accept or replace each field rather than typing from scratch.

**Smoke test:** Search for a known seeded venue (use an actual `place_pool` row by its Google Place ID). Confirm the comparison card surfaces with prefilled name + address + city. Tap "Yes, this is me." Confirm the wizard renders with all fields prefilled. Walk through accepting some fields and editing others. Submit. Verify the brand row has `place_pool_id` correctly linked and inherits Google's `google_place_id`, `lat`, `lng`.

**Files:** Real-time pool lookup in BrandSwitcherSheet, comparison wizard UI. Edge function: `claim-search-pool` (Google Places + `place_pool` lookup).

#### Ve3 — Admin Queue + Verification Workflow (1 week)

**User outcome:** Operator (you) opens the admin queue in `mingla-admin`, sees pending claims with the Google-listed phone number ready to dial, calls the venue, asks if they signed up, and taps Approve or Reject. Decision flows back to the submission instantly. Rejection flags the signup for follow-up.

**Smoke test:** With at least one pending claim in the queue, open `mingla-admin`. Verify the row shows venue name, address, Google-listed phone number, submission age. Tap Approve. Confirm `claim_status` flips to `verified` and `verified_at` is timestamped. Tap Reject on a different claim. Confirm rejection email fires. Try approving without operator auth — confirm RLS blocks it.

**Files:** Admin queue route in `mingla-admin`. Approval/rejection edge function. Resend email templates: claim approved + claim rejected.

#### Ve4 — Public Venue Page + Verified Badge (1 week)

**User outcome:** Approved venue's public Mingla page at `/b/joes-pizza` goes live with photos, address, hours, category, and a small "Verified" badge. Anyone can visit without signing in.

**Smoke test:** Open `/b/joes-pizza` on a second device signed out of any account. Confirm the listing renders with photos, structured address, weekly hours, category, verified badge. Try visiting a `claim_status='pending_review'` venue's page — confirm it returns the unverified state. Confirm the new `claimed_venues_public_view` surfaces verified venues even without any associated event (key fix from the audit's brand-public-view limitation).

**Files:** Public brand page extensions, verified badge UI. Migration: new `claimed_venues_public_view`.

#### Ve5 — Menu AI Parser → Restaurant Experiences (1.5 weeks)

**User outcome:** Restaurant owner photographs their menu inside the business app. AI parses it and generates 8-15 candidate single-intent experiences ("Bottomless brunch Saturdays," "Date-night tasting menu for $75/head," "Group dinner under $50/head"). Owner reviews each as a confirmation card. Approved experiences become real cards attached to their venue.

**Smoke test:** Photograph a real menu (brunch + dinner + drinks). Confirm AI returns sensible experiences with category-fitting titles, narratives, and price ranges. Edit one inline. Reject two. Accept 6. Open Hub → Experiences sub-tab and see all 6 approved experiences listed. Verify each is stored as `events` row with `event_type='experience'` and correct `brand_id`.

**Files:** Menu snap-input UI, review confirmation cards in Hub → Experiences. Edge function: Gemini menu parser with restaurant-specific structured output schema.

#### Ve6 — Activities AI Parser → Play Experiences (1 week)

**User outcome:** A bowling alley, arcade, escape room, or mini-golf venue photographs their activities/packages list. AI generates Play-category experiences ("Lane + pitcher of beer for 4," "Friday arcade tournament," "Escape room booking — 1 hour, 6 people max"). Same review flow as menu.

**Smoke test:** Photograph a real activities/packages list. Confirm AI generates Play-shaped experiences. Review, accept some, reject others. Verify approved experiences live as `events.event_type='experience'` with appropriate intent tags ("friends_chill", "group_activity").

**Files:** Activities snap-input UI + clone of menu parser pattern. Edge function: Gemini activities parser.

#### Ve7 — Schedule AI Parser → Creative & Arts Experiences (1 week)

**User outcome:** An art gallery, pottery studio, dance school, or music venue photographs their class schedule or exhibition flyer. AI generates Creative & Arts experiences ("Beginner pottery — Saturdays 2pm $45," "Current exhibition: 'Light & Form' through March 15," "Salsa lessons Wednesdays 7pm").

**Smoke test:** Photograph a real schedule or flyer. Confirm AI generates Creative & Arts experiences with correct timing + recurrence + pricing. Review, accept, verify presence in Hub → Experiences.

**Files:** Schedule snap-input UI + clone of menu parser pattern. Edge function: Gemini schedule parser.

**🎯 Track 2 complete at Ve7.** Physical venues fully usable end-to-end across all three categories.

---

### 6.4 Track 3 — Consumer Surfacing (C1-C2, ~4 weeks total)

The consumer-side track. Has explicit dependencies on Track 1 and Track 2 milestones; can start mid-cycle as dependencies land.

#### C1 — Consumer Discover Trips Tab (1.5 weeks)

**Dependency:** Tr2 must be in TestFlight (real published trips need to exist).

**User outcome:** A consumer opens the Mingla consumer app, navigates to Discover, sees a new Trips tab. Real trips appear as cards, filterable by city, dates, price, group size. Tap → trip detail page → book.

**Smoke test:** Open the consumer app as a fresh user. Navigate to Discover → Trips tab. See real published trips sorted by relevance. Apply city filter (e.g., "Tulum") — only Tulum trips remain. Apply price filter ($500-$2000) — only matching trips. Tap a trip → land on trip page → reserve a spot → complete checkout end-to-end.

**Files:** New Trips tab UI in `app-mobile/`, trip card component, filter chips. Consumer-side trip fetch service.

#### C2 — Mingla Multi-Stop Composer + Experience Surfacing (2.5 weeks)

**Dependency:** Ve7 must be in TestFlight (approved venue experiences need to exist for the composer to weave).

**User outcome:** Consumer with "date night" intent sees a multi-stop curated card in the main Discover feed showing real venues woven into a coherent evening ("Saturday afternoon: brunch at Joe's → coffee at Bean Lab → bookshop stroll at Whitman's"). Each card shows "By [Venue]" attribution. Consumer can report a listing they think is fake; it lands in your admin queue.

**Smoke test:** Open consumer app with "date night" preferences. See a multi-stop curated card chaining real venues. Verify attribution chips show correct names. Verify chained venues are geographically close (under 15-min walk), hours-overlap during the intended time, price-tier coherent. Tap "Report this listing" — confirm it creates an admin queue row. Try a "solo treat" intent — see different cards composed.

**Files:** Main Discover feed updates in `app-mobile/`, attribution chips, report-listing UI. Edge function: pairing engine extension consuming `events.event_type='experience'` rows + composition rules.

**🎯 Track 3 complete at C2.** Mingla Business 1.2 fully shipped.

---

### 6.5 Wall-Clock Timeline (Parallel Tracks Visualized)

```
Week    1   2   3   4   5   6   7   8   9   10  11  12  13  14
        ─────────────────────────────────────────────────────────
M0      ███
Track 1     Tr1 Tr2 Tr2 Tr3 Tr3 Tr4 Tr5 Tr5 Tr6 Tr6 Tr7 Tr8 Tr8
Track 2     Ve1 Ve1 Ve2 Ve3 Ve4 Ve5 Ve5 Ve6 Ve7
Track 3                                     C1  C1  C2  C2  C2
                                       (C1 starts after Tr2 lands;
                                        C2 starts after Ve7 lands)
```

Total wall-clock: ~14 weeks. Track 1 (Trips) sets the long pole at 12 weeks; Track 2 (Venues) finishes around week 10 freeing capacity to start Track 3 milestones whose dependencies have landed.

### 6.6 Milestone Summary Table

| Milestone | Track | Duration | Earliest start | Outcome |
|-----------|-------|---------:|----------------|---------|
| M0 | Shared | 1w | Week 1 | Hub tab + universal creator + data model migration |
| Tr1 | Trips | 1w | Week 2 (after M0) | Trip planner brand onboarding |
| Tr2 | Trips | 2w | After Tr1 | First paying trip booking |
| Tr3 | Trips | 2w | After Tr2 | Installments work |
| Tr4 | Trips | 1w | After Tr3 | Refund tiers + booking deadline |
| Tr5 | Trips | 1.5w | After Tr4 | Custom intake forms |
| Tr6 | Trips | 2w | After Tr5 | Group chat + documents |
| Tr7 | Trips | 1w | After Tr6 | Room-share matching |
| Tr8 | Trips | 1.5w | After Tr7 | AI itinerary scaffolding |
| Ve1 | Venues | 1.5w | Week 2 (after M0) | Venue brand onboarding |
| Ve2 | Venues | 1w | After Ve1 | Pool match comparison |
| Ve3 | Venues | 1w | After Ve2 | Admin queue + verification |
| Ve4 | Venues | 1w | After Ve3 | Public venue page + badge |
| Ve5 | Venues | 1.5w | After Ve4 | Menu AI → Restaurant experiences |
| Ve6 | Venues | 1w | After Ve5 | Activities AI → Play experiences |
| Ve7 | Venues | 1w | After Ve6 | Schedule AI → Creative & Arts experiences |
| C1 | Consumer | 1.5w | After Tr2 lands | Discover Trips tab |
| C2 | Consumer | 2.5w | After Ve7 lands | Multi-stop composer + main feed |

### 6.7 Fluid Milestone Ownership Model

**Both engineers float across milestones based on weekly capacity.** No personal track lock. The model:

1. At the start of each week, both engineers look at the active tracks and decide which milestone they'll own that week
2. Whichever engineer has more capacity that week pulls the next-available milestone from any track that's ready
3. Within a milestone, the engineer who owns it builds both the UI and the backend (full-stack ownership per milestone)
4. If a milestone is sized larger than one engineer's weekly capacity, the second engineer can split it into UI + backend halves and ship together
5. End-of-week sync: 30 minutes to merge work + run smoke test + decide next week's assignments

**Why fluid > fixed:** real life intrudes. Sick weeks, family commitments, parallel obligations. Fluid ownership absorbs these without stalling the project. Cost is slightly more context-switching; milestones are sized 1-2 weeks so re-onboarding is cheap.

**Pre-condition for fluid ownership to work:** every SPEC must be detailed enough that either engineer can pick up the milestone cold from the SPEC alone, without needing the other's tribal knowledge. Hard requirement on forensics during SPEC writing.

### 6.8 Why Parallel Tracks Beat Sequential

A purely sequential 17-milestone plan (M0 → Tr1 → Tr2 → ... → Ve7 → C1 → C2) would take ~22 weeks wall-clock. By running Tr and Ve tracks concurrently after M0, **we cut to ~14 weeks** — the slower of the two tracks (Trips at 12 weeks) sets the bottom limit, and consumer surfacing overlaps with the tail of Track 1 because its dependencies (Tr2 + Ve7) land mid-cycle.

**Single-engineer fallback:** if one engineer drops out mid-project, the timeline reverts to ~22 weeks sequential. The plan tolerates this without redesign — only the wall-clock changes, not the milestone structure.

---

## 7. Open Polish Items

Items operator flagged as "needs more polish, grouping may be off" — to resolve during Phase A SPEC or as standalone follow-ups.

### 7.1 Hub sub-navigation pattern

Three candidates: hard sub-tabs vs filter pills vs unified-stream-with-badges. Decision deferred to Phase A SPEC. Likely informed by operator's UI/UX skill (`mingla-designer` or `ui-ux-pro-max`).

### 7.2 Top-bar "+" discoverability

Currently the only universal creator entry point. Question: does the existing Home tab "+ Build event" CTA stay (as a redundant shortcut), or do we consolidate exclusively to the top-bar "+"? Same question for the existing Events tab "+" FAB.

### 7.3 Brand-kind migration UX

Operator changes from popup → physical (adds venue claim). The migration flow needs clean affordances inside the existing brand edit screen. Specifically: where does the "Got a physical location? Add it." entry live, and how does the admin re-validation work?

### 7.4 Cross-offering navigation from a brand's public page

Joe's Pizza's public `/b/joes-pizza` page should show: brand identity (photos, hours, address, vibe), upcoming events, single-intent experiences, current trips. Layout / hierarchy / which-comes-first is a design question.

### 7.5 Trips tab UX in consumer Discover

Independent tab vs filter pills inside the main Discover stream. Operator picked dedicated tab during brainstorm (2026-05-13) but visual treatment is open.

### 7.6 The "+ Create trip or otherwise" label

Operator phrasing during brainstorm hinted at an "or otherwise" — possibly a placeholder for future offering types (class, retreat-package, tour, etc.). Decision: do we ship with three fixed options or build a registry-driven creator from day one?

### 7.7 Persona-pick copy in brand creation no-match flow

"What are you starting with on Mingla?" with three cards (a place / an event / a trip) is the working framing. UI/UX skill input on:
- Whether to show three cards or a list
- Icons and color treatment
- Whether to include a fourth "I'm not sure / skip" option
- Whether to allow multi-select (claim physical AND trip-planner at once)

---

## 8. Decisions Already Locked (Operator-Confirmed)

These are no longer in question. Phase A SPEC and downstream phases must respect them.

1. **Unified data model** — single `events` table with `event_type` discriminator, type-specific sidecar tables. NOT a parallel trips table.
2. **Stripe Connect required for trip planners at brand creation** — replaces admin phone-callback as identity proof.
3. **Stripe Connect deferred for popup organizers and physical venues** — today's behavior preserved; required only before publishing a paid event.
4. **Admin phone-callback validation for physical venues** — 4-hour SLA, business-hours-aware, no softer fallback in app copy.
5. **Duplicate physical-venue claims** — both queued, admin arbitrates during the verification call.
6. **Off-pool physical-venue signups allowed** — blank wizard; admin Google-Maps-lookup before calling.
7. **Brand-as-flexible-container principle** — any brand can author any offering type; `kind` is starting identity, not capability gate.
8. **Hub tab replaces Events tab** — sub-tabs for Events / Experiences / Trips inside Hub.
9. **Top-bar "+" universal creator** — three options (event / experience / trip or otherwise).
10. **AI parsers — four total** (menu / activities / schedule / trip brochure), all using Ari's existing confirmation-card pattern.
11. **Operator review every AI candidate** before publish — no auto-publish of generated experiences.
12. **Multi-stop curated experiences are Mingla-composed**, not operator-authored. No partner-invite UI for venues. Operators just want customers.
13. **Trips appear in dedicated Trips tab in consumer Discover** — separate from main event/venue stream.
14. **Full WeTravel parity from day 1** (installments + intake + group chat + document sharing + room-share + refund tiers) — sub-phased across B.2 + B.3 for safety.
15. **Small-group focus** — 8-30 travelers per trip, hard max 100. Not enterprise.
16. **Group chat = discussion board pattern** — multi-party extension of Ari's `agent_messages` infrastructure. Flat message list for v1.

---

## 9. Status and Next Action

**Current status:** brainstorm-locked, timeline committed. Pre-SPEC.

**WeTravel competitive research — COMPLETE (2026-05-13).** Artifact at `Mingla_Artifacts/reports/RESEARCH_ORCH-0825_WETRAVEL_COMPETITIVE_INGEST.md` — 2,400 lines, 23 sections, with confidence labels and cited sources. Headline findings: WeTravel has no cascading-tier refund engine (Tr4 win), no group chat (Tr6 win), no room-share matching algorithm (Tr7 win), and no mobile app for operators (whole-project win). Six Open Questions in §21 surface before Tr3-Tr7 SPECs fire (currency at checkout, ask-a-question lead capture, traveler-to-traveler DMs, own-Stripe option, Tr8 prompt-based AI, Ve experiences refund-tier extension). Tr3-Tr7 milestone briefs now mandate reading this research before SPEC dispatch.

**Immediate next action: M0 INVESTIGATE.** Dispatch Claude `mingla-forensics` (INVESTIGATE mode) for M0 (Hub Tab Foundation + Universal Creator + Unified Data Model). Produces `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0826_M0_HUB_FOUNDATION.md`. The dispatch prompt lives at `Mingla_Artifacts/prompts/FORENSICS_ORCH-0826_M0_HUB_FOUNDATION_INVESTIGATE.md`.

**Forward sequence:**
1. M0 INVESTIGATE → SPEC → IMPLEMENT (Seth + Taofeek) → TEST → CLOSE (~1 week)
2. After M0 ships to TestFlight, dispatch Tr1 + Ve1 SPECs in parallel (one for each engineer)
3. WeTravel research is required reading for Tr3+ SPECs (already mandated in those briefs)
4. Open Questions §21 surface to operator before Tr3 SPEC fires (orchestrator queues)

**Working tree throughout:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`.

**SPEC dispatch cadence:** one SPEC per milestone, dispatched after the prior milestone ships. SPECs include explicit Stream A vs Stream B file partitioning so two engineers can work in parallel without merge conflicts. This is a hard requirement for every SPEC in this project — forensics must call out the partition explicitly.

---

## 10. Document Conventions

- This is a **living document.** As architectural decisions evolve, this file gets updated by the orchestrator or forensics skill before Phase A SPEC fires.
- After Phase A SPEC fires, this document remains the canonical reference for Mingla Business 1.2 scope; SPECs reference back to it.
- Cross-references in this doc to ORCH-IDs (ORCH-0785, ORCH-0787, etc.) are to the production-shipped CLOSE notes in `Mingla_Artifacts/CLOSE_NOTE_ORCH-XXXX.md`.
- Cross-references to the audit are to `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0825_BUSINESS_APP_VENUE_CLAIM_INTEGRATION_AUDIT.md`.
- VS-Code-rendering-safe CommonMark only (no emoji-only headings, no extended Markdown).

---

## 11. Acknowledgments

- **Operator (Seth)** for the two unifying insights that compressed scope:
  - "These are nothing but complex tickets and a discussion board" (2026-05-13 brainstorm)
  - "A popup brand may have a physical store later, a physical place may throw events, and a trip planner may throw events" (2026-05-13 correction — brand-as-flexible-container)
- **Audit precedent:** the ORCH-0825 audit established that the brand schema already encodes venue-vs-organizer semantics via `kind='physical'|'popup'`, which made the unified data model feasible.
- **Memory anchors:** `feedback_mingla_positioning.md`, `feedback_anon_buyer_routes.md`, `feedback_ai_categories_decommissioned.md`, `feedback_verify_db_column_names_before_writing_queries.md`, `project_marketing_hub_strategy.md`.

---

*End of document. Update timestamp at top of file when revising.*
