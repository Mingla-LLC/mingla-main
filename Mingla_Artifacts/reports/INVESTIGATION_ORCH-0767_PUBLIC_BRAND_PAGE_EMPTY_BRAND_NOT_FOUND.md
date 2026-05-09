# Investigation — ORCH-0767 — Public Brand Page False Not-Found For Empty Brands

## Verdict

ORCH-0767 is a confirmed launch-blocking public-brand bug. `/b/{brandSlug}` currently resolves a brand through `business_public_events_view`, so a real non-deleted brand with zero public buyer-facing events produces the same result as a typo or deleted brand: `PublicBrandNotFound`.

This matches the operator symptom: `Brand 3` exists in the organiser app, but its public page says the brand cannot be found.

## Findings

### F1 — Confirmed Bug / Invariant Violation — Public brand lookup requires at least one public event

**Symptom:** Tapping **View public page** for an existing brand can render `We couldn't find that brand`.

**Broken step:** Organiser brand profile -> **View public page** -> `/b/{brandSlug}` -> false not-found.

**Evidence:**
- [mingla-business/app/brand/[id]/index.tsx](/Users/sethogieva/Desktop/mingla-main/mingla-business/app/brand/[id]/index.tsx) routes `View public page` to `/b/${brandSlug}`.
- [mingla-business/src/components/brand/BrandProfileView.tsx](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/brand/BrandProfileView.tsx) calls `onViewPublic(brand.slug)`; the CTA is rendered at [BrandProfileView.tsx](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/components/brand/BrandProfileView.tsx).
- [mingla-business/app/b/[brandSlug]/index.tsx](/Users/sethogieva/Desktop/mingla-main/mingla-business/app/b/[brandSlug]/index.tsx) calls `usePublicBrandBySlug`.
- [mingla-business/app/b/[brandSlug]/index.tsx](/Users/sethogieva/Desktop/mingla-main/mingla-business/app/b/[brandSlug]/index.tsx) renders `PublicBrandNotFound` whenever query data is `null` or `undefined`.
- [mingla-business/src/hooks/usePublicEvents.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/hooks/usePublicEvents.ts) delegates to `getPublicBrandBySlug`.
- [mingla-business/src/services/publicEventsService.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/publicEventsService.ts) queries `business_public_events_view` by `brand_slug`.
- [mingla-business/src/services/publicEventsService.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/publicEventsService.ts) returns `null` when that view returns zero rows.
- [supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql](/Users/sethogieva/Desktop/mingla-main/supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql) defines `business_public_events_view`.
- [supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql](/Users/sethogieva/Desktop/mingla-main/supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql) only includes rows where the joined event is non-deleted, `visibility = 'public'`, and status is one of `scheduled`, `live`, `ended`, or `cancelled`.

**Six-field proof:**

| Field | Proof |
|---|---|
| File/line | `publicEventsService.ts:361-369`, `index.tsx:49-50`, migration `20260515000005...:38-42` |
| Exact code/schema | Brand lookup queries `business_public_events_view`; the view is event-backed; zero event rows returns `null`; route maps `null` to not-found |
| Current behavior | Real empty brands disappear from public lookup |
| Expected behavior | Real non-deleted public brand profile renders, with an honest empty-events state |
| Causal chain | Brand exists -> CTA navigates to `/b/{slug}` -> service asks an event view for brand identity -> no public event rows -> service returns `null` -> route renders not-found |
| Verification step | Create or use a real brand with no public events, open `/b/{slug}` signed out; current build renders not-found. After fix it must render the brand name and `No upcoming events yet`. |

**Invariant impact:** Violates `No dead taps`, `One owner per truth`, and `No fabricated data` from [README.md](/Users/sethogieva/Desktop/mingla-main/README.md). The CTA succeeds at navigation but lands on a false failure state.

### F2 — Security Gap / Production-Hardening Gap — Current RLS cannot be fixed by directly querying `brands` from the public client

**Symptom:** A direct client-side switch from `business_public_events_view` to `brands` is not a safe implementation plan.

**Evidence:**
- Latest public brand SELECT policy still requires at least one public event: [20260515000005_orch_0763d_event_lifecycle_repair.sql](/Users/sethogieva/Desktop/mingla-main/supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql).
- The baseline `brands_public_view` also intentionally exposed only brands with at least one public live event: [baseline_squash_orch_0729.sql](/Users/sethogieva/Desktop/mingla-main/supabase/migrations/20260505000000_baseline_squash_orch_0729.sql).
- The full `brands` row includes organiser/private-operational fields such as `account_id`, `contact_email`, `contact_phone`, `tax_settings`, `default_currency`, and Stripe status fields in [brandMapping.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/brandMapping.ts).

**Root cause:** Postgres RLS policies are row filters, not field-level public profiles. Widening anon SELECT on `brands` to all non-deleted brands would let public clients select columns that are not part of the public-brand contract unless table privileges/columns are also redesigned. The safer repair is a dedicated public read model or RPC exposing only approved public profile fields.

**Expected behavior:** Public brand lookup must be RLS-safe and field-minimal. It should not expose Stripe, tax, account ownership, or private contact data just to make empty pages render.

### F3 — Confirmed Bug — Social preview and crawler HTML share the same event-backed brand lookup

