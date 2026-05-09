# Implementation: Public Brand Page Empty-Brand Repair (ORCH-0767)

## Mission

Implement exactly the ORCH-0767 spec so existing non-deleted brands render at `/b/{brandSlug}` even when they have zero public events, without widening private data exposure or regressing populated public brand/event pages.

Produce:

- Code/schema/test changes.
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`

## Context

Plain-English impact: organisers can tap **View public page** on a real brand such as `Brand 3` and see `We couldn't find that brand`. That makes Mingla look like it lost the brand and breaks the promised public-brand/IG-bio surface before the organiser has published an event.

Forensics proved the root cause: `/b/{brandSlug}` currently resolves brand identity through `business_public_events_view`. That view only has rows for brands with qualifying public events, so a real empty brand becomes indistinguishable from a missing slug.

## Scope

IN:
- Supabase migration for a field-limited public brand profile read model.
- `mingla-business` public brand service/mapping changes.
- Public brand route behavior for empty, populated, missing, and deleted brands.
- Server social preview / crawler HTML / OG brand identity paths.
- Focused automated regression tests.
- Implementation report with exact verification evidence.

OUT:
- Event publish lifecycle changes.
- Checkout, orders, QR, scanner, Stripe, admin, or consumer Explorer changes.
- Brand slug editing or rename behavior.
- Hiding/removing the **View public page** CTA.
- Rich social preview redesign beyond fixing the data source.
- New brand privacy toggle unless explicitly required by the spec evidence.

NON-GOALS:
- Do not make draft/private/hidden events public.
- Do not make public brand pages depend on organiser-only Zustand/current-brand state.
- Do not broaden direct anon SELECT on `public.brands` unless you prove excluded columns cannot be selected publicly.

## Evidence Trail

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Registered queues:
  - `Mingla_Artifacts/WORLD_MAP.md`
  - `Mingla_Artifacts/PRIORITY_BOARD.md`
  - `Mingla_Artifacts/MASTER_BUG_LIST.md`
  - `Mingla_Artifacts/OPEN_INVESTIGATIONS.md`
- Root cause files:
  - `mingla-business/app/brand/[id]/index.tsx`
  - `mingla-business/src/components/brand/BrandProfileView.tsx`
  - `mingla-business/app/b/[brandSlug]/index.tsx`
  - `mingla-business/src/hooks/usePublicEvents.ts`
  - `mingla-business/src/services/publicEventsService.ts`
  - `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql`
- Social preview blast radius:
  - `mingla-business/server/socialPreview.js`
  - `mingla-business/api/public-brand.js`
  - `mingla-business/api/og-brand.js`
  - `mingla-business/server/__tests__/socialPreview.test.ts`

## Affected Files

Start here, in this order:

1. `supabase/migrations/`
2. `mingla-business/src/services/publicEventsService.ts`
3. `mingla-business/src/hooks/usePublicEvents.ts`
4. `mingla-business/app/b/[brandSlug]/index.tsx`
5. `mingla-business/server/socialPreview.js`
6. `mingla-business/api/public-brand.js`
7. `mingla-business/api/og-brand.js`
8. `mingla-business/src/services/__tests__/publicEventsService.test.ts`
9. `mingla-business/server/__tests__/socialPreview.test.ts`
10. Any existing SQL/static migration guard tests, if present.

Do not edit unrelated event media/upload files currently dirty in the worktree unless they are proven dependencies.

## Required Implementation Contract

### Database / RLS

Add a monotonic migration with a prefix greater than the current local max `20260515000007`. Use `20260515000008_orch_0767_public_brand_profile_view.sql` only if remote migration head is not greater; otherwise choose a greater prefix.

Create a field-limited public brand read model, e.g. `public.business_public_brands_view`, for non-deleted brands.

Expose only:
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

Exclude:
- `account_id`
- `contact_email`
- `contact_phone`
- `tax_settings`
- `default_currency`
- all `stripe_*` fields
- internal deletion/ownership/audit fields

Keep `business_public_events_view` as the only source for event rows. Do not weaken its public-event filters.

