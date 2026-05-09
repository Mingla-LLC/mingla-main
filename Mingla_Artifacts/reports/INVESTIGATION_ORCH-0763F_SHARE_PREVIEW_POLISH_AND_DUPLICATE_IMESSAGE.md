# INVESTIGATION - ORCH-0763F Share Preview Polish + Duplicate iMessage Share

Date: 2026-05-09
Mode: Forensics, investigate-then-spec
Verdict: Implementation can proceed from this evidence-backed spec.

## Plain-English Summary

The public share system is no longer broken. Links resolve on `https://business.usemingla.com`, crawler metadata exists, and OG image routes return real 1200x630 PNGs.

The remaining issue is quality:

- iMessage can appear to receive the same share twice because the native/web share payload can include the URL in two places.
- The Share Modal has no in-flight guard, so fast repeated taps can also re-open the native share flow.
- The generated social preview cards are too black-heavy, making the orange Mingla Business logo sit inside a black-on-black block.
- The event date appears in crawler HTML, but not inside the actual generated PNG preview card that iMessage/WhatsApp show.
- Brand preview cards use the same generic black renderer as events and do not yet feel like a rich branded public page card.

## Scope Investigated

Feature slice:

`Share button -> ShareModal -> copy/native/web share helper -> public URL -> crawler HTML -> OG image route -> social preview cache`

Primary surfaces:

- Business native app share modal
- Business web/public event page share modal
- Business public brand page share modal
- Vercel crawler rewrites
- Event and brand OG image routes
- Public event read model
- Existing focused tests

## Historical Context

Read:

- `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0763F_SHARE_PREVIEW_POLISH_AND_DUPLICATE_IMESSAGE.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0763F_POST_DEPLOY_SHARE_PREVIEW_POLISH.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
- `Mingla_Artifacts/reports/REVIEW_IMPLEMENTATION_ORCH-0763E_RICH_SOCIAL_PREVIEWS_AND_BUSINESS_BRAND_ASSETS.md`
- `Mingla_Artifacts/reports/DEPLOY_ORCH-0763E_ORCH-0764B_BUSINESS_WEB.md`

Prior work intentionally added:

- canonical public URLs on `https://business.usemingla.com`
- bot-only Vercel rewrites for `/e/:brandSlug/:eventSlug` and `/b/:brandSlug`
- dynamic OG PNG endpoints under `/og/event/:eventId.png` and `/og/brand/:brandSlug.png`
- Mingla Business logo assets for the business app only

## Code-Path Map

### Share Entrypoints

- `mingla-business/src/components/event/PublicEventPage.tsx:328-342`
  - public event floating share button opens `ShareModal`
  - modal receives canonical event URL, event title, and description
- `mingla-business/src/components/brand/PublicBrandPage.tsx:283-287` and `411-418`
  - public brand floating share button opens `ShareModal`
  - modal receives canonical brand URL
- `mingla-business/app/event/[id]/index.tsx:717-727`
  - organiser event detail page uses the same `ShareModal`
- `mingla-business/app/(tabs)/events.tsx:754-765`
  - organiser events list manage menu uses the same `ShareModal`

### Share Helper

- `mingla-business/src/components/ui/ShareModal.tsx:113-134`
  - `Copy link` calls `copyPublicUrl(url)`
  - `Share via...` calls `sharePublicUrl({ title, url, description })`
  - there is no `isCopying` or `isSharing` state
- `mingla-business/src/utils/sharePublicUrl.ts:15-23`
  - `buildPublicShareText` appends the URL to description/title
- `mingla-business/src/utils/sharePublicUrl.ts:61-70`
  - web share sends both `url` and `text`, where `text` already includes the URL
- `mingla-business/src/utils/sharePublicUrl.ts:74-81`
  - native share sends `message`, where `message` already includes the URL, plus a separate `url` field

### React Native Share Semantics

Installed dependency:

- `react-native@0.81.5`

Relevant local dependency evidence:

- `mingla-business/node_modules/react-native/Libraries/Share/Share.d.ts:49-60`
  - iOS supports separate `url` and `message`
  - Android uses `message`, often including a URL
- `mingla-business/node_modules/react-native/Libraries/Share/Share.js:134-144`
  - on iOS, React Native passes both `message` and `url` into `showShareActionSheetWithOptions`
- `mingla-business/node_modules/react-native/Libraries/Share/Share.js:108-114`
  - on Android, React Native sends only `title` and `message` to the native share module

### Preview Routes

- `mingla-business/vercel.json:10-11`
  - `/og/event/:eventId.png` and `/og/brand/:brandSlug.png` route to serverless handlers
