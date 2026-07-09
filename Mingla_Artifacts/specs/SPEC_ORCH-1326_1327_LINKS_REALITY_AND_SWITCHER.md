# SPEC — ORCH-1326 [links-business-tab-reflects-live-app] + ORCH-1327 [links-tab-switcher-swing]

**Phase:** SPEC → IMPLEMENT
**Surface:** `mingla-marketing/` ONLY — `usemingla.com/links`. Next.js 15 App Router, framer-motion 11.18.2, React 19. **No app/native, no Supabase/edge/migration, no explorer-home / business-home change.**
**Two tightly-coupled items, ONE page, ONE worktree, ONE PR.** Pattern parents: ORCH-1319 (`/download` smart route), ORCH-1324 (business device-aware CTA + its spec/guard/test shape).
**Ship channel:** Vercel — **`[deploy]` commit tag REQUIRED** on merge (marketing touched). `main` PR-protected → PR + `gh pr merge --squash --admin`, all CI green first. **CLOSE commit body MUST include `[TEST-MOD-APPROVED ORCH-1326]`** (§4.3 deletes lines in an existing test file).
**SSOT constants (already present, ORCH-1324 — never hardcode):** `BUSINESS_APP_STORE_URL = 'https://apps.apple.com/app/id6768737367'`, `BUSINESS_WEB_URL = 'https://business.usemingla.com'` in `lib/store-links.ts`.

---

## 1. Executive summary (layman first)

- **ORCH-1327 (bug):** the Explorer / For Business toggle pill swings in a diagonal arc instead of sliding. Proven by driving the live page: the pill starts ~150px low / ~170px left and sweeps up-and-across (INVESTIGATION §2). Root cause: the highlight is a framer-motion `layoutId` element **mounted/unmounted per tab**, so framer projects it from a wrong mid-reflow origin. **Fix:** one **persistent** absolutely-positioned pill that slides its `x` between the two equal-width slots — proven by re-driving to remove the arc entirely (vertical translate pinned at 0, straight monotonic slide).
- **ORCH-1326 (reality):** the Business tab still says "Get started on the web" → `/business`. The business app is now live (ORCH-1324). **Fix:** new server smart-redirect `/business/download` (iPhone → business App Store, else → business web) + repoint the Business tab CTA + honest copy.

Preserve: reduced-motion, the WAI-ARIA roving-tabindex + arrow-key a11y, the `text-white`/`text-white/60` color states, the §1 one-viewport no-scroll SNAPSHOT contract, and the store-URL SSOT (import consts, never hardcode).

---

## 2. Scope & non-goals

### In scope
- **ORCH-1327:** rewrite the tablist highlight in `components/marketing/links-experience.tsx` from the mount/unmount `layoutId` pill to ONE persistent `x`-animated pill (§4.1). New guard + 2 append-only tests + invariant.
- **ORCH-1326:** new route `app/business/download/page.tsx` (§4.2); `lib/links-config.ts` business-tab edits + `LINKS_BUSINESS_DOWNLOAD_PATH` (§4.3); `links-config.tester.test.ts` business-tab assertion update (§4.3); new guard + tester-adversarial route test + invariant.
- Wire 2 strict-grep jobs into `strict-grep-mingla-business.yml` (§5). Register 2 DRAFT invariants (§7).

### Non-goals (DO NOT TOUCH)
- Explorer tab data/copy/CTA; the tagline; the 7 socials + `socialHref`; the surface-aware social swap (all accurate).
- `app/download/page.tsx`, `lib/store-links.ts` value lines, `lib/device-platform.ts`, `lib/subdomain.ts`, `next.config` — read-only dependencies.
- The ORCH-1319 (4) + ORCH-1324 guards and their jobs — leave green.
- `glass-nav.tsx` / `hero.tsx` / any business-home or explorer-home section.
- The one-viewport SNAPSHOT structure, the entrance `motion.div`, the panel crossfade `motion.div`.
- No new npm dependency (framer-motion already present).

---

## 3. The swing — root cause (proven; carry into IMPLEMENT verify)

