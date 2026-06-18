# INVESTIGATE — Public Experience Page: how many exist, shared component?, single source of truth?

**Date:** 2026-06-18
**Mode:** Deep research (orchestrator ANSWER, pre-INTAKE for a future standardization ORCH)
**Question (Seth):** Standardize the layout/structure of the public experience page. How many exist? Is there one shared component? Is there one source of truth — used across business app, consumer app, and web public pages? 100%-sure answer required.
**Method:** 4 parallel read-only sweeps (consumer app / business native / web / shared+data layer) + direct package-boundary verification.

---

## TL;DR VERDICT

| Question | Answer | Confidence |
|----------|--------|------------|
| How many public-experience-page render codepaths exist? | **THREE distinct codepaths** (one covers business-app + web together; two more in the consumer app) | 100% |
| One shared page-level component across all 3 surfaces? | **NO** | 100% |
| One source of truth — UI? | **NO** — fragmented; only sub-primitives (`EventCoverMedia`, `formatExperienceDateSubline`) are shared | 100% |
| One source of truth — read API/data? | **NO** — split: deck uses `pg_eligible_experiences_for_deck`; public page uses direct anon-RLS table reads; consumer brand path uses a third path | 100% |
| One source of truth — storage/schema? | **YES** — `events` (`event_type='experience'`) + `experience_stops` | 100% |
| Is a shared-primitives package already being built? | **YES** — `@mingla/offering-rendering` (ORCH-1138), trip leg DONE, experience leg NOT yet migrated | 100% |

---

## 1. The three public-experience-page render codepaths

### Codepath A — Business app (iOS/Android) + Buyer Web (ONE file, two surfaces)
- Route: `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx` → `PublicExperienceRoute`.
- Single Expo Router file; **no `.web.tsx` split** → the SAME code renders on business iOS/Android AND buyer web.
- Composes: `src/components/experience/ExperiencePreview.tsx` (cover, title, brand byline, date-model block, collapsible description, stops itinerary, "From {price}") + `ExperienceCheckoutFlow.tsx` + `offering/FloatingOfferingBar.tsx`.
- Data: `usePublicExperienceBySlug` → `services/publicExperienceService.ts` → **direct anon-RLS reads** of `events` + `experience_stops` + `ticket_types` + `event_dates` (NO RPC). `pg_brand_can_charge` for paid bookability.

### Codepath B — Consumer app, CURATED / deck experiences
- `app-mobile/src/components/CuratedExperienceSwipeCard.tsx` (deck card) → full detail in `app-mobile/src/components/ExpandedCardModal.tsx` via `CuratedPlanView`/`MultiStopPlanView`.
- Fully bespoke; renders header/shopping-list/animated stop timeline/travel connectors/replace-venue.
- Data: `discover-cards` edge function → `pg_eligible_experiences_for_deck` RPC → `CuratedExperienceCard` payload (rendered from props, no detail re-fetch).

