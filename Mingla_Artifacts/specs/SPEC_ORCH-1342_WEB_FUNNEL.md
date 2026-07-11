# SPEC — ORCH-1342 [web-see-whos-going-funnel]

**META:** META-ORCH-1337 [social-proof-guest-list] · Leg 5 of 5 (LAST — consumes 1338's payload, 1339's socialProof plumbing, 1341's `onSeeWhosGoing` affordance; joint with the shipped ORCH-1318 OneLink rail)
**Phase:** SPEC (forensics SPEC mode — contract, not code)
**Binding investigation:** `Mingla_Artifacts/investigations/INVESTIGATION_META-ORCH-1337_SOCIAL_PROOF_GUEST_LIST.md` — Q9/F-9 (OneLink rail shipped by ORCH-1318; remaining gaps = sheet-landing param, seedless `/e/` cold route, buyer-web link/QR source), F-12 (stale `DownloadMinglaCta` iOS store URL — folded in here), Q11 (insertion map), F-10 (binding guards).
**Binding design:** `Mingla_Artifacts/specs/DESIGN_META-ORCH-1337_GUEST_SOCIAL_PROOF.md` §3 (`SeeWhosGoingGate`: phone slide-up interstitial + desktop QR dialog; interstitial gate, never redirect-on-tap, never names on web) + §1.5/§1.6 (affordance-absent = inert cluster; `onSeeWhosGoing` prop shape).
**Sibling contracts consumed as-frozen:** `SPEC_ORCH-1338_GUEST_READ_BACKEND.md` (Function A `pg_public_social_proof` — D6 compatibility note §4.1.1 honored; Function B error `guest_list_private` = defense-in-depth), `SPEC_ORCH-1339_MOMENTUM_CARD_CROSS_ENTITY.md` (`SocialProofSummary` props plumbing on every web mount; D2 gate wiring).
**Sealed decisions honored (not re-opened):** D1 (anon web = counts + avatars only, NEVER names), D6 (bounded anon event-by-slug consumer read for the cold landing), D9 (visibility mirrors the public page). DESIGN §3 is binding.
**Comms factored:** COMMS-0083 (AppsFlyer go-live gates: fresh native builds + `APPSFLYER_S2S_TOKEN` are Seth's — drives the §5 per-SC gating split), COMMS-0087 (CI TS pin — RESOLVED, none).
**Worktree:** `~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]` on branch `META-ORCH-1337-social-proof-guest-list`.
**Date:** 2026-07-10

---

## 1. Executive summary

Buyer-web shows the momentum cluster (after 1339–1341) but a web visitor who taps "See who's going" has nowhere to go: names live only in the app (D1). This leg builds the honest bridge: the tap opens an install **gate** (phone: slide-up panel; desktop: QR dialog — DESIGN §3), whose link is **OneLink-ready** — it carries the deferred payload `{entityType, brandSlug, entitySlug, landing: 'guest-list'}` so a user who installs the app lands back **inside that event's guest-list sheet**.

App-side, the leg completes the funnel's landing: the ORCH-1318 ONE resolver gains a `landing` discriminator (`deep_link_sub3`), the dispatcher appends it as a route query param (so the shipped deferred-replay mechanism carries it with **zero changes**), the `/e/` cold route finally renders a full event page from slugs alone (D6 — a bounded anon read of the already-public `business_public_events_view`; the RSVP branch becomes reachable from a cold start), and the detail screens auto-open the ORCH-1341 sheet after mount when the landing param is present and the guest list is public.

Folded in: the F-12 fix — buyer-web's post-checkout `DownloadMinglaCta` ships a dead iOS App Store URL (`apps.apple.com/app/mingla`); this leg gives mingla-business a store-links SSOT (drift-gated against `mingla-marketing/lib/store-links.ts`) and repoints the CTA.

**Go-live split (COMMS-0083):** the gate + store links + QR + F-12 fix + cold-route fix + landing plumbing are shippable at this META's CLOSE (web `[deploy]` + consumer OTA). The OneLink **deferred delivery** (install → land in the sheet) stays dark until Seth ships fresh native builds + sets `APPSFLYER_S2S_TOKEN` + verifies the branded OneLink domain; §5 labels every success criterion `[NOW]` or `[NATIVE-GATED]` so the tester caps — never fails — the gated half.

## 2. Scope & non-goals

**In scope**
- mingla-business store-links SSOT (`src/constants/storeLinks.ts`) + CI drift gate vs `mingla-marketing/lib/store-links.ts`; `DownloadMinglaCta` repointed to it (F-12).
- `resolveGuestFunnelTarget` — the ONE smart URL builder (OneLink template `w36m` on `go.usemingla.com` when live; store-direct/`/download` while dark) + verbatim-copied client platform detection (ORCH-1319/1328 trio).
- `SeeWhosGoingGate` (DESIGN §3: phone panel `§3.1` + desktop QR dialog `§3.2`) + `GateQr` web-split component (`react-qr-code`, marketing parity).
- Web wiring of `onSeeWhosGoing` on ALL four public entity mounts (RSVP + standard via `PublicEventPage`, trip via `/t/` route + `TripPreview`, experience via `/exp/` route + `ExperiencePreview`) — **web only** (`Platform.OS === 'web'`); business-native mounts stay affordance-less (inert cluster per DESIGN §1.5).
- Buyer-web analytics: 3 PostHog events (§4.4.3), house `postHogService.capture` snake_case convention.
- ORCH-1318 payload contract extension: `deep_link_sub3 = 'guest-list'` → `OneLinkDestination.landing` (the ONE resolver, extended in place — I-ONELINK-SINGLE-RESOLVER) → dispatcher appends `?landing=guest-list` to the entity path (immediate push AND deferred persistence, one composition point).
- `/e/`, `/t/`, `/exp/` route files: read + validate the `landing` query param, pass to the screens.
- D6 cold-route fix: `publicEventSeedService.fetchPublicEventSeedBySlug` (client read of `business_public_events_view` — NO new RPC, see §4.7 rationale) + `ConsumerEventDetailScreen` seed-resolution change.
- Landing auto-open sequencing contract on `ConsumerEventDetailScreen` (primary), `ConsumerTripDetailScreen` + `ConsumerExperienceDetailScreen` (same contract, one-line wiring).
- Two new strict-grep gates + fails-on-revert tests (§9).

**Non-goals (explicitly out)**
- The sheet itself, the card affordance, `onSeeWhosGoing` inside `packages/offering-rendering` — ORCH-1341 owns the package prop end-to-end (components + bodies + `RsvpOfferingConfig`). **HARD dependency:** this leg consumes it; if absent at IMPLEMENT, stop-and-amend (do not add package props here).
- Real avatars / invariant rewrite (1340), counts/RPCs (1338), momentum mounts + toggles (1339).
- ANY new migration, RPC, edge function, or RLS change — this leg is client-only (§4.7 proves D6 needs none).
- `oneLinkShare.ts` (outbound share links do NOT carry `landing` — shares land on the event page, not the sheet), `appsFlyerService.ts` (the listener path is payload-agnostic; no change needed), `deepLinkService.ts` (the `mingla://` system never carries the landing).
- The AppsFlyer dashboard config, S2S token, native builds, OneLink branded-domain attachment — Seth's go-live (COMMS-0083); this leg builds the seam and the flip constant.
- Web guest list of any kind; names/usernames on any web surface (D1 — the gate shows cluster avatars + count only).
- mingla-marketing (read-only precedent; the drift gate READS it in CI, never edits it).
- Admin web; brand-page tiles (D7); business preview wiring (goingCount 0 ⇒ affordance absent by DESIGN §1.5 zero-state).

**Assumptions (investigation-/session-proven, file+line cited)**
- ORCH-1318 rail shipped: resolver `oneLinkResolver.ts` (ONE parser, entity payload `deep_link_value/sub1/sub2` + `af_sub1`), listener registration `appsFlyerService.ts:93-108`, sink `app/index.tsx:393`, dispatcher `app/index.tsx:1840-1897` (path composed once at `:1863-1877`, deferred persistence `:1884-1887` `{url, ts, router:true}`), replay `app/index.tsx:850-877` (24h TTL, `router.push(url)` verbatim at `:871`).
- `go.usemingla.com` already in consumer `app.json` applinks + `setOneLinkCustomDomains` (`appsFlyerService.ts:118`); AppsFlyer consumer OneLink template verified this session via the AppsFlyer MCP: **template `redirection_profile`, ID `w36m`, domain `mingla.onelink.me`, iOS app id6760440898 + Android com.mingla.app.v2 attached** (branded-domain attachment of `go.usemingla.com` to `w36m` = Seth's go-live verification item, §10-1).
- `/e/` is the ONLY seedless-capped cold route: `app/e/[brandSlug]/[eventSlug].tsx` passes `seed=null` → `ConsumerEventDetailScreen:690-714` renders the "Open this event from the app" cap; `isRsvp = seed?.eventType === "rsvp"` (`:246`). Trips (`app/t/…` header: `useConsumerTripDetail` fetches by slug) + experiences already cold-render.
- `business_public_events_view` (LATEST recreation `20261220000000_orch_1291:630-732`) is anon-exposed, `WHERE visibility='public'`, and carries `brand_slug`, `slug`, `event_type`, title/description/cover/timezone/master dates, `city`, `location_geo`, `city_geo`, taxonomy arrays, `currency`, `display_price_cents`, `public_theme`, brand theme columns, and the full `rsvp_*` config — everything a `BusinessEventCard` seed needs. App-mobile already reads this view anon (`rsvpDeckService.fetchRsvpMomentum:61-69`, `useEventTheme.ts:55`) — COMMS-0009-compliant precedent (never `.from('brands')`).
- ORCH-1328 client-side store-open pattern (verbatim precedent `links-experience.tsx:164-167`): `window.open(dest,'_blank','noopener,noreferrer')`, popup-blocked → `window.location.assign(dest)`, page stays mounted.
- QR precedent: `mingla-marketing/components/marketing/download-qr.tsx` — `react-qr-code` pure inline SVG, `fgColor #0E0E10` on `#FFFFFF`, `level "M"`; gate exemplars `orch-1319-qr-encodes-download-url.mjs` / `orch-1328-links-cta-opens-store-clientside.mjs` in `.github/scripts/strict-grep/`.
- Buyer-web analytics convention: `postHogService.capture("snake_case", {…})` (`ExperienceCreatorWizard.tsx:576`, `useBusinessEvents.ts:208`); platform-split service file precedent `postHogService.web.ts`.
- Breakpoint: `useResponsiveLayout().isDesktop` — the SAME split PublicEventPage uses for sticky-panel vs floating-dock (`PublicEventPage.tsx:305,574`; DESIGN §3.3 binds it).
- 1339 lands the `socialProof` query on `PublicEventPage` + the three consumer detail screens and threads `SocialProofSummary` through `FoundationEventPreview`/`TripPreview`/`ExperiencePreview` (SPEC_ORCH-1339 §4.6) — this leg reads those, never re-fetches.

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behavior demanded | Files touched there | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/`) | YES | `/e/` cold link renders the full event page (RSVP branch included); `?landing=guest-list` auto-opens the 1341 sheet when public; deferred install-link replays with landing intact | `oneLinkResolver.ts`, `app/index.tsx` (dispatcher only), `app/e|t|exp` routes, `publicEventSeedService.ts` (NEW), 3 detail screens | Manual per screen; resolver/dispatcher shared |
| 2 | Consumer Android (`app-mobile/`) | YES | Same (Android deferred resolution already handled by 1318's `performOnDeepLinking`) | same files | Same code; runtime proof per platform |
| 3 | Buyer/anon Web (`mingla-business` `/e /t /exp /checkout`) | YES | "See who's going" → phone interstitial / desktop QR (never redirect, never names); post-checkout CTA opens the REAL App Store listing (F-12) | `storeLinks.ts` (NEW), `guestFunnelLink.ts` (NEW), `SeeWhosGoingGate.tsx` (NEW), `GateQr.web.tsx`+`GateQr.tsx` (NEW), `PublicEventPage.tsx`, `FoundationEventPreview.tsx`, `TripPreview.tsx`, `ExperiencePreview.tsx`, `app/t/…`, `app/exp/…`, `DownloadMinglaCta.tsx` | Manual (web-only wiring) |
| 4 | Business iOS | Partially | NO gate (deliberate: `onSeeWhosGoing` wired only under `Platform.OS === 'web'`; native business mounts keep the inert cluster — DESIGN §1.5); `DownloadMinglaCta` correctness rides along wherever it renders | same mingla-business files (guarded) | Manual guard |
| 5 | Business Android | Partially | Same as #4 | same | Same code |
| 6 | Admin Web (`mingla-admin/`) | NOT covered | — zero offering-rendering mounts (F-2) | none | — |
| 7 | Business Web preview | NOT covered | — preview `goingCount` 0 ⇒ affordance absent by DESIGN §1.5 zero-state; nothing to wire | none | — |
| — | Marketing web (`mingla-marketing/`) | READ-ONLY | — SSOT + QR + platform-detection precedents; CI drift gate reads `lib/store-links.ts` | none (CI reads only) | — |

**Delivery constraints (binding at SHIP):** buyer-web = Vercel `[deploy]` commit-tag; consumer app-mobile = per-platform OTA (pure JS — everything in this leg is JS; the AppsFlyer *SDK/entitlement* go-live is native, but this leg's code changes are OTA-safe); business app = NO OTA ever (COMMS-0052/0063) — the mingla-business changes here reach business-native only via the next native build, which is acceptable because the gate is web-only and F-12's stale URL is strictly-better-when-arrives.

## 4. Layered specification

### 4.1 Store-links SSOT for mingla-business (+ F-12 fix)

**Decision (bound):** duplicated constants file + CI drift gate — NOT a cross-package import. Rationale: `mingla-marketing` is Next.js, `mingla-business` is Expo/Metro; a cross-app import couples two build systems for four string constants, and the house already runs the strict-grep registry pattern for exactly this class. The drift gate makes divergence a CI failure, which is stronger than an import (it also bans stray literals — the F-12 recurrence class).

**File (NEW):** `mingla-business/src/constants/storeLinks.ts`
- `APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'` and `PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mingla.app.v2'` — byte-identical to `mingla-marketing/lib/store-links.ts:6-8`.
- `DOWNLOAD_PAGE_URL = 'https://usemingla.com/download'` — the marketing smart-download route (ORCH-1319), the dark-mode QR target.
- `GUEST_FUNNEL_ONELINK_URL: string | null = null` — **the go-live flip constant.** `null` = dark (store-direct behavior). At go-live Seth flips it to `'https://go.usemingla.com/w36m'` in a one-line `[deploy]` PR (constant, NOT env — `EXPO_PUBLIC_*` web-export inlining gotchas make an env flip non-deterministic; a code flip is auditable and testable).
- Header comment naming the SSOT rule (mirrors the ORCH-1319/1324 comments), this SPEC, and the drift gate.

**F-12 fix:** `mingla-business/src/components/checkout/DownloadMinglaCta.tsx` — delete the two local constants (`:13-14`, the stale `apps.apple.com/app/mingla`), import `APP_STORE_URL`/`PLAY_STORE_URL` from `../../constants/storeLinks`. No other behavior change (universal-link fallback `usemingla.com/orders/{id}/chat` stays).

**Drift gate (NEW):** `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs`, registered as job `orch-1342-store-links-ssot` in `.github/workflows/strict-grep-mingla-business.yml` (registration pattern of the most recent sibling, `orch-1328-…`). Asserts, self-tested per house style:
1. `mingla-business/src/constants/storeLinks.ts` exists and its `APP_STORE_URL`/`PLAY_STORE_URL` string literals byte-equal the ones parsed from `mingla-marketing/lib/store-links.ts`.
2. No `apps.apple.com` or `play.google.com/store` literal exists anywhere in `mingla-business/src/**` or `mingla-business/app/**` OUTSIDE `src/constants/storeLinks.ts` (kills the F-12 class forever).

### 4.2 The smart URL builder — `resolveGuestFunnelTarget`

**File (NEW):** `mingla-business/src/services/guestFunnelLink.ts`

- Verbatim copies of `isIosDevice` / `resolvePlatform` / `detectClientPlatform` from `mingla-marketing/lib/device-platform.ts` (the ORCH-1319 trio incl. the iPad-as-Mac `maxTouchPoints` catch), pinned by a unit test against the same cases — the house "extracted VERBATIM" precedent.
- Contract (signature-level; the shapes are the contract):

```ts
export type GuestFunnelEntity = { entityType: 'event'|'rsvp'|'trip'|'experience';
  brandSlug: string; entitySlug: string };
export function buildGuestFunnelOneLinkUrl(e: GuestFunnelEntity): string | null;
export function resolveGuestFunnelTarget(e: GuestFunnelEntity, platform: Platform):
  { mode: 'onelink'|'store_direct'; ctaUrl: string; qrUrl: string; store: string };
```

- **`buildGuestFunnelOneLinkUrl`** returns `null` when `GUEST_FUNNEL_ONELINK_URL` is null (dark). When live, it composes — with every slug `encodeURIComponent`-encoded, never raw-concat (1318 §B.5.5 rule):
  `{GUEST_FUNNEL_ONELINK_URL}?deep_link_value={value}&deep_link_sub1={brandSlug}&deep_link_sub2={entitySlug}&deep_link_sub3=guest-list&pid=buyer_web&c=see_whos_going`
  where `value` maps `rsvp → 'event'` and passes `event|trip|experience` through verbatim — **binding:** the resolver contract has no `'rsvp'` discriminator (`oneLinkResolver.ts:24-35`); RSVP events ride `deep_link_value='event'` → the `/e/` route, exactly like their public page. `pid`/`c` are the AppsFlyer media-source/campaign attribution params (§10-4 flags the naming for Seth's veto).
- **`resolveGuestFunnelTarget`** — dark mode (`onelink` unavailable): `ctaUrl` = `APP_STORE_URL` (ios) / `PLAY_STORE_URL` (android) / `DOWNLOAD_PAGE_URL` (other); `qrUrl` = `DOWNLOAD_PAGE_URL`; `mode:'store_direct'`. Live mode: `ctaUrl = qrUrl = buildGuestFunnelOneLinkUrl(e)` — **the QR encodes the SAME URL the CTA opens** (dispatch rule; adversarial T-A7 pins it).
- `openExternal(url)` helper — byte-pattern of `links-experience.tsx:164-167` (window.open `noopener,noreferrer`, popup-blocked → `location.assign`). The page NEVER redirects on tap (DESIGN §3.1).

### 4.3 `SeeWhosGoingGate` + `GateQr` (DESIGN §3 is the pixel contract — not restated here)

**File (NEW):** `mingla-business/src/components/event/SeeWhosGoingGate.tsx` — RN primitives + `palette.*` tokens ONLY (biz-web hex hygiene; the ONE sanctioned non-palette fill is the solid-white QR card, DESIGN §3.2-4).

Props (the component owns platform detection, target resolution, open + analytics; mounts stay one-liners):

```ts
{ visible: boolean; onClose: () => void; entity: GuestFunnelEntity; eventId: string;
  guestSample: SocialProofSampleEntry[]; palette: ThemePalette; theme: ResolvedTheme }
```

- Variant selection: `useResponsiveLayout().isDesktop` → desktop QR dialog (§3.2), else phone panel (§3.1). Same breakpoint as the page — D9/DESIGN §3.3.
- Phone panel: scrim + slide-up per §3.1; mini-cluster echo renders `guestSample` avatars at 30px (non-pressable; avatars only — **never names**, D1); primary "Get the app" → `openExternal(target.ctaUrl)` + analytics; secondary "Not now" → `onClose`.
- Desktop dialog: §3.2 top-down content; `GateQr` renders `target.qrUrl`; badges row uses `APP_STORE_URL`/`PLAY_STORE_URL` from the SSOT; ✕ / Esc / scrim-click dismiss; focus trapped in-dialog and returned to the invoking control on close (§3.2 a11y).
- Copy byte-exact from DESIGN §4 web block. Reduced-motion variants per §3.1/§3.2.
- Renders `null` when `visible` is false (no touch-capturing residue — the COMMS-0084 overlay lesson applied to web).

**Files (NEW pair):** `mingla-business/src/components/event/GateQr.web.tsx` (renders `react-qr-code` — same props as marketing's `download-qr.tsx`: `fgColor '#0E0E10'`, `bgColor '#FFFFFF'`, `level 'M'`, 180×180 per DESIGN §3.2-4, `role="img"` + the accessibility label from DESIGN §4) and `GateQr.tsx` (native stub returning `null` — Metro's platform split keeps `react-qr-code` OUT of the business native bundles; the postHogService.web.ts house pattern). New dependency `react-qr-code` added to `mingla-business/package.json` — pure inline SVG, no network; the `web-build-check.yml` bundle-budget gate must stay green (T-13).

### 4.4 Web wiring (the Q11 map, web mounts only)

**4.4.1 Mount + state.** Each wired surface holds `const [gateVisible, setGateVisible] = useState(false)` and mounts ONE `SeeWhosGoingGate` sibling at page-host level. `onSeeWhosGoing` (the 1341 package prop) is passed **only when `Platform.OS === 'web'`** — value `() => { capture(§4.4.3-a); setGateVisible(true); }`. On native business surfaces the prop is simply not passed → inert cluster, no dead tap (DESIGN §1.5).

| Surface file | Wiring |
|---|---|
| `mingla-business/src/components/event/PublicEventPage.tsx` | ONE gate mount serving BOTH branches. RSVP branch: extend the `config` literal (`:821-841`) with `onSeeWhosGoing` (web-only). Ticketed branch: pass `onSeeWhosGoing` through `FoundationEventPreview` → `EventOfferingBody`. `entity` from the page's own slugs + `event.event_type`; `guestSample` from the 1339 `socialProof` query (`?? []`). Covers `/e/…` AND `/checkout/[eventId]` (both render this page). |
| `mingla-business/src/components/event/FoundationEventPreview.tsx` | Add passthrough prop `onSeeWhosGoing?: () => void` → body (mirrors 1339's `socialProof` passthrough). |
| `mingla-business/src/components/trip/TripPreview.tsx` / `experience/ExperiencePreview.tsx` | Same passthrough prop → `TripOfferingBody` / `ExperienceOfferingBody` (FOUNDATION mode only). |
| `mingla-business/app/t/[brandSlug]/[tripSlug].tsx` / `app/exp/[brandSlug]/[experienceSlug].tsx` | Gate state + mount + web-only `onSeeWhosGoing` into the preview; `entity` from route slugs (`trip`/`experience`), `guestSample` from the 1339 query. |

**4.4.2 Dependency (HARD):** the package-side `onSeeWhosGoing` chain (prop on `OfferingMomentum` + `RsvpMomentumDecision`, forwarding through the three bodies + `RsvpOfferingConfig`) is ORCH-1341's deliverable per the investigation decomposition + DESIGN §1.6. If any link of that chain is missing at IMPLEMENT time, **stop-and-amend** — this leg must not touch `packages/offering-rendering`.

**4.4.3 Analytics (buyer-web PostHog, house convention `postHogService.capture`):**
- (a) `see_whos_going_clicked` — `{ entity_type, event_id, variant: 'phone_panel'|'desktop_qr' }` — fired on affordance tap (before the gate opens).
- (b) `guest_gate_get_app_clicked` — `{ entity_type, event_id, platform: 'ios'|'android'|'other', mode: 'store_direct'|'onelink', store }` — fired in the primary-CTA handler before `openExternal`.
- (c) `guest_gate_dismissed` — `{ entity_type, event_id, variant, method: 'not_now'|'scrim'|'close'|'esc' }`.

### 4.5 Resolver extension (the ONE parser — I-ONELINK-SINGLE-RESOLVER)

**File:** `app-mobile/src/services/oneLinkResolver.ts` — extend IN PLACE; no new parser anywhere.

- Type: the event/trip/experience entity variant of `OneLinkDestination` gains `landing?: 'guest-list'` (the `brand` variant does NOT — a guest list is event-scoped).
- Parse: `deep_link_sub3` read with the existing `str()` helper; **only** the exact lowercase token `'guest-list'` maps to `landing: 'guest-list'`; any other value (absent, garbage, future tokens) → the field is OMITTED — the destination still resolves and navigates normally (graceful degrade; a bad landing must never kill the entity link).
- Conditional inclusion mirrors `referralCode` (`:71-73`): the key is added only when valid, so every pre-1342 payload produces a byte-identical destination — the ORCH-1318 test suite stays green UNMODIFIED (tests-append-only; new assertions live in a NEW test file).
- Doc-contract header: extend the payload-contract block (`:11-16`) with one line: `deep_link_sub3 = optional landing discriminator ('guest-list')`.

### 4.6 Dispatcher + route params (landing rides INSIDE the path — the deferred replay needs zero changes)

**File:** `app-mobile/app/index.tsx` — `dispatchOneLinkDestination` ONLY (`:1840-1897`).
- After `path` is composed (`:1863-1877`): if the destination is a non-brand entity and `dest.landing === 'guest-list'`, append `?landing=guest-list` to `path`. ONE composition point — both the authed `router.push(path)` (`:1890`) and the unauthenticated deferral (`:1884-1887`, `{url: path, ts, router:true}`) carry it automatically. **The replay block (`:845-880`) is DO-NOT-TOUCH:** it already `router.push(url)`-es the persisted string verbatim (`:869-872`) — the landing param survives the install-defer-replay cycle by construction. Cite this mechanism in the code comment.

**Files:** `app-mobile/app/e/[brandSlug]/[eventSlug].tsx`, `app/t/[brandSlug]/[tripSlug].tsx`, `app/exp/[brandSlug]/[experienceSlug].tsx`
- Read `landing` via the existing `useLocalSearchParams` call; normalize array→first; validate: pass `landing="guest-list"` to the screen ONLY on exact match, else `undefined`.
- `/e/` header comment updated: the OQ-6/ORCH-1138 cold-cap note (`:5-9`) is superseded by D6 — this route now cold-renders (§4.7).

**Buyer-web is NOT wired to the param:** the mingla-business `/e|t|exp` routes ignore `?landing=…` entirely (nothing reads it) — a spoofed web URL opens nothing and leaks nothing (D1; adversarial T-A6).

### 4.7 D6 — the seedless `/e/` cold route renders for real (NO new backend)

**Decision (bound, per the dispatch's D6 clause):** SPEC-1338's surface already covers the *social-proof* read (Function A, keyed by event id, D6-compatible by design); the missing piece is only the **page seed** — and that is already fully served by the anon `business_public_events_view` (assumption block: slugs + every card field, `visibility='public'` enforced in the view's WHERE). A client read of an already-public view is strictly narrower than a new RPC, uses the exact read path this screen family already uses anon (`fetchRsvpMomentum`, `useEventTheme` — COMMS-0009 precedent), and adds zero new exposure. **Therefore: no migration, no RPC.** (Had a new read been required, it would have followed 1338 §4.1's guard-first + version-frontier rules — recorded here to honor the dispatch's conditional.)

**File (NEW):** `app-mobile/src/services/publicEventSeedService.ts`
- `fetchPublicEventSeedBySlug(brandSlug: string, eventSlug: string): Promise<BusinessEventCard | null>` — `.from('business_public_events_view')` with an EXPLICIT column select, `.eq('brand_slug', brandSlug).eq('slug', eventSlug).maybeSingle()`. Row null → null. `event_type NOT IN ('event','rsvp')` → null (trips/experiences own `/t|/exp`; an `/e/` link to them is an unknown-slug case).
- Mapper → `BusinessEventCard` (`types/mergedDiscover.ts:18`), field-bound: `eventId=id`, `brandId=brand_id`, `brandSlug=brand_slug`, `brandName=brand_name`, `brandProfilePhotoUrl=brand_profile_photo_url`, `eventSlug=slug`, `title`, `description`, `coverMediaUrl/coverMediaType` (view cols), `masterDateUtc=master_start_at`, `masterEndAtUtc=master_end_at`, `timezone=master_timezone ?? timezone`, `venueName=null`, `city`, `address=location_text`, `partyTypes/vibeTags/musicGenres` (arrays, `?? []`), `displayPriceCents=display_price_cents`, `displayCurrency=pricing_currency ?? currency`, `currency`, `priceMin/priceMax=null`, `doorsOpenLocal/endsAtLocal=null` (nullable; doors labels degrade honestly), `publicBuyerUrl` = `https://business.usemingla.com/e/{brand_slug}/{slug}` (encoded), `eventType=event_type`, `brandTheme={color: brand_theme_color, font: brand_theme_font, animation: brand_theme_animation, color_override: theme_color_override, font_override: theme_font_override}`.
- Theme-derived fields MIRROR the authoritative buyer-web parse (`publicEventsService.ts:1003,1034`): `format` = `public_theme.business_event.format` with `is_online` fallback; `hideAddressUntilTicket` = `asBoolean(public_theme.business_event.hideAddressUntilTicket, false)`; `locationGeo` mirrors `publicEventsService`'s geo parse. `coverHue: 0` (the neutral default the screen's own seedless placeholder uses at `:550`; hue is a no-media fallback tint only — protective comment required).
- Constitution #9: every unavailable field is null/empty, never invented.

**File:** `app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx`
- Rename the destructured prop to `seed: seedProp`; add `const coldSeedQuery = useQuery({ queryKey: ['publicEventSeed', brandSlug, eventSlug], enabled: seedProp == null && !!brandSlug && !!eventSlug, staleTime: 60_000, queryFn: … })` (the in-file sibling key convention, `:284-290`); then `const seed = seedProp ?? coldSeedQuery.data ?? null` ABOVE every existing `seed` read — the rest of the file is untouched (all `seed?.…` reads, `isRsvp:246`, `eventId:272`, both branches, both mounts now work cold).
- Early-return ladder: while `seedProp == null && coldSeedQuery.isLoading` → the EXISTING loading sheet (`:717-735`). Settled null/error → the EXISTING "Open this event from the app" cap (`:690-714`), now the honest terminal state for unknown/private/deleted slugs (its copy is acceptable as-is for v1; §10-3).
- **The RSVP branch is now reachable cold** — `eventType` arrives on the fetched seed; `fetchRsvpMomentum`/`useEventTheme`/`usePublicEventTickets` all key off the seed's `eventId` and already work.

### 4.8 Landing auto-open sequencing (mount-then-open, incl. the not-yet-loaded case)

Contract, identical on all three consumer detail screens (primary spec target: `ConsumerEventDetailScreen`; trips/experiences wire the same effect against their own data sources):

- New optional prop `landing?: 'guest-list'`.
- One-shot guard: `const landingHandledRef = useRef(false)`.
- Effect fires the 1341 sheet-open (the SAME handler the card's `onSeeWhosGoing` invokes — never a parallel path) when ALL of:
  1. `landing === 'guest-list'` and `landingHandledRef.current === false`;
  2. the seed/detail model is resolved (event branch actually mounted — cold seed settled non-null);
  3. the 1339 `socialProof` query has SETTLED with data AND `privateGuestList === false` AND `goingCount > 0` (the exact conditions under which the card renders the affordance — DESIGN §1.5; D9);
  4. the 1341 sheet handler exists on this screen.
  Then set the ref and open. The ref is set on ANY terminal outcome (opened, or disqualified by 3) so the sheet never pops later on a refetch.
- **Not-yet-loaded case:** conditions are evaluated reactively — the effect simply waits for the queries; no timers, no navigation retries. If the seed resolves null (unknown slug) the screen shows the graceful cap and the landing intent dies silently with it.
- **privateGuestList case (adversarial-bound):** condition 3 fails → the sheet NEVER auto-opens; the page renders normally minus cluster/affordance (1339's D2 gates). Defense-in-depth: if a race ever opened the sheet, 1338's Function B raises `guest_list_private` → the sheet's DESIGN §2.7 private-empty state renders. Both layers are required.
- `socialProof` query error → condition 3 never satisfies → no auto-open, page renders as today (fail-quiet parity with 1339's SC-13).

### 4.9 Database / Edge / Realtime — none (client-only leg; §4.7 rationale). Hook/Service layers are covered inline above.

## 5. Success criteria — with the COMMS-0083 gating split

**Label semantics (binding on the tester):** `[NOW]` = fully testable at this META's CLOSE (web `[deploy]`, consumer OTA/sim). `[NATIVE-GATED]` = becomes testable ONLY after Seth's go-live (fresh consumer native builds + `APPSFLYER_S2S_TOKEN` + OneLink branded-domain verification + the §10-2 constant flip). The tester CAPS `[NATIVE-GATED]` criteria as "capped — awaiting native go-live" and must NOT fail the leg on them.

- **SC-1 [NOW] (phone web):** on a phone-width browser, tapping "See who's going" on each of the four public pages (`/e/` RSVP, `/e/` standard, `/t/`, `/exp/`) opens the DESIGN §3.1 panel over the page; "Get the app" opens the platform-correct store (iOS UA → `id6760440898`, Android UA → Play) via `window.open`, with the event page STILL mounted behind (never a redirect); "Not now" + scrim dismiss.
- **SC-2 [NOW] (desktop web):** same tap on a desktop-width browser opens the DESIGN §3.2 QR dialog; the QR decodes to exactly `resolveGuestFunnelTarget(...).qrUrl` (= `https://usemingla.com/download` while dark); store badges open the SSOT URLs; ✕/Esc/scrim close; focus returns to the invoking control.
- **SC-3 [NOW] (D1):** no guest name/username string is rendered by the gate in ANY state — cluster avatars + count only (source-assert + runtime).
- **SC-4 [NOW] (D9/D2):** on an event with `privateGuestList=true` (the F-11 live host qualifies), the web pages render NO "See who's going" affordance → the gate is unreachable; a hand-crafted `?landing=guest-list` on the buyer-web URL does nothing.
- **SC-5 [NOW] (F-12 — its own criterion per the dispatch):** the post-checkout confirm page's `DownloadMinglaCta` opens `https://apps.apple.com/app/id6760440898` on iOS; the stale `apps.apple.com/app/mingla` literal no longer exists ANYWHERE in mingla-business (drift gate green + grep proof).
- **SC-6 [NOW]:** the three PostHog events fire with the §4.4.3 property shapes (PostHog live-tail or debug capture proof).
- **SC-7 [NOW] (resolver/dispatcher, JS-provable):** `resolveOneLinkDestination({deep_link_value:'event', deep_link_sub1:'b', deep_link_sub2:'s', deep_link_sub3:'guest-list'})` → entity destination with `landing:'guest-list'`; same payload without/with-garbage `sub3` → byte-identical pre-1342 destination; the dispatcher composes `/e/b/s?landing=guest-list` and, unauthenticated, persists exactly `{url:'/e/b/s?landing=guest-list', ts, router:true}`; the untouched replay pushes it verbatim.
- **SC-8 [NOW] (D6 cold route):** navigating cold to `/e/{brand}/{event}` in the consumer app (sim, no seed) renders the FULL event page from slugs — RSVP events show the real RSVP branch (decision buttons + momentum + working submit), standard events show the ticket box; an unknown slug shows the graceful "Open this event from the app" cap; no crash, no spinner residue.
- **SC-9 [NOW] (warm landing):** with the app running, opening `/e/{brand}/{event}?landing=guest-list` for a public-guest-list RSVP event auto-opens the ORCH-1341 sheet exactly once after the page settles; on a `privateGuestList=true` event the sheet does NOT open and the page renders gracefully; same contract on `/t/` and `/exp/`.
- **SC-10 [NATIVE-GATED] (flip):** with `GUEST_FUNNEL_ONELINK_URL` flipped, the gate CTA + QR emit `https://go.usemingla.com/w36m?deep_link_value=…&deep_link_sub1=…&deep_link_sub2=…&deep_link_sub3=guest-list&pid=buyer_web&c=see_whos_going` (encoded), and phone-tap routes through AppsFlyer to the correct store. (The flip itself is Seth's go-live; the URL composition is unit-proven `[NOW]` in T-4.)
- **SC-11 [NATIVE-GATED] (the deferred prize):** fresh install via the OneLink → first open → sign-in/onboarding → the app auto-navigates to that event and opens the guest-list sheet (physical device + AppsFlyer dashboard evidence, per the ORCH-1313 QA §7 pattern).
- **SC-12 [NATIVE-GATED] (warm universal link):** with the new build installed, tapping the OneLink opens the app directly (associated domain) → `onDeepLink` → same landing, no store detour.

## 6. Invariants

**Preserved (ID → how → verifying test):**
- **I-ONELINK-SINGLE-RESOLVER** — the landing discriminator is parsed ONLY inside `resolveOneLinkDestination` (extended in place); the dispatcher consumes the typed field; NO second payload parser exists anywhere (new strict-grep gate, §9). → T-1/T-2 + gate.
- **I-NOTIF-FALLBACK-AGREES posture (1318 §B.2)** — null-on-unknown parity is preserved: a malformed `sub3` degrades the FIELD, never the destination; the two nav systems still cannot disagree (the `mingla://` system never sees `landing`). → T-1 edge rows.
- **I-PROPOSED-1157 family (NO-CHECKOUT / DECISION-IS-HERO / THEME-DIAL + the ADDRESS-privacy half)** — untouched: this leg adds no package code, no checkout affordance, no hex into card code; the gate lives in mingla-business and uses `palette.*` (single sanctioned white QR card). → existing suites green unmodified (SC-12-class check in T-13).
- **I-MOR-0827-PACKAGE-ISOLATION** — zero `packages/` edits in this leg (hard dependency on 1341 instead). → allowlist + CI.
- **D1 / I-PROPOSED-1340 successor (names never on web)** — the gate renders avatars + count only; `PeerGuestRow`/names never reach a web surface (1338's Function B has no anon grant; the gate never calls it). → T-6 source-assert + SC-3.
- **COMMS-0009 (no client `.from('brands')`)** — the seed read uses the anon view exclusively. → T-8 source assert.
- **ORCH-1328 pattern (client-side open, page stays)** — `openExternal` byte-pattern + never `location.href` as primary. → T-5 + existing `orch-1328-…` gate untouched.
- **Tests-append-only** — no existing test file modified; all new assertions in new files. → CI.

**Proposed NEW (DRAFT — the orchestrator flips ACTIVE at CLOSE; this SPEC does not):**
- **I-PROPOSED-1342-LANDING-SINGLE-PARSE (DRAFT):** the OneLink landing discriminator (`deep_link_sub3`) is parsed in exactly one place — `oneLinkResolver.ts` — and travels app-internally ONLY as the `landing` query param composed by `dispatchOneLinkDestination`; no other module reads `deep_link_sub3`. *Strict-grep gate:* `orch-1342-landing-single-parse.mjs` — the token `deep_link_sub3` appears in `app-mobile/src/**` + `app-mobile/app/**` only in `oneLinkResolver.ts` (and `__tests__`).
- **I-PROPOSED-1342-STORE-LINKS-SSOT (DRAFT):** mingla-business store/download URLs live only in `src/constants/storeLinks.ts`, byte-matched to `mingla-marketing/lib/store-links.ts` by CI; no store-URL literal exists elsewhere in mingla-business. *Strict-grep gate:* `orch-1342-store-links-ssot.mjs` (§4.1).
- **I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS (DRAFT):** the web guest gate renders no guest identity text and its CTA opens externally client-side (`window.open` first) with the event page left mounted; the QR always encodes the same URL the CTA opens when OneLink mode is live. *Verified by:* T-6/T-5/T-A7 (test-enforced; no grep gate — copy strings are design-owned).

## 7. Test cases

| # | Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|---|
| T-1 | resolver landing (NEW file `oneLinkResolver.orch1342.test.ts`) | happy/absent/garbage/uppercase sub3; brand kind; missing sub2 | pure fn calls | `landing:'guest-list'` only on exact token + entity kinds; absent otherwise; byte-identical legacy outputs; brand ignores sub3; half-formed still null | unit |
| T-2 | dispatcher composition | source assert on `index.tsx` | deno/jest source | `?landing=guest-list` appended at the ONE `path` composition; deferral object literal unchanged in shape; replay block byte-untouched | unit/source |
| T-3 | route param validation | `/e|t|exp` route files | source assert | `landing` read via `useLocalSearchParams`, exact-match validated, passed to screen | source |
| T-4 | URL builder | dark + live modes, all 4 entity types, slug encoding | pure fn | dark: store/`DOWNLOAD_PAGE_URL` split; live: exact §4.2 URL, `rsvp→event` mapping, `ctaUrl === qrUrl`, `encodeURIComponent` on slugs | unit |
| T-5 | client-open pattern | gate CTA handler | source assert + jsdom | `window.open('_blank','noopener,noreferrer')` first, `location.assign` only on null; no `location.href=` primary | unit |
| T-6 | never-names (adversarial) | `SeeWhosGoingGate` source + render | source + render probe | no `displayName|username|display_name` token consumed/rendered; only `avatarUrl` from sample; copy strings match DESIGN §4 | unit |
| T-7 | platform trio pinned | iPad-as-Mac / Android / desktop | pure fn | verbatim-parity results with `mingla-marketing/lib/device-platform.ts` cases | unit |
| T-8 | seed service mapper | fixture view row (rsvp + standard + trip row) | pure fn | field table §4.7 exact; trip/experience row → null; theme-derived fields mirror `publicEventsService`; no `.from('brands')` in file | unit + source |
| T-9 | cold `/e/` runtime | live public RSVP + standard event, unknown slug | consumer sim (Maestro, `--device <iOS UDID>`) | SC-8 behaviors incl. RSVP decision tap firing (interactive-elements runtime-proof rule) | runtime/sim |
| T-10 | warm landing runtime | `?landing=guest-list` public vs `privateGuestList=true` vs goingCount 0 | consumer sim | SC-9: opens once / never opens / never opens; page graceful in all three | runtime/sim |
| T-11 | deferred replay parity | simulate: dispatch landing dest while signed out → sign in | sim (JS-level: seed AsyncStorage via dispatcher, then auth) | replay pushes the SAME path+param as the warm push (cold vs warm parity); >24h `ts` → discarded, no nav | runtime/sim |
| T-12 | web gate runtime | phone + desktop widths, all four pages | browser (buyer-web export) | SC-1/SC-2/SC-4 incl. Esc/focus-trap; F-11 live private event shows no affordance | runtime/web |
| T-13 | budgets + suites | full CI | — | `web-build-check.yml` green with `react-qr-code`; all existing suites green with ZERO existing-test edits; both new gates green + self-tests pass | CI |
| T-14 | F-12 | confirm page | browser iOS UA + grep | SC-5 | runtime + CI |

**Adversarial table (dispatch-required, binding):**

| # | Attack / edge | Expected |
|---|---|---|
| T-A1 | Wrong payload: `deep_link_sub3='banana'` / `'GUEST-LIST '` (case/space variants beyond trim+lowercase exact-match) | plain entity nav, no landing key, no crash |
| T-A2 | Expired deferred payload (`ts` older than 24h, landing inside url) | discarded by the untouched TTL check; NO navigation, NO sheet |
| T-A3 | Unknown slug via cold `/e/` with `?landing=guest-list` | seed fetch → null → graceful cap; landing dies silently |
| T-A4 | `landing=guest-list` on a `privateGuestList=true` event (warm AND deferred-replay arrival) | sheet does NOT auto-open; page renders normally; if force-opened, 1338 Function B `guest_list_private` → DESIGN §2.7 private state |
| T-A5 | `landing=guest-list`, `goingCount === 0` | no auto-open (affordance-parity rule §4.8-3) |
| T-A6 | Spoofed `?landing=guest-list` on BUYER-WEB URLs | ignored — web routes never read the param; no gate, no data |
| T-A7 | QR URL drift | gate test asserts QR `value` ≡ `resolveGuestFunnelTarget(...).qrUrl` ≡ CTA url in onelink mode (single-builder source assert) |
| T-A8 | Popup blocked (`window.open` → null) | same-tab `location.assign` fallback fires (no dead tap) |
| T-A9 | Store-URL literal reintroduced anywhere in mingla-business | `orch-1342-store-links-ssot` gate FAILS the PR |
| T-A10 | Second payload parser added (`deep_link_sub3` read outside the resolver) | `orch-1342-landing-single-parse` gate FAILS the PR |

## 8. Implementation order

1. `mingla-business/src/constants/storeLinks.ts` + `orch-1342-store-links-ssot.mjs` gate (+ workflow job registration) → repoint `DownloadMinglaCta.tsx` (F-12 dies first — smallest, independently shippable).
2. `guestFunnelLink.ts` (platform trio + builder) + T-4/T-5/T-7.
3. `GateQr.web.tsx`/`GateQr.tsx` + `SeeWhosGoingGate.tsx` (+ `react-qr-code` dep) + T-6.
4. Web wiring §4.4 (PublicEventPage both branches, passthroughs, `/t` + `/exp` routes) + analytics — **verify the 1341 `onSeeWhosGoing` chain exists first; stop-and-amend if not.**
5. `oneLinkResolver.ts` extension + T-1; `index.tsx` dispatcher composition + T-2; `orch-1342-landing-single-parse.mjs` gate + registration.
6. `/e|t|exp` route param wiring + T-3.
7. `publicEventSeedService.ts` + T-8; `ConsumerEventDetailScreen` seed resolution (§4.7) — cold route lights up.
8. Landing auto-open effect on the three screens (§4.8).
9. Runtime proof: T-9/T-10/T-11 (sim), T-12 (web export — worktree export needs `--clear`), T-13/T-14.
10. Fails-on-revert demonstrations (§9) in the implementation report. NO deploy, NO OTA publish, NO constant flip (orchestrator owns SHIP; Seth owns go-live).

## 9. Regression prevention (fails-on-revert contract)

**Structural safeguards:**
- CI gates `orch-1342-store-links-ssot.mjs` + `orch-1342-landing-single-parse.mjs` (self-tested per house pattern, registered in `strict-grep-mingla-business.yml`).
- New test files: `app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts`, `app-mobile/src/services/__tests__/publicEventSeedService.orch1342.test.ts`, `app-mobile/src/screens/Event/__tests__/orch_1342_cold_seed_landing.test.ts` (source-asserts: dispatcher composition, screen seed-resolution + one-shot landing effect), `mingla-business/src/services/__tests__/orch_1342_guest_funnel_link.test.ts`, `mingla-business/src/components/event/__tests__/orch_1342_see_whos_going_gate.test.tsx`, `mingla-business/src/components/checkout/__tests__/orch_1342_download_cta_ssot.test.ts`.

**Fails-on-revert requirement (implementor demonstrates one revert-run per family in the report):**
- Strip the resolver's `sub3` parse → T-1 FAILS; restore → PASSES.
- Strip the dispatcher's `?landing=` append → T-2 FAILS.
- Re-hardcode `apps.apple.com/app/mingla` in `DownloadMinglaCta` → the SSOT gate + T-14 grep FAIL.
- Point the QR at a different URL than the CTA builder output → T-A7 FAILS.
- Remove the `privateGuestList` condition from the auto-open effect → the screen source-assert in `orch_1342_cold_seed_landing.test.ts` FAILS (it pins the condition tokens).

**Protective comments:** the resolver extension cites I-ONELINK-SINGLE-RESOLVER + this SPEC; the dispatcher composition cites "landing rides INSIDE the persisted url — replay must stay untouched"; `storeLinks.ts` cites the drift gate; the seed service cites COMMS-0009 + "anon view only — never .from('brands')"; the auto-open effect cites D9/D2 + T-A4.

## 10. Open questions (explicit — none silently resolved)

1. **Branded-domain attachment (go-live item, Seth):** `go.usemingla.com` must be verified as the branded domain of OneLink template `w36m` in the AppsFlyer dashboard before the §4.1 constant flip (MCP shows the template + both store apps; the domain attachment is dashboard-side). SDK groundwork (`applinks` + `setOneLinkCustomDomains`) already ships.
2. **The flip itself:** bound as a code-constant one-line `[deploy]` PR (§4.1 rationale vs env). Seth's go-live checklist: fresh native builds → `APPSFLYER_S2S_TOKEN` → domain verify → flip → run SC-10/11/12.
3. **Cold-cap terminal copy:** the existing "Open this event from the app / Find it on your Discover deck…" copy now only shows for unknown/private slugs — slightly stale ("Not found" would be more honest). Kept as-is (copy change = product veto); flag for Seth.
4. **AppsFlyer attribution params:** `pid=buyer_web&c=see_whos_going` chosen as the media-source/campaign taxonomy — flag for Seth's veto (pure string swap).
5. **Consumer OTA timing:** the app-side half (cold route + landing) is OTA-able but depends on 1341's sheet being in the SAME consumer release; orchestrator sequences one consumer OTA after 1341+1342 both merge (per-platform publishes, never `--platform all`).

## 11. Downstream routing

- **Next: mingla-implementor** — build exactly this contract in the META worktree (`~/Desktop/mingla-orchs/META-ORCH-1337-[social-proof-guest-list]`, branch `META-ORCH-1337-social-proof-guest-list`). Preconditions on the branch: 1338 types + 1339 socialProof plumbing + 1341 `onSeeWhosGoing` chain. Stop-and-amend on ANY file outside the allowlist (especially anything under `packages/`).
- **Then: mingla-tester** — §7 incl. the adversarial table; `[NOW]` criteria live-fire (sim + buyer-web export + live F-11 private event); `[NATIVE-GATED]` criteria CAPPED with the exact label "awaiting Seth's AppsFlyer go-live (COMMS-0083)" — a cap here is NOT a failure of this leg.
- **Then: orchestrator SHIP/CLOSE** — ONE PR, all CI green (both new gates + self-tests); web `[deploy]`; consumer per-platform OTA (coordinated with 1341, §10-5); flip `I-PROPOSED-1342-*` DRAFT→ACTIVE with the same-PR pinning tests (docs-only-CLOSE hazard rule); WORLD_MAP sync; register Seth's go-live checklist (§10-1/2) as the META's residual.

---

## Scoped allowlist (the implementor may create/modify ONLY these)

**mingla-business:**
1. `src/constants/storeLinks.ts` (NEW)
2. `src/components/checkout/DownloadMinglaCta.tsx` (F-12: swap local constants for SSOT imports ONLY)
3. `src/services/guestFunnelLink.ts` (NEW)
4. `src/components/event/SeeWhosGoingGate.tsx` (NEW)
5. `src/components/event/GateQr.web.tsx` + 6. `src/components/event/GateQr.tsx` (NEW pair)
7. `src/components/event/PublicEventPage.tsx` (gate state/mount + web-only `onSeeWhosGoing` on both branch configs + analytics)
8. `src/components/event/FoundationEventPreview.tsx` (one passthrough prop)
9. `src/components/trip/TripPreview.tsx` (one passthrough prop)
10. `src/components/experience/ExperiencePreview.tsx` (one passthrough prop)
11. `app/t/[brandSlug]/[tripSlug].tsx` + 12. `app/exp/[brandSlug]/[experienceSlug].tsx` (gate wiring)
13. `package.json` (add `react-qr-code` ONLY)

**app-mobile:**
14. `src/services/oneLinkResolver.ts` (type + parse extension per §4.5 ONLY)
15. `app/index.tsx` (`dispatchOneLinkDestination` path composition ONLY — the deferred-replay effect is DO-NOT-TOUCH)
16. `app/e/[brandSlug]/[eventSlug].tsx`, 17. `app/t/[brandSlug]/[tripSlug].tsx`, 18. `app/exp/[brandSlug]/[experienceSlug].tsx` (landing param + `/e/` header-comment update)
19. `src/services/publicEventSeedService.ts` (NEW)
20. `src/screens/Event/ConsumerEventDetailScreen.tsx` (§4.7 seed resolution + §4.8 effect + `landing` prop)
21. `src/screens/Trip/ConsumerTripDetailScreen.tsx` + 22. `src/screens/Experience/ConsumerExperienceDetailScreen.tsx` (`landing` prop + §4.8 effect)

**CI:**
23. `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` (NEW) + 24. `.github/scripts/strict-grep/orch-1342-landing-single-parse.mjs` (NEW)
25. `.github/workflows/strict-grep-mingla-business.yml` (two job registrations ONLY, appended per the ORCH-1328 sibling pattern)

**Tests (all NEW files):**
26. `app-mobile/src/services/__tests__/oneLinkResolver.orch1342.test.ts`
27. `app-mobile/src/services/__tests__/publicEventSeedService.orch1342.test.ts`
28. `app-mobile/src/screens/Event/__tests__/orch_1342_cold_seed_landing.test.ts`
29. `mingla-business/src/services/__tests__/orch_1342_guest_funnel_link.test.ts`
30. `mingla-business/src/components/event/__tests__/orch_1342_see_whos_going_gate.test.tsx`
31. `mingla-business/src/components/checkout/__tests__/orch_1342_download_cta_ssot.test.ts`

## DO-NOT-TOUCH (stop-and-amend before touching ANY of these)

- **`packages/offering-rendering/` — EVERYTHING** (`OfferingMomentum`, `RsvpMomentumDecision`, `RsvpOfferingBody`, the three bodies, `socialProofTypes.ts`, all package tests). The `onSeeWhosGoing` chain is ORCH-1341's; its absence = amendment, never a local add.
- `app-mobile/src/services/appsFlyerService.ts`, `oneLinkShare.ts` (+ its test), `deepLinkService.ts` — the listener/share/mingla:// systems are payload-agnostic to this leg.
- `app-mobile/app/index.tsx` OUTSIDE `dispatchOneLinkDestination` — above all the deferred-replay effect (`:834-880`) and the sink registration (`:386-394`).
- `app-mobile/app.json` (applinks/scheme — native-build territory; already correct).
- Every existing test file (tests-append-only; no token use in this leg), every existing strict-grep `.mjs`, `tests-append-only.yml`, `web-build-check.yml`.
- ALL of `mingla-marketing/` (SSOT + QR + platform precedents are read-only; the drift gate reads, never writes).
- ALL migrations, `business_public_events_view`, both 1338 RPCs, all RLS, all edge functions — this leg ships NO backend.
- 1338/1339 deliverable files (`socialProofTypes.ts`, `socialProofService.ts` — consume, don't edit), `mingla-business/src/services/publicEventsService.ts` (parse precedent, read-only).
- `mingla-admin/` (all), `connectionsService.ts` (F-13 half-stub), `Mingla_Artifacts/INVARIANT_REGISTRY.md`, `COMMS_LEDGER.md` (orchestrator-owned).

---

## ORCHESTRATOR AMENDMENT A-1 (2026-07-10, mingla-orchestrator — binding)

**ORCH-1346 [go-usemingla-branded-domain-dead] landed on main TODAY (another session; COMMS-0090; memory `project_orch_1346_onelink_branded_domain_live.md`) and updates this spec's §10 open items + §4.2 builder:**

1. **§10 open item 1 is RESOLVED:** `go.usemingla.com` is LIVE and curl-verified — CNAME → `mingla.customlinks.appsflyer.com`, assetlinks.json HTTP 200 (consumer `com.mingla.app.v2`, both Play-signing fingerprints), AASA HTTP 200 (prefix `782KVMY869`, paths `/w36m/*`). Branded-domain verification is NO LONGER a Seth go-live item. Remaining native-gated items stand (fresh native builds + `APPSFLYER_S2S_TOKEN`, COMMS-0083).
2. **§4.2 builder MUST mirror `app-mobile/src/services/oneLinkShare.ts`** — the consumer app already MINTS OneLinks on `go.usemingla.com` (consumer OWNS go.*; one branded domain = ONE template is a hard AppsFlyer constraint; business links mint on `minglabiz.onelink.me`, NEVER go.*). The implementor must read `oneLinkShare.ts` (it may have landed after this worktree's rebase point — if absent here, read it from `origin/main` via `git show origin/main:app-mobile/src/services/oneLinkShare.ts` after a fetch) and construct byte-compatible URL shapes (`https://go.usemingla.com/w36m/...` path style + param conventions), duplicating constants into the mingla-business SSOT with the drift gate this spec already mandates. Do NOT invent a second URL grammar.
3. **Guard extension:** the I-PROPOSED-1342 strict-grep gate(s) should also ban `go.usemingla.com` literals in `mingla-business` outside the SSOT file, to keep the 1346 one-domain-one-template constraint enforceable.