Driven on the live page (INVESTIGATION §2): the `layoutId="links-tab-pill"` pill, **conditionally mounted per tab**, is projected by framer-motion from an origin offset **+157px vertically / −172px horizontally** at switch start → a diagonal arc to target (width/scale constant → NOT a warp; a *position-projection* arc). No ancestor has an active `transform` at switch time (all `transform: none`; only `backdrop-filter: blur(30px)` on the `.glass-soft` tablist). It is the ONLY `layoutId` in the app, with no `LayoutGroup`/`AnimatePresence`. The persistent-pill rewrite eliminates all layout projection → straight slide (re-driven: `ty=0` every frame). Implementor MUST re-drive to reconfirm (§9).

---

## 4. Layered specification

### 4.1 ORCH-1327 — switcher rewrite (`components/marketing/links-experience.tsx`)

**Context:** the tablist block (lines ~210-254). `activeIndex` already exists (`const activeIndex = LINKS_TABS.findIndex((t) => t.id === activeId)`, line ~103) — reuse it. `reduced` = `useMinglaReducedMotion()`.

**(a) Make the tablist a positioning context** — add `relative` to its className (line ~215):
```
className="relative glass-soft mt-6 flex gap-1 rounded-full p-1"
```

**(b) Insert ONE persistent pill as the FIRST child of the tablist, before the `{LINKS_TABS.map(...)}`:**
```tsx
{/* ORCH-1327 — the active-tab highlight is ONE PERSISTENT, absolutely-positioned
    pill that slides its horizontal position between the two equal-width tab
    slots. It replaces the previous conditionally-mounted `layoutId` pill, whose
    mount/unmount forced a cross-instance framer-motion layout projection that
    read a wrong mid-reflow origin and swung the pill in a diagonal ARC
    (INVESTIGATION_ORCH-1326_1327 §2). No layoutId, no mount/unmount, no layout
    projection → a straight, crisp slide, immune to ancestor transform/filter.
    Geometry (exactly two equal `flex-1` tabs in a `p-1` container with `gap-1`):
    slot width = calc(50% - 6px); slot-to-slot shift = one own-width + the 4px gap
    = calc(100% + 4px), so x = activeIndex * that. */}
<motion.div
  aria-hidden="true"
  className="pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm"
  style={{ width: 'calc(50% - 0.375rem)' }}
  initial={false}
  animate={{ x: `calc(${activeIndex} * (100% + 0.25rem))` }}
  transition={
    reduced
      ? { duration: 0 }
      : { type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }
  }
/>
```

**(c) Remove the per-button pill.** Delete the entire `{selected ? (<motion.span layoutId="links-tab-pill" … />) : null}` block (lines ~237-249). Keep the label `<span className="relative z-10">{tab.label}</span>` exactly as-is.

**(d) The `<button>` stays otherwise identical** — `role="tab"`, `id`, `aria-selected={selected}`, `aria-controls`, `tabIndex={selected ? 0 : -1}`, `onClick`, `onKeyDown`, and the className with `relative … text-white`/`text-white/60`. The `selected` const is still used by `aria-selected`, `tabIndex`, and the color className, so it stays computed inside the `.map`.

**Acceptance:**
- No `layoutId` remains anywhere in the file.
- Exactly one `bg-warm` `motion` pill, rendered OUTSIDE the `.map`, with `initial={false}` and `animate={{ x: … }}`.
- Reduced motion: the pill transition is `{ duration: 0 }` when `reduced`.
- A11y unchanged: `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, `tabIndex={selected ? 0 : -1}`, `onKeyDown={(e) => onTabKeyDown(e, i)}`, and `onTabKeyDown` (Arrow/Home/End) intact.
- Color states unchanged.
- `next build` + `tsc --noEmit` pass. `activeIndex` typed `number` — `calc(${activeIndex} * …)` is a valid string template.

**Edge cases:** exactly 2 tabs today (pinned by `links-config.tester.test.ts`); the `x` multiplier `activeIndex * (100% + gap)` generalizes to N equal tabs, only the width `calc(50% - 6px)` is 2-specific (documented in the comment). Reduced motion → instant reposition (no arc, no fade). No hover/tap on the pill (`pointer-events-none`) — taps land on the buttons.

---

### 4.2 ORCH-1326 — new smart route `app/business/download/page.tsx` (CREATE)

Parity with `app/download/page.tsx`, minus the QR/badges desktop branch (business owners on desktop go straight to the web app):

```tsx
// ORCH-1326 [links business tab reflects the live app] — the business SMART
// DOWNLOAD route (usemingla.com/business/download). Parity with app/download/
// page.tsx (ORCH-1319) but BUSINESS + no QR/landing: business owners on desktop
// go straight to the web app. iPhone → the live business App Store; everyone else
// (Android — Play still in review — + desktop/other/bot) → the business web app.
//
// SSR-safe SERVER Component: reads the request User-Agent header only, never
// `navigator`/`window`. Store/web destinations come from lib/store-links.ts
// (ORCH-1324 SSOT) — NEVER hardcoded here.

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { resolvePlatformFromUa } from '@/lib/device-platform'
import { BUSINESS_APP_STORE_URL, BUSINESS_WEB_URL } from '@/lib/store-links'

