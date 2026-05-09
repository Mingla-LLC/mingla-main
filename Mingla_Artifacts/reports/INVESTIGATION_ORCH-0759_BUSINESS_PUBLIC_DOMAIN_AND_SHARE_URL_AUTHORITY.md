# ORCH-0759 Investigation: Business Public Domain and Share URL Authority

Date: 2026-05-08  
Owner: forensics  
Scope: Mingla Business publish Step 7, public event/brand share URLs, public route reachability, checkout reachability, Stripe onboarding domain drift, universal-link deploy surface.  
Mode: Investigation only. No product code changed.

## Verdict

FAIL. The current public-link system is not release-safe.

The correct canonical Mingla Business public web origin in current code and runtime is:

```text
https://business.usemingla.com
```

That host resolves and serves the app root. However, the publish/share surfaces still emit two wrong origins:

- Step 7 Ready Card emits `mingla.com/e/...`.
- Public event/brand share and SEO emit `business.mingla.com/...`.

Those are not cosmetic copy issues. They hide a deeper public-web contract failure:

- `business.mingla.com` is DNS-dead (`NXDOMAIN`).
- `business.usemingla.com` is DNS-live, but direct dynamic URLs such as `/e/probe/probe`, `/b/probe`, and `/checkout/probe` return Vercel 404 today.
- Even if Vercel routing is fixed, public event, brand, and checkout screens are still backed by organiser-local Zustand/AsyncStorage state, not server-readable public data. A buyer opening the link cold in another browser/device will not have the published event in local storage.

## Correct Domain Authority

Current authority is `business.usemingla.com`.

Evidence:

- `mingla-business/src/constants/platformUrl.ts` defines the canonical production URL as `https://business.usemingla.com` and explicitly forbids `business.mingla.com` / `mingla.com` hardcoding (`lines 1-15`).
- `mingla-business/app.config.ts` exposes `EXPO_PUBLIC_MINGLA_BUSINESS_WEB_URL`, falling back to `https://business.usemingla.com` (`lines 90-96`).
- `mingla-business/app.json` iOS associated domains and Android intent filters now point at `business.usemingla.com` (`lines 25-27`, `46-54`).
- Runtime DNS on 2026-05-08:
  - `business.usemingla.com` CNAMEs to Vercel and resolves.
  - `business.mingla.com` is `NXDOMAIN`.
  - `mingla.com` resolves, but prior B2a forensics already established it is not Mingla-owned/authoritative for this app.

Important nuance: `app.config.ts` still has a silent fallback to `https://business.usemingla.com`; `platformUrl.ts` wants fail-loud behavior, but the config layer prevents missing env from failing in many builds.

## Findings

### F-1: Step 7 Publishes The Wrong Domain And A Non-Authoritative Slug

Severity: P0 launch blocker

`CreatorStep7Preview.ReadyCard` hardcodes:

```text
Tickets will go live at mingla.com/e/{brandSlug}/{draftNameSlug}.
```

Evidence:

- `mingla-business/src/components/event/CreatorStep7Preview.tsx:180-190`
- The displayed origin is `mingla.com`, not `business.usemingla.com`.
- It does not use `MINGLA_BUSINESS_WEB_URL`.
- It does not use the actual event slug generator.

The path is also not reliable. Actual event slugs are generated only at publish with a random suffix:

- `mingla-business/src/utils/eventSlug.ts:52-63`
- `mingla-business/src/utils/liveEventConverter.ts:61-79`

So Step 7 can show a path like:

```text
mingla.com/e/my-brand/my-event
```

while the actual local route after publish is:

```text
/e/my-brand/my-event-x7q3
```

Root cause: Step 7 is using presentation-only string construction instead of the canonical public URL builder and actual post-publish route identity.

### F-2: Public Event Share Emits `business.mingla.com`

Severity: P0 launch blocker

`PublicEventPage` hardcodes `business.mingla.com` for canonical/share/OG URL construction:

- `mingla-business/src/components/event/PublicEventPage.tsx:166-176`
- share handler uses `canonicalUrl(event)` at `lines 222-256`
- SEO uses it at `lines 300-310`
- `ShareModal` receives it at `lines 364-369`

`ShareModal` itself is not the source of the wrong domain. It correctly uses the `url` prop for copy/share/platform intents/QR:

