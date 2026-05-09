# SPEC - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

Date: 2026-05-09
Investigation: `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
Status: Ready for implementor dispatch

## 1. Layman Summary

Mingla links now work. This spec makes them feel polished.

The share button should send one clean link, not a payload that can look duplicated in iMessage. The preview card should look premium, not black-on-black. Event cards should show the event date. Brand cards should feel like a rich public brand page, not a generic fallback.

## 2. Scope

In scope:

- Fix share payload construction so iOS/Web targets receive the URL only once.
- Preserve Android share behavior so Android still receives the URL in `message`.
- Add copy/share in-flight guards in `ShareModal`.
- Rework event OG card data and visual design.
- Rework brand OG card data and visual design.
- Add focused tests and runtime QA gates.

Out of scope:

- Any explorer/consumer app change.
- Any admin app change.
- Any Supabase migration.
- Any canonical domain change.
- Any Stripe or checkout behavior change.
- Any broad redesign of the full public event or public brand pages.

## 3. Required Invariants

- Canonical public domain remains `https://business.usemingla.com`.
- Do not reintroduce `business.mingla.com`, `mingla.com/e`, Expo URLs, localhost, or draft-only URLs.
- Copy link writes only the canonical URL.
- Share via sends exactly one canonical URL per share invocation.
- Android share still includes the URL in `message`.
- iOS native share uses a separate `url` field and does not duplicate that URL inside `message`.
- Web Share API uses a separate `url` field and does not duplicate that URL inside `text`.
- OG images remain 1200x630 PNGs.
- Preview routes keep using only public data from `business_public_events_view`.

## 4. Share Payload Contract

### Files

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- `mingla-business/src/components/ui/ShareModal.tsx`

### Required behavior

Refactor share text construction into two concepts:

- `buildPublicShareBody(input)`:
  - returns description if present, otherwise title if present, otherwise empty string
  - never appends the URL
- `buildAndroidPublicShareMessage(input)`:
  - returns body plus URL, because React Native Android ignores `content.url`
  - includes the URL exactly once

`sharePublicUrl(input)` must branch by platform:

- Web:
  - call `navigator.share({ title, url, text })`
  - `text` must be body only, with no URL
  - if body is empty, omit `text`
- iOS:
  - call `Share.share({ title, message, url })`
  - `message` must be body only, with no URL
  - if body is empty, use `message: title` only if needed for useful preview text, but do not include URL
- Android:
  - call `Share.share({ title, message })`
  - `message` must include the URL exactly once
  - do not rely on `url` for Android

If the implementation needs to keep the same exported `buildPublicShareText` for compatibility, it may do so only as an Android-specific helper or alias. Tests must make this distinction explicit.

## 5. Share Modal In-Flight Guard Contract

### Files

- `mingla-business/src/components/ui/ShareModal.tsx`
- `mingla-business/src/components/ui/Button.tsx` only if absolutely necessary. Prefer no primitive change because `Button` already supports `loading` and `disabled`.

### Required behavior

Add local state:

- `isCopying`
- `isSharing`

`handleCopyLink`:

- If `isCopying` is true, return immediately.
- Set `isCopying` true before awaiting `copyPublicUrl`.
- Reset `isCopying` in `finally`.
- Pass `loading={isCopying}` and/or `disabled={isSharing}` to the Copy link button.

`handleNativeShare`:

- If `isSharing` is true, return immediately.
- Set `isSharing` true before awaiting `sharePublicUrl`.
- Reset `isSharing` in `finally`.
- Pass `loading={isSharing}` and/or `disabled={isCopying}` to the Share via button.

Error behavior:

- Preserve existing copy failure toast: `Copy failed. Try Share via instead.`
- Preserve existing web unsupported share toast.
- Do not show an error toast when a native user cancels the share sheet unless the current helper throws a real unsupported/error condition.

## 6. Event OG Card Contract

### Files

