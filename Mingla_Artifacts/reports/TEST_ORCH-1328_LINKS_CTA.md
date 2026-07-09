# TEST — ORCH-1328 [links-cta-soft-nav-blank-page]

**Phase:** TEST (brutal, independent, evidence-backed)
**Verdict:** ✅ **PASS**
**Worktree:** `/Users/sethogieva/Desktop/mingla-orchs/orch-1328-[links-cta-soft-nav-blank]/` · branch `orch-1328-links-cta-soft-nav-blank` · HEAD `f96d806e8` · fix `22c9ff893`
**Date:** 2026-07-09 · **Tester:** mingla-tester

**Layman outcome — PROVEN:** On `usemingla.com/links`, tapping "Get Mingla" (Explorer) or "Get the app" (Business) now opens the right store/web app AND the `/links` page stays on screen. The old blank page (Explorer) / footer-only page (Business) is gone. Verified by driving the actual built page across both tabs and iOS / Android / desktop.

---

## 1. Gates re-run independently (all green)

| Gate | Command | Result |
|---|---|---|
| npm ci | `npm ci` (marketing) | PASS (exit 0) |
| Typecheck | `npm run typecheck` (`tsc --noEmit`) | PASS (exit 0, clean) |
| Build | `npm run build` | PASS (exit 0); `/links` static ○ 5.24 kB; `/download` + `/business/download` still ƒ (server-rendered) |
| New guard self-test | `orch-1328-links-cta-opens-store-clientside.mjs --self-test` | PASS 10/10 |
| New guard live | `orch-1328-links-cta-opens-store-clientside.mjs` | PASS |
| ORCH-1319 ×4 self-test | download-route-ua / getapp-cta-direct-store / no-testflight-anywhere / qr-encodes-download-url | PASS 6/6, 8/8, 4/4, 5/5 |
| ORCH-1324 self-test | business-getapp-device-aware | PASS 11/11 |
| ORCH-1325 self-test | ci-typescript-pinned | PASS 10/10 |
| ORCH-1326 self-test + live | links-business-download-route | PASS 11/11 + live green |
| ORCH-1327 self-test + live | links-tab-switcher-persistent-pill | PASS 8/8 + live green |
| ORCH-1319/1324 live | getapp-cta-direct-store / business-getapp-device-aware over source | PASS |
| Happy-path test | `links-cta-device-aware.test.ts` (tsc+node) | PASS 7/7 |
| Adversarial test | `links-cta-device-aware.tester.test.ts` (tsc+node) | PASS 7/7 |
| `links-config.tester.test.ts` | tsc+node | PASS 10/10 |
| `links-tab-switcher.test.ts` / `.tester.test.ts` | tsc+node | PASS 6/6 + 4/4 |
| `device-platform.test.ts` | tsc+node | PASS 7/7 |
| Soft-nav grep | `grep -nE "from 'next/link'\|<Link[ >/]" links-experience.tsx` | NONE (exit 1 — good) |
| CI job registration | job at yml:3357, immediately above orch-1327 (yml:3370); registry comment yml:175 | PRESENT + correct |
| Scope | branch vs main touches ONLY: guard, workflow, 2 tests, `links-experience.tsx` (+docs) | routes/SSOT/config/layouts UNCHANGED |

---

## 2. RUNTIME PROOF — drove the BUILT `/links` (Playwright/Chromium, prod server on :3939)

`window.open` intercepted; `navigator.userAgent/platform/maxTouchPoints` set per platform; DOM sampled after the tap. **"Stays on /links" = URL `/links` + wordmark + tablist + CTA button all present (NOT blank, NOT footer-only).**

### 2a. Popup-allowed (window.open succeeds) — destination + stays-on-page, 6/6

