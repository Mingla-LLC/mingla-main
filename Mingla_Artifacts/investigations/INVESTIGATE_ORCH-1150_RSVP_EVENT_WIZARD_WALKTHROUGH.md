# INVESTIGATE ORCH-1150 — RSVP Event (Partiful-style) Create/Edit Wizard: Screen-by-Screen Fork Walkthrough

**Mode:** INVESTIGATE (read-only walkthrough). No product code edited, no worktree, no migrations.
**Anchor:** `/Users/sethogieva/Desktop/mingla-main` on `main`.
**Date:** 2026-06-15.
**Comms ledger:** Read on entry. No OPEN entry targets `mingla-forensics`, `ORCH-1150`, or `ALL` with BLOCK status. Latest active entries (COMMS-0029/0033) concern ORCH-1119/1120 trip RPC clobber + ORCH-1133 ID collision — neither relevant here. Nothing to ack.

> This is a forensic walkthrough, NOT a spec and NOT a migration. Where I would normally propose a fix, I state the **fork verdict + regression risk**. Every behavioral claim cites `file:line` I actually read.

---

## 1. Executive Summary

The RSVP-event clone is **feasible and structurally clean**, because the schema already carries a first-class discriminator — `events.event_type` with CHECK `IN ('event','experience','trip')` (`supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql:33-34`) — and Mingla already has a working precedent for forking a wizard off it (the experience + trip wizards are sibling clones of the event wizard, each with its own publish RPC). The cleanest fork seam is `UniversalCreatorSheet.tsx`: the "Create event" root row currently routes straight to `/event/create` (`mingla-business/src/components/ui/UniversalCreatorSheet.tsx:110-117`), and ORCH-1144 already established the exact in-sheet two-step pattern (`root` → `experience`) that the RSVP-vs-Ticketed fork should mirror — a new in-sheet "event" step with two rows ("Ticketed event" → `/event/create`, "RSVP event" → a new `/rsvp/create`). The single biggest regression risk is that **the entire event pipeline hard-assumes ≥1 ticket exists**: the publish RPC raises `event_ticket_required` when the tickets array is empty (`...orch_1075...sql:1932-1934`), `validateTickets` rejects an empty ticket list (`mingla-business/src/utils/draftEventValidation.ts:454-460`), and `validatePublish` loops all 7 steps including Tickets (`...draftEventValidation.ts:76-78`) — so a ticketless clone that reuses any of these surfaces verbatim will fail to publish. **New schema IS required**: a CHECK widen to add `'rsvp'` to `event_type`, plus a new per-guest RSVP/attendee table (no event-level guest/RSVP/attendee table exists today — `board_card_rsvps` is an unrelated consumer collab-board concept), because "Going/Not-going" is a genuinely new persistence concept that the free-ticket *order* path does not model. The recommended product default is **invite-link-only (Partiful parity)**: the consumer discover RPC strictly filters `event_type = 'event'` (`supabase/migrations/20261001000000_orch_426_discover_rpc.sql:100`), so an `event_type='rsvp'` row is automatically off-deck with zero extra work — which is exactly the Partiful model and the lowest-regression path.

---

## 2. The Chooser Fork

### How `UniversalCreatorSheet.tsx` routes today

The sheet has TWO in-place steps (`root`, `experience`), introduced by ORCH-1144 (`mingla-business/src/components/ui/UniversalCreatorSheet.tsx:1-57`):

- **Root step** renders 3 rows from `ROOT_OPTIONS` (`:109-139`):
  - `"Create event"` → `route: "/event/create"` (close + `pushRoute`) — `:110-117`
  - `"Create experience"` → `step: "experience"` (in-place transition, sheet stays open) — `:118-128`
  - `"Create trip or otherwise"` → `route: "/trip/create"` — `:129-138`
- A `RootOption` carries EITHER `route` (close + push) OR `step` (in-place transition), never both (`:94-96`). `handleRootSelect` (`:203-213`) checks `option.step` first (transition), else `pushRoute(option.route)`.
- `pushRoute` (`:190-201`) calls `onClose()` then `router.push(route)` after a 50ms scrim-fade delay.
- The experience step (`:262-311`) is the in-place chooser ORCH-1144 added; `canGoBackToRoot` (`:225`) gates a Back affordance.

### Where the RSVP-vs-Ticketed prompt inserts

