# INVESTIGATION — ORCH-0963 [Public brand page business-case optimization (events vs. trip brands)]

**Skill:** Claude `mingla-forensics` (INVESTIGATE phase)
**Date:** 2026-05-25
**Worktree:** `~/Desktop/mingla-orchs/ORCH-0963-[public-brand-page-events-vs-trip]/` on branch `ORCH-0963-public-brand-page-events-vs-trip`
**Affected Surfaces:** buyer-web (`mingla-business/app/b/[brandSlug]/index.tsx` + `mingla-business/src/components/brand/PublicBrandPage.tsx`)
**Confidence overall:** F-1 **probable** (live-fire blocked by Supabase 401 anti-headless behavior — see D-1), F-2/F-3/F-4/F-5/F-6/F-7 **proven** from source + schema + DB data.

---

## 1. Executive Summary

The public brand page at `/b/{slug}` renders the same Upcoming/Past/About event-shaped chrome for every brand regardless of `brands.kind`. The product is now in a state where three brand kinds (`physical`, `popup`, `trip_planner`) share one IA designed exclusively for ticketed events.

The trip-planner gap is a **known TODO**. ORCH-0859 REWORK 3 left an explicit comment in `publicEventsService.ts:691`: *"Trips get their own surfaces on the brand page (not yet implemented)."* The events list filter actively rejects `event_type='trip'` rows from `/b/{slug}` (lines 692-707), so today a trip-planner brand with 32 trip drafts and 2 public-published trips (`travelbrand`: "The Sone" in Tulum + "The DC Adventure" in Washington DC) shows zero items under Upcoming and zero under Past — even though those trips are fully published, anon-readable, and live at `/t/travelbrand/{tripSlug}`.

On the event-brand side, the layout is functional but de-prioritizes the buyer's primary action. Avatar + bio + social icons + stats card consume the first ~600px before the buyer sees a single event card or ticket CTA. For a brand whose primary call-to-action is "buy a ticket to the next event," tickets are below the fold.

The fix is information-architecture, not visual polish. Branch the page model on `brands.kind` at the route level, keep the shared chrome (cover, identity column, share, About tab), and replace the middle section with a kind-aware content body:

- `kind ∈ {physical, popup}` (event brands): tickets-CTA-first Upcoming-events feed.
- `kind = 'trip_planner'`: trip-card discovery feed with capacity-honest spots-left and a "View trip" CTA leading to `/t/{brandSlug}/{tripSlug}`.

Spec direction outlined in §6 below. Three open questions surfaced for Seth before SPEC dispatch.

---

## 2. Phase 0 Ingest Log

