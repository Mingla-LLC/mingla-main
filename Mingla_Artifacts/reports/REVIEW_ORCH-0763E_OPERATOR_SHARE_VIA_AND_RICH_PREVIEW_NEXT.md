# Review: ORCH-0763E Operator Share-Via Evidence + Rich Preview Next

> Date: 2026-05-09  
> Role: ORCHESTRATOR / PMM REVIEW  
> Source: Operator runtime evidence from production build/device sharing

## Plain-English Decision

The share-link problem has changed shape.

The operator tested **Share via...** from the build with real recipients over iMessage and WhatsApp. The recipients received the public Mingla event link and the link opened successfully. That means the core customer job, "send this event to someone and let them open it," is working in real-world messaging channels.

The remaining gap is now a launch-quality and conversion issue: the shared link preview needs to look like a real Mingla/Eventbrite-style event card with the Mingla logo, event cover image, event name, and SEO-friendly metadata.

## What This Reclassifies

- The tester's simulator **Share via... -> iOS Copy** failure remains useful evidence, but it is no longer proof that sharing itself is broken.
- Direct in-app **Copy link** already passed.
- Real **Share via...** to iMessage and WhatsApp passed by operator evidence.
- The share-sheet internal **Copy** action can remain a lower-priority copy-specific/manual-test gap unless the product explicitly promises that exact share-sheet action.

## New Workstream

Register ORCH-0763E: **Rich Social Link Preview + SEO Snippet**

Customer impact:

- Guests should trust the link before tapping.
- Organisers should feel proud sharing the event.
- Mingla links should look branded and professional in iMessage, WhatsApp, Slack, Facebook, X/Twitter, and search snippets.

Business impact:

- Better shared previews should improve click-through, perceived legitimacy, and guest conversion.
- Poor previews make Mingla feel unfinished even when the underlying link works.

## Evidence Starting Points

- `mingla-business/src/components/event/PublicEventPage.tsx` already sets web-only `<Head>` metadata.
- `mingla-business/src/components/brand/PublicBrandPage.tsx` sets brand-page metadata.
- `mingla-business/src/constants/publicUrls.ts` builds event and brand OG image URLs.
- `eventOgImageUrl(...)` falls back to `/og/event/{eventId}.png`.
- `brandOgImageUrl(...)` falls back to `/og/brand/{brandSlug}.png`.
- Current file scan only found `/app/e/[brandSlug]/[eventSlug].tsx`; no proven `/og/event` or `/og/brand` route was found in this review.

## Risk To Prove Before Implementation

The source may be setting metadata client-side after hydration. Many link-preview crawlers do not wait like a browser user. If the event-specific title/image/description are not present in the initial HTML response, iMessage/WhatsApp/Slack may show generic or stale previews no matter how good the React component looks after load.

## Recommended Next Action

Dispatch `$forensics` with:

`Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`

Do not jump straight to implementation. This touches public SEO, crawler behavior, image generation, web deploy caching, event/brand fallback images, and platform-specific preview caches.