- `mingla-business/src/components/ui/ShareModal.tsx:53-59`
- `lines 116-140`
- `lines 177-199`
- `lines 241-249`

Root cause: caller-owned URL construction is fragmented and bypasses `platformUrl.ts`.

### F-3: Public Brand Share Has The Same Wrong-Origin Bug

Severity: P0/P1

`PublicBrandPage` hardcodes `business.mingla.com`:

- brand canonical URL: `mingla-business/src/components/brand/PublicBrandPage.tsx:86-94`
- SEO canonical/OG: `lines 220-235`
- ShareModal URL: `lines 395-400`

Brand event cards route internally to `/e/{brandSlug}/{eventSlug}` (`lines 160-168`), but the externally shared brand URL is still dead.

### F-4: Brand Edit UI Still Shows `mingla.com/{brandSlug}`

Severity: P1

The brand editor displays the brand URL as `mingla.com/{brand.slug}`:

- `mingla-business/src/components/brand/BrandEditView.tsx:394-403`

This trains organisers into the wrong origin and conflicts with the public brand route implementation, which is `/b/{brandSlug}`, not root `/{brandSlug}`.

### F-5: The Canonical Host Is Live, But Dynamic Public Links 404 On Cold Open

Severity: P0 launch blocker

Runtime verification on 2026-05-08:

```text
https://business.usemingla.com/                 -> HTTP 200
https://business.usemingla.com/connect-onboarding -> HTTP 200
https://business.usemingla.com/e/probe/probe    -> HTTP 404, x-vercel-error: NOT_FOUND
https://business.usemingla.com/b/probe          -> HTTP 404, x-vercel-error: NOT_FOUND
https://business.usemingla.com/checkout/probe   -> HTTP 404, x-vercel-error: NOT_FOUND
https://business.mingla.com/e/probe/probe       -> DNS resolution failure
```

Local export contains bracket files such as:

```text
dist/e/[brandSlug]/[eventSlug].html
dist/b/[brandSlug].html
dist/checkout/[eventId]/index.html
```

but `mingla-business/vercel.json` has no rewrite rules for dynamic paths (`lines 1-23`), and `mingla-business/dist/_expo/.routes.json` contains only:

```json
{ "redirects": [] }
```

Root cause: static Expo export plus Vercel deployment is not configured to map real dynamic URLs (`/e/acme/show`) to the bracketed exported HTML entrypoints.

### F-6: Public Event Pages Are Not Actually Public Data Surfaces

Severity: P0 launch blocker

The public event route resolves from local persisted `LiveEvent` state:

- `mingla-business/app/e/[brandSlug]/[eventSlug].tsx:13-44`
- `useLiveEventStore` is explicitly persisted client-side and transitional (`mingla-business/src/store/liveEventStore.ts:1-20`, `280-306`)
- lookup identity is `brandSlug + eventSlug`, stored in the local `LiveEvent` object (`lines 130-136`)

The server publish path marks the Supabase draft row scheduled:

- `mingla-business/src/services/eventDrafts.ts:132-149`

but the public page does not read that scheduled row. It reads the separate local `LiveEvent` copy produced by:

- `mingla-business/src/components/event/EventCreatorWizard.tsx:451-470`
- `mingla-business/src/utils/liveEventConverter.ts:73-112`

Root cause: there are two published-event truths: Supabase `events.status='scheduled'` and local `LiveEvent.status='live'`. The public page uses the local truth, which only exists on the organiser’s device/browser.

### F-7: Public Brand Pages Are Also Local-Store Backed

Severity: P0/P1

The brand route uses the local brand list:

- `mingla-business/app/b/[brandSlug]/index.tsx:12-32`

The brand page lists local live events:

- `mingla-business/src/components/brand/PublicBrandPage.tsx:115-125`

A buyer opening a brand URL cold does not have organiser-local brands/events unless some other cache has been hydrated in that browser session.

### F-8: Checkout Is Not A Cold Public Checkout

Severity: P0 for ticket sales, especially shared links

Checkout screens resolve `eventId` from the same local `LiveEvent` store:

- ticket selection: `mingla-business/app/checkout/[eventId]/index.tsx:70-78`
- buyer details: `mingla-business/app/checkout/[eventId]/buyer.tsx:105-114`
- payment: `mingla-business/app/checkout/[eventId]/payment.tsx:111-120`
- confirm: `mingla-business/app/checkout/[eventId]/confirm.tsx:71-80`

