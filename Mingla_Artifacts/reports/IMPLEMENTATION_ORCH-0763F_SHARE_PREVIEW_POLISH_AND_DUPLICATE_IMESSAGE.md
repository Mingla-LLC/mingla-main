# IMPLEMENTATION - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

Date: 2026-05-09
Status: implemented and verified locally
Prompt: `Mingla_Artifacts/prompts/IMPLEMENTOR_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
Spec: `Mingla_Artifacts/specs/SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
Amendment: `Mingla_Artifacts/reports/REVIEW_ORCH-0763F_SHARE_PREVIEW_LONG_TEXT_OVERFLOW_AMENDMENT.md`

## Summary

Implemented the scoped ORCH-0763F business-app share preview fix.

The share helper now strips the canonical URL from share body text before passing iOS/Web payloads, so the URL appears only in the dedicated `url` field for those platforms. Android still gets the URL in `message` exactly once. The existing `ShareModal` in-flight guards were audited and verified present.

The OG renderer keeps the warm Mingla Business card system, includes event date/location and brand event cues, and adds deterministic long-text fit parameters so long event titles, brand names, venue labels, and next-event labels cannot expand into adjacent zones. Follow-up correction on 2026-05-09 confirmed the correct share contract: `og:image` / `twitter:image` must point to the branded Mingla OG banner route, while uploaded event covers, brand profile photos, or brand covers remain artwork inside that rendered banner rather than replacing the banner.

## Files Changed

- `mingla-business/src/utils/sharePublicUrl.ts`
- `mingla-business/src/utils/__tests__/sharePublicUrl.test.ts`
- `mingla-business/server/socialPreview.js`
- `mingla-business/server/__tests__/socialPreview.test.ts`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`

Audited but not changed:

- `mingla-business/src/components/ui/ShareModal.tsx`

## Old To New Receipts

### Share Payloads

Before:

- iOS/Web could receive the canonical URL inside text/message and again inside the `url` field.
- If organiser-provided description text already included the URL, the helper could still duplicate it.

After:

- `buildPublicShareBody` strips the supplied canonical URL from body copy.
- Web sends `{ title, url, text }`, where `text` never contains the canonical URL.
- iOS sends `{ title, message, url }`, where `message` never contains the canonical URL.
- Android sends `{ title, message }`, where `message` contains the canonical URL exactly once.

### OG Metadata

Before:

- Metadata could select public cover/profile media when present.
- In production, that allowed WhatsApp to render a logo-only uploaded event cover instead of the designed Mingla branded share banner.

After:

- Event metadata uses `https://business.usemingla.com/og/event/{eventId}.png`.
- Brand metadata uses `https://business.usemingla.com/og/brand/{brandSlug}.png`.
- Uploaded event covers, brand profile photos, and brand covers still flow into the OG renderer as `coverUrl` artwork.
- Long-text shrinking is isolated to the rendered Mingla OG banner.

### Long Text Fit

Added `buildOgTextFit` in `server/socialPreview.js`:

- font-size buckets based on title/brand-name length
- explicit max title heights
- bounded chip heights
- bounded subtitle height
- slot-specific truncation for title, subtitle, primary chip, secondary chip, and accent label

Regression fixtures cover:

- `Runtime Share Test FreeTA throwaway free-ticket QA`
- `Runtime Share Test FreeTA throwaway free-ticket QA Collective`
- `The venue - The place with a very long neighbourhood label`
- long next-event label plus date

Direct PNG smoke:

- long event card rendered `124463` bytes
- long brand card rendered `131231` bytes

## Spec Traceability

Met:

- iOS/Web duplicate URL payload removed.
- Android URL-in-message behavior preserved.
- Copy/share in-flight guard verified in `ShareModal`.
- Event OG card data includes event date and location.
- Brand OG card data includes event count and next-event cue.
- Long event/brand/venue/next-event text has a deterministic bounded fit contract.
- OG image URL selection always points shared-link crawlers at Mingla branded OG banner routes; source images remain banner artwork.
- Bad-domain tests preserve the canonical `business.usemingla.com` contract.

