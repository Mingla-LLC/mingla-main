# ORCH-1378 [onelink-dead-on-business-web] — INVESTIGATION

**Issue:** #889 · **Dispatched by:** mingla-orchestrator (conductor) · **Skill:** mingla-forensics (INVESTIGATE)
**Date:** 2026-07-14 · **Worktree:** `~/Desktop/mingla-orchs/ORCH-1373-[accept-invite-infinite-loader]/` on `ORCH-1373-accept-invite-infinite-loader` (SHARED with a parallel ORCH-1377 agent — no git ops performed)
**Seed:** ORCH-1373 investigation §8 C-5 (`81b7cce80`)
**Confidence:** **PROVEN** (root cause: shipped-bundle + source + git-history + 3/3 independent runtime captures)

---

## 0. HEADLINE VERDICT (read this first)

> **Seth's chosen path IS achievable in this PR. Memory said otherwise; memory is stale.**

**Attribution-carrying download-on-business-web does NOT need a native build.** The download CTA is an
`<a href>` to a business OneLink; install attribution rides the **store redirect + the AppsFlyer SDK
already shipped in the store build** — not the artifact this PR produces. Three gates that memory
flagged as blockers are already cleared (business EAS AppsFlyer secrets provisioned; ORCH-1318
enabled both AF listeners; business 1.1.2 native builds are already in the store pipelines).

**One real blocker, and it is NOT code:** the business OneLink template is **dead on Android today**
— it serves AppsFlyer's *"The app you are looking for is unavailable"* page (live-verified). The
probable cause is a stale AppsFlyer app record, fixed by Seth clicking **Refresh Status** in the
dashboard (~1 minute). iOS works today.

**What genuinely does NOT ship in this PR:** *deferred deep-link continuity* — the invitee landing
back in the invite context after installing. That needs business-app code → a native build (business
cannot OTA, COMMS-0089). **But per the dispatch this leg fires for a *successful* invitee — the
membership is already granted server-side — so continuity is a nice-to-have, not correctness.**

| Capability | In this PR? | Gate |
|---|---|---|
| Fix the `subscribeOneLinkDeepLink` TypeError | **YES** | Web-only shim edit |
| Download CTA emitting a business OneLink | **YES** | Web-only; `minglabiz.onelink.me/ZSCW` |
| Install attribution — **iOS** | **YES** | Already live end-to-end |
| Install attribution — **Android** | **YES**, after a dashboard click | Seth: AF → My Apps → **Refresh Status** |
| Deferred deep-link continuity into the invite | **NO** | Business B2 routing → native build |

---

## 1. Symptom summary

