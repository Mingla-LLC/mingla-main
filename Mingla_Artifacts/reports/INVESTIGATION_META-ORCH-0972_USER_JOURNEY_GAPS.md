# INVESTIGATION_META-ORCH-0972_USER_JOURNEY_GAPS

**ORCH:** META-ORCH-0972 [brand-kind decommission + universal feature access]
**Phase:** 1 of 4 — AUDIT (User journey gaps; Phase 2 designer inputs)
**Mode:** INVESTIGATE (read-only)
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-25
**Companion to:** [Gap Audit](./INVESTIGATION_META-ORCH-0972_BRAND_KIND_GAP_AUDIT.md) + [Data Model Audit](./INVESTIGATION_META-ORCH-0972_DATA_MODEL_AUDIT.md) + [Open Questions](./INVESTIGATION_META-ORCH-0972_OPEN_QUESTIONS.md)

This report documents every USER JOURNEY today that branches on, depends on, or breaks because of `brands.kind`, and where the journey becomes ambiguous, broken, or needs explicit redesign under the new universal-authoring + data-driven-tabs model. It is the input to Phase 2 (designer skill — user-journey redesign).

For each journey: **today's flow** | **what changes** | **gaps / open questions for designer**.

---

## Journey 1 — First-time brand sign-up → first offering created

### Today's flow

1. User opens Mingla Business app, signs up, lands on Home empty state.
2. Taps "Create brand" → opens `BrandSwitcherSheet` in `persona` mode.
3. Sees `PersonaPickerCards` with 3 cards: "A place" / "An event" / "A trip".
4. Selects ONE persona — this LOCKS the brand's kind for life:
   - "A place" → routes to venue search → on match: `biz_create_venue_brand_pending_review` RPC creates brand with `kind='physical'`, `claim_status='pending_review'`. **Brand cannot author events or trips until admin verifies.**
   - "An event" → routes to popup-create form (name + bio) → `useCreateBrand({kind:'popup', address:null, coverHue:25})`. Lands on cover picker → routes to Stripe Connect.
   - "A trip" → routes to `TripBrandWizard` (name + bio + cover) → `useCreateBrand({kind:'trip_planner', address:null, coverHue:25})` → routes to Stripe Connect.
5. After brand created, user is routed to either cover picker, brand-edit, or directly to Stripe based on persona.
6. Home empty state now shows `homeNextAction` rung 2 CTA:
   - trip_planner → "Plan a trip" → `/trip/create`
   - everyone else → "Create event" → `/event/create`
7. Physical+unverified brand: `brandAuthoringGate` blocks event/trip drafting via `PhysicalVenueNotVerifiedError`.

### What changes under META-ORCH-0972

1. User signs up, lands on Home empty state.
2. Taps "Create brand" → opens unified `BrandCreationFlow` (no persona picker, no kind selection).
3. Enters brand name + bio (+ optional cover image).
4. Brand row created with NO kind column (or kind defaults at DB → goes away in Stage 4).
5. **NEW empty-state question (Q6):** Where is brand address asked? Phase 2 designer chooses ONE:
   - (a) During brand creation as an optional input
   - (b) Skipped entirely; offered later as "Want to add an address?" ambient nudge in Brand Edit
   - (c) Only asked at first experience-creation time (since experiences need a venue)
   - (d) Required during creation (rejected — operator said optional always)
6. Brand lands on Home → 3-button chooser CTA (Event / Trip / Experience) per `homeNextAction` rung 2 redesign.
7. User can tap ANY of the 3 buttons; routes to `/event/create` or `/trip/create` or `/experience/create`. No gates.

### Gaps / open questions

- **Q6 (NEW — operator clarification 2026-05-25):** Address collection location in flow. Phase 2 designer decides.
- **Q5 status:** TripBrandWizard collapse confirmed clean (no unique safety/UX behavior). Unified flow inherits all 6 steps of TripBrandWizard with `kind` and `address` dropped from defaults.
- **Cover picker step:** preserved or skipped at creation? Today only the trip persona shows cover picker immediately; popup defers cover to brand-edit. Phase 2 designer decides if cover picker is universal at creation or universally deferred.
- **Stripe routing step:** when does new brand route to Stripe Connect? Today: trip persona routes immediately, popup/physical routes to brand-edit. Phase 2 must decide universal behavior. **Operator already answered:** free offerings don't need Stripe, so routing to Stripe at creation is no longer mandatory; can be deferred to "Connect Stripe to enable paid tickets" upsell at publish time.