- `mingla-business/server/socialPreview.js`
- `mingla-business/api/og-event.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

### Data contract

Event OG generation must pass:

- `title`: event title
- `subtitle`: event description or safe fallback
- `kicker`: brand name
- `coverUrl`: public image cover when available and not video
- `dateLabel`: formatted event date from `public_theme.business_event.when.date`
- `locationLabel`: safe location/online cue when available
- `cardKind`: `"event"`

Date source:

- Primary: `eventDate(row)` in `server/socialPreview.js`, reading `public_theme.business_event.when.date`
- Format: reuse or extend current `formatDate(...)`
- Missing date fallback: `"Date to be announced"` or `"Date TBD"`, but do not fabricate a date.

Visual contract:

- Avoid a flat black full-card design.
- Use a warm off-white/cream panel or other high-contrast treatment behind the orange Mingla Business logo.
- Keep the event cover visually dominant when available.
- If no cover is available, use a warm branded gradient/fallback that is not black-dominant.
- Show the date as a visible first-class chip or line on the PNG card.
- Keep brand name and event title readable at small preview sizes.
- Keep the logo legible, but do not place black logo artwork inside a nearly identical black panel.
- Keep `business.usemingla.com` visible only if contrast is sufficient; otherwise remove or restyle it.

Suggested hierarchy for 1200x630:

1. Event cover or warm branded visual field
2. Event date chip
3. Event title
4. Brand name
5. Location/online cue if space allows
6. Mingla Business logo on a light/high-contrast tile

## 7. Brand OG Card Contract

### Files

- `mingla-business/server/socialPreview.js`
- `mingla-business/api/og-brand.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`

### Data contract

Brand OG generation must pass:

- `title`: brand name
- `subtitle`: brand description or safe fallback
- `kicker`: `@brandSlug`
- `profilePhotoUrl`: brand profile photo when available
- `eventCountLabel`: count of public events from `business_public_events_view`
- `nextEventLabel`: optional next event title/date cue when derivable from rows
- `coverUrl`: use profile photo or next event cover when available
- `cardKind`: `"brand"`

Brand page richness rules:

- Use the same visual system as event cards: warm Mingla Business branding, high-contrast logo tile, polished composition.
- The brand card should not feel like a weaker text-only fallback.
- If a profile photo exists, use it prominently.
- If profile photo is missing but a public event cover exists, use the event cover as supporting visual.
- If both are missing, use a branded warm fallback.
- Show brand handle and event count.
- If a next upcoming event/date can be safely derived, show that cue. If not, fall back to event count only.

Sorting note:

- Current `fetchPublicBrandBySlug` orders by `published_at.desc.nullslast`.
- If showing "next event", implementation must sort candidate rows by parsed event date from `public_theme.business_event.when.date` and ignore cancelled/ended rows unless no upcoming rows exist.

## 8. Metadata HTML Contract

### Files

- `mingla-business/server/socialPreview.js`
- `mingla-business/api/public-event.js`
- `mingla-business/api/public-brand.js`

Event crawler HTML:

- Already shows event date in HTML. Preserve this.
- If the card image URL changes format for cache-busting, update `og:image` and `twitter:image` consistently.

Brand crawler HTML:

- Preserve canonical URL and OG/Twitter tags.
- Keep event links canonical or root-relative only if the existing human route still resolves. Prefer absolute canonical URLs in generated crawler HTML for clarity.
- If brand card has richer data, keep the HTML description aligned with the card.

## 9. Cache-Busting Contract

Social preview caches are real product risk.

Implementation must choose one:

- Keep the same OG image URLs and document that testers must use a newly created event/brand or wait for cache expiry.
- Or add a deterministic version query such as `?v=0763f` or `?updated={updated_at}` to `og:image` URLs for event/brand metadata.

If adding query params:

- Keep image route paths canonical.
- Ensure the image endpoint ignores unknown query params.
- Add tests proving `og:image` stays on `business.usemingla.com`.

## 10. Test Requirements

### Share helper tests

Update `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`:

- iOS native share payload:
  - has `url: canonicalUrl`
  - `message` does not contain `canonicalUrl`
  - serialized payload contains `canonicalUrl` exactly once
- Android native share payload:
  - `message` contains `canonicalUrl` exactly once
  - does not rely on `url`
- Web share payload:
  - has `url: canonicalUrl`
  - `text` does not contain `canonicalUrl`
  - serialized payload contains `canonicalUrl` exactly once
- Preserve no bad-domain assertions:
  - no `exp://`
  - no `localhost`
  - no `https://mingla.com/e`
  - no `business.mingla.com`

