# IMPLEMENTATION - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

Date: 2026-05-09
Status: implemented and verified

## Summary

Implemented the scoped Mingla Business share polish fix.

The business app now sends one canonical public URL per share payload, guards the share modal against repeat copy/share taps while an action is pending, and generates warmer event/brand OG cards with visible event date and richer brand cues.

No explorer, admin, Supabase, Stripe, checkout, or migration files were touched.

## Files Changed

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- `mingla-business/server/socialPreview.js`
- `mingla-business/api/og-event.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

## What Changed

### Share payloads

- Added `buildPublicShareBody(...)` for description/title text without a URL.
- Added `buildAndroidPublicShareMessage(...)` for Android-only URL-in-message behavior.
- Kept `buildPublicShareText` as an alias of the Android URL-bearing helper for compatibility.
- Web Share API now sends:
  - `url`: canonical public URL
  - `text`: description/title only, no URL
- iOS/native now sends:
  - `url`: canonical public URL
  - `message`: description/title only, no URL
- Android/native now sends:
  - `message`: description/title plus canonical URL exactly once
  - no separate `url` dependency, because React Native Android ignores it

### Share modal

- Added `isCopying` and `isSharing` pending state.
- Copy link returns early while copy is already pending.
- Share via returns early while share is already pending.
- Copy and share buttons now use existing `Button` loading/disabled states.
- Existing success/failure toast behavior was preserved.

### Event OG card

- Added `buildEventOgCardProps(...)`.
- Event OG cards now receive:
  - event title
  - brand name
  - formatted event date from `public_theme.business_event.when.date`
  - location/online cue when available
  - cover image when available and not video
- Reworked card design away from flat black:
  - warm Mingla cream/orange background
  - high-contrast logo tile
  - visible event date chip
  - readable event title and description

### Brand OG card

- Added `buildBrandOgCardProps(...)`.
- Brand OG cards now receive:
  - brand name
  - `@brandSlug`
  - event count
  - next event/date cue when derivable
  - profile photo or next event cover when available
- Brand card uses the same richer Mingla Business visual system as event cards.

## Cache-Busting Decision

Kept existing OG image URL paths.

Reason: this avoids changing public URL contracts during a launch polish pass. Runtime QA should use a newly created event/brand or a fresh share target when validating iMessage/WhatsApp previews because those platforms cache aggressively.

## Verification

Passed:

- `PATH="/opt/homebrew/bin:$PATH" npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand`
  - 2 suites passed
  - 11 tests passed
- `PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --pretty false`
- `PATH="/opt/homebrew/bin:$PATH" node --check server/socialPreview.js api/og-event.js api/og-brand.js api/public-event.js api/public-brand.js`
- `git diff --check`
- Local OG render smoke:
  - `renderOgPng(buildEventOgCardProps(...))` returned PNG bytes
  - `renderOgPng(buildBrandOgCardProps(...))` returned PNG bytes
  - generated files were `1200 x 630` PNGs

Notes:

- Jest emitted an existing Watchman recrawl warning. Tests still passed.

## Residual Risks

- iMessage/WhatsApp preview caches may show stale cards until a fresh event/brand URL or cache expiry.
- Runtime proof of iMessage no-duplicate behavior still requires device/simulator smoke because iMessage rendering is outside repo control.
- The ShareModal pending guard is covered by a source-level regression test, not a full React Native interaction test, because the current focused helper test suite is not a component-rendering harness.

## Deploy / Tester Gates

Required next:

1. Deploy `mingla-business` web to Vercel so updated OG card rendering is live.
2. Runtime smoke with a fresh or cache-safe event:
   - Copy link writes exact public URL once.
   - Share via -> iMessage does not show duplicate URL/share content.
   - Share via -> WhatsApp still shares a usable public URL.
   - Event preview card shows event date.
   - Brand preview card shows rich brand/event cues.

No DB push is required.
