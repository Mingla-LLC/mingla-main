# Close Report: ORCH-0767 Public Brand Page Empty-Brand Repair

> Date: 2026-05-09
> Verdict: CLOSED PASS
> Closure basis: operator runtime acceptance plus implementation/deploy evidence

## Plain-English Outcome

Existing brands with no public events no longer look missing on public brand pages. A founder can tap **View public page** for `Brand 3` and see the public profile with a zero-event state instead of `We couldn't find that brand`.

## Evidence Chain

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Implementation: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Deploy: `Mingla_Artifacts/reports/DEPLOY_ORCH-0767_PUBLIC_BRAND_PAGE_EMPTY_BRAND_NOT_FOUND.md`
- Operator acceptance: 2026-05-09 chat, "All works good. Close this"

## What Changed

- Added `public.business_public_brands_view`, a field-limited public brand profile read model.
- Kept `business_public_events_view` as the public event-row source.
- Changed `getPublicBrandBySlug` so brand existence no longer depends on event rows.
- Updated crawler/social preview and OG brand routes to render empty real brands.
- Added focused regression tests for empty, missing, populated, preview/OG, mapper, and public-field exposure cases.

## Verification

Local gates passed:

```text
cd mingla-business
npx jest --runTestsByPath src/services/__tests__/publicEventsService.test.ts server/__tests__/socialPreview.test.ts
=> PASS, 2 suites / 16 tests

npx tsc --noEmit
=> PASS
```

Deployment/runtime gates:

- Remote migration `20260515000008` verified present.
- Vercel production deployment `dpl_3VF7k3XSuqXbEBHAJZnYBzK2UeFT` aliased to `https://business.usemingla.com`.
- `business_public_brands_view` returns `Brand 3` for `brand3`.
- `business_public_events_view` returns `[]` for `brand3`.
- Crawler/API smoke for `/b/brand3` returns `Brand 3 on Mingla` and `No upcoming events yet`.
- Missing crawler slug returns `404 Brand not found`.
- `/og/brand/brand3.png` returns `200 image/png`.
- Deployed bundle contains `business_public_brands_view`.

## Residual Notes

- ORCH-0768 remains separate for brand audience/count honesty and public `@slug` removal. It must not be treated as part of this close.
- Contact fields remain intentionally excluded from the public brand profile view unless product later decides they are public.
- Business native app parity may require OTA/rebuild if installed native bundles need this JS path; web production is deployed.

## Close Decision

Closed PASS. The original false-not-found bug is fixed, deployed, and operator-accepted.