---

## Journey 2 — Existing physical/popup brand creates their first trip

### Today's flow

User has a brand with `kind='physical'` or `kind='popup'`. They want to plan a trip.

1. Open Home tab → no "Plan a trip" CTA visible (rung 2 only shows for trip_planner kind).
2. Open Hub tab → "Trips" sub-nav shows.
3. Tap Trips tab → `hub/trips.tsx:161` empty state: "Trips are for trip-planner brands."
4. **JOURNEY DEAD-ENDS.** User cannot author a trip.

If they try to navigate directly to `/trip/create`:
- `trip/create.tsx:52` redirects with `setErrorMessage` — explicit gate.

### What changes under META-ORCH-0972

1. User opens Home → 3-button chooser includes "Plan a trip" button.
2. Taps it → routes to `/trip/create`.
3. Trip creation form opens (no kind gate).
4. User completes trip creation → trip published.
5. Hub tab now shows Trips tab (data-driven visibility — `trips.length > 0` triggers it).
6. Public brand page now shows Trips tab (data-driven — `trips.length > 0`).

### Gaps / open questions

- **Q3 (default hub tab):** When this user now has BOTH events AND trips, which hub tab opens first? Phase 2 designer decides per Q3 in Open Questions report.
- **Phase 4 Sub-C migration:** `pg_public_trips_by_brand` RPC must drop its `WHERE b.kind = 'trip_planner'` guard. Otherwise this user's trips won't show on their public brand page even after creation succeeds.
- **Tester gate:** Phase 5 must verify the trip-published flow works on iOS-business + Android-business + buyer-web for a brand that was originally `kind='popup'`.

---

## Journey 3 — Existing trip-planner creates their first event

### Today's flow

User has `kind='trip_planner'`. They want to create an event.

1. Open Home → "Plan a trip" CTA visible (rung 2 trip-branch).
2. Open Hub → Events tab visible.
3. Tap Events tab → events.tsx renders (no kind gate, surprisingly).
4. Tap "Create event" CTA in Events tab → routes to `/event/create`.
5. **Today this WORKS** because `event/create*.tsx` has NO kind gate. Trip-planner brands CAN technically author events today.
6. BUT: `brandAuthoringGate` runs in `eventDrafts.ts:172` `createServerDraft`. The gate only blocks `kind === 'physical' && claim_status !== 'verified'`. Trip-planner brands pass. So event creation succeeds.
7. Event published → shows on public brand page Events tab (no kind branch in publicEventsService for events today).

**Discovery:** the operator's "Trip organisers should be able to create events" goal is ALREADY 95% satisfied today — only Home dashboard CTA doesn't surface the option to trip-planner brands.

### What changes under META-ORCH-0972

1. Home 3-button chooser includes "Create event" for trip_planner brands (no kind branch).
2. Everything else works the same as today.
3. Public brand page now shows Events tab when `events.length > 0` (data-driven visibility — already works today, just no longer requires brand to be event-type).

### Gaps / open questions

- This is the LOWEST-RISK journey to change. The plumbing is already there; only UI affordance needs to surface the action.
- **Discovery for Phase 2 designer:** the operator may not realize this journey almost works today. Confirm with operator whether existing trip-planner brands have ever attempted to create events.

---

## Journey 4 — Brand without an address publishes their first experience

### Today's flow

Experience publishing assumes a physical venue:

1. User opens Hub → Experiences tab.
2. `experiences.tsx:292` gate: if `kind === 'physical' && claim_status !== 'verified'` → "Pending verification" hint.
3. `experiences.tsx:307/319/331` gates: snap inputs (Menu / Activities / Schedule) only show for `kind === 'physical'` AND `venueCategory` in (restaurant / play / creative_and_arts).
4. `experiences.tsx:345` gate: `kind !== 'physical'` → "Experiences are for verified physical venues."
5. **Non-physical brands hit a dead-end.** Trip and popup brands cannot author experiences.