| | |
|---|---|
| **Expected** | Business web loads clean; the AppsFlyer OneLink deep-link subscription either works or is a deliberate no-op. |
| **Actual** | `TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function` thrown as an unhandled promise rejection from the **root `_layout`** on **every** production business-web page load. No white-screen; the OneLink subscription is dead on web. |
| **Reproduction** | Always. 3/3 independent captures this investigation (+2/2 in ORCH-1373). |
| **Started** | ORCH-1318 (`6382c7617`, PR #803, 2026-07-07) — the commit that introduced `subscribeOneLinkDeepLink`. |

---

## 2. Investigation manifest

| # | File / probe | Layer | Why |
|---|---|---|---|
| 1 | `COMMS_LEDGER.md` (rows 52–90) | docs | Mandatory entry read; COMMS-0083 / 0090 / 0089 / 0097 are load-bearing |
| 2 | `Mingla_Artifacts/investigations/ORCH-1373-...-INVESTIGATION.md` §8 C-5 | docs | Dispatch seed |
| 3 | `mingla-business/src/services/appsFlyerService.web.ts` | code | The web resolution — prime suspect |
| 4 | `mingla-business/src/services/appsFlyerService.ts` | code | The native export contract to diff against |
| 5 | `mingla-business/app/_layout.tsx:60–75, 495–549, 640–660` | code | Import + call sites in the shared root layout |
| 6 | `mingla-business/src/constants/storeLinks.ts` | code | Download-CTA SSOT + the `minglabiz` rule |
| 7 | `mingla-business/tsconfig.json` | code | Why tsc never caught it |
| 8 | `mingla-business/app.json` | schema | Native domain claims + version |
| 9 | `mingla-business/eas.json` + `eas env:list production` | data | AF env provisioning (the memory-flagged gate) |
| 10 | Shipped bundle `_layout-5d9057…js` + `__common-618a…js` module 1121 | runtime | The actual deployed artifact |
| 11 | CDP capture ×3 (port 9375) | runtime | Independent live repro |
| 12 | AppsFlyer MCP: `get_onelink_templates`, `get_onelink_template_links`, `get_apps`, `get_app_settings`, `get_public_knowledge` | data | LIVE account state (read-only) |
| 13 | `curl` probes of `minglabiz.onelink.me/ZSCW`, `mingla.onelink.me/w36m`, `go.usemingla.com/w36m` | runtime | Live OneLink behavior per-platform |
| 14 | `Mingla_Artifacts/INVARIANT_REGISTRY.md` (ORCH-1313/1318 stanzas) | docs | Reconcile memory vs registry |

---

## 3. Q-scorecard

**Q1 — Why is `subscribeOneLinkDeepLink` not a function on web?**
**Verdict:** The web platform shim `appsFlyerService.web.ts` never exported it. Metro resolves
`../src/services/appsFlyerService` → `appsFlyerService.web.ts` on web; that module exports 6 no-ops
and `subscribeOneLinkDeepLink` is not among them → the import binding is `undefined` → calling it
throws. **PROVEN** (F-1) — shipped bundle module 1121 dumped verbatim.

**Q2 — Why did TypeScript / CI not catch it?**
**Verdict:** `tsc` performs no platform-extension resolution (`moduleSuffixes` unset in
`mingla-business/tsconfig.json`), so it resolves the import to `appsFlyerService.ts` — which *does*
export the symbol. The type-check is green while the web bundle is broken. No CI gate compares a
`.web.ts` shim's exports against its native pair. **PROVEN** (F-2).

**Q3 — Is this an isolated slip or a bug class?**
**Verdict:** A **class**. A sweep of all 36 `.web.*` shims found a second live instance:
`oneSignalService.web.ts` is missing `syncPushPermissionTag` + `canRequestPushPermission`.
`syncPushPermissionTag` is **runtime-proven to throw** on business web on every tab
background→foreground. **PROVEN** (F-3) — NEW COLLATERAL.

**Q4 — What can OneLink actually do on web?**
**Verdict:** OneLink's web role is **a URL that redirects to the store while registering a click**.
Attribution is completed by the **AppsFlyer SDK inside the app on first open** — AppsFlyer's own
docs: *"the timestamp of an app install is the first launch."* No web SDK is required for
install attribution. Smart Script / Smart Banners exist only to solve the *two-click* problem
(carrying an inbound **ad's** UTMs through a landing page) and are **paid features** — irrelevant
here because we mint our own `pid`. **PROVEN** (F-4, with doc URLs).

**Q5 — Does the download leg require the app to claim the domain (Universal Links / App Links)?**
**Verdict:** **No.** UL/AL only matter when the app is *already installed* (direct open). A user
without the app follows the OneLink in a browser → AppsFlyer 301s to the store. The business app's
mis-claim of consumer-owned `go.usemingla.com` (COMMS-0090) is therefore **irrelevant to this leg**.
**PROVEN** (F-5).

**Q6 — What is the LIVE OneLink / template / app state?**
**Verdict:** 2 templates. Consumer `redirection_profile` (**w36m**, `mingla.onelink.me`, 1 link,
Version 1) — fully working both platforms. Business `business_profile` (**ZSCW**,
`minglabiz.onelink.me`, **0 links, Version 0**) — **works on iOS, DEAD on Android**. 4 apps; business
Android `com.sethogieva.minglabusiness` is **🟡 Pending** with `Original Name: N/A`, last updated
2026-05-12 — despite its Play listing being live and public. **PROVEN** (F-6, F-7).

**Q7 — Is a native build required for attribution on this leg?**
**Verdict:** **NO — RULED OUT.** The app the invitee installs is whatever is live in the store, not
this PR's artifact. Business EAS `production` already has all three AF secrets; ORCH-1318 enabled
both listeners; 1.1.2 native builds are already in the store pipelines. Every memory-flagged gate is
cleared or in flight independently of this PR. **PROVEN** (F-8).

**Q8 — What is NOT achievable in this PR?**
**Verdict:** Deferred deep-link continuity. Business B1 treats `dest.kind === "download"` as an
**intentional no-op** (`_layout.tsx:531–532`); per-entity routing is B2, explicitly out of ORCH-1318
scope. Changing it is business-app code → native build (business cannot OTA — COMMS-0089).
**PROVEN** (F-9).

---

## 4. Findings

### F-1 — `appsFlyerService.web.ts` omits `subscribeOneLinkDeepLink` — **CONFIRMED ROOT CAUSE**

1. **Symptom** — `TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function` at
   `_layout-5d9057a4a40f96e3f448d9d0863541b8.js:1:3197` on every business-web load.
2. **Layer** — code (platform-shim export drift), confirmed at runtime.
3. **Probe**
   ```bash
   grep -n "^export " mingla-business/src/services/appsFlyerService.ts        # native: 9 exports
   cat    mingla-business/src/services/appsFlyerService.web.ts               # web:    6 exports
   curl -s https://business.usemingla.com/_expo/static/js/web/__common-618a230597b0b56546037bc2ab5d5ef1.js \
     | python3 -c "…anchor backward from '},1121,[' to the nearest '__d(function('…"
   git log --oneline --follow -- mingla-business/src/services/appsFlyerService.web.ts
   git log --oneline -S subscribeOneLinkDeepLink -- mingla-business/
   ```
4. **Evidence**

   Native module — `mingla-business/src/services/appsFlyerService.ts` (9 exports):
   ```
   138:export type BusinessOneLinkDestination =
   153:export function resolveBusinessOneLinkDestination(
   257:export function subscribeOneLinkDeepLink(     ← present natively
   280:export function initializeAppsFlyer(
   367:export function setAppsFlyerUserId(
   385:export function clearAppsFlyerUserId(
   407:export function registerAppsFlyerDevice(
   476:export function resetAppsFlyerDeviceCache(
   494:export function logAppsFlyerEvent(
   ```

   Web shim — `mingla-business/src/services/appsFlyerService.web.ts`, **complete file, 15 lines**:
   ```ts
   export function initializeAppsFlyer(): void {}
   export function setAppsFlyerUserId(_userId: string): void {}
   export function clearAppsFlyerUserId(): void {}
   export function registerAppsFlyerDevice(_userId: string): void {}
   export function resetAppsFlyerDeviceCache(): void {}
   export function logAppsFlyerEvent(
     _eventName: string,
     _eventValues: Record<string, string | number | boolean> = {},
   ): void {}
   ```
   → `subscribeOneLinkDeepLink` and `resolveBusinessOneLinkDestination` are **absent**.

   **The SHIPPED artifact.** Root-layout dep map resolves `P = r(_d[27])` → `"27":1121`. Module 1121
   in the production `__common` bundle, **verbatim**:
   ```js
   __d(function(g,r,i,a,m,e,d){"use strict";Object.defineProperty(e,'__esModule',{value:!0}),
   e.initializeAppsFlyer=function(){},e.setAppsFlyerUserId=function(n){},
   e.clearAppsFlyerUserId=function(){},e.registerAppsFlyerDevice=function(n){},
   e.resetAppsFlyerDeviceCache=function(){},e.logAppsFlyerEvent=function(n,t={}){}},1121,[]);
   ```
   Six no-ops. `subscribeOneLinkDeepLink` is not defined on the module → `P.subscribeOneLinkDeepLink`
   is `undefined`.

   The throw site, at the exact cited offset (`cut -c3150-3320`):
   ```
   lizeAppsFlyer)(),(0,P.subscribeOneLinkDeepLink)(e=>{e&&"referral"===e.kind&&f.default.setItem(z,e.referralCode)…
   ```

   Provenance:
   ```
   web shim created:  f65f43ca8  [deploy] ORCH-1085 mobile browser sign-in home (#385)   ← never touched since
   symbol introduced: 6382c7617  ORCH-1318: AppsFlyer OneLink deferred deep-linking (Phase 2) (#803)
   ```
5. **Mechanism** — ORCH-1318 added `subscribeOneLinkDeepLink` to the native service **and a call
   site in the shared root layout** (`_layout.tsx:518`, which runs on iOS, Android **and web**), but
   did not extend the pre-existing web shim. Metro's platform resolution picks `.web.ts` on web, so
   the import binding is `undefined`; invoking it inside the `void (async () => {…})()` at
   `_layout.tsx:478–534` throws → unhandled promise rejection. Nothing after `:518` inside that IIFE
   runs — but the subscribe call is the IIFE's last statement, so no *other* boot work is lost.
6. **Severity** — **CONFIRMED ROOT CAUSE**.

---

### F-2 — `tsc` cannot see the web shim; no gate compares the pair — **SECONDARY ROOT CAUSE (why it shipped)**

1. **Symptom** — a green type-check and a green CI on a bundle that throws on every production load.
2. **Layer** — code / build config.
3. **Probe** — `grep -n "moduleSuffixes\|customConditions\|moduleResolution" mingla-business/tsconfig.json`; `ls .github/scripts/strict-grep/ | grep -i "web\|shim\|parity"`.
4. **Evidence** — `moduleSuffixes` is **unset** (`mingla-business/tsconfig.json` extends
   `expo/tsconfig.base`; only `strict` + `paths` are set). Without it, `tsc` resolves
   `../src/services/appsFlyerService` → `appsFlyerService.ts`, which exports the symbol → no error.
   Metro, independently, resolves `.web.ts` for `platform=web`. The two resolvers disagree and
   nothing reconciles them. No gate in `.github/scripts/strict-grep/` compares a `.web.*` shim's
   export set to its native pair (the nearest neighbours —
   `i-proposed-1187-analytics-web-only-via-web-ts.mjs`, `orch-1318-onelink-wiring-business.mjs` —
   assert wiring/direction, not export parity).
5. **Mechanism** — a structural blind spot: every `.web.*` shim in the repo can silently drift from
   its native pair, and the drift is invisible until a user hits the code path in a browser.
6. **Severity** — **SECONDARY ROOT CAUSE**. This is the reason the class exists, and the natural
   home for the regression guard.

---

### F-3 — `oneSignalService.web.ts` has the SAME drift and throws at runtime — **CONFIRMED ROOT CAUSE (NEW COLLATERAL — not the dispatched bug)**

1. **Symptom** — `TypeError: (0 , M.syncPushPermissionTag) is not a function` on business web on
   every tab background→foreground.
2. **Layer** — code, confirmed at runtime.
3. **Probe** — export-drift sweep over all 36 `.web.*` shims (`/tmp/orch-1378/drift.mjs`), then a CDP
   capture that drives `document.visibilitychange` hidden→visible (`/tmp/orch-1378/capture2.mjs`).
4. **Evidence** — sweep:
   ```
   DRIFT: mingla-business/src/services/appsFlyerService.web.ts
      MISSING on web: resolveBusinessOneLinkDestination, subscribeOneLinkDeepLink
   DRIFT: mingla-business/src/services/oneSignalService.web.ts
      MISSING on web: canRequestPushPermission, syncPushPermissionTag
   ```
   Runtime, driving background→active:
   ```
   --- after load, before visibility toggle: 2 exception(s) ---
      TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function
      TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function
   --- after visibility toggle (background -> active): 3 exception(s) ---
      NEW: TypeError: (0 , M.syncPushPermissionTag) is not a function
   ```
   Call site: `mingla-business/app/_layout.tsx:82` (import) → `:654` `void syncPushPermissionTag();`
   inside the `AppState` `"active"` handler — the **same root layout**.
5. **Mechanism** — identical to F-1. It stayed hidden because react-native-web maps `AppState` to
   `visibilitychange`, which a plain page load never fires — so it needs a tab switch to surface.
   The sibling `canRequestPushPermission` is *shielded* by an unrelated stub
   (`usePushPermissionMoment.web.ts` no-ops the whole hook — bundle module 1112), so it never fires;
   that shielding is incidental, not designed.
6. **Severity** — **CONFIRMED ROOT CAUSE** of a second, distinct production error. **Flagged as NEW
   collateral — outside the ORCH-1378 dispatch scope.** See §9.

---

### F-4 — What OneLink can and cannot do on web — **CONFIRMED (product-load-bearing)**

1. **Symptom** — n/a (capability question).
2. **Layer** — docs (provider), corroborated by live runtime probes.
3. **Probe** — AppsFlyer MCP `get_public_knowledge` (official KB) + `WebFetch` of DevHub + live `curl`.
4. **Evidence** — official AppsFlyer documentation:

   - **Install attribution needs the mobile SDK, not a web SDK** — [Create deep linking and redirection links for your campaigns with OneLink](https://support.appsflyer.com/hc/en-us/articles/208874366-Create-deep-linking-and-redirection-links-for-your-campaigns-with-OneLink):
     > *"**For attribution:** The AppsFlyer SDK already installed in each of your mobile apps. If the SDK is not yet installed in your apps, it is still possible to create a working redirection link, but it will not be possible to measure installs in your dashboard, deep link, or deferred deep link."*
   - **Attribution completes at first launch** — [AppsFlyer attribution model](https://support.appsflyer.com/hc/en-us/articles/207447053-AppsFlyer-attribution-model):
     > *"An **install** is recorded and attributed after the user downloads and launches the app. This means that in AppsFlyer, the **timestamp of an app install is the first launch**."*
   - **Marketer-only for redirection; developers only for deep linking** — same article:
     > *"Only a marketer is required to create OneLink links with an experience that redirects users to app stores… To add deep linking and deferred deep linking functionality to links, both a marketer and Android/iOS developers are required."*
   - **Smart Script / Smart Banners are for the two-click problem and are PAID** — [Convert your mobile web visitors to app users](https://support.appsflyer.com/hc/en-us/articles/360001237818-Convert-your-mobile-web-visitors-to-app-users):
     > *"since there are two clicks (the first that directs to the web page and the second that directs from the web page to the app store), attribution and deep linking are problematic… **Note:** Smart Banners and OneLink Smart Script are available only with eligible paid subscription plans."*
   - **Smart Script consumes a template domain + template ID** — [OneLink Smart Script V2](https://dev.appsflyer.com/hc/docs/dl_smart_script_v2): *"Provide the OneLink template domain + template ID."*
   - **Basic OneLink is free** — [OneLink onboarding guide](https://support.appsflyer.com/hc/en-us/articles/27699299657617-OneLink-onboarding-guide): *"While basic OneLink setup is available on the free plans, most features require a paid AppsFlyer subscription plan."*

   **Live proof of the attribution mechanism** (consumer template, Android UA):
   ```
   https://mingla.onelink.me/w36m  → HTTP 301
     Location: market://details/?id=com.mingla.app.v2&referrer=af_tranid%3DMTY0MDg1NzQwOTE3NTczMDAwMDU%3D
   https://go.usemingla.com/w36m   → HTTP 301
     Location: market://details/?id=com.mingla.app.v2&referrer=af_tranid%3DMTIxNTU3MDY4Mzc2MTQ1NDM4NTg%3D
   ```
   That `referrer=af_tranid=…` **is** the Google Play Install Referrer carrying the AppsFlyer click
   ID into the install — the exact mechanism that ties a web click to an install, generated purely
   server-side by AppsFlyer with no web SDK involved.
5. **Mechanism** — for our leg the browser is a **pass-through**: page emits a OneLink URL → AF
   registers the click and 301s to the store with the referrer → user installs → the AF SDK in the
   app reports first-launch → AF matches install to click. Nothing in that chain is web-app code
   beyond the href. Smart Script would only matter if we needed to preserve an *inbound ad's* UTMs
   across our landing page; the invite leg mints its own `pid`, so it is not needed (and its paid
   gating does not bite).
6. **Severity** — **CONFIRMED** (capability established).

---

### F-5 — Universal Links / App Links are irrelevant to the download leg — **RULED OUT as a blocker**

1. **Symptom** — memory (COMMS-0090) frames the business `go.usemingla.com` mis-claim as blocking business OneLinks.
2. **Layer** — schema (native config) vs docs.
3. **Probe** — read `mingla-business/app.json`; `curl` the association files.
4. **Evidence** — `mingla-business/app.json` (v**1.1.2**) claims:
   ```
   ios.associatedDomains: ["applinks:business.usemingla.com", "applinks:go.usemingla.com"]
   android.intentFilters:  business.usemingla.com (autoVerify), go.usemingla.com (autoVerify), com.sethogieva.minglabusiness scheme
   ```
   — i.e. it claims consumer-owned `go.*` and does **not** claim `minglabiz.onelink.me`. Meanwhile
   `minglabiz.onelink.me` **already serves valid business association files**:
   ```
   /.well-known/assetlinks.json → HTTP 200, package_name com.sethogieva.minglabusiness, both SHA-256 fingerprints
   /.well-known/apple-app-site-association → HTTP 200
   ```
5. **Mechanism** — UL/AL exist so an **installed** app intercepts a URL instead of the browser. A
   user who does not have the app never exercises them: the browser opens the OneLink and AF
   redirects to the store. The `go.*` mis-claim therefore degrades only *direct deep-link opens for
   users who already have the business app* — a different leg, already tracked by ORCH-1346.
   Additionally `*.onelink.me` is the SDK's native default OneLink host, so business links on
   `minglabiz.onelink.me` need **no** `setOneLinkCustomDomains` registration — matching ORCH-1318's
   own design note: *"Links ship on `*.onelink.me` until the branded domain DNS lands."*
6. **Severity** — **RULED OUT** (not a blocker for this leg).

---

### F-6 — LIVE AppsFlyer state (read-only MCP) — **CONFIRMED**

1. **Symptom** — n/a (state establishment).
2. **Layer** — data (live provider account).
3. **Probe** — `mcp__appsflyer__get_onelink_templates`, `get_onelink_template_links`, `get_apps`, `get_app_settings`. **Read-only; no mutations performed.**
4. **Evidence**
   ```
   Template: redirection_profile (ID: w36m)   Domain: mingla.onelink.me      Links: 1  Version: 1
     Platforms: iOS (app|id6760440898), Android (app|com.mingla.app.v2)
     Features: Universal Links, Android App Links, iOS App Clips
   Template: business_profile   (ID: ZSCW)   Domain: minglabiz.onelink.me   Links: 0  Version: 0
     Platforms: iOS (app|id6768737367), Android (app|com.sethogieva.minglabusiness)
     Features: Universal Links, Android App Links, iOS App Clips

   Apps (4):
     Mingla                             com.mingla.app.v2               android  🟢 Active
     com.sethogieva.minglabusiness      com.sethogieva.minglabusiness   android  🟡 Pending
     Mingla –Date Plans & City Gems     id6760440898                    ios      🟢 Active
     Mingla: Host, Sell & Grow          id6768737367                    ios      🟢 Active

   w36m links: 1 → my_first_link, https://mingla.onelink.me/w36m/r1g66ldx (AppsFlyer's default sample)
   ZSCW links: 0
   ```
5. **Mechanism** — the business template exists and is platform-configured for both OSes, but has
   never had a link minted through the UI and sits at Version 0. **This does not prevent use**: OneLink
   URLs can be constructed directly against a template (`https://minglabiz.onelink.me/ZSCW?pid=…&c=…`)
   — indeed AppsFlyer's own MCP notes *"Links created via API or SDK are not shown in this view."*
6. **Severity** — **CONFIRMED** (state of record). Corrects memory: `go.usemingla.com` is the
   **branded alias** in front of consumer template w36m, whose OneLink subdomain is `mingla.onelink.me`.

---

### F-7 — The business OneLink is DEAD ON ANDROID (works on iOS) — **CONFIRMED ROOT CAUSE of the Android half of the download leg**

1. **Symptom** — an Android user clicking the business OneLink gets AppsFlyer's error page,
   **"The app you are looking for is unavailable."** — never reaching Google Play.
2. **Layer** — runtime (live provider), reconciled against data.
3. **Probe**
   ```bash
   AND_UA="Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
   for u in https://mingla.onelink.me/w36m https://go.usemingla.com/w36m https://minglabiz.onelink.me/ZSCW; do
     curl -s -A "$AND_UA" "$u" -w "HTTP %{http_code} redirect=%{redirect_url}\n" -o body.html; done
   ```
4. **Evidence**
   ```
   https://mingla.onelink.me/w36m     → HTTP 301  redirect=market://details/?id=com.mingla.app.v2&referrer=af_tranid%3D…   ✅
   https://go.usemingla.com/w36m      → HTTP 301  redirect=market://details/?id=com.mingla.app.v2&referrer=af_tranid%3D…   ✅
   https://minglabiz.onelink.me/ZSCW  → HTTP 200  size=2545  → "The app you are looking for is unavailable."               ❌
   ```
   iOS, same template, is healthy — the landing body carries the **correct business** listing:
   ```
   https://minglabiz.onelink.me/ZSCW  (iPhone UA) → https://apps.apple.com/US/app/id6768737367?mt=8
   (bare UA) → HTTP 301 → https://apps.apple.com/US/app/id6768737367?mt=8
   grep -c "not-found-title" zscw_ios.html → 0     # not an error page
   ```
5. **Mechanism** — the template is configured for both platforms, but AppsFlyer refuses to build an
   Android store redirect and serves its not-found page instead. **This is a live dead link on the
   exact leg Seth wants to ship, for the entire Android half of the audience.**
6. **Severity** — **CONFIRMED ROOT CAUSE** (Android download leg). Dashboard-side, not code.

---

### F-8 — Probable cause of F-7: a stale AppsFlyer app record, fixed by a dashboard click — **PROBABLE**

1. **Symptom** — as F-7.
2. **Layer** — data (provider record) vs runtime (the live store).
3. **Probe** — `mcp__appsflyer__get_app_settings(com.sethogieva.minglabusiness, android)`; headless-Chrome resolution of both Play listings.
4. **Evidence** — the AppsFlyer record is unresolved:
   ```
   App Name: com.sethogieva.minglabusiness      ← raw package name, never resolved to a listing
   Original Name: N/A
   Last Updated: 2026-05-12                     ← two months stale
   Status: 🟡 Pending
   ```
   …but the Play listing **is live and public** (headless Chrome, JS-rendered):
   ```
   com.sethogieva.minglabusiness => "Mingla: Host, Sell & Grow - Apps on Google Play"   ← LIVE
   com.mingla.app.v2             => "Mingla-Date Plans & City Gems - Apps on Google Play"
   ```
   The discriminator is exact: **every 🟢 Active app's platform redirects; the one 🟡 Pending app's
   platform is the one that 404s** — same template, both platforms configured. AppsFlyer's own docs
   describe this precise situation and its remedy — [Why is my app still pending?](https://support.appsflyer.com/hc/en-us/articles/360001533885-Why-is-my-app-still-pending):
   > *"AppsFlyer automatically checks the status of the apps several times a day… If you are certain
   > that the app is published in Google Play or iTunes, but it still appears as pending in the
   > dashboard, an admin can manually check its status… Next to the pending app, click **Refresh
   > Status**."*
5. **Mechanism** — AppsFlyer's crawler last looked on 2026-05-12, before business Android went live,
   and never re-resolved. Believing the app is not in the store, it has no Play target to redirect to
   and serves the not-found page. **Fix = Seth clicks Refresh Status. Not code. Not a native build.**
6. **Severity** — **SECONDARY ROOT CAUSE**, confidence **probable** — capped deliberately: proving
   causation requires performing the refresh, which is a **write to the AppsFlyer account** and is
   forbidden by this dispatch. The correlation is exact and the vendor documents this exact
   failure/remedy pair, but I did not execute the remedy. **Note the same docs also say status
   *"has no effect on data collection and measurement"*** — i.e. once Android redirection is restored,
   Pending status alone would not have suppressed attribution.

---

### F-9 — Deferred deep-link continuity is NOT available on this leg — **CONFIRMED**

1. **Symptom** — an invitee who installs the app does not land back in the invite context.
2. **Layer** — code + docs.
3. **Probe** — read `mingla-business/app/_layout.tsx:512–533`; INVARIANT_REGISTRY ORCH-1318 stanza; COMMS-0089.
4. **Evidence** — `_layout.tsx:515–517, 531–532`:
   ```
   // B1 business handles ONLY universal-download (no-op landing) +
   // referral (persist code, attribution-only). Per-entity business
   // content routing is B2 (out of scope) — no navigation here.
   …
   // dest.kind === "download": universal-download link has no in-app
   // landing target in B1 — intentional no-op.
   ```
   COMMS-0089: *"Business-app OTA (`eas update`) EMPIRICALLY BRICKS LAUNCH… ship every business fix
   in a NATIVE build."*
5. **Mechanism** — even with the TypeError fixed and the listener live, the business app's B1
   dispatcher deliberately does nothing with a `download` destination. Routing an invitee to the
   accept/join context post-install is B2 work → business-app code → a native build. It cannot ride
   a web deploy and cannot ride an OTA.
6. **Severity** — **CONFIRMED**. Scope fact, stated plainly.

---

### F-10 — Every memory-flagged "native-build gate" for attribution is already cleared — **RULED OUT**

1. **Symptom** — memory asserts the download leg needs a native build (COMMS-0083/0090; ORCH-1373 §9.6).
2. **Layer** — docs (memory) vs data (live) vs code.
3. **Probe** — `npx eas env:list production` in `mingla-business/`; read `appsFlyerService.ts:324–353`; INVARIANT_REGISTRY ORCH-1318 stanza; COMMS-0097.
4. **Evidence**
   - **Business EAS AppsFlyer env — PROVISIONED** (COMMS-0083 claimed consumer-only):
     ```
     EXPO_PUBLIC_APPSFLYER_ANDROID_APP_ID=***** (secret)
     EXPO_PUBLIC_APPSFLYER_DEV_KEY=*****        (secret)
     EXPO_PUBLIC_APPSFLYER_IOS_APP_ID=*****     (secret)
     ```
     → `hasAppsFlyerEnv` (`appsFlyerService.ts:82–83`) is **true** in business production builds; init does not skip.
   - **Both AF listeners ENABLED** (COMMS-0083's *"both AF listeners kept false"* is **STALE**, superseded by ORCH-1318 two days later) — `appsFlyerService.ts:331–332`:
     ```ts
     onInstallConversionDataListener: true,
     onDeepLinkListener: true,
     ```
     INVARIANT_REGISTRY: *"ACTIVE — ORCH-1318 … enables the AppsFlyer unified deep-link callback (`onDeepLink`) in BOTH apps"* (2026-07-07).
   - **Native builds already in flight** — COMMS-0097: *"Unified 1.1.2 native release in flight… iOS in review, Android live 100%"*; `mingla-business/app.json` version **1.1.2**.
   - **`APPSFLYER_S2S_TOKEN` is NOT a gate for this leg** — it appears only in
     `supabase/functions/_shared/appsFlyerS2S.ts` (server-side api3 event postbacks). Install
     attribution is SDK-side with the dev key; the S2S token gates server-reported **events**, not installs.
5. **Mechanism** — the decisive insight: **the app the invitee installs is whatever is live in the
   store at click time, not the artifact this PR builds.** This PR ships web. The store build's AF
   SDK does the attribution. The two are independent release trains, and the store train has already
   left with the SDK aboard.
6. **Severity** — **RULED OUT** (the asserted blocker does not exist).

---

## 5. Five-truth-layer reconciliation

| Layer | What it says | Contradiction? |
|---|---|---|
| **Docs (memory/COMMS)** | COMMS-0083: *"both AF listeners kept false"*; *"consumer EAS env provisioned"*; *"GO-LIVE native-build-bound"*. ORCH-1373 §9.6: business swap *"pending the next native build"*. | **YES ×3** — all three are stale. |
| **Docs (provider)** | Install attribution = redirect + SDK at first launch; no web SDK; UL/AL only for installed apps. | Consistent with runtime. |
| **Schema** | `app.json` v1.1.2 claims `go.usemingla.com` (consumer-owned), not `minglabiz.onelink.me`. | Real, but **out of scope** for this leg (F-5). |
| **Code** | `appsFlyerService.ts:331–332` listeners **true**; web shim missing 2 exports; B1 download = intentional no-op. | **YES** — code contradicts COMMS-0083 on listeners. |
| **Runtime** | 3/3 TypeError captures; ZSCW iOS ✅ / Android ❌ not-found; consumer Android 301 + `af_tranid` referrer. | **YES** — Android dead link is invisible in every doc. |
| **Data** | Business EAS: 3 AF secrets present. AF: business Android 🟡 Pending, `Original Name: N/A`, stale 2026-05-12; Play listing live. | **YES** — provider record contradicts the live store. |

**Which layer holds truth:** **Runtime and Data.** Memory (COMMS-0083, and ORCH-1373 §9.6 inheriting
it) is the stale layer on every point of conflict, because ORCH-1318 (2026-07-07) and the business
EAS provisioning both postdate COMMS-0083 (2026-07-05) and neither amended it.

---

## 6. Repro evidence

**Driver:** headless Chrome 150 + raw CDP on **port 9375** (per dispatch), own profile dir
`/tmp/orch-1378/chrome-profile`; torn down by profile-scoped `pkill -f user-data-dir=…` — **no global
pkill**, no interference with ports 9222/9373/9374.

**Capture 1 — production home (`/`), 1/1:**
```
{
 "text": "TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function
    at .../_layout-5d9057a4a40f96e3f448d9d0863541b8.js:1:3197
    at .../_layout-5d9057a4a40f96e3f448d9d0863541b8.js:1:3337",
 "url":  ".../_layout-5d9057a4a40f96e3f448d9d0863541b8.js",
 "line": 0, "col": 3196
}
```
`col: 3196` (0-based) = the cited `1:3197` — byte-exact with the `(0,P.subscribeOneLinkDeepLink)`
I dissected out of the shipped bundle.

**Capture 2 — `/accept-brand-invitation?token=orch1378-probe`, 2/2** (fires **twice** — remount):
identical TypeError, identical offset.

**Capture 3 — latent collateral, driven via `visibilitychange` hidden→visible:**
```
--- after load, before visibility toggle: 2 exception(s) ---
   TypeError: (0 , P.subscribeOneLinkDeepLink) is not a function   ×2
--- after visibility toggle (background -> active): 3 exception(s) ---
   NEW: TypeError: (0 , M.syncPushPermissionTag) is not a function
```

**Live OneLink probes** — see F-7 evidence block (consumer 301 + `af_tranid` referrer; business
Android not-found; business iOS healthy).

**Not reproduced / not verified (stated plainly):**
- **The end-to-end install→attribution chain was NOT executed.** Doing so requires installing the
  business app on the Samsung `R58R54YV7JT` from a live OneLink and reading the AppsFlyer dashboard —
  and the Android leg is dead (F-7), so the chain is currently unrunnable on that platform. The
  mechanism is established by provider docs + the live consumer 301-with-referrer, not by an
  observed business install. **A tester pass must confirm the real install once F-7/F-8 is resolved.**
- **F-8's causation** — not proven; proving it requires a write (Refresh Status) that this dispatch forbids.
- **iOS deferred-deep-link behavior** — out of scope; B1 no-ops `download` regardless (F-9).

---

## 7. Blast radius & cross-surface map

| # | Surface | Affected by F-1? | Detail |
|---|---|---|---|
| 1 | Consumer iOS | **No** | Metro resolves `appsFlyerService.ts` (native). `app-mobile` has **no** `appsFlyerService.web.ts` — it cannot drift this way. |
| 2 | Consumer Android | **No** | Same. |
| 3 | Buyer/anonymous Web | **No** | Distinct route tree; `_layout` root is `mingla-business/app/_layout.tsx` — see #7. |
| 4 | Business iOS | **No** | Native module has the export. |
| 5 | Business Android | **No** | Native module has the export. |
| 6 | Admin Web (adjacent) | **No** | Separate app (`mingla-admin/`), no AppsFlyer. |
| 7 | **Business Web (adjacent)** | **YES — 100% of loads** | Root layout; both `/` and `/accept-brand-invitation` confirmed. |

**F-1 is business-web-only.** But note the root layout is shared by **all** business-web routes —
`business.usemingla.com/**` throws on every page load, including every buyer-facing route served from
this app (`/checkout/{eventId}`, `/e/{brandSlug}/{eventSlug}`, `/b/{brandSlug}`, `/t/…`). The failure
is non-fatal (unhandled rejection, no white-screen), so the user-visible blast radius is **nil today**
— the cost is purely the dead subscription plus permanent error noise in Sentry/console.

**F-7 blast radius is different and larger for the ORCH-1373 plan:** the business OneLink is dead on
Android for **every** business-destined OneLink, not just this leg — including the ORCH-1318 referral
links and any future business share link.

**Call-site sweep:** `subscribeOneLinkDeepLink` has exactly 2 non-test call sites —
`app-mobile/app/index.tsx:393` (consumer, native-only, unaffected) and
`mingla-business/app/_layout.tsx:518` (the bug). `resolveBusinessOneLinkDestination` (also missing
from the shim) is not called from web-reachable code, so it is latent, not live.

---

## 8. Invariant impact

| Invariant | Status | Note |
|---|---|---|
| `I-ONELINK-NO-TRANSMIT-BEFORE-ATT` (ACTIVE) | **Not violated** | ATT gating is native-only; web never transmits. |
| `I-ONELINK-SINGLE-RESOLVER` (ACTIVE) | **Not violated** | Consumer-scoped; drift is in the business web shim. |
| `I-PROPOSED-1342-STORE-LINKS-SSOT` (gate `orch-1342-store-links-ssot`) | **Load-bearing, ALLY** | Already fails any PR putting a `go.usemingla.com` / raw store literal in `mingla-business` outside `storeLinks.ts` — it will **automatically** police the new download CTA and enforce the ORCH-1346 one-domain-one-template rule. Any business OneLink constant must land in `storeLinks.ts`. |
| `GUEST_FUNNEL_ONELINK_URL` (`storeLinks.ts:47`, `= null`) | **Precedent, not applicable** | This is the **consumer** guest-funnel flip constant, dark pending consumer go-live. The business invite leg is a *different* link on a *different* template; do not reuse this constant. |
| **Gap — no invariant covers `.web.*` export parity** | **NEW** | F-2 shows the class is structurally unguarded across all 36 shims. A `I-PROPOSED-1378-*` DRAFT covering shim/native export parity is the natural regression contract (fails-on-revert by construction: delete the stub → gate fails). *Flagged, not designed — SPEC's call.* |

**Conflict flagged, not resolved:** COMMS-0083 is ACTIVE/OPEN and asserts three things this
investigation disproves (listeners false; consumer-only EAS env; S2S token gating this leg). It needs
a correcting ledger entry. **The orchestrator owns that write — I performed no git operations.**

---

## 9. Discoveries for Orchestrator (NEW collateral — separate from ORCH-1378)

**D-1 — `syncPushPermissionTag` TypeError on business web (NEW, runtime-proven).** Same bug class as
F-1, different module (`oneSignalService.web.ts`), different trigger (tab background→foreground),
same root layout. Live on production now. **Suggested: own ORCH, S2 — or fold into ORCH-1378's fix if
the SPEC adopts the export-parity gate (F-2), since the gate will fail CI on this file too and the
fix would otherwise be blocked.** This is a genuine scope decision for the conductor, not something I
folded in unilaterally.

**D-2 — Business OneLink dead on Android (F-7/F-8).** Dashboard-side, blocks the Android half of the
ORCH-1373 download leg **and** all ORCH-1318 business referral links. **Needs Seth (1 minute), not an
agent.** Arguably belongs to ORCH-1346's dashboard leg rather than ORCH-1378.

**D-3 — COMMS-0083 is materially stale on three points** (§8). Recommend a correcting entry so no
other session re-derives the wrong "needs a native build" conclusion — this investigation exists
partly because that stale claim propagated into ORCH-1373 §9.6.

**D-4 — `resolveBusinessOneLinkDestination` is also missing from the web shim** — latent (no
web-reachable call site) but it will throw the moment anything on web imports it.

**D-5 — AppsFlyer business Android app record is unresolved since 2026-05-12** (`Original Name: N/A`).
Even after Refresh Status, worth confirming the dashboard shows the real app name/logo.

**D-6 — `w36m` still contains only AppsFlyer's default `my_first_link` sample** and `ZSCW` has zero
UI-minted links. Not a defect (links can be constructed against a template), but it means **no
business OneLink has ever been exercised in production** — raising the value of a tester pass.

---

## 10. Confidence

**PROVEN** for the dispatched root cause. The chain is closed at four independent layers that agree:
source (shim missing the export), git history (shim predates the symbol by ~5 months; ORCH-1318 added
the symbol + a shared-layout call site without touching the shim), **the shipped production artifact**
(module 1121 dumped verbatim — six no-ops, `subscribeOneLinkDeepLink` absent, deps `[]`), and
**runtime** (3/3 captures at the byte-exact offset).

**Per-finding:** F-1 proven · F-2 proven · F-3 proven (runtime) · F-4 proven (provider docs + live
301) · F-5 proven · F-6 proven (live MCP) · **F-7 proven (symptom)** · **F-8 probable (mechanism —
capped: proving it needs a forbidden write)** · F-9 proven · F-10 proven.

**Known limits, stated plainly:**
- **The install→attribution chain was never executed end-to-end.** I proved the mechanism exists
  (consumer 301 carries `af_tranid` into Play; docs say the SDK closes the loop at first launch) and
  that every prerequisite is in place — but I did not install the business app from a OneLink and
  watch a dashboard row appear. **The verdict "attribution ships in this PR" rests on mechanism +
  cleared prerequisites, not on an observed business install.** That is the one claim a tester must
  close, and F-7 must be fixed before it is even runnable on Android.
- F-8's causation is inferred from an exact correlation + a vendor doc describing this precise
  failure/remedy, not from executing the remedy.
- I did not verify *which* business build is live on each store beyond COMMS-0097 + the live Play
  listing; the iOS 1.1.2 review outcome is outside my reach.

---

## 11. Recommended next phase & scope (direction only — no fix proposed)

**Next phase: SPEC**, folded into ORCH-1373's SPEC (per Seth's decision that 1378 ships in the same PR).

**Scope-shaping facts the SPEC must honor:**

1. **The TypeError fix and the download CTA are independent.** The CTA is an `<a href>`; it works
   whether or not the shim is fixed. Both belong in this PR, but the SPEC must not present the
   TypeError fix as a *prerequisite* for attribution — it is not, and conflating them will mis-scope
   the work.
2. **The business OneLink must target the business template.** `minglabiz.onelink.me/ZSCW`, never
   `go.usemingla.com` (consumer-owned; 1 domain = 1 template). Gate `orch-1342-store-links-ssot`
   already enforces this and requires the constant to live in `storeLinks.ts`.
3. **Do not reuse `GUEST_FUNNEL_ONELINK_URL`** — that is the consumer flip constant (§8).
4. **F-7 is an operator gate, not a code gate.** The SPEC should state the Android leg is dark until
   Seth's Refresh Status, and decide whether the CTA ships dark-safe (store-direct) or blocks on it.
5. **Deferred continuity is out of reach** (F-9) — the SPEC must not promise the invitee lands back
   in the invite context after install.
6. **The regression contract** has an obvious home: an export-parity gate over `.web.*` shims vs their
   native pairs (F-2), fails-on-revert by construction. Scoping it repo-wide surfaces D-1 — the SPEC
   must decide whether D-1 folds in or is deferred (and if deferred, the gate needs an explicit
   allowlist entry, or it blocks the PR).
7. **Tester must close the one open claim** (§10): a real business install from a live OneLink,
   confirmed in the AppsFlyer dashboard, on the Samsung `R58R54YV7JT` — after F-7 is resolved.

**The fallback's cost, quantified (if attribution is dropped for a plain device-aware store link):**
The store redirect loses `referrer=af_tranid=…`, so **every business install from this leg lands as
`organic`** in AppsFlyer. You lose: which invite drove which install; the invite→install→activation
funnel end-to-end; and any ability to compare this leg against the email CTA or paid channels.
**The sharpest cost is specific to this moment: ORCH-1373 exists precisely because the accept funnel
sits at 0% (0 of 1 invites ever accepted). Shipping the fix without attribution means you cannot
prove the fix worked** — you would be flying blind on the exact metric that justified the work. Given
attribution costs one URL constant instead of a hardcoded store link, and the only real gate is a
dashboard click Seth can do in a minute, **the fallback buys nothing and forfeits the measurement.**

---

## Appendix — probes (reproducible)

```bash
# 1. Source drift
grep -n "^export " mingla-business/src/services/appsFlyerService.ts     # 9 exports
cat    mingla-business/src/services/appsFlyerService.web.ts             # 6 exports

# 2. Provenance
git log --oneline --follow -- mingla-business/src/services/appsFlyerService.web.ts   # f65f43ca8 (ORCH-1085)
git log --oneline -S subscribeOneLinkDeepLink -- mingla-business/                     # 6382c7617 (ORCH-1318)

# 3. Shipped artifact — resolve P and dump module 1121
curl -s https://business.usemingla.com/_expo/static/js/web/_layout-5d9057a4a40f96e3f448d9d0863541b8.js -o layout.js
cut -c3150-3320 layout.js                    # the (0,P.subscribeOneLinkDeepLink) throw site
# root dep map: "27":1121  →  module 1121 lives in __common-618a…js
curl -s https://business.usemingla.com/_expo/static/js/web/__common-618a230597b0b56546037bc2ab5d5ef1.js -o common.js
python3 - <<'PY'
import re; s=open('common.js').read()
m=re.search(r'\},1121,\[[^\]]*\]\);', s); print(s[s.rfind('__d(function(',0,m.start()):m.end()])
PY

# 4. Runtime (CDP :9375, own profile — never a global pkill)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9375 --user-data-dir=/tmp/orch-1378/chrome-profile about:blank &
node /tmp/orch-1378/capture.mjs  https://business.usemingla.com/
node /tmp/orch-1378/capture.mjs  "https://business.usemingla.com/accept-brand-invitation?token=orch1378-probe"
node /tmp/orch-1378/capture2.mjs                       # drives visibilitychange → collateral D-1
pkill -f "user-data-dir=/tmp/orch-1378/chrome-profile"

# 5. Shim export-drift sweep (all 36 .web.* shims)
node /tmp/orch-1378/drift.mjs

# 6. Live OneLink behavior
AND_UA="Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36"
IOS_UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
curl -s -A "$AND_UA" https://mingla.onelink.me/w36m    -w "HTTP %{http_code} -> %{redirect_url}\n" -o /dev/null
curl -s -A "$AND_UA" https://minglabiz.onelink.me/ZSCW -w "HTTP %{http_code} -> %{redirect_url}\n" -o and.html
curl -s -A "$IOS_UA" https://minglabiz.onelink.me/ZSCW -o ios.html
curl -s https://minglabiz.onelink.me/.well-known/assetlinks.json

# 7. Live AppsFlyer state (READ-ONLY — no mutations performed)
mcp__appsflyer__get_onelink_templates
mcp__appsflyer__get_onelink_template_links(onelink_id="ZSCW" | "w36m")
mcp__appsflyer__get_apps
mcp__appsflyer__get_app_settings(app_id="com.sethogieva.minglabusiness", platform="android")

# 8. EAS provisioning
cd mingla-business && npx eas env:list production | grep APPSFLYER
```

**Guards honored:** no `git` operations (shared worktree) · no product-code changes · no production DB
writes · **no AppsFlyer writes — read-only MCP only** · CDP port 9375 only · no global `pkill` ·
scratch confined to `/tmp/orch-1378/` · only this report file written.