Checkout cart is explicitly in-memory only:

- `mingla-business/app/checkout/[eventId]/_layout.tsx:12-16`

Root cause: checkout was intentionally Cycle 8 stub/local behavior, but now public share URLs imply production buyer reachability.

### F-9: Stripe Onboarding Domain Was Mostly Fixed, But Comments/Docs Still Drift

Severity: P2, not the source of the public-event share bug

Good current state:

- Edge function requires `MINGLA_BUSINESS_WEB_URL` instead of falling back to `business.mingla.com` (`supabase/functions/brand-stripe-onboard/index.ts:39-45`).
- Onboarding URL is built from that env var (`lines 372-377`).
- `connect-onboarding` works at `https://business.usemingla.com/connect-onboarding`.

Remaining drift:

- `mingla-business/src/services/brandStripeService.ts:35-41` still documents `https://business.mingla.com/` as valid return URL text.
- `supabase/functions/brand-stripe-onboard/index.ts` header comment still says it returns a URL pointing at `business.mingla.com`.
- `mingla-business/app/connect-onboarding.tsx` header comment still names `business.mingla.com`.

These comments are not current behavior, but they are how this class of bug keeps reappearing.

### F-10: Universal-Link Files Are Present On The Correct Host, But They Do Not Solve Web Routing

Severity: P1/P2

`business.usemingla.com` serves:

- `/.well-known/apple-app-site-association` -> HTTP 200, JSON, includes `/connect-onboarding`, `/onboarding-complete`, `/b/*`, `/e/*`.
- `/.well-known/assetlinks.json` -> HTTP 200, JSON.

That makes native association configuration directionally correct. It does not fix the web 404s for `/e/*`, `/b/*`, or `/checkout/*`, and it does not make the pages server-backed.

Also note: AASA does not list `/checkout/*`, while Android `intentFilters` currently match all paths on the host. That is an inconsistent deep-link policy.

### F-11: The Existing Platform URL Gate Allows Known-Bad Public Surfaces

Severity: P1

There is an I-PROPOSED-Y gate:

- `.github/scripts/strict-grep/i-proposed-y-platform-web-url-from-env.mjs`
- registered in `.github/workflows/strict-grep-mingla-business.yml`

But the gate explicitly allows `orch-strict-grep-allow platform-web-url-historical` comments. The active broken public event/brand URL builders carry that allowlist, so CI can pass while production share URLs remain dead.

The gate also intentionally does not catch visible `mingla.com/{slug}` copy, which leaves `BrandEditView` and Step 7-style copy vulnerable.

## Direct Answers

1. Correct domain authority today: `https://business.usemingla.com` for Mingla Business public web. Marketing/platform root remains `https://usemingla.com` where appropriate.

2. Why Step 7 shows `mingla.com/e/...`: `CreatorStep7Preview.ReadyCard` hardcodes `mingla.com/e/` and builds a naive name slug inline instead of using `platformUrl.ts` or the actual publish slug.

3. Why public event share emits `business.mingla.com/...`: `PublicEventPage.canonicalUrl()` hardcodes `https://business.mingla.com/e/...`; every share/canonical/QR path consumes that helper.

4. Why the shared URL cannot be reached:
   - For `business.mingla.com`: DNS fails (`NXDOMAIN`).
   - For corrected `business.usemingla.com/e/...`: Vercel returns 404 because static export dynamic routes are not rewritten/served as real dynamic URLs.
   - After routing is fixed: buyer can still see not-found because the page reads local Zustand state, not server public data.

5. Does publish store enough route identity: locally, yes (`LiveEvent.serverEventId`, `brandSlug`, `eventSlug`). Publicly/server-side, no. Supabase scheduled events keep `events.slug`, but the public route does not use it and the local generated `eventSlug` is not proven to be written back as the public server slug.

6. Is public event page server-backed or local-store-backed: local-store-backed.

7. Are brand/checkout affected: yes. Brand public pages share wrong origin and read local stores. Checkout routes read local `LiveEvent` by ID and fail cold.

8. Are universal links/AASA/assetlinks correct: host and files are now present for `business.usemingla.com`; AASA covers `/b/*` and `/e/*`, not `/checkout/*`; web dynamic route delivery still fails.