| Tab | Platform | `window.open` target captured | Correct? | Stays on /links? |
|---|---|---|---|---|
| Explorer | iOS | `https://apps.apple.com/app/id6760440898` | ✅ | ✅ (wordmark+tablist+CTA) |
| Explorer | Android | `https://play.google.com/store/apps/details?id=com.mingla.app.v2` | ✅ | ✅ |
| Explorer | desktop | `/download` (QR page, new tab) | ✅ | ✅ |
| Business | iOS | `https://apps.apple.com/app/id6768737367` | ✅ | ✅ |
| Business | Android | `https://business.usemingla.com` | ✅ | ✅ |
| Business | desktop | `https://business.usemingla.com` | ✅ | ✅ |

**This is the regression that reproduced the original bug — it no longer strands.** All six keep `/links` fully mounted; none goes blank or footer-only.

### 2b. Popup-blocked fallback (window.open → null) — `location.assign(dest)` fires, 6/6

Captured the assign target via top-level navigation-request interception (aborted so nothing leaves):

| Tab | Platform | `window.open`(→null) target | `location.assign` fallback dest | Correct? |
|---|---|---|---|---|
| Explorer | iOS | apps.apple.com/app/id6760440898 | apps.apple.com/app/id6760440898 | ✅ |
| Explorer | Android | play.google.com/…com.mingla.app.v2 | play.google.com/…com.mingla.app.v2 | ✅ |
| Explorer | desktop | /download | http://localhost:3939/download | ✅ |
| Business | iOS | apps.apple.com/app/id6768737367 | apps.apple.com/app/id6768737367 | ✅ |
| Business | Android | business.usemingla.com | business.usemingla.com/ | ✅ |
| Business | desktop | business.usemingla.com | business.usemingla.com/ | ✅ |

No dead tap, no silent failure — the same-tab `window.location.assign` fallback fires with the right dest in every case.

### 2c. Keyboard a11y — the CTA is a real `<button>`

- Focus lands on `<button type="button">` ("Get Mingla").
- **Enter** → activates `onCtaClick` → `window.open` to `apps.apple.com/app/id6760440898`; stays on /links.
- **Space** → activates `onCtaClick` → same dest; stays on /links.

### 2d. ORCH-1327 switcher + one-viewport SNAPSHOT regression — clean

- **SNAPSHOT** (390×844 iPhone): `scrollHeight == clientHeight` (844=844), `scrollWidth == clientWidth` (390=390) → **no vertical or horizontal scroll/overflow**.
- **Switcher slides straight:** exactly ONE `aria-hidden` pill (count=1). Explorer box `x=25,y=271` → Business `x=197,y=259` → back to Explorer `x=25,y=271`. Pill translates horizontally (Δx≈172px), width constant (168px), returns exactly. No swing/arc, no second pill. (Top delta was ~12px, attributable to the copy-height difference between the two panels reflowing the tablist row, not a pill arc — the pill is absolutely positioned within the tablist and tracks it; ORCH-1327 guard + tests confirm the no-`layoutId` persistent-pill mechanism verbatim.)

### 2e. Double-tap idempotency + SSR safety

- Rapid 3× tap (iOS Explorer): 3 `window.open` calls, **all to the same dest** (`apps.apple.com/app/id6760440898`), **zero page errors**, stays on /links. No state corruption.
- SSR safety: `/links` prerendered statically in the build (exit 0) though the component is `'use client'`. `detectClientPlatform()` guards `typeof navigator === 'undefined' → 'other'`; `window.open` is only reached inside the click handler — never at module load/render.

**HONEST CAP (headless store-launch):** Automation suppresses the actual OS App-Store-app launch from a headless gesture. This test proves everything **up to and including** the `window.open` / `window.location.assign` call carrying the correct URL, plus the "stays on /links" property (the fix). The final store-app open is inherited from the identical, device-verified `glass-nav` handler (ORCH-1319 Explorer / ORCH-1324 Business, per project memory "shipped + device-verified"). The store-open leg is proven by production precedent, not by this headless run.

---

## 3. Step 0.5 audit — fails-on-revert is REAL (re-verified)

