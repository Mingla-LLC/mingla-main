# SPEC — ORCH-1381 [business-getapp-android-choice]

**Mode:** SPEC (mingla-forensics). Build contract. No product code written here.
**Worktree:** `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]` on branch `ORCH-1381-business-getapp-android-choice`
**Ledger:** COMMS-0101 (WARN, OPEN) ingested and acknowledged — its verified launch state is treated as ground truth below.
**Date:** 2026-07-15

---

## 1. Executive summary

Business "Get the app" currently sends **every Android owner to the web app** and never offers the Play listing. That was correct when it shipped (ORCH-1324, 2026-07-09: business Play was still in review). It is now **wrong** — the business Play listing went live 2026-07-15 (production versionCode 33 / 1.1.2, `completed`, HTTP 200 — API-verified, COMMS-0101). An Android business owner today is silently denied the app.

ORCH-1381 replaces the single device-guessing CTA with an **explicit inline choice on every business get-app surface**:

1. **"Download the app"** — an intelligent button: iOS → business App Store, Android → business Play listing.
2. **"Use on web"** → `BUSINESS_WEB_URL`.
3. A short note that the app does more (claims code-verified in §5 — scanning + push).

Desktop has nothing to install, so desktop renders **"Use on web" only**, plus a note naming the two phone platforms.