### Codepath C — Consumer app, BRAND / venue-claimed experiences
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` wraps **`PublicEventPage` from `@mingla/event-rendering`** (the EVENT renderer, reused for experiences) + layers `ExperienceItinerary.tsx` + `ExperienceOccurrencePicker.tsx` on top.
- Data: card payload (`BusinessEventCard`, experiences mapped in) + `usePublicEventTickets(eventId)`.

**Consequence:** the consumer app renders an experience TWO different ways (B and C), neither of which is the business/web `ExperiencePreview` (A). Three layouts, three codepaths, three look-and-feels.

---

## 2. What IS shared today (the honest "partial" picture)

- **Storage (full SoT):** all experiences are `events` rows with `event_type='experience'`; itinerary in `experience_stops`; one sellable `ticket_types` row; dates in `event_dates`. Schema is unified across every surface. (`supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql`)
- **Sub-primitives (shared helpers, NOT page layout):**
  - `EventCoverMedia` (`packages/event-rendering`) — cover image/video/GIF on every surface.
  - `formatExperienceDateSubline` (`mingla-business/src/utils/experienceDateSubline.ts`) — one date-model formatter (business/web only; consumer paths do not import it).
  - Business-app operator side already has shared `offering/` primitives (`OfferingListCard`, `OfferingManageSheet`, `FloatingOfferingBar`, dashboard tiles) from META-ORCH-1059 — but these are list/manage/CTA primitives, NOT the buyer detail page.
- **Read RPCs that ARE canonical:** `pg_eligible_experiences_for_deck` (THE deck supply RPC) and `pg_brand_can_charge` (THE paid-readiness predicate, used by all 5 supply RPCs). Neither serves the public detail page layout.

---

## 3. The architectural asymmetry (why events feel standardized and experiences don't)

- **Events HAVE a shared cross-surface page component:** `packages/event-rendering/PublicEventPage.tsx`, imported by both consumer app and business/web.
- **Experiences DO NOT:** there is **no `@mingla/experience-rendering` package** (verified: `packages/` = brand-rendering, event-rendering, location-input, **offering-rendering**, payments-native, phone-input, scripts, theme-animations). Business/web roll their own `ExperiencePreview`; the consumer app borrows `PublicEventPage` or builds bespoke curated views.

## 4. The half-built solution already in the repo — `@mingla/offering-rendering` (ORCH-1138)

- `packages/offering-rendering/index.ts` header states verbatim: *"Pure-presentational Direction-A layout primitives shared by the public trip/event/experience/brand offering pages… Built first for the trip page (Leg 1); event/experience/brand snap onto these same primitives in later legs."*
- Exports: `ParallaxCoverShell`, `OfferingChrome`, `CountAwareGallery`, `ChipGroup`, `normalizeCityCountry`, `useResponsiveLayout` — props-only, renders on RN-web AND native, isolated from app `src/` (I-MOR-0827-PACKAGE-ISOLATION).
- **Already consumed by the TRIP page on BOTH surfaces:** `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` + `src/components/trip/TripPreview.tsx` (business/web) AND `app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx` (consumer). So the trip page is ALREADY standardized across business+consumer+web on one shared primitive set.
- **The experience leg of ORCH-1138 has NOT been done.** Design docs exist at `Mingla_Artifacts/design/ORCH-1138/`.

**Implication for Seth's goal:** the pattern, the package, and the precedent (trip page) already exist. Standardizing the public experience page = executing the "experience leg" of the offering-rendering migration (build a shared experience detail on `@mingla/offering-rendering`, mount it on all three codepaths, retire `ExperiencePreview` + the two consumer renderers, and decide whether the detail read becomes one RPC).

---

## 5. Open decisions for the proposed structure (for Seth)

1. **UI:** one shared `PublicExperiencePage` in `@mingla/offering-rendering` (mirroring the trip leg) consumed by all three codepaths — collapsing A, B, C into one.
2. **Data read:** promote the public detail read to ONE RPC (e.g. `pg_public_experience_by_slug`) so business/web stop using bespoke anon-RLS reads and the consumer detail stops re-deriving from card payloads — matching the deck's single-RPC discipline.
3. **Curated vs brand experiences:** decide whether consumer curated (B) and brand (C) experiences converge on the same detail page or stay distinct (curated has venue-replacement/shopping-list mechanics that brand experiences lack).

---

## Key file references
- Business/web page: `mingla-business/app/exp/[brandSlug]/[experienceSlug].tsx`, `src/components/experience/ExperiencePreview.tsx`, `src/services/publicExperienceService.ts`
- Consumer curated: `app-mobile/src/components/CuratedExperienceSwipeCard.tsx`, `app-mobile/src/components/ExpandedCardModal.tsx`
- Consumer brand: `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (+ `ExperienceItinerary.tsx`, `ExperienceOccurrencePicker.tsx`)
- Shared primitives: `packages/offering-rendering/` (ORCH-1138), `packages/event-rendering/PublicEventPage.tsx`
- Schema: `supabase/migrations/20260824000000_meta_orch_1059_sub_a_experience_stops.sql`
- Deck RPC: `supabase/migrations/20260903000000_orch_1065_eligible_experiences_for_deck.sql`
