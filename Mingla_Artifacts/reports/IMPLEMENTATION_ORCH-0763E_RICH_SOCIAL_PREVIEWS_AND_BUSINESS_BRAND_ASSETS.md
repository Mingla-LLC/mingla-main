# IMPLEMENTATION - ORCH-0763E Rich Social Previews + Mingla Business Brand Assets

Date: 2026-05-09
Status: implemented and verified

## Summary

Implemented the Mingla Business logo and rich social preview pass for `mingla-business` only. No explorer/consumer app files were touched.

The business app now has repo-owned Mingla Business logo assets, regenerated app icon/splash/favicon/adaptive-icon images, visible login/landing/404 logo references updated to the new logo, and Vercel API routes for crawler-visible event/brand metadata plus dynamic 1200x630 OG image cards.

## User Impact

- App icon, splash screen, Android adaptive icon, web favicon, welcome screen, landing screen, and 404 screen now use the supplied Mingla Business logo asset.
- Shared event/brand links can produce richer previews with Mingla branding, event/brand text, canonical `business.usemingla.com` URLs, and dynamic OG images after web deploy.
- Normal browser users still go to the existing Expo public event/brand pages. Vercel only routes known crawler/social bot user agents to the lightweight metadata HTML.

## Files Changed

New/updated brand assets:

- `mingla-business/assets/brand/mingla-business-logo.png`
- `mingla-business/assets/brand/mingla-business-logo.svg`
- `mingla-business/public/brand/mingla-business-logo.png`
- `mingla-business/public/brand/mingla-business-logo.svg`
- `mingla-business/assets/images/icon.png`
- `mingla-business/assets/images/splash-icon.png`
- `mingla-business/assets/images/android-icon-foreground.png`
- `mingla-business/assets/images/android-icon-background.png`
- `mingla-business/assets/images/android-icon-monochrome.png`
- `mingla-business/assets/images/favicon.png`

App/web config and visible branding:

- `mingla-business/app.json`
- `mingla-business/vercel.json`
- `mingla-business/app/+not-found.tsx`
- `mingla-business/src/components/auth/BusinessWelcomeScreen.tsx`
- `mingla-business/src/components/landing/BusinessLandingScreen.tsx`
- `mingla-business/src/components/event/PublicEventPage.tsx`
- `mingla-business/src/components/brand/PublicBrandPage.tsx`

New preview runtime:

- `mingla-business/server/socialPreview.js`
- `mingla-business/api/public-event.js`
- `mingla-business/api/public-brand.js`
- `mingla-business/api/og-event.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

Dependency:

- `mingla-business/package.json`
- `mingla-business/package-lock.json`

This pass added `@vercel/og`. Existing package/test-script changes from prior work were preserved.

## Implementation Notes

- Copied the supplied logo from `/Users/sethogieva/Downloads` into repo-owned business asset paths. Runtime code no longer depends on `Downloads`.
- Generated the native/web icon derivatives from the supplied PNG.
- Set splash and Android adaptive icon backgrounds to Mingla black `#050505`.
- Added dynamic OG image routes:
  - `/og/event/:eventId.png`
  - `/og/brand/:brandSlug.png`
- Added crawler metadata routes:
  - `/api/public-event`
  - `/api/public-brand`
- Added bot-only Vercel rewrites for `/e/:brandSlug/:eventSlug` and `/b/:brandSlug`, preserving the regular Expo app routes for humans.
- Added Twitter image metadata to the existing client-side public event/brand `<Head>` tags for browser-side parity.

## Verification

Passed:

- `PATH="/opt/homebrew/bin:$PATH" npx jest publicUrls.test publicEventsService.test sharePublicUrl.test socialPreview.test --runInBand`
  - 4 suites passed
  - 15 tests passed
- `PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --pretty false`
- `PATH="/opt/homebrew/bin:$PATH" npx expo config --type public`
  - confirmed icon paths, splash image, splash background `#050505`, Android adaptive icon background `#050505`, canonical `business.usemingla.com`
- `PATH="/opt/homebrew/bin:$PATH" npx expo export -p web`
  - export completed to `dist`
  - `dist/brand/mingla-business-logo.png` and `.svg` were present
- `node --check` for all new server/API JS files
- `git diff --check` for the scoped changed files
- targeted ESLint for new server/API routes and touched public/brand/page surfaces passed
- OG image smoke:
  - `renderOgPng(...)` returned a PNG buffer
- asset inspection:
  - icon: 1024x1024 PNG
  - splash: 1024x1024 PNG
  - Android foreground/background/monochrome: PNG
  - favicon: 48x48 PNG

Notes:

- Jest emitted an existing Watchman recrawl warning. Tests still passed.
- Expo export emitted existing Sentry config and Stripe Connect SSR warnings. Export still passed.
- Full lint including `BusinessWelcomeScreen.tsx` still reports an existing `react-hooks/exhaustive-deps` warning unrelated to this logo reference change.

## Deployment / Runtime Gates

No DB migration is required.

Web deploy required:

- Vercel must deploy the new `api/*`, `server/*`, `vercel.json`, public brand assets, and web bundle before iMessage/WhatsApp/social preview cards can be tested in the wild.
- Social preview platforms cache aggressively. If a preview looks stale after deploy, test with a newly published event or a cache-busting share URL first.

Native rebuild required:

- iOS and Android app icon/splash/adaptive-icon changes require a new native build/install.
- JS-visible logo updates on welcome/landing/404 can update through normal JS/web deployment paths, but native icon/splash cannot.

## Residual Risk

- Bot-only Vercel routing covers common crawlers: Facebook, Twitter/X, Slack, Discord, WhatsApp, LinkedIn, Telegram, Applebot, and generic bot/crawler/spider user agents. Unknown preview crawlers may still hit the normal Expo static shell until their user agent is added.
- The live crawler metadata routes depend on public Supabase REST access to `business_public_events_view`, matching the current public web read model.
- Final real-world proof still requires deploying web, sharing a fresh event link into iMessage/WhatsApp, and confirming the preview card uses the event name, cover/fallback image, and Mingla Business logo.
