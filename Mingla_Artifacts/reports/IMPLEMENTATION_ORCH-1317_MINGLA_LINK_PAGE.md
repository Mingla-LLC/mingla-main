# IMPLEMENTATION — ORCH-1317 Mingla link-in-bio page (`/links`)

**Surface:** `mingla-marketing/` (Next.js App Router, Tailwind v4, framer-motion)
**Route:** `mingla-marketing/app/links/page.tsx` → **usemingla.com/links**
**Status:** Built + verified. Typecheck clean, `next build` green, `/links` prerendered static, guard test passes.
**Backfill:** BACKFILL-EXEMPT (new marketing page, no business logic) — a light data-contract guard test was still added.

---

## What it is

The single Linktree-style link Mingla drops in its social bios. Mobile-first, premium, on-brand
(the consumer night-canvas that `/download` and the explorer home already use). A two-tab accessible
experience with a socials row pinned to the bottom.

## Files added (4, all under `mingla-marketing/`)

| File | Role |
|---|---|
| `app/links/page.tsx` | Server component. Owns SEO `metadata` + the default tagline; renders `<LinksExperience/>`. |
| `components/marketing/links-experience.tsx` | `'use client'` shell — accessible tabs, per-tab CTA panel, store badges, socials, analytics, framer-motion entrance. |
| `lib/links-config.ts` | React-FREE data model — `LINKS_TABS`, `LINKS_SOCIALS`, `LINKS_DOWNLOAD_PATH`, `LINKS_BUSINESS_PATH`. Add tabs/socials here (extensibility, §5). |
| `lib/links-config.tester.test.ts` | Guard test (tsc+node pattern) — pins tab count/order, CTA destinations, no hardcoded store URL, the four social URLs. |

No other route, component, or the organiser beta modal was touched.

## Tagline options (ship the strongest as default)

1. **“Find a vibe, not a venue.”** ← SHIPPED DEFAULT. The canonical Mingla brand line (already used in
   the root `<title>` + footer), so `/links` reads consistently with the rest of the site. 5 words, confident.
2. **“Dates, plans, and city gems.”** — literally names the app’s job-to-be-done; makes “experiences, not dating” explicit. 5 words.
3. **“Great plans start here.”** — warmest/most neutral; reads well above BOTH tabs (Explorer + For Business). 4 words.

To change it, edit one constant: `LINKS_TAGLINE` in `app/links/page.tsx` (passed as the `tagline` prop).

## How the tabs are structured (extensible, §5)

All content is DATA in `lib/links-config.ts` — `LINKS_TABS: readonly LinksTab[]`. Each tab carries
`{ id, label, eyebrow, heading, body, cta: { label, href, destination, intent }, showStoreBadges }`.
Adding a third tab = append one object; the tablist, roving-tabindex keyboard nav, panel rendering, and
analytics all iterate the array — no component rewrite.

- **Tab 1 “Explorer”** — primary warm CTA **“Get Mingla”** → `/download` (the device-smart redirect:
  iPhone→App Store, Android→Play, desktop→QR). Below it, an “or pick your store” divider + the existing
  `<AppStoreBadges/>` so desktop viewers get explicit store choices.
- **Tab 2 “For Business”** — glass CTA **“Get started on the web”** → `/business`
  (`BUSINESS_PATH`, resolves to usemingla.com/business). Copy makes clear it’s a web “get started”, not an
  app download (biz app isn’t on the stores yet). `showStoreBadges: false`.

**Accessibility:** `role="tablist"`/`"tab"`/`"tabpanel"`, `aria-selected`, `aria-controls`/`aria-labelledby`,
roving `tabIndex` (only the active tab is Tab-focusable), Arrow Left/Right/Up/Down + Home/End move selection
AND focus, shared `.focus-ring` (`:focus-visible`) on every interactive element. A framer-motion
`layoutId` pill slides between tabs (collapses under reduced-motion).

## Store-link contract (HARD GUARD honored)

No store URL is hardcoded anywhere in the new files. The Explorer CTA points at `/download`; the explicit
badges come from `<AppStoreBadges/>`, which reads `APP_STORE_URL` / `PLAY_STORE_URL` from
`lib/store-links.ts` (single source of truth). The guard test asserts no tab CTA equals or contains a store URL.

## Socials (§4)

