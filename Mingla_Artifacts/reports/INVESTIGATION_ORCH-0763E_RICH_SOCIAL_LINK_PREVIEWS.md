# Investigation Report: Rich Social Link Preview + SEO Snippet (ORCH-0763E)

> Date: 2026-05-09  
> Source: Operator runtime evidence + orchestrator prompt  
> Confidence: H - source, generated static HTML, deployed HTTP responses, crawler user-agent responses, OG URL probes, schema/view, and focused tests were checked.  
> Status: root cause proven

## 1. Layman Summary

The public event link now works when shared. The remaining problem is that the link preview is not a real event preview.

Right now, iMessage/WhatsApp/Facebook-style crawlers receive a generic Expo web shell with an empty title and no event-specific Open Graph tags. The React app eventually knows the event after JavaScript loads, but link-preview crawlers usually decide the card from the first HTML response. That first response has no event name, no Mingla logo, no event cover, and no image URL.

There is a second concrete bug: the code builds fallback image URLs like `/og/event/{id}.png` and `/og/brand/{slug}.png`, and tests assert those URLs, but no such routes or files exist. In production those URLs return Vercel `404` text, not images.

Recommended direction: add a server-side public metadata layer for `/e/...` and `/b/...`, plus real dynamic OG image endpoints. Do not try to solve this by only editing React `<Head>` inside `PublicEventPage`; that metadata arrives too late for crawlers.

## 2. Scope

- **Feature / issue:** Rich social previews and SEO snippets for public event/brand links.
- **Actor:** guest/recipient receiving an event link; organiser sharing an event.
- **Environment:** `mingla-business` Expo static web export deployed on Vercel at `https://business.usemingla.com`.
- **Success definition:** shared public links render event/brand-specific title, description, canonical URL, and a valid branded preview image in crawler-visible HTML.
- **Assumptions:** operator evidence that real iMessage/WhatsApp sharing opens the link is accepted; this pass investigates preview quality, not native share mechanics.
- **Out of scope:** Stripe onboarding, draft delete, checkout redesign, native share-sheet Copy behavior, public event UI redesign.

## 3. Intended Journey

`organiser shares public event URL -> recipient messaging app crawls URL -> business.usemingla.com returns crawler-readable event metadata -> platform displays branded event preview -> recipient taps link -> Expo web public event page loads real event`

Expected failure behavior:

- if the event no longer exists, return a not-found/noindex preview rather than a broken generic shell;
- if there is no uploaded cover, use a Mingla-branded fallback image;
- if address is hidden until ticket purchase, do not expose full address in preview metadata;
- if the preview image cannot be generated, fall back to a stable Mingla-branded image that returns `image/png`.

## 4. Historical Context

- `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`
- `Mingla_Artifacts/reports/REVIEW_ORCH-0763E_OPERATOR_SHARE_VIA_AND_RICH_PREVIEW_NEXT.md`
- `Mingla_Artifacts/reports/RETEST_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`
- `Mingla_Artifacts/reports/DEPLOY_ORCH-0759_BUSINESS_PUBLIC_DOMAIN_AND_SHARE_URL_AUTHORITY.md`
- `Mingla_Artifacts/reports/INVESTIGATION_REWORK_ORCH-0763D_IOS_PUBLIC_SHARE_AND_DRAFT_DELETE.md`
- `Mingla_Artifacts/specs/SPEC_ORCH-0763D_RUNTIME_SHARE_DATE_LIFECYCLE_REPAIR.md`
- `README.md`
- `docs/IMPLEMENTATION_GATES.md`
- `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md`

Supersession note: ORCH-0763D's simulator share-sheet Copy failure is no longer treated as proof that actual messaging share fails, because the operator proved real iMessage/WhatsApp delivery works. ORCH-0763E is a new rich-preview/SEO workstream.

## 5. Investigation Manifest

