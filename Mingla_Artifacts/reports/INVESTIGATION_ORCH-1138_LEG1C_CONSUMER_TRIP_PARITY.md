# INVESTIGATION — ORCH-1138 Leg 1C: Consumer Trip Surface → Direction-A Parity

**Worktree:** `~/Desktop/mingla-orchs/ORCH-1138-[trip-page-redesign]/` on `ORCH-1138-trip-page-redesign` (HEAD `d625301fc`, rebased clean on origin/main).
**Mode:** INVESTIGATE (half 1 of INVESTIGATE-THEN-SPEC). NO fix proposed here.
**Scope of the question:** how the consumer app renders a trip detail today, its exact data shape vs the business/web parity target, how its reserve/checkout works, and what blocks rendering the SAME Direction-A foundation on the consumer surface.
**Confidence:** `probable` (source-traced across all 5 layers + migration-chain authoritative; not sim-driven — this is a build-readiness audit, not a reproducer-bound runtime bug. The one runtime risk — sticky-footer scroll-freeze on gorhom — is named below and must be device-verified at TEST).

---

## Symptom summary (expected vs actual)

- **Expected (parity target):** the consumer trip detail looks like the already-shipped business/web public trip page (`/t/{brandSlug}/{tripSlug}` → `TripPreview` FOUNDATION mode): immersive parallax cover, body-level fixed chrome, brand-themed palette, count-aware day galleries, meta chips reading real columns, leaving-from→destination route block, static Mapbox map, refund ladder, and a FLOATING brand-accent reserve bar stuck to the bottom.
- **Actual (consumer today):** `ConsumerTripDetailScreen` renders a **bespoke dark-themed** body inside a gorhom `BaseBottomSheet` — hardcoded `ACCENT="#FF6B35"` / `WARM="#eb7825"`, NO brand palette, NO parallax cover (a flat 320px hero), and a **Reserve bar that is the last child of the scroll content** (it scrolls off; it does NOT float/stick). Different component, different data shape, different look.

---

## Investigation manifest (every file read, in trace order)

| # | File | Why |
|---|------|-----|
| 1 | `COMMS_LEDGER.md` (active table) | Entry gate; surfaced COMMS-0009 (anon-brands constraint) + trip-RPC hazards |
| 2 | `packages/offering-rendering/{index,ParallaxCoverShell,package}.ts(x)` | The shared Direction-A foundation primitives (parity engine) |
| 3 | `mingla-business/src/components/trip/TripPreview.tsx` | The parity TARGET render (FOUNDATION mode) |
| 4 | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | The business route that composes TripPreview + owns checkout/share/mute + the floating bar |
| 5 | `mingla-business/src/components/trip/TripReserveBar.tsx` | The floating bar (the exact CTA look Seth wants on consumer) |
| 6 | `mingla-business/src/hooks/usePublicTripBySlug.ts` | The business data shape (`Trip` from tripsService) + how it reads brands/theme |
| 7 | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | The consumer render today + reserve wiring + the gorhom scroll structure |
| 8 | `app-mobile/src/hooks/useConsumerTripDetail.ts` | The consumer data shape (`ConsumerTripDetail`) + anon-only constraint |
| 9 | `app-mobile/src/hooks/useEventTheme.ts` | The EXISTING consumer theme-resolve path (the reuse key for palette) |
| 10 | `app-mobile/app/index.tsx` (2285, 259-266) | How the deck opens the trip detail (`viewingTrip` + `DiscoverTripRow` seed) |
| 11 | `app-mobile/metro.config.js` + `tsconfig.json` | Alias wiring — offering-rendering is NOT yet aliased |
| 12 | `app-mobile/package.json` | `react-native-svg` 15.12.1 present (offering-rendering peer dep satisfied) |
| 13 | `mingla-business/src/utils/mapboxStaticImage.ts` | The static-map util + its token-read path (business-only today) |
| 14 | `app-mobile/app.config.ts` | Mapbox token NOT in `extra` (contradicts the dispatch assumption) |
| 15 | migrations: `…0972_universal_authoring`, `…0964_brand_event_theme_columns`, `…1006_pricing_views`, anon-grant chain | Authoritative current state of the consumer-readable views/theme columns |
| 16 | `app-mobile/src/components/ui/BaseBottomSheet.tsx` (480-610) | The gorhom sticky-footer vs frozen-scroll contract (THE floating-reserve constraint) |
| 17 | `app-mobile/src/components/expandedCard/TicketCartSheet.tsx` | Proof that `stickyFooter` works in the CURRENT BaseBottomSheet |
| 18 | `app-mobile/src/screens/Trip/__tests__/orch_1016_consumer_trip_detail.rework_sheet.test.tsx` | The existing structure-guard tests (R1f-3 conflicts with a sticky footer) |
| 19 | `app-mobile/src/payments/nativeCheckoutFlow.ts` (34, 74, 196-211) | The consumer checkout contract (`lines`, `paymentPlanChoice`) |

