# FORENSICS + SPEC PROMPT - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

You are `$forensics` for Mingla. Investigate first, then write a bounded implementation spec only from proven findings. Do not implement code.

## Context

ORCH-0763E deployed successfully to `https://business.usemingla.com`. Operator smoke says the public share flow works overall: links open and rich preview infrastructure is live.

Post-deploy operator findings:

1. Sometimes sharing to iMessage sends/shows the share twice.
2. The current OG/share-card background is black-heavy, so the orange Mingla Business logo does not pop.
3. The public brand page share preview should have the same rich branded design quality as the event page preview.
4. The event share-card design should visibly include the event date.

Relevant evidence/artifacts:

- `reports/DEPLOY_ORCH-0763E_ORCH-0764B_BUSINESS_WEB.md`
- `reports/IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
- `reports/REVIEW_IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
- `reports/REVIEW_ORCH-0763F_POST_DEPLOY_SHARE_PREVIEW_POLISH.md`
- `specs/SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`

Likely code surfaces to inspect:

- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`
- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
- `mingla-business/app/b/[brandSlug]/index.tsx`
- `mingla-business/server/socialPreview.js`
- `mingla-business/api/public-event.js`
- `mingla-business/api/public-brand.js`
- `mingla-business/api/og-event.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/vercel.json`

## Investigation Questions

### A. Duplicate iMessage Share

Prove where duplication can happen:

- App-native share from the business app share modal.
- Safari/public-page share from the deployed public event page.
- iMessage-specific preview behavior after a single share payload.
- Double-tap / repeated press / missing pending-state guard.
- Duplicate handler wiring in the share modal or page chrome.
- Web `navigator.share` payload behavior.

Answer:

- Is the app invoking share twice, or is iMessage displaying/expanding one share in a way that looks duplicated?
- Does duplication reproduce on iMessage only, or also WhatsApp?
- Does it happen from **Copy link**, **Share via**, public event page share button, public brand page share button, or all?
- Is there already a pending/share-in-progress state that should prevent repeat invocation?

### B. Event Share Card Design

Inspect the deployed/current OG event card implementation.

Answer:

- Why does the logo fail to pop visually?
- What design change best matches Mingla Business branding without becoming a black block?
- Where should the event date come from?
  - `public_theme.business_event.when.date`
  - mapped `LiveEvent.date`
  - another source
- How should the card behave when the date is missing?
- How should cover image, title, brand, date, location, and logo be prioritized in a 1200x630 card?

### C. Brand Share Card Design

Inspect current brand OG route/card behavior.

Answer:

- Does brand preview use the same design language as event preview?
- What brand details are available server-side from `business_public_events_view`?
- Should the card show brand name, handle, number of upcoming events, next event, profile photo, Mingla logo, or another cue?
- How should it behave for brands with no profile photo or sparse metadata?

### D. Blast Radius

Map affected surfaces:

- iOS native app share
- Android native app share
- Expo Web/Safari public share
- iMessage preview
- WhatsApp preview
- brand public page
- event public page
- Vercel serverless routes
- preview cache behavior
- tests

## Required Spec Output

Write:

`Mingla_Artifacts/specs/SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

The spec must include:

- Exact root cause or proven likely cause of duplicate iMessage share.
- Implementation contract for preventing duplicate share invocations if code-caused.
- Event OG card design contract:
  - event date shown visibly
  - logo contrast fixed
  - cover image handling
  - fallback card handling
- Brand OG card design contract:
  - parity with event card visual system
  - brand data hierarchy
  - fallback handling
- Required tests:
  - share helper/modal duplicate invocation tests if applicable
  - metadata/OG data composition tests
  - no wrong-domain regression tests
- Required runtime QA:
  - iMessage
  - WhatsApp
  - Copy link
  - Share via
  - public event page
  - public brand page

## Required Investigation Output

Write:

`Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

Include:

- Reproduction matrix
- Code-path map
- Root cause evidence
- Design findings
- Blast radius
- Residual risks
- Whether implementation can proceed

## Constraints

- Do not modify product code.
- Do not broaden into unrelated public event bugs.
- Preserve canonical domain `https://business.usemingla.com`.
- Do not reintroduce `business.mingla.com`, `mingla.com/e`, Expo URLs, localhost, or draft-only URLs.
- Treat social preview caches as real-world risk; include cache-busting guidance in the spec.
