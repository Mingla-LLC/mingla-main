# REVIEW - ORCH-0763E Rich Social Previews + Mingla Business Brand Assets

Date: 2026-05-09
Mode: Orchestrator review
Verdict: Approved for implementation handoff

## Plain-English Finding

The public event link now works when shared from the app. The remaining issue is not the link destination. The issue is the preview card that iMessage, WhatsApp, and social platforms generate from the link.

Right now those platforms mostly see a generic Expo/web shell instead of event-specific metadata. That means they cannot reliably show the event name, cover image, Mingla logo, or a polished description. For rich previews, crawler-visible HTML and Open Graph/Twitter metadata must exist before the app JavaScript loads.

## New Brand Asset Input

The operator provided the Mingla Business logo assets:

- `/Users/sethogieva/Downloads/Mingla_Business_Logo.png`
- `/Users/sethogieva/Downloads/Mingla_Business_Logo.svg`

Local asset inspection confirms the files exist. The PNG is a 2000x2000 RGBA logo asset. The SVG is also available, but is large and includes embedded image data, so implementation should optimize/copy only what is needed into the repo rather than depending on `Downloads`.

## Current Product Impact

Users can share event links, and recipients can open them when the correct public URL is sent.

The preview still feels unfinished: instead of a polished Eventbrite-style card with Mingla branding, event name, cover image, and good SEO/social metadata, shared links may look generic or incomplete depending on platform cache behavior.

## Implementation Scope Approved

The next implementation pass should combine two related pieces of work:

1. Rich public event/brand previews
   - Add crawler-visible title, description, canonical URL, Open Graph, and Twitter metadata for public event and brand pages.
   - Implement real dynamic OG image endpoints for event and brand cards.
   - Use event cover media as the dominant preview image when available.
   - Use the Mingla Business logo as the brand mark/fallback.

2. Mingla Business app branding assets
   - Bring the provided logo into the repo as a canonical business brand asset.
   - Use it for app icon, splash screen, favicon, Android adaptive icon surfaces, and visible app brand identity surfaces where old/generic assets appear.
   - Do not perform a broad redesign. This is a focused brand asset replacement and preview-quality pass.

## Required Gates

- No DB migration is expected for this pass.
- Native app icon/splash changes require a native rebuild before iOS/Android runtime verification.
- Web favicon/SEO/OG changes require a fresh web deploy before real platform preview testing.
- Existing correct public domain behavior must remain intact: `https://business.usemingla.com/...`.
- Preview metadata must not reintroduce old wrong domains such as `mingla.com` or `business.mingla.com`.

## Next Action

Dispatch `$implementor` with:

`Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`

Expected implementation report:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