---

## Q-scorecard

**Q1 — How does a consumer open a trip detail, and in what container does it render?**
Deck/Discover row tap → `handleOpenTripFromDiscover(seed: DiscoverTripRow)` sets `viewingTrip` (`app/index.tsx:264-266`); `app/index.tsx:2285-2296` mounts `<ConsumerTripDetailScreen brandSlug tripSlug seed tabBarAware />` as a full-screen overlay. The cold deep-link route `app/t/[brandSlug]/[tripSlug].tsx` mounts the same screen with `seed=null`. The detail body renders **inside a gorhom `BaseBottomSheet`** (`scrollMode="scroll"`, `hidesBottomNav`, two snap points, opens at 90%) — NOT a full page. **Verdict: deck-tap → `ConsumerTripDetailScreen` → `BaseBottomSheet` (gorhom). `probable`.**

**Q2 — What is the consumer trip data shape, and how does it differ from `usePublicTripBySlug`'s payload?**
Consumer: `ConsumerTripDetail` from `useConsumerTripDetail` (`useConsumerTripDetail.ts:158-193`). Business: `{ trip: Trip, brand, themeOverrides, bookable }` where `Trip` is the rich `tripsService` type. Mapping deltas (Verdict table below). **Verdict: DIFFERENT shapes; an adapter is required, and the consumer shape is MISSING three fields the FOUNDATION render uses (theme, destination lat/lng, per-tier ticketsRemaining). `proven` (both shapes read verbatim).**

| FOUNDATION needs (`TripPreview`) | Consumer `ConsumerTripDetail` has? | Notes |
|---|---|---|
| `palette` + `theme` (ResolvedTheme) | ✗ not in the shape | Resolvable via existing `useEventTheme(card)` — see F-3 |
| cover url/type | ✓ `coverMediaUrl` / `coverMediaType` | direct |
| title / description | ✓ | direct |
| brand name / cover | ✓ `brandName`; ✗ brand cover img | brand cover not fetched (brand chip tile degrades to accentWash) |
| dates (start/end) | ✓ `startAt` / `endAt` | direct |
| capacity + seats-left chip | ✓ `totalCapacity`, `spotsLeft` | per-tier `ticketsRemaining` NOT present → sold-out chip must derive from `spotsLeft` |
| departure / destination text | ✓ `departureText` / `destinationText` | direct |
| destination **lat/lng** (the map) | ✗ NOT fetched | the consumer hook reads a fixed `events` column list; no `theme.business_trip` JSON, no geo cols → **map cannot render** (F-4) |
| per-day itinerary (ordinal/title/narrative/media) | ✓ `days[]` with `media` | direct (`coerceTripDayMedia`) |
| inclusions (included/excluded) | ✓ `inclusions[]` | direct |
| pricing tiers (price/currency/installments) | ✓ `tiers[]` + `installmentSchedule` | direct |
| refund policy + booking deadline | ✓ `refundPolicy`; ✓ `bookingDeadline` / `bookingsClosed` | direct |
| `bookable` (paid-charge gate) | ✓ `bookable` | direct |

