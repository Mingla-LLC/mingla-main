# INVESTIGATE — Public TRIP Page: Source-of-Truth Audit

**Delivered into:** META-ORCH (public offering-page standardization) — the trip leg.
**Date:** 2026-06-18
**Author:** mingla-orchestrator+claude (trip-page-standardization research chat)
**Status:** SoT research only. NO ORCH registered, NO spec, NO worktree, NO body promoted — per the consolidation HOLD. This file exists so the META chat has 100% of the trip picture before it sets the one package convention.
**Siblings:** `INVESTIGATE_PUBLIC_EXPERIENCE_PAGE_SOT_AUDIT.md` (experience), `INVESTIGATE_ORCH-1163_RSVP_PUBLIC_PAGE_SOT.md` (RSVP), COMMS-0038 (standard event — the reference pattern).

---

## The three questions, answered with code evidence

### Q1. How many public trip pages exist?

**TWO live buyer-facing page BODIES, plus one legacy preview body — three render paths total.**

| # | Surface(s) | Route file | Body component | Notes |
|---|-----------|------------|----------------|-------|
| 1 | **Buyer web + Business native (iOS/Android)** | `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` | `mingla-business/src/components/trip/TripPreview.tsx` (FOUNDATION mode) | ONE codebase; `mingla-business` compiles to BOTH web (react-native-web) and business-native. Web and business app therefore already share this body. |
| 2 | **Consumer app** (app-mobile) | `app-mobile/app/t/[brandSlug]/[tripSlug].tsx` | `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` | **Bespoke hand-maintained mirror.** Does NOT import `TripPreview`. Its own comments: "REUSES these (NOT importing TripPreview, which is business-local)" and "mirror business FoundationTripPreview." |
| 3 | Business creator wizard "review before publish" | — | `TripPreview.tsx` LEGACY mode (same file, different branch) | A preview, not a live public page. Different layout (no parallax/palette/responsive). |

### Q2. Is there one single shared component?

**NO.** There is no single top-level component rendering the trip page across all three surfaces.

- Web + business app share `TripPreview` **only because they are the same codebase**, not because the body is a shared module.
- The consumer app **forks** a parallel copy (`ConsumerTripDetailScreen`). It cannot import `TripPreview` because `app-mobile` and `mingla-business` are separate Expo apps and cross-app imports are forbidden (invariant **I-MOR-0827**) — the body physically lives in `mingla-business/src/`.

### Q3. Is the trip body truly shared across all 3 surfaces, or only the offering-rendering primitives? *(the question the META explicitly asked)*

**Only the primitives are shared. The trip page BODY is NOT shared.**

Shared today (imported by both business `TripPreview` and consumer `ConsumerTripDetailScreen`):
- From `packages/offering-rendering`: `ParallaxCoverShell`, `CountAwareGallery`, `ChipGroup`, `OfferingChrome`, `useResponsiveLayout`, `normalizeCityCountry`.
- From `packages/event-rendering`: `EventCoverMedia`, `createThemePalette`, `resolveTheme`, `ThemeEntranceAnimation`, `formatTripDateRange`.

NOT shared (the gap): the full page composition — section order, layout, reserve-bar wiring, payment-plan block, refund ladder — is written twice and kept in parity by hand. Real drift risk. This is the **exact same root cause** the event chat (COMMS-0038), RSVP chat (COMMS-0040), and experience chat (COMMS-0041) found.

---

## Data layer — already one source of truth (the good news)

Trip DATA is genuinely unified at the database; this is NOT a gap:
- **One table:** `public.events` with discriminator `event_type='trip'` (migration `20260605000000_orch_0826_events_event_type_discriminator.sql`). No separate `trips` table.
- **Shared anon-callable, SECURITY DEFINER RPCs** used across surfaces: `pg_public_trips_by_brand`, `pg_published_trips_public`, `pg_public_event_tier_allin`, `pg_public_ticket_types_remaining`.
- **One pricing engine:** `compute_all_in_cents` → `pg_public_event_tier_allin`, never computed client-side (WYSIWYP parity, per ORCH-1006/1147).

**Caveat (the residual seam):** the FETCH/adapter layer above the DB is duplicated — business reads via `mingla-business/src/hooks/usePublicTripBySlug.ts`; consumer reads via `app-mobile/src/hooks/useConsumerTripDetail.ts`. Two mirror hooks hitting the same tables/RPCs. So adding a NEW field still needs a per-surface feed edit, not just a body edit. (Identical to the event chat's data-feed-divergence finding.)

---

## The constraint any shared-body design MUST solve (trip-specific, from ORCH-1138/1016)

The consumer screen **cannot host `ParallaxCoverShell` as its scroll root.** `ParallaxCoverShell`'s native branch wraps its ScrollView in a `nativeHost` `<View>`, so a gorhom `BottomSheetScrollView` injected as its `ScrollComponent` is no longer a DIRECT child of gorhom's height-bounded content → viewport == content → maxScroll 0 → **the sheet body FREEZES** (ORCH-1016 bug). The consumer therefore *composes around* the shell (pinned cover + `OfferingChrome` + scrolling body + floating reserve) rather than mounting it.

Implication for the META's convention: the shared trip piece must be a **shell-agnostic body** (pure content; no scroll-host assumptions) that each surface wraps in its own shell — exactly how `packages/event-rendering/PublicEventPage.tsx` already works (consumer wraps it in a bottom sheet; web renders it as a full page).

---

## Recommendation to the META (not an action — input only)

Trip fits the `@mingla/event-rendering` reference pattern with no surprises **except** the gorhom shell constraint above. The convergence target the other three chats independently named — promote the body into a shared `packages/` module (candidate `packages/offering-rendering`) as a shell-agnostic body, with a per-surface prop adapter over the existing unified RPCs — applies cleanly to trips. The trip migration should land identically to RSVP and experience once the META fixes the one package convention + read-path standard.

**Held pending META decision:** package location, the prop-adapter contract, and whether the docked/floating `TripReserveBar` split-button logic stays trip-specific or generalizes across offering types.