Temporarily restored the pre-fix `<Link>` soft-nav component (`git show 386ea8df8:…links-experience.tsx` = `22c9ff893^`), then restored via `git checkout`:

- **Guard** → FIRED (exit 1, 10 failures: `next/link` import + `<Link>` element banned; missing `detectClientPlatform`, all four consts, `window.open(`, `window.location.assign(`, `platform ===`).
- **Happy-path test** → FAILED 5/7.
- **Adversarial test** → FAILED 6/7 (soft-nav present, branch/reversal/desktop-QR/keyboard checks all fired).
- Restored → guard PASS, working tree clean (0-line diff). **`fails-on-revert verified at 22c9ff893` is confirmed real.**

**Distinct-angle confirmed:** happy-path asserts PRESENCE (button, four consts, window.open+assign, `tab.id==='business'`, analytics, token recipe). Adversarial asserts ABSENCE + correctness (no `next/link`/`<Link>`, no hardcoded literal, Business + Explorer branches NOT reversed, desktop reaches the QR via `openExternal(tab.cta.href)`, fallback present, native `<button>` not `role="button"`). Both are **new files (git status `A`) → append-only.**

---

## 4. Adversarial probes

- **`/download` + `/business/download` UNCHANGED:** `git diff main...HEAD` on both routes + `store-links.ts` + `device-platform.ts` + `links-config.ts` = empty. Direct curl: `/download` (iPhone UA) → **307 → apps.apple.com/app/id6760440898**; `/business/download` (iPhone UA) → **307 → apps.apple.com/app/id6768737367**; `/download` (desktop UA) → **200** (QR). Routes still redirect exactly as before.
- **"Everyone → one store" mutation** (collapsed business branch to `const dest = BUSINESS_APP_STORE_URL`): **caught by the adversarial test** (business-branch regex fails). ⚠️ See P2 — the strict-grep guard alone does NOT catch this specific mutation (it only requires `BUSINESS_WEB_URL` be *referenced*, which the import line still satisfies; no `noUnusedLocals`). The test is the catch; defense-in-depth holds. Restored, clean.
- **Rapid double-tap** — idempotent (see 2e).
- **SSR safety** — build-proven (see 2e).

---

## 5. Findings

- **P0/P1:** none.
- **P2 (guard coverage, non-blocking):** the ORCH-1328 strict-grep guard would NOT independently catch a "collapse the business branch to a single store" mutation because `BUSINESS_WEB_URL` remains in the import (satisfying its reference check) and there is no `noUnusedLocals`. The **adversarial test DOES catch it** (proven), so the regression is guarded; but the guard's const-reference check is weaker than a *usage* check. Optional future hardening: assert the exact ternary `platform === 'ios' ? BUSINESS_APP_STORE_URL : BUSINESS_WEB_URL` in the guard too. Not a ship blocker.
- **Note (not a defect):** in 2d the pill's `y` shifted ~12px between tabs — this is the two panels having different copy heights reflowing the tablist row, not a pill arc; the pill returns to the exact Explorer position and there is exactly one pill (no mount/unmount swing). ORCH-1327 guard + tests stay green.

---

## 6. Verdict

✅ **PASS.** All gates re-run green by the tester. Runtime-proven on the built `/links`: both CTAs, across Explorer + Business × iOS/Android/desktop, keep `/links` mounted (no blank, no footer) and open the correct destination; the popup-blocked `location.assign` fallback fires with the right dest in all 6 cases; the CTA is a keyboard-activatable native `<button>` (Enter+Space); the ORCH-1327 switcher slides straight (single pill) and the one-viewport SNAPSHOT holds (no scroll/overflow). Step 0.5 fails-on-revert re-verified real; the redirect routes are unchanged (307/200). The only finding is a non-blocking P2 guard-coverage note. Headless store-launch cap stated honestly.

**No merge / deploy / push / tag performed. No product code changed (all temporary reverts/mutations restored; working tree clean at `f96d806e8`).**
