# SPEC — ORCH-1319 [Explorer "Get the app" → direct, device-aware live-store links + desktop QR; kill the beta gate & lead-capture]

**Phase:** SPEC → IMPLEMENT
**Surface:** `mingla-marketing/` ONLY (the explorer/consumer marketing site, Next.js 15 App Router). **NO app/native change**, **NO business/organiser change.**
**Supersedes:** the pre-launch beta gate shipped by **ORCH-1216** (2-step lead form → TestFlight hard-gate), **ORCH-1219** (multi-select interest + always-email download link), **ORCH-1221** ("All of it" select-all). Those were correct while Mingla was TestFlight-only; the app is now **LIVE on both public stores**, so the whole gate is obsolete.
**Ship channel:** Vercel — **`[deploy]` commit tag REQUIRED** on merge (mingla-marketing touched; Vercel deploy gate). Backend change (edge fn decommission) via Supabase.
**Future upgrade (OUT OF SCOPE):** `/download` can later 302 to the **AppsFlyer OneLink** for install attribution (ORCH-1313 Phase 2) instead of the raw store URLs — the route is the seam for that swap.

**Live store URLs (canonical, used everywhere):**
- iOS App Store: `https://apps.apple.com/app/id6760440898`
- Google Play: `https://play.google.com/store/apps/details?id=com.mingla.app.v2`

---

## 1. Executive summary (layman first)

Today, tapping **"Get the app"** on the explorer marketing site (`usemingla.com`) opens a two-step form that asks for your name, city, email and interests, then — only after you submit — shows a TestFlight link (iPhone only) and emails everyone the TestFlight link. That was a private-beta funnel. **The app is now live on the App Store and Google Play**, so this is worse than useless: it makes real users fill out a form and sends them to a beta instead of the store.

ORCH-1319 replaces it with the obvious thing:
- **On a phone**, "Get the app" sends you **straight to your store** — iPhone → App Store, Android → Google Play.
- **On a computer**, "Get the app" opens a small panel with a **QR code** (point your phone camera at it and it opens the right store for whichever phone scans it) plus tappable App Store / Google Play badges.
- **No more form. No email capture. No TestFlight anywhere.** Existing captured leads are kept in the database (we just stop collecting new ones).

We still measure taps (a `get_the_app_clicked` analytics event with a platform/store dimension), so growth data continues.

---

## 2. Scope & non-goals

### In scope
- **Nav CTA rewire** (`glass-nav.tsx`): the explorer "Get the app" button stops opening a modal and instead performs a **device-aware action** (iOS → App Store, Android → Play, desktop/other → QR panel). (§4.1)
- **New `/download` route** (`app/download/page.tsx`): server-side UA sniff → 302/307 iOS→App Store, Android→Play; desktop UA → a minimal styled page (QR + badges + copy). This is the URL the QR encodes so **one** QR routes both iPhone and Android scanners. (§4.2)
- **Device-smart QR** rendered in both the nav panel and the `/download` desktop page, encoding the canonical `/download` URL. (§4.3)
- **Kill email capture**: delete the modal + client transport + interest reducer; **decommission** the `explorer-app-lead-submit` edge function; **preserve** existing `explorer_app_leads` rows. (§4.4)
- **Remove the hardcoded TestFlight URL entirely** — it must appear NOWHERE in the repo after this. (§4.4b)
- **Retire the obsolete strict-grep guards** (delete 5, amend 2, keep 1) + move their invariants to DECOMMISSIONED / narrow the amended ones. (§4.5, §6, §9)
- **Analytics**: keep a tap event `get_the_app_clicked { platform, store, location }`; the old `get_the_app_submitted` goes away with the transport. (§4.6)
- Shared constants: `lib/store-links.ts` (the two live store URLs), `lib/site.ts` (canonical origin + `/download` URL), `lib/device-platform.ts` (the extracted `resolvePlatform`/`isIosDevice`, plus a UA-only server variant). (§4.0)

### Non-goals
- **No change to the organiser/business surface.** `BetaAccessModal` + `lib/beta-access-submit.ts` + `supabase/functions/beta-access-lead-submit` + the `beta_access_leads` table **STAY** (see §3 verdict). The business app is not yet live on stores (business iOS blocked at ASC), so its waitlist is a *different, still-in-use* funnel.
- **No DB schema change.** The `explorer_app_leads` table and all its rows are preserved; only the writer (edge fn) is decommissioned.
- **No AppsFlyer OneLink** wiring here (future).
- **No native/app-mobile change**; store listings already exist.
- **No hero/footer CTA change** — the nav is the ONLY "Get the app" trigger (verified: the only occurrences are in `glass-nav.tsx`).

---

## 3. beta-access-* verdict (REQUIRED read result)

**VERDICT: `beta-access-modal.tsx` + `lib/beta-access-submit.ts` + `supabase/functions/beta-access-lead-submit/index.ts` are a DIFFERENT, still-in-use surface — DO NOT touch them.**

Evidence:
- `glass-nav.tsx:95-111` mounts the "Get Beta Access" CTA and `glass-nav.tsx:135-141` mounts `<BetaAccessModal>` **only** on the organiser (`/business`) surface; the explorer surface is a separate branch (`glass-nav.tsx:112-130` + `:143-150`).
- It writes to `beta_access_leads` (organiser waitlist), a distinct table from `explorer_app_leads`, via a distinct edge fn (`config.toml:117-118`).
- The **business app is not live on stores** (business iOS blocked at ASC per program state), so its beta waitlist is a legitimate, active funnel. It is out of scope and must remain green.

