# INVESTIGATE — ORCH-1167 [event-page-canonical]

**Leg 1 of META-ORCH-1166 (public offering-page single source of truth).**
Scope: the STANDARD TICKETED-EVENT public page (`event_type='event'` ONLY — NOT rsvp/trip/experience).
Worktree: `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-event-page-canonical`.
HEAD verified at `be65f8f1c` (rebased on origin/main). Date 2026-06-19.

This is an audit-only investigation (no live-fire reproducer — this is an architecture/SoT consolidation, not a runtime bug). All findings are source + schema + data verified.

---

## COMMS-LEDGER on entry

Scanned Active entries. No `BLOCK`+`OPEN` rows targeting `ORCH-1167` / `mingla-forensics` / `ALL`. WARN/FYI factored in and acked:
- **COMMS-0038** (corrected 2026-06-19) — this is my exact charter; confirms event page is web-body + consumer-fork, leg 1 of the consolidation META, and "edit PublicEventPage.tsx never fork" is SUPERSEDED. ACK.
- **COMMS-0040 / 0044 / 0041** — sibling RSVP / trip / experience standardization legs. They establish the SAME shell-agnostic-body convention this leg sets the precedent for. The `RsvpMomentumDecision` already lives in `offering-rendering` as the proof-of-pattern. ACK; coordinate package-home decision here.
- **COMMS-0036** — ORCH-1138 left a `[TRANSITIONAL]` comment in `mingla-business/src/...`; relevant because this leg retires that transitional split. FYI.
- **COMMS-0043** — ORCH-1159 added the `hideCloseOnWeb` web-close-X behavior; the shared body MUST preserve it. FYI.

---

## Symptom / charter (expected vs actual)

**Expected (Seth, 2026-06-19):** ONE canonical shell-agnostic shared body for the standard ticketed-event public page in `packages/offering-rendering`, rendered byte-identically on web + business + consumer, fed by ONE read RPC, with Seth's locked 9-section vertical structure including an **inline on-page ticket box** that replaces the separate ticket-selection screen.

**Actual (verified at HEAD):** the live event page is a Direction-A split — web + business render a body that lives in `mingla-business/src/` (NOT shared); consumer FORKS its own body; read paths are split; the ticket UI is a *radiogroup select that routes OUT* to a separate checkout screen; vibes/party-types/music-genres pills do NOT render on the standard-event path; and there is no city-level privacy geo field.

---

## Investigation manifest (every file read, in trace order)