// Reads request headers → must not be statically cached.
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Get Mingla Business',
  description:
    'Get the Mingla Business app on iPhone, or run it in your browser.',
}

export default async function BusinessDownloadPage() {
  const ua = (await headers()).get('user-agent') ?? ''
  const platform = resolvePlatformFromUa(ua)

  // iPhone → the live business App Store; everyone else → the business web app.
  if (platform === 'ios') redirect(BUSINESS_APP_STORE_URL)
  redirect(BUSINESS_WEB_URL)
}
```

**Acceptance:** always redirects (307) — iOS → `BUSINESS_APP_STORE_URL`, all else → `BUSINESS_WEB_URL`; both imported from `lib/store-links`; no `DownloadQr`/`AppStoreBadges` import; no `navigator`/`window`; no `apps.apple.com`/`business.usemingla.com` string literal; no `PLAY_STORE_URL` (business Android → web); no `<form>`/`type="email"`/testflight. `redirect()` to the external `BUSINESS_WEB_URL` is valid in Next 15.

---

### 4.3 ORCH-1326 — `lib/links-config.ts` + `links-config.tester.test.ts` (EDIT)

**`lib/links-config.ts`:**
1. Add, next to `LINKS_BUSINESS_PATH` (line ~48):
```ts
// ORCH-1326 — the business DEVICE-SMART route (iPhone → business App Store,
// else → business.usemingla.com). Mirrors LINKS_DOWNLOAD_PATH for the business
// surface; it is NOT a store URL, so it does not violate the SSOT guard.
export const LINKS_BUSINESS_DOWNLOAD_PATH = '/business/download'
```
Keep `export const LINKS_BUSINESS_PATH = BUSINESS_PATH` (still exported; the tester pins `LINKS_BUSINESS_PATH === BUSINESS_PATH`, and it documents the `/business` surface).

2. Business tab entry (lines ~65-79):
```ts
{
  id: 'business',
  label: 'For Business',
  eyebrow: 'For venues & organizers',
  heading: 'Run a venue, event, or trip?',
  body: 'Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web.',
  cta: {
    label: 'Get the app',
    href: LINKS_BUSINESS_DOWNLOAD_PATH,
    destination: 'business_download',
    intent: 'glass',
  },
},
```
(Copy per §11 FLAG — orchestrator to confirm with Seth before build. `intent: 'glass'` unchanged. Heading/eyebrow unchanged.)

**`lib/links-config.tester.test.ts`** — **requires `[TEST-MOD-APPROVED ORCH-1326]`** (deletes assertion lines):
1. Add `LINKS_BUSINESS_DOWNLOAD_PATH` to the import from `./links-config` (line ~19-23).
2. Replace the case *"Business CTA targets the shared /business path (usemingla.com/business)"* (lines ~70-79) with:
```ts
// ── Business CTA → the device-smart /business/download route (ORCH-1326) ─────
// The business app is live on the App Store; the CTA now routes per device
// (iPhone → business App Store, else → business.usemingla.com) via the new
// /business/download server route — NOT the bare /business marketing page.
[
  'Business CTA targets the device-smart /business/download route (ORCH-1326)',
  () => {
    const biz = LINKS_TABS.find((t) => t.id === 'business')!
    assert(biz.cta.href === LINKS_BUSINESS_DOWNLOAD_PATH, `business href = ${biz.cta.href}`)
    assert(biz.cta.href === '/business/download', `business href not /business/download: ${biz.cta.href}`)
    assert(biz.cta.href !== '/business', 'business CTA must NOT be the bare /business page (app is live)')
    assert(biz.cta.destination === 'business_download', `business destination = ${biz.cta.destination}`)
    // The /business surface path constant still derives from the shared source.
    assert(LINKS_BUSINESS_PATH === BUSINESS_PATH, 'links business path drifted from subdomain BUSINESS_PATH')
  },
],
```
Keep the *"no tab CTA hardcodes an App Store / Play / store URL"* case as-is — it still passes (`/business/download` matches no store pattern). The Explorer + socials cases are untouched.

**Acceptance:** the tester passes via the documented `tsc … && node` invocation; the new file `LINKS_BUSINESS_DOWNLOAD_PATH` is imported and pinned; fails-on-revert (reverting `href` to `/business` fails the `!== '/business'` + `=== '/business/download'` assertions).

---

## 5. CI wiring — `strict-grep-mingla-business.yml` (EDIT)

Add two jobs (mirror the ORCH-1324 job block, lines ~3341-3352) after the ORCH-1324 job, and add their gate-index comment lines near the ORCH-1324 index comment (~line 172):

```yaml
  orch-1327-links-tab-switcher-persistent-pill:
    name: "ORCH-1327: /links tab switcher uses ONE persistent x-animated pill (no layoutId mount/unmount swing), reduced-motion + roving-tabindex a11y preserved (I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Self-test the ORCH-1327 links-tab-switcher gate
        run: node .github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs --self-test
      - name: Run ORCH-1327 links-tab-switcher gate
        run: node .github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs

  orch-1326-links-business-download-route:
    name: "ORCH-1326: /business/download smart route + /links business CTA are device-aware (iOS→business App Store, else→business web) via store-links consts, no QR/hardcode (I-PROPOSED-1326-LINKS-BUSINESS-TAB-DEVICE-AWARE)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Self-test the ORCH-1326 links-business-download-route gate
        run: node .github/scripts/strict-grep/orch-1326-links-business-download-route.mjs --self-test
      - name: Run ORCH-1326 links-business-download-route gate
        run: node .github/scripts/strict-grep/orch-1326-links-business-download-route.mjs
