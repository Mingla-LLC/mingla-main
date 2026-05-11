# Spec — ORCH-0767 — Public Brand Page Empty-Brand Repair

## Goal

Repair `/b/{brandSlug}` so an existing non-deleted brand renders a public profile even when it has zero public events. Preserve true not-found for nonexistent or deleted brands, and preserve public-event privacy.

## Scope

In scope:
- Supabase public brand profile read model.
- `mingla-business` public brand service, hook behavior, route rendering, and mapper.
- Server social-preview/public-brand HTML and OG brand identity paths.
- Focused regression tests and runtime gates.

Out of scope:
- Event publish lifecycle changes.
- Checkout/orders/QR/Stripe.
- Brand slug editing/renaming.
- Rich social preview redesign beyond data-source correctness.
- Adding a new brand privacy toggle unless product separately chooses it.

## Product Contract

1. A non-deleted brand slug is a valid public brand page, even with no public events.
2. A valid empty brand page renders brand identity plus an empty events state, not not-found.
3. Event cards on the brand page only come from public buyer-facing events.
4. Nonexistent and soft-deleted brands still render `PublicBrandNotFound`.
5. Public brand profile data is field-minimal and intentional.

## Database / RLS Contract

### Migration

Add a new monotonic migration with a prefix greater than the current local max `20260515000007`, for example:

`supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql`

Before finalizing the filename, confirm the linked remote migration head is not greater than the local max. If it is greater, use a prefix greater than both local and remote heads.

### Public Read Model

Create `public.business_public_brands_view` for public brand profile reads.

Required row filter:
- `brands.deleted_at IS NULL`

Required exposed fields:
- `id`
- `slug`
- `name`
- `description`
- `profile_photo_url`
- `social_links`
- `custom_links`
- `display_attendee_count`
- `kind`
- `address`
- `cover_hue`
- `cover_media_url`
- `cover_media_type`
- `profile_photo_type`
- `created_at`
- `updated_at`

Excluded fields:
- `account_id`
- `contact_email`
- `contact_phone`
- `tax_settings`
- `default_currency`
- all `stripe_*` fields
- internal deletion/ownership/audit fields unless explicitly proven public

Security requirement:
- Prefer a dedicated field-limited view or `SECURITY DEFINER` RPC over widening direct public access to `public.brands`.
- Do not add a broad anon/authenticated `brands` table SELECT policy for all non-deleted brands unless the implementor proves column privileges prevent public reads of excluded fields.
- Grant public read only on the new read model:
  - `GRANT SELECT ON public.business_public_brands_view TO anon, authenticated, service_role;`
- Add a comment documenting that ORCH-0767 exposes non-deleted public brand profile identity without requiring a public event.

### Existing Views/Policies

Do not weaken `business_public_events_view`. It remains the source for public buyer-facing event rows and must continue to filter:
- `events.deleted_at IS NULL`
- joined `brands.deleted_at IS NULL`
- `events.visibility = 'public'`
- status in `scheduled`, `live`, `ended`, `cancelled`

Do not rely on `brands_public_view` unless the implementation deliberately replaces it and proves no other consumers depend on the old "has public event" semantics.

## Client Service Contract

Primary file:
- `mingla-business/src/services/publicEventsService.ts`

Add a `BusinessPublicBrandViewRow` type matching `business_public_brands_view`.

Refactor `getPublicBrandBySlug(brandSlug)`:
1. Query `business_public_brands_view` by `slug = brandSlug` with `.maybeSingle()`.
2. If no brand row, return `null`.
3. Query `business_public_events_view` by `brand_slug = brandSlug`, ordered by `published_at desc nullslast`.
4. Fetch tickets only for returned public event rows.
5. Return `{ brand, events }`, where `events` may be `[]`.

Mapping requirements:
- Map brand identity from the brand view, not from the first event row.
- Preserve real `kind`, `address`, `cover_hue`, `cover_media_url`, `cover_media_type`, `profile_photo_type`, `profile_photo_url`, `description`, `social_links`, `custom_links`, and `display_attendee_count`.
- Set `stats.events` to the count of returned public event rows or hide stats if zero. Do not fabricate follower, revenue, or attendee counts.
- Do not expose contact fields in the public mapper for ORCH-0767 unless product explicitly approves them.

Keep public event detail lookups (`getPublicEventBySlug`, `getPublicEventById`) on `business_public_events_view`.

## Hook / Cache Contract

Primary file:
- `mingla-business/src/hooks/usePublicEvents.ts`

Keep `publicEventKeys.brandBySlug(brandSlug)` unless a broader cache-key refactor is explicitly needed. Existing publish invalidation in `useBusinessEvents.ts` targets this key, and the repair should preserve that behavior.

No public brand route may depend on organiser-only Zustand/current-brand state for brand identity.

## Route / Component Contract