| # | File | Layer | Why |
|---|------|-------|-----|
| 1 | `COMMS_LEDGER.md` (anchor) | docs | mandatory entry scan |
| 2 | `mingla-business/src/components/event/FoundationEventPreview.tsx` | code | the LIVE web+business body |
| 3 | `mingla-business/src/components/event/PublicEventPage.tsx` | code | the adapter that owns CTA + scroll-state + routes to `/checkout` |
| 4 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | code | web public route (scroll shell) |
| 5 | `mingla-business/app/event/[id]/preview.tsx` + `PreviewEventView.tsx` | code | business in-app preview route |
| 6 | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx` | code | the CONSUMER fork body |
| 7 | `app-mobile/app/e/[brandSlug]/[eventSlug].tsx` | code | consumer route (gorhom BaseBottomSheet) |
| 8 | `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` | code | consumer cart sheet (multi-tier) |
| 9 | `app-mobile/src/hooks/useTicketCart.ts` | code | consumer cart reducer |
| 10 | `app-mobile/src/hooks/useConsumerEventFoundation.ts` | code | consumer field mapper (drops vibes/party/music) |
| 11 | `app-mobile/src/hooks/useEventTheme.ts`, `usePublicEventTickets.ts` | code | consumer read hooks |
| 12 | `mingla-business/src/services/publicEventsService.ts` | code | web read path + `publicEventViewRowToEvent` mapper |
| 13 | `packages/event-rendering/types.ts` | code | `PublicEventProps` / `PublicTicketProps` contract |
| 14 | `packages/event-rendering/offeringCta.ts` | code | `resolveOfferingCta` / `computeOfferingVariant` CTA state machine |
| 15 | `packages/event-rendering/mapboxStaticProxyUrl.ts`, `mapboxStaticUrl.ts` | code | ORCH-1165 static-map builders |
| 16 | `packages/offering-rendering/index.ts` + `package.json` | code | shared primitives + dep on event-rendering |
| 17 | `mingla-business/tsconfig.json`, `metro.config.js`; `app-mobile/tsconfig.json`, `metro.config.js` | config | package alias wiring (for consolidation) |
| 18 | DB: `information_schema.columns` (events, view), `routines` | schema | field names + RPC existence |
| 19 | DB: row counts of `events` where `event_type='event'` | data | geo/city population reality |

---

## Q-scorecard

### Q1 — Is the standard-event page body shared across all 3 surfaces today?
**Verdict: NO (confirmed).** Web + business render `mingla-business/src/components/event/FoundationEventPreview.tsx` (lines 103–126 props; 455–491 render). Consumer renders a separate `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`. The shared `packages/event-rendering/PublicEventPage.tsx` is now the LEGACY fallback only. Only `packages/offering-rendering` + `packages/event-rendering` PRIMITIVES are shared. (F-1)

### Q2 — What are the exact event field names for vibes / party-types / music-genres?
**Verdict: confirmed.** On `public.events` (all `text[]`): `vibe_tags`, `party_types`, `music_genres`. All three are also exposed anon-safe in `business_public_events_view`. (F-2)

### Q3 — Does the read payload carry those pills today, and do they render?
**Verdict: NO (confirmed gap).** Web mapper (`publicEventViewRowToEvent`) maps `party_types→partyTypes` and `vibe_tags→vibeTags` but DOES NOT map `music_genres`. The consumer card mapper (`mapRpcRowToCard`) maps all three onto `BusinessEventCard`, but the consumer foundation projection (`mapConsumerEventToFoundation`) DROPS all three. Neither `FoundationEventPreview` nor `ConsumerEventDetailScreen` renders vibe/party/music pills on the standard-event path (party/vibe chips currently render only on the RSVP branch). (F-3)

### Q4 — How is event "format" (in-person/online/hybrid) determined?
**Verdict: confirmed — derived, not a column.** There is NO `format` enum column on `events`. Format = `theme.business_event.format` if present (`in_person`/`online`/`hybrid`), else fallback `is_online ? "online" : "in_person"`. Web: `asFormat()` in publicEventsService.ts. Consumer: `deriveSharedFormat()` in `supabase/functions/discover-merged-events/_helpers.ts`. The view exposes `is_online` + `location_mode` + `event_type`. (F-4)

### Q5 — Is the ticket UI an inline box or a separate selection screen?
**Verdict: separate (confirmed).** Web/business: `FoundationEventPreview` renders a radiogroup of selectable tier rows; selection state lives in `PublicEventPage` (`selectedTicketId`); the CTA (floating pill + docked bar) routes via `router.push(checkoutPublicPath(event.id))` to `/checkout/{eventId}` — a SEPARATE tier-picker screen. Consumer: a radiogroup + `openCart()` opens `TicketCartSheet` (multi-tier qty cart). There is no on-page ticket box with steppers + running all-in total + in-box Proceed today. (F-5)

### Q6 — Does a `pg_public_event_by_slug` RPC exist?
**Verdict: NO (confirmed).** `information_schema.routines` returns only `pg_public_event_tier_allin` for the event-public family. 0 code/migration hits for `pg_public_event_by_slug`. Web reads `business_public_events_view` by `(brand_slug, slug)` via `getPublicEventBySlug`; consumer feeds from the deck card (`pg_discover_business_events`) + `useEventTheme` (view) + `usePublicEventTickets`. (F-6)

### Q7 — What is the all-in price contract?
**Verdict: confirmed.** Per-tier all-in comes from `pg_public_event_tier_allin` (`fetchTierAllInCents` → merged into each ticket's `priceAllInGbp`). `resolveOfferingCta`/`formatPrice` ALWAYS use `priceAllInGbp ?? priceGbp` (WYSIWYP). The running total in any inline box MUST be Σ(`priceAllInGbp` × qty), never bare base. (F-7)

### Q8 — Is there a city-level (privacy) geo field, and what is the map status?
**Verdict: NO city-level field (confirmed); map currently OMITTED on web body.** `location_geo` (point) is the EXACT venue pin; `city` (text) is a label only — there is NO city-centroid lat/lng. `FoundationEventPreview` is "rule-9 OMITTED" (renders a text venue card, no static map) per its own header comment, even though `locationGeo` now flows through the mapper (ORCH-1162). The ORCH-1165 builders (`buildProxyStaticMapUrl`) take `lat`/`lng` and return null when coords missing. Data reality: of 89 `event_type='event'` rows, 77 have NULL `location_geo`, 13 have a `city`. So map + city-level rendering MUST be default-safe. (F-8)

### Q9 — What is the shell constraint?
**Verdict: confirmed mandatory.** Consumer mounts `BottomSheetScrollView` as a DIRECT child of `BaseBottomSheet` (ConsumerEventDetailScreen ~L1007); it CANNOT host `ParallaxCoverShell` as the scroll root (ORCH-1016/1043/1138 freeze). `PublicEventProps.ScrollComponent` injection already exists in the legacy contract (types.ts L154) precisely for this. The shared body must be a pure content body, scroll-host-injected per surface. (F-9)

### Q10 — Package-home + isolation reality for consolidation?
**Verdict: confirmed.** `@mingla/offering-rendering` peer-depends on `@mingla/event-rendering` (offering-rendering/package.json L13; index.ts re-exports `offeringSurfaceStyles` FROM event-rendering at L67–71). Import-site counts: **88 files** import `@mingla/event-rendering`; **26** import `@mingla/offering-rendering`. Aliases wired in 4 places: `mingla-business/tsconfig.json` (L10–13), `app-mobile/tsconfig.json` (L15–18), `mingla-business/metro.config.js` (L41–58), `app-mobile/metro.config.js` (L23–37). I-MOR-0827-PACKAGE-ISOLATION forbids `app-mobile`↔`mingla-business` cross-imports; packages must stay app-src-free. (F-10)

---

## Findings (six-field)

### F-1 — The standard-event body is NOT shared (web-body + consumer-fork)
- **Symptom:** a field added to the event read shows on web/business but not consumer (and vice-versa) unless edited twice; drift risk identical to RSVP/trip/experience.
- **Layer:** code.
- **Probe:** read `FoundationEventPreview.tsx`, `ConsumerEventDetailScreen.tsx`, `packages/event-rendering/PublicEventPage.tsx`; grep import sites.
- **Evidence:** `FoundationEventPreview.tsx` L103–126 (props) + L455–491 (render) is in `mingla-business/src/`. `ConsumerEventDetailScreen.tsx` L1007–1165 renders its own body. `PublicEventPage.tsx` (package) header says it's the legacy/cancelled+password fallback (per COMMS-0038).
- **Mechanism:** the live body physically lives in `mingla-business/src/`, which `app-mobile` cannot import (I-MOR-0827) → consumer hand-mirrors → structural drift.
- **Severity:** CONFIRMED ROOT CAUSE (of the SoT gap this leg closes).

### F-2 — Pill field names (binding)
- **Layer:** schema. **Probe:** `information_schema.columns` on `events` + `business_public_events_view`.
- **Evidence:** `events`: `vibe_tags _text`, `party_types _text`, `music_genres _text`. View exposes all three + `location_geo point` + `city text` + `is_online bool` + `location_mode text` + `event_type text` + `timezone text`.
- **Mechanism:** these are the canonical columns the read payload must carry for the pills row.
- **Severity:** CONFIRMED (reference fact).

### F-3 — Pills not threaded to render (asymmetric drop)
- **Symptom:** no vibes/party-type/music-genre pills on the standard-event public page.
- **Layer:** code. **Probe:** read web mapper + consumer foundation mapper.
- **Evidence:** web `publicEventViewRowToEvent` maps `partyTypes`/`vibeTags` but NOT `musicGenres`; `mapConsumerEventToFoundation` drops `partyTypes`/`vibeTags`/`musicGenres` from `BusinessEventCard`. Neither body renders a vibe/party/music pill on the ticket path.
- **Mechanism:** data exists end-to-end at the DB/view but is dropped at the mapper/render layers → pills absent.
- **Severity:** CONFIRMED ROOT CAUSE (for the pills-row charter item).

### F-4 — Format is derived (no column)
- **Layer:** schema+code. **Evidence:** Q4. No `events.format`; `asFormat`/`deriveSharedFormat` both fall back to `is_online`.
- **Mechanism:** the shared body's `format` prop must be computed by the canonical read path (NOT a raw column), and `PublicEventProps.format` already encodes `"in-person"|"online"|"hybrid"`.
- **Severity:** CONFIRMED (reference fact; constrains the RPC/adapter).

### F-5 — Ticket UI is a separate selection screen, not an inline box
- **Symptom:** charter wants on-page ticket box; today it's a select + route-out.
- **Layer:** code. **Evidence:** `PublicEventPage.tsx` CTA → `router.push(checkoutPublicPath(event.id))` (`/checkout/{eventId}`). Consumer `openCart()` → `TicketCartSheet` (separate sheet). No steppers + running all-in + in-box Proceed exists today.
- **Mechanism:** structural change required: inline box replaces the separate tier-picker on web/business; on consumer the box drives the existing cart populated.
- **Severity:** CONFIRMED (scope-defining gap).

### F-6 — No `pg_public_event_by_slug`; split read paths
- **Layer:** schema+code. **Evidence:** Q6. Web → `business_public_events_view`; consumer → deck RPC + theme view + tickets hook.
- **Mechanism:** two adapters → a new field needs N edits → drift. The canonical RPC closes this.
- **Severity:** CONFIRMED ROOT CAUSE (for the one-read-path charter item).

### F-7 — All-in price contract (WYSIWYP)
- **Layer:** code. **Evidence:** Q7; `offeringCta.ts` L112–130 (`formatPrice` uses `priceAllInGbp ?? priceGbp`).
- **Mechanism:** any inline running total = Σ all-in; never bare base. Pre-existing single-owner (`pg_public_event_tier_allin`).
- **Severity:** CONFIRMED (binding constraint).

### F-8 — No city-level privacy geo; map omitted; sparse data
- **Symptom:** charter wants a city-level map when address hidden; today there's no city-centroid and the web body shows no map at all.
- **Layer:** schema+code+data. **Evidence:** Q8; `FoundationEventPreview.tsx` header comment "map is rule-9 OMITTED"; `buildProxyStaticMapUrl` returns null on missing coords; 77/89 events have NULL `location_geo`.
- **Mechanism:** new city-level geo field + a privacy gate that feeds the map a city-centroid (no exact pin) when `hideAddressUntilTicket` and not purchased; map must default-safe degrade to the text venue card when neither geo is present.
- **Severity:** CONFIRMED ROOT CAUSE (for the map/privacy charter item).

### F-9 — Shell-agnostic constraint is mandatory
- **Layer:** code. **Evidence:** Q9; `ScrollComponent?: ComponentType<ScrollViewProps>` already in `PublicEventPageProps` (types.ts L154).
- **Mechanism:** the new shared body must accept a `ScrollComponent` injection and NOT host its own scroll root; consumer injects `BottomSheetScrollView`, web/business inject RN `ScrollView`.
- **Severity:** CONFIRMED (binding constraint; gorhom freeze).

### F-10 — Package consolidation surface
- **Layer:** code+config. **Evidence:** Q10; 88 vs 26 import sites; offering-rendering peer-depends on event-rendering; 4 alias config files.
- **Mechanism:** dissolving event-rendering into offering-rendering means moving exports + flipping ~88 import lines + 4 alias configs + the I-MOR-0827 gate path — a large, mechanical, high-blast-radius change. Recommend phasing (see below).
- **Severity:** CONFIRMED (scope/sequencing input).

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction |
|-------|-------|---------------|
| Docs | COMMS-0038 says event = web-body+consumer-fork, leg 1 of META | none — matches code |
| Schema | `vibe_tags`/`party_types`/`music_genres`/`location_geo`/`city` all on events + view; no `format` col; no city-centroid; no `pg_public_event_by_slug` | view carries pills the code drops (F-3) |
| Code | bodies forked; pills dropped at mappers; ticket = select+route-out; map omitted | CODE drops data SCHEMA exposes (F-3); CODE omits map though `locationGeo` flows (F-8) |
| Runtime | n/a (audit) | — |
| Data | 77/89 events NULL `location_geo`; 13 have city | map/city features MUST be default-safe — most events have neither geo (F-8) |

**Key contradiction:** schema exposes the pill arrays + venue geo, but the render/mapper layers drop them. The gap between schema and code IS the missing-pills + missing-map bug.

---

## Blast radius / cross-surface map

**In scope (5 primary surfaces):** consumer iOS, consumer Android (`ConsumerEventDetailScreen` fork retired → wraps shared body), buyer-web + business iOS + business Android (`FoundationEventPreview` promoted to shared body; web `/checkout/[eventId]` tier-picker REPLACED by the inline box).
**Adjacent:** business-web preview route (`/event/[id]/preview` currently renders the separate `PreviewEventView` — must be reconciled to the shared body or explicitly deferred). Admin-web: NOT in scope (no public event page).
**Out of scope:** RSVP/trip/experience legs (separate META legs — COMMS-0040/0044/0041). The legacy `PublicEventPage.tsx` cancelled/password fallback (touch only if the shared body subsumes those states).

---

## Invariant impact (flagged, not pre-decided)
- **I-MOR-0827-PACKAGE-ISOLATION** — the new shared body + the consolidation must keep packages app-src-free; consumer can't import `mingla-business/src`. The CI gate path must update if `event-rendering` dissolves.
- **WYSIWYP / all-in (ORCH-1147)** — inline box running total must be Σ all-in.
- **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (ORCH-1076)** — `bookable` gates the box/CTA first.
- **Rule-9 (no fabricated data)** — pills omit when arrays empty; map omits when no geo.
- New DRAFT invariants proposed in the SPEC (I-PROPOSED-1167-*).

## Discoveries for Orchestrator
1. **D-1 (asymmetric music_genres drop):** the web mapper silently omits `music_genres` though the view exposes it — a latent bug independent of this leg; folded into F-3 here.
2. **D-2 (preview route divergence):** `/event/[id]/preview` renders a separate MID-fidelity `PreviewEventView`, NOT `FoundationEventPreview` — a 4th event-body variant. SPEC must decide reconcile-now vs defer.
3. **D-3 (sparse geo):** 77/89 events have no venue geo — the city-level map will be invisible for most existing events until brands add addresses; this is expected (rule-9) but worth noting for QA expectations.

## Confidence
**proven** for all schema/data facts (DB-queried) and code-structure facts (files read verbatim). No runtime reproducer needed (architecture/SoT consolidation, not a runtime bug). Recommended next phase: SPEC (this turn, IA mode).