**Symptom:** Fixing only the Expo route would still leave crawler/social preview paths wrong for empty brands.

**Evidence:**
- [mingla-business/server/socialPreview.js](/Users/sethogieva/Desktop/mingla-main/mingla-business/server/socialPreview.js) `fetchPublicBrandBySlug` also queries `business_public_events_view`.
- [mingla-business/api/public-brand.js](/Users/sethogieva/Desktop/mingla-main/mingla-business/api/public-brand.js) returns 404 when that lookup returns an empty row array.
- [mingla-business/api/og-brand.js](/Users/sethogieva/Desktop/mingla-main/mingla-business/api/og-brand.js) passes an empty row array into the OG builder when no event rows exist, producing generic fallback behavior instead of brand identity.

**Impact:** A real empty brand can render not-found or generic Mingla metadata to crawlers even if a client-side route later learns how to render the profile. That breaks the IG-bio/share surface the product originally promised.

### F4 — Likely Bug / Data-Fidelity Gap — Public brand mapper throws away current brand profile fields when events do exist

**Evidence:**
- [publicEventsService.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/publicEventsService.ts) maps brand identity from an event row.
- The mapper hardcodes `kind: "popup"` and `address: null` at [publicEventsService.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/publicEventsService.ts).
- Current `brands` rows contain persistent `kind`, `address`, `cover_hue`, `cover_media_url`, `cover_media_type`, and `profile_photo_type`: [brandMapping.ts](/Users/sethogieva/Desktop/mingla-main/mingla-business/src/services/brandMapping.ts), introduced by [20260506000000_brand_kind_address_cover_hue_media.sql](/Users/sethogieva/Desktop/mingla-main/supabase/migrations/20260506000000_brand_kind_address_cover_hue_media.sql).

**Impact:** Public brand pages for populated brands can still render stale/default profile attributes because brand identity is a byproduct of the event read model. This is adjacent to the root cause and should be fixed by the same public brand profile read model.

## Five Truth Layers

| Layer | Current truth |
|---|---|
| Docs/history | Cycle 7 defined `/b/{brandSlug}` as the IG-bio-link public brand surface. ORCH-0759 moved public routes to server-backed Supabase data and introduced `business_public_events_view`, but that event-backed data source is insufficient for empty brands. |
| Schema/RLS | Latest migration prefix is `20260515000007`; latest public event/brand policy relevant to this bug is `20260515000005`. `business_public_events_view` and the current public `brands` policy both require qualifying public events. |
| Code | CTA routes correctly to `/b/{brandSlug}`. The route/hook/service path is the failing part: public brand identity is read from an event view and zero rows becomes not-found. |
| Runtime/test evidence | Prior anon REST probe against `business_public_events_view` for `brand3` and `brand-3` returned `[]`. Current automated tests cover populated brand preview rows but do not cover a real brand with zero public events. |
| Data assumptions | `Brand 3` is assumed to be a non-deleted organiser brand visible to the authenticated organiser. The exact live row was not mutated or inspected with privileged access during forensics. The failure is still proven because any real brand with no qualifying public events is excluded by the current view and policy. |

## Intended Behavior

For a non-deleted brand slug, `/b/{brandSlug}` should render the public brand profile using minimal approved public brand fields. Its event list should contain only public buyer-facing events. If there are zero qualifying events, the page should show the existing empty state (`No upcoming events yet`) instead of `PublicBrandNotFound`.

True not-found should remain for nonexistent slugs and soft-deleted brands.

## Blast Radius

| Surface | Impact |
|---|---|
| Business brand profile CTA | Directly broken for empty brands. |
| Public route `/b/[brandSlug]` | Root route conflates empty event list with nonexistent brand. |
| Public brand service/hook/cache | Needs split brand-profile read plus event-list read while preserving query key invalidation. |
| Supabase schema/RLS | Needs a field-minimal public brand read model. Do not widen direct public `brands` table reads casually. |
| Social preview/crawler HTML | Shares the bug through `server/socialPreview.js` and `api/public-brand.js`. |
| Brand OG image | Empty brand currently loses brand identity and falls back generic. |
| Public event route/checkout/orders | No direct behavioral change needed; public event detail should continue using `business_public_events_view` and ticket-type constraints. |

## Open Questions

1. Should every non-deleted brand be publicly visible by slug immediately, or should Mingla add a future explicit `public_profile_enabled` flag? Current product behavior and CTA imply immediate public visibility; no such flag exists today.
2. Should public brand pages expose `contact_email` and `contact_phone`? `PublicBrandPage` can render contact fields, but this investigation recommends excluding them from ORCH-0767 unless product explicitly confirms they are public profile fields.
3. Should `brands_public_view` be replaced or left as historical/unused while a new `business_public_brands_view` is introduced? The spec recommends a new view to minimize compatibility risk.

## Recommended Fix Direction

Create a dedicated public brand profile read model, e.g. `public.business_public_brands_view`, that exposes only approved profile fields for non-deleted brands by slug. Update `getPublicBrandBySlug` and server social preview paths to read brand identity from that view and public events from `business_public_events_view`. Preserve not-found for missing/deleted brands and preserve event privacy by keeping event lists event-backed.

Do not implement by querying authenticated organiser state, local Zustand, or a widened direct `brands` table query from the public route.
