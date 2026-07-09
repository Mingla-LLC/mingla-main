# INVESTIGATION — ORCH-1326 [links-business-tab-reflects-live-app] + ORCH-1327 [links-tab-switcher-swing]

**Phase:** INVESTIGATE (done)
**Surface:** `mingla-marketing/` ONLY — `usemingla.com/links` (the link-in-bio page). Next.js 15 App Router, framer-motion 11.18.2, React 19.
**Method:** Drove the LIVE built page (`next dev`, port 3117) in headless Chromium (Playwright 1.61, 390×844 mobile viewport, DPR 2) with a per-frame `requestAnimationFrame` sampler recording the pill's computed transform matrix + `getBoundingClientRect` + opacity across the switch. Prototyped the proposed fix on the real component, re-drove, then reverted (no product code left in the tree).
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-1326-[links-reality-and-switcher]` @ `origin/main` `81f350cc2` (includes ORCH-1324).

---

## 1. Executive summary (layman first)

Two problems live on the same page — `usemingla.com/links`, the single link Mingla puts in its social bios.

1. **ORCH-1327 — the tab toggle "swings" (the bug).** When you tap between **Explorer** and **For Business**, the orange highlight pill does NOT slide straight across. I drove the real page and measured it: the pill **starts ~150px too low and ~170px too far left, then sweeps in a big diagonal ARC up-and-across** to land on the tapped tab. It is a curved swing, not a slide. Cause: the highlight is built as a framer-motion "shared magic-move" element that is **destroyed on one tab and recreated on the other** every switch; framer-motion then guesses where it "came from," and because the whole card is re-laying-out at that instant it guesses a spot far to the lower-left — hence the arc. **The fix (which I built and re-drove to prove it): use ONE highlight pill that always exists and just slides its horizontal position between the two tabs.** After the fix the pill's vertical position stays pinned (zero arc) and it slides perfectly straight. Swing gone.

2. **ORCH-1326 — the Business tab is out of date.** The Business tab still says **"Get started on the web"** and links to the `/business` marketing page — copy from before the business app existed. The **Mingla Business app went live on the App Store today (ORCH-1324)**. The tab should tell the truth: iPhone users get the app; everyone else uses the web — exactly like the `/business` page's own CTA now does. Fix: point the Business tab at a new smart `/business/download` route (iPhone → business App Store, else → the web app) and refresh the copy.

The rest of the page (tagline, Explorer tab, the 7 social links) is accurate — no other functional staleness. One optional copy nit flagged (§6).

---

## 2. ORCH-1327 — the swing: proof by driving

### 2.1 The component under test
`mingla-marketing/components/marketing/links-experience.tsx` (lines ~210-254). The active-tab highlight is a `motion.span` with `layoutId="links-tab-pill"`, **conditionally mounted only on the selected tab**:

```tsx
{selected ? (
  <motion.span
    layoutId="links-tab-pill"
    className="absolute inset-0 rounded-full bg-warm"
    transition={reduced ? { duration: 0 } : { type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
    aria-hidden="true"
  />
) : null}
```

It is the **ONLY `layoutId` in the entire marketing app** (grep: 1 hit), and it runs with **NO `LayoutGroup` and NO `AnimatePresence`** wrapping it.

### 2.2 Driven evidence — BEFORE (buggy)
Ancestor chain at rest (measured on the live page, tablist → up):

| element | transform | backdrop-filter | filter |
|---|---|---|---|
| `.glass-soft` tablist | **none** | `blur(30px) saturate(1.8)` | none |
| `.max-w-[440px]` (entrance motion.div) | **none** | none | none |
| centered column | none | none | none |
| `<main>` | none | none | none |

Per-frame trajectory of the newly-mounted pill on Explorer→Business (left/top relative to tablist; `tx/ty` = decomposed translate; `sx/sy` = scale):

```
t=87ms   L=5     T=150.63  tx=-172    ty=+157.81  sx=1 sy=1 skew=0
t=111ms  L=52.85 T=106.72  tx=-124.15 ty=+113.91  sx=1 sy=1
t=145ms  L=124.6 T=40.86   tx=-52.36  ty=+48.05   sx=1 sy=1
t=195ms  L=168.1 T=0.99    tx=-8.92   ty=+8.18    sx=1 sy=1
t=245ms  L=177   T=-7.19   (settled, transform:none)
```

**What the "swing" actually is:** a **large diagonal ARC**. The pill's vertical translate `ty` starts at **+157.81px** (157px BELOW its target) and the horizontal `tx` at **-172px** (172px left), then both drive to 0 over ~158ms (matching the 0.18s tween). Width stays constant **168px**, `scaleX=scaleY=1`, `skew=0` throughout.

**Therefore it is NOT** an overshoot (tween, no spring), **NOT** a width/scale warp (scale locked at 1), **NOT** a skew. **It is a position-projection arc:** framer-motion projects the pill from a wrong origin offset in *both* axes → a curved lower-left-to-target sweep.

### 2.3 Root cause (proven, and it CORRECTS one of the leads)
- **Lead 1 (ancestor active transform) is REFUTED as stated.** At switch time every ancestor reads `transform: none`. The parent entrance `motion.div` (`y:16→0`, 0.6s) has fully settled to `transform: none` (not `translateY(0)`) long before the user taps, so there is **no active ancestor transform** distorting the projection. (The only non-trivial ancestor style is `backdrop-filter: blur(30px)` on the `.glass-soft` tablist — a *containing block* that makes framer's projection origin fragile, but not a transform.)
- **Confirmed root cause = the conditional mount/unmount of the shared `layoutId` pill.** On switch, the outgoing pill (tab A) **unmounts** and a fresh pill (tab B) **mounts**. framer-motion performs a cross-instance "magic-move" projection, computing the new pill's "from" delta against a layout snapshot taken **mid-reflow** — at that exact instant the tab **panel below** (`<motion.div key={activeTab.id}>`, line ~258) is *also* unmounting+remounting (different-length body copy → the flex-centered column re-centers) while the old pill is being removed. The measured origin is therefore offset ~157px vertically (≈ the panel/content reflow) and ~172px horizontally (the inter-button gap distance) → the pill is placed at the lower-left and sweeps to target: **the swing.** The absence of any `LayoutGroup`/`AnimatePresence` and the `backdrop-filter` containing block on the tablist both make this projection origin unstable.

### 2.4 The fix — proven by re-driving
Replace the mount/unmount `layoutId` pill with **ONE persistent, absolutely-positioned pill** that is a child of the (now `relative`) tablist and animates its horizontal position between the two equal-width tab slots — no `layoutId`, no mount/unmount, no layout projection:

```tsx
<motion.div
  aria-hidden="true"
  className="pointer-events-none absolute left-1 top-1 h-11 rounded-full bg-warm"
  style={{ width: 'calc(50% - 0.375rem)' }}
  initial={false}
  animate={{ x: `calc(${activeIndex} * (100% + 0.25rem))` }}
  transition={reduced ? { duration: 0 } : { type: 'tween', duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
/>
```

Re-driven on the live page (same sampler), Explorer→Business:

```
t=113ms  L=50.36 T=-7.19  tx=45.36  ty=0  sx=1 sy=1 skew=0
t=145ms  L=91    T=-7.19  tx=86     ty=0  sx=1 sy=1
t=195ms  L=158.5 T=-7.19  tx=153.55 ty=0  sx=1 sy=1
t=245ms  L=176   T=-7.19  tx=171.02 ty=0
t=260ms  L=177   T=-7.19  tx=172    ty=0  (settled)
```

**`ty` is 0 on EVERY frame** (zero vertical movement — the arc is gone), `tx` moves **monotonically** 45→172, width/scale constant, and the pill lands at the **identical resting position** (`L=177`, `W=168`) as before — geometry is exact. A pure, straight horizontal slide. **Swing eliminated.** (Prototype reverted; `git status` clean.)

Geometry check (for exactly 2 equal `flex-1` tabs in a `p-1` container with `gap-1`): each button width = `(100% - 12px)/2 = calc(50% - 6px)` = `calc(50% - 0.375rem)` ✓; the slot-to-slot horizontal shift = buttonWidth + gap = `100%`(of the pill's own box) `+ 4px` = `calc(100% + 0.25rem)` ✓ (translate-% is relative to the element's own border-box). Both confirmed against measured `W=168` and final `L=177`.

### 2.5 Contracts preserved by the fix (verified)
- **Reduced motion:** `transition={reduced ? { duration: 0 } : …}` + `initial={false}` → instant snap, no motion (unchanged behaviour, `useMinglaReducedMotion` still the source).
- **A11y:** the roving-tabindex tablist is untouched — `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, `tabIndex={selected ? 0 : -1}`, and the `onTabKeyDown` Arrow/Home/End handler all stay on the buttons. The pill is `aria-hidden`.
- **Color states:** `selected ? 'text-white' : 'text-white/60 hover:text-white/85'` on the buttons — unchanged.
- **§1 SNAPSHOT (one-viewport, no scroll):** the pill is `position:absolute` (out of flow) — zero effect on layout height. No change to the fixed-height flex column.

---

## 3. ORCH-1326 — `/links` staleness audit

Read `lib/links-config.ts` (data) + `components/marketing/links-experience.tsx` (render) + `app/links/page.tsx` (metadata) against live reality (consumer app live — ORCH-1318 1.1.1; business app live on App Store — ORCH-1324).

| Element | Current | Reality | Verdict |
|---|---|---|---|
| **Business tab CTA** | label "Get started on the web", `href: LINKS_BUSINESS_PATH` (`/business`), `destination: 'business'`, `intent: 'glass'` | Business app **live on App Store** (iPhone) + web everywhere else | **STALE → FIX (ORCH-1326)** |
| **Business tab body** | "…Put your experiences in front of people planning their next outing. Get started on the web." | app exists now | **STALE → refresh copy** |
| **Business tab eyebrow / heading** | "For venues & organizers" / "Run a venue, event, or trip?" | accurate | KEEP |
| **Explorer tab** | "Get Mingla" → `/download` (device-smart), body "…all in one app." | consumer app live; `/download` resolves per device | **ACCURATE — KEEP** |
| **Tagline** | "Find a vibe, not a venue." | canonical brand line (experience-app positioning) | KEEP |
| **Socials (7)** | @usemingla + @minglabusiness swap on Business tab | current (per config comment / reference-mingla-social-links) | KEEP |
| **Page `<meta>` description** (`app/links/page.tsx`) | "…if you run a venue, event, or trip, get started on the web." | business app now exists | **MINOR staleness — optional refresh, FLAG (§6)** |

**Conclusion:** the ONLY functional staleness is the Business tab (ORCH-1326 scope). One optional SEO-copy nit (metadata description). No scope expansion required.

### 3.1 The fix shape (mirrors ORCH-1324 + ORCH-1319 `/download`)
- New **server smart-redirect route** `app/business/download/page.tsx` — parity with `app/download/page.tsx` but business + **no QR/landing** (business owners on desktop go straight to the web app): read UA via `headers()` + `resolvePlatformFromUa`; `redirect(BUSINESS_APP_STORE_URL)` for `ios`, else `redirect(BUSINESS_WEB_URL)` (both imported from `lib/store-links.ts` — ORCH-1324 SSOT; never hardcoded).
- Point the Business tab CTA at `/business/download` (new `LINKS_BUSINESS_DOWNLOAD_PATH` const), new label, `destination: 'business_download'`, honest body copy.

---

## 4. Guard / test impact (enumerated)

### 4.1 Tests that BREAK and MUST change
- **`mingla-marketing/lib/links-config.tester.test.ts`** — case *"Business CTA targets the shared /business path"* (lines 70-79) asserts `biz.cta.href === LINKS_BUSINESS_PATH` **and** `biz.cta.href === '/business'`. Changing the Business CTA href to `/business/download` makes **both fail** → the case must be rewritten to pin `/business/download`. This deletes/replaces assertion lines in an existing test file → **requires a `[TEST-MOD-APPROVED ORCH-1326]` token in the CLOSE commit body** (`.github/workflows/tests-append-only.yml` + `test-append-only-check.js`; deletions are otherwise blocked). The sibling assertion `LINKS_BUSINESS_PATH === BUSINESS_PATH` still holds (keep it).

### 4.2 Guards that DO NOT fire on the new work (verified by reading each)
- `orch-1319-no-testflight-anywhere.mjs` — scans ALL of `mingla-marketing/` for `testflight.apple.com`. New route/config use live store consts, zero testflight → **stays green**. No whitelist needed.
- `orch-1319-download-route-ua.mjs` — scans **only** `app/download/page.tsx`. Does not see `app/business/download/page.tsx` → **untouched**. (Note: its rule requires BOTH `APP_STORE_URL` *and* `PLAY_STORE_URL` — the business route deliberately has no Play branch, which is why the business route needs its **own** guard, not this one.)
- `orch-1324-business-getapp-device-aware.mjs` — scans only `glass-nav.tsx` + `hero.tsx` → **untouched**.
- `i-proposed-1223-footer-links-resolve.mjs` / `i-proposed-1223-footer-mounted.mjs` — scan `footer.tsx` only → **untouched**.
- `i-proposed-1224-business-route.mjs` — bans navigable `/organisers` hrefs + pins the `next.config` `/organisers → /business` 301. `/business/download` is not `/organisers` → **stays green**; bonus, `next.config`'s `/organisers/:path*`→`/business/:path*` rule already forwards `/organisers/download`.
- No repo-wide "no `apps.apple.com` literal" guard exists; regardless, the new route imports the const (no literal).

### 4.3 New guards / tests to ADD (specified in the SPEC — regression triad per ORCH)
- **ORCH-1327:** strict-grep `orch-1327-links-tab-switcher-persistent-pill.mjs` (bans `layoutId`, requires the persistent-pill + reduced-motion + roving-tabindex a11y) + append-only happy-path + tester-adversarial source pins.
- **ORCH-1326:** strict-grep `orch-1326-links-business-download-route.mjs` (device-aware business route: consts not hardcoded, SSR-safe, NO QR) + the `links-config.tester.test.ts` update (happy-path) + a tester-adversarial route pin.
- Register **`I-PROPOSED-1327-LINKS-TAB-PERSISTENT-PILL`** and **`I-PROPOSED-1326-LINKS-BUSINESS-TAB-DEVICE-AWARE`** (DRAFT → ACTIVE at CLOSE).

---

## 5. Files to touch (complete)
**Create:** `app/business/download/page.tsx`; `.github/scripts/strict-grep/orch-1327-links-tab-switcher-persistent-pill.mjs`; `.github/scripts/strict-grep/orch-1326-links-business-download-route.mjs`; `components/marketing/__tests__/links-tab-switcher.test.ts`; `components/marketing/__tests__/links-tab-switcher.tester.test.ts`; `app/business/download/__tests__/business-download-route.tester.test.ts`.
**Edit:** `components/marketing/links-experience.tsx` (switcher rewrite); `lib/links-config.ts` (business tab + new const); `lib/links-config.tester.test.ts` (business-tab assertions — **needs TEST-MOD token**); `.github/workflows/strict-grep-mingla-business.yml` (2 new jobs + gate-index comments); `Mingla_Artifacts/INVARIANT_REGISTRY.md` (2 DRAFT invariants); optionally `app/links/page.tsx` (metadata description — §6).
**Delete:** none.

---

## 6. Copy + decisions to FLAG for Seth
1. **[COPY — Business tab]** Proposed: CTA label **"Get the app"** (parity with ORCH-1324 nav/hero + the Explorer tab); body **"Put your experiences in front of people planning their next outing. Now on iPhone — or get started on the web."** (mirrors the shipped ORCH-1324 hero subcopy "On iPhone now — or get started on the web."). Alt body: "…outing — now on iPhone, or run it in your browser." Eyebrow/heading unchanged.
2. **[COPY — analytics]** Business CTA `destination` → `'business_download'` (was `'business'`).
3. **[OPTIONAL — non-blocking]** `app/links/page.tsx` `<meta>` description still says business owners "get started on the web"; could refresh to "…if you run a venue, event, or trip, get the app or start on the web." Purely SEO copy — flag, don't gate.
4. **[SCOPE — TEST-MOD token]** The CLOSE commit body MUST carry `[TEST-MOD-APPROVED ORCH-1326]` (the business-tab assertion change deletes lines in an existing test file).

---

## 7. Environment / repro (record)
- `mingla-marketing/node_modules` absent in the fresh worktree → `npm ci` before build/drive (done for this investigation).
- Drove `next dev` on port 3117 with Playwright (`/Users/sethogieva/Library/Caches/ms-playwright`); sampler + both runs captured. framer-motion resolved **11.18.2**.
- Prototype patch applied to `links-experience.tsx`, re-driven, then `git checkout --` reverted — tree clean, no product code left by this phase.