9. Are support/legal/contact URLs still unowned: many prior support/legal strings have been moved to `usemingla.com` / `support@usemingla.com`. Remaining active drift found in this sweep is public URL copy (`mingla.com/`, `business.mingla.com`) and stale comments/docs around Stripe onboarding.

10. What invariant prevents this class: one canonical URL builder must own every external URL, plus a server-backed public-event contract. Static grep-style gates are insufficient while allowlisted broken production builders remain.

## Required Fix Contract

This is the implementation contract for a follow-on `$implementor` task. Do not treat these as optional polish.

1. Create a canonical public URL module for Mingla Business.
   - Source origin from `MINGLA_BUSINESS_WEB_URL`.
   - Export typed builders:
     - `eventPublicUrl({ brandSlug, eventSlug })`
     - `brandPublicUrl(brandSlug)`
     - `checkoutUrl(eventPublicIdOrSlug)`
     - `ogEventImageUrl(...)`
     - `ogBrandImageUrl(...)`
   - Remove caller-local template literals for public URLs.

2. Replace active public URL hardcodes.
   - Step 7 Ready Card must stop showing `mingla.com/e/...`.
   - PublicEventPage canonical/share/OG/QR must use canonical builders.
   - PublicBrandPage canonical/share/OG/QR must use canonical builders.
   - BrandEditView slug row must display the real public brand path, likely `business.usemingla.com/b/{slug}`.
   - Stale Stripe onboarding comments/docs must be corrected.

3. Fix route identity.
   - Step 7 must either display “after publish” without a fake path, or reserve/derive the actual event slug before display.
   - Server `events.slug` and local `LiveEvent.eventSlug` must be the same public event slug.
   - Public URL identity must be server durable, not local-only.

4. Make public routes server-backed.
   - `/e/[brandSlug]/[eventSlug]` must fetch public event data from Supabase/API by slug.
   - `/b/[brandSlug]` must fetch public brand data and public events from Supabase/API.
   - `/checkout/[eventId]` must resolve a server-public event identifier and ticket inventory, not local `LiveEvent.id`.
   - Keep local store only as organiser cache/optimistic UI, never as the buyer-facing source of truth.

5. Fix Vercel static dynamic route delivery.
   - Add explicit rewrites for `/e/:brandSlug/:eventSlug`, `/b/:brandSlug`, `/checkout/:eventId/*`, and any other public dynamic routes to their exported bracket HTML entrypoints, or move the web deployment to an SSR/router setup that serves dynamic paths correctly.
   - Reverify with cold `curl -I` against production URLs.

6. Tighten invariant enforcement.
   - Remove allowlists around active `business.mingla.com` production URL builders.
   - Extend the gate to catch `mingla.com/` visible public-route copy in app code unless explicitly historical/test-only.
   - Add unit tests around public URL builders.
   - Add a deploy smoke that asserts:
     - `business.usemingla.com/e/probe/probe` does not Vercel-404.
     - `business.mingla.com` is never emitted by built JS for active public URL builders.
     - Step 7, event share, brand share, QR, canonical meta, and checkout entry all use the same origin.

## Verification Commands Run

Read-only verification only:

```text
host usemingla.com
host business.usemingla.com
host business.mingla.com
host mingla.com
curl -I -L https://business.usemingla.com/
curl -I -L https://business.usemingla.com/e/probe/probe
curl -I -L https://business.usemingla.com/b/probe
curl -I -L https://business.usemingla.com/checkout/probe
curl -I -L https://business.usemingla.com/connect-onboarding
curl -I -L https://business.usemingla.com/.well-known/apple-app-site-association
curl -I -L https://business.usemingla.com/.well-known/assetlinks.json
find mingla-business/app -maxdepth 4 -type f
find mingla-business/src -maxdepth 3 -type f
find mingla-business/dist -maxdepth 5 -type f
sed/nl file-by-file reads of all cited files
```

## Bottom Line

The immediate wrong-domain bugs are straightforward: hardcoded public URL builders escaped the newer `platformUrl.ts` authority. The larger launch blocker is architectural: Mingla Business is presenting local organiser state as public web. A correct domain will still fail buyers until the public event/brand/checkout routes are server-backed and the Vercel deployment can serve cold dynamic URLs.