- `mingla-business/vercel.json:12-33`
  - crawler user agents for event/brand pages route to metadata handlers
- `mingla-business/api/public-event.js:18-24`
  - event crawler route fetches public event row and renders event HTML
- `mingla-business/api/public-brand.js:17-23`
  - brand crawler route fetches brand rows and renders brand HTML
- `mingla-business/api/og-event.js:14-24`
  - event OG route calls `renderOgPng` with title, subtitle, kicker, and cover URL only
- `mingla-business/api/og-brand.js:15-24`
  - brand OG route calls the same generic `renderOgPng` with brand title/subtitle/kicker/profile photo only

### OG Renderer

- `mingla-business/server/socialPreview.js:348-479`
  - one shared `renderOgPng` implementation for both event and brand cards
  - root background is `#050505`
  - logo panel background is `rgba(0,0,0,.64)`
  - footer domain text is `#090909`
  - no date, venue, event count, next event, or other structured card metadata slot

### Date Source

- Latest authoritative view: `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql:7-42`
  - `business_public_events_view` exposes `public_theme`
  - `public_theme` is `(e.theme - 'business_draft')`
- Web public event mapper: `mingla-business/src/services/publicEventsService.ts:224-252`
  - `LiveEvent.date` maps from `public_theme.business_event.when.date`
- Server preview helper: `mingla-business/server/socialPreview.js:178-198`
  - `eventDate(row)` also reads `public_theme.business_event.when.date`
- Crawler HTML: `mingla-business/server/socialPreview.js:283-286`
  - event HTML already shows formatted event date in a pill

## Reproduction Matrix

| Surface | Evidence | Result |
|---|---|---|
| Native Share via iMessage | Code sends native `message` containing URL plus separate `url` field | Likely duplicate visual/link payload on iOS |
| Native Share via WhatsApp | Operator says WhatsApp worked; code sends same payload through iOS share sheet | Needs runtime retest after payload simplification |
| Web `navigator.share` | Code sends `text` containing URL plus separate `url` field | Same duplicate-payload risk on Safari/Web Share targets |
| Copy link | `copyPublicUrl(url)` writes exactly URL | No duplicate-share cause found |
| Event public page share | Uses same `ShareModal` and helper | Affected by duplicate payload and missing in-flight guard |
| Brand public page share | Uses same `ShareModal` and helper | Affected by duplicate payload and missing in-flight guard |
| Event OG image | Live route returns 1200x630 PNG; viewed downloaded image | Card is black-heavy and missing event date |
| Brand OG image | Live route returns 1200x630 PNG; viewed downloaded image | Card is generic black-heavy and not rich-brand parity |

## Findings

### F1 - Likely Bug: iMessage Duplicate Is Caused By Duplicate URL Payload, Not Proven Double Invocation

Evidence:

- `sharePublicUrl.ts:60-70` sends web share `{ title, url, text }`, where `text` is built by `buildPublicShareText` and includes the same URL.
- `sharePublicUrl.ts:74-81` sends native share `{ title, message, url }`, where `message` includes `shareText`, and `shareText` includes the same URL.
- React Native iOS passes both `message` and `url` to the native share sheet (`Share.js:134-144`).
- React Native Android ignores `url` and uses `message` (`Share.js:108-114`), which explains why the URL must remain in Android message.

Root cause proof:

- File/line: `mingla-business/src/utils/sharePublicUrl.ts:60-81`
- Exact code/schema: `buildPublicShareText` appends URL, then `sharePublicUrl` passes both the text and the `url` field.
- Current behavior: iOS/Web share targets can receive the public URL twice in one share intent.
- Expected behavior: every share target receives one canonical URL, with optional descriptive text that does not duplicate the URL.
- Causal chain: Mingla builds `description + "\n" + url` -> iOS receives `message` with URL and separate `url` -> iMessage can render both message/link payloads, appearing as duplicate shares.
- Verification step: update tests to assert iOS/Web payloads include the canonical URL exactly once and Android includes it in `message`.

Confidence:

- Confirmed duplicate payload in code.
- Likely cause of observed iMessage behavior.
- Runtime cannot prove iMessage display internals from static code alone.

### F2 - Production-Hardening Gap: Share Modal Has No In-Flight Guard

Evidence:

- `ShareModal.tsx:113-134` has no `isCopying` / `isSharing` state.
- `Button.tsx:63-66` and `Button.tsx:261-268` already support `loading`/`disabled`, but `ShareModal` does not use those props for copy/share actions.
- `IconChrome.tsx:113-123` also has no local press throttling; page-level share buttons simply set modal visibility.