The only cross-cutting subtlety: two strict-grep guards (`i-proposed-1219-form-no-autoadvance-multiselect`, `i-proposed-1216-explorer-only-cta`) currently assert facts about **both** modals. Those guards are **amended (not deleted)** so the organiser half keeps its protection — see §4.5 / §9.

---

## 4. Layered specification

### 4.0 Shared constants + extracted device detection (NEW files)

**A. `mingla-marketing/lib/store-links.ts` (NEW)** — the single source of truth for the two live URLs:
```ts
export const APP_STORE_URL = 'https://apps.apple.com/app/id6760440898'
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mingla.app.v2'
```
Comment: "ORCH-1319 — live public store listings. NEVER a TestFlight/beta URL. Later this may indirect through the AppsFlyer OneLink (ORCH-1313 P2)."

**B. `mingla-marketing/lib/site.ts` (NEW)** — canonical origin + the QR target:
```ts
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://usemingla.com').replace(/\/$/, '')
export const DOWNLOAD_URL = `${SITE_ORIGIN}/download`
```
Add `NEXT_PUBLIC_SITE_URL` to `mingla-marketing/.env.example` (documented as public, defaults to `https://usemingla.com`). The QR MUST encode an absolute URL on the canonical marketing origin so a phone scanner can resolve it.

**C. `mingla-marketing/lib/device-platform.ts` (NEW)** — extract the existing, reviewed detection out of the doomed modal (currently `get-the-app-modal.tsx:75-111`) so it survives the modal's deletion and is shared by the nav (client) and `/download` (server):
- `export type Platform = 'ios' | 'android' | 'other'`
- `export function isIosDevice(ua, platform, maxTouchPoints): boolean` — verbatim from `get-the-app-modal.tsx:75-86` (classic iOS UA **or** `platform === 'MacIntel' && maxTouchPoints > 1` iPad-as-Mac).
- `export function resolvePlatform(ua, platform, maxTouchPoints): Platform` — verbatim from `:93-101` (iOS wins, then Android by UA, else `other`).
- `export function detectClientPlatform(): Platform` — SSR-safe client read (verbatim `detectPlatform` `:104-111`; returns `'other'` when `navigator` is undefined).
- `export function resolvePlatformFromUa(ua: string): Platform` — **server variant**: UA-string-only (no `navigator.platform`/`maxTouchPoints` server-side). iOS if `/iPad|iPhone|iPod/i.test(ua)`; else Android if `/android/i.test(ua)`; else `other`. **Documented caveat:** iPadOS 13+ Safari sends a desktop-Mac UA with no `iPad` token, so server-side it resolves to `other` and lands on the desktop QR page (a *safe* fallback that still shows the App Store badge) — the client nav path still catches iPad via `maxTouchPoints`.

Acceptance: `resolvePlatform`/`isIosDevice` are byte-identical to the originals (no behavior drift); a unit test pins the iPad-as-Mac and Android/desktop cases.

**D. `mingla-marketing/components/ui/app-store-badges.tsx` (EDIT)** — the badges component already exists but its default hrefs are **stale placeholders** (`:14-15`: `apps.apple.com/app/mingla`, `.../details?id=com.mingla`). Change the defaults to import `APP_STORE_URL` / `PLAY_STORE_URL` from `lib/store-links.ts`. (Reused by the nav panel + `/download` desktop page.)

---

### 4.1 NAV CTA behavior — device-aware direct action + QR panel

**File:** `mingla-marketing/components/marketing/glass-nav.tsx`

**Before:** the explorer branch (`:112-130`) renders a `<Button>` whose `onClick` fires `captureMarketing('marketing_cta_clicked', {cta_id:'get_the_app', location:'nav'})` then `setAppOpen(true)`; `:143-150` mounts `<GetTheAppModal open={appOpen} … source="explorer_marketing_nav"/>`; import at `:8`; `appOpen` state at `:36`.

**After:**
- Remove the `import { GetTheAppModal }` (`:8`) and the `appOpen` state (`:36`).
- The explorer CTA `onClick` calls a new handler `handleGetTheApp()`:
  1. `const platform = detectClientPlatform()` (from `lib/device-platform.ts`).
  2. `if (platform === 'ios')` → `captureMarketing('get_the_app_clicked', { platform:'ios', store:'app_store', location:'nav' })` then open the store: `window.open(APP_STORE_URL, '_blank', 'noopener,noreferrer')` (fallback to `window.location.assign(APP_STORE_URL)` if `open` returns null — popup-blocked).
  3. `else if (platform === 'android')` → same with `PLAY_STORE_URL`, `store:'play'`.
  4. `else` (desktop/other) → `captureMarketing('get_the_app_clicked', { platform:'other', store:'qr_panel', location:'nav' })` then `setQrOpen(true)` (new state).
- Add `<AppQrPanel open={qrOpen} onClose={() => setQrOpen(false)} />` mounted **only** on the explorer surface (`surface === 'explorer'`).
- **Keep `aria-haspopup="dialog"`** on the CTA only in the desktop case is not statically knowable; keep `aria-haspopup="dialog"` + `aria-expanded={qrOpen}` (the button *can* open a dialog). Acceptable — the mobile branches simply never open it.
- The organiser branch (`:95-111`, `:135-141`) is **UNCHANGED**.