The decision collapses into **one shared helper** (`lib/business-app-target.ts`). Today the same ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` is copy-pasted across **five** call sites — that triplication *is* the bug class, and it is why a single store going live left four surfaces stale at once.

**Android is routed to the plain Play URL, NOT the business OneLink.** `minglabiz.onelink.me/ZSCW` is **dead on Android** (AppsFlyer app status 🟡 Pending — COMMS-0101). Noted as a future upgrade in §12, gated on an operator dashboard action.

---

## 2. Scope & non-goals

### In scope
- `mingla-marketing/` — the store-links SSOT, a new shared decision helper, and the 4 business get-app surfaces (nav, hero, /links business tab, /business/download).
- `supabase/functions/invite-brand-member/` — the secondary-CTA copy that now states a falsehood.
- CI: amendments to 3 strict-grep gates + 1 new ORCH-1381 gate; rewrites of 4 behavioural test locks.

### Explicit non-goals (and why)
| Not doing | Why |
|---|---|
| Any consumer/Explorer CTA | The consumer app has **no web version** → there is no choice to offer. `app-mobile/**`, `DownloadMinglaCta`, `SeeWhosGoingGate`, `guestFunnelLink`, `/download`, QR/badges are DO-NOT-TOUCH. |
| Routing business Android via `minglabiz.onelink.me` | **Dead on Android today** (AppsFlyer 🟡 Pending). Would ship a broken install path. |
| `go.usemingla.com` for business | Consumer-owned; 1 branded domain = 1 template (ORCH-1346). |
| `mingla-business/src/services/appsFlyerService.ts:132` (business → `go.usemingla.com`) | Pre-existing ORCH-1346 debt bound to the next business **native** build. Out of scope; grandfathered by the 1342 gate. |
| `mingla-business/app/accept-brand-invitation/success.tsx` | Already ships a correct "Download for Android" button (the precedent we mirror). Its hardcoded literals are **grandfathered** by `orch-1342-store-links-ssot.mjs:69-72`, which explicitly defers the `BUSINESS_*` SSOT migration to "a follow-up ORCH". Migrating it is a **separate ORCH** (§13 Discovery D-1) — touching it here widens scope into a native app with no OTA path. |
| Business native iOS/Android app code | Unaffected — this is a marketing-web + email change. |
| admin-web | No get-app CTA. |

### Assumptions
- The business Play + App Store listings are live and stay live (COMMS-0101, API-verified).
- `mingla-marketing/` is touched → the CLOSE commit **must** carry `[deploy]`.

---

## 3. Cross-Surface Impact Declaration

| # | Surface | Covered? | User-visible behaviour demanded | Files touched here | Parity |
|---|---|---|---|---|---|
| 1 | Consumer iOS (`app-mobile/` iOS) | **NO** | unchanged | none | — no web version → no choice exists |
| 2 | Consumer Android (`app-mobile/` Android) | **NO** | unchanged | none | — no web version → no choice exists |
| 3 | Buyer/anonymous Web (`mingla-business/` `/checkout/...`, `/e/...`, `/b/...`, `/t/...`) | **NO** | unchanged | none | — consumer-facing CTAs; out of scope by hard guard |
| 4 | Business iOS (native) | **NO** | unchanged | none | — already installed; no get-app CTA |
| 5 | Business Android (native) | **NO** | unchanged | none | — already installed; no get-app CTA |
| 6 | Admin Web (adjacent) | **NO** | unchanged | none | — no get-app CTA |
| 7 | Business Web preview (adjacent) | **NO** | unchanged | none | — `business.usemingla.com` is the *destination*, not a CTA host |
| **8** | **Marketing web (`mingla-marketing/`)** — *the surface this ORCH targets* | **YES** | 4 get-app surfaces render the inline two-action choice | nav, hero, links-experience, /business/download, store-links, device-platform (read-only), new helper | **Manual** — 4 separate render paths; **automatic** for the decision (one shared helper) |
| **9** | **Transactional email (`invite-brand-member`)** — *targeted* | **YES** | Secondary-CTA copy stops promising "everywhere else opens the web" | `supabase/functions/invite-brand-member/index.ts` | Manual — copy only, **no href change** |

> Surfaces 8 + 9 are additions to the canonical 5+2 list; the canonical seven are all NOT-covered with reasons above.

---

## 4. Blast radius — verification of the dispatch map

Every claim in the dispatched blast-radius map was independently re-read. Result: **map is correct on all 5 MUST-change items**, with 4 corrections/additions (§13).

| # | Claim | Verdict |
|---|---|---|
| 1 | `app/business/download/page.tsx:27-32` is THE server 307 | **CONFIRMED** — `headers()` → `resolvePlatformFromUa` → `if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL)` → `redirect(BUSINESS_WEB_URL)` |
| 2 | `lib/store-links.ts:12-13` comment is stale | **CONFIRMED** — reads "Google Play still in review — no Play listing yet" |
| 3 | 3 client CTAs run the same ternary | **CONFIRMED — and UNDERCOUNTED.** It is **5** call sites, not 3 (see D-2) |
| 4 | `invite-brand-member/index.ts:279-282` copy becomes false | **CONFIRMED** — **both** variants carry the falsehood (lines 281 *and* 282), not just one |
| 5 | `lib/device-platform.ts` feeds all CTAs | **CONFIRMED** — `resolvePlatform` / `detectClientPlatform` / `resolvePlatformFromUa`. **No change needed** (see D-3) |

---

## 5. Copy contract — the "app does more" note (claims code-verified)

Seth has not written this copy. Proposed below. **Every claim is verified against real code** — no invented features.

### Verified claim 1 — door/ticket scanning is native-only ✅ PROVEN (twice over)
- `mingla-business/app/event/[id]/scanner/index.tsx:40` is the **only** file in the business app importing `expo-camera` — live `CameraView` with `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}` (`:585-587`).
- `mingla-business/app/event/[id]/scanner/index.web.tsx:1-22` — the web override exists precisely because `onBarcodeScanned` **is native-only**: *"`CameraView` has no working barcode-scan path on web"*.
- `:99-100` — Mingla's own shipped web copy already says: *"Scan tickets in the app / Door scanning uses your phone camera, which works in the Mingla Business app… You can manage everything else for this {noun} here on the web."*
- **The load-bearing proof — it is not just the camera, it is the redemption.** `scanTicket()` (the `scan-ticket` edge fn that actually validates and burns a ticket — detecting `duplicate` / `wrong_event` / `not_found` / `void` / `not_yet_open` / `event_ended`) has **exactly ONE call site in the entire codebase**: `app/event/[id]/scanner/index.tsx:363`. The web shim never imports `scanTicketService` at all. **Business web has no server-validated check-in path whatsoever.**
- **This is the strongest possible claim: the product already tells web users this.** The marketing note is consistent with shipped in-app copy.

> ⚠️ **Precision caveat the copy already respects — do not widen it.** A *manual* check-in button exists and is **not** platform-gated (`app/event/[id]/guests/[guestId].tsx:310-331`). It is **device-local only** — it writes to `scanStore`, a Zustand store persisted to AsyncStorage with `offlineQueued: true` and **no backend sync** (`src/store/scanStore.ts:10-15`: *"[TRANSITIONAL] Client-side authoritative until B-cycle… no backend sync"*). It never validates a real ticket. So: **web can mark a name off a local list; only native can scan and actually validate a ticket.** The proposed copy says *"scan tickets at the door"* — precise and defensible. **Never** widen it to "only the app can check guests in" — that would be false.

### Verified claim 2 — push notifications are native-only ✅ PROVEN
- `mingla-business/src/services/oneSignalService.web.ts` — the **entire** service is a no-op shim: `initializeOneSignal(): void {}`, `isOneSignalReady(): boolean { return false }`, `requestPushPermission(): Promise<boolean> { return false }`, `onForegroundNotification` returns a no-op unsubscribe.
- `mingla-business/src/hooks/usePushPermissionMoment.web.ts` — `export function usePushPermissionMoment(...): void {}` (empty).
- **No web-push fallback exists** — zero hits for `serviceWorker` / `PushManager` / `OneSignalSDKWorker` / `Notification.requestPermission` across `src`/`app`/`public`. The business **web** build cannot receive push at all.

> ⚠️ **Precision caveat.** The in-app **notification centre** (`BusinessNotificationsScreen`) *does* work on web — only **delivery** is native-only. Copy must say *"get push alerts"*, never *"see your notifications"*.

### Verified claim 3 — video cover trimming (DEGRADED, not absent) — available if Seth prefers it
- `coverPickerVideoTrimEditor.native.ts` → `react-native-video-trim` TurboModule; `coverPickerVideoTrimEditor.web.ts:17-20` → `Promise.resolve(null)` (no trim).
- `src/components/ui/CoverPicker.tsx:1230-1234` already ships: *"On the web, video covers upload the clip as-is… To trim a longer clip, use the Mingla Business app."*
- **Not used in the proposed copy** — it is a degradation, not an absence, and it is a weaker owner motivator than the door queue. Offered as an OQ-1 alternative.

### Claims deliberately NOT made (invention guard)
- **No specific push *type*** ("sales alerts", "new booking alerts") — grep found no business-side push-type constant proving a named alert. The note says "push alerts", which is proven.
- **No "the app does everything web does, plus more"** — this is **FALSE**, and the SPEC must say so plainly. Several things run the **other way**: Stripe **Connect onboarding / payouts setup is WEB-ONLY** (`app/connect-onboarding.tsx:5-11` renders `NativeConnectWebOnlyFallback` — *"Stripe onboarding runs in Mingla's hosted web page"*; the five `Connect*Body.web.tsx` files have **no** native counterparts). Also web-only: the guest-gate QR display (`GateQr.tsx` native is `() => null`), the ⌘K command palette, and the split-pane composer canvas. The proposed `moreNote` claims only that *specific things* are app-only and that everything else *also* works on web — both true. **Do not escalate it into app-superiority.**
- **Do NOT claim** camera photo capture (at parity — mobile browsers open the camera via `capture: "environment"`), CSV export (web is *better* — real Blob download vs native `Share.share()`), door sales, or sharing. **No biometrics/contacts exist anywhere** — zero hits for `expo-local-authentication` / `expo-contacts`.

### Proposed copy (implementor: use verbatim, exported as constants)

```ts
export const BUSINESS_APP_CHOICE_COPY = {
  download: 'Download the app',
  useWeb: 'Use on web',
  // Phone (ios | android) — both actions are live.
  moreNote:
    'The app does more: scan tickets at the door and get push alerts. Everything else works on the web too.',
  // Desktop / unknown — nothing to install here.
  desktopNote:
    'The app is on iPhone and Android — scan tickets at the door, get push alerts. On a computer, use the web dashboard.',
} as const
```

**Copy rationale:** "scan tickets at the door" is the single concrete thing web genuinely cannot do, it is the owner's highest-stakes moment (a queue at the door), and Mingla's own web build already concedes it. "Everything else works on the web too" mirrors the shipped scanner-web line ("You can manage everything else… here on the web") so marketing and product do not contradict.

**Open question OQ-1 (§11):** Seth may want different wording. Copy is cheap to change; the *structure* (2 actions + 1 note) is the contract.

---

## 6. Layered specification

> No DB, no RLS, no realtime, no service/hook layers are touched. Layers below are the ones this change genuinely reaches.

### 6.1 SSOT — `mingla-marketing/lib/store-links.ts` (MODIFY)

**Retire the stale comment at `:10-14`** and add the business Play const. Live value proven at `mingla-business/app/accept-brand-invitation/success.tsx:50-51`.

```ts
// ORCH-1381 — the business Play listing is LIVE (production versionCode 33 /
// 1.1.2, status=completed, HTTP 200 — API-verified 2026-07-15, COMMS-0101).
// Business Android installs go to the PLAIN Play URL — NOT minglabiz.onelink.me,
// which is DEAD on Android (AppsFlyer app status Pending, COMMS-0101), and NEVER
// go.usemingla.com (consumer-owned OneLink, ORCH-1346).
export const BUSINESS_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'
```

The `:10-14` block must be rewritten to state: iOS → business App Store, **Android → business Play**, desktop/other → business web. The phrase "Google Play still in review — no Play listing yet" **must not survive** (a test asserts its absence — §9 T-9).

**1342 SAFETY (verified, no gate change):** `orch-1342-store-links-ssot.mjs:44-50` `parseConst` builds `export\s+const\s+PLAY_STORE_URL\s*(?::[^=]+)?=…`. Inside `export const BUSINESS_PLAY_STORE_URL` the regex needs whitespace + literal `PLAY_STORE_URL` after `const`; it gets `BUSINESS_…` → **no match**. `exec` returns the first (real) match at `:7`. The 1342 BAN list only scans paths starting with `mingla-business/` (`:107`) and skips `MARKETING_SSOT` (`:106`) → the new `play.google.com` literal in the marketing SSOT is **not** in scan scope. **1342 stays green unamended** — pinned by a new self-test case (§8 C-4).

### 6.2 NEW shared decision helper — `mingla-marketing/lib/business-app-target.ts` (CREATE)

React-free and pure, so it is importable by a Server Component (`/business/download`), three Client Components, and a plain `tsc+node` test. **This module is the ONLY place the business platform→destination decision exists.**

```ts
import type { Platform } from './device-platform'
import {
  BUSINESS_APP_STORE_URL,
  BUSINESS_PLAY_STORE_URL,
  BUSINESS_WEB_URL,
} from './store-links'

export type BusinessInstallStore = 'app_store' | 'play'
export type BusinessActionStore = BusinessInstallStore | 'business_web'

export interface BusinessAppTarget {
  /** Where "Download the app" points. `null` on desktop/unknown — nothing to install. */
  installHref: string | null
  /** Analytics label for the install action; `null` when there is no install action. */
  installStore: BusinessInstallStore | null
  /** Where "Use on web" points. ALWAYS present — every device can use the web. */
  webHref: string
  /** True iff the device can install a native business app (ios | android). */
  canInstall: boolean
}