Intentional constraint reconciliation:

- The ORCH-0763F prompt asked for `@brandSlug` in brand OG cards, but active ORCH-0768 public identity honesty removed public slug/handle display. This implementation preserves the no-public-handle behavior already enforced by `socialPreview.test.ts` and keeps `kicker: "Mingla Business"` for brand cards. That avoids reintroducing the exact identity-honesty defect ORCH-0768 is removing.

## Verification

Commands run from `mingla-business/` unless noted.

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand
```

Result: PASS. 2 suites passed, 17 tests passed.

Follow-up correction after user regression screenshot:

```bash
PATH="/opt/homebrew/bin:$PATH" npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand
```

Result: PASS. 2 suites passed, 18 tests passed.

```bash
PATH="/opt/homebrew/bin:$PATH" npx tsc --noEmit --pretty false
```

Result: PASS.

```bash
PATH="/opt/homebrew/bin:$PATH" node --check server/socialPreview.js
PATH="/opt/homebrew/bin:$PATH" node --check api/og-event.js
PATH="/opt/homebrew/bin:$PATH" node --check api/og-brand.js
PATH="/opt/homebrew/bin:$PATH" node --check api/public-event.js
PATH="/opt/homebrew/bin:$PATH" node --check api/public-brand.js
```

Result: PASS.

```bash
git diff --check
```

Result: PASS.

```bash
PATH="/opt/homebrew/bin:$PATH" node - <<'NODE'
const { buildEventOgCardProps, buildBrandOgCardProps, renderOgPng } = require('./server/socialPreview');
const row = {
  id: 'event-1', brand_slug: 'test-stripe', brand_name: 'Test Stripe',
  title: 'Runtime Share Test FreeTA throwaway free-ticket QA',
  description: 'A free Mingla QA event.', slug: 'runtime-share-test',
  location_text: 'The venue - The place with a very long neighbourhood label',
  is_online: false, cover_media_url: null, cover_media_type: null,
  public_theme: { business_event: { when: { date: '2026-11-09' } } },
};
const brand = {
  slug: 'long-brand',
  name: 'Runtime Share Test FreeTA throwaway free-ticket QA Collective',
  description: 'Small-room popups and careful hosting.',
  profile_photo_url: null, cover_media_url: null, cover_media_type: null,
};
(async () => {
  const eventBuffer = await renderOgPng(buildEventOgCardProps(row));
  const brandBuffer = await renderOgPng(buildBrandOgCardProps({ brand, events: [row] }));
  console.log(JSON.stringify({ eventPngBytes: eventBuffer.length, brandPngBytes: brandBuffer.length }));
})();
NODE
```

Result: PASS, `{"eventPngBytes":124463,"brandPngBytes":131231}`.

Note: Jest emitted an inherited Watchman recrawl warning; tests still passed.

## Deploy And Runtime Gates

No DB migration, Supabase edge function, Stripe, checkout, explorer, or admin change.

Required next gates:

- Deploy `mingla-business` web so Vercel serves updated `server/socialPreview.js` and metadata routes.
- Tester/runtime smoke fresh event and brand links.
- Verify iMessage and WhatsApp previews for:
  - normal event name
  - long event name
  - long brand name
  - event with cover image
  - brand with profile photo or event cover fallback
- Confirm iMessage receives one share/link payload, not duplicate URL content.

## Residual Risks

- Social platforms cache aggressively. Tester should use fresh links where possible and account for stale crawler cache.
- Visual collision is protected by deterministic text-fit parameters and PNG render smoke, not pixel-level image diffing. A final human preview pass in iMessage/WhatsApp remains required before close.
- Brand OG cards intentionally do not show `@brandSlug` because of ORCH-0768 public identity honesty.
