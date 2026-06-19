# SPEC — ORCH-1167 [event-page-canonical] — Canonical Standard-Event Public Page

**Leg 1 of META-ORCH-1166 (public offering-page single source of truth).**
**Companion investigation:** `Mingla_Artifacts/investigations/INVESTIGATE_ORCH-1167_EVENT_PAGE_CANONICAL.md`.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-event-page-canonical`.
**Scope marker:** `event_type='event'` ONLY (standard ticketed event). NOT rsvp / trip / experience.

This is a binding contract. The implementor builds exactly this. Anything outside the §12 allowlist requires a stop-and-amend.

---

## 1. Executive summary

Standardize the standard ticketed-event public page into ONE shell-agnostic shared body — `EventOfferingBody` — living in `packages/offering-rendering`, rendered byte-identically on buyer-web, business iOS/Android, and consumer iOS/Android. The body renders Seth's locked 9-section vertical structure; its centerpiece is an **inline on-page ticket box** (per-tier quantity steppers, live Σ-all-in running total, in-box Proceed) that REPLACES the separate `/checkout/[eventId]` tier-picker on web/business and pre-populates the cart (landing on cart step (i), quantities still editable) on every surface. All three surfaces fill the body's props from ONE new anon read RPC, `pg_public_event_by_slug`, carrying the full payload incl. vibes/party-types/music-genres pills, a NEW city-level privacy geo field, tickets-left, and all-in tier prices. The package `@mingla/event-rendering` dissolves into `@mingla/offering-rendering` as the one canonical home (phased — see §4B).

---

## 2. Scope & non-goals

**In scope:**
- New shared `EventOfferingBody` in `packages/offering-rendering` (shell-agnostic, `ScrollComponent`-injected).
- The 9-section canonical structure (§3A) incl. the inline ticket box.
- Retire the consumer fork body (`ConsumerEventDetailScreen` standard-event branch wraps the shared body).
- Promote `FoundationEventPreview` content into the shared body; web/business render it; replace the `/checkout/[eventId]` tier-picker with the inline box → cart step (i).
- New canonical read RPC `pg_public_event_by_slug` (anon, SECURITY DEFINER) + per-surface adapters.
- New city-level privacy geo field + migration + wizard/publish capture + read exposure.
- Thread vibes/party-types/music-genres pills end-to-end (close the F-3 drop).
- Package consolidation Phase 1 (§4B): new shared body + alias/gate updates; full event-rendering dissolution is Phase 2 (recommended deferred).

**Non-goals (explicit):**
- RSVP / trip / experience legs (separate META legs — COMMS-0040/0044/0041).
- Admin-web (no public event page).
- Changing the all-in pricing engine, `pg_public_event_tier_allin`, or the checkout/PaymentSheet money flow (reused as-is).
- Re-theming, new motion, or copy beyond what the structure demands.
- Backfilling geo for the 77 geo-less events (rule-9: those simply render the text venue card).

**Assumptions:** the all-in engine, `ticket-checkout-create`, `TicketCartSheet`, and the brand page route are unchanged and reused.

---

## 3. The canonical contract

### 3A. Locked 9-section vertical order (identical on all 3 surfaces)

1. **Cover** — full-bleed media (image/GIF/video), parallax. (`EventCoverMedia` from event-rendering; parallax via the surface shell, NOT inside the body's scroll root.)
2. **Event Name** — `event.name`.
3. **Date & Time** — ORCH-1162 AM/PM formatting (`dateLine`/`dateSubline`; reuse the existing `formatEventDateLine`/AM-PM formatter, single owner).
4. **Pills row** — STRICT order: event format (in-person/online/hybrid) → ALL `vibe_tags` → ALL `party_types` → ALL `music_genres` → tickets-left count. Each group omits entirely when its array is empty (rule-9). Rendered via the shared `ChipGroup` primitive.
5. **TICKET BOX (inline, on-page)** — per-ticket-type quantity steppers; live running total = Σ(`priceAllInGbp` × qty) (server all-in, WYSIWYP, never bare base); the box has its OWN Proceed button. Both in-box Proceed and the floating button (§9) carry the selected tickets into the cart **already populated**, landing on CART STEP (i) where quantities remain editable. Free / waitlist / approval-required / sold-out states drive box + button copy via `resolveOfferingCta` + the per-tier sub-predicates (`ticketIsSoldOut`/`ticketIsDoorOnly`/`ticketSaleEnded`).
6. **Presented By** — host/brand card → links to brand page (`onOpenBrand(brandSlug)`).
7. **About** — collapsible description toggle (read-more/show-less; threshold reused from current bodies).
8. **Where you'll be** — server-proxied Mapbox static map (`buildProxyStaticMapUrl`, ORCH-1165) + a "view on map" card beneath. Address-privacy: when `hideAddressUntilTicket` is true AND the viewer has not purchased, the map renders CITY-LEVEL ONLY (city centroid, lower zoom, NO exact pin) using the new city-geo field (§4A). When neither exact nor city geo exists, OMIT the map (rule-9) and render the honest text venue card.
9. **Floating Get Tickets button** — persistent; reflects the live selected Σ-all-in total; → cart step (i), same as in-box Proceed. Preserves `hideCloseOnWeb` chrome behavior (ORCH-1159) and the float→dock visibility pattern.

### 3B. Shell-agnostic constraint (mandatory)
The body is a PURE CONTENT body. It NEVER hosts a scroll root. Each surface injects its scroll host via `ScrollComponent`:
- buyer-web + business native: RN `ScrollView` (default).
- consumer: gorhom `BottomSheetScrollView` (must remain a DIRECT child of `BaseBottomSheet`). The body MUST NOT wrap `ParallaxCoverShell` as its scroll root (ORCH-1016/1043/1138 freeze). The parallax cover renders as a pinned sibling/header the shell composes, not as the scroll container.

---

## 4. Layered specification

### 4A. Database

**Migration 1 — city-level privacy geo field.** Add to `public.events`:
- `city_geo geometry(Point,4326)` — city centroid lat/lng (privacy-safe location). NULLable, default NULL (rule-9; 77/89 existing events stay NULL → no map, no leak).
- (Keep the existing `city text` label and `location_geo point` exact pin unchanged.)
- **Capture path:** on publish (or address-set), DERIVE `city_geo` from the event's resolved address city centroid (server-side, via the existing Mapbox geocode path used at venue capture — store the city-level centroid, NOT the street point). Spec: the publish RPC / address-write path computes the city centroid once and writes `city_geo`. Do NOT geocode client-side; do NOT fabricate when the city is unknown (leave NULL).
- **Read exposure:** add `city_geo` to `business_public_events_view` AND to the new `pg_public_event_by_slug` payload so the map can render city-level without the exact pin.
- Migration naming: `supabase/migrations/<ts>_orch_1167_event_city_geo.sql`. Follow safe-migration protocol (additive column, NULLable, no backfill).

**Migration 2 — canonical read RPC `pg_public_event_by_slug`.** See §4B-Edge/RPC below. Separate migration `<ts>_orch_1167_pg_public_event_by_slug.sql`.

**RLS / grants:** the RPC is `SECURITY DEFINER`, `STABLE`, owned by the migration role; `GRANT EXECUTE ... TO anon, authenticated`. It reads ONLY anon-safe columns (mirror `business_public_events_view`'s safe projection); it MUST NOT return the exact `location_geo` when `hide_address_until_ticket` AND no purchase context — return `city_geo` + `city` only in that case (privacy enforced server-side, not client-side). Safe-migration protocol: `$function$;` before any GRANT; DROP before widening RETURNS TABLE.

### 4B. The ONE canonical read path — `pg_public_event_by_slug`

**Signature (RETURNS one row / json):**
`pg_public_event_by_slug(p_brand_slug text, p_event_slug text) RETURNS json` (or a single-row TABLE). Anon SECURITY DEFINER STABLE.

**Returns the full payload** sufficient to fill `EventOfferingBody` props from ONE source: event id/name/slugs/description; date fields (`master_start_at`/`master_end_at`/`timezone` for AM/PM); status/endedAt; format inputs (`is_online`, `location_mode`, theme `business_event.format`) OR a precomputed `format` string; venue name + address + `hide_address_until_ticket`; `location_geo` (exact, gated) + NEW `city_geo` + `city`; cover fields; brand card fields; `party_types` + `vibe_tags` + `music_genres`; per-tier ticket rows WITH `all_in_cents` (join `pg_public_event_tier_allin` logic or call the same `compute_all_in_cents`) + capacity/tickets-left; currency; theme overrides. Restricted to `event_type='event'` and published/visible.

**Privacy rule (server-side):** when `hide_address_until_ticket=true`, the RPC omits `address` + exact `location_geo` and returns only `city` + `city_geo` (so the body renders a city-level map with no exact pin). A purchased viewer is out of scope for the anon RPC (the unlock-after-purchase path remains the existing authenticated read; this leg does not regress it).

**Per-surface adapters (3, thin, all calling the ONE RPC):**
- **Web/business:** replace/augment `getPublicEventBySlug` in `mingla-business/src/services/publicEventsService.ts` to call `pg_public_event_by_slug` and map its row → `PublicEventProps` (extended type, §4C). Map `music_genres→musicGenres` (close F-3). Keep `fetchTierAllInCents` semantics but prefer the RPC's embedded all-in to avoid a second round-trip.
- **Consumer:** new hook `app-mobile/src/hooks/usePublicEventBySlug.ts` (React Query, anon) calling the RPC and mapping → the SAME `PublicEventProps`. The consumer standard-event screen feeds the shared body from this (deck-card seed remains the warm-open fast path; the RPC is the cold-open + authoritative source). Thread `partyTypes`/`vibeTags`/`musicGenres`/`city_geo` (close the foundation-mapper drop).

**Query key:** `["publicEventBySlug", brandSlug, eventSlug]` (factory). `staleTime` ~60s; `enabled` on both slugs present.

### 4B-package. Package consolidation (Seth's decision: `@mingla/offering-rendering` is the ONE home; `@mingla/event-rendering` dissolves into it)

**Merge direction:** offering-rendering currently DEPENDS ON event-rendering. The dissolution MOVES event-rendering's exports INTO offering-rendering and flips importers. Because that touches **88 event-rendering import sites + 26 offering-rendering sites + 4 alias config files + the I-MOR-0827 CI gate**, full dissolution in one PR is high-blast-radius.

**RECOMMENDATION — PHASED (do NOT attempt full dissolution this leg):**
- **Phase 1 (THIS leg, ORCH-1167):** (a) Build `EventOfferingBody` IN `packages/offering-rendering`; it may import from `@mingla/event-rendering` (the existing peer-dep) for `EventCoverMedia`, `offeringCta`, theming, types, mapbox builders — no dissolution required to ship the shared body. (b) Retire the consumer fork; web/business render the shared body. (c) Add the inline ticket box + RPC + city-geo. NO mass import-flip. The event body becomes shared THIS leg.
- **Phase 2 (separate follow-on ORCH, recommended):** dissolve `@mingla/event-rendering` into `@mingla/offering-rendering` — move all exports, re-point ~88 imports, update the 4 alias configs (`mingla-business/tsconfig.json` L10–13, `app-mobile/tsconfig.json` L15–18, `mingla-business/metro.config.js` L41–58, `app-mobile/metro.config.js` L23–37), update the I-MOR-0827 CI gate path, delete the old package. Pure mechanical refactor, separately testable, low product risk, high churn — must not block the product change.

**Rationale:** the product win (one shared body, one read path, inline box, pills, city map) lands in Phase 1 without the 88-site churn; the package merge is cosmetic and is safest as an isolated mechanical PR.

### 4C. Shared component — `EventOfferingBody`

**File:** `packages/offering-rendering/EventOfferingBody.tsx` (+ export in `packages/offering-rendering/index.ts`).
**Pure-presentational, props-only, no app-src imports (I-MOR-0827).** Renders on RN-web AND native.

**Prop contract (full):**
```
interface EventOfferingBodyProps {
  event: PublicEventProps;            // extended (§4C-types): musicGenres added, cityGeo added
  brand: PublicBrandProps | null;
  variant: OfferingVariant;           // from computeOfferingVariant
  bookable: boolean;                  // I-PAID-SUPPLY gate
  palette: ThemePalette; theme: ResolvedTheme;
  // shell injection (MANDATORY, shell-agnostic):
  ScrollComponent?: ComponentType<ScrollViewProps>;   // default RN ScrollView
  onScroll?, onScrollViewLayout?, contentBottomInset?, safeAreaTop?;
  // chrome:
  muted: boolean; onToggleMute; onClose; onShare;
  hideCloseOnWeb?: boolean;           // ORCH-1159 (preserve)
  // ticket box state (LIFTED to host so cart can read it):
  ticketQuantities: Record<ticketTypeId, number>;     // per-tier qty
  onChangeTicketQuantity: (ticketTypeId: string, qty: number) => void;
  onProceedToCart: () => void;        // in-box Proceed + floating button both call this
  // links/maps:
  onOpenBrand?: (brandSlug: string) => void;
  onOpenMaps?: (query: string) => void;
  // map URL builder injected (token/functions-base differ per surface):
  staticMapUrl: string | null;        // host computes via buildProxyStaticMapUrl(city OR exact geo)
  testID?: string;
}
```
- The body renders sections 1–9 in the locked order. The **ticket box** is part of the body (steppers + Σ-all-in total + in-box Proceed). The **floating button** is part of the body's pinned overlay (float→dock), calling the same `onProceedToCart`.
- Running total computed IN the body from `ticketQuantities` × `event.tickets[].priceAllInGbp` (WYSIWYP). The host owns nothing pricing-side except passing tickets with `priceAllInGbp`.
- ALL states: loading (host-gated), empty (no tickets → "Not on sale yet"), sold-out / waitlist / pre-sale / past / cancelled / door-only / free (via `resolveOfferingCta`), disabled (`!bookable` → "Booking unavailable"), submitting (host flag). Each with the existing copy from `resolveOfferingCta`.
- a11y: every stepper ±, Proceed, floating button, brand card, map card has an accessibilityLabel; ≥44pt targets; Android glass opaque-fallback policy preserved.

**§4C-types — extend `PublicEventProps`** (in `packages/event-rendering/types.ts`, the contract file):
- Add `musicGenres: string[]` (default `[]`, rule-9) — sibling to existing `partyTypes`/`vibeTags`.
- Add `cityGeo?: { lat: number; lng: number } | null` (default-safe; the city-level privacy centroid).
- Keep `locationGeo` (exact pin) — the host decides which to feed the map builder based on the privacy gate (the RPC already enforces privacy server-side, so for anon `locationGeo` will be null when hidden and only `cityGeo` is present).

### 4D. Hooks / service
- Web: `mingla-business/src/services/publicEventsService.ts` — `getPublicEventBySlug` → `pg_public_event_by_slug`; mapper adds `musicGenres` + `cityGeo`.
- Consumer: new `app-mobile/src/hooks/usePublicEventBySlug.ts` + extend `useConsumerEventFoundation` (or replace its standard-event projection) to thread `partyTypes`/`vibeTags`/`musicGenres`/`cityGeo`.

### 4E. Components per surface (thin shells wrapping `EventOfferingBody`)
- **Web/business:** `FoundationEventPreview` becomes a thin wrapper that renders `EventOfferingBody` with RN `ScrollView` + lifts `ticketQuantities` state; `PublicEventPage` adapter drops the `/checkout/[eventId]` push and instead calls `onProceedToCart` → navigates to the cart step (i) with the cart pre-populated from `ticketQuantities`. The `/checkout/[eventId]` tier-PICKER step is removed (its later cart/payment steps remain).
- **Consumer:** `ConsumerEventDetailScreen` standard-event branch renders `EventOfferingBody` with injected `BottomSheetScrollView`; `onProceedToCart` opens `TicketCartSheet` pre-seeded from `ticketQuantities` (multi-tier), landing on the editable cart step. RSVP branch is UNCHANGED (out of scope).
- **Business preview** (`/event/[id]/preview`): reconcile to render `EventOfferingBody` in a preview/non-bookable mode OR explicitly defer (Open Question OQ-3).

---

## 5. Success criteria (per-surface where parity is manual)

- **SC-1 (structure)** — All 3 surfaces render sections 1–9 in the locked order (§3A). [SC-1-Web / SC-1-bizIOS / SC-1-bizAndroid / SC-1-consIOS / SC-1-consAndroid].
- **SC-2 (pills)** — Pills row shows format → vibes → party-types → music-genres → tickets-left, in that order; each group omits when empty. Verified an event with all four populated shows all four groups on all 3 surfaces.
- **SC-3 (inline box, all-in)** — The on-page ticket box shows per-tier steppers; the running total equals Σ(`priceAllInGbp`×qty) to the cent; matches the floating button; never shows bare base.
- **SC-4 (proceed → cart step i, populated, editable)** — In-box Proceed AND the floating button both land on the cart step with the selected quantities pre-filled and still editable. [Web: cart step replaces tier-picker; Consumer: `TicketCartSheet` pre-seeded.]
- **SC-5 (CTA states)** — Free / waitlist / approval-required / sold-out / pre-sale / past / cancelled / door-only / not-bookable each drive the documented box + button copy from `resolveOfferingCta`.
- **SC-6 (shell-agnostic)** — Consumer body scrolls correctly with `BottomSheetScrollView` as the direct child (no freeze); web/business scroll with `ScrollView`. The body hosts no scroll root.
- **SC-7 (one read path)** — All 3 surfaces fetch from `pg_public_event_by_slug`; adding a field to the RPC payload surfaces on all 3 without a second mapper edit (verified by adding `musicGenres` this leg).
- **SC-8 (city-level map, no exact pin when hidden)** — When `hide_address_until_ticket` and anon, the map renders at city zoom centered on `city_geo` with NO exact pin; when an event has neither geo, no map renders (text venue card only); when address is public + `location_geo` present, the exact pin renders.
- **SC-9 (web close-X)** — ORCH-1159 preserved: floating close X hidden on web, present on native; Share present everywhere.

---

## 6. Invariants

**Preserve:**
- **I-MOR-0827-PACKAGE-ISOLATION** — `EventOfferingBody` imports nothing from `app-mobile/src` or `mingla-business/src`. Test: existing isolation gate extended to cover the new file.
- **WYSIWYP / all-in (ORCH-1147)** — running total = Σ all-in. Test: SC-3 unit test.
- **I-PAID-SUPPLY-REQUIRES-CHARGES-ENABLED (ORCH-1076)** — `bookable=false` → box/CTA disabled. Test: SC-5.
- **Rule-9** — empty pill arrays / missing geo omit, never fabricate. Test: SC-2 + SC-8 edge cases.

**Propose (DRAFT — orchestrator flips ACTIVE on CLOSE):**
- **I-PROPOSED-1167-CANONICAL-9-SECTION-ORDER** — the shared `EventOfferingBody` renders exactly sections 1–9 in the locked order; a structural test asserts the render-tree order.
- **I-PROPOSED-1167-SHELL-AGNOSTIC-BODY** — `EventOfferingBody` declares no scroll container; it accepts `ScrollComponent`. Grep gate: the body file contains no `ScrollView`/`BottomSheetScrollView`/`FlatList` as its root.
- **I-PROPOSED-1167-ALLIN-PRICE-IN-TICKET-BOX** — the box running total uses `priceAllInGbp` (never `priceGbp` alone) — grep/unit gate.
- **I-PROPOSED-1167-CITY-LEVEL-MAP-NO-EXACT-PIN-WHEN-HIDDEN** — when `hide_address_until_ticket`, the anon payload carries no exact `location_geo`; the map uses `city_geo`. Test: RPC returns null `location_geo` + non-null `city_geo` for a hidden-address event.
- **I-PROPOSED-1167-ONE-READ-RPC** — all 3 surfaces read the standard-event public page via `pg_public_event_by_slug`; grep gate that no surface reads `business_public_events_view` for the standard-event PAGE body fields (theme-only reads excepted).

---

## 7. Test cases

| Test | Scenario | Input | Expected | Layer |
|------|----------|-------|----------|-------|
| T-01 | section order | event w/ all sections | render tree = 1..9 order | component |
| T-02 | pills all populated | vibe_tags+party_types+music_genres non-empty | 4 pill groups + tickets-left in order | component |
| T-03 | pills empty | all arrays `[]` | only format + tickets-left; no empty groups | component |
| T-04 | all-in total | 2 tiers, qty 2+1, allIn 50/30 | total = 130 (Σ allIn), not base | unit |
| T-05 | proceed populates cart | qty set, tap in-box Proceed | cart step opens w/ those qtys editable | integration (web+consumer) |
| T-06 | floating == in-box | scroll, tap floating | same cart, same total | integration |
| T-07 | sold-out | all tiers cap 0, no waitlist | box+button "Sold out", non-tappable | unit (resolveOfferingCta) |
| T-08 | waitlist | sold-out + waitlistEnabled | "Join waitlist" tappable | unit |
| T-09 | not bookable | bookable=false | "Booking unavailable" | unit |
| T-10 | shell-agnostic | mount w/ BottomSheetScrollView | scrolls, no freeze | runtime (consumer sim) |
| T-11 | RPC privacy | hide_address event, anon | payload: address null, location_geo null, city_geo set | edge/SQL |
| T-12 | map city-level | hidden + city_geo | map at city zoom, no pin | component |
| T-13 | map omitted | no geo at all | no map, text venue card | component |
| T-14 | map exact | public address + location_geo | exact pin renders | component |
| T-15 | one-read-path | add field to RPC | appears on all 3 surfaces, one mapper edit | structural |
| T-16 | web close-X | web render | no floating X; native has X | component (platform) |
| T-17 | isolation | grep EventOfferingBody | no app-src imports | CI gate |

---

## 8. Implementation order

1. **DB:** Migration 1 (`city_geo` column + view exposure + publish-time city-centroid derivation). Migration 2 (`pg_public_event_by_slug` RPC + grants). Apply via Management API per safe-migration protocol (DO NOT auto-apply; orchestrator/Seth applies).
2. **Types:** extend `PublicEventProps` (`musicGenres`, `cityGeo`) in `packages/event-rendering/types.ts`.
3. **Shared body:** build `packages/offering-rendering/EventOfferingBody.tsx` + export.
4. **Service/hooks:** web `getPublicEventBySlug` → RPC + mapper (`musicGenres`/`cityGeo`); consumer `usePublicEventBySlug.ts` + foundation threading.
5. **Web/business:** `FoundationEventPreview` → thin wrapper of `EventOfferingBody`; `PublicEventPage` adapter drops `/checkout/[eventId]` tier-picker push → `onProceedToCart` to cart step (i).
6. **Consumer:** `ConsumerEventDetailScreen` standard-event branch → `EventOfferingBody` + `TicketCartSheet` pre-seed.
7. **Preview route:** reconcile or defer (OQ-3).
8. **Tests + CI gates** (§7, §9). 9. **Isolation gate** path update.

---

## 9. Regression prevention (fails-on-revert)

- **Structural section-order test** (T-01) — asserts the `EventOfferingBody` render tree emits sections in 1..9 order; FAILS if reordered/reverted.
- **All-in grep+unit gate** (I-PROPOSED-1167-ALLIN-PRICE-IN-TICKET-BOX) — FAILS if the box total reads `priceGbp` without `priceAllInGbp`.
- **Shell-agnostic grep gate** — FAILS if `EventOfferingBody` root becomes a scroll container.
- **One-read-RPC grep gate** — FAILS if a surface reintroduces a divergent read for the page body.
- **Isolation gate** (T-17) — FAILS if the body imports app-src.
- Each gate carries a protective comment citing ORCH-1167 + the invariant id.

---

## 10. Open questions
- **OQ-1:** city-centroid derivation source — reuse the existing Mapbox geocode at publish to compute the city centroid, or store a coarse rounded `location_geo`? RECOMMEND geocode-the-city-name to a centroid (avoids any street-pin leak). Needs confirm.
- **OQ-2:** purchased-viewer address unlock on the anon page — out of scope here (stays on the existing authenticated read). Confirm this leg need not change the post-purchase unlock.
- **OQ-3:** business `/event/[id]/preview` (the separate `PreviewEventView`) — reconcile to `EventOfferingBody` now, or defer to a follow-on? RECOMMEND defer (it is draft-preview, not the public page) unless Seth wants preview parity this leg.
- **OQ-4:** is full `event-rendering` dissolution required to CLOSE this leg, or accepted as Phase 2? SPEC RECOMMENDS Phase 2 (separate ORCH). Needs Seth/orchestrator sign-off.

## 11. Cross-Surface Impact Declaration

| # | Surface | Covered | User-visible behavior | Files | Parity |
|---|---------|---------|-----------------------|-------|--------|
| 1 | Consumer iOS | YES | 9-section shared body + inline box → cart | `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`, new `usePublicEventBySlug.ts`, `useConsumerEventFoundation.ts`, `TicketCartSheet.tsx` | shared body |
| 2 | Consumer Android | YES | same | same | shared body |
| 3 | Buyer/anon Web | YES | inline box REPLACES `/checkout` tier-picker | `mingla-business/src/components/event/FoundationEventPreview.tsx`, `PublicEventPage.tsx`, `publicEventsService.ts`, route `app/e/[brandSlug]/[eventSlug].tsx` | shared body |
| 4 | Business iOS | YES | same shared body | same business files | shared body |
| 5 | Business Android | YES | same | same | shared body |
| 6 | Admin Web | NO | no public event page | — | n/a |
| 7 | Business Web preview | DEFER (OQ-3) | currently separate `PreviewEventView` | `app/event/[id]/preview.tsx` | manual / deferred |

## 12. Allowlist + DO-NOT-TOUCH

**Allowlist (implementor may modify):**
- `packages/offering-rendering/EventOfferingBody.tsx` (new) + `index.ts`
- `packages/event-rendering/types.ts` (add `musicGenres`, `cityGeo`)
- `mingla-business/src/components/event/FoundationEventPreview.tsx`, `PublicEventPage.tsx`
- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
- `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`, `app-mobile/app/e/[brandSlug]/[eventSlug].tsx`
- `app-mobile/src/hooks/usePublicEventBySlug.ts` (new), `useConsumerEventFoundation.ts`, `usePublicEventTickets.ts`, `useEventTheme.ts`
- `app-mobile/src/components/expandedCard/TicketCartSheet.tsx`, `app-mobile/src/hooks/useTicketCart.ts`
- 2 new migrations under `supabase/migrations/`; `business_public_events_view` exposure
- new CI gates under `packages/scripts/ci/`; tests under each `__tests__/`
- (Phase 2 only, separate PR) the 4 alias configs + I-MOR-0827 gate path

**DO-NOT-TOUCH:**
- RSVP / trip / experience bodies + their routes/hooks/RPCs (`RsvpPublicBody`, `TripPreview`, experience pages, `ConsumerTripDetailScreen`, RSVP branch of `ConsumerEventDetailScreen`).
- The all-in pricing engine (`compute_all_in_cents`, `pg_public_event_tier_allin`), `ticket-checkout-create`, PaymentSheet money flow.
- `mingla-admin/`.
- Legacy `packages/event-rendering/PublicEventPage.tsx` cancelled/password fallback (unless subsumed — stop-and-amend).
- Do NOT mass-flip the 88 event-rendering imports this leg (that is Phase 2).

## 13. Downstream routing
Next = **mingla-implementor** in this worktree (`~/Desktop/mingla-orchs/ORCH-1167-[event-page-canonical]/` on branch `ORCH-1167-event-page-canonical`). Then mingla-tester (all 5 primary surfaces incl. consumer sim for the shell-agnostic scroll). Then orchestrator CLOSE (flip the 5 I-PROPOSED-1167-* invariants ACTIVE). Coordinate any standard-event-page changes through META-ORCH-1166 (COMMS-0038). Migrations are spec-only here — applied by Seth/orchestrator at implement-time via Management API.