| Source | Read | Result |
|--------|------|--------|
| `mingla-business/app/b/[brandSlug]/index.tsx` | full file (83 lines) | Routes to `PublicBrandPage` after `usePublicBrandBySlug` resolves; loading/error/null states render generic copy. No kind awareness. |
| `mingla-business/src/components/brand/PublicBrandPage.tsx` | full file (1117 lines) | Implements 3 tabs hard-coded for `LiveEvent[]`. One `brand.kind === "physical"` guard (line 220) for address suppression. No trip data path. |
| `mingla-business/src/hooks/usePublicEvents.ts` | full file (78 lines) | React Query hook calling `getPublicBrandBySlug` from service. Returns `PublicBrandDetail` = `{ brand, events, venue }`. No trip field. |
| `mingla-business/src/services/publicEventsService.ts` | targeted ranges (1-450, 670-840) | `getPublicBrandBySlug` resolves brand from `claimed_venues_public_view` (verified-venue path) or `business_public_brands_view` (generic path); `fetchPublicBrandEvents` filters out `event_type='trip'` rows with explicit comment "*not yet implemented*" (line 691). |
| `mingla-business/src/services/tripsService.ts` | range 1-180 | Defines `Trip` type with `days`, `pricingTiers`, `inclusions`, `businessTrip.{startAt,endAt,destinationText,capacity}`, `ticketsSoldCount`, `refundPolicy`, `bookingDeadline`, `bookingsClosed`. |
| `mingla-business/src/types/brand.ts:186-199` | targeted | Canonical `Brand.kind: 'physical' \| 'popup' \| 'trip_planner'`; lines 186-191 codify immutability for trip-planner per ORCH-0855 DEC-161. |
| `mingla-business/src/store/currentBrandStore.ts:44` | targeted | Comment confirms v10 kind union; nothing kind-aware in the persist layer. |
| `supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql:18` | targeted | Original `kind` constraint `('physical', 'popup')` default `'popup'`. |
| `supabase/migrations/20260607000000_orch_0855_brands_kind_trip_planner.sql:28` | targeted | Constraint extended to include `'trip_planner'` per ORCH-0855. **Authoritative latest definition.** |
| `supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql` | full file | `business_public_brands_view` definition: `SELECT … FROM brands WHERE deleted_at IS NULL` — **no kind filter**. Granted to `anon`. |
| `supabase/migrations/20260622000000_ve4_claimed_venues_public_view.sql` | partial | Verified-venue view filters `kind = 'physical'` (4 occurrences). |
| `supabase/migrations/20260617000000_orch_0879_anon_brand_cover_grant.sql` | partial | Comments confirm `business_public_brands_view` is the canonical /b/{slug} brand-read source post-ORCH-0767. |
| `Mingla_Artifacts/WORLD_MAP.md` ORCH-0859 close note 2026-05-17 23:30Z | targeted | Codifies `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` invariant (DRAFT → ACTIVE on close). The trip-rejection probe in `fetchPublicBrandEvents` IS this invariant in code form. |
| `Mingla_Artifacts/WORLD_MAP.md` ORCH-0855 + ORCH-0917 entries | targeted | Trip-planner is first-class; future Tr7 [Room-Share Matching] extends trip business but does not change `/b/{slug}` IA. |
| Memory `[[persona-picker-locked-interface]]` + `[[brand-kind-immutable-post-create]]` | acknowledged | Confirms branching on `brands.kind` is safe — no runtime migration. |
| Live DB (Supabase Mgmt API, read-only) | 5 queries | 16 active brands: 3 `physical`, 10 `popup`, 3 `trip_planner`. `travelbrand` has 32 trips total / 2 public + 0 non-trip events. `leggothis` has 11 public events. No `public_trips` view exists; trip-only resolver is per-row by `tripEventId`. |
| Adjacent worktree `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/` | dir listing only | Title suggests audit of brand-edit→public render — overlap risk flagged in §5. |

---

## 3. Five-Truth-Layer Cross-Check

| Layer | What it says | Contradiction with other layers? |
|-------|--------------|----------------------------------|
| **Docs** (Cycle 7 spec header lines 1-41 of `PublicBrandPage.tsx`) | Brand page is "the IG-bio-link surface" with 3 tabs (Upcoming/Past/About). Constitutional rules: no fake counts, no Follow CTA, no rating, no blue check. Honest popup vs physical address handling. **No mention of trip-planner.** | Stale relative to schema. The doc was written before ORCH-0855 added `trip_planner`. |
| **Schema** (`brands.kind` CHECK + views) | `brands.kind ∈ {'physical', 'popup', 'trip_planner'}`. `business_public_brands_view` returns all kinds. Trip rows live in `events` with `event_type='trip'` and are anon-readable when `visibility='public'` + `status ∈ {scheduled,live,ended,cancelled}` (events RLS policy "Public can read published events"). `trips_*` sidecar tables exist. No public `trips_by_brand` view. | None at the schema layer — schema fully supports the trip-planner kind. |
| **Code** (`PublicBrandPage` + `publicEventsService`) | Page renders single layout for all kinds. `BusinessPublicBrandViewRow.kind` TS type narrowed to `"physical" \| "popup"` (line 104) — **stale type, lies about runtime data**. Service `fetchPublicBrandEvents` filters trip rows out with comment "*not yet implemented*". No trip-by-brand read path; `getPublicTripById` resolves a single trip by `tripEventId`. | Contradicts schema layer (TS type misses 'trip_planner'). Contradicts product intent (trip brands have no buyer-discoverable trips on `/b/{slug}`). |
| **Runtime** (probe attempt 2026-05-25, see evidence/) | Playwright headless with chromium-1223 hit Supabase 401 on all 3 probed slugs — `Brand could not load` error state from `PublicBrandRoute:42-49`. Live-fire DID NOT successfully observe rendered Upcoming/Past behavior on prod. Confidence on F-1 downgraded to **probable** per Prime Directive #7. Source/schema confidence remains **proven**. | Inconclusive at the runtime layer for THIS investigation. The 401 itself is a separate Discovery (D-1). |
| **Data** (Mgmt API SELECTs) | `travelbrand` (trip_planner): 32 trips, 2 public-scheduled (`the-sone`, `the-dc-adventure`), 0 non-trip events. `leggothis` (popup): 11 public events. `perryssteakhousegrille` (physical): 0 public events. | Confirms a real trip-planner brand has zero visible content under the current `/b/{slug}` IA despite 2 published trips — the symptom is real, not hypothetical. |