| # | File / artifact | Layer | Why read |
|---|---|---|---|
| 1 | `Mingla_Artifacts/prompts/FORENSICS_SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md` | Artifact | Dispatch contract and success criteria |
| 2 | `Mingla_Artifacts/reports/REVIEW_ORCH-0763E_OPERATOR_SHARE_VIA_AND_RICH_PREVIEW_NEXT.md` | Artifact | Operator evidence and reclassification |
| 3 | `README.md` | Docs | Constitution and surface map |
| 4 | `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md` | Docs/deploy | Vercel static export deployment model |
| 5 | `mingla-business/app.json` | Config | Web output mode and app link settings |
| 6 | `mingla-business/vercel.json` | Deploy | Static output, rewrites, headers |
| 7 | `mingla-business/app/e/[brandSlug]/[eventSlug].tsx` | Route | Public event loading route |
| 8 | `mingla-business/app/b/[brandSlug]/index.tsx` | Route | Public brand loading route |
| 9 | `mingla-business/src/components/event/PublicEventPage.tsx` | Component | Existing event `<Head>` tags and share modal |
| 10 | `mingla-business/src/components/brand/PublicBrandPage.tsx` | Component | Existing brand `<Head>` tags and share modal |
| 11 | `mingla-business/src/constants/publicUrls.ts` | URL utility | Canonical URL and OG image URL generation |
| 12 | `mingla-business/src/services/publicEventsService.ts` | Service | Public event/brand data mapping |
| 13 | `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql` | Schema/RLS | Latest public event view and public read contract |
| 14 | `supabase/migrations/20260515000002_orch_0758a_event_cover_storage.sql` | Schema/storage | Public event cover bucket and storage policy |
| 15 | `mingla-business/dist/e/[brandSlug]/[eventSlug].html` | Build output | Actual static HTML shipped by Expo export |
| 16 | Live `curl` probes against `business.usemingla.com` | Runtime | What crawlers receive |
| 17 | `mingla-business/src/constants/__tests__/publicUrls.test.ts` | Tests | Current guardrails and missing coverage |

## 6. Five-Layer Cross-Check

| Layer | What it says | Evidence | Matches? |
|---|---|---|---|
| Docs | Business public web is a Vercel-hosted Expo static export. | `docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md`, `mingla-business/vercel.json:3-4`, `mingla-business/app.json:57-59` | Yes |
| Schema/RLS | Public event view exposes title, description, brand, cover media, visibility, status, theme for public scheduled/live/ended/cancelled events. | `supabase/migrations/20260515000005_orch_0763d_event_lifecycle_repair.sql:7-42` | Yes |
| Code | React pages set event/brand `<Head>` after client data loads. | `PublicEventPage.tsx:246-276`, `PublicBrandPage.tsx:211-245` | Only for hydrated browser users, not initial crawler HTML |
| Runtime/tests | Deployed HTML and crawler user agents receive empty title and no OG/Twitter tags. Existing focused Jest passes. | curl probes; `npx jest publicUrls.test publicEventsService.test sharePublicUrl.test` -> 13 passed | Contradiction: tests pass while crawler behavior fails |
| Data/cache | Event covers are public storage URLs when uploaded; fallback generated OG image routes do not exist. | `eventCoverMediaService.ts:100-105`, `publicUrls.ts:60-80`, `/og/...` curl 404 | Partial: uploaded covers may be readable; generated fallback is broken |

**Contradictions:**

- Source code suggests event/brand metadata exists, but the exported and deployed initial HTML does not contain it.
- URL helper tests bless `/og/event/*.png` and `/og/brand/*.png`, but production returns `404`.
- The site is deployed as a static Expo shell, but the product need is dynamic per-event crawler metadata.

## 7. Findings

### Finding 1: Public event and brand metadata is client-side only, so crawlers see an empty shell