Impact:

- A fast double-tap can call `sharePublicUrl` twice before the platform share sheet fully takes over.
- This is a separate risk from the duplicate URL payload.

Classification:

- Production-hardening gap.

### F3 - UX Gap: Event OG Card Is Too Black-Heavy And Does Not Show The Event Date

Evidence:

- `renderOgPng` root background is `#050505` (`socialPreview.js:355-364`).
- Logo panel background is `rgba(0,0,0,.64)` (`socialPreview.js:435-449`).
- The same black-background logo is placed on that black panel (`socialPreview.js:451-458`).
- Event OG handler passes only `title`, `subtitle`, `kicker`, and `coverUrl` (`api/og-event.js:14-24`).
- The downloaded deployed event card visually confirms a black-heavy design and no date.
- Event date is already available and rendered in crawler HTML through `eventDate(row)` and `formatDate(...)` (`socialPreview.js:178-209`, `283-286`).

Impact:

- Shared links look less premium and less informative than intended.
- The card fails the user's requirement that the event design include the date.

Classification:

- UX gap.

### F4 - UX Gap: Brand OG Card Does Not Have Rich Brand/Event Parity

Evidence:

- Brand OG route uses the exact same generic renderer as events (`api/og-brand.js:15-24`).
- Brand OG route passes only brand title, description, kicker, and profile photo.
- `fetchPublicBrandBySlug` returns all rows for the brand from `business_public_events_view` (`socialPreview.js:155-161`), so server-side brand preview has access to:
  - brand name
  - brand slug
  - brand description
  - brand profile photo
  - event count
  - event titles/descriptions
  - event dates inside `public_theme`
  - event cover media
- The downloaded deployed brand card visually confirms a generic black-heavy fallback and no next-event/date cue.

Impact:

- Brand public-page shares do not feel as rich or useful as event shares.
- The brand card does not communicate the active event portfolio as well as the public page does.

Classification:

- UX gap.

### F5 - Regression Gap: Existing Tests Prove Domain Correctness But Not The New Quality Bar

Evidence:

- Focused tests passed:
  - `npx jest src/utils/__tests__/sharePublicUrl.test.ts server/__tests__/socialPreview.test.ts --runInBand`
  - 2 suites passed, 8 tests passed
- Existing share tests assert canonical domain and absence of bad domains.
- Existing preview tests assert metadata contains OG URLs and no bad domains.
- Existing tests do not assert:
  - native iOS share URL appears exactly once
  - web share URL appears exactly once
  - Share Modal disables while share/copy is pending
  - event OG input includes formatted event date
  - brand OG input includes event count or next-event cue
  - visual renderer avoids black-on-black logo panel

Classification:

- Production-hardening gap.

## Five-Layer Check

| Layer | Status |
|---|---|
| Docs/artifacts | ORCH-0763E established rich previews; ORCH-0763F adds polish findings |
| Schema/RLS | Latest view exposes needed public event and brand data; no migration required |
| Code | Duplicate payload, no in-flight guard, generic black OG renderer confirmed |
| Runtime/test evidence | Live metadata and OG PNGs return correctly; focused tests pass; downloaded cards confirm visual gaps |
| Persisted data assumptions | Event date comes from `public_theme.business_event.when.date`; brand data comes from rows in `business_public_events_view` |

## Blast Radius

Affected:

- iOS native business app share via `Share.share`
- Web/Safari share via `navigator.share`
- Android share helper contract, but Android must keep URL in `message` because React Native ignores `url`
- Event public page share
- Brand public page share
- Organiser event detail/list share modals
- Vercel event OG route
- Vercel brand OG route
- Social preview cache behavior
- Share helper and social preview tests

Not directly affected:

- Explorer/consumer app
- Admin app
- Supabase schema/RLS
- Stripe/payment flows
- Checkout link routing

## Residual Risks

- Social apps cache preview images aggressively. Visual rework must use a fresh event/brand URL or a changed OG image URL/cache key for real-world proof.
- The exact iMessage UI display cannot be proven by static analysis. The code-level duplicate URL payload is proven and should be fixed first.
- Brand "next event" richness depends on how reliable `public_theme.business_event.when.date` is across older events. Missing date must gracefully fall back to event count or "Upcoming events".

## Ready For Implementation?

Yes.

Implementation should be limited to:

- share payload de-duplication
- share/copy in-flight guards
- event OG card layout/data enhancements
- brand OG card layout/data enhancements
- focused tests and runtime smoke gates

No product code was modified during this investigation.