Pinned to the bottom as a `<nav aria-label="Mingla on social media">`, 44×44px round tap targets, each a
plain `<a target="_blank" rel="noopener noreferrer">`:
Instagram `https://www.instagram.com/usemingla`, X `https://x.com/usemingla`,
LinkedIn `https://www.linkedin.com/company/usemingla`, Facebook `https://www.facebook.com/usemingla`.
Icons: lucide-react `Instagram`/`Linkedin`/`Facebook`; **X** uses an inline SVG of the current X wordmark
(lucide has no post-rebrand X glyph — the fallback the task allows).

## Analytics (§7)

Consent-gated `captureMarketing` (no-op until PostHog opt-in, like the rest of the site):
- `links_page_tab_switched` `{ tab }` — on tab change (click or arrow key).
- `links_page_cta_clicked` `{ tab, destination }` — primary CTA click, and each store-badge click
  (delegated capture derives `app_store` / `play` from the badge’s aria-label).
- `links_page_social_clicked` `{ network }` — social icon click.

## SEO / meta (§8)

`metadata` exports `title: "Get Mingla"` + an experiences-app description, `alternates.canonical: '/links'`,
and OpenGraph title/description/url so shared links preview well.

## Design / brand (§6)

Dark brand canvas `#08090b` with the same warm radial-gradient atmosphere as `/download`; the orange
`mingla-wordmark.svg` (#EB7825) reads cleanly on it. Reused tokens: `font-display` (Mochiy), `bg-warm` +
`--color-warm-hover`, `glass-soft`, `text-white/xx`, radii, `.focus-ring`, `ease-out-quart`. Centered
`max-w-[440px]` column, generous spacing, rounded-[28px] panel, subtle framer-motion entrance.

**Light/dark:** the consumer surface is dark-first everywhere (body `--color-smoke`, explorer home, and
`/download` are all committed-dark) — `/links` matches that, consistent with “how the rest of the site handles it”.

## Verification

- **Typecheck:** `npx tsc --noEmit` → exit 0.
- **Build:** `npx next build` → “Compiled successfully”; `○ /links  4.63 kB  225 kB` (prerendered static).
  All 14 existing routes unchanged. No ESLint warnings.
- **Guard test:** `links-config.tester.test.ts` → all 6 cases pass (tab count/order, `/download` target,
  no hardcoded store URL, `/business` derived from `BUSINESS_PATH`, the four social URLs, https-only).
- **Mobile render (390px):** outer `px-5` (20px gutters) → content width ≈ 350px, under the 440px cap, so
  no horizontal scroll. Column: orange wordmark → tagline → glass segmented tablist (two `flex-1` tabs) →
  rounded panel (heading + body + full-width 56px CTA; Explorer adds “or pick your store” + stacked full-width
  App Store / Play badges) → four 44px social buttons centered at the bottom. All tap targets ≥ 44px; safe-area
  insets respected top and bottom.

## Deviations / notes

- The task referenced `components/marketing/get-the-app-modal.tsx` as a token reference — that file does not
  exist in this repo; I matched the equivalent live patterns in `app/download/page.tsx` and
  `components/marketing/app-qr-panel.tsx` (same night-canvas + `AppStoreBadges` + brand tokens).
- The Business CTA is an **internal** `/business` link (derived from `BUSINESS_PATH`) rather than the literal
  absolute `https://usemingla.com/business` — it’s the same apex site, so an internal link is idiomatic,
  avoids a hardcoded host, and resolves to exactly usemingla.com/business.
- X icon is an inline SVG (documented fallback), because lucide-react has no X (post-Twitter-rebrand) glyph.

---

## POLISH PASS (ORCH-1317, 2026-07-06) — 4 fixes from Seth's feedback

Four targeted `/links` fixes. Scope: `mingla-marketing/` only. No app/native change, no other route,
the organiser modal untouched, store-links single source of truth preserved, no hardcoded store URLs.

### 1 — No scroll: the whole page fits one viewport ("snapshot")
**Before:** root was `min-h-[100svh]` with generous `pt-12 sm:pt-16` / `pb-8` and an extra `<AppStoreBadges/>`
block on Explorer — tall content could exceed the screen and scroll / clip on short phones.
**After:** root is exactly one **dynamic** viewport tall and never scrolls:
`className="… h-[100svh] … overflow-hidden"` + inline `style={{ height: '100dvh' }}` (dvh wins on modern
browsers; where dvh is unsupported the declaration is dropped and the `h-[100svh]` class provides the fallback —
`100svh` is the *smallest* visible height, so content sized to it always fits even with mobile browser chrome
showing). Safe-area insets honored via `max(1.25rem, env(safe-area-inset-top|bottom))`. The content column is
`flex-1 min-h-0 … justify-center` so it distributes/centres and can shrink; the socials row is a flex sibling
pinned to the bottom. Compacted spacing to fit short phones without clipping: tagline `mt-4→mt-3`,
tablist `mt-8→mt-6`, panel `mt-6→mt-5` (+ dropped the `sm:p-7`/`sm:pt-16` growth), CTA block `mt-6→mt-5`,
socials `mt-10→mt-5`. Removing the Explorer badges (fix #4) freed ~180px.

### 2 — Crisp tab animation (no spring/overshoot)
**Before:** the active-tab pill used `transition={{ type: 'spring', stiffness: 380, damping: 32 }}` — it
swung/overshot and read awkward.
**After:** same sliding `layoutId="links-tab-pill"` pill, but a snappy **tween** with a standard ease-out and
no overshoot: `{ type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }` (collapses to `duration: 0` under
reduced-motion). The panel switch was also tightened to a quick crossfade (`duration: 0.2`, same ease,
`y: 8→6`). No spring anywhere.

### 3 — All 7 @usemingla socials
**Before:** 4 (Instagram, X, LinkedIn, Facebook). **After:** 7, in `lib/links-config.ts` `LINKS_SOCIALS`
(data-driven, order = render order): Instagram, X, TikTok, YouTube, LinkedIn, Facebook, Threads.
Icons: lucide-react `Instagram` / `Linkedin` / `Facebook` / **`Youtube`**; inline brand SVGs for the marks
lucide lacks — **X** (existing), **TikTok**, **Threads**. Kept 44×44px tap targets; the row is now
`flex flex-wrap … gap-1.5` so all seven sit on one tidy row on standard phones (≥390px: 7×44 + 6×6 ≈ 344 ≤ ~350)
and wrap cleanly (no horizontal overflow, no scroll) on narrower/shorter devices. All `target="_blank" rel="noopener noreferrer"`.

### 4 — Removed the App Store / Google Play badges from Explorer
The Explorer "Get Mingla" button already routes by device via `/download`, so `<AppStoreBadges/>` below it was
redundant. Removed: the `AppStoreBadges` import, the "or pick your store" divider + badges block, and the
`onBadgesClickCapture` analytics handler. Also removed the now-unused `showStoreBadges` field from the
`LinksTab` model, both tab objects, and the JSX conditional. Explorer = the single smart CTA. `/download`
still resolves the correct store per device from `lib/store-links.ts` — **no store URL is hardcoded anywhere**.

### Guard test updated
`lib/links-config.tester.test.ts`: socials assertion now pins **7** exact URLs (adds TikTok/YouTube/Threads);
dropped the two `showStoreBadges` assertions (field removed). The no-hardcoded-store-URL guard is unchanged.

### Verification (polish pass)
- **Guard test:** all 6 cases pass, including "exposes the seven usemingla social profiles with exact URLs".
- **`tsc --noEmit`:** exit 0, clean.
- **`next build`:** "Compiled successfully"; `○ /links  4.67 kB  225 kB` prerendered static; all 15 routes green.
- **Fit @ 375×667 (iPhone SE):** inner height 667 − 40 (insets) = 627. Content stack (wordmark 36 → tagline ~37 →
  tablist ~76 → Explorer panel ~302) ≈ 451; socials block (mt-5 + one-or-two rows) ≈ 64–114. Total ≈ 515–565 ≤ 627 →
  fits with 60–110px slack. Socials wrap to 2 tidy rows at this width (344 > ~335 avail). No scroll, nothing clipped.
- **Fit @ 390×844 (iPhone 14):** inner 804; same ~451 content + one-row socials (344 ≤ ~350 avail) → ~145px slack
  each side. Single clean socials row. No scroll, nothing clipped.
- Desktop: `overflow-hidden` + `100dvh` → no vertical scrollbar; column centred, socials pinned to bottom.