- **Severity:** P0
- **Type:** confirmed bug
- **Confidence:** proven
- **Broken journey step:** messaging/social/search crawler fetches the shared public URL.
- **Evidence:**
  - `mingla-business/app/e/[brandSlug]/[eventSlug].tsx:34-45` renders loading UI while React Query fetches event data.
  - `mingla-business/app/b/[brandSlug]/index.tsx:27-37` does the same for brand data.
  - `mingla-business/src/components/event/PublicEventPage.tsx:246-276` sets metadata only inside the hydrated event component.
  - `mingla-business/src/components/brand/PublicBrandPage.tsx:211-245` sets metadata only inside the hydrated brand component.
  - `mingla-business/dist/e/[brandSlug]/[eventSlug].html:1` starts with `<title data-rh="true"></title>` and no event-specific meta tags.
  - `curl -A 'facebookexternalhit/1.1 ...' https://business.usemingla.com/e/teststripe/the-ripe` returned only blank title, charset, viewport, and X-UA-Compatible metadata.
  - `curl -A 'WhatsApp/2.24.0 i' https://business.usemingla.com/e/teststripe/the-ripe` returned the same blank metadata.
- **Current behavior:** crawlers receive a static shell with blank title and no `og:title`, `og:description`, `og:image`, `twitter:image`, or canonical event data.
- **Expected behavior:** first HTML response for `/e/{brandSlug}/{eventSlug}` and `/b/{brandSlug}` contains crawler-readable event/brand metadata before JavaScript runs.
- **Causal chain:** Expo static export creates one app shell for dynamic routes -> route data is fetched by React Query after hydration -> `<Head>` is rendered only after the data arrives in the browser -> link-preview crawlers decide the preview from the initial shell -> preview is generic/empty.
- **User impact:** recipients see an unbranded or weak preview, reducing trust and click-through.
- **Fix direction:** add a server-side metadata shell for public event/brand routes, then keep React `<Head>` as hydrated-browser parity only.
- **Missing test or guardrail:** no test checks crawler-visible HTML for `og:title`, `og:image`, canonical, or Twitter tags.
- **Invariant violated:** README Constitution #2, one owner per truth. Metadata truth is implied in React but the crawler-facing owner is static HTML.

### Finding 2: Fallback OG image URLs are generated and tested, but no route or image exists

- **Severity:** P1
- **Type:** confirmed bug
- **Confidence:** proven
- **Broken journey step:** event/brand with no uploaded absolute cover/profile image emits a fallback preview image URL.
- **Evidence:**
  - `mingla-business/src/constants/publicUrls.ts:60-80` returns `/og/event/{eventId}.png` and `/og/brand/{brandSlug}.png` fallback URLs.
  - `mingla-business/src/constants/__tests__/publicUrls.test.ts:54-66` asserts those fallback URLs.
  - repo route scan found no `mingla-business/app/og/...`, `mingla-business/src/...og...`, or static generated OG image path.
  - `curl -L https://business.usemingla.com/og/event/event-1.png` returned `HTTP/2 404`, `content-type: text/plain`.
  - `curl -L https://business.usemingla.com/og/brand/teststripe.png` returned `HTTP/2 404`, `content-type: text/plain`.
- **Current behavior:** fallback image URLs point to nonexistent Vercel routes.
- **Expected behavior:** every URL placed in `og:image` returns a real image, preferably `image/png`, with stable dimensions and cache headers.
- **Causal chain:** URL helper invented fallback path -> no route/static asset was implemented -> tests only check string shape -> deployed crawler/image fetch gets 404 text instead of image.
- **User impact:** platforms may show no image, a broken preview, or a generic domain card.
- **Fix direction:** implement real dynamic OG image endpoints or remove these URLs. Product requirement calls for real dynamic branded images, so implement endpoints.
- **Missing test or guardrail:** no endpoint test or curl gate asserts `Content-Type: image/png` for `/og/event/...` and `/og/brand/...`.
- **Invariant violated:** README Constitution #9, no fabricated data. The code fabricates image URLs that do not exist.

### Finding 3: Existing metadata is incomplete even after hydration

