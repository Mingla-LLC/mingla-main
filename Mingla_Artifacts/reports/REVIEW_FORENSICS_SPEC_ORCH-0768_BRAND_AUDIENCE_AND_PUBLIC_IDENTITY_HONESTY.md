# Review — ORCH-0768 — Brand Audience Counts And Public Identity Honesty

## Verdict

Approved for implementation dispatch.

Plain-English impact: Mingla Business is currently showing organiser-facing and public-facing identity/count signals that can make the product look inflated or internally leaky. The returned forensics package proves the problem and the spec gives a bounded, low-risk app-layer repair.

## Reviewed Inputs

- Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`
- Intake prompt: `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`

## Evidence Assessment

The investigation is sufficient to promote ORCH-0768 from forensics/spec to implementation:

- Home `Followers` KPI is proven at `mingla-business/app/(tabs)/home.tsx:407-419`.
- Account `Your brands` card and false per-brand count copy are proven at `mingla-business/app/(tabs)/account.tsx:166-198`.
- Brand switcher count copy is proven at `mingla-business/src/components/brand/BrandSwitcherSheet.tsx:197-224`.
- Public route slug-as-handle display is proven at `mingla-business/src/components/brand/PublicBrandPage.tsx:198-205,309-310`.
- Durable brand reads do not compute aggregate stats: `mingla-business/src/services/brandsService.ts:116-129` maps rows without aggregate stats, while `brandMapping.ts` falls back to `EMPTY_BRAND_STATS`.
- Legacy stub data still carries hardcoded non-zero `Brand.stats`, which is enough to make these displays dishonest when they leak into active UI.

The spec correctly preserves the important navigation nuance: removing Account `Your brands` must not remove the only direct Account route to the current brand profile.

## Scope Decision

ORCH-0768 remains separate from ORCH-0767.

Reason: ORCH-0767 repairs public brand data-source/RLS behavior for empty real brands. ORCH-0768 is a presentation honesty repair: remove fake/non-authoritative brand audience counts and stop rendering route slugs as visible brand handles. They overlap in `PublicBrandPage.tsx`, so implementation must preserve ORCH-0767 behavior if that local work is present.

## Approved Implementation Scope

Implement only:

- Remove Home `Followers` KPI and any Home read of `currentBrand.stats.followers`.
- Remove Account `Your brands` section.
- Preserve count-free current-brand profile access from Account.
- Remove event/follower count copy from BrandSwitcherSheet.
- Remove public `@{brand.slug}` / route-username display from PublicBrandPage.
- Harden public stats display so follower/attendee values from private/stub sources cannot leak.
- Add focused regression guard, preferably a strict-grep script and `test:orch-0768`.

Do not implement:

- A follower system.
- New aggregate event/revenue/attendee source.
- Supabase migration.
- Stripe, checkout, admin, consumer app, or broad dashboard redesign.
- Broad `BrandProfileView` aggregate cleanup unless the operator creates a follow-up.

## Required Next Prompt

Dispatch `$implementor` with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`

Expected output:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0768_BRAND_AUDIENCE_AND_PUBLIC_IDENTITY_HONESTY.md`

## Verification Baseline

Forensics already proved existing public-brand compatibility gates pass locally with Homebrew Node on PATH:

```bash
cd mingla-business
PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/jest publicEventsService.test socialPreview.test --runInBand
# PASS 2 suites / 16 tests

PATH="/opt/homebrew/bin:$PATH" ./node_modules/.bin/tsc --noEmit
# PASS exit 0
```

Implementation must add the ORCH-0768 regression guard and rerun the compatibility gates.

## Review Result

No additional forensics required before implementation. No deployment or DB gate is introduced by this scope. After implementation returns, orchestrator should review the report and then dispatch `$tester` for independent UI/runtime verification.