export function resolveBusinessAppTarget(platform: Platform): BusinessAppTarget
export const BUSINESS_APP_CHOICE_COPY = { /* §5 */ } as const
```

**Behavioural contract (exhaustive over the 3-way `Platform`):**

| `platform` | `installHref` | `installStore` | `webHref` | `canInstall` |
|---|---|---|---|---|
| `'ios'` | `BUSINESS_APP_STORE_URL` | `'app_store'` | `BUSINESS_WEB_URL` | `true` |
| `'android'` | `BUSINESS_PLAY_STORE_URL` | `'play'` | `BUSINESS_WEB_URL` | `true` |
| `'other'` | `null` | `null` | `BUSINESS_WEB_URL` | `false` |

**HARD:** `'android'` must **never** resolve `installHref` to `BUSINESS_WEB_URL`. That is the exact bug ORCH-1381 kills, and it is the assertion that fails on revert (§9 T-1, §10 gate E).

**Implementation must branch on `platform === 'ios'` / `platform === 'android'` explicitly** (the amended gates assert both tokens). No `minglabiz.onelink.me`, no `go.usemingla.com` — banned by gate E.

### 6.3 The inline choice UI contract (all 4 surfaces)

**Universal rules (every surface):**
- **U-1** — When `canInstall` is `true`, render **exactly two** actions: "Download the app" (primary weight) then "Use on web" (secondary/ghost weight), in that order, plus `moreNote`.
- **U-2** — When `canInstall` is `false` (desktop/unknown/bot), render **exactly one** action: "Use on web", plus `desktopNote`. **No dead install button.** No QR (banned on the business route by the 1326 gate; ORCH-1324's standing decision is business desktop → web).
- **U-3** — Labels + note come **only** from `BUSINESS_APP_CHOICE_COPY`. No inline string literals.
- **U-4** — Both actions are ≥44px tap targets and keyboard-activatable (WCAG AA, I-38/I-39).
- **U-5** — Analytics: **one** event `get_the_app_clicked`, existing prop schema **plus a new `action` prop**:
  - Download → `{ action: 'download', platform, store: installStore, surface: 'organiser', location }`
  - Use on web → `{ action: 'use_web', platform, store: 'business_web', surface: 'organiser', location }`
  - The `action` prop is **required** — without it an Android owner who *chooses* web is indistinguishable from today's forced-web, and the fix becomes unmeasurable.

**Per-surface:**

| Surface | File | `location` | Presentation |
|---|---|---|---|
| Nav | `components/marketing/glass-nav.tsx:76-88` (handler), `:149-156` (JSX) | `'nav'` | Two compact glass pills side-by-side in the header row. The `md:hidden` SurfaceToggle already frees width at `:140`. `canInstall === false` → the single existing pill, relabelled `useWeb`. **Note is omitted in the nav** (no room; nav is a shortcut, and the hero/links/download surfaces carry the note) — see OQ-2. |
| Hero | `components/sections/organiser-home/hero.tsx:31-43` (handler), `:104-110` (JSX) | `'hero'` | Two buttons in a row (stacking to column below `sm`). **Replace the stale `:108-110` line** "On iPhone now — or get started on the web." with `moreNote`/`desktopNote`. |
| /links business tab | `components/marketing/links-experience.tsx:171-214` (handler), `:356-361` (JSX) | n/a — fires `links_page_cta_clicked` | Two buttons in **one flex row** + a single-line note. **See VIEWPORT CONSTRAINT below.** |
| /business/download | `app/business/download/page.tsx:26-33` | n/a — server-rendered page | **No longer redirects.** Server Component renders both destinations as plain `<a>`. |

**VIEWPORT CONSTRAINT (`/links`) — HARD:** `links-experience.tsx:6-11` declares a **SNAPSHOT CONTRACT**: *"the whole page fits in ONE viewport and NEVER scrolls"* — `100dvh` root with `overflow-hidden`, sized for ~667px phones. Adding a button + note to the business tab **can clip the socials row**. Mitigations, in order:
1. Render the two buttons **side-by-side in one row** (+~0px height), not stacked.
2. Trim the business tab `body` at `lib/links-config.ts:74` — *"Now on iPhone — or get started on the web."* is **stale anyway** (it is the same falsehood) and must change. Replacing it with a shorter line buys the note's height.
3. The note replaces, rather than adds to, that trailing sentence.

This is **not** currently CI-gated (`orch-1327-*` covers only the tab pill), so it is enforced by **SC-6** + the tester's 667px check. **Do not let /links scroll.**

**`/business/download` Server-Component contract (the CI-tightest surface):**
```
const ua = (await headers()).get('user-agent') ?? ''
const platform = resolvePlatformFromUa(ua)      // gate-required token
const target = resolveBusinessAppTarget(platform)
// render: target.canInstall ? [<a href={target.installHref}>download</a>,
//                             <a href={target.webHref}>useWeb</a>, moreNote]
//                           : [<a href={target.webHref}>useWeb</a>, desktopNote]
```
- **Plain `<a>` only** — no `window`, no `navigator`, no `<form>`, no `'use client'`. This is what keeps the 1326 bans green.
- `export const dynamic = 'force-dynamic'` **stays** (reads headers).
- The `redirect` import from `next/navigation` is **removed** (see §10 gate A2).
- **iOS is no longer auto-redirected.** Seth's contract is that *every* business get-app surface presents two actions; auto-redirecting iOS would deny the choice to exactly the users arriving from the invite email on an iPhone.
- `metadata.description` at `:22-23` ("Get the Mingla Business app on iPhone, or run it in your browser.") is **stale** → must name Android.

### 6.4 Email — `supabase/functions/invite-brand-member/index.ts` (MODIFY, copy only)

**HARD — do not touch the href.** `__tests__/orch-1329-invite-email.tester.test.ts:191-224` pins `<a href="https://usemingla.com/business/download"` **byte-exactly** and asserts `!html.includes("business/download?")`. **No query string. No token. No UTM.** Copy changes only.

Both `:281` **and** `:282` currently assert the falsehood:
- `:281` (partnerSetup): *"…iPhone opens the App Store, everywhere else opens your dashboard on the web."*
- `:282` (default): *"…iPhone opens the App Store, everywhere else opens the web."*

Proposed replacements (`:280-282`, `secondarySub`):
- partnerSetup → `"Get the Mingla Business app on iPhone or Android — or open your dashboard on the web."`
- default → `"The Mingla Business app is where you'll do the work — scan guests in, check sales, run events. Get it on iPhone or Android, or open the web dashboard."`

> The default variant's existing "scan guests in, check sales, run events" claim is **retained and verified** (§5 claim 1 proves scanning is real and native-only).

Also update the stale comment at `:274-276` ("The href is a STATIC LITERAL → the `/business/download` route 307-redirects by User-Agent (iPhone → business App Store, else → business web dashboard)") — the route no longer 307s; it renders a choice.

---

## 7. Success criteria

Numbered, observable, testable. Per-surface where parity is manual.

| ID | Criterion |
|---|---|
| **SC-1-Android-Nav** | On the business marketing site from an Android phone, the nav shows **two** actions. Tapping "Download the app" opens `https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness`. It **never** opens `business.usemingla.com`. |
| **SC-1-Android-Hero** | Same, from the organiser hero. |
| **SC-1-Android-Links** | Same, from the `/links` Business tab. |
| **SC-1-Android-Download** | `GET https://usemingla.com/business/download` with an Android UA returns **HTTP 200 HTML** (not 307), containing an `<a href>` to the business Play URL **and** an `<a href>` to `https://business.usemingla.com`. |
| **SC-2-iOS-{Nav,Hero,Links,Download}** | Same four surfaces on iOS: "Download the app" → `https://apps.apple.com/app/id6768737367`; "Use on web" → `https://business.usemingla.com`. `/business/download` returns 200 HTML, **not** a 307 to the App Store. |
| **SC-3-Web-Action** | On iOS **and** Android, on all 4 surfaces, "Use on web" opens `https://business.usemingla.com`. |
| **SC-4-Desktop** | On desktop (and unknown-UA/bot), all 4 surfaces render **exactly one** action ("Use on web" → `BUSINESS_WEB_URL`) + `desktopNote`. **No** install button. **No** QR panel. `/business/download` returns 200 HTML with one `<a>`. |
| **SC-5-Note** | On iOS/Android surfaces (nav excepted per §6.3) the note reads exactly `BUSINESS_APP_CHOICE_COPY.moreNote`; on desktop exactly `desktopNote`. |
| **SC-6-Links-NoScroll** | At 375×667 the `/links` Business tab shows wordmark + tabs + heading + body + **both** CTAs + note + socials with **no vertical scroll** and no clipping (snapshot contract, `links-experience.tsx:6-11`). |
| **SC-7-Analytics** | Every action fires `get_the_app_clicked` carrying `action` (`'download'` \| `'use_web'`), `platform`, `store`, `surface: 'organiser'`, `location`. `/links` fires `links_page_cta_clicked` with the same `action` discriminator. |
| **SC-8-Email-Href** | The invite email's secondary CTA href is **byte-exactly** `https://usemingla.com/business/download` — no query string, no token. |
| **SC-9-Email-Copy** | Neither email variant claims "everywhere else opens the web"/"opens your dashboard on the web". Both name **iPhone or Android**. |
| **SC-10-No-OneLink** | No business surface references `minglabiz.onelink.me` or `go.usemingla.com`. |
| **SC-11-SSOT** | No `apps.apple.com` / `play.google.com` literal exists outside `lib/store-links.ts` in the touched marketing files. |
| **SC-12-Consumer-Untouched** | Consumer `/download` still 307s device-aware; the explorer nav QR panel still opens on desktop; `app-mobile/**` byte-unchanged. |
| **SC-13-Popup-Fallback** | On the 3 client surfaces, a blocked `window.open` still navigates via `window.location.assign` — no dead tap on either action. |