**Cross-layer verdict:** Docs and code lag the schema by one major step (ORCH-0855/0859). The trip-planner kind exists in the database, has live data, has a single-trip public route at `/t/{brandSlug}/{tripSlug}`, but does not have a brand-level discovery surface. That's the structural gap.

---

## 4. Findings

### 🔴 F-1 — Trip-planner brand `/b/{slug}` page surfaces zero trips under Upcoming and Past tabs. **probable**

| Field | Value |
|-------|-------|
| File + line | `mingla-business/src/services/publicEventsService.ts:686-707` |
| Exact code | `const tripIds = new Set(((typesResp.data ?? []) as ...).filter((r) => r.event_type === "trip").map((r) => r.id)); rows = rawRows.filter((r) => !tripIds.has(r.id));` |
| What it does | After fetching candidate event rows for a brand from `business_public_events_view`, makes a second probe to `events.event_type` and removes any row where `event_type='trip'`. Returns event-only array to the page. |
| What it should do (today) | Today's filter is correct per `I-PROPOSED-TR2-ROUTE-BY-EVENT-TYPE` — `/e/{brandSlug}/{eventSlug}` is for events, `/t/{brandSlug}/{tripSlug}` is for trips, neither URL should resolve the other. **But there is no companion trip-fetch path for `/b/{slug}`**, so trip-planner brands lose their entire content surface. The fix is additive: keep the event filter, add a parallel trip fetch, render kind-appropriate content. |
| Causal chain | `usePublicBrandBySlug('travelbrand')` → `getPublicBrandBySlug` → resolves brand row (kind='trip_planner') + calls `fetchPublicBrandEvents` → filter strips all 2 public trips → returns `events: []` → `PublicBrandPage` receives empty array → `upcomingEvents.length === 0` and `pastEvents.length === 0` → Upcoming tab renders "No upcoming events yet" → Past tab renders "No past events to show" → buyer sees no trip discovery, even though `/t/travelbrand/the-sone` and `/t/travelbrand/the-dc-adventure` are live and anon-readable. |
| Verification | Source-only (proven). Live-fire blocked by Supabase 401 in headless Playwright (D-1). To confirm visually, Seth opens `https://business.usemingla.com/b/travelbrand` in Safari/Chrome with a normal session and reports the rendered state. The source path proves the outcome regardless of the runtime check. |

### 🔴 F-2 — Brand-kind divergence inventory: 11 event-specific assumptions in `PublicBrandPage` with no trip-planner equivalent. **proven**

`PublicBrandPage.tsx` has hard-coded event-shape assumptions in 11 places. Each becomes a divergence point in the kind-branched redesign:

