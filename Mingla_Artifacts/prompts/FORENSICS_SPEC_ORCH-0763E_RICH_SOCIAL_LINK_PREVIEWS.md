# Forensics + Spec: Rich Social Link Preview + SEO Snippet (ORCH-0763E)

## Mission

Investigate and then write a bounded implementation spec for Mingla's public event and brand link previews. The goal is for shared public URLs to render polished, branded, SEO-friendly previews similar to mature event platforms: Mingla logo, event/brand name, event cover image when available, clear description/date/location context when safe, and reliable crawler-readable metadata.

Produce:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`

Do not implement code.

## Context

Operator runtime evidence changed the previous share-link diagnosis:

- **Share via...** from the build successfully sent the public event link to a friend through iMessage and WhatsApp.
- The recipient could open the link.
- The remaining user-visible gap is preview quality: the snippet/preview needs Mingla branding, event cover art, event name, and SEO-friendly metadata.

Plain-English impact: the link works, but the preview should make the event feel trustworthy and worth opening.

## Scope

IN:

- Public event page metadata for `/e/{brandSlug}/{eventSlug}`.
- Public brand page metadata for `/b/{brandSlug}`.
- Open Graph metadata, Twitter/X card metadata, canonical URLs, page titles, descriptions, and image URLs.
- Fallback image strategy for events/brands without cover/profile photos.
- Dynamic OG image route feasibility for `/og/event/{eventId}.png` and `/og/brand/{brandSlug}.png`.
- Whether metadata is present in the first HTML response crawlers receive.
- Platform behavior and cache risks for iMessage, WhatsApp, Slack/Discord, Facebook, X/Twitter, and generic SEO crawlers.
- Web deploy/cache implications on Vercel.
- Tests and manual gates required before close.

OUT:

- Native share-sheet mechanics unless they directly affect preview payloads.
- Stripe onboarding.
- Draft delete/lifecycle cleanup.
- Public checkout flow redesign.
- Marketing landing page redesign.

NON-GOALS:

- Do not redesign the public event page UI.
- Do not invent fake event data.
- Do not add paid third-party SEO services unless the spec proves they are necessary.
- Do not hardcode non-canonical domains. Canonical public origin remains `https://business.usemingla.com` unless a newer artifact proves otherwise.

## Evidence Trail

- Operator evidence, 2026-05-09: Share via to iMessage and WhatsApp worked and recipient links opened.
- Tester report: `Mingla_Artifacts/reports/RETEST_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`
- Orchestrator review: `Mingla_Artifacts/reports/REVIEW_ORCH-0763E_OPERATOR_SHARE_VIA_AND_RICH_PREVIEW_NEXT.md`
- Domain authority chain: ORCH-0759 / ORCH-0763D canonical public origin is `https://business.usemingla.com`.
- Relevant code starting points:
  - `mingla-business/src/components/event/PublicEventPage.tsx`
  - `mingla-business/src/components/brand/PublicBrandPage.tsx`
  - `mingla-business/src/constants/publicUrls.ts`
  - `mingla-business/src/constants/platformUrl.ts`
  - `mingla-business/app/e/[brandSlug]/[eventSlug].tsx`
  - any existing or missing `/og/...` web routes
  - public event/brand data mapping in `mingla-business/src/services/publicEventsService.ts`
  - cover-media types and storage/public URL behavior

## What To Prove

1. What metadata is currently generated for a real public event and brand page.
2. Whether crawlers can see event-specific metadata in initial HTML without waiting for client hydration.
3. Whether `eventOgImageUrl(...)` and `brandOgImageUrl(...)` point to valid image assets in all cases.
4. Whether fallback `/og/event/{eventId}.png` and `/og/brand/{brandSlug}.png` routes exist, return valid `image/png`, and are deployed.
5. Whether cover images are publicly readable and suitable for preview cards.
6. What each major sharing platform is likely to display from the current metadata.
7. What caching or stale deploy behavior could make previews appear wrong even after a fix.
8. The smallest robust implementation that makes previews reliable without overbuilding.

## Required Design Contract For The Spec

The spec must define:

- Event preview card image strategy:
  - Preferred: event cover image as the dominant visual.
  - Overlay/branding: Mingla logo and event name, with optional date/location when safe and readable.
  - Fallback: Mingla-branded generated image when no event cover exists.
  - Target aspect ratio: 1200x630 or another proven platform-safe OG ratio.
- Brand preview card image strategy:
  - Preferred: brand profile/cover imagery.
  - Fallback: Mingla-branded generated image with brand name.
- Metadata:
  - `title`
  - `description`
  - `canonical`
  - `og:title`
  - `og:description`
  - `og:url`
  - `og:image`
  - `og:image:width`
  - `og:image:height`
  - `og:type`
  - `twitter:card`
  - `twitter:title`
  - `twitter:description`
  - `twitter:image`
- Privacy/safety rules:
  - Do not expose hidden/private address details in preview text.
  - Do not expose ticket-gated details that are intentionally hidden.
  - Cancelled/past/private-like states must have honest snippets.
- Deploy/caching rules:
  - Vercel cache headers for image routes.
  - How to verify the deployed bundle/routes are current.
  - How to retest platform previews when platforms cache old metadata.

## Success Criteria

- A curl/browser-bot inspection can prove event-specific title/description/image URL for a public event.
- Event OG image URL returns a valid preview image or valid uploaded cover image with expected headers.
- Brand OG image URL returns a valid preview image or valid uploaded brand image with expected headers.
- Shared links in iMessage and WhatsApp show an event-specific preview, not a generic Expo/Mingla placeholder.
- Preview uses the Mingla logo/branding and event cover/name where available.
- Unit/integration tests cover URL building, metadata rendering or metadata endpoint output, fallback behavior, privacy rules, and missing-image behavior.
- Manual release gates cover at least iMessage, WhatsApp, and one desktop/social crawler/debugger equivalent available to the tester.

## Output Requirements

The investigation report must include:

- Findings ranked P0/P1/P2.
- Root cause table with file/path evidence.
- Current vs expected crawler behavior.
- Blast radius across event page, brand page, native share payloads, web deploy, images/storage, and tests.
- Open questions clearly separated from proven facts.

The spec must include:

- Summary
- User story
- Non-goals
- Data/schema changes, or explicit "none"
- Public web changes
- Image-generation/asset strategy
- Metadata strategy
- Privacy rules
- Deploy/caching plan
- Test matrix
- Implementation order
- Rollback plan
- Handoff to implementor

## Anti-Patterns To Avoid

- Treating React-rendered metadata as crawler-safe without proving initial HTML.
- Adding pretty preview images while leaving `og:image` broken or inaccessible.
- Using wrong domains such as `mingla.com` or `business.mingla.com`.
- Relying only on simulator copy behavior as proof of real messaging behavior.
- Shipping generic link previews that do not show the event name or Mingla brand.
- Ignoring platform preview caches during verification.

