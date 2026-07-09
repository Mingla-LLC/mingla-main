# SPEC — ORCH-1328 [links-cta-soft-nav-blank-page]

**Phase:** SPEC (binding build contract)
**Depends on:** `INVESTIGATION_ORCH-1328_LINKS_CTA_SOFT_NAV.md`
**One-pass buildable by:** mingla-implementor
**Layman outcome:** On `usemingla.com/links`, tapping either tab's button now **opens the App Store (or the right store/web app) directly and leaves `/links` on screen** — no more blank page (Explorer) or footer-only page (Business).

---

## 0. Chosen approach (locked)

**Option A** — convert the `/links` CTA from a soft-nav `<Link>` into a **client `<button>`** whose `onClick` opens the store/web **directly on the tap gesture** via `window.open(...)` + a same-tab `window.location.assign` fallback, choosing the destination with `detectClientPlatform()` — the **exact pattern already shipped and device-verified in `glass-nav.tsx`** (ORCH-1319 explorer / ORCH-1324 business). URLs come only from `lib/store-links.ts` (SSOT).

**Scope:** ONE product file changes — `mingla-marketing/components/marketing/links-experience.tsx`. **`lib/links-config.ts`, `lib/store-links.ts`, `lib/device-platform.ts`, `app/download/page.tsx`, `app/business/download/page.tsx`, both layouts — UNCHANGED.** Plus three regression artifacts + one CI job.

---

## 1. Edit `mingla-marketing/components/marketing/links-experience.tsx`

### 1.1 Imports

**Remove** (the CTA no longer soft-navigates; `next/link` is now unused in this file):
```tsx
import Link from 'next/link'
```

**Add** (after the existing `cn` import, before the `links-config` import):
```tsx
import { detectClientPlatform } from '@/lib/device-platform'
import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  BUSINESS_APP_STORE_URL,
  BUSINESS_WEB_URL,
} from '@/lib/store-links'
```

### 1.2 Replace the `onCtaClick` handler (currently lines ~151-156)