---

## 8. Invariants

### New (DRAFT — orchestrator flips ACTIVE at CLOSE)
**`I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE`** — Every business get-app surface presents an explicit inline choice: an intelligent "Download the app" (iOS → `BUSINESS_APP_STORE_URL`, Android → `BUSINESS_PLAY_STORE_URL`) **and** "Use on web" (→ `BUSINESS_WEB_URL`), plus an app-does-more note; desktop/unknown renders web-only. The platform→destination decision exists **only** in `lib/business-app-target.ts`. Business Android **never** resolves to `BUSINESS_WEB_URL` as its install target, and **never** routes through `minglabiz.onelink.me` or `go.usemingla.com`.
- *Preserved by:* §6.2 helper + §10 gate E. *Verified by:* T-1 (fails-on-revert).

### Amended (currently **ACTIVE** — this is a registry amendment, not a DRAFT tweak)
| Invariant | Status | Amendment |
|---|---|---|
| `I-PROPOSED-1324-BUSINESS-GETAPP-DEVICE-AWARE` | **ACTIVE** (ORCH-1324 CLOSE 2026-07-09, PR #806) | Clause "Android + desktop/other → the business web app" is **superseded**: Android → Play; desktop/other → web. The G-b adversarial ("FAIL if `BUSINESS_WEB_URL` absent → non-iOS stranded") **inverts** to "FAIL if Android resolves to `BUSINESS_WEB_URL`". |
| `I-PROPOSED-1326-LINKS-BUSINESS-DOWNLOAD-DEVICE-AWARE` | **ACTIVE** (ORCH-1326 CLOSE 2026-07-09, PR #809) | `/business/download` is no longer a **redirect** route — it renders an inline choice. The `redirect(` requirement and the `PLAY_STORE_URL` ban rationale ("business Android → web, never Play") are **superseded**. |
| `I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE` | **ACTIVE** (ORCH-1328 CLOSE 2026-07-09, PR #811) | Const-presence requirement narrows: `BUSINESS_APP_STORE_URL`/`BUSINESS_WEB_URL` move behind the shared helper. Client-side-open + no-soft-nav clauses **unchanged**. |
| `I-PROPOSED-1342-STORE-LINKS-SSOT` | **ACTIVE** | **No amendment.** Proven safe in §6.1; pinned by new self-test C-4. |

> **Implementor: you do NOT flip these.** Record the amendments in the CLOSE handoff; the orchestrator owns `INVARIANT_REGISTRY.md`.

### Preserved
- WCAG AA kit I-38/I-39 (≥44pt targets, labels) — U-4.
- The `/links` snapshot contract (`links-experience.tsx:6-11`) — SC-6.
- ORCH-1346 one-branded-domain-one-template — SC-10.

---

## 9. Test cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| **T-1** ⭐ | **Regression guard (fails-on-revert)** — `resolveBusinessAppTarget('android')` | `'android'` | `installHref === BUSINESS_PLAY_STORE_URL`, `installStore === 'play'`, `canInstall === true`, `installHref !== BUSINESS_WEB_URL` | lib (real import) |
| T-2 | iOS decision | `'ios'` | `installHref === BUSINESS_APP_STORE_URL`, `installStore === 'app_store'`, `canInstall === true` | lib |
| T-3 | Desktop decision | `'other'` | `installHref === null`, `installStore === null`, `canInstall === false`, `webHref === BUSINESS_WEB_URL` | lib |
| T-4 | Web action always available | each of `'ios' \| 'android' \| 'other'` | `webHref === BUSINESS_WEB_URL` in all 3 | lib |
| T-5 | No wrong package | module source | `BUSINESS_PLAY_STORE_URL` contains `com.sethogieva.minglabusiness`; does **NOT** contain `com.mingla.app.v2` (consumer package) | lib |
| T-6 | No dead OneLink | module source | contains neither `minglabiz.onelink.me` nor `go.usemingla.com` | lib |
| T-7 | Route renders both | `/business/download` source | contains `resolveBusinessAppTarget`, `headers(`, `resolvePlatformFromUa`; contains **no** `redirect(`, `window`, `navigator`, `<form` | route |
| T-8 | Route SSOT | `/business/download` source | no `apps.apple.com` / `business.usemingla.com` / `play.google.com` literal | route |
| T-9 | Stale comment retired | `lib/store-links.ts` | does **not** contain `still in review` or `no Play listing yet` | lib |
| T-10 | Email href unchanged | `renderInviteEmail(...)` | `html` includes `<a href="https://usemingla.com/business/download"`; `!html.includes('business/download?')` | edge (existing test, keep byte-identical) |
| T-11 | Email copy truthful | `renderInviteEmail(...)` both variants | `html` does **not** include `everywhere else opens`; **does** include `iPhone or Android` | edge |
| T-12 | Collapsed ternary gone | all 4 CTA sources | none contains `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` | marketing |
| T-13 | Consumer untouched | `app/download/page.tsx`, explorer nav branch | still redirect-based; `AppQrPanel`/`setQrOpen` still present in glass-nav | marketing |
| T-14 | /links no-scroll | 375×667 viewport, Business tab | `scrollHeight <= clientHeight`; socials row visible | runtime |

⭐ **T-1 is the mandated happy-path regression test.** File: `mingla-marketing/lib/__tests__/business-app-target.test.ts`. It **imports the real `resolveBusinessAppTarget`** (not a source grep), so it exercises the real path. **Fails-on-revert proof:** reverting §6.2 so Android returns `BUSINESS_WEB_URL` makes T-1 throw; restoring it passes. Run via the repo `tsc+node` pattern from `mingla-marketing/`:
```
npx tsc lib/__tests__/business-app-target.test.ts --outDir /tmp/o --module commonjs \
  --target es2020 --moduleResolution node && node /tmp/o/business-app-target.test.js
```
Protective comment required at the top: *"ORCH-1381 — business Android MUST resolve to the LIVE Play listing, never the web app. Reverting to the ORCH-1324 `platform === 'ios' ? APP_STORE : WEB` ternary silently denies every Android owner the app (the business Play listing went live 2026-07-15 — COMMS-0101). This test fails on that revert. Do not relax it."*

### Test locks that MUST be rewritten (they currently pin Android→web)

| File | Lines | Rewrite |
|---|---|---|
| `app/business/download/__tests__/business-download-route.tester.test.ts` | `:53-56` | Keep the `apps.apple.com` / `business.usemingla.com` absence asserts. **Replace** `BUSINESS_APP_STORE_URL`/`BUSINESS_WEB_URL` presence with `resolveBusinessAppTarget` presence. |
| ″ | `:60-65` | **Invert.** `assert(!/PLAY_STORE_URL/)` currently forbids Play entirely → becomes `assert(!/\bPLAY_STORE_URL\b/)` (no *consumer* Play) **and** `assert(/resolveBusinessAppTarget/)`. |
| ″ | `:74-91` | **Delete** the three redirect asserts (`platform === 'ios')\s*redirect\(BUSINESS_APP_STORE_URL\)` etc.). **Replace** with: no `redirect(`; renders `<a`; both `target.installHref` and `target.webHref` referenced; branches on `canInstall`. |
| ″ | `:66-73` | **Keep verbatim** — the `navigator`/`window` SSR-safety asserts still hold and are load-bearing. |
| `components/marketing/__tests__/business-getapp-cta.tester.test.ts` | `:103-137` | **Invert both (b) blocks.** The asserted-present ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` becomes an **asserted-ABSENT** token (it is now the bug). Assert instead: `resolveBusinessAppTarget(` present, `BUSINESS_APP_CHOICE_COPY` present, `action: 'download'` + `action: 'use_web'` present. |
| ″ | `:85-102`, `:138-166` | **Keep** — beta-funnel absence + QR-panel-absence + explorer-scoping sanity all still hold. |
| `components/marketing/__tests__/business-getapp-cta.test.ts` | `:51-95`, `:100-121` | Happy path. Replace ternary asserts with helper + copy-const + `action` asserts. **Keep** `detectClientPlatform()`, `get_the_app_clicked`, `surface: 'organiser'`, `location: 'nav'`/`'hero'`, `window.location.assign(`. `:95` asserts the label `Get the app` → **update** to `BUSINESS_APP_CHOICE_COPY`. |
| `components/marketing/__tests__/links-cta-device-aware.tester.test.ts` | `:68-75` | Same inversion: the business-branch ternary asserted-present → asserted-absent; assert `resolveBusinessAppTarget(` instead. |
| ″ | `:52-63`, `:108-118` | **Keep** — no-soft-nav, no-store-literal, `<button type="button">`, `window.open`+`assign` fallback all still hold. |
| `components/marketing/__tests__/links-cta-device-aware.test.ts` | business branch | Same inversion. |
| `lib/links-config.tester.test.ts` | business tab | Update if it pins the stale `body` copy (§6.3 mitigation 2). |
| `supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts` | `:191-224` | **DO NOT WEAKEN.** The href pin + no-query asserts are the guard. **Add** T-11 (copy truthfulness) alongside. |

---

## 10. CI gate amendments (exact — PR cannot go green without these)

> **Every regex claim below was executed, not reasoned about** (node, 2026-07-15):
> ```
> /PLAY_STORE_URL/.test('BUSINESS_PLAY_STORE_URL')        → true   ← the trap is REAL
> /\bPLAY_STORE_URL\b/.test('BUSINESS_PLAY_STORE_URL')    → false  ← the fix works
> /\bPLAY_STORE_URL\b/.test('PLAY_STORE_URL')             → true   ← and still guards
> 1342 parseConst(marketing+BUSINESS_PLAY_STORE_URL, 'PLAY_STORE_URL')
>                     → 'https://play.google.com/…id=com.mingla.app.v2'  ← 1342 SAFE, no amendment
> 1328 /\bBUSINESS_APP_STORE_URL\b/ + /\bBUSINESS_WEB_URL\b/ over a helper-form file
>                     → false, false  ← C1 amendment is genuinely REQUIRED, not optional
> ```

### A. `.github/scripts/strict-grep/orch-1326-links-business-download-route.mjs`

| # | Line | Change |
|---|---|---|
| **A1** | `:63` | `{ re: /PLAY_STORE_URL/, why: "…business Android goes to the web app, never a Play listing" }` → **`{ re: /\bPLAY_STORE_URL\b/, why: "references the CONSUMER PLAY_STORE_URL — the business route must use BUSINESS_PLAY_STORE_URL via resolveBusinessAppTarget" }`**. ⚠️ **This is the trap.** The current regex is **unanchored** → `BUSINESS_PLAY_STORE_URL` substring-matches and fails the PR. `\b` does not match between `_` and `P` (both word chars), so `\bPLAY_STORE_URL\b` correctly ignores `BUSINESS_PLAY_STORE_URL`. |
| **A2** | `:96-98` | **DELETE** the `if (!/redirect\(/.test(src))` requirement. The page no longer redirects. **REPLACE** with:<br>`if (!/<a[\s>]/.test(src)) failures.push(`${ROUTE}: must render the choice as plain <a> anchors (no redirect, no client JS).`)` |
| **A3** | `:78-93` | `hasStore`/`hasWeb` const checks → **REPLACE** with `if (!/resolveBusinessAppTarget\(/.test(src)) failures.push(…)`. The consts now live in the helper; requiring them here would re-create the triplication. |
| **A4** | `:99-104` | `platform ===` requirement → **REPLACE** with `if (!/canInstall/.test(src)) failures.push(`${ROUTE}: must branch on target.canInstall — desktop has no install action (G-b).`)`. Keep `resolvePlatformFromUa` + `headers(` requirements at `:70-76` **unchanged**. |
| **A5** | `:86-93` | The G-b comment + failure text ("BUSINESS_WEB_URL is absent — non-iOS stranded / everyone → App Store") is **now the opposite of the truth**. Rewrite G-b as: FAIL if the route contains the collapsed ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL`. |
| **A6** | `:1-36`, `:224-239` | Header docblock + PASS/FAIL messages still describe a redirect route with "NO Play". Rewrite to the ORCH-1381 contract. |
| **A7** | `:130-204` | Self-test fixtures: `goodRoute` (`:135-147`) is the **old redirect page** → replace with the new inline-choice fixture. `:182-183` (`route references PLAY_STORE_URL → fire`) asserts the **old** rule → replace with: `BUSINESS_PLAY_STORE_URL` → **pass**; bare `PLAY_STORE_URL` → **fire**. `:177-179` (missing `BUSINESS_WEB_URL` → fire) → replace with: collapsed ternary → fire. Update the `11/11` count at `:202`. |

### B. `.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs`

| # | Line | Change |
|---|---|---|
| **B1** | `:72-88` | `BUSINESS_APP_STORE_URL`/`BUSINESS_WEB_URL` presence → **REPLACE** with `resolveBusinessAppTarget\(` **and** `BUSINESS_APP_CHOICE_COPY` presence (proves the inline choice is wired from the shared module). |
| **B2** | `:98-104` | `platform ===` requirement → **REPLACE** with: require **both** `action: 'download'` and `action: 'use_web'` (proves two actions exist, not one). |
| **B3** | `:81-88` (G-b) | **INVERT.** Add to `BANNED`: `{ re: /platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/, why: "the ORCH-1324 collapsed ternary — sends every Android owner to the web app instead of the LIVE business Play listing (ORCH-1381)" }`. **This is the fails-on-revert teeth.** |
| **B4** | `:91-96`, `:106-126` | **KEEP unchanged** — `detectClientPlatform()`, `get_the_app_clicked`, `surface: 'organiser'`, `window.location.assign(`. |
| **B5** | `:58-67` | **KEEP** the whole beta-funnel BAN list. |
| **B6** | `:145-206` | Self-test: `good` fixture (`:145-160`) carries the now-banned ternary → **rewrite** to the helper form. `:164-165` (missing `BUSINESS_WEB_URL` → fire) is obsolete → replace with: collapsed ternary → fire. Update the `11/11` count at `:213`. |

### C. `.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs`

| # | Line | Change |
|---|---|---|
| **C1** | `:52-57` | `REQUIRED_CONSTS` → **drop** `\\bBUSINESS_APP_STORE_URL\\b` and `\\bBUSINESS_WEB_URL\\b`. **Keep** `\\bAPP_STORE_URL\\b` + `\\bPLAY_STORE_URL\\b` (the **explorer** tab still resolves them locally and is out of scope). |
| **C2** | `:69-89` | **ADD** `if (!/resolveBusinessAppTarget\(/.test(src))` → fail. The business branch must delegate. |
| **C3** | `:92-118`, `:60-67` | **KEEP unchanged** — `<button`, `onClick={() => onCtaClick(`, `window.open(`, `window.location.assign(`, `links_page_cta_clicked`, `platform ===`, and the whole BAN list (no-soft-nav / no store literals). ✅ **`onClick={() => onCtaClick(` still matches** if the handler signature widens to `onCtaClick(tab, action?)` — the explorer CTA keeps calling `onCtaClick(activeTab)`. Design to that signature and C3 needs no change. |
| **C4** | `:133-202` | Self-test: update `good` fixture's business branch to the helper form; keep every other case. |

### D. `.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs` — **NO AMENDMENT NEEDED** ✅
Proven safe in §6.1. **But add one self-test case** pinning that safety (cheap, prevents a future footgun):
```
// BUSINESS_PLAY_STORE_URL in the marketing SSOT must not shadow PLAY_STORE_URL's parse.
const withBusiness = { ...good, [MARKETING_SSOT]: marketingFix +
  "\nexport const BUSINESS_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.sethogieva.minglabusiness'\n" };
if (run(withBusiness).length !== 0) selfFailures.push("BUSINESS_PLAY_STORE_URL wrongly broke the PLAY_STORE_URL byte-compare");
```
Bump the `10/10` count at `:245`.

### E. NEW `.github/scripts/strict-grep/orch-1381-business-getapp-android-choice.mjs`
Registers `I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE`. Must `--self-test` and fail-on-revert.

Over `mingla-marketing/lib/business-app-target.ts` (comment-stripped) **REQUIRE**:
1. `BUSINESS_APP_STORE_URL`, `BUSINESS_PLAY_STORE_URL`, `BUSINESS_WEB_URL` all referenced.
2. `platform === 'ios'` **and** `platform === 'android'` (both branches explicit).
3. `canInstall`.

**BAN** (over the helper **and** all 4 CTA surfaces):
4. `/platform === 'ios' \? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL/` — the ORCH-1324 collapsed ternary (**the bug**).
5. `/minglabiz\.onelink\.me/` — dead on Android (COMMS-0101).
6. `/go\.usemingla\.com/` — consumer-owned (ORCH-1346).

Over each of the 4 CTA surfaces **REQUIRE**: `resolveBusinessAppTarget\(` **and** `BUSINESS_APP_CHOICE_COPY`.

**G-b adversarial:** FAIL if `business-app-target.ts` maps android → `BUSINESS_WEB_URL` — regex `/'android'[^\n]*BUSINESS_WEB_URL/` and `/BUSINESS_WEB_URL[^\n]*'android'/` on the same line.

**Wire into `.github/workflows/strict-grep-mingla-business.yml`** as a new job (mirror the `orch-1326-links-business-download-route` job block at `:3413-3424`: `--self-test` step then live step) **and** add the invariant docblock line alongside `:175-179`.

---

## 11. Open questions

- **OQ-1 (copy — Seth):** §5 copy is proposed, not dictated. The two claims are code-proven; the wording is mine. Confirm or replace. A **third** proven claim is available if you want a different angle — video cover trimming is app-only (`CoverPicker.tsx:1230-1234` already says so). It is unused because it is a degradation, not an absence, and a door queue beats a video trim as an owner motivator.
- **OQ-2 (nav note — Seth):** the nav header has no room for the note without a popover (and a popover is not "inline"). **Proposal: nav renders the two actions without the note**; hero/links/download carry it. Confirm.
- **OQ-3 (desktop owner who wants the app):** desktop shows no install path at all (the 1326 gate bans QR on the business route; ORCH-1324 decided business desktop → web). A desktop owner who *wants* the app is told it exists but given no way to get it. **Accepted as-is** (inherits ORCH-1324's decision, and the marketing site is not where an owner installs a phone app). Flag if Seth disagrees — a QR would need the 1326 ban lifted.
- **OQ-4 (iPad-as-Mac, server-side):** `resolvePlatformFromUa` cannot see `maxTouchPoints`, so an iPadOS-13+ Safari hit on `/business/download` (**the invite-email landing**) resolves `'other'` → web-only, no install button. This is **pre-existing** (documented at `device-platform.ts:52-61`) and **not a regression** — today it already redirects to web. Not fixed here. Registered as D-4.

---

## 12. Future upgrade (NOT this ORCH)

Once the operator clicks **AppsFlyer → My Apps → Refresh Status** and an Android `curl` against `minglabiz.onelink.me/ZSCW` returns `301 → market://details/?id=com.sethogieva.minglabusiness&referrer=…`, `BUSINESS_PLAY_STORE_URL` becomes the seam for a one-line swap to the attributed business OneLink. **Do not attempt it now** — the OneLink is dead on Android (COMMS-0101) and would ship a broken install. Gate E ban #5 must be lifted in that ORCH.

---

## 13. Discoveries for the orchestrator (where the blast-radius map was wrong/incomplete)

| ID | Discovery |
|---|---|
| **D-1** | **`orch-1342-store-links-ssot.mjs:60-72` already predicted this ORCH.** Its `GRANDFATHERED` docblock says `accept-brand-invitation/success.tsx` *"carries the BUSINESS store listing URLs inline — predates this gate; **needs `BUSINESS_*` SSOT entries in a follow-up ORCH**."* ORCH-1381 creates `BUSINESS_PLAY_STORE_URL`, which makes that migration finally possible — but it lands in `mingla-business` (native, **no OTA path**), so it is **out of scope here**. Register as a follow-up ORCH. |
| **D-2** | **The map undercounted the ternary: it is 5 call sites, not 3.** nav `:78`, hero `:33`, links-experience `:178`, **plus** `/business/download/page.tsx:31-32` (the server variant) **and** `accept-brand-invitation/success.tsx:106-112` (the mingla-business variant, which is *already correct* — it offers both stores). The map's own §5 said "feed all five CTAs" while §3 said "three client CTAs" — both are right about different things; the SPEC treats it as **4 in-scope marketing surfaces + 1 out-of-scope native precedent**. |
| **D-3** | **`lib/device-platform.ts` needs NO change.** The map listed it as MUST-change #5. Re-read: `resolvePlatform`/`detectClientPlatform`/`resolvePlatformFromUa` already return the 3-way `'ios' \| 'android' \| 'other'` this ORCH needs. The Android branch already exists and is already correct — it is the **consumers** of it that throw Android away. Touching `device-platform.ts` risks the ORCH-1319 verbatim-extraction contract (`:1-7`) for zero gain. **Read-only; DO-NOT-TOUCH.** |
| **D-4** | **`/links` has an uncodified single-viewport no-scroll contract** (`links-experience.tsx:6-11`) that the map did not flag and **no CI gate protects**. Adding a button + note to the business tab can clip the socials row on a 667px phone. Handled by SC-6 + §6.3 mitigations. Candidate for its own invariant + gate later. |
| **D-5** | **Both email variants are false, not one.** The map cited `:279-282`; the falsehood is at **`:281` and `:282`** (partnerSetup *and* default). Also `:274-276`'s comment and `page.tsx:22-23`'s `metadata.description` are stale. |
| **D-6** | **The 1324/1326/1328 invariants are ACTIVE, not DRAFT** (registry `:5729`, `:5735`, `:151`). This ORCH **amends three ACTIVE invariants** — a heavier registry action than a DRAFT tweak. Orchestrator owns the flip at CLOSE. |
| **D-7** | **`links-config.ts:74`'s business-tab `body`** ("Now on iPhone — or get started on the web.") and **`hero.tsx:108-110`** ("On iPhone now — or get started on the web.") carry the **same falsehood** as the email. Both are in scope and must change. The map named neither. |
| **D-8** | **The app/web relationship runs BOTH ways — an "app does more" note must not become "app does everything".** Stripe **Connect onboarding / payouts setup is WEB-ONLY** (`app/connect-onboarding.tsx:5-11` → `NativeConnectWebOnlyFallback`; the five `Connect*Body.web.tsx` have no native counterpart), as are the guest-gate QR display, ⌘K palette, and split-pane composer. This is why the partner-setup invite email's **primary** CTA is *"Set up {brand} on the web →"* and why `accept-brand-invitation/success.tsx:135` sends owners to the web for banking. The §5 copy is scoped to specific app-only capabilities precisely to stay true. Guarded by §16 attack #11. |
| **D-9** | **Manual guest check-in is NOT platform-gated but is device-local only** (`guests/[guestId].tsx:310-331` → `scanStore`, AsyncStorage, `offlineQueued: true`, **no backend sync** — `scanStore.ts:10-15`, self-flagged `[TRANSITIONAL]`). Web owners can mark names off a local list that never reaches the server. Not in scope, but it is a real data-integrity gap on a paid surface and deserves its own ORCH. |

---

## 14. Implementation order

1. **`lib/store-links.ts`** — add `BUSINESS_PLAY_STORE_URL`; retire the `:10-14` stale comment. *(T-9)*
2. **`lib/business-app-target.ts`** — CREATE the helper + copy constants. *(§6.2)*
3. **`lib/__tests__/business-app-target.test.ts`** — CREATE T-1..T-6. **Prove fails-on-revert now, before touching any surface.**
4. **`app/business/download/page.tsx`** — de-redirect → inline choice (Server Component, plain `<a>`). *(T-7, T-8)*
5. **`components/marketing/glass-nav.tsx`** — organiser branch → two inline actions.
6. **`components/sections/organiser-home/hero.tsx`** — two inline actions; replace `:108-110`.
7. **`lib/links-config.ts`** — retire the stale business-tab `body` (buys /links height).
8. **`components/marketing/links-experience.tsx`** — business branch → two inline actions in one row + note. **Verify SC-6 at 375×667.**
9. **`supabase/functions/invite-brand-member/index.ts`** — copy at `:280-282` + comment `:274-276`. **HREF UNTOUCHED.**
10. **CI gates** — amend A, B, C; add D's self-test case; create E; wire E into the workflow yml.
11. **Rewrite the 4 behavioural test locks** per §9.
12. Run every gate `--self-test` **and** live. Run all rewritten tests.

---

## 15. Scoped allowlist + DO-NOT-TOUCH

### ALLOWLIST (the implementor may change ONLY these)
```
mingla-marketing/lib/store-links.ts                                   (MODIFY)
mingla-marketing/lib/business-app-target.ts                           (CREATE)
mingla-marketing/lib/__tests__/business-app-target.test.ts            (CREATE)
mingla-marketing/lib/links-config.ts                                  (MODIFY — body copy only)
mingla-marketing/lib/links-config.tester.test.ts                      (MODIFY — if it pins body)
mingla-marketing/app/business/download/page.tsx                       (MODIFY)
mingla-marketing/app/business/download/__tests__/business-download-route.tester.test.ts   (REWRITE)
mingla-marketing/components/marketing/glass-nav.tsx                   (MODIFY — organiser branch ONLY)
mingla-marketing/components/sections/organiser-home/hero.tsx          (MODIFY)
mingla-marketing/components/marketing/links-experience.tsx            (MODIFY — business branch ONLY)
mingla-marketing/components/marketing/__tests__/business-getapp-cta.test.ts          (REWRITE)
mingla-marketing/components/marketing/__tests__/business-getapp-cta.tester.test.ts   (REWRITE)
mingla-marketing/components/marketing/__tests__/links-cta-device-aware.test.ts       (REWRITE)
mingla-marketing/components/marketing/__tests__/links-cta-device-aware.tester.test.ts (REWRITE)
supabase/functions/invite-brand-member/index.ts                       (MODIFY — copy ONLY, lines ~274-282)
supabase/functions/invite-brand-member/__tests__/orch-1329-invite-email.tester.test.ts (ADD T-11 only)
.github/scripts/strict-grep/orch-1324-business-getapp-device-aware.mjs        (AMEND)
.github/scripts/strict-grep/orch-1326-links-business-download-route.mjs       (AMEND)
.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs    (AMEND)
.github/scripts/strict-grep/orch-1342-store-links-ssot.mjs                    (self-test case ONLY)
.github/scripts/strict-grep/orch-1381-business-getapp-android-choice.mjs      (CREATE)
.github/workflows/strict-grep-mingla-business.yml                     (ADD the 1381 job + invariant docline)
Mingla_Artifacts/specs/SPEC_ORCH-1381_BUSINESS_GETAPP_ANDROID_CHOICE.md       (this file)
```

### DO-NOT-TOUCH (stop-and-amend before touching ANY of these)
```
mingla-marketing/lib/device-platform.ts            ← D-3: read-only. ORCH-1319 verbatim-extraction contract.
mingla-marketing/app/download/page.tsx             ← consumer smart route
mingla-marketing/components/marketing/app-qr-panel.tsx  ← explorer desktop QR
glass-nav.tsx explorer branch (handleGetTheApp, :42-69, :157-171, :178-180)
links-experience.tsx explorer branch (:189-211)
app-mobile/**                                      ← consumer app
mingla-business/**                                 ← incl. accept-brand-invitation/success.tsx (D-1),
                                                     appsFlyerService.ts (ORCH-1346 debt),
                                                     src/constants/storeLinks.ts
DownloadMinglaCta, SeeWhosGoingGate, guestFunnelLink, GUEST_FUNNEL_ONELINK_URL
mingla-admin/**
Mingla_Artifacts/INVARIANT_REGISTRY.md, WORLD_MAP.md, DECISION_LOG.md,
MASTER_BUG_LIST.md, AGENT_HANDOFFS.md              ← orchestrator-owned; CLOSE only
The invite-email HREF (`https://usemingla.com/business/download`) — byte-frozen.
```

---

## 16. Adversarial angle for the tester

The implementor will prove the happy path. The tester must attack these:

1. **THE MONEY SHOT — live-fire the real bug.** `curl -sI -A 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' https://usemingla.com/business/download`. **Today: `307 → https://business.usemingla.com`. Required after: `200` HTML containing the Play href.** If it still 307s, the ORCH did nothing.
2. **Grep-proof is NOT enough.** Every existing test on these files is a **source grep**. A source grep passes if the token exists in a *comment* or a dead branch. Drive the real surfaces on a **real Android device** (physical-device-first) and confirm the Play listing actually opens.
3. **The revert test.** Re-introduce `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` in `business-app-target.ts` and confirm **T-1 throws** and **gate E fires**. If either stays green, the regression guard is decorative.
4. **The /links clip.** 375×667, Business tab. Does the socials row survive? Does the page scroll? SC-6 is the criterion the implementor is most likely to miss — it is a layout contract stated only in a **file header comment**, with no CI gate.
5. **Wrong-package check.** Assert the Play href is `com.sethogieva.minglabusiness`, **not** `com.mingla.app.v2`. The consumer package is one autocomplete away and both are `play.google.com/store/apps/details?id=…`. A wrong package ships owners the *consumer* app.
6. **Email end-to-end.** Trigger a real `invite-brand-member` send. Open on an **Android** mail client. Confirm: href has **no** query string (T-10), and landing shows the choice. Then open on iPhone — confirm it does **not** auto-jump to the App Store (that would mean the redirect survived).
7. **Consumer regression sweep.** `/download` must still 307 device-aware. Explorer nav on desktop must still open the QR panel. `git diff --stat app-mobile/` must be **empty**. This ORCH sits one import away from the consumer path.
8. **Desktop dead-button hunt.** Resize to desktop on all 4 surfaces: is there an install button with `href="null"` / `href=""` / `href="#"`? `canInstall === false` must render **no** install anchor at all — not a disabled or empty one.
9. **The `action` prop.** Fire both actions on Android; confirm PostHog receives `action: 'download'` **and** `action: 'use_web'`. Without it, Seth cannot tell whether Android owners actually want the app — which is the entire question this ORCH exists to answer.
10. **Bot/unknown UA.** `curl -A 'Googlebot/2.1'` and `curl -A ''` against `/business/download` → must render the desktop treatment, not crash and not 500.
11. **Copy-truth audit (D-8).** Read the shipped note on every surface and ask: *is this literally true?* Two traps: (a) it must **not** imply the app does everything web does — **Stripe Connect payouts setup is web-only**, so an owner told "the app does more" who then can't connect their bank in the app has been mis-sold; (b) it must say *"scan tickets"*, not *"check guests in"* — manual check-in **does** exist on web (D-9). If the implementor "improved" the copy, re-verify every claim against §5's evidence. Copy is the one thing here with no compiler.
12. **The note is not decoration — it is a claim.** SC-5 pins it byte-exactly to `BUSINESS_APP_CHOICE_COPY`. If any surface renders a hand-written variant instead of the constant, fail it: that is how a verified claim silently becomes an invented one.

---

## 17. Downstream routing

**Next → `mingla-implementor`.** Inputs: this SPEC + COMMS-0101. Worktree `~/Desktop/mingla-orchs/ORCH-1381-[business-getapp-android-choice]` on branch `ORCH-1381-business-getapp-android-choice`. Build §14 in order; §15 allowlist is binding — **stop-and-amend** before touching anything outside it. Prove T-1 fails-on-revert **before** touching any surface. Output: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-1381_BUSINESS_GETAPP_ANDROID_CHOICE.md`.

**Then → `mingla-tester`.** §16 is the attack list; §7 SC-1..SC-13 are the gates. Physical-Android-device evidence required for SC-1 (source-only reasoning caps at "suspected").

**Then → `mingla-orchestrator` CLOSE.** Flip `I-PROPOSED-1381-BUSINESS-GETAPP-ANDROID-CHOICE` → ACTIVE; **amend the three ACTIVE invariants** per §8 (D-6); register D-1 (business `BUSINESS_*` SSOT migration) and D-4 (/links no-scroll invariant) as follow-up ORCHs; resolve COMMS-0101. **The CLOSE commit MUST carry `[deploy]`** (touches `mingla-marketing/`).