The current "Create event" row routes DIRECTLY to `/event/create`. The fork inserts by converting that row from a `route` to a `step` (mirroring how "Create experience" became an in-place step):

- Add `UniversalCreatorStep = "root" | "experience" | "event"` (extend `:73`).
- Change the `"event"` `ROOT_OPTIONS` entry from `route: "/event/create"` to `step: "event"` (`:110-117`).
- Add an `EVENT_OPTIONS` array (mirroring `EXPERIENCE_OPTIONS` `:145-173`) with two rows:
  - `"Ticketed event"` → `route: "/event/create"` (the existing wizard, untouched).
  - `"RSVP event"` → `route: "/rsvp/create"` (new sibling route).
- Add an `"event"` branch to the render switch (mirroring the `"experience"` branch `:262-311`) with the same Back-to-root affordance (`:225` pattern generalizes to `step !== "root" && initialStep === "root"`).

**Verdict:** CLONE-VERBATIM the ORCH-1144 in-sheet step pattern. The fork is a pure additive extension of an already-shipped UX idiom. Regression risk here is **near-zero** (the existing `event`/`experience`/`trip` routing rows are unchanged; only "Create event" gains an intermediate step). One thing to verify in SPEC: callers that pass `initialStep` (`:81-84`, Hub > Experiences passes `"experience"`) are unaffected; no caller passes `"event"`.

---

## 3. Screen-by-Screen Walkthrough (the 7 steps)

Step bodies are dispatched by `renderStepBody` in `EventCreatorWizard.tsx:631-673`; step defs + the Stepper labels live at `EventCreatorWizard.tsx:111-126`. Per-step validation is `validateStep(step, draft)` (`draftEventValidation.ts:37-59`). All step bodies share the `StepBodyProps` contract (`types.ts:14-77`).

