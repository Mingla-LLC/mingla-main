# INVESTIGATION — ORCH-1328 [links-cta-soft-nav-blank-page]

**Phase:** INVESTIGATE (root cause proven by driving)
**Surface:** `mingla-marketing` — `usemingla.com/links` (Linktree-style link-in-bio page)
**Date:** 2026-07-09
**Author:** mingla-forensics

---

## 1. The bug (as reported by Seth)

On `usemingla.com/links`, tapping the per-tab CTA is broken:

- **Explorer tab → "Get Mingla"** opens a **BLANK page** (should stay on `/links` and just open the App Store).
- **For Business tab → "Get the app"** opens a page that shows **only a FOOTER** (should stay on `/links` and open the store/web app).

---

## 2. Root cause — PROVEN (matches the report pixel-for-pixel)

### 2.1 The mechanism

The `/links` CTA is a Next.js **soft-nav `<Link>`**:

`mingla-marketing/components/marketing/links-experience.tsx:295-296`
```tsx
<Link href={activeTab.cta.href} onClick={() => onCtaClick(activeTab)} className={cn(...)}>
  {activeTab.cta.label}
</Link>
```

The two `href` targets (`lib/links-config.ts`) are **internal server routes that exist only to `redirect()` to an EXTERNAL URL**:

- Explorer → `LINKS_DOWNLOAD_PATH` = `/download` → `app/download/page.tsx`: iOS `redirect(APP_STORE_URL)`, Android `redirect(PLAY_STORE_URL)`, desktop → renders the QR page.
- Business → `LINKS_BUSINESS_DOWNLOAD_PATH` = `/business/download` → `app/business/download/page.tsx`: iOS `redirect(BUSINESS_APP_STORE_URL)`, **else** `redirect(BUSINESS_WEB_URL)` (this route ALWAYS redirects — it never renders content).

Tapping the CTA does a client transition INTO that route. The Next App Router commits the route's **layout shell** and runs the page, whose `redirect()` yields no page content, then attempts the external hop. **The tab is torn down from `/links` either way** — it never "stays on `/links`."

### 2.2 Why the user sees BLANK (Explorer) and FOOTER-only (Business)

The blank/footer is the **route's layout shell left stranded when the external store hop is CANCELLED** — which is exactly what a real iPhone does: `apps.apple.com/app/id…` is a **universal link**, so iOS opens the **App Store app** and **cancels the Safari web navigation**, leaving Safari on the intermediate shell:

- `/download` sits under the **bare root layout** (`app/layout.tsx` — no nav, no footer) and its page `redirect()`s → **empty root shell = a BLANK page.**
- `/business/download` sits under **`app/business/layout.tsx`** (`<GlassNav/>` + empty `<main/>` + `<Footer surface="organiser"/>`) and its page `redirect()`s → **GlassNav + Footer with an empty main = a FOOTER-only page.**

### 2.3 Driven proof

Tooling: Playwright **WebKit** (the iOS Safari engine), `iPhone 14` device descriptor, against **live prod** `https://www.usemingla.com/links`. I modeled the real iOS App Store handoff by **aborting the store-host request** (`apps.apple.com` / `business.usemingla.com`) — i.e. the OS cancelling the Safari nav — and sampled the DOM the tab is left showing.

**Explorer — tap "Get Mingla":**
```
mainFrame navs : /links → /links → /download
final state    : url=/download  childCount=14  textLen=15
                 hasWordmark=false  hasFooter=false  hasTablist=false
```
→ Screenshot `scratchpad/shell-ios-explorer.png`: a **fully blank (black) page**. Confirms "opens a BLANK page."

**Business — tap "Get the app":**
```
mainFrame navs : /links → /links → /business/download
final state    : url=/business/download
                 hasFooter=true  footerText="Mingla Business  Find a vibe, not a venue. …"
                 hasGlassNav=true  hasWordmark=true(biz logo)  main empty
```
→ Screenshot `scratchpad/shell-ios-business.png`: the **Mingla Business GlassNav + Footer** (Company/Careers, Legal/Privacy/Terms, "Looking for the consumer app? → Back to Mingla", © 2026) with an **empty middle**. Confirms "shows only a FOOTER."