- **Severity:** P1
- **Type:** production-hardening gap
- **Confidence:** proven from source
- **Broken journey step:** hydrated browser metadata and future server metadata contract.
- **Evidence:**
  - Event page has `og:image` but no `twitter:image`, no `og:image:width`, no `og:image:height`, and no status-aware/privacy-aware metadata builder (`PublicEventPage.tsx:251-275`).
  - Brand page has the same missing image dimensions/Twitter image (`PublicBrandPage.tsx:214-244`).
  - Event `og:image` uses raw absolute `coverMediaUrl` when present (`publicUrls.ts:60-68`), which does not embed Mingla logo or event name and can point at a GIF/video-like asset depending on upstream media.
  - Brand `og:image` uses only `profilePhotoUrl` (`publicUrls.ts:71-80`), not a branded share card.
- **Current behavior:** even if React metadata arrives, it is a thin metadata set and does not meet the Eventbrite-style card requirement.
- **Expected behavior:** metadata includes full OG/Twitter card fields and points to a branded 1200x630 image with Mingla logo and event/brand text.
- **Causal chain:** current implementation was a basic `<Head>` pass, not a share-preview product contract.
- **User impact:** previews can look unpolished or inconsistent across platforms.
- **Fix direction:** centralize preview metadata generation and image selection in pure helpers shared by server metadata and hydrated React pages.
- **Missing test or guardrail:** no unit tests for preview title/description/privacy/image field matrix.

### Finding 4: Preview caching and stale deploy behavior are not part of the release gate

- **Severity:** P2
- **Type:** production-hardening gap
- **Confidence:** proven from recent ORCH-0759/0763D deploy evidence and current headers
- **Broken journey step:** verifying that platform previews changed after deployment.
- **Evidence:**
  - Live event route headers showed Vercel cache hit and `last-modified: Fri, 08 May 2026 18:48:51 GMT`.
  - Prior ORCH-0763D tester report found stale deployed web bundle while source had newer share code.
  - Current ORCH-0763E prompt explicitly names platform preview caches as a risk.
- **Current behavior:** deploy freshness is checked ad hoc; social preview caches are not named in test gates.
- **Expected behavior:** implementation and tester gates include deployed `curl` checks, OG image header checks, and cache-busting/manual retest instructions for iMessage/WhatsApp/Slack/Facebook/X.
- **Causal chain:** public web deploy is static and platform previews cache aggressively -> without release gates, a fixed build may still appear broken to testers.
- **User impact:** operator may believe the fix failed or users may keep seeing stale previews.
- **Fix direction:** add release checklist and tester gates specific to preview caches.
- **Missing test or guardrail:** no deploy gate asserts current HTML contains event metadata or that OG routes return images.

## 8. Root Cause Proof

### RC-0763E-1: Dynamic public pages are static shells to crawlers

- **File + line:** `mingla-business/app.json:57-59`, `mingla-business/vercel.json:3-13`, `mingla-business/app/e/[brandSlug]/[eventSlug].tsx:34-45`, `mingla-business/src/components/event/PublicEventPage.tsx:246-276`
- **Exact code/schema:** Expo web is `output: "static"`; Vercel builds `npx expo export -p web`; public event route fetches with `usePublicEventBySlug`; `<Head>` exists only inside `PublicEventPage` after data exists.
- **What it does:** ships one static dynamic-route shell, then gets event data client-side.
- **What it should do:** return event-specific metadata in the first HTML response for public event/brand URLs.
- **Causal chain:** static export -> no server data at request time -> crawler gets shell -> shell has blank title/no OG tags -> social preview cannot be event-specific.
- **Verification step:** `curl` with Facebook and WhatsApp user agents returned blank title and no OG/Twitter/canonical metadata.

### RC-0763E-2: Fallback image URLs have no backing route

- **File + line:** `mingla-business/src/constants/publicUrls.ts:60-80`, `mingla-business/src/constants/__tests__/publicUrls.test.ts:54-66`
- **Exact code/schema:** `eventOgImageUrl(...)` returns `${BUSINESS_PUBLIC_ORIGIN}/og/event/${eventId}.png`; `brandOgImageUrl(...)` returns `/og/brand/{brandSlug}.png`.
- **What it does:** creates valid-looking URL strings.
- **What it should do:** point only at deployed images or deployed image generation endpoints.
- **Causal chain:** helper emits path -> no route exists in app/src/dist -> Vercel returns 404 -> `og:image` would be broken.
- **Verification step:** `curl -L` to both fallback URL families returned `HTTP/2 404`, `content-type: text/plain`.