```
Match the file's exact `with:` block style (multi-line if the file uses multi-line). Add the two `#   - I-PROPOSED-13xx-…` index comment lines describing each gate.

---

## 6. The two new strict-grep guards (model: `orch-1319-download-route-ua.mjs`)

Both `.mjs` follow house style: `root` = cwd-aware (`endsWith('mingla-marketing') ? .. : cwd`), `stripComments`, `--self-test` with a GOOD fixture + one fixture per violation + a comment-strip case, `fs.existsSync` FAIL if target missing, exit non-zero on any failure.

### 6.1 `orch-1327-links-tab-switcher-persistent-pill.mjs`
**Target (comment-stripped):** `mingla-marketing/components/marketing/links-experience.tsx`.
**REQUIRE:**
1. `role="tablist"` AND `role="tab"` present (still a tablist).
2. `aria-selected={` AND `tabIndex={selected ? 0 : -1}` (roving tabindex preserved).
3. `onTabKeyDown` referenced AND both `ArrowRight` and `ArrowLeft` present in the file (arrow-key nav preserved).
4. A persistent pill: `initial={false}` present AND `animate={{ x:` present AND `bg-warm` present (the sliding pill).
5. Reduced-motion honored: a `{ duration: 0 }` transition tied to `reduced` (assert both `reduced` and `duration: 0` present).
6. Color states: `text-white` AND `text-white/60` present.
**BAN (regression):**
- `layoutId` — the mount/unmount shared-pill projection must never return (**the core swing guard**).
- `{selected ? (` immediately followed by a `motion` element (heuristic: ban `selected ? (` on the same/next line as `<motion` — i.e. a conditionally-mounted pill). Keep this narrow: BAN the substring `layoutId` (primary), and additionally FAIL if a `motion.span`/`motion.div` appears inside a `selected ?` ternary. Primary hard-ban is `layoutId`.
**Self-test (≥7):** GOOD (persistent pill, no layoutId, all a11y) → pass; `layoutId` present → fire; missing `initial={false}` → fire; missing `tabIndex={selected ? 0 : -1}` → fire; missing `reduced`/`duration: 0` → fire; missing `ArrowLeft` → fire; a `layoutId` token inside a comment → stripped → GOOD still passes.