Replace:
```tsx
const onCtaClick = useCallback((tab: LinksTab) => {
  captureMarketing('links_page_cta_clicked', {
    tab: tab.id,
    destination: tab.cta.destination,
  })
}, [])
```
with (adds the popup-safe opener + the device-aware, per-tab store logic — mirrors `glass-nav.tsx`'s `handleGetTheApp` / `handleGetTheBusinessApp`):
```tsx
// ORCH-1328 — open the destination DIRECTLY on the tap gesture so /links stays
// mounted (the CTA no longer soft-navigates into the /download or /business/download
// route, whose external redirect stranded the tab on a blank / footer-only shell —
// INVESTIGATION_ORCH-1328). Popup-blocked (window.open → null) → same-tab
// navigation fallback (no silent failure).
const openExternal = useCallback((dest: string) => {
  const win = window.open(dest, '_blank', 'noopener,noreferrer')
  if (!win) window.location.assign(dest)
}, [])

// §7 — consent-gated tap analytics (kept), enriched with the resolved platform +
// store. Device map reuses the ORCH-1319/1324 store-links SSOT.
const onCtaClick = useCallback(
  (tab: LinksTab) => {
    const platform = detectClientPlatform()

    // Business tab (ORCH-1324): iOS → the live business App Store, else → the
    // business web app (business.usemingla.com owner get-started).
    if (tab.id === 'business') {
      const dest = platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL
      captureMarketing('links_page_cta_clicked', {
        tab: tab.id,
        destination: tab.cta.destination,
        platform,
        store: platform === 'ios' ? 'app_store' : 'business_web',
      })
      openExternal(dest)
      return
    }

    // Explorer tab (ORCH-1319): iOS → App Store, Android → Play.
    if (platform === 'ios' || platform === 'android') {
      const store = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL
      captureMarketing('links_page_cta_clicked', {
        tab: tab.id,
        destination: tab.cta.destination,
        platform,
        store: platform === 'ios' ? 'app_store' : 'play',
      })
      openExternal(store)
      return
    }

    // Explorer desktop / other → the device-smart /download QR page (tab.cta.href
    // = '/download', UNCHANGED route). Opened in a new tab so /links stays; the
    // popup-blocked fallback navigates same-tab (parity with today's desktop path).
    captureMarketing('links_page_cta_clicked', {
      tab: tab.id,
      destination: tab.cta.destination,
      platform: 'other',
      store: 'qr_page',
    })
    openExternal(tab.cta.href)
  },
  [openExternal],
)
```

### 1.3 Replace the CTA element (currently lines ~294-302)

Replace:
```tsx
<div className="mt-5">
  <Link
    href={activeTab.cta.href}
    onClick={() => onCtaClick(activeTab)}
    className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}
  >
    {activeTab.cta.label}
  </Link>
</div>
```
with (a real, focusable, keyboard-activatable `<button>` carrying the SAME token recipe):
```tsx
<div className="mt-5">
  <button
    type="button"
    onClick={() => onCtaClick(activeTab)}
    className={cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])}
  >
    {activeTab.cta.label}
  </button>
</div>
```

### 1.4 Update two stale comments (accuracy only — no behavior)

- The `CTA_BASE` header comment (~lines 42-44) currently says the CTA is an `<a>/<Link>` "so it can't use the `<Button>` element." Update to: the CTA is now a `<button>` performing a device-aware action, and it mirrors the Button token recipe (rather than importing `<Button>`) to preserve the exact `/links` visual.
- The `§4` comment above the CTA (~lines 291-293) that describes the CTA pointing at `/download`. Update to describe the new client device-aware action (iOS→App Store, Android→Play, desktop→the `/download` QR page; Business iOS→business App Store, else→business web).

### 1.5 Invariants the implementor MUST preserve (do NOT touch)

- The ORCH-1327 **highlight pill** (`initial={false}`, `animate={{ x: … }}`, the single `pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm` element, `{ duration: 0 }` reduced-motion branch) — verbatim.
- The **WAI-ARIA roving-tabindex tablist**: `role="tablist"/"tab"`, `aria-selected={…}`, `tabIndex={selected ? 0 : -1}`, `onTabKeyDown` (ArrowRight/ArrowLeft/Home/End), the `text-white` / `text-white/60` states — verbatim.
- The `CTA_BASE` / `CTA_INTENT` token strings — verbatim (the button reuses them, so the visual, focus-ring, and reduced-motion-safe transitions are identical).
- The §1 one-viewport SNAPSHOT (`h-[100svh]` / `100dvh`, `overflow-hidden`, safe-area insets) and the socials row — untouched.

---

## 2. `mingla-marketing/lib/links-config.ts` — NO CHANGE

`cta.href` stays `'/download'` (Explorer) and `'/business/download'` (Business):
- Explorer's `href` is still used at runtime (the desktop QR new-tab).
- It keeps the **canonical device-smart route** referenced as the SSOT anchor, so **`orch-1326-links-business-download-route.mjs` stays green** (it requires `LINKS_BUSINESS_DOWNLOAD_PATH` + `'/business/download'` + `destination:'business_download'` in this file) and **`links-config.tester.test.ts` stays green** (it pins `cta.href` DATA, not the CTA element type). Changing the config would break both for no benefit — leave it.

> The earlier concern that "the config test may need a tweak" does **not** apply: that test checks href data (kept), not the element (a `<Link>` vs `<button>`). No config/test edit is required here.

---

## 3. Regression triad

### 3.1 GUARD (CI, fails-on-revert) — the root-cause firewall

**File:** `.github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs`
**Invariant:** `I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE` (DRAFT until CLOSE)

Over `mingla-marketing/components/marketing/links-experience.tsx` (comment-stripped), **REQUIRE**:
1. imports `detectClientPlatform` (from `@/lib/device-platform`).
2. references ALL FOUR store consts: `APP_STORE_URL`, `PLAY_STORE_URL`, `BUSINESS_APP_STORE_URL`, `BUSINESS_WEB_URL`.
3. the CTA is a real control: a `<button` AND an `onClick={() => onCtaClick(` binding.
4. opens the store client-side: `window.open(` is present AND the `window.location.assign(` popup-block fallback is present (no silent failure).
5. fires `links_page_cta_clicked`.
6. device-driven: branches on `platform ===` (G-b: not a single hardcode).

**BAN** (the exact regression this ORCH kills):
- `from 'next/link'` **and** `<Link` — the CTA must never soft-navigate again (this file needs no next/link).
- `<a href="/download"` and `<a href="/business/download"` — no anchor navigation into the external-redirect routes.
- hardcoded store literals: `apps.apple.com`, `play.google.com` (SSOT — URLs only via consts).

Model the script structure + `--self-test` fixtures on `orch-1319-getapp-cta-direct-store.mjs` (compliant fixture passes; each violation — missing detect, missing a const, `<Link>`/`next/link` present, hardcoded literal, missing `window.location.assign`, no `platform ===` — fires; a banned token inside a COMMENT is stripped and still passes). Print a PASS line on success.

**Register the job** in `.github/workflows/strict-grep-mingla-business.yml` — insert immediately ABOVE the `orch-1327-links-tab-switcher-persistent-pill:` job (line ~3356):
```yaml
  orch-1328-links-cta-opens-store-clientside:
    name: "ORCH-1328: /links CTA opens the store client-side (device-aware window.open + assign fallback, store-links consts) and NEVER soft-navigates into the /download|/business/download external-redirect route (I-PROPOSED-1328-LINKS-CTA-OPENS-STORE-CLIENT-SIDE)"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Self-test the ORCH-1328 links-cta-opens-store gate
        run: node .github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs --self-test
      - name: Run ORCH-1328 links-cta-opens-store gate
        run: node .github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs
```
Add a matching registry comment line in the "Currently registered gates" block (near the ORCH-1327/1326 lines ~173-174), phrased like the others and ending "self-tested N/N + fails-on-revert (ORCH-1328 — DRAFT until CLOSE)". Flip DRAFT→ACTIVE at CLOSE.

### 3.2 IMPLEMENTOR happy-path (source pin, fails-on-revert)

**File:** `mingla-marketing/components/marketing/__tests__/links-cta-device-aware.test.ts`
Source-level pin run via the repo tsc+node pattern (mirror `links-tab-switcher.test.ts` header + runner). NOT comment-stripped. Assert PRESENCE:
- `detectClientPlatform` imported; all four store consts referenced.
- the CTA is a `<button` with `type="button"` and `onClick={() => onCtaClick(activeTab)}`.
- `window.open(` present AND `window.location.assign(` fallback present.
- the per-tab branch `tab.id === 'business'` present.
- `links_page_cta_clicked` fired.
- the button keeps the recipe `cn(CTA_BASE, CTA_INTENT[activeTab.cta.intent])`.

**Fails-on-revert:** restoring `<Link href={activeTab.cta.href}>` deletes `<button`/`window.open(` → the assertions throw.

### 3.3 TESTER adversarial (source pin, comment-stripped)

**File:** `mingla-marketing/components/marketing/__tests__/links-cta-device-aware.tester.test.ts`
Comment-stripped (mirror `links-tab-switcher.tester.test.ts`). Prove ABSENCE + correct binding:
- NO `from 'next/link'`, NO `<Link` (no soft-nav).
- NO hardcoded store literal (`apps.apple.com`, `play.google.com`).
- Business branch is `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` and NOT the reversed `? BUSINESS_WEB_URL : BUSINESS_APP_STORE_URL` (no everyone→App Store / no stranded non-iOS).
- Explorer phones are `platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL` and NOT reversed.
- Desktop-Explorer reaches the QR: the handler opens `tab.cta.href` (assert `openExternal(tab.cta.href)` — the desktop branch preserves the `/download` QR).
- The `window.location.assign(` fallback exists (no silent failure).
- The CTA is keyboard-activatable: a `<button` with `type="button"` (native Enter/Space; no `role="button"` div).

---

## 4. Verification checklist (implementor self-verify)

1. `cd mingla-marketing && npx tsc --noEmit` — clean.
2. New guard: `node .github/scripts/strict-grep/orch-1328-links-cta-opens-store-clientside.mjs --self-test` → PASS; then live run → PASS.
3. New tests compile+run green via the tsc+node one-liner in each file header.
4. **Fails-on-revert proof:** temporarily restore the `<Link href={activeTab.cta.href}>` CTA → the guard, `links-cta-device-aware.test.ts`, and `.tester.test.ts` all FAIL → revert.
5. **Existing suites stay green (must re-run):**
   - `lib/links-config.tester.test.ts` (10/10)
   - `components/marketing/__tests__/links-tab-switcher.test.ts` (6/6) + `.tester.test.ts` (4/4)
   - `node .github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs` (self-test + live)
   - `node .github/scripts/strict-grep/orch-1326-links-business-download-route.mjs` (self-test + live)
   - `node .github/scripts/strict-grep/orch-1319-getapp-cta-direct-store.mjs`
6. **Runtime (drive `/links`):** with an iPhone UA context, tap Explorer "Get Mingla" and Business "Get the app" → the page **stays on `/links`** (wordmark + tablist + CTA present, no blank, no footer) and the store/web opens on the gesture (headless blocks `window.open` popups — verify the store-open leg on a physical device or accept the device-verified glass-nav precedent; the `location.assign` fallback covers popup-block). Desktop Explorer → the `/download` QR page opens; `/links` stays.

## 5. Constitution compliance

- **No dead taps:** the button opens the store/web on the gesture (runtime-proven "stay on page"; store-open leg = the device-verified glass-nav SSOT handler).
- **No silent failures:** `window.open` → `window.location.assign` fallback on popup-block.
- **No fabricated data / SSOT:** URLs only from `lib/store-links.ts`; guard bans hardcoded literals.
- **A11y:** the CTA remains a real, focusable, keyboard-activatable `<button>` with the shared focus-ring.

---

## 6. Output paths

1. `Mingla_Artifacts/investigations/INVESTIGATION_ORCH-1328_LINKS_CTA_SOFT_NAV.md`
2. `Mingla_Artifacts/specs/SPEC_ORCH-1328_LINKS_CTA_FIX.md`