Primary files:
- `mingla-business/app/b/[brandSlug]/index.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- `mingla-business/src/components/brand/PublicBrandNotFound.tsx`

Behavior:
- `null` from `getPublicBrandBySlug` still means true not-found.
- `{ brand, events: [] }` renders `PublicBrandPage`.
- Existing `UpcomingTab` empty copy (`No upcoming events yet`) is acceptable for ORCH-0767 unless UX chooses richer copy.
- `PublicBrandNotFound` remains only for missing/deleted brand slugs.

Optional cleanup:
- `PublicBrandPage` currently uses `useBrandList()` for founder-aware close chrome. That is not root cause, but if touched, keep it from affecting public brand identity or public data resolution.

## Social Preview / Server Contract

Primary files:
- `mingla-business/server/socialPreview.js`
- `mingla-business/api/public-brand.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

Update `fetchPublicBrandBySlug` so it can return brand identity when the brand has zero event rows:
1. Fetch the brand row from `business_public_brands_view`.
2. If absent, return a shape that callers can distinguish as not-found.
3. Fetch event rows from `business_public_events_view`.
4. Render brand HTML and brand OG using brand identity even when events are empty.

Required behavior:
- `/api/public-brand?brandSlug={emptyBrand}` returns brand HTML, not 404.
- `/api/public-brand?brandSlug={missingSlug}` still returns 404.
- `/api/og-brand?brandSlug={emptyBrand}` uses the brand name/description/photo/cover where available, not generic `Mingla Business` fallback.

## Tests

Add or update focused tests. Suggested files:
- `mingla-business/src/services/__tests__/publicEventsService.test.ts`
- `mingla-business/server/__tests__/socialPreview.test.ts`
- If SQL/static migration tests already exist, add the migration/view exposure guard there. Otherwise create the smallest local test or script consistent with repo patterns.

Minimum regression cases:

1. `getPublicBrandBySlug` returns `{ brand, events: [] }` when `business_public_brands_view` has a row and `business_public_events_view` has zero rows.
2. `getPublicBrandBySlug` returns `null` when `business_public_brands_view` has no row.
3. A populated brand still returns mapped brand identity plus event rows and tickets.
4. Brand mapper preserves `kind`, `address`, cover media fields, profile media type, links, and `display_attendee_count`.
5. Server `public-brand` preview does not 404 for a real empty brand.
6. Server `public-brand` preview still 404s for missing brand.
7. Server brand OG props use empty-brand identity instead of generic fallback.
8. Migration/static guard confirms the public brand read model excludes `account_id`, `tax_settings`, `default_currency`, and `stripe_*` fields. If contact fields stay excluded, guard `contact_email` and `contact_phone` too.

Suggested verification commands:

```bash
cd mingla-business
npm test -- --runTestsByPath src/services/__tests__/publicEventsService.test.ts server/__tests__/socialPreview.test.ts
npx tsc --noEmit
```

If the repo uses a different package script locally, use the nearest equivalent but record the exact command and result in the implementation report.

## Runtime Gate

After migration and web deploy:

1. Use a real or disposable non-deleted brand with no public events, e.g. `Brand 3` / `brand3`.
2. Open a signed-out/private browser to `https://business.usemingla.com/b/{slug}`.
3. Expected: brand name renders; page shows `No upcoming events yet`; not-found is absent.
4. Open `https://business.usemingla.com/b/__definitely_missing_orch_0767__`.
5. Expected: true not-found renders.
6. Open a populated public brand such as the current public fixture.
7. Expected: brand identity and public event cards still render.
8. Fetch or inspect crawler HTML for the empty brand path/API.
9. Expected: HTML status/content is brand-specific, not 404/generic.

## Deployment / Rollback

Order:
1. Add and apply Supabase migration for `business_public_brands_view`.
2. Update client service/mappers.
3. Update server preview/OG paths.
4. Add tests.
5. Deploy `mingla-business` web/server routes.
6. Ship Expo update if the native business app bundle consumes the updated public route/service.

Rollback:
- If the app deploy fails after the DB view is added, leaving the view in place is safe because it only exposes approved public fields.
- If the migration is wrong, revoke view grants or drop the view before rolling back app code.
- Do not roll back by broadening base `brands` public SELECT.

## Acceptance Criteria

- Tapping **View public page** for `Brand 3` or an equivalent empty brand no longer renders false not-found.
- Empty real brands render public identity and zero-event state.
- Missing/deleted slugs still render not-found.
- Public event lists still exclude draft/private/hidden/deleted events.
- Public brand data exposure is limited to the approved view/RPC fields.
- Automated tests cover empty brand, missing brand, populated brand, and server preview parity.
- Implementation report includes migration name, test commands/results, and runtime smoke evidence.

## Implementor Starting Points

Start with:
- `supabase/migrations/`
- `mingla-business/src/services/publicEventsService.ts`
- `mingla-business/src/hooks/usePublicEvents.ts`
- `mingla-business/app/b/[brandSlug]/index.tsx`
- `mingla-business/server/socialPreview.js`
- `mingla-business/api/public-brand.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

Do not start by editing organiser-only brand stores or hiding the CTA.
