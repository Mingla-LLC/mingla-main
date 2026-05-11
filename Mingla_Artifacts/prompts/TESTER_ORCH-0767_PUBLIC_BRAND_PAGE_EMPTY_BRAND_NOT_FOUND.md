# Testing: Public Brand Page Empty-Brand Repair (ORCH-0767)

## Mission

Independently verify the ORCH-0767 implementation against the investigation, spec, implementation report, code, migration, and runtime behavior. Produce:

`Mingla_Artifacts/reports/TEST_REPORT_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`

Verdict must be one of:

`PASS | CONDITIONAL PASS | NEEDS REWORK | REJECTED`

## Context

Plain-English impact before the fix: an organiser could tap **View public page** on a real brand such as `Brand 3` and see `We couldn't find that brand`. That made Mingla look like it lost the brand and broke the promised public-brand/IG-bio surface before the organiser had published an event.

Implementation claim: Mingla Business now resolves brand identity through a field-limited `business_public_brands_view`, then fetches event cards separately from `business_public_events_view`. Empty real brands should render a public profile with zero events; missing/deleted brands should still be not-found.

## Evidence Trail

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Implementor prompt: `Mingla_Artifacts/prompts/IMPLEMENT_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Implementation report: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Migration: `supabase/migrations/20260515000008_orch_0767_public_brand_profile_view.sql`
- Main code:
  - `mingla-business/src/services/publicEventsService.ts`
  - `mingla-business/server/socialPreview.js`
  - `mingla-business/api/public-brand.js`
  - `mingla-business/api/og-brand.js`
- Tests:
  - `mingla-business/src/services/__tests__/publicEventsService.test.ts`
  - `mingla-business/server/__tests__/socialPreview.test.ts`

## Required Checks

### Static / Code Review

1. Confirm `business_public_brands_view` exposes only the approved public fields and excludes:
   - `account_id`
   - `contact_email`
   - `contact_phone`
   - `tax_settings`
   - `default_currency`
   - all `stripe_*` fields
2. Confirm `business_public_events_view` still owns public event rows and was not weakened.
3. Confirm `getPublicBrandBySlug` returns:
   - `null` for missing brand profile;
   - `{ brand, events: [] }` for real brand with zero public events;
   - `{ brand, events: [...] }` for populated public brand.
4. Confirm no public route depends on organiser-only Zustand/local store for brand identity.
5. Confirm social preview/OG paths handle empty real brands and still 404 missing brands where appropriate.

### Automated Gates

Run, or explain exactly why blocked:

```bash
cd mingla-business
npx jest --runTestsByPath src/services/__tests__/publicEventsService.test.ts server/__tests__/socialPreview.test.ts
npx tsc --noEmit
```

Also run a migration/static guard if the implementation added one outside Jest. If `npm test` is attempted, note that `mingla-business` currently has no `test` script and use `npx jest` as the repo-local equivalent.

### DB / Deploy Gate

Confirm whether the operator has run:

```bash
supabase db push
```

Required migration:

`20260515000008_orch_0767_public_brand_profile_view.sql`

If the migration is not pushed, verdict cannot be full PASS. Use CONDITIONAL PASS at best if local code/tests are correct but runtime cannot yet see the view.

Confirm whether `mingla-business` web/server has deployed after the code changes. If not deployed, production runtime cannot be full PASS.

### Runtime Smoke

After DB push and deploy, verify:

1. Signed-out/private browser: `https://business.usemingla.com/b/brand3` or an equivalent real empty brand.
   - Expected: brand name renders.
   - Expected: `No upcoming events yet` or equivalent zero-event state.
   - Expected: `We couldn't find that brand` is absent.
2. Missing slug: `https://business.usemingla.com/b/__definitely_missing_orch_0767__`.
   - Expected: true not-found.
3. Populated public brand fixture.
   - Expected: brand identity plus public event cards still render.
4. Crawler HTML/API: `/api/public-brand?brandSlug={emptyBrandSlug}`.
   - Expected: brand-specific HTML, not 404.
5. OG route: `/api/og-brand?brandSlug={emptyBrandSlug}`.
   - Expected: brand-specific card output, not generic fallback.

## Regression Checks

- Public event detail routes still render through `business_public_events_view`.
- Draft/private/hidden/deleted events do not appear on public brand pages.
- Missing/deleted brand slugs are not accidentally exposed by the new view.
- No private brand fields are accessible through the new public read model.
- ORCH-0768 overlap note: public-brand username/count honesty is tracked separately; do not fail ORCH-0767 solely because the public brand page still shows username/count UI unless it breaks the empty-brand not-found contract or exposes private data.

## Success Criteria

- Empty real brands no longer false-404 after DB push/deploy.
- Missing/deleted brands remain not-found.
- Populated brands still render public events.
- Public brand data exposure is field-limited and intentional.
- Social preview/OG paths match the new app behavior.
- Automated tests and TypeScript pass.
- Any remaining runtime/deploy gate is explicitly called out.

## Output Requirements

Report must include:
- Verdict.
- What was tested.
- Exact command output summary.
- Runtime URLs checked and observed results.
- Any blocked gates.
- Required rework, if any, with file/line evidence.

## Anti-Patterns To Avoid

- Do not accept local tests as production PASS if the DB migration or web deploy has not happened.
- Do not propose broad public `brands` table reads as a tester fix.
- Do not collapse ORCH-0768 brand identity/count cleanup into this verdict.