### Share modal tests

Add a focused test for `ShareModal` if the current test setup supports React Native component rendering. If not, add a source-level guard test as a temporary regression gate and document it.

Required assertions:

- Copy button uses pending state.
- Share via button uses pending state.
- Repeated `handleNativeShare` while pending cannot call `sharePublicUrl` twice.

### Social preview tests

Update `mingla-business/server/__tests__/socialPreview.test.ts`:

- Event fixture with `public_theme.business_event.when.date` produces event HTML with the formatted date.
- Event OG input/render contract includes date label.
- Brand render contract includes brand handle and event count.
- Brand OG input/render contract includes richer brand fields.
- No wrong domains appear in event or brand HTML.

Because PNG visual parsing is brittle, tests should prefer pure data/layout-contract assertions. If the renderer is refactored into `buildEventOgCardProps` and `buildBrandOgCardProps`, unit test those pure helpers directly.

## 11. Runtime QA Requirements

After implementation and deploy:

1. Build/install or reload the current business app path being tested.
2. Create or use a fresh public event with a free ticket and a clear future date.
3. From the business app event share modal:
   - Copy link: paste into Notes or browser; exact URL should appear once.
   - Share via -> iMessage: message should contain one preview/link, not duplicate URL content.
   - Share via -> WhatsApp: message should contain one usable public URL.
4. From the public event page:
   - Open event link in browser.
   - Use share button if available.
   - Confirm preview image shows event date.
5. From the public brand page:
   - Share brand link.
   - Confirm preview image uses rich Mingla Business branding and brand/event cues.
6. Curl checks:
   - `curl -A 'WhatsApp/2.24.0 i' https://business.usemingla.com/e/{brandSlug}/{eventSlug}`
   - `curl -A 'WhatsApp/2.24.0 i' https://business.usemingla.com/b/{brandSlug}`
   - `curl -I https://business.usemingla.com/og/event/{eventId}.png`
   - `curl -I https://business.usemingla.com/og/brand/{brandSlug}.png`

## 12. Implementation Order

1. Refactor share helper payload construction and update tests.
2. Add `ShareModal` in-flight guards.
3. Refactor OG card data props into explicit event/brand card prop builders.
4. Add event date to event OG card data and layout.
5. Add richer brand card data and layout.
6. Add or update tests.
7. Run focused gates:
   - `npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand`
   - `npx tsc --noEmit --pretty false`
   - `node --check server/socialPreview.js api/og-event.js api/og-brand.js api/public-event.js api/public-brand.js`
8. Deploy business web.
9. Run runtime QA against fresh or cache-busted event/brand links.

## 13. Rollback Safety

- Share helper changes are client-side and can be rolled back without DB changes.
- OG renderer changes are server/web deploy only.
- No migration rollback needed.
- If visual renderer breaks in Vercel, rollback to the previous deployment restores working but less polished cards.

## 14. Definition Of Done

- iMessage no longer receives duplicate URL payload from app code.
- Fast repeated taps cannot invoke share twice while the first share is pending.
- Event OG card visibly includes event date.
- Mingla Business logo has enough contrast and does not sit black-on-black.
- Brand OG card has rich branded parity with event card direction.
- Tests prove share payload de-duplication and preview data contracts.
- Deployed smoke confirms event and brand preview links still use `https://business.usemingla.com`.