**Q3 — How does the consumer reserve/checkout work, and does it match the web chain?**
Reserve → `setReserveSheetVisible(true)` (`ConsumerTripDetailScreen.tsx:899`) → opens a sibling `ExpandedBusinessEventSheet` seeded by `tripToBusinessEventCard(detail)` (line 938-963) → tier-select → cart → `runNativeCheckout` → `ticket-checkout-create`. It does **NOT** use the web `/checkout-trip` chain (the business route's `router.push(tripCheckoutPath(...))`). `nativeCheckoutFlow` accepts `lines` + optional `paymentPlanChoice` (`nativeCheckoutFlow.ts:34,74,196-211`). The consumer already threads the explicit plan choice for plan trips (`paymentPlanChoice={detail.hasPlan ? paymentPlanChoice : undefined}`, line 947). **Verdict: native checkout via ExpandedBusinessEventSheet → runNativeCheckout; preserve verbatim. `proven`.**

**Q4 — Is `@mingla/offering-rendering` wired into app-mobile?**
NO. `metro.config.js:21-64` aliases event-rendering, brand-rendering, theme-animations, payments-native, phone-input, location-input — NOT offering-rendering. `tsconfig.json:8-24` mirrors the same set, no offering-rendering. `react-native-svg@15.12.1` (an offering-rendering peer dep) IS present (`package.json:157`). **Verdict: must add the alias to BOTH metro.config.js (`extraNodeModules`) and tsconfig.json (`paths`), mirroring event-rendering exactly. `proven`.**

**Q5 — Can the consumer surface resolve the SAME Direction-A theme/palette as the business page WITHOUT a schema/edge change?**
YES — via the EXISTING `useEventTheme(card)` hook (`useEventTheme.ts`), which reads `business_public_events_view` columns `brand_theme_color/font/animation` + `theme_color_override/font/animation` (anon-granted) and returns a `ResolvedTheme`. The authoritative latest `business_public_events_view` (`20260802000001_orch_1006_pricing_views.sql:55-80`, the chronologically-last CREATE — verified no later migration recreates it) carries all six theme columns + `event_type`. `createThemePalette(theme)` + `resolveOfferingSurface(theme)` are the same package functions the business route uses. **Verdict: theme/palette parity is achievable with ZERO schema/edge change, reusing `useEventTheme`. `proven`.** (Contrast: the business `usePublicTripBySlug` reads `brands` DIRECTLY — that path is FORBIDDEN on the consumer per COMMS-0009 / I-ANON-BRANDS-VIA-DEFINER-VIEW; the consumer must NOT copy it.)

**Q6 — Can the floating reserve bar STICK to the bottom inside the gorhom sheet (Seth's explicit ask)?**
The proven non-frozen sticky-footer path EXISTS in the current BaseBottomSheet (`BaseBottomSheet.tsx:514-573`): when `stickyFooter` is provided it renders `{header}{stickyBody flex:1 BottomSheetScrollView}{footerNode}` as DIRECT children of `<BottomSheet>` — header pinned top, scroll claims the bounded slack, footer pinned bottom. **`TicketCartSheet.tsx:731` uses exactly this in production today** (post-META-ORCH-0991 Bug 4a fix). HOWEVER, ORCH-1016's earlier on-device finding said `stickyFooter` "froze on device" for the trip detail (`ConsumerTripDetailScreen.tsx:22-37`) — that finding PREDATES the Bug-4a fix, and the trip detail was left on the BARE scroll-the-footer pattern and never migrated. The existing test `R1f-3` (`orch_1016_consumer_trip_detail.rework_sheet.test.tsx:103-105`) hard-asserts the trip detail does NOT use `stickyFooter=` — that guard is now stale relative to the current primitive. **Verdict: a sticky/floating reserve IS achievable via `stickyFooter` (proven by TicketCartSheet), but (a) it must be device-verified for scroll-freeze, and (b) the obsolete R1f-3 guard must be retargeted. `probable` (proven mechanism + production precedent; trip-specific device proof owed at TEST).**

**Q7 — Can the "Where you'll be" static map render on the consumer surface?**
Two blockers: (1) the consumer trip data has NO destination lat/lng (Q2/F-4); (2) `mapboxStaticImage.ts` lives ONLY in `mingla-business/src/utils/` (not app-mobile, not a shared package) and reads the token from `Constants.expoConfig.extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` first / static `process.env` fallback — and app-mobile's `app.config.ts:17-37` does NOT put that token in `extra`. **Verdict: the map is NOT free on consumer; it needs (a) a geo data add to the consumer hook and (b) the util shared + a token path. Both are real adds → the spec must either include them or DEFER the map on consumer (fail-safe to the honest pin+caption, rule 9). `proven`.** (The dispatch's "app-mobile already exposes EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN" is INACCURATE — see F-5.)

**Q8 — Is `TripPreview` itself reusable on the consumer surface, or is a parallel render required?**
`TripPreview` FOUNDATION mode imports HEAVILY from `mingla-business/src/` (`constants/designSystem`, `ui/EventCoverMedia`, `ui/Icon`, `utils/mapboxStaticImage`, `offering/CollapsibleDescription`, `services/refundPolicyService`, `services/tripsService` types, `store/currentBrandStore`). It is an APP-LOCAL component, NOT a shared package, and binds to the business `Trip` type. It cannot be imported across the app boundary (app-mobile cannot import `mingla-business/src/*`). **Verdict: `TripPreview` is NOT directly reusable on the consumer; the reuse path is the LAYER BELOW it — the shared `@mingla/offering-rendering` primitives (ParallaxCoverShell, ChipGroup, CountAwareGallery, useResponsiveLayout) + `@mingla/event-rendering` (palette/theme/EventCoverMedia/boldFontFamily). `proven`.** This is the crux design decision for the SPEC.

---

## Findings (six-field evidence)

### F-1 — `@mingla/offering-rendering` is unwired in app-mobile (build blocker)
- **Symptom:** any `import … from "@mingla/offering-rendering"` in app-mobile fails to resolve (Metro + TS).
- **Layer:** code / build config.
- **Probe:** `grep -n "offering-rendering" app-mobile/metro.config.js app-mobile/tsconfig.json`.
- **Evidence:** zero hits. `metro.config.js:21-64` aliases six packages, none is offering-rendering; `tsconfig.json:8-24` same. `react-native-svg@15.12.1` present (`package.json:157`).
- **Mechanism:** Metro uses Node resolution (not tsconfig paths) → without `extraNodeModules` the import 500s the bundler; TS without `paths` red-squiggles + fails typecheck CI.
- **Severity:** CONFIRMED ROOT CAUSE (of "can't even import the foundation").

### F-2 — The consumer trip detail renders a bespoke, un-themed body (the parity gap)
- **Symptom:** consumer trip detail is hardcoded dark + warm-orange, flat hero, no parallax, footer scrolls.
- **Layer:** code.
- **Probe:** read `ConsumerTripDetailScreen.tsx` verbatim.
- **Evidence:** `ACCENT="#FF6B35"` / `WARM="#eb7825"` (lines 107-108); `styles.hero { height:320 }` flat `EventCoverMedia` (line 973, 458-474); `reserveFooter` is the **second child of the bare scroll** (lines 916-934) → it is part of scroll content, not pinned. No `palette`/`theme`/`ParallaxCoverShell`/`createThemePalette` anywhere in the file.
- **Mechanism:** the screen was built (ORCH-1016) before the Direction-A foundation existed; it never adopted the shared primitives or brand theming.
- **Severity:** CONFIRMED ROOT CAUSE (of the look/behaviour divergence this leg fixes).

### F-3 — Theme/palette parity is reachable via the EXISTING `useEventTheme` (no schema change)
- **Symptom:** N/A (enabling finding).
- **Layer:** schema + code.
- **Probe:** read `useEventTheme.ts`; trace `business_public_events_view` to its authoritative latest CREATE.
- **Evidence:** `useEventTheme.ts:50-70` selects `brand_theme_color,brand_theme_font,brand_theme_animation,theme_color_override,theme_font_override,theme_animation_override` from `business_public_events_view` and returns `resolveTheme(...)`. Latest view CREATE = `20260802000001_orch_1006_pricing_views.sql:55-80` (all six cols + `event_type`), anon-granted; no later migration recreates the view (chronological grep of all 10 CREATEs).
- **Mechanism:** the consumer's `card.eventId` (= `detail.tripId`) feeds `useEventTheme` → `ResolvedTheme` → `createThemePalette` → the SAME palette the business page resolves; trips are `events` rows so the events-view theme columns apply identically.
- **Severity:** SECONDARY ROOT CAUSE addressed (it removes the apparent "consumer can't theme because it can't read brands" blocker).

### F-4 — Consumer trip data has NO destination geo (map cannot render)
- **Symptom:** "Where you'll be" map has no coordinates on consumer.
- **Layer:** data / code.
- **Probe:** `grep destinationLat|destination_lat|business_trip useConsumerTripDetail.ts tripsDiscoveryService.ts`.
- **Evidence:** zero hits. `useConsumerTripDetail.ts:291-297` selects a FIXED `events` column list (`id, slug, brand_id, title, description, destination_text, departure_text, cover_media_url, cover_media_type, timezone, bookings_closed, booking_deadline, refund_policy`) — no geo, no `theme.business_trip` JSON. The business path gets lat/lng from `event.theme.business_trip` (`usePublicTripBySlug.ts:243,291-293`).
- **Mechanism:** rule-9 null-guard → the map block is correctly hidden, but that means the consumer page is missing a section the business page shows when coords exist.
- **Severity:** SUSPECTED CONTRIBUTOR (a parity DELTA the spec must consciously close-or-defer; not a crash).

### F-5 — Mapbox token is NOT in app-mobile `expoConfig.extra` (dispatch assumption is inaccurate)
- **Symptom:** `getPublicMapboxToken()` would read `extra.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` → undefined on app-mobile.
- **Layer:** config.
- **Probe:** `grep MAPBOX app-mobile/app.config.ts app.json eas.json`; read the `extra` block.
- **Evidence:** `app.config.ts:17-37` `extra` block contains only Google client IDs — NO mapbox key. The only MAPBOX hit in app-mobile is `.env.example` (and `busynessService.ts`, unrelated). The util's fallback is a STATIC `process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN` (`mapboxStaticImage.ts:29`) — inlined by babel-preset-expo ONLY if the var is set at build time.
- **Mechanism:** unless the EAS build env sets `EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN`, the util returns null → the map fails safe (honest pin+caption). Functionally safe, but the map will silently not appear on consumer until the token path is wired.
- **Severity:** SUSPECTED CONTRIBUTOR (corrects the dispatch; the map's token path needs an explicit decision).

### F-6 — `TripPreview` is app-local (business), not portable to consumer
- **Symptom:** can't `import { TripPreview } from "mingla-business/..."` in app-mobile.
- **Layer:** code / architecture.
- **Probe:** read `TripPreview.tsx` import block.
- **Evidence:** `TripPreview.tsx:37-70` imports from `../../constants/designSystem`, `../ui/EventCoverMedia`, `../ui/Icon`, `../../utils/mapboxStaticImage`, `../offering/CollapsibleDescription`, `../../services/refundPolicyService`, `../../services/tripsService` (the `Trip` type), `../../store/currentBrandStore` — all `mingla-business/src/` paths. It is bound to the business `Trip` type.
- **Mechanism:** the monorepo isolates app code per app; only `packages/*` cross the boundary (I-MOR-0827-PACKAGE-ISOLATION). So reuse must happen at the `@mingla/offering-rendering` + `@mingla/event-rendering` primitive layer, not at `TripPreview`.
- **Severity:** CONFIRMED ROOT CAUSE (of the "reuse, don't fork" design path — it forces composing the primitives on the consumer side rather than importing TripPreview).

### F-7 — The floating-reserve-in-sheet path collides with an obsolete ORCH-1016 guard
- **Symptom:** wiring a `stickyFooter` reserve bar would fail the existing `R1f-3` test.
- **Layer:** code / tests.
- **Probe:** read BaseBottomSheet sticky-footer branch + the rework_sheet test.
- **Evidence:** BaseBottomSheet `:514-573` has a proven `{header}{flex:1 scroll}{footerNode}` sticky-footer path; `TicketCartSheet.tsx:731` uses it. But `orch_1016_consumer_trip_detail.rework_sheet.test.tsx:103-105` asserts the trip detail does NOT use `stickyFooter=` (citing ORCH-1016's pre-Bug-4a freeze).
- **Mechanism:** the trip detail kept the BARE footer-scrolls pattern from before BaseBottomSheet's sticky-footer was fixed; the guard locked that in. Making the reserve FLOAT requires retargeting that guard and device-proving no freeze.
- **Severity:** SECONDARY ROOT CAUSE (the central runtime risk + test-contract change for Seth's floating-bar ask).

### F-8 (Static analysis / pattern) — consumer hardcodes hex tokens; business surfaces palette
- **Symptom:** consumer trip styles use literal hex (`#FF6B35`, `rgba(...)`) per ORCH-1016's intent; business uses `offeringSurfaceStyles(palette)`.
- **Layer:** code.
- **Evidence:** `ConsumerTripDetailScreen.tsx:969-1175` literal-hex StyleSheet; `TripPreview.tsx:273` `offeringSurfaceStyles(palette)`.
- **Mechanism:** moving to the foundation replaces literal hex with palette-driven surfaces (the parity itself).
- **Severity:** RULED OUT as a bug (intentional pre-foundation choice); noted so the SPEC's restyle is expected, not a regression.

---

## Five-Truth-Layer reconciliation

| Layer | Truth | Contradiction? |
|-------|-------|----------------|
| **Docs** | MEMORY + dispatch: render the SAME Direction-A foundation on consumer; floating reserve sticks; no schema/edge change unless required. | Dispatch claims app-mobile "already exposes EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN" — **CONTRADICTED by config** (F-5). Dispatch implies reuse `TripPreview` — **refined: reuse the primitives BELOW it** (F-6). |
| **Schema** | `business_public_events_view` exposes theme cols (anon); consumer hook cannot read `brands` directly (COMMS-0009); consumer trip data lacks geo (F-4). | Business page reads `brands` directly — that path is forbidden on consumer (flagged, NOT a bug in business). |
| **Code** | Consumer = bespoke screen in a gorhom sheet, footer scrolls; business = TripPreview/ParallaxCoverShell, footer floats. | F-7: BaseBottomSheet has a working sticky-footer the trip detail never adopted; an ORCH-1016 test guards the old shape. |
| **Runtime** | Not driven this turn (build-readiness audit). The sole runtime unknown = sticky-footer scroll-freeze (must device-verify at TEST). | None unresolved on paper; TicketCartSheet is the live proof the sticky-footer path works. |
| **Data** | `useEventTheme(card)` returns a real ResolvedTheme for the trip's eventId via the anon view. | None. |

---

## Blast radius / cross-surface map

- **In scope (this leg):** Consumer iOS + Consumer Android (`app-mobile/` — `ConsumerTripDetailScreen.tsx`, the new consumer data-adapter, `metro.config.js`, `tsconfig.json`, the new consumer floating reserve, possibly a geo add to `useConsumerTripDetail.ts`).
- **Shared, touched read-only (do NOT regress):** `packages/offering-rendering/*`, `packages/event-rendering/*` (consumed, not modified — they already render on native per ParallaxCoverShell's native branch).
- **Out of scope (do NOT touch):** the business/web trip page (`TripPreview.tsx`, `app/t/[…].tsx`, `usePublicTripBySlug.ts`, `TripReserveBar.tsx`, `mapboxStaticImage.ts`) — parity is by CONVERGENCE on the shared primitives, NOT by editing the business render. The consumer deck card + the existing `runNativeCheckout`/`ExpandedBusinessEventSheet` checkout (preserve verbatim). Admin web + business preview: N/A.
- **Recurring pattern:** this is the THIRD consumer surface to converge on a shared rendering package (event-rendering, then offering-rendering) — the alias-add + primitive-compose pattern is established (mirror `useEventTheme`'s view-read for theme).

---

## Invariant impact (flagged, NOT pre-decided)

- **I-ANON-BRANDS-VIA-DEFINER-VIEW / COMMS-0009** — the consumer MUST keep resolving theme/brand via `business_public_events_view` (`useEventTheme`), NEVER `.from('brands')`. The data-adapter must honor this.
- **I-MOR-0827-PACKAGE-ISOLATION** — reuse happens at `packages/*`; no app→app import; the consumer composes primitives.
- **ORCH-1016 sheet-scroll invariants** (I-BOTTOMSHEET-INLINE-SCROLL-BINDING + the orch-1043/1016 strict-greps) — the floating-reserve change must satisfy the gorhom direct-child contract; the obsolete trip-specific `R1f-3` guard needs retargeting (SPEC concern).
- **ANDROID_GLASS_USES_OPAQUE_FALLBACK** — the consumer foundation render must keep opaque Android fills (the primitives + TripReserveBar already honor this).
- **Constitution rule 9** — render only real fields; map/seats-left/brand-cover degrade honestly when data is absent.
- **Proposed (DRAFT, for SPEC):** `I-PROPOSED-TRIP-PAGE-SHARED-FOUNDATION-ALL-SURFACES` — the trip page renders via the shared foundation on web + business + consumer.

---

## Discoveries for Orchestrator (side issues)

1. **Dispatch inaccuracy:** app-mobile does NOT wire the Mapbox token into `expoConfig.extra` (F-5). Surface to Seth — affects whether the consumer "Where you'll be" map can render at all this leg.
2. **Stale test guard:** `orch_1016_consumer_trip_detail.rework_sheet.test.tsx` R1f-3 will need retargeting once the reserve floats (F-7). It is an intentional ORCH-1016 contract; flag so the change is recognized as deliberate, not a regression.
3. **Geo data gap:** the consumer trip pipeline carries no destination lat/lng (F-4); the business page does (via `theme.business_trip`). A parity DELTA independent of this leg's look-work.
4. **COMMS context (read, FYI):** COMMS-0029/0030 (trip RPC clobber + iOS build) are WARN — this leg produces NO migration/edge/deploy, so neither blocks it; noted for awareness.

---

## Confidence level

`probable`. All five layers traced; migration chain resolved to authoritative current state (rule-0 verified — the orch_1006 view is the last CREATE and preserves theme cols). The single runtime unknown (gorhom sticky-footer scroll-freeze for THIS sheet) is named, has a production precedent that works (TicketCartSheet), and is the one item that must be device-proven at TEST — it is not source-decidable.

## Recommended next phase + scope

**SPEC** (this same agent, next file). Scope direction (NOT a fix): wire `@mingla/offering-rendering` into app-mobile; build a consumer data-adapter (`ConsumerTripDetail` + `useEventTheme` → the foundation props) that honors COMMS-0009; compose `ParallaxCoverShell` + the foundation primitives in the consumer sheet to match Direction-A; make the reserve bar FLOAT via the proven `stickyFooter` path (retargeting R1f-3) wired to the existing `runNativeCheckout`/`ExpandedBusinessEventSheet`; decide map-on-consumer (include-with-geo-add vs defer fail-safe); cover every state; pre-stage the all-surface invariant as DRAFT. HARD: reuse the primitives (not TripPreview), do not touch the business render or the consumer checkout, no schema/edge change unless the map decision forces a geo add (flag if so).