| # | Step | Today: behavior + draft fields + validateStep rules (cited) | RSVP verdict | Regression risk if forked & how to avoid |
|---|------|------|------|------|
| 1 | **Basics** | Renders Name (`CreatorStep1Basics.tsx:173-186`), Format pills in_person/online/hybrid (`:188-201`, field `draft.format`), **Party Type required ≥1** (`:203-220`, `draft.partyTypes`), Vibe Tags optional (`:222-240`), Music Genre optional (`:242-261`), Description required (`:263-294`). `validateBasics` requires `name`, `description`, `partyTypes.length≥1` + canonical-slug checks (`draftEventValidation.ts:106-156`). | **MODIFY.** Keep Name + Description + Format + Vibe Tags. **DROP "Party Type" as a hard-required field** — Partiful events are personal gatherings, not club taxonomy; forcing `party_types_required` (also enforced server-side `...orch_1075...sql:1990-1992`) is wrong for an RSVP. Either make partyTypes optional for RSVP, or drop the pill group entirely. | The publish RPC hard-raises `party_types_required` + `party_types_not_canonical` (`...orch_1075...sql:1990-2000`). A ticketless RSVP that still routes through `business_publish_event_draft` would fail on this even if tickets were solved. **Avoid** by giving the RSVP publish RPC its own (looser) taxonomy gate — do NOT reuse `business_publish_event_draft` verbatim. |
| 2 | **When** | Single / recurring / multi_date modes (`draft.whenMode`, `date`, `doorsOpen`, `endsAt`, `timezone`, `recurrenceRule`, `multiDates`; types `draftEventStore.ts:257-293`). Validation is mode-branched: single requires date+doorsOpen+endsAt + no-past-date (`draftEventValidation.ts:171-193`); recurring/multi-date add rules (`:195-373`). | **CLONE-VERBATIM** (single mode); **consider DROP recurring/multi_date** for v1. An RSVP party is almost always a single date. Recurring/multi-date pull in the full `event_dates` materialization machinery + `MultiDateOverrideSheet`. | Low if cloned as-is. If recurring/multi_date are kept, the RSVP publish RPC must replicate the master-`event_dates` materialization (the experience RPC's deferred-status-flip BUG-5 fix `...orch_1075...sql:998-1004,1169-1174` shows this is fragile). **Avoid** by shipping RSVP as single-date-only in v1; flag multi-date as a follow-on. |
| 3 | **Where** | Venue name + Mapbox/Places address (`draft.venueName`, `address`, `city`, `locationGeo`) for in_person/hybrid; online URL for online/hybrid (`CreatorStep3Where` updateDraft keys: `venueName`, `address`+`city`+`locationGeo`, `onlineUrl`). `validateWhere` requires venue+address+**structured city** for in_person/hybrid (`draftEventValidation.ts:377-403`) and a valid URL for online (`:404-418`). | **CLONE-VERBATIM**, but **DROP the hard `city_required`** at publish for RSVP. Partiful lets you type a freeform location ("my place"); forcing a Places-picked structured city is hostile for a house party. | Server raises `city_required` (`...orch_1075...sql:1986-1988`) — same blocker as party_types. **Avoid** via the RSVP-specific publish RPC. Also note `hideAddressUntilTicket` (`draftEventStore.ts:311`) is ticket-coupled copy — for RSVP it should read "hide until RSVP'd Going" (MODIFY copy, keep mechanism). |
| 4 | **Cover** | Cover hue + uploaded image/video/gif (`draft.coverHue`, `coverMediaUrl`, `coverMediaType`, provider metadata; `draftEventStore.ts:312-323`). `validateCover` returns `[]` — no rules (`draftEventValidation.ts:448-450`). | **KEEP-AS-IS / CLONE-VERBATIM.** Cover is identical for an RSVP. | **None.** Zero validation, no ticket coupling. Lowest-risk step in the wizard. |
| 5 | **Tickets** | **THE FORK CORE.** Inline ticket CRUD + reorder + "Who covers costs" pricing section (`CreatorStep5Tickets.tsx`). Owns `draft.tickets[]` + `draft.pricingSwitches` + `draft.currency`. `validateTickets` **requires ≥1 ticket** (`draftEventValidation.ts:452-461`) then per-ticket name/price/capacity/password/waitlist/qty rules (`:462-524`). | **DROP entirely; REPLACE with an "RSVP setup" step** (see below). | **#1 regression surface in the whole feature.** See §4. |
| 6 | **Settings** | Visibility public/unlisted/private + requireApproval + allowTransfers + hideRemainingCount + passwordProtected + **privateGuestList** toggles (`CreatorStep6Settings.tsx:155-157` reads `draft.privateGuestList`; fields `draftEventStore.ts:340-354`). `validateSettings` returns `[]` (`draftEventValidation.ts:526-528`). | **MODIFY.** Keep visibility + privateGuestList (directly maps to "guest-list host-only vs public"). **DROP `allowTransfers`** (ticket transfers — meaningless without tickets). `requireApproval` becomes "approve each RSVP" (Partiful has this). `hideRemainingCount` becomes "hide Going count". | `allowTransfers` is a ticket concept; keeping it on an RSVP is a dead toggle (Constitution #1 dead-tap risk). **Avoid** by trimming the settings list for RSVP. No validation coupling, so safe. |
| 7 | **Preview** | Renders `PreviewEventView` mini-card + Stripe-blocked status card + drives the publish dock (`CreatorStep7Preview` via `EventCreatorWizard.tsx:662-669`). `validateStep(6)` returns `[]` (`draftEventValidation.ts:54-55`). The preview reflects the public page guests will see. | **CLONE → MODIFY.** The preview must render the RSVP public page (Going/Not-going buttons), not a ticket cart. **DROP the Stripe-blocked card** — an RSVP has no money path, so `computePublishability`'s `blocked-stripe` branch (`draftEventValidation.ts:557-564`) never applies. | The Stripe gate in the dock (`EventCreatorWizard.tsx:609-610` `publishDisabled = status==='blocked-stripe'`) keys off paid tickets; with zero tickets it's inert, but the preview's `onConnectStripe` plumbing (`:667`) and the StripeBlockedCard become dead UI. **Avoid** by giving the RSVP wizard a trimmed Step-7 that omits the Stripe/money surfaces. |

### Step 5 deep-dive — what the RSVP "guest-list / Going-Not-going config" step contains instead

The Tickets step is the one step that **cannot be cloned**; it must be replaced. The RSVP-variant step contains:

- **No ticket tiers, no price, no capacity-per-tier, no "Who covers costs", no Stripe.** Everything in `CreatorStep5Tickets.tsx:336-361` (`WhoCoversCostsSection`) and the tier CRUD (`:246-334`) is deleted for RSVP.
- **Instead, the RSVP config:**
  - **Capacity cap (optional)** — a single event-level max guest count (NOT per-tier). Maps to a new `events.rsvp_capacity` (nullable) or a column on the new RSVP table's parent. See open decision §7(b).
  - **+1 / plus-guests toggle (optional)** — see §7(c).
  - **Going-count visibility** — reuse `privateGuestList` / `hideRemainingCount` semantics from Step 6 rather than a tier flag.
  - **Optional waitlist when capacity hit** — `waitlistEnabled` exists today as a per-tier flag (`draftEventStore.ts:128-132`); for RSVP it becomes an event-level flag.

Because this step has NO ≥1-row requirement, the RSVP variant of `validateStep` for this step should return `[]` (like Cover/Settings do), NOT clone `validateTickets`.

---

## 4. Shared-Surface Regression Matrix

Every artifact the two wizards could share, and whether the RSVP fork can safely reuse it or needs a discriminator. **Bold = assumes "events always have ≥1 ticket" or "events always go through checkout" — the danger zone.**

| Shared surface | File:line | Reuse verdict for RSVP | Why / regression flag |
|---|---|---|---|
| `EventCreatorWizard.tsx` shell (nav, dock, autosave, desktop rail) | `EventCreatorWizard.tsx` whole | **CLONE** as `RsvpCreatorWizard.tsx` with 6 steps (drop Tickets) | The `STEP_DEFS` array (`:111-119`) is 7-entry hardcoded incl. "Tickets". `validatePublish` (`:506`) + `computePublishability` (`:601-604`) + the Stripe dock gate (`:609-610`) all assume the ticket model. Cloning the shell (sibling, not a mode flag — per Seth) is the right move; the shell logic is otherwise reusable. |
| `draftEventStore` (DraftEvent + persist) | `draftEventStore.ts:230-363` | **REUSE with new fields** (additive) | DraftEvent already carries everything RSVP needs (name/when/where/cover/visibility). `tickets: []` is a valid state in the store (default `:439`). Add RSVP-specific fields (capacity, plusGuests) additively + bump persist `version` (currently 11, `:706`) with an additive migrator. **No discriminator field on DraftEvent today** — needs an `eventType`/`isRsvp` flag so the edit route + publish path know which wizard/RPC to use. |
| **`validateStep` / `validateTickets`** | `draftEventValidation.ts:452-461` | **MUST NOT reuse for the Tickets slot** | **HARD BLOCKER:** `validateTickets` returns `tickets.empty` error when `draft.tickets.length === 0` (`:454-460`). An RSVP has zero tickets → permanently invalid. The RSVP wizard must skip this rule. |
| **`validatePublish`** | `draftEventValidation.ts:61-104` | **MUST fork** | **HARD BLOCKER:** loops `for step 0..6` calling `validateStep` incl. Tickets (`:76-78`); also the paid-ticket→Stripe cross-step gate (`:81-90`). For RSVP this must not run the Tickets validator. |
| **`business_publish_event_draft` RPC** | `...orch_1075...sql:1813,1932-1934,1986-2000` | **MUST fork into a new `business_publish_rsvp_draft`** | **HARD BLOCKER (the #1 risk):** raises `event_ticket_required` on empty tickets (`:1932-1934`), `city_required` (`:1986-1988`), `party_types_required` (`:1990-1992`). Precedent exists: trip got its own `business_publish_trip_draft` (`...orch_1075...sql:2373-2379`) because "extending the event RPC was technically infeasible" (`20260608000100_orch_0859_publish_rpc_trip.sql:308`). RSVP should follow the same fork pattern. |
| **`ticket-checkout-create` / checkout RPC** | `20260610000002_...sql:183,265` | **NOT reused** | Branches on `event_type` (`v_is_trip := event_type='trip'` `:183`). RSVP never enters checkout (no money, no ticket order). The public RSVP action writes a Going/Not-going row, not an order. **Flag:** any code that assumes "public CTA → /checkout/{eventId}" (`PublicEventPage.tsx:291,329,340`) must be RSVP-aware. |
| **`PublicEventPage.tsx`** (guest-facing) | `PublicEventPage.tsx:256-359` | **MODIFY / fork the CTA** | Today the floating bar + per-ticket rows all route to `checkoutPublicPath(event.id)` (`:291,329,340`); `onClaimFreeTicket` (`:331-341`) routes to the SAME cart. RSVP needs Going/Not-going buttons that write an RSVP row, not a checkout push. The page resolves a CTA via `resolveOfferingCta` (`:261-269`) keyed off `tickets` — with zero tickets this machine has no defined RSVP variant. **This is where guests RSVP, so it's a required surface.** |
| `types.ts` `StepBodyProps` | `types.ts:14-77` | **REUSE verbatim** | Generic enough; `editMode`/`canEditTicketPrice` props are ignored by non-ticket steps. Safe. |
| Offering list card / manage sheet (Hub) | shared `offering/` primitives (META-ORCH-1059) | **NEEDS discriminator** | The Hub list card + manage sheet render ticket/revenue summaries. An RSVP row has no revenue; must render "N going" instead. Needs an `event_type='rsvp'` branch. |
| `EditPublishedScreen.tsx` SECTIONS | `EditPublishedScreen.tsx:148-156` | **CLONE → drop Tickets section** | `SECTIONS` includes `{key:"tickets", stepIndex:4}` (`:154`) which calls `validateStep(4)` (`:386-388`). For RSVP, drop this section. See §6. |

---

## 5. Schema Findings (the 4 questions, with migration evidence)

**Q1 — How is an event persisted? Is there a discriminator?**
Events are persisted in `public.events`. **There IS a first-class discriminator: `events.event_type text NOT NULL DEFAULT 'event' CHECK (event_type IN ('event','experience','trip'))`** (`supabase/migrations/20260605000000_orch_0826_events_event_type_discriminator.sql:33-34`). It's read across the codebase (discover, group-chat trigger, checkout branch, circle RPC). The publish RPC INSERTs `event_type` explicitly (`...orch_1075...sql:421`). **Adding RSVP requires widening this CHECK to include `'rsvp'`.**

**Q2 — What distinguishes an "RSVP event" from a "free-ticket event"? Is Going/Not-going a NEW concept or the free-ticket claim path?**
**Going/Not-going is a genuinely NEW persistence concept**, NOT the free-ticket path. Evidence: a free event today is a normal `event_type='event'` row with a `tickets` row where `isFree=true`; the public CTA `onClaimFreeTicket` (`PublicEventPage.tsx:331-341`) routes to `/checkout/{eventId}` — i.e. it creates a free *order/ticket*, going through the same checkout cart. There is **no "Not going" state** anywhere in that model — a free ticket is claim-or-don't, not a tri-state RSVP with an explicit decline. An RSVP "Going/Not-going" needs a per-guest status row with a `going | not_going` value, which the order/ticket model does not express. (The only `rsvp_status` CHECK in the DB is on the unrelated `board_card_rsvps` consumer collab-board table — `20260505000000_baseline_squash_orch_0729.sql:7520-7531` — `('attending','not_attending')`, scoped to `session_id`+`saved_card_id`, not events.)

**Q3 — Is there an existing guest-list / attendee / RSVP table to build on?**
**No event-level RSVP/attendee/guest-list table exists.** A repo-wide search for event-scoped rsvp/attendee/guest tables returns only `board_card_rsvps` (consumer collab boards, Q2 above) and `ticket_order_notifications` (`20260515000013_orch_0777_ticket_checkout_core.sql:153`). **The feature needs new schema.**

**Q4 — How are tickets persisted; what breaks at zero tiers?**
Tickets persist as `ticket_types` rows created by the publish RPC. **At zero tiers, three things break (the core regression):** (a) publish RPC raises `event_ticket_required` (`...orch_1075...sql:1932-1934`); (b) client `validateTickets` blocks the wizard (`draftEventValidation.ts:454-460`); (c) the public page CTA machine `resolveOfferingCta` is keyed off `tickets` (`PublicEventPage.tsx:261-269`) with no zero-ticket RSVP variant. The checkout RPC additionally assumes a ticket type exists for trips (`20260610000002_...sql:265`).

### Minimal schema addition (sketch only — SPEC owns the migration)

1. **Widen** `events.event_type` CHECK to `IN ('event','experience','trip','rsvp')`. (Per the migration-baseline rule, this is a `DROP CONSTRAINT` + `ADD CONSTRAINT`, not a silent widen.)
2. **New table** `public.event_rsvps` (per-guest): `id`, `event_id` (FK events), `user_id` (nullable for anon link guests) OR a guest identity (email/name), `rsvp_status text CHECK IN ('going','not_going')`, optional `plus_count int`, `created_at`/`updated_at`, with RLS (host reads all for their brand's events; guest reads/writes own row). Mirror the `board_card_rsvps` shape (`...0729.sql:7520-7531`) but event-scoped.
3. **New publish RPC** `business_publish_rsvp_draft` — clone of `business_publish_event_draft` MINUS the ticket/city/party-type gates, inserting `event_type='rsvp'`, creating ZERO `ticket_types` rows.
4. Optional: `events.rsvp_capacity int NULL` for the capacity cap (or hold capacity on the parent; SPEC decides).

**This is a sketch for SPEC, not a contract. Do not treat the column/table names as final.**

---

## 6. Edit-Wizard Delta

The published-edit path is `EditPublishedScreen.tsx` (sectioned, not stepper), distinct from the create wizard (`:130-156`). How RSVP edit differs:

- **Sections:** `SECTIONS` (`:148-156`) lists basics/when/where/cover/visual/tickets/settings. **The RSVP edit screen drops the `tickets` section** (`:154`) and its `validateStep(4)` call (`:386-388`).
- **Edit-after-publish guards that MUST become RSVP-aware:**
  - The **sold-tickets refund gate**: editing time/date on an event with sold tickets forces a full refund-first flow (`:628`, `:1004-1006` — "This event has sold tickets. Refund those buyers..."). For RSVP there are no tickets/orders, so the analogous guard is "N guests are Going — they'll be notified of the change," NOT a refund. The `computeTicketDiffs` machinery (`:457-460`) has no RSVP equivalent and must be skipped.
  - **`MultiDateOverrideSheet` / `EndSalesSheet`** — `EndSalesSheet` is a ticket-sales concept (`business_end_event_ticket_sales` RPC, `businessEvents.ts:722-738`); meaningless for RSVP. Drop.
  - **`ChangeSummaryModal`** — reusable, but its copy is ticket/refund-centric; needs RSVP copy.
  - **Local-save vs server-mutation gate** (`ORCH_0824_PATCH_KEYS` `:182-189`) — RSVP edits need their own server mutation RPC (`biz_update_live_rsvp`, mirroring `biz_update_live_experience` `...orch_1075...sql:1318-1336` which gates on `event_type='experience'`).
- **The published edit RPC must gate on `event_type='rsvp'`** the same way `biz_update_live_experience` raises if `event_type <> 'experience'` (`...orch_1075...sql:731,1328-1330`).

---

## 7. Open Product Decisions (each with a RECOMMENDED default)

**(a) Does an RSVP event surface on the consumer discovery deck, or invite-link-only like Partiful?**
**RECOMMENDED: invite-link-only (Partiful parity).** The consumer discover RPC strictly filters `e.event_type = 'event'` (`supabase/migrations/20261001000000_orch_426_discover_rpc.sql:100`; also `20260612000000_orch_426_discover_scale.sql:39`). An `event_type='rsvp'` row is therefore **automatically off-deck with zero code** — this is both the lowest-regression path and the authentic Partiful model (private gatherings shared by link). Surfacing on the deck would require widening the discover filter AND adding RSVP-deck-card UX — defer as a follow-on if ever wanted.

**(b) Capacity cap + waitlist?**
**RECOMMENDED: optional single event-level cap, waitlist deferred.** Partiful supports a guest limit. Model it as one nullable `rsvp_capacity` (NOT per-tier — there are no tiers). When full, show "Event full" and (v2) offer a waitlist. The per-tier `waitlistEnabled` flag (`draftEventStore.ts:128-132`) does not map; promote to event-level only if shipping waitlist. Ship cap in v1, waitlist as follow-on.

**(c) +1 / plus-guests?**
**RECOMMENDED: optional host toggle "Allow guests to bring +N", default off.** Stored as `plus_count` on the RSVP row (sketch §5). Counts against the capacity cap. Low-complexity, high Partiful-parity value.

**(d) Guest-list visibility (public / host-only)?**
**RECOMMENDED: reuse the existing `privateGuestList` toggle** (`draftEventStore.ts:349`, surfaced in Step 6 `CreatorStep6Settings.tsx:155-157`). Default host-only (private) to match Partiful's "host sees the list; guests see a count." Public guest list is an opt-in toggle. This reuses a field that already exists — no new schema for the toggle itself.

**(e) Is "RSVP" genuinely distinct from "free event," and how do we prevent two overlapping ways to make a no-cost event?**
**RECOMMENDED: yes, distinct — and prevent overlap by positioning, not by removing free tickets.** They ARE different (Q2: RSVP has an explicit "Not going" tri-state + no order/ticket artifact; a free event issues a free *ticket* via checkout). To avoid confusing "two ways to make a no-cost event": in the chooser, label them by intent — **"RSVP event" = "Guests reply Going / Not going. No tickets."** vs **"Ticketed event" = "Issue tickets (free or paid)."** This is the cleanest product line and matches how Partiful (RSVP) and Eventbrite (free ticket) already differ in users' minds. Do NOT try to collapse them into one flow with a flag — Seth explicitly wants a sibling wizard.

---

## 8. Cross-Surface Scope (which of the 5 primary + 2 adjacent surfaces this touches)

| Surface | Touched? | Why |
|---|---|---|
| 1. Consumer iOS (`app-mobile`) | **NO (recommended default)** | Invite-link-only → not on discover deck (§7a). Touched ONLY if (a) is overridden to surface on deck. |
| 2. Consumer Android | **NO (same)** | Same as iOS. |
| 3. Buyer/anonymous Web (`mingla-business` public routes `/e/...`) | **YES** | Guests RSVP on the **public event page** (`PublicEventPage.tsx`) — Going/Not-going buttons + the new RSVP write path replace the checkout CTA. This is where guests actually act. |
| 4. Business iOS (`mingla-business`) | **YES** | The new RSVP create + edit wizards (sibling clones), the chooser fork, the Hub list card/manage-sheet RSVP branch. |
| 5. Business Android | **YES** | Same RN code as Business iOS; parity automatic (shared code) except Android glass opaque-fallback on the new chooser rows (`UniversalCreatorSheet.tsx:316-334` pattern). |
| 6. Admin Web (adjacent) | **NO** | No admin surface for RSVP in scope. |
| 7. Business Web preview (adjacent) | **YES (automatic)** | The business-web build renders the same wizard + public page; parity is automatic via shared code, subject to the lucide-shim/bundle-budget gotchas. |

**Backend (not a "surface" but in scope):** Supabase — CHECK widen, new `event_rsvps` table + RLS, new `business_publish_rsvp_draft` + `biz_update_live_rsvp` RPCs, an RSVP-write RPC for the public page.

---

## Confidence & Invariant Impact

**Confidence: `proven` (source-only, code-audit-exempt from live-fire per Prime Directive 7).** This is a static walkthrough/feasibility investigation, not a reproducer-bound runtime bug — no simulator repro is owed. Every behavioral claim is backed by a cited `file:line` read verbatim.

**Invariants flagged (NOT resolved — SPEC's job):**
- `I-BRAND-UNIVERSAL-AUTHORING` (META-ORCH-0972) — every brand authors universally; RSVP must be reachable by every brand (no `venueCategory`/kind gate), consistent with how `UniversalCreatorSheet.tsx:129-138` routes trip universally.
- The ORCH-1075 paid-publish integrity invariants (`I-PROPOSED-1075-*`) gate paid offerings on Stripe-readiness; RSVP is moneyless so these are inert for it — but the RSVP publish RPC must not accidentally inherit the money gate.
- New invariant candidates for SPEC (DRAFT): `I-PROPOSED-1150-RSVP-NO-TICKET-ROWS` (an `event_type='rsvp'` row has zero `ticket_types`), `I-PROPOSED-1150-RSVP-OFF-DECK` (RSVP rows never appear in the discover RPC).

## Discoveries for Orchestrator
- The event/experience/trip wizards are already **three sibling clones** off `event_type`, each with its own publish RPC (trip's fork rationale documented `20260608000100_orch_0859_publish_rpc_trip.sql:308`). RSVP is the natural 4th sibling — the pattern is established, lowering build risk.
- `hideAddressUntilTicket` (`draftEventStore.ts:311`) is ticket-coupled copy that already ships on every event; for RSVP its label needs rewording even though the mechanism is reusable.

## Recommended Next Phase
**SPEC** — gated on Seth's steering of the §7 open product decisions (especially 7a off-deck vs on-deck, and 7e the RSVP-vs-free-ticket product line). The SPEC must: (1) define the new sibling `RsvpCreatorWizard` (6 steps, Tickets→RSVP-config), (2) the chooser fork, (3) the `event_type` CHECK widen + `event_rsvps` table + RLS, (4) the `business_publish_rsvp_draft` + `biz_update_live_rsvp` RPCs, (5) the public-page Going/Not-going write path, (6) RSVP-aware edit-after-publish guards. Do NOT reuse `business_publish_event_draft`, `validateTickets`, or the checkout path for RSVP.