**`AppQrPanel` (NEW: `mingla-marketing/components/marketing/app-qr-panel.tsx`)** — a small accessible dialog reusing the a11y patterns already proven in the modal being deleted (so nothing regresses):
- `role="dialog"` `aria-modal="true"` `aria-labelledby`, ESC closes, backdrop click closes, **focus trap** + **focus-restore to the trigger** on close, body-scroll-lock while open, `AnimatePresence` + reduced-motion honoring `useMinglaReducedMotion()` (mirror `get-the-app-modal.tsx:147-221` / `:328-336`).
- Contents (top→bottom): heading "Scan to get Mingla"; short copy "Point your phone camera at the code — it opens the App Store or Google Play for whatever phone you're on."; the **device-smart QR** (`<DownloadQr size={200} />`, §4.3) on a **solid white rounded card** (QR needs high contrast regardless of panel theme); a divider "or"; `<AppStoreBadges />` (both live badges as the click-through fallback); a Close button.
- Panel is intentionally SMALL (max-width ~360px), no form, no inputs.

**Edge cases:**
- Reduced-motion → instant open/close (no spring).
- `navigator` undefined (SSR / no-JS) → `detectClientPlatform()` returns `other`; but the handler only runs on a real user click in the browser, so this never fires server-side.
- Popup blocked on iOS/Android → `window.open` returns `null` → fall back to same-tab `location.assign`.
- Rapid double-tap on desktop → idempotent `setQrOpen(true)`.

**Acceptance (top criterion):** On an iOS UA the CTA navigates to `APP_STORE_URL` and on an Android UA to `PLAY_STORE_URL` with **zero** intermediate form/modal; on a desktop UA it opens the QR dialog. **No TestFlight URL and no email field exist on any path.**

**Fails-on-revert angle:** a strict-grep gate (§9 G-1) FAILS if `glass-nav.tsx` re-imports `GetTheAppModal` / references `get-the-app-modal` / contains a `testflight` token / mounts any lead form on the explorer CTA.
**Adversarial angle:** a distinct gate assertion (§9 G-1b) FAILS if the explorer CTA handler resolves to a **literal** store branch that ignores the detected platform (e.g. always App Store) — the store choice must be driven by `detectClientPlatform()` (guards a "everyone → App Store" regression that would strand Android users).

---

### 4.2 SMART DOWNLOAD REDIRECT ROUTE — `usemingla.com/download`

**File:** `mingla-marketing/app/download/page.tsx` (NEW — App Router Server Component).

**Behavior:**
- `export const dynamic = 'force-dynamic'` (it reads request headers → must not be statically cached).
- `const ua = (await headers()).get('user-agent') ?? ''` (Next 15 `headers()` is async).
- `const platform = resolvePlatformFromUa(ua)` (server, UA-only — §4.0C).
- `if (platform === 'ios')` → `redirect(APP_STORE_URL)`; `if (platform === 'android')` → `redirect(PLAY_STORE_URL)`.
  - `redirect()` from `next/navigation` emits an HTTP **307** (temporary) — functionally the requested "302": both are temporary, non-cached, method-preserving-for-GET. (If a literal 302 is later mandated, swap to a `app/download/route.ts` GET Route Handler returning `NextResponse.redirect(url, 302)` + a sibling desktop page; not needed now.)
- `else` (desktop/other) → **render** the minimal desktop page: centered card with heading "Get Mingla", the copy "Scan this with your phone, or pick your store.", `<DownloadQr size={220} />` on a white card (§4.3), and `<AppStoreBadges size="lg" />` (both live badges). No nav chrome required beyond the site layout; **no form, no PII, no email field**.

**SSR-safety:** everything is server-only; **no `navigator`, no `window`** touched. The QR component (§4.3) is a client component embedded in the server page (allowed) and takes only a static string prop.

**Why this shape:** the QR encodes `DOWNLOAD_URL` (this route). An **iPhone** scanning it hits `/download` with an iOS UA → 307 → App Store; an **Android** phone → Play. One QR, both platforms, zero client JS on the redirect path.

**Edge cases:**
- Unknown/empty UA → `other` → desktop page (safe: shows both badges + QR).
- iPadOS-as-Mac UA → `other` → desktop page (documented fallback; still shows the App Store badge).
- Bots/crawlers (no store app) → desktop page renders real HTML (SEO-safe; the redirect only fires for real iOS/Android UAs).
- `curl`/no-UA → `other` → desktop page.

**Acceptance (top criterion):** `GET /download` with an iPhone UA responds 3xx to `APP_STORE_URL`; with an Android UA, 3xx to `PLAY_STORE_URL`; with a desktop UA, 200 HTML containing the QR + both store badges. **No response on any UA contains a TestFlight URL or a form.**

**Fails-on-revert angle:** gate G-2 FAILS if `app/download/page.tsx` is absent, or does not reference both `APP_STORE_URL` and `PLAY_STORE_URL`, or contains any `testflight`/lead-form token.
**Adversarial angle:** gate G-2b (distinct) FAILS if the route's redirect targets are **hardcoded string literals** rather than the shared `store-links` constants, OR if the redirect is not guarded by `resolvePlatformFromUa` (guards a "redirect everyone to the App Store" regression, and a drift between the route's URL and the nav's URL).

---

### 4.3 THE QR

**Library verdict:** **NO QR library currently exists** in `mingla-marketing/package.json` (deps: next, react, framer-motion, clsx, tailwind-merge, lucide-react, posthog-js, @next/third-parties — no `qrcode` / `react-qr-code` / `qrcode.react`).