If a physical brand reaches the snap input:
- They upload a menu or list activities.
- Backend `parse-restaurant-menu` or `parse-play-activities` edge function: `if (brand.kind !== 'physical')` → 403; `if (brand.claim_status !== 'verified')` → 403. (Same gate, server-side.)
- AI parses the menu/activities → creates experience rows with `event_type='experience'` in the `events` table.
- The experience inherits `brand_id` but carries no own venue address (experience row has no venue column today).

### What changes under META-ORCH-0972

1. Hub → Experiences tab visible if brand has any experiences OR if user wants to create one (per data-driven hub rule, the tab may need an "always show + empty state CTA" path; pending Q2).
2. Snap inputs (Menu / Activities) shown when relevant — REGATE on `venueCategory` alone OR on a new "what kind of experience" picker. Per operator: AI tools are universal.
3. Server gates DELETED — `parse-restaurant-menu` and `parse-play-activities` accept any brand_id.
4. **CRITICAL NEW STEP (Q7):** Experience creation MUST ask for a venue/location for the experience itself. If brand has a brand-level address, pre-fill. If brand has no address, ask the user to enter one (or leave empty for "venue TBD" / "location varies").

### Gaps / open questions

- **Q7 (NEW — operator clarification):** Experience venue field — required at offering creation? Optional? Pre-fill rule from brand address?
- **Q-data-model (NEW):** Experience row in `events` table has no dedicated `venue_text` or `venue_address` column. The experience venue likely goes into `theme.experience_venue` JSON sub-object — Phase 2 designer + Phase 3 spec must define the schema enrichment.
- **Phase 4 Sub-D scope:** REGATE `canGenerateExperiencesFromMenu` + `canGenerateExperiencesFromActivities` from `kind === 'physical'` to `venueCategory === 'restaurant'` / `'play'` alone (no kind, no claim).
- **Phase 5 tester scope:** verify the menu/activities parser works for a non-claimed brand on iOS + Android + web.

---

## Journey 5 — Brand publishes a free event vs paid event (Stripe boundary)

### Today's flow

The Stripe boundary today is partially encoded:

1. Brand creates an event draft.
2. In `TicketTypesStep` or similar, brand sets price per tier.
3. If any tier has `price > 0`, the publish flow likely requires `brand.stripe_status === 'active'` (this gate exists at publish time, not at draft creation).
4. If all tiers are free (`price = 0`), publish succeeds without Stripe (RSVP-only event).
5. `homeNextAction` rung 1: `if (brand.stripeStatus !== "active")` returns "Finish setting up Stripe" CTA — but this fires for ALL brands regardless of whether they have free or paid offerings drafted. Today this CTA is unconditional.

### What changes under META-ORCH-0972

Per operator 2026-05-25: free offerings don't need Stripe.

1. Brand creates free event → publish succeeds (already works today).
2. Brand creates paid event → Stripe-active check fires at publish time (already works today).
3. **`homeNextAction` rung 1 redesign:** Demote from blocker to upsell — only fires if brand has drafted ANY paid offering (event/trip/experience with price > 0) AND Stripe is not active. Otherwise rung 1 is suppressed; brand can use Mingla for free RSVP events without ever connecting Stripe.

### Gaps / open questions

- **Q1 status:** operator confirmed free offerings need no Stripe. Phase 3 spec needs the exact rule: is the Stripe gate at PUBLISH only when any tier has `price > 0`, OR at any tier creation, OR at brand-level for any paid offering ever?
- **Phase 2 designer:** the Home empty-state needs to consider 4 quadrants: (Stripe active / inactive) × (has paid offerings / has only free offerings). Each quadrant gets a different rung 1 behavior.
- **Phase 4 Sub-B scope:** rewrite `homeNextAction.ts` rung 1 to read offering count + price tier data, not just `brand.stripeStatus`. May need a new data source (e.g., "has any draft with paid tier?" boolean).

---

## Journey 6 — Brand initiates venue claim post-creation (NEW opt-in flow)

### Today's flow

Venue claim is initiated at brand creation only (via persona-picker "A place" → venue search):

1. User picks "A place" persona at brand creation.
2. Searches Google Places via venue search.
3. Matches a venue → `biz_create_venue_brand_pending_review` RPC creates brand with `kind='physical'`, `claim_status='pending_review'`, `place_pool_id` set.
4. Brand is INVISIBLE on public brand page until admin verifies (RLS predicate blocks).
5. Admin reviews via VE3 admin workflow → `biz_review_venue_claim` RPC sets `claim_status='verified'` or `'rejected'`.
6. Verified brand becomes publicly visible + can author events/trips/experiences.

