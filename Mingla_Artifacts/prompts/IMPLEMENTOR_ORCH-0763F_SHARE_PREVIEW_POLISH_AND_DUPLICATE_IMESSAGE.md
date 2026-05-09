# IMPLEMENTOR PROMPT - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

You are `$implementor` for Mingla. Implement the approved ORCH-0763F spec exactly. This is a scoped business-app polish/reliability fix. Do not broaden into explorer, admin, Supabase schema, Stripe, checkout, or unrelated public-event behavior.

## Context

The public share system is alive after ORCH-0763E:

- public links use `https://business.usemingla.com`
- deployed crawler metadata exists
- event/brand OG routes return real 1200x630 PNGs
- operator confirmed iMessage/WhatsApp shared links open correctly

Post-deploy issues remain:

1. iMessage sometimes appears to share twice.
2. Share preview card background is too black-heavy, so the Mingla Business logo does not pop.
3. Brand public-page share preview should feel as rich as event share preview.
4. Event share-card design should visibly include event date.

Forensics found:

- The app sends the canonical URL twice in share payloads for iOS/Web: once inside text/message and once in the `url` field.
- `ShareModal` has no in-flight guard, so fast repeated taps can invoke share/copy again.
- Event date exists in crawler HTML, but not inside the PNG OG card.
- Event and brand OG cards use the same generic black-heavy renderer.

## Required Evidence To Read First

Read these before editing:

- `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
- `Mingla_Artifacts/reports/DEPLOY_ORCH-0763E_ORCH-0764B_BUSINESS_WEB.md`

## Scope

Allowed product files/surfaces:

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/server/socialPreview.js`
- `mingla-business/api/og-event.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`
- minimal adjacent test/config changes only if required to keep the scoped tests meaningful

Do not touch:

- `app-mobile/`
- `mingla-admin/`
- Supabase migrations/functions
- Stripe functions/services
- checkout behavior
- explorer/consumer app
- unrelated docs/artifacts except the implementation report

## Implementation Contract

### 1. De-duplicate Share Payloads

In `mingla-business/src/utils/sharePublicUrl.ts`:

- Split share body from URL-bearing share message.
- Web Share API:
  - send `url` in `url`
  - send description/title only in `text`
  - `text` must not contain the URL
- iOS/native:
  - send `url` in `url`
  - send description/title only in `message`
  - `message` must not contain the URL
- Android/native:
  - keep the URL in `message`, because React Native Android ignores `url`
  - URL must appear exactly once
  - do not rely on `url` for Android

Preserve:

- canonical `https://business.usemingla.com` URL behavior
- bad-domain protections against `exp://`, `localhost`, `https://mingla.com/e`, and `business.mingla.com`

### 2. Add ShareModal In-Flight Guards

In `mingla-business/src/components/ui/ShareModal.tsx`:

- Add `isCopying` and `isSharing`.
- Copy link:
  - return early if already copying
  - set/reset pending state with `finally`
  - use existing Button `loading`/`disabled` props
- Share via:
  - return early if already sharing
  - set/reset pending state with `finally`
  - use existing Button `loading`/`disabled` props
- Preserve current toast behavior.
- Do not change the modal's visual system beyond pending/disabled state.

### 3. Rework Event OG Card

In `mingla-business/server/socialPreview.js` and `mingla-business/api/og-event.js`:

- Event OG card must receive and render:
  - event title
  - brand name
  - formatted event date from `public_theme.business_event.when.date`
  - safe location/online cue when available
  - cover image when available and not video
  - Mingla Business logo
- The generated PNG must visibly show the event date.
- The logo must have enough contrast. Do not place the black-background logo on a nearly black tile.
- Avoid a flat black-dominant card. Use a warmer, richer branded design.
- Keep 1200x630 PNG output.
- Preserve privacy: only use data already available from `business_public_events_view`.

### 4. Rework Brand OG Card

In `mingla-business/server/socialPreview.js` and `mingla-business/api/og-brand.js`:

- Brand OG card must feel like the brand public page, not a generic fallback.
- Include:
  - brand name
  - `@brandSlug`
  - event count
  - optional next-event/date cue when safely derivable
  - profile photo when available, otherwise next event cover when available, otherwise branded fallback
  - Mingla Business logo with strong contrast
- Use the same Mingla Business visual system as event cards.
- Keep output 1200x630 PNG.

### 5. Cache-Busting Decision

Choose and document one:

- keep existing OG image URLs and require fresh event/brand URLs for real-world preview retest, or
- add a deterministic preview version query such as `?v=0763f` or `?updated={updated_at}` to `og:image` and `twitter:image`

If adding a query:

- keep domain canonical
- route must still return image/png
- tests must prove no wrong domains

## Required Tests

Update or add focused tests:

1. `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
   - iOS payload contains canonical URL exactly once.
   - iOS `message` does not contain canonical URL.
   - Web payload contains canonical URL exactly once.
   - Web `text` does not contain canonical URL.
   - Android `message` contains canonical URL exactly once.
   - Android does not rely on `url`.
   - no bad domains appear in serialized payloads.

2. `ShareModal` guard coverage
   - Prefer a real component test if local test harness supports it.
   - If not, add a temporary source-level guard test documenting why.
   - Assert copy/share pending state exists and repeated share while pending cannot call the helper twice.

3. `mingla-business/server/__tests__/socialPreview.test.ts`
   - event preview data/card contract includes formatted event date.
   - brand preview data/card contract includes brand handle and event count.
   - brand preview can include next-event cue when event date exists.
   - event/brand HTML still uses canonical `business.usemingla.com`.
   - no `business.mingla.com`, `mingla.com/e`, `localhost`, or `exp://`.

## Required Verification

Run from `mingla-business/`:

- `PATH="/opt/homebrew/bin:$PATH" npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand`
- `PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --pretty false`
- `PATH="/opt/homebrew/bin:$PATH" node --check server/socialPreview.js api/og-event.js api/og-brand.js api/public-event.js api/public-brand.js`
- `git diff --check`

If feasible, also smoke render OG PNG locally using the existing server helper test pattern. Do not require live iMessage/WhatsApp proof from implementor; that is a tester/runtime gate after deploy.

## Required Output

Write:

`Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

Include:

- files changed
- exact share payload behavior by platform
- visual/card design changes
- cache-busting decision
- tests run and exact results
- residual risks
- deploy/runtime gates for tester

## Hard Guards

- Do not alter canonical domain.
- Do not touch explorer app.
- Do not touch admin app.
- Do not add Supabase migrations.
- Do not change Stripe/checkout behavior.
- Do not close ORCH-0763F. Return implementation evidence to orchestrator/user.