### Client Service

Refactor `getPublicBrandBySlug(brandSlug)` so:
1. It first reads the brand profile from `business_public_brands_view`.
2. Missing brand profile returns `null`.
3. Existing brand profile continues to fetch events from `business_public_events_view`.
4. Existing brand with zero event rows returns `{ brand, events: [] }`.
5. Tickets are fetched only for returned public event rows.

Map brand identity from the brand view, not from the first event row. Preserve real kind/address/cover/profile/link fields. Do not fabricate stats.

### Route / UI

`/b/[brandSlug]` behavior:
- `null` remains true not-found.
- `{ brand, events: [] }` renders `PublicBrandPage`.
- Existing empty copy `No upcoming events yet` is acceptable.

### Social Preview / OG

Update server preview paths so empty real brands still render brand-specific HTML/OG:
- `/api/public-brand?brandSlug={emptyBrand}` returns brand HTML, not 404.
- missing slugs still 404.
- `/api/og-brand?brandSlug={emptyBrand}` uses brand identity, not generic fallback.

## Regression Brakes

Before touching code, identify existing public brand/event tests and note which tests encode old event-backed behavior. Replace old behavior tests; do not preserve the false not-found contract.

Add or update tests for:
1. Empty brand returns `{ brand, events: [] }`.
2. Missing brand returns `null`.
3. Populated brand still maps public events and tickets.
4. Brand mapper preserves `kind`, `address`, cover media fields, profile media type, links, and `display_attendee_count`.
5. Server public-brand preview does not 404 for empty brand.
6. Server public-brand preview still 404s for missing brand.
7. Server OG props use empty-brand identity.
8. Migration/static guard verifies excluded private fields are not exposed by the public brand read model.

Run targeted verification at minimum:

```bash
cd mingla-business
npm test -- --runTestsByPath src/services/__tests__/publicEventsService.test.ts server/__tests__/socialPreview.test.ts
npx tsc --noEmit
```

If a command is unavailable or the repo uses a different test runner, run the nearest equivalent and record the exact reason and output.

## Runtime / Deploy Notes

Do not mark implementation complete until the report states:
- migration filename and why its prefix is monotonic;
- whether DB push was performed or is operator-pending;
- exact tests run and results;
- whether web deploy / Expo OTA is required;
- manual runtime smoke still needed after DB push/deploy.

Runtime smoke after DB push and deploy:
1. `/b/brand3` or another real empty brand renders brand name and `No upcoming events yet`.
2. `/b/__definitely_missing_orch_0767__` renders true not-found.
3. A populated public brand still renders event cards.
4. crawler/social preview path returns brand-specific HTML/OG for empty brand.

## Constraints

- Preserve Mingla invariants: No dead taps, No silent failures, One owner per truth, No fabricated data.
- Do not expose private organiser/team/payment/tax/contact fields to public clients.
- Do not hide the CTA as a substitute for fixing source of truth.
- Do not mutate production Supabase data during implementation.
- The operator runs `supabase db push`; document this gate clearly.
- Respect unrelated dirty work in the repo. Do not revert or format unrelated files.

## Success Criteria

- Existing empty brands render public profile instead of false not-found.
- Missing/deleted brands remain not-found.
- Public event rows remain restricted to public buyer-facing events.
- Public brand data comes from one intentional field-limited public read model.
- Social preview/OG paths match app behavior.
- Automated tests cover the old failure and adjacent regressions.
- Implementation report is complete enough for independent `$tester` verification.

## Output Requirements

Implementation report must include:
- Summary of files changed.
- Before/after behavior.
- Migration details and public-field exposure decision.
- Test commands and exact results.
- Runtime/manual gates completed or pending.
- Surprises, risks, and anything intentionally left out.

## Anti-Patterns To Avoid

- Querying `brands` directly from the public client with a broad anon policy.
- Treating empty event rows as brand-not-found.
- Hiding **View public page**.
- Reviving local stub/Zustand public brand lookup.
- Exposing draft/private/hidden event details.
- Fixing only the app route while leaving social preview and OG broken.
