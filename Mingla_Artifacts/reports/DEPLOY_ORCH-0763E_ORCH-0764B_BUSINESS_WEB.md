# DEPLOY - Business Web ORCH-0763E + ORCH-0764B

Date: 2026-05-09
Status: deployed and smoke checked

## Deployment

Production deploy:

- Project: `mingla-business`
- Deployment ID: `dpl_JC5Vpd8jrDfwanxXV1C5MubrDMaV`
- Deployment URL: `https://mingla-business-gkfo3wtqh-seth-ogievas-projects.vercel.app`
- Production alias: `https://business.usemingla.com`
- Inspector: `https://vercel.com/seth-ogievas-projects/mingla-business/JC5Vpd8jrDfwanxXV1C5MubrDMaV`

## Commit State

Pushed branch:

- Branch: `Seth`
- Latest pushed commit: `1bd93306 Fix Vercel OG image module loading`

Supporting deploy commits:

- `759337d5 Limit Vercel deploy upload scope`
- `115e0caa Fix business Vercel upload ignore`
- `1bd93306 Fix Vercel OG image module loading`

## Notes

The first deploy attempt from the monorepo root exceeded Vercel's 10 MB request-body limit. A `.vercelignore` was added and corrected so Vercel can see the configured `mingla-business` root while excluding native build folders and local dependencies.

One accidental retry selected the root `mingla-marketing` Vercel link and failed during build before completion. The successful production deployment above was made through the linked `mingla-business` project.

## Smoke Checks

Passed:

- `https://business.usemingla.com` returned `200 text/html`.
- `https://business.usemingla.com/stripe-onboarding-return` returned `200 text/html`.
- `https://business.usemingla.com/brand/mingla-business-logo.png` returned `200 image/png`.
- `https://business.usemingla.com/og/event/6293e989-af3a-4177-a531-11b13806881e.png` returned `200 image/png`.
- `https://business.usemingla.com/og/brand/teststripe.png` returned `200 image/png`.
- Bot/crawler request to `https://business.usemingla.com/e/teststripe/the-ripe` returned crawler-visible event metadata:
  - `<title>The ripe by Test Stripe | Mingla</title>`
  - canonical `https://business.usemingla.com/e/teststripe/the-ripe`
  - event `og:url`
  - event `og:image`
  - event `twitter:image`
- Human-browser request to `https://business.usemingla.com/e/teststripe/the-ripe` returned `200 text/html` for the normal public event route.

## Remaining Gates

Not closed yet:

- Real iMessage/WhatsApp share preview must be smoke tested by the operator or `$tester`.
- Fresh native iOS/Android builds are still required to prove app icon and splash changes.
- `$tester` should use `prompts/TESTER_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`.