### 6.2 `orch-1326-links-business-download-route.mjs`
**Targets (comment-stripped):** `mingla-marketing/app/business/download/page.tsx` AND `mingla-marketing/lib/links-config.ts`.
**Route REQUIRE:** `headers(` ; `resolvePlatformFromUa` ; BOTH `BUSINESS_APP_STORE_URL` and `BUSINESS_WEB_URL` ; a `redirect(` call ; branches on `platform ===` (device-driven).
**Route BAN (adversarial — the deliberate business differences + SSOT):** `apps\.apple\.com` / `business\.usemingla\.com` literals (must use consts) ; `\bnavigator\b` / `\bwindow\b` (SSR-safe) ; `DownloadQr` / `AppStoreBadges` / `<QRCode` (NO QR — the difference from `/download`) ; `<form` / `type="email"` ; `testflight` (i) ; `PLAY_STORE_URL` (business Android → web, never Play). **G-b:** FAIL if `BUSINESS_WEB_URL` absent (non-iOS stranded) or no `platform ===` (single hardcoded destination).
**Config REQUIRE:** `links-config.ts` references `LINKS_BUSINESS_DOWNLOAD_PATH` AND the string `'/business/download'` ; and does NOT set the business tab back to a bare `/business` CTA (heuristic: the token `destination: 'business_download'` present).
**Self-test (≥8):** GOOD → pass; route missing `resolvePlatformFromUa` → fire; route inlines `apps.apple.com` → fire; route reads `window` → fire; route imports `DownloadQr` → fire; route missing `BUSINESS_WEB_URL` → fire; route references `PLAY_STORE_URL` → fire; config missing `'/business/download'` → fire; commented banned token → stripped → GOOD passes.

---

## 7. Invariants — `Mingla_Artifacts/INVARIANT_REGISTRY.md` (register DRAFT; flip ACTIVE at CLOSE)

**`I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL` (DRAFT):** The `usemingla.com/links` Explorer/Business segmented switcher (`components/marketing/links-experience.tsx`) renders its active-tab highlight as **ONE persistent, absolutely-positioned `bg-warm` pill** (child of the `relative` tablist) that animates its horizontal `x` between the two equal-width slots (`initial={false}`, tween `0.18s`), with **NO `layoutId`** and no per-tab mount/unmount — eliminating the framer-motion cross-instance layout-projection ARC (proven driven: vertical translate pinned at 0). Reduced motion → `{ duration: 0 }` instant reposition. The WAI-ARIA roving-tabindex tablist (`role=tablist/tab`, `aria-selected`, `tabIndex={selected?0:-1}`, Arrow/Home/End via `onTabKeyDown`) and the `text-white`/`text-white/60` states survive. **Enforcement:** `orch-1327-links-tab-switcher-persistent-pill.mjs` (`--self-test`) as job `orch-1327-links-tab-switcher-persistent-pill` + append-only `links-tab-switcher.test.ts` (happy-path) + `links-tab-switcher.tester.test.ts` (adversarial).

**`I-PROPOSED-1326-LINKS-BUSINESS-TAB-DEVICE-AWARE` (DRAFT):** The `usemingla.com/links` **Business tab** CTA targets the device-smart server route `/business/download` (`LINKS_BUSINESS_DOWNLOAD_PATH`, `destination: 'business_download'`), NOT the bare `/business` page. `app/business/download/page.tsx` resolves the request UA via `headers()` + `resolvePlatformFromUa` and `redirect()`s **iOS → `BUSINESS_APP_STORE_URL`, all else → `BUSINESS_WEB_URL`** (both from `lib/store-links.ts` — never hardcoded), SSR-safe (no `navigator`/`window`), with **NO QR/badges/form** (the deliberate difference from `/download`) and **no `PLAY_STORE_URL`** (business Android → web). Mirrors ORCH-1324 reality (business app live on App Store). **Enforcement:** `orch-1326-links-business-download-route.mjs` (`--self-test`) as job `orch-1326-links-business-download-route` + the updated `links-config.tester.test.ts` (happy-path) + `business-download-route.tester.test.ts` (adversarial).

---

## 8. Regression triads (append-only tests — tsc/node source pins, model: `business-getapp-cta.test.ts`)