| # | Location | Today (events-only) | Trip-planner equivalent | Event-brand evolution |
|---|----------|---------------------|-------------------------|------------------------|
| 1 | line 124 `useState<Tab>("upcoming")` | Tabs `'upcoming' \| 'past' \| 'about'` | Likely `'trips' \| 'past-trips' \| 'about'` OR drop tabs entirely (trip-planners typically have 2-5 trips/year — flat list beats tabs) | Keep 3-tab model; consider moving tab strip ABOVE the stats card so tickets are above the fold |
| 2 | line 134-138 `pageTitle` | `${brand.displayName} · ${venue.city} on Mingla` OR `${brand.displayName} on Mingla` | `${brand.displayName} · trips on Mingla` (or destination-based) | unchanged |
| 3 | line 139-144 `metaDescription` | bio / tagline / venue-city fallback | bio / tagline / "Trips by {brand}" fallback | unchanged |
| 4 | line 151-158 `upcomingEvents` memo | Filters `LiveEvent[]` by `!isEventPast(e) && status!=='cancelled'`, sorts ascending by `date` | Needs `upcomingTrips` filter: `trip.status='scheduled'` + `businessTrip.startAt > now` + `!trip.bookingsClosed`, sort by `startAt` ascending | unchanged |
| 5 | line 162-170 `pastEvents` memo + `PAST_EVENT_CAP=10` | Filters past events, sorts descending, caps at 10 | `pastTrips`: completed (`status='ended'`) trips sorted desc + same cap | unchanged |
| 6 | line 218-224 `showLocation` + `identitySubline` | `brand.kind === 'physical' && address` | For `trip_planner`: probably show "Trip planner · {primary destination}" — derived from most-recent trip's `destinationText`, or just suppress | unchanged |
| 7 | line 398-415 stats card with "EVENTS" label | Shows `publicEventCount` only | Shows `publicTripCount` with label "TRIPS"; OR adds row 2 "TRAVELLERS" derived from `SUM(ticketsSoldCount)` if Seth wants social-proof | Consider adding "FROM {minPrice}" stat if all upcoming events share a near-floor price |
| 8 | line 419-435 TabButton row | 3 buttons, count badges on Upcoming + Past | "Trips" / "Past trips" / "About" labels | unchanged |
| 9 | line 439-451 tab-body switch | Renders `UpcomingTab` / `PastTab` / `AboutTab` | Needs `TripsTab` / `PastTripsTab` / `AboutTab` (About is shared) | Within `UpcomingTab`: change EventMiniCard layout to push ticket-CTA more prominently (currently it's a flat card; consider sticky bottom "From $X • View tickets" pill on the first 3 cards) |
| 10 | line 712-780 `EventMiniCard` | Renders `EventCoverMedia + dateLine + name + venueName + minPrice` | New `TripMiniCard`: `coverMedia + destinationText + dateRange + spotsLeft (capacity-honest) + minPrice + bookingsClosed badge if true` | Add "Last few tickets" / "Selling fast" / "Free" pill on EventMiniCard when capacity ≥X% sold; pull from existing ticket data (no new server work) |
| 11 | line 783-788 `formatStatNumber` + the entire `Stats` card placement | Currently sits BELOW identity + bio + socials (~600px scroll depth) | For trips: stats card might pin "From {minPrice}" + "Next trip {date}" — but only ONE useful stat needed (trip count is already in the Trips tab badge) | For events: move stats card or merge stat row INTO the identity column to lift tabs above the fold; OR replace stats card with a "Next: {nextEvent.name} on {date} · From {price} →" hero strip that links to the first upcoming event |

### 🔴 F-3 — Brand-kind type lie in `BusinessPublicBrandViewRow`. **proven**

| Field | Value |
|-------|-------|
| File + line | `mingla-business/src/services/publicEventsService.ts:104` |
| Exact code | `kind: "physical" \| "popup";` |
| What it does | Declares the row from `business_public_brands_view` as having only two kind values. |
| What it should do | Match the schema constraint (`'physical' \| 'popup' \| 'trip_planner'` per migration `20260607000000`). Today the runtime row CAN return `'trip_planner'` (3 such brands in prod), but TypeScript narrows it away. The downstream mapper (`publicBrandViewRowToBrand`, line 321: `kind: row.kind`) widens it into a `Brand` whose canonical type DOES allow 'trip_planner', so runtime works by luck — but anyone refactoring or grepping for kind-handling code is misled. |
| Causal chain | If a future change adds a narrow conditional `if (row.kind === 'physical') {...} else {...}` and treats the else-branch as `'popup'`, trip-planner brands fall into the wrong branch silently. The current page does exactly this at line 220 (`brand.kind === "physical"` else falls through) — currently safe because the consequence is "suppress address line" (true for popup AND trip_planner), but it's structurally fragile. |
| Verification | Migration chain confirmed authoritative at `20260607000000_orch_0855_brands_kind_trip_planner.sql:28` — constraint includes 3 values. `Brand.kind` in `mingla-business/src/types/brand.ts:199` matches schema. Only `BusinessPublicBrandViewRow.kind` lags. |

### 🔴 F-4 — No public-trips-by-brand read path exists today. **proven**

| Field | Value |
|-------|-------|
| File + line | `mingla-business/src/services/publicEventsService.ts:791-` (`getPublicTripById`, single-trip resolver) |
| Exact code | Single-trip resolver pinned `.eq("id", tripEventId).eq("event_type", "trip")`. No `getPublicTripsByBrandSlug` companion. |
| What it does | Provides per-trip resolution only. A brand-page-level "give me this brand's public trips" query would require either (a) a new SECURITY-DEFINER RPC `pg_public_trips_by_brand(brand_slug TEXT)` or (b) a new view `public_trips_by_brand_view` or (c) a direct client-side `events` query with `eq('brand_id', brand.id).eq('event_type', 'trip').eq('visibility', 'public').in('status', ['scheduled','live','ended','cancelled'])`. |
| What it should do | Provide a public-readable bulk-by-brand trip read path that returns trip rows with the minimum fields needed to render trip cards: `id, slug, title, destination_text, cover_media_url, cover_media_type, status, visibility, businessTrip.start_at, businessTrip.end_at, businessTrip.capacity, tickets_sold_count, bookings_closed, min_price_cents (derived)`. Decision-grade trade-off goes in SPEC. |
| Causal chain | F-1 is unfixable without F-4. Even if the page branches on kind, there is no data path to populate the Trips tab. |
| Verification | Grep across `mingla-business/src/services/` returns only `getPublicTripById` and `tripsService.ts` (organiser-side CRUD). The Mgmt API confirmed the trip data is anon-readable in principle via the `events` RLS policy "Public can read published events (anon or authenticated)" — but no aggregator exists. |

### 🟠 F-5 — Event-brand IA pushes tickets below the fold. **proven** (contributing factor for the operator's stated business-case complaint)

| Field | Value |
|-------|-------|
| File + line | `mingla-business/src/components/brand/PublicBrandPage.tsx:330-461` (scroll body order) |
| Exact code | Order: cover hero (180px) → floating chrome (overlay) → identity column (avatar + name + verified badge + subline) → bio (≤540px max-width) → social icons row → venue card (verified physical only) → stats card → tab strip → tab body. |
| What it does | First 600-700px of vertical real estate is brand identity + bio + socials + stats. The Tickets/Upcoming list begins at row 7. On a 414×896 mobile viewport (iPhone XR/15 baseline), only the cover + name + half the bio is above the fold; the first event card requires a scroll. |
| What it should do (SPEC-direction) | Promote the next-upcoming-event teaser ABOVE the bio for event-brands: 1-line "**Next event:** Friday — {name} · From £{price} →" link strip directly under the avatar. The "stats card" with single "EVENTS: N" is low-information — consider replacing with this teaser strip OR eliminating outright. Keep About-tab content the same. |
| Causal chain | The operator's INTAKE described the gap as "events need upcoming-event list + ticket CTAs front-and-center." Today the upcoming-event list IS rendered, but it's the bottom of the page. Tickets compete with social icons + bio + stats for first-impression real estate. |
| Verification | The brand-detail screenshot path documented in ORCH-0859 REWORK 5b (operator pixel-reviewed screenshot 21-PUBLIC-BRAND-PAGE.png) is the historical baseline. The current production layout has not changed since 2026-05-17. |

### 🟡 F-6 — SEO/share contract has no trip-aware variants. **proven**

| Field | Value |
|-------|-------|
| File + line | `PublicBrandPage.tsx:230-267` (Head metadata block) + `mingla-business/src/constants/publicUrls.ts:71-83` (tripPublicPath/Url helpers) |
| Exact code | OG title hard-codes brand display name; OG description falls back to bio/tagline; canonical URL is `brandPublicUrl(brand.slug)` regardless of kind. |
| What it does | Search/share previews are kind-agnostic. A trip-planner brand share-card looks identical to an event-brand share-card. |
| What it should do (SPEC-direction) | For trip-planner brands, the OG description could surface a value-prop like "Multi-day trips by {brand}" or pull the next-trip destination. OG image stays per-brand. Operator decides SPEC scope — easy add now, low payoff today (small share volume). |
| Verification | Source confirms; runtime probe was blocked by D-1 but the bundled Head logic runs only on Platform.OS==='web' and does not branch on kind. |

### 🔵 F-7 — Consumer app (`app-mobile/`) does NOT consume `/b/{slug}` directly. **proven**

| Field | Value |
|-------|-------|
| File + line | grep across `app-mobile/src/` and `app-mobile/app/` for `business.usemingla.com/b\|/b/\${\|brandPublicPath\|brandPublicUrl` |
| Exact code | No hits in app-mobile. The consumer app has its own brand-discovery surfaces (not the `/b/{slug}` route). |
| What it does | Confirms ORCH-0963 is **single-surface** (buyer-web only). No iOS/Android consumer parity needed. Confirms the INTAKE Affected-Surfaces declaration. |
| What it should do | Stay buyer-web-scoped. |
| Verification | grep result + the dispatch surfaces declaration. |

---

## 5. Blast Radius

| Layer | Impact |
|-------|--------|
| Database | Likely new view OR RPC for public-trips-by-brand. No table changes. No constraint changes. |
| RLS | The existing events RLS policy "Public can read published events (anon or authenticated)" already permits the read. New view/RPC either inherits (view) or runs SECURITY DEFINER (RPC). Decision in SPEC. |
| Edge functions | None expected — read path is pure Supabase from client. |
| Service layer | `mingla-business/src/services/publicEventsService.ts` — add `getPublicTripsByBrandSlug` companion; widen `BusinessPublicBrandViewRow.kind` union (F-3 fix). |
| Hook layer | `mingla-business/src/hooks/usePublicEvents.ts` — either extend `usePublicBrandBySlug` return shape OR add a new `usePublicTripsForBrand` hook. Query key factory needs a new branch (e.g., `publicEventKeys.tripsForBrandSlug(slug)`). |
| Component layer | `PublicBrandPage.tsx` — fork OR branch. Two viable shapes (SPEC decides): (a) keep one component, take a discriminated-union prop, render kind-aware body; (b) split into `PublicEventBrandPage` + `PublicTripBrandPage` sharing a common `<PublicBrandShell>` (cover + identity + share + About). Either way, new `TripMiniCard`. |
| Tests | New tests for trip-brand render (empty trips state, populated trips state, mixed if applicable). Adversarial: trip-planner with zero trips, trip-planner with bookings_closed trips, trip-planner with mixed scheduled/ended trips. |
| SEO/share (F-6) | Minor metadata branching if SPEC includes. |
| Strict-grep | New invariant gate `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` proposed: prevents future code from referencing `events` for trip-planner brands or `trips` for event brands in the public-render path. |
| Cross-ORCH | **ORCH-0962** [brand-edit public render audit] (parallel worktree `~/Desktop/mingla-orchs/ORCH-0962-[brand-edit-public-render-audit]/`) likely touches similar territory. Recommend writing a COMMS-LEDGER entry once we lock SPEC scope, so ORCH-0962 doesn't ship a conflicting public-render assumption. **ORCH-0917** [Tr7 Room-Share Matching] depends on this — once trips are surfaced on `/b/{slug}`, the room-share opt-in path could surface a CTA on the trip card; out of scope here, captured as a downstream beneficiary. |

---

## 6. Recommended SPEC Scope Boundaries

**In scope for ORCH-0963 SPEC:**

1. Kind-aware IA at `/b/{slug}` with two render variants:
   - `physical | popup` (event-brand): retain 3-tab Upcoming/Past/About; **promote next-upcoming-event teaser strip above bio** (F-5); replace stats card with the teaser OR demote it; consider sticky "Buy tickets" pill on the first 3 upcoming-event cards.
   - `trip_planner` (trip-brand): 3-tab Trips/Past Trips/About; new `TripMiniCard` showing cover + destination + date range + spots-left + price-from + bookings-closed badge; "View trip" CTA links to `/t/{brandSlug}/{tripSlug}`.
2. New public-trips-by-brand read path (view OR RPC — decide in SPEC §3).
3. Fix F-3 type narrowing on `BusinessPublicBrandViewRow.kind`.
4. New invariant `I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED` + strict-grep gate.
5. Constitutional compliance per kind (every Cycle 7 §12 rule still holds: no fake counts, no Follow CTA, no rating, no blue check, no fabricated dates/prices, honest spots-left via existing `biz_trip_tickets_sold` per `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE`).
6. Regression tests: implementor happy-path + tester adversarial, fails-on-revert verified, per Step 0.5 gate.

**Out of scope for ORCH-0963 SPEC (named):**

- Consumer app deeplink behavior — no `/b/{slug}` mobile surface (F-7).
- Trip-creation flow — organiser-only, separate ORCH territory.
- Paid-trip checkout polish — owned by checkout-trip ORCHs.
- Multi-kind brand support (hybrid event+trip brands) — `brands.kind` is immutable and single-valued per ORCH-0855 DEC-161; not a real product surface today.
- Search/SEO trip-aware OG image dynamic rendering (F-6) — defer to follow-up unless SPEC review elects to include.
- ORCH-0962 [brand-edit public render audit] overlap — handle via COMMS-LEDGER coordination, not absorption.

---

## 7. Open Questions for Seth (before SPEC dispatch)

1. **Component-fork vs single-component-branched.** Two viable architectures:
   - **Option A (one component, kind prop-branched):** `PublicBrandPage` takes `{ brand, events, trips, venue }` with one of `events`/`trips` empty per kind. Smaller diff, easier to keep About-tab and chrome in lockstep, but ~150 lines of `brand.kind === 'trip_planner' ? ...` conditionals.
   - **Option B (split into `PublicEventBrandPage` + `PublicTripBrandPage` over shared `<PublicBrandShell>`):** Clean separation, easier to evolve each kind independently, but doubles the test surface for the shared chrome.

2. **Event-brand IA polish in this ORCH or a follow-up?** F-5 (push tickets above the fold via next-event teaser strip + sticky CTA on first 3 cards) is well-scoped but not strictly required to add the trip-planner variant. Two paths:
   - **Bundle (current INTAKE direction "Both sides equally"):** ship F-5 inside ORCH-0963. Bigger PR but lands a complete kind-aware redesign in one cycle.
   - **Defer event-brand polish to ORCH-0963-B:** ship trip-planner variant first (smaller, focused), then ship event-brand IA improvements in a follow-up. Tighter PR, faster ship, but two ORCHs to close.

3. **Public-trips read path: view vs RPC.**
   - **View (`public_trips_by_brand_view`):** simpler, reuses existing events RLS policy. Limit: filtering "this brand's public trips with min price" inside a view requires joining `events + trip_pricing_tiers` (already used in the organiser path). Doable.
   - **SECURITY DEFINER RPC (`pg_public_trips_by_brand(p_brand_slug TEXT)`):** explicit input contract, easier to evolve, can pre-aggregate `min_price_cents` + `tickets_sold_count` + `spots_left` server-side. Mirrors the `biz_trip_tickets_sold` pattern from ORCH-0947.

---

## 8. Discoveries for Orchestrator

### D-1 — POTENTIAL P0: Headless Supabase 401 on production buyer-web SPA

- **Symptom:** Playwright (chromium-1223, mobile UA, clean context) consistently received `401` from Supabase on the bundled REST calls for ALL 3 probed brand slugs (`travelbrand`, `leggothis`, `perryssteakhousegrille`) on `https://business.usemingla.com/b/{slug}`. Page rendered the `PublicBrandRoute:42-49` error state: "Brand could not load — Refresh this page or try the link again."
- **Console excerpt (sanitized):** `Failed to load resource: the server responded with a status of 401 ()` (×2 per probe).
- **Possible causes:**
  - (a) Probe-context artifact: the SPA bundle expects a localStorage-bootstrapped anon token; clean context never had it. Real users on returning visits never hit this.
  - (b) Bundled anon key has rotated/expired and a stale build is still serving.
  - (c) Vercel edge or Supabase rate limiter blocking Playwright UA / fingerprint.
- **Action requested:** Seth opens `https://business.usemingla.com/b/travelbrand` and `https://business.usemingla.com/b/leggothis` in his normal Safari + Chrome (incognito + non-incognito) and reports: does the page render brand + tabs, or the "Brand could not load" error? If error in incognito Chrome → P0, file as new ORCH. If renders fine → close as probe artifact, document for ORCH-0963 SPEC that live-fire on prod buyer-web requires either a real browser session or a Metro localhost dev server.
- **Linked:** evidence file `Mingla_Artifacts/evidence/f1_probe_results.json` + screenshots `f1_*.png` in worktree.

### D-2 — Stale type `BusinessPublicBrandViewRow.kind` (folded into F-3, but flagged here so the implementor knows it's a one-line widen + a downstream type-narrow audit, not just a cosmetic fix).

### D-3 — `business_public_brands_view` is the only `/b/{slug}` brand read path and has no kind filter; verified `claimed_venues_public_view` filters to `kind='physical'` only. **No P0 here**, but flagged because a future ORCH that wants kind-specific public views (e.g., a `trip_planner_brands_public_view`) would need to coordinate with this resolution chain (the resolver tries `claimed_venues_public_view` first, falls back to `business_public_brands_view`).

### D-4 — ORCH-0962 [brand-edit public render audit] overlap warning. If the parallel orchestrator session there is editing `PublicBrandPage.tsx` or the public-brand resolver, the two ORCHs will collide. **Recommended action:** the orchestrator (Claude `mingla-orchestrator`) should write a COMMS-LEDGER entry once ORCH-0963 SPEC lands, naming the files that will change. Do this BEFORE handing ORCH-0963 to implementor.

---

## 9. Confidence + Failure Honesty

- F-1 (trip-planner brand surfaces zero content): **probable** — source path proves it, live-fire blocked by D-1.
- F-2 (divergence inventory of 11 event-shape assumptions): **proven** by source reading.
- F-3 (stale TS type): **proven** by source + schema migration chain.
- F-4 (no public-trips-by-brand read path): **proven** by source grep.
- F-5 (event-brand IA pushes tickets below fold): **proven** by source layout + token measurements; subjective on "below the fold" — depends on viewport, but the 600px+ pre-tab content stack is structurally fixed.
- F-6 (SEO no kind variants): **proven** by source.
- F-7 (consumer app does not consume `/b/`): **proven** by negative grep.

Overall investigation confidence: **high** — only F-1 carries the "probable" tag because of the prod headless 401 (D-1). The fix path does not depend on resolving D-1 first; D-1 is surfaced for orchestrator triage.

---

## 10. Pointer for SPEC author (next phase)

When SPEC is dispatched (this skill, SPEC mode):

- Lock answers to the 3 Open Questions above.
- Lock the IA on the event-brand side (F-5 polish in-scope vs deferred).
- Choose view-vs-RPC for the public-trips read path.
- Specify the discriminated-union shape returned by `usePublicBrandBySlug` (or the new sibling hook).
- Spec `<TripMiniCard>` props with field-level honesty rules (no fabricated spots-left; pull from `biz_trip_tickets_sold(p_event_id)` or equivalent server gate per `I-TRIP-SPOTS-MIRRORS-CAPACITY-GATE`).
- Cite Stripe docs ONLY if any new external API touches (none expected per F-7 + read-only nature).
- Define Step 0.5 regression tests: implementor happy-path (`TripMiniCard renders destination + dates + price-from + spots-left for travelbrand`) + tester adversarial (`bookings_closed=true → trip card shows "Booking closed" badge AND View-trip CTA still navigates`).
- Confirm Cross-Surface Impact section per Phase 2.5 — single surface (buyer-web), no parity matrix needed.
- Confirm I-PROPOSED-PUBLIC-BRAND-KIND-BRANCHED gate registry pattern per `[[strict-grep-registry-pattern]]`.

---

*Investigation complete. Hand back to Claude `mingla-orchestrator` for REVIEW. After APPROVED, this same skill writes the SPEC.*