**Decision:** add **`react-qr-code`** (a tiny, dependency-light component that renders a **pure inline `<svg>`** QR with **no network calls** — works in the client nav panel and inside the server `/download` page). Add to `dependencies`.
> Alternative if the team wants **zero** client JS on `/download`: add `qrcode` (Node) and `qrcode.toString(DOWNLOAD_URL, {type:'svg', errorCorrectionLevel:'M', margin:1})` server-side, inlining the SVG string. The nav panel (client) would still need `react-qr-code`. To keep **one** QR mechanism, `react-qr-code` in a shared component is preferred.

**Component:** `mingla-marketing/components/marketing/download-qr.tsx` (`'use client'`), reused by the nav panel AND the `/download` page:
- Renders `<QRCode value={DOWNLOAD_URL} size={size} fgColor="#0E0E10" bgColor="#FFFFFF" level="M" />` inside a wrapper with `role="img"` and `aria-label="QR code — scan with your phone camera to download the Mingla app"`.
- **Encodes:** `DOWNLOAD_URL` (`${SITE_ORIGIN}/download`) — the §4.2 route on the canonical marketing origin (NOT a store URL directly, so one QR serves both platforms).
- **Sizing:** default 200px (nav panel), 220px (desktop page); min 160px.
- **Contrast/quiet zone:** near-black `#0E0E10` on `#FFFFFF`, always on a solid white card even inside a dark/glass panel; `level="M"` error correction; ≥4-module quiet zone (library default padding + the white card).
- **Accessibility:** the `role="img"` + descriptive `aria-label` is the alt text; the raw `/download` URL is also shown as small selectable text beneath the QR for manual entry.

**Acceptance (top criterion):** the rendered QR is an inline SVG (no external request) encoding exactly `${SITE_ORIGIN}/download`; scanning it on a physical iPhone lands on the App Store listing and on a physical Android lands on Google Play.

**Fails-on-revert angle:** gate G-3 FAILS if `download-qr.tsx` encodes anything other than `DOWNLOAD_URL` from `lib/site.ts` (e.g. a hardcoded store URL, which would break the "one QR, both platforms" property).
**Adversarial angle:** gate G-3b (distinct) FAILS if the QR wrapper lacks `role="img"`/`aria-label` (a11y regression) OR if `bgColor` is set to a non-`#FFFFFF` / translucent value (contrast regression that breaks scanners).

---

### 4.4 KILL EMAIL CAPTURE

**Delete outright (files):**
- `mingla-marketing/components/marketing/get-the-app-modal.tsx` (the 2-step form + TestFlight success branch; TestFlight URL at `:794`).
- `mingla-marketing/lib/explorer-app-submit.ts` (the anon POST transport; fires `get_the_app_submitted` at `:88-93`).
- `mingla-marketing/lib/explorer-interest.ts` (the "All of it" reducer).
- `mingla-marketing/lib/explorer-interest.test.ts` + `mingla-marketing/lib/explorer-interest.tester.test.ts` (reducer unit tests — dead once the reducer is gone).

> **Order note:** extract `resolvePlatform`/`isIosDevice`/`detectPlatform` into `lib/device-platform.ts` (§4.0C) **before** deleting `get-the-app-modal.tsx`, since those functions currently live only there.

**Edit (`glass-nav.tsx`):** per §4.1 (drop the import + state + modal mount; rewire the CTA).

**Decommission the edge function (backend):** `supabase/functions/explorer-app-lead-submit/index.ts` (+ its `__tests__/`: `submit_happy.test.ts`, `submit_adversarial.test.ts`, `submit_tester_adversarial_orch1219.test.ts`).
- Nothing calls it after the transport is deleted.
- Remove its `config.toml` block (`supabase/config.toml:124-126` — `[functions.explorer-app-lead-submit]` / `verify_jwt = false`).
- **Delete the function directory** (source + tests). At deploy, the orchestrator runs `supabase functions delete explorer-app-lead-submit --project-ref gqnoajqerqhnvulmnyvv` (or leaves it deployed-but-dark — it has no caller). This also removes the last remaining `testflight.apple.com/join/1gvHNqkQ` occurrence (`index.ts:266`).
- **PRESERVE the data:** do **NOT** drop or alter `public.explorer_app_leads` (created by `supabase/migrations/20261124000000_orch_1216_explorer_app_leads.sql`, extended by `20261125000000_orch_1219_…`). Existing rows stay; RLS deny-anon-SELECT stays (see §6 — `I-1216-ANON-NO-SELECT` remains ACTIVE because the table still exists with real rows). **No migration** in this ORCH.

**Edge cases:**
- Any stray importer of the deleted modules → build/typecheck fails loudly (verified there are none outside the delete set + `glass-nav.tsx`).
- `beta-access-*` files import none of the deleted symbols (verified) — untouched.

**Acceptance (top criterion):** after the change, `grep -ri "explorer-app-submit\|explorer-interest\|GetTheAppModal\|get_the_app_submitted" mingla-marketing/` returns nothing (outside git history), the marketing build/typecheck passes, and `explorer_app_leads` row count is unchanged.

**Fails-on-revert angle:** gate G-1 (the same nav gate) also FAILS if `mingla-marketing/` regains a file named `explorer-app-submit`/`explorer-interest`/`get-the-app-modal` or a `get_the_app_submitted` capture.
**Adversarial angle:** a repo-wide gate G-4 FAILS if **any** `testflight.apple.com` token reappears anywhere under `mingla-marketing/` **or** `supabase/functions/` (catches someone "temporarily" restoring the beta link in the edge fn or a new component).

---