Run from `mingla-marketing/` via `npx tsc <file> --outDir /tmp/o --module commonjs --target es2020 --moduleResolution node && node /tmp/o/<file>.js` (marketing has no jest runner).

**ORCH-1327 triad:**
1. **Guard** `orch-1327-links-tab-switcher-persistent-pill.mjs` (§6.1) — source-level fails-on-revert (re-adding `layoutId` fires).
2. **Implementor happy-path** `components/marketing/__tests__/links-tab-switcher.test.ts` — read `links-experience.tsx`; assert it contains `initial={false}`, `animate={{ x`, a single `bg-warm` motion pill, the `reduced`+`duration: 0` branch, and the roving `tabIndex={selected ? 0 : -1}`. Fails-on-revert: the old `layoutId` pill has none of `initial={false}`/`animate={{ x`.
3. **Tester adversarial** `components/marketing/__tests__/links-tab-switcher.tester.test.ts` — assert the NEGATIVE space: NO `layoutId` anywhere; NO `motion` element inside a `selected ?` ternary (no conditional mount); the pill is `aria-hidden`; a11y intact (`role="tab"`, `aria-selected`, `onTabKeyDown`, both `ArrowLeft`/`ArrowRight`, `Home`/`End`). Different angle: proves mount/unmount projection is gone AND a11y survives.

**ORCH-1326 triad:**
1. **Guard** `orch-1326-links-business-download-route.mjs` (§6.2) — source-level fails-on-revert.
2. **Implementor happy-path** = the updated `lib/links-config.tester.test.ts` case (§4.3) — pins `/business/download` + `business_download` + `LINKS_BUSINESS_PATH === BUSINESS_PATH`. Fails-on-revert: reverting `href` to `/business` fails.
3. **Tester adversarial** `app/business/download/__tests__/business-download-route.tester.test.ts` — read the route source; assert it does NOT import `DownloadQr`/`AppStoreBadges` (no QR), contains NO `apps.apple.com`/`business.usemingla.com` literal (consts only), NO `PLAY_STORE_URL`, NO `navigator`/`window`, and that the non-iOS `redirect` target is `BUSINESS_WEB_URL`. Different angle: proves the wrong-destination + QR-creep + hardcode absence.

---

## 9. Runtime proof (tester — physical-device-first + drive)
- **Drive `/links`** (build or `next dev`): tap Explorer↔Business repeatedly → the pill **slides straight** (no arc/warp); re-run the INVESTIGATION sampler (per-frame `ty` must stay ≈0). Under `prefers-reduced-motion: reduce` → the pill **repositions instantly** (no motion). Keyboard: Tab to the tablist, Arrow/Home/End move selection+focus and the pill follows; `aria-selected` toggles; only the active tab is Tab-focusable.
- **Business CTA:** on a physical iPhone, tap "Get the app" → `/business/download` → **business App Store** listing opens. On Android/desktop → `business.usemingla.com` (owner get-started). Confirm one `links_page_cta_clicked { tab:'business', destination:'business_download' }` in PostHog.
- **Explorer CTA + socials** unchanged (regression check: Explorer → `/download`, socials swap to @minglabusiness on the Business tab).
- **§1 SNAPSHOT:** the page still fits one viewport with no scroll on a short phone (~667px).

---

## 10. Implementation order
1. **Switcher (§4.1):** rewrite the pill in `links-experience.tsx`; `npm ci` + `next build` + `tsc --noEmit`.
2. **Route (§4.2):** create `app/business/download/page.tsx`.
3. **Config (§4.3):** add `LINKS_BUSINESS_DOWNLOAD_PATH`; repoint the business tab CTA + copy.
4. **Test update (§4.3):** update `links-config.tester.test.ts` (commit body carries `[TEST-MOD-APPROVED ORCH-1326]`).
5. **Guards (§6) + jobs (§5):** add both `.mjs` (with `--self-test`) + their yml jobs + index comments.
6. **Append-only tests (§8):** add the switcher happy-path + adversarial + the route adversarial.
7. **Invariants (§7):** register both DRAFT.
8. **Verify (§9):** `tsc --noEmit`; `next build`; run both guards live + `--self-test`; run the 4 marketing source tests (2 switcher, `links-config.tester`, route adversarial); run the ORCH-1319 (4) + ORCH-1324 guards + `device-platform.test.ts` (must stay green); re-drive the swing + reduced-motion + keyboard; physical-iPhone business CTA. Merge with `[deploy]` + `[TEST-MOD-APPROVED ORCH-1326]`.