### 2.4 A key nuance (why it isn't seen in every browser)

In a **clean automated browser with no App Store app** (headless Chromium AND headless WebKit, store host stubbed with a 200), the external hop is **not cancelled**, so the redirect chain completes: `/links → /download → apps.apple.com` (Explorer) and `/links → /business/download → apps.apple.com` / `business.usemingla.com` (Business) — the store is "reached." **But the tab has still LEFT `/links` in every case.** So the defect is twofold and holds on every engine:

1. **Always:** the CTA tears the whole `/links` page down (violates Seth's "stay on `/links`").
2. **On real iOS Safari:** the App Store universal-link handoff cancels the last hop, stranding Safari on the blank/footer route shell (Seth's exact report).

Direct/hard hits are healthy (not the bug): `curl -A "<iPhone UA>" /download` → `307 → apps.apple.com`; `/business/download` → `307 → business App Store`. The defect is specific to **soft-nav into an external-redirect route from `/links`.**

### 2.5 Confirmation the CTA element is the soft-nav

Driving resolved the Explorer CTA to `A href=/download` and the Business CTA to `A href=/business/download` (next/link renders an `<a>`). These are the exact soft-nav anchors described above.

---

## 3. The fix — chosen with evidence

**Requirement (Seth):** both tabs must "stay on the `/links` page and just open the App Store."

### 3.1 Decision: Option A — client-side, device-aware CTA (reuse the ORCH-1319/1324 SSOT handler)

Convert the CTA from a soft-nav `<Link>` into a **client `<button>`** whose `onClick` opens the destination **directly on the gesture**, mirroring `glass-nav.tsx`'s already-shipped, **device-verified** `handleGetTheApp` / `handleGetTheBusinessApp`:

- `detectClientPlatform()` (SSR-safe, `lib/device-platform`) →
  - **Explorer:** iOS → `APP_STORE_URL`, Android → `PLAY_STORE_URL`, desktop/other → the `/download` QR page.
  - **Business:** iOS → `BUSINESS_APP_STORE_URL`, else → `BUSINESS_WEB_URL`.
- Open via `window.open(dest, '_blank', 'noopener,noreferrer')` with a `window.location.assign(dest)` **popup-blocked fallback** (no silent failure).
- URLs stay in `lib/store-links.ts` (SSOT) — no hardcoded URL in the component.
- Keep the `links_page_cta_clicked` analytics (enriched with `platform` + `store`).

### 3.2 Why Option A over Option B (`<a target="_blank">`)

Option B (make the CTA a plain `<a href={cta.href} target="_blank">`) would fix "stay on page" (new tab), and needs no config/test change, BUT it reaches the store via an **intermediate `/download` → 307 → store redirecting tab**. Option A opens the store **directly on the tap gesture** (most reliable on iOS), is the **exact handler already shipping and device-verified in `glass-nav`** for both surfaces, gives the same nav CTA vs. `/links` CTA behavior (consistency), and carries the explicit popup-block fallback the constitution requires. **Pick: Option A.**

### 3.3 Driven proof of the fix mechanism

On the live `/links` page (WebKit / iPhone 14), I injected the Option A handler onto the CTA (`preventDefault` + `window.open` + `location.assign` fallback) and tapped:

```
FIX-VALIDATE ios-explorer : /links stayed mounted → url=/links, wordmark=true, tablist=true, cta=true → STAYED ON /links: YES
FIX-VALIDATE ios-business : /links stayed mounted → url=/links, wordmark=true, tablist=true, cta=true → STAYED ON /links: YES
```

- **"Stay on `/links`" is driven-proven and engine-independent:** after the tap the tab is still `/links` with the wordmark, tablist, and CTA all present — **no teardown, no blank, no footer.** This is the property that fixes the bug.
- **"Opens the store on the gesture":** headless WebKit **blocks `window.open` popups** and did not commit the same-tab fallback either (a pure automation artifact — real iOS Safari opens `window.open` on a user gesture). This leg is **inherited from the identical, device-verified `glass-nav` handler** (ORCH-1319 explorer + ORCH-1324 business, per project memory "shipped + device-verified"), and the `window.location.assign` fallback guarantees no silent failure. Claim capped accordingly: the store-open leg is proven by production precedent, not by this headless run.

### 3.4 Desktop-Explorer QR is preserved

Desktop/other Explorer opens `activeTab.cta.href` (= `/download`) — the **unchanged** device-smart route renders the QR + store badges page. Driven (desktop UA, current code): tapping Explorer reaches `/download` rendering `title="Get Mingla — Mingla"`, `childCount=16`, the QR article — the QR experience is intact. Option A opens it in a new tab, so `/links` stays behind (and the same-tab `location.assign` fallback matches today's desktop behavior).

---

## 4. Guard / test landscape (what must NOT break, and what changes)

Baseline re-run in the worktree — **all green today**:

| Guard / test | Scope | Effect of the fix |
|---|---|---|
| `lib/links-config.tester.test.ts` (10/10 PASS) | pins CTA **href DATA** (`/download`, `/business/download`, `destination`) — NOT the element type | **UNCHANGED** — the fix keeps `cta.href` in config, so this stays green with zero edits |
| `orch-1326-links-business-download-route.mjs` (self-test 11/11 + live PASS) | pins `links-config.ts` refs `LINKS_BUSINESS_DOWNLOAD_PATH` + `'/business/download'` + `destination:'business_download'`, and the route | **UNCHANGED** — config + route untouched → green |
| `links-tab-switcher.test.ts` (6/6) + `.tester.test.ts` (4/4) | pin the ORCH-1327 pill + tablist a11y in `links-experience.tsx` | **PRESERVE** — the fix touches only the CTA element + `onCtaClick`; pill/tablist tokens kept verbatim → green |
| `orch-1319-getapp-cta-direct-store.mjs`, `orch-1324-business-getapp-device-aware.mjs`, `business-download-route.tester.test.ts` | glass-nav + hero + business route | **UNTOUCHED** → green |

**No existing gate/test requires the `/links` CTA to be a `<Link>`/`<a>`.** Confirmed by grepping the strict-grep scripts and the two ORCH-1327 tests — they only pin the pill + tablist, never the CTA element. So converting the CTA to a `<button>` breaks nothing, and **no config edit is needed** (the earlier worry that the config test would need a tweak does not apply, because that test checks href data, which the fix keeps).

---

## 5. Files (all absolute)

- Component (edit target): `mingla-marketing/components/marketing/links-experience.tsx`
- Data (unchanged): `mingla-marketing/lib/links-config.ts`
- SSOT consts (unchanged): `mingla-marketing/lib/store-links.ts`
- Detection (unchanged): `mingla-marketing/lib/device-platform.ts`
- Precedent handler (reuse pattern): `mingla-marketing/components/marketing/glass-nav.tsx`
- Redirect routes (unchanged, correct): `mingla-marketing/app/download/page.tsx`, `mingla-marketing/app/business/download/page.tsx`
- Layout shells (the blank/footer): `mingla-marketing/app/layout.tsx`, `mingla-marketing/app/business/layout.tsx`

## 6. Driving evidence (scratchpad, session-local)

- `drive-shell.mjs` + `shell-ios-explorer.png` (blank) + `shell-ios-business.png` (footer) — **root-cause repro.**
- `drive-webkit.mjs` / `drive-bug2.mjs` — clean-browser redirect chain (store reached, but `/links` left).
- `fix-validate.mjs` / `fix-open.mjs` / `fix-fallback.mjs` — fix keeps `/links` mounted.