There is NO post-creation path to initiate a venue claim today. A popup or trip_planner brand has no way to "upgrade" to a verified physical venue.

### What changes under META-ORCH-0972

Per operator 2026-05-25: venue claim is opt-in for any brand. Brand can initiate at creation OR later.

1. **NEW (Phase 2 designer):** Brand Edit screen gets a "Claim a venue location" CTA that opens the venue search flow.
2. User searches Google Places → matches → `biz_create_venue_brand_pending_review` rewritten to UPDATE existing brand (not INSERT new one) with `claim_status='pending_review'`, `place_pool_id` set, `address` filled from Google Places.
3. Brand stays publicly visible during claim (RLS no longer gates on kind+verified — new model: `claim_status` is cosmetic).
4. Admin reviews via VE3 (existing) → sets verified or rejected.
5. Verified brand displays "Verified location" badge on public page.

### Gaps / open questions

- **Phase 2 designer scope:** new "Claim a venue" CTA in Brand Edit. Phase 3 spec for the RPC rewrite from INSERT to UPDATE.
- **VenueClaimStatusBanner** display rule changes — show banner for ANY brand with `claim_status !== 'none'` instead of `kind === 'physical'`.
- **Admin Venue Claims queue (Dim 12 finding):** `adminClaimsService.js:37` filters by `kind === 'physical'`. New filter: `claim_status IN ('pending_review', 'verified', 'rejected')` (i.e., any brand that has ever initiated a claim).
- **Operator data check:** confirm no live brands depend on the current kind-only-at-creation flow. If non-zero brands exist, plan backfill.

---

## Journey 7 — Anonymous buyer lands on a brand's public page with mixed offering types

### Today's flow

Today the public brand page is event-only (worktree base) OR kind-branched (post-ORCH-0963 on origin/main):

1. Buyer taps a shared link `/b/{brandSlug}`.
2. `PublicBrandPage` renders 3 tabs: Upcoming / Past / About (worktree base) OR per-kind labels (origin/main post-ORCH-0963).
3. Upcoming tab shows events list (or trips list for trip-planner brand, post-ORCH-0963).
4. Past tab shows ended/cancelled (events or trips depending on kind).
5. About tab shows bio, contact, social, address (if physical).
6. **NO experience rendering anywhere on public page.**

### What changes under META-ORCH-0972

1. Buyer taps shared link.
2. `PublicBrandPage` queries: `events`, `trips`, `experiences` for the brand in parallel.
3. Renders identity card + dynamically:
   - If brand has zero of everything → just identity card + empty state.
   - If brand has at least one of events/trips/experiences → render tabs:
     - **Tab 1 "Upcoming"** — interleaved chronological list (events sorted by start_time + trips sorted by start_at + experiences sorted by `next_occurrence_at` IF that field exists per Q4) — ALWAYS shown when any offerings exist.
     - **Tab 2 "Events"** — shown only if `events.length > 0`.
     - **Tab 3 "Trips"** — shown only if `trips.length > 0`.
     - **Tab 4 "Experiences"** — shown only if `experiences.length > 0`.
4. Address card shown only if `brand.address` non-empty (no kind gate).

### Gaps / open questions

- **Q4 (open):** experiences in Upcoming tab — yes (with next-occurrence date) or no (Experiences tab only)?
- **Q-data-model (open):** experience row has no `next_occurrence_at` — does Phase 3 add it, infer from `theme.suggestedTimeOfDay`, treat experiences as evergreen, or exclude from Upcoming?
- **Q-RPC (open):** Phase 3 must decide: 3 separate RPCs (`pg_public_events_by_brand` + `pg_public_trips_by_brand` + `pg_public_experiences_by_brand`) called in parallel, OR 1 unified RPC `pg_public_brand_upcoming(p_brand_slug)` returning a tagged-union of all 3 types sorted chronologically.
- **Tab ordering when 4 are visible:** Upcoming + Events + Trips + Experiences — left-to-right order? Phase 2 designer decides.
- **Past sections:** today each tab has its own past section. New model: do we have a single "Past" tab interleaving all past offerings, or per-type past sections inside each per-type tab? Phase 2 designer decides.

