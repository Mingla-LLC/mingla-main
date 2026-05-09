# IMPLEMENTOR PROMPT - ORCH-0763E Rich Social Previews + Mingla Business Brand Assets

You are `$implementor` for Mingla. Implement only the scoped ORCH-0763E work below. Preserve unrelated in-progress work and do not revert user or agent changes.

## Context

The operator verified that app-native sharing can send a working public event link through iMessage and WhatsApp. The remaining product gap is rich preview quality: the shared snippet should look like a mature event platform preview, with event name, event cover, Mingla logo, SEO-friendly title/description, and correct public URL.

Forensics already found:

- Public event pages currently rely on client-side metadata.
- Link preview crawlers can receive a generic Expo/web shell instead of event-specific Open Graph metadata.
- `/og/event/{id}.png` and `/og/brand/{slug}.png` style image URLs are referenced/tested but not actually implemented as real web routes.
- Production returns 404/text for missing OG image routes.
- The correct canonical public domain is `https://business.usemingla.com`.

The operator also provided Mingla Business logo files:

- `/Users/sethogieva/Downloads/Mingla_Business_Logo.png`
- `/Users/sethogieva/Downloads/Mingla_Business_Logo.svg`

These should be copied or derived into repo-owned assets. Do not leave app/runtime references pointing at `/Users/sethogieva/Downloads`.

## Scope

### 1. Rich Public Link Previews

Implement crawler-visible metadata for public event and brand pages:

- Public event pages must expose correct server/crawler-visible:
  - `<title>`
  - meta description
  - canonical URL
  - `og:title`
  - `og:description`
  - `og:url`
  - `og:type`
  - `og:image`
  - Twitter card metadata
- Brand pages should expose equivalent brand metadata where the app has enough brand data.
- Use `https://business.usemingla.com` for canonical URLs.
- Do not reintroduce `mingla.com`, `business.mingla.com`, Expo URLs, localhost, or draft-only URLs into share metadata.

Implement real OG image endpoints:

- Event OG image endpoint should render a 1200x630 share image.
- Brand OG image endpoint should render a 1200x630 share image.
- Event cover media should be the dominant visual when available.
- Mingla Business logo should be used as a visible brand mark/fallback.
- If event cover media is missing, generate a polished Mingla-branded fallback.
- Endpoints must return image content with correct content type, not a 404 or text page.

Prefer the existing web hosting/deploy architecture. If Expo Router web cannot serve the metadata/OG requirements cleanly, implement the smallest compatible route layer needed for Vercel/web crawling and document why.

### 2. Mingla Business Brand Assets

Bring the provided Mingla Business logo into the repo as canonical business assets. Recommended source paths are under `mingla-business/assets/brand/`, but follow existing conventions if the app already has a better pattern.

Update business app identity surfaces:

- App icon
- iOS splash screen image
- Android adaptive icon foreground/background/monochrome where applicable
- Web favicon
- Visible business app brand identity surfaces that currently show old/generic React/placeholder branding

Current files known to inspect:

- `mingla-business/app.json`
- `mingla-business/assets/images/icon.png`
- `mingla-business/assets/images/splash-icon.png`
- `mingla-business/assets/images/android-icon-foreground.png`
- `mingla-business/assets/images/android-icon-background.png`
- `mingla-business/assets/images/android-icon-monochrome.png`
- `mingla-business/assets/images/favicon.png`
- `mingla-business/assets/mingla_official_logo.png`

Do not do a broad visual redesign. This pass is asset identity, app-shell branding, and link preview polish.

### 3. Rebuild/Deploy Implications

Document this clearly in the implementation report:

- Native app icon and splash changes require a new native build/install to appear on iOS/Android.
- Web favicon, metadata, and OG routes require a fresh web deploy before real iMessage/WhatsApp/social preview testing.
- Platform link previews may cache aggressively; include practical cache-busting verification URLs if needed.

## Non-Goals

- No database migration unless you prove one is absolutely required.
- No Stripe changes.
- No event publish/share-link domain rewrite beyond preserving the already-correct canonical domain.
- No unrelated UI redesign.
- No destructive asset cleanup unless every reference is proven updated.

## Verification Required

Run the strongest relevant gates available in this repo. Minimum expected:

- `git diff --check`
- TypeScript check for affected workspace
- focused Jest tests covering public URL/share metadata behavior
- existing ORCH-0763E tests:
  - public URLs
  - public event service
  - share public URL
- Expo/web config or export validation for affected business app
- asset dimension/content inspection for generated icon/splash/favicon/OG assets
- local web/browser smoke where possible:
  - public event route emits event-specific metadata in page source or crawler-visible response
  - OG image route returns image content
  - no wrong domains appear in generated metadata

If a gate cannot run, explain exactly why and what remains unproven.

## Required Output

Create:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`

The report must include:

- Files changed
- Exact user-visible impact
- Native rebuild requirement
- Web deploy requirement
- Verification commands and results
- Any residual risks, especially platform preview cache behavior