### 4.4b Remove the hardcoded TestFlight URL entirely

The literal `https://testflight.apple.com/join/1gvHNqkQ` currently appears in:
- `mingla-marketing/components/marketing/get-the-app-modal.tsx:794` (iOS success branch) — removed by deleting the file (§4.4).
- `supabase/functions/explorer-app-lead-submit/index.ts:266` (+ its use in `buildDownloadLinkEmail` `:268-356`) — removed by deleting the function (§4.4).

**After ORCH-1319 the token `testflight.apple.com` must appear in ZERO source files** (comments included). Enforced by gate **G-4** (§9), scanning `mingla-marketing/` + `supabase/functions/`.

---

### 4.5 RETIRE / AMEND / KEEP the strict-grep guards

All 8 live under `.github/scripts/strict-grep/`; jobs live in `.github/workflows/strict-grep-mingla-business.yml` (line refs below); invariants live in `Mingla_Artifacts/INVARIANT_REGISTRY.md` (line refs below).

| Guard file | Job (yml lines) | Registry line | Verdict | Why |
|---|---|---|---|---|
| `i-proposed-1216-testflight-behind-submit.mjs` | `orch-1216-testflight-behind-submit` (3251-3262) | 5308 | **RETIRE** | Requires the TestFlight URL to exist inside the (now-deleted) modal's iOS branch. Obsolete. |
| `i-proposed-1216-android-no-testflight-link.mjs` | `orch-1216-android-no-testflight-link` (3264-3275) | 5311 | **RETIRE** | Scans the deleted modal's non-iOS branch. Obsolete. |
| `i-proposed-1216-success-mount-gated.mjs` | `orch-1216-success-mount-gated` (3303-3314) | 5320 | **RETIRE** | Scans the deleted modal's `<SuccessPanel>` mount. Obsolete. |
| `i-proposed-1219-always-email-download-link.mjs` | `orch-1219-always-email-download-link` (3316-3327) | 5329 | **RETIRE** | Scans the deleted edge fn for the always-email TestFlight builder. Obsolete. |
| `i-proposed-1221-allpill-selects-all.mjs` | `orch-1221-allpill-selects-all` (3355-3366) | 5332 | **RETIRE** | Scans the deleted reducer + modal. Obsolete. |
| `i-proposed-1219-form-no-autoadvance-multiselect.mjs` | `orch-1219-form-no-autoadvance-multiselect` (3329-3340) | 5326 | **AMEND (do NOT delete)** | It scans **both** modals; `checkOrganiser` still protects the **live** `beta-access-modal.tsx`. Strip the explorer half; keep the organiser half. |
| `i-proposed-1216-explorer-only-cta.mjs` | `orch-1216-explorer-only-cta` (3290-3301) | 5317 | **AMEND (do NOT delete)** | The `GetTheAppModal`-explorer-only half is moot (no more modal), but the `BetaAccessModal`-organiser-only + no-cross-import half still protects the live beta modal. Strip the GetTheApp half; keep the Beta half. |
| `i-proposed-1216-no-service-key-client.mjs` | `orch-1216-no-service-key-client` (3277-3288) | 5314 | **KEEP (unchanged)** | **General security guard** — scans ALL of `mingla-marketing/` for any service-role/secret token. Now also protects the new `/download` route + device util + QR panel. |