---

## Journey 8 — AI menu/activities parser invoked by a brand with no address vs with address

### Today's flow

1. Brand must be `kind='physical'` AND `claim_status='verified'` AND `venueCategory IN (restaurant, play)`.
2. Brand uploads menu PDF or pastes activities text via Hub > Experiences > snap inputs.
3. `parse-restaurant-menu` or `parse-play-activities` edge function:
   - Reads brand from DB (`select kind, venue_category, claim_status, default_currency`).
   - Gates: `kind !== 'physical'` → 403; `claim_status !== 'verified'` → 403.
   - Calls OpenAI GPT-4o-mini to parse the input into structured experience suggestions.
   - Returns suggestions; user reviews and accepts.
   - Accepted suggestions → POST to create experience rows in `events` with `event_type='experience'`.
4. Experiences inherit brand address (NOT explicitly — they just don't carry their own venue field, so any consumer fetching the experience reads brand.address as context).

### What changes under META-ORCH-0972

Per operator 2026-05-25: AI tools are universal.

1. Any brand can invoke. No kind gate. No claim gate. New restaurants not on Google Places can upload menu PDF.
2. Edge function reads brand (just for `venue_category` to choose menu vs activities parser, and `default_currency` for output formatting). NO kind read.
3. Parser runs, returns suggestions.
4. **NEW (Q7):** Each accepted experience needs a venue. If brand has `address` set, pre-fill the experience venue. If not, ask the user to enter a venue per experience (free text).

### Gaps / open questions

- **Q7 (open):** experience-venue defaulting rule. Phase 2 designer decides.
- **Phase 4 Sub-D scope:** edge function gate deletion + venue_text plumbing in experience creation API.
- **Backward-compat for already-created experiences:** existing experience rows have no venue field. Phase 3 spec decides: leave nullable, backfill from brand.address at read-time, or migrate all existing experiences to inherit brand.address.

---

## Cross-journey themes (for Phase 2 designer synthesis)

### Theme A — The 3-button chooser is the connective tissue

Across Journeys 1, 2, 3, the 3-button chooser CTA (Event / Trip / Experience) on Home empty state is the primary affordance for the universal-authoring model. Phase 2 designer should treat it as a first-class component, possibly reusable in:
- Home empty state (rung 2)
- Hub fully-empty state (per Q2)
- Brand creation flow last step ("What do you want to make first?")

### Theme B — Address is the most-asked field with the least clear "when to ask" answer

Address appears in Journeys 1, 4, 6, 7, 8 with different roles each time. Phase 2 designer must define a coherent address-collection strategy that:
- Doesn't ask twice (avoid asking at brand creation AND at first offering)
- Pre-fills downstream wherever known (brand address → experience venue default)
- Allows zero-address brands (touring acts, online brands, popup-without-fixed-venue)
- Surfaces an upgrade nudge ("Add an address for better discovery") without being annoying

### Theme C — Venue claim becomes a "trust signal upgrade path"

Today's venue claim is a heavyweight gate; tomorrow's is a lightweight opt-in. Phase 2 designer should frame it as a positive upgrade (badge, discovery boost) rather than a checkpoint. Brand Edit gets a new "Claim your venue location" affordance per Journey 6.

### Theme D — Public page tabs are pure data reflections

Across Journeys 7 and (implicitly) 2/3, the public page tabs reflect what the brand has actually published. No business model assumptions baked in. The empty-state-when-zero-offerings case (Journey 7 step 3 first sub-bullet) is its own design problem — what does a "brand with no offerings yet" look like to a curious buyer who has the link?

### Theme E — Hub mirrors public page for the brand operator

The same data-driven tab logic applies to the business-app hub (Journey 4) and the public buyer page (Journey 7). Phase 2 designer can build ONE tab-visibility hook reusable in both surfaces.

---

## Designer dispatch readiness checklist

- [x] 8 journeys documented with today's flow, new flow, and gaps
- [x] Q1–Q7 cross-referenced to journeys
- [x] Themes A–E synthesized for designer-level decisions
- [x] Data model gaps flagged (experience venue field, experience occurrence date)
- [x] No solutions proposed (Phase 2 designer owns the new flow design)
- [x] Cross-references to companion reports

End of Report 3.