## 9. Static / Security / Pattern Flags

| Flag | File | Evidence | Severity | Classification |
|---|---|---|---|---|
| Client-only metadata for crawler-owned concern | `PublicEventPage.tsx`, `PublicBrandPage.tsx` | `<Head>` rendered after React Query success | P0 | confirmed bug |
| Nonexistent generated image routes | `publicUrls.ts` | `/og/...` fallback URLs return 404 | P1 | confirmed bug |
| Incomplete social card fields | `PublicEventPage.tsx`, `PublicBrandPage.tsx` | missing `twitter:image`, image dimensions | P1 | production-hardening gap |
| Raw cover URL can bypass branding | `publicUrls.ts` | absolute `coverMediaUrl` is returned directly | P1 | UX gap |
| No crawler HTML regression gate | test suite | focused Jest passed 13/13 despite broken live preview | P1 | test gap |
| Address/privacy must be guarded in metadata | `publicEventsService.ts:263-269` | address and hide-address flags both map into event | P1 | security/privacy watchpoint |

## 10. Blast Radius

- **Other flows affected:** event share previews, brand share previews, SEO snippets, Slack/Discord/Facebook/X unfurls, iMessage/WhatsApp previews, public route deploys.
- **Mobile/business/admin/public parity:** mobile native sharing can send the link, but preview rendering is controlled by public web. Admin is not directly involved.
- **Query keys/cache/state involved:** current public React Query keys are not enough for crawlers. Server-side preview fetch should not depend on browser React Query state.
- **RLS/auth/permission implications:** preview fetch should use only public rows from `business_public_events_view`; no private/draft/hidden events should be exposed.
- **Integrations involved:** Vercel static hosting/functions, Supabase public read view/storage, social/messaging crawlers.
- **Deploy/migration implications:** no required DB migration for event previews; Vercel deploy required. If adding a metadata API/function, deployment must include Vercel function or equivalent server-side host. If adding Supabase edge function instead, edge deploy becomes required.
- **Recurring pattern:** a browser-hydrated UI fix was mistaken for a crawler-visible SEO fix.

## 11. Production Readiness Verdict

- **Ready / not ready:** Not ready for polished public sharing.
- **Launch blockers:**
  - P0 crawler-visible HTML has no event-specific metadata.
  - P1 fallback OG image URLs are 404.
  - P1 image/title/description contract does not meet the desired branded preview standard.
- **Residual risks:** platform preview caches can keep stale cards after deploy; real platform previews need manual evidence after implementation.
- **Telemetry/monitoring gaps:** no synthetic check for `/e/...` metadata or `/og/...` image headers.
- **Missing tests:** crawler HTML response tests, OG endpoint tests, preview metadata builder tests, privacy/status matrix tests, deployed smoke gates.
- **Fastest next verification:** after implementation, `curl -A facebookexternalhit` and `curl -A WhatsApp` against a known public event must show event-specific tags; `/og/event/{id}.png` must return `image/png`.

## 12. Discoveries For Orchestrator

- ORCH-0763D should keep stale web deploy/draft-delete fixture gates separate from ORCH-0763E. The share-via real messaging path is operator-proven; the rich preview workstream should not be blocked on the simulator share-sheet Copy sentinel.
- If a future product decision wants share-sheet internal Copy to be a first-class path, keep it as a smaller copy-specific QA item, not the main public sharing blocker.

## 13. Recommended Next Step

Proceed to implementation spec `Mingla_Artifacts/specs/SPEC_ORCH-0763E_RICH_SOCIAL_LINK_PREVIEWS.md`.

The fix needs a server-side metadata owner plus real OG image endpoints. Editing only React `<Head>` is insufficient.