---

## 11. Decisions for orchestrator (REVIEW — flag for Seth)
1. **[COPY — needs Seth]** Business tab: label **"Get the app"**; body **"Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web."** (mirrors shipped ORCH-1324 hero copy). Alt body: "…outing — now on iPhone, or run it in your browser." Eyebrow/heading unchanged.
2. **[COPY — analytics]** Business `destination` → `'business_download'`.
3. **[OPTIONAL — non-blocking]** `app/links/page.tsx` `<meta>` description still says business owners "get started on the web" — optional SEO refresh; flag, don't gate.
4. **[PROCESS]** CLOSE commit body MUST include **`[TEST-MOD-APPROVED ORCH-1326]`** (business-tab test assertions modified) and the **`[deploy]`** tag (Vercel).
5. **[SCOPE]** No backend/native/edge change; no existing ORCH-1319/1324 guard needs whitelisting (verified — INVESTIGATION §4.2). Two new guards + two DRAFT invariants added.

---

## 12. Allowlist + DO-NOT-TOUCH
**Create:** `app/business/download/page.tsx`; `.github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs`; `.github/scripts/strict-grep/orch-1326-links-business-download-route.mjs`; `components/marketing/__tests__/links-tab-switcher.test.ts`; `components/marketing/__tests__/links-tab-switcher.tester.test.ts`; `app/business/download/__tests__/business-download-route.tester.test.ts`.
**Edit:** `components/marketing/links-experience.tsx`; `lib/links-config.ts`; `lib/links-config.tester.test.ts` (TEST-MOD); `.github/workflows/strict-grep-mingla-business.yml`; `Mingla_Artifacts/INVARIANT_REGISTRY.md`; optionally `app/links/page.tsx` (metadata).
**DO-NOT-TOUCH:** `app/download/page.tsx`; `lib/store-links.ts` values; `lib/device-platform.ts`; `lib/subdomain.ts`; `next.config`; the Explorer tab / tagline / socials data; `glass-nav.tsx`/`hero.tsx`; the 4 ORCH-1319 guards + the ORCH-1324 guard + their jobs; the one-viewport SNAPSHOT structure + entrance/panel `motion.div`s; any app/native/Supabase/edge code.

---

## Appendix — file:line evidence index
- Switcher (change): `links-experience.tsx:210-254` (tablist), `:237-249` (mount/unmount `layoutId` pill — delete), `:215` (add `relative`), `:103` (`activeIndex`, reuse), `:98` (`reduced`), `:258-266` (panel crossfade — leave).
- Business tab data (change): `lib/links-config.ts:48` (`LINKS_BUSINESS_PATH`, keep), `:65-79` (business tab), `:43` (`LINKS_DOWNLOAD_PATH` pattern).
- Test (change, TEST-MOD): `lib/links-config.tester.test.ts:19-23` (imports), `:70-79` (business case).
- Route parent: `app/download/page.tsx` (ORCH-1319 model); consts `lib/store-links.ts:14-16` (`BUSINESS_*`); resolver `lib/device-platform.ts:resolvePlatformFromUa`.
- Guards not firing (verified): `orch-1319-no-testflight-anywhere.mjs` (whole-tree, no testflight), `orch-1319-download-route-ua.mjs` (scans only `app/download/page.tsx`), `orch-1324-business-getapp-device-aware.mjs` (scans only glass-nav+hero), `i-proposed-1224-business-route.mjs` (bans `/organisers`, not `/business/download`).
- Guard model + yml: `orch-1319-download-route-ua.mjs`; `strict-grep-mingla-business.yml:3341-3352` (ORCH-1324 job block), `:172` (gate-index comment).
- Invariant model: `INVARIANT_REGISTRY.md:5539` (I-PROPOSED-1324 ACTIVE entry).
- Append-only gate: `.github/workflows/tests-append-only.yml` + `.github/scripts/test-append-only-check.js` (TEST-MOD token grammar).
- Driven proof: `INVESTIGATION_ORCH-1326_1327_LINKS_PAGE.md §2` (before/after frame tables).