> **⚠️ Forensic flag (deviates from the dispatch's suggested list):** the dispatch grouped `form-no-autoadvance-multiselect` under RETIRE. **It must NOT be deleted** — it is the *only* CI protection that the still-live organiser `BetaAccessModal` stays a no-auto-advance multi-select toggle group (registry line 5326, amended at ORCH-1221). Deleting it silently drops that protection. **AMEND** it (remove `checkExplorer`, the `EXPLORER` path, and the explorer self-test cases; keep `checkOrganiser` + its self-tests). Same reasoning applies to `explorer-only-cta`.

**AMEND detail — `i-proposed-1219-form-no-autoadvance-multiselect.mjs`:**
- Remove the `EXPLORER` const + `checkExplorer` function + the explorer entry in the live-mode loop (lines ~39, 45-80, 185).
- Keep `ORGANISER` + `checkOrganiser` (the beta modal is still multi-select/no-autoadvance).
- Remove the 4 explorer self-test cases; keep the 4 organiser cases; update the PASS banner count.
- Rename recommended → `i-proposed-organiser-form-no-autoadvance-multiselect.mjs` (optional; if kept as-is, update its header comment to state it is now organiser-only). Update the job name/description in the yml accordingly.

**AMEND detail — `i-proposed-1216-explorer-only-cta.mjs`:**
- In `checkNav`, remove the `<GetTheAppModal` mount assertion (it no longer mounts).
- Keep the `<BetaAccessModal` organiser-guard assertion.
- Remove the `GETAPP_MODAL` cross-ref checks; keep the `BETA_MODAL` no-cross-import check (now: "beta-access-modal must not import a get-the-app modal that no longer exists" → simplify to assert `BetaAccessModal` stays organiser-only).
- Update self-test fixtures + the job name.

**yml surgery:** delete the 5 RETIRE job blocks (yml 3251-3262, 3264-3275, 3303-3314, 3316-3327, 3355-3366) and update the 2 AMEND job blocks' `name:` + step descriptions. **Leave the `orch-1216-no-service-key-client` job (3277-3288) untouched.** Also prune the corresponding "Currently registered gates" comment lines at the top of the yml.

---

### 4.6 ANALYTICS

- **New tap event:** `captureMarketing('get_the_app_clicked', { platform, store, location })` where `platform ∈ {'ios','android','other'}`, `store ∈ {'app_store','play','qr_panel'}`, `location = 'nav'` (and `'download_page'` for badge clicks on `/download`, optional). Fired from the nav handler (§4.1) on every branch, and (optionally) from the `/download` desktop badge clicks + the QR panel badge clicks.
- **Removed event:** `get_the_app_submitted` (was fired in `lib/explorer-app-submit.ts:88`) — gone with the transport.
- **Removed event:** the old `marketing_cta_clicked {cta_id:'get_the_app'}` at the nav (`glass-nav.tsx:119-123`) is superseded by `get_the_app_clicked`. (Keep `marketing_cta_clicked {cta_id:'get_beta_access'}` on the organiser branch — untouched.)
- `captureMarketing` is the existing consent-gated, never-throws helper (`components/marketing/posthog-provider.tsx:110`); no new analytics plumbing.

**Acceptance (top criterion):** a nav tap on each of iOS / Android / desktop emits exactly one `get_the_app_clicked` with the correct `platform`+`store`; PostHog no longer receives `get_the_app_submitted`.

**Fails-on-revert angle:** gate G-1 asserts `glass-nav.tsx` contains a `get_the_app_clicked` capture (analytics not silently dropped).
**Adversarial angle:** the same gate asserts the nav contains **no** `get_the_app_submitted` token (the dead funnel event can't sneak back).

---

## 5. Cross-surface impact

| # | Surface | Covered | Behavior | Parity |
|---|---------|---------|----------|--------|
| 1 | Explorer Web (desktop) | YES | "Get the app" → QR panel; `/download` desktop page. | primary |
| 2 | Explorer Web (mobile browser) | YES | "Get the app" → direct store; `/download` → 307 to store. | same code |
| 3 | Organiser/Business marketing (`/business`) | NO | `BetaAccessModal` + beta waitlist untouched (§3). | verify green |
| 4 | Consumer iOS/Android native | NO | No change; store listings already live. | n/a |
| 5 | Backend (edge fn) | YES | `explorer-app-lead-submit` decommissioned; `explorer_app_leads` rows preserved. | Supabase |
| 6 | SEO/crawlers | YES | `/download` returns real HTML for non-mobile UAs. | automatic |

**Ship channels:** marketing client → **Vercel `[deploy]`** (REQUIRED tag). Edge decommission → Supabase (`functions delete` + config removal), operator/prod-gated.

---

## 6. Invariants

**New (DRAFT → ACTIVE at CLOSE):**
- **I-1319-GETAPP-CTA-LINKS-LIVE-STORES-NOT-TESTFLIGHT** — the explorer "Get the app" CTA and the `/download` route resolve **only** to the live App Store (`apps.apple.com/app/id6760440898`) / Google Play (`…id=com.mingla.app.v2`) URLs (from `lib/store-links.ts`), driven by the detected platform; **never** a TestFlight/beta URL and **never** a lead/PII form. Gate = §9 **G-1** + **G-2** + **G-4**.
- **I-1319-NO-DOWNLOAD-GATE** — there is **no** PII/lead-capture (name/email/city/interest form, no POST to a lead edge fn) on the explorer "Get the app" path or the `/download` route; capture of new explorer app leads is stopped. Gate = §9 **G-1** (no form/transport tokens) + **G-4** (no testflight token).
- **I-1319-DOWNLOAD-ROUTE-UA-REDIRECT** *(optional, recommended)* — `app/download/page.tsx` redirects iOS/Android UAs to the two live store URLs via `resolvePlatformFromUa` and renders the QR+badges page for other UAs, SSR-safe (no `navigator`/`window`). Gate = §9 **G-2/G-2b**.

**DECOMMISSIONED at CLOSE (were ACTIVE from ORCH-1216/1219/1221):**
- `I-1216-TESTFLIGHT-BEHIND-SUBMIT` (registry 5308) — the gate + rule die; app is live on stores.
- `I-1216-ANDROID-NO-TESTFLIGHT-LINK` (5311) — die.
- `I-1216-SUCCESS-MOUNT-GATED` (5320) — die.
- `I-1219-ALWAYS-EMAIL-DOWNLOAD-LINK` (5329) — die.
- `I-1221-ALLPILL-SELECTS-ALL` (5332) — die.
  Mark each registry section **DECOMMISSIONED (ORCH-1319, 2026-07-…)** with a one-line reason + the superseding invariant, per house style.

**AMENDED (narrowed to organiser-only) at CLOSE:**
- `I-1219-FORM-NO-AUTOADVANCE-MULTISELECT` (5326) — rule text narrows to the organiser `BetaAccessModal` only (the explorer clause is removed; the gate's explorer half is stripped). Stays ACTIVE for the beta modal.
- `I-1216-EXPLORER-ONLY-CTA` (5317) — narrows to "`BetaAccessModal` mounts organiser-only" (the `GetTheAppModal` clause is removed). Stays ACTIVE for the beta modal. *(Alternatively fully decommission if the team accepts a single-modal nav; AMEND is the conservative recommendation.)*

**PRESERVED (unchanged, still ACTIVE):**
- `I-1216-NO-SERVICE-KEY-CLIENT` (5314) — general security guard; generalize its rule wording to drop the specific `lib/explorer-app-submit.ts` mention (the scan is repo-wide over `mingla-marketing/` and still valid).
- `I-1216-ANON-NO-SELECT` (5323) — the `explorer_app_leads` table still exists with real rows; anon must still be denied SELECT. **Keep ACTIVE** (data preserved).

---

## 7. Test cases

| Test | Scenario | Expected | Layer |
|------|----------|----------|-------|
| T-1 | nav CTA, iOS UA | opens `APP_STORE_URL`; one `get_the_app_clicked {platform:'ios',store:'app_store'}`; no modal | client (jest/RTL) |
| T-2 | nav CTA, Android UA | opens `PLAY_STORE_URL`; `{platform:'android',store:'play'}` | client |
| T-3 | nav CTA, desktop UA | opens QR dialog (role=dialog, ESC closes, focus trapped+restored); `{platform:'other',store:'qr_panel'}` | client |
| T-4 | `GET /download`, iPhone UA | 3xx → `APP_STORE_URL` | route (integration) |
| T-5 | `GET /download`, Android UA | 3xx → `PLAY_STORE_URL` | route |
| T-6 | `GET /download`, desktop/curl UA | 200 HTML with QR (svg) + both store badges; no form | route |
| T-7 | QR value | `download-qr` encodes exactly `${SITE_ORIGIN}/download`; svg inline; role=img+aria-label | client |
| T-8 | `resolvePlatform`/`isIosDevice` parity | iPad-as-Mac→ios, Android→android, Win/Mac→other (byte-identical to originals) | unit |
| T-9 | no-testflight sweep | zero `testflight.apple.com` under `mingla-marketing/` + `supabase/functions/` | CI (G-4) |
| T-10 | data preserved | `explorer_app_leads` rows unchanged; anon SELECT still denied | DB (manual/live-fire) |
| T-11 | beta modal untouched | `BetaAccessModal` still multi-select/no-autoadvance (amended gate green) | CI |
| T-12 | build/typecheck | `next build` + `tsc --noEmit` pass with no dangling imports | CI |

Runtime proof (physical-device-first): scan the rendered QR with a physical iPhone → App Store listing; with a physical Android → Play listing (per the always-simulate/real-device testing rule).

---

## 8. Implementation order

1. **Shared constants + util (§4.0):** `lib/store-links.ts`, `lib/site.ts`, `lib/device-platform.ts` (+ unit test T-8); update `app-store-badges.tsx` defaults; add `NEXT_PUBLIC_SITE_URL` to `.env.example`.
2. **QR (§4.3):** add `react-qr-code` to `package.json`; create `components/marketing/download-qr.tsx`.
3. **Nav (§4.1):** rewire `glass-nav.tsx` + add `components/marketing/app-qr-panel.tsx`.
4. **Route (§4.2):** add `app/download/page.tsx`.
5. **Analytics (§4.6):** `get_the_app_clicked` in the nav (+ optional `/download`).
6. **Kill capture (§4.4/4.4b):** delete modal + transport + reducer + reducer tests + edge fn dir + `config.toml` block.
7. **Guards (§4.5):** delete 5 gate files + their yml jobs; amend 2 gate files + their yml jobs; leave the security gate; prune the yml gate-index comments.
8. **Registry (§6):** flip 5 → DECOMMISSIONED, narrow 2, keep 2; register the new DRAFT invariants.
9. **Verify:** run every remaining strict-grep `--self-test` + live run, `next build`, `tsc --noEmit`, jest, plus a physical-device QR scan; then merge with **`[deploy]`** and run `supabase functions delete explorer-app-lead-submit`.

---

## 9. Regression prevention (fails-on-revert + adversarial)

Each gate ships with `--self-test` (GOOD passes, BAD fails), wired as a job in `strict-grep-mingla-business.yml`, comment-stripped.

- **G-1 — `.github/scripts/strict-grep/orch-1319-getapp-cta-direct-store.mjs` (NEW).** Over `glass-nav.tsx` (comment-stripped): (a) contains `APP_STORE_URL` **and** `PLAY_STORE_URL` (or imports from `lib/store-links`) and a `detectClientPlatform()` call; (b) contains a `get_the_app_clicked` capture; (c) does **NOT** import `get-the-app-modal` / reference `GetTheAppModal` / contain `testflight` / `get_the_app_submitted` / any email-lead form token. **Adversarial (G-1b):** FAIL if the iOS/Android destinations are chosen without reference to the resolved platform (e.g. only `APP_STORE_URL` present, or a hardcoded single branch) — the store must be platform-driven.
- **G-2 — `orch-1319-download-route-ua.mjs` (NEW).** Over `app/download/page.tsx`: references `resolvePlatformFromUa`/`headers()`, both `APP_STORE_URL` and `PLAY_STORE_URL` (via `store-links`), a `redirect(` call, and renders the QR (`DownloadQr`/`download-qr`) + `AppStoreBadges`. **Adversarial (G-2b):** FAIL if the redirect targets are inline string literals rather than the shared constants, OR if the page reads `navigator`/`window` (SSR-unsafe), OR if it contains a form/`explorer-app` token.
- **G-3 — `orch-1319-qr-encodes-download-url.mjs` (NEW).** Over `download-qr.tsx`: the `<QRCode value=…>` binds `DOWNLOAD_URL` from `lib/site` (not a literal store URL). **Adversarial (G-3b):** FAIL if the wrapper lacks `role="img"`+`aria-label`, or `bgColor` is not `#FFFFFF`.
- **G-4 — `orch-1319-no-testflight-anywhere.mjs` (NEW).** Repo-scan of `mingla-marketing/` + `supabase/functions/`: FAIL if the token `testflight.apple.com` appears in **any** file (source or comment). This is the single hard proof the beta link is gone forever.
- **Amended gates stay green:** `i-proposed-1219-form-no-autoadvance-multiselect` (organiser-only) + `i-proposed-1216-explorer-only-cta` (beta-organiser-only) must pass on the untouched `beta-access-modal.tsx`.
- **Security gate stays green:** `i-proposed-1216-no-service-key-client` must pass over the new files (no secrets in `/download`, the util, or the QR panel).
- Behavioral: jest T-1..T-3/T-7/T-8; a route integration test T-4..T-6; a live DB read for T-10.

---

## 10. Allowlist + DO-NOT-TOUCH

### Allowlist (files this ORCH may create/edit/delete)
**Create:**
- `mingla-marketing/lib/store-links.ts`, `mingla-marketing/lib/site.ts`, `mingla-marketing/lib/device-platform.ts`
- `mingla-marketing/components/marketing/download-qr.tsx`, `mingla-marketing/components/marketing/app-qr-panel.tsx`
- `mingla-marketing/app/download/page.tsx`
- `.github/scripts/strict-grep/orch-1319-getapp-cta-direct-store.mjs`, `orch-1319-download-route-ua.mjs`, `orch-1319-qr-encodes-download-url.mjs`, `orch-1319-no-testflight-anywhere.mjs`
- append-only tests under `mingla-marketing/**` (jest/route/unit)

**Edit:**
- `mingla-marketing/components/marketing/glass-nav.tsx` (explorer branch only)
- `mingla-marketing/components/ui/app-store-badges.tsx` (default hrefs)
- `mingla-marketing/package.json` (add `react-qr-code`)
- `mingla-marketing/.env.example` (add `NEXT_PUBLIC_SITE_URL`)
- `.github/workflows/strict-grep-mingla-business.yml` (delete 5 jobs, amend 2, add 4, prune the gate-index comments)
- `.github/scripts/strict-grep/i-proposed-1219-form-no-autoadvance-multiselect.mjs` + `i-proposed-1216-explorer-only-cta.mjs` (amend to organiser-only)
- `supabase/config.toml` (remove the `[functions.explorer-app-lead-submit]` block, lines 124-126)
- `Mingla_Artifacts/INVARIANT_REGISTRY.md` (decommission 5, narrow 2, add DRAFT)

**Delete:**
- `mingla-marketing/components/marketing/get-the-app-modal.tsx`
- `mingla-marketing/lib/explorer-app-submit.ts`, `mingla-marketing/lib/explorer-interest.ts`, `mingla-marketing/lib/explorer-interest.test.ts`, `mingla-marketing/lib/explorer-interest.tester.test.ts`
- `supabase/functions/explorer-app-lead-submit/` (whole dir incl. `__tests__/`)
- `.github/scripts/strict-grep/i-proposed-1216-testflight-behind-submit.mjs`, `i-proposed-1216-android-no-testflight-link.mjs`, `i-proposed-1216-success-mount-gated.mjs`, `i-proposed-1219-always-email-download-link.mjs`, `i-proposed-1221-allpill-selects-all.mjs`

### DO-NOT-TOUCH
- **The entire organiser/business beta funnel:** `beta-access-modal.tsx`, `lib/beta-access-submit.ts`, `supabase/functions/beta-access-lead-submit/` (+ `config.toml:117-118`), the `beta_access_leads` table. **Verify green, change nothing.**
- **`public.explorer_app_leads` table + its rows + RLS** (data preserved; no migration).
- **`i-proposed-1216-no-service-key-client.mjs`** gate + its job — the security guard stays exactly as-is.
- The organiser CTA path in `glass-nav.tsx` (`:95-111`, `:135-141`).
- Any app-mobile / consumer-native code, store listings, other marketing routes/sections.

---

### Appendix — file:line evidence index
- Nav trigger (the ONLY "Get the app" trigger): `glass-nav.tsx:8` (import), `:36` (state), `:112-130` (explorer CTA), `:143-150` (explorer modal mount); organiser (keep): `:95-111`, `:135-141`.
- Reusable device detection to extract: `get-the-app-modal.tsx:75-86` (`isIosDevice`), `:93-101` (`resolvePlatform`), `:104-111` (`detectPlatform`).
- Hardcoded TestFlight URL: `get-the-app-modal.tsx:794` (iOS success branch) + `supabase/functions/explorer-app-lead-submit/index.ts:266` (+ `buildDownloadLinkEmail` `:268-356`).
- Submit path + dead analytics: `lib/explorer-app-submit.ts` (`get_the_app_submitted` at `:88-93`); reducer `lib/explorer-interest.ts`.
- Edge fn config: `supabase/config.toml:124-126`.
- Stale badge hrefs to fix: `components/ui/app-store-badges.tsx:14-15`.
- Table migrations (preserve): `supabase/migrations/20261124000000_orch_1216_explorer_app_leads.sql`, `20261125000000_orch_1219_explorer_interest_multi_platform_android.sql`.
- Guard jobs in `.github/workflows/strict-grep-mingla-business.yml`: 3251-3262, 3264-3275, 3277-3288 (KEEP), 3290-3301 (AMEND), 3303-3314, 3316-3327, 3329-3340 (AMEND), 3355-3366.
- Registry rows: 5308, 5311, 5314 (KEEP), 5317 (AMEND), 5320, 5323 (KEEP), 5326 (AMEND), 5329, 5332.
- QR library: **absent** from `mingla-marketing/package.json` (deps enumerated §4.3).
