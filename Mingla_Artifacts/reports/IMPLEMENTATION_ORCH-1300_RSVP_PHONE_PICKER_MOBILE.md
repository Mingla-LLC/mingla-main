# IMPLEMENTATION — ORCH-1300 [rsvp-phone-picker-mobile-portal]

Worktree: `~/Desktop/mingla-orchs/ORCH-1300-[rsvp-phone-picker-mobile-portal]/` on branch `ORCH-1300-rsvp-phone-picker-mobile-portal`
Status: **implemented; bug REPRODUCED on real mobile WebKit; fix MECHANISM proven on real mobile WebKit; full-integration WebKit verify handed to tester (no local web build possible — see §7).** Root cause = the conductor's transformed-ancestor theory, CONFIRMED with runtime evidence (no NOTIFY-LIST stop).
Also handled COMMS-0052 (BLOCK, OTA freeze): this is a WEB-only fix shipping via Vercel `[deploy]`; NO business `eas update` performed or required — native rides the next business build.

---

## 0. Root cause — CONFIRMED on real mobile WebKit (read first)

The conductor's HIGH-confidence diagnosis is **correct**. Proven, not assumed.

**Live WebKit-mobile repro** (Playwright `webkit` 26.4 + `devices['iPhone 13']`, viewport 390×664, live `https://business.usemingla.com/e/smokerhythm/july-4th-bbq-pool-party`, which already carries ORCH-1299):

| Probe (tap the country flag) | Result | Meaning |
|---|---|---|
| DOM node count before → after tap | 231 → 331 (+100) | the picker **DOES mount** (FIX 1 works: a 240-country FlatList adds ~100 rows/nodes) |
| "Select Country" title in DOM | present | picker content rendered |
| search input `placeholder="Search country or dial code"` | present in DOM | picker rendered… |
| …its bounding rect | **y = -683px** (viewport is 664px tall) | …**entirely ABOVE the viewport → invisible** |
| `searchVisible` (on-screen) | **false** | user sees nothing |
| country rows visible on-screen | 1 (of 15 in DOM) | overlay pushed off the top |
| details-modal path (tap "Going" → flag) | identical: +100 nodes, title present, search rect y=-683, off-screen | same failure inside `RsvpDetailsModal` |

So the picker mounts but the `position:'fixed'` layer renders **off-screen at y ≈ -683**, exactly the transformed-ancestor trap: on the RSVP page PhoneInput is nested inside `Animated`/transform wrappers, and mobile WebKit resolves `fixed` against the nearest **transformed** ancestor (not the viewport). Desktop Chromium is lenient — which is precisely why ORCH-1299's Chromium-at-430px check "passed" while the real phone stayed frozen.

Evidence: `Mingla_Artifacts/evidence/ORCH-1300/repro-01..04-*.png` (before/after tap, inline box + details modal).

**Engine-mechanism proof of the FIX** (self-contained page on the SAME WebKit + iPhone descriptor, reproducing the CSS structure — a `position:fixed` overlay inside a `transform` ancestor on a page scrolled 700px):

| Overlay placement | measured box top | on-screen? |
|---|---|---|
| **INLINE inside transformed ancestor** (pre-fix) | **-700px** | **false** — off-screen (mirrors the live -683) |
| **Portaled to `document.body`** (the fix) | **0px** | **true** — covers the viewport |

Evidence: `Mingla_Artifacts/evidence/ORCH-1300/mechanism-01-before-inline-fixed.png`, `mechanism-02-after-portal-body.png`. This proves, on the exact engine that exhibits the bug, that detaching the fixed layer to `document.body` makes it viewport-relative.

---

## 1. Summary (plain English)

On a real phone the RSVP guest phone country-picker taps but nothing appears. It actually *does* open — it just renders in an invisible spot above the top of the screen because a page animation "traps" it. The fix moves the picker to attach directly to the page body (a portal), so it always covers the screen no matter what animations are running around it. Desktop web, the buyer checkout, and the native apps are all unchanged.

---

## 2. SPEC success-criteria coverage

/goal: the RSVP guest phone country-picker OPENS and CHANGES country on a REAL mobile browser engine; desktop unchanged; checkout unchanged; native unchanged; fails-on-revert regression test; committed + pushed.

| SC | State | Note / commit |
|---|---|---|
| SC-1 picker OPENS (covers viewport) on mobile WebKit | **fix mechanism proven; full-integration hand to tester** | Bug repro'd off-screen on live WebKit; portal-to-body proven viewport-correct on WebKit (§0). Cannot build the app locally (empty worktree install — §7) → tester live-fires the deployed site. |
| SC-2 selecting a country CHANGES flag + dial code | **implemented; hand to tester** | Portals preserve the React tree, so the existing `onSelect → onChangeCountry → composeE164` wiring in PublicEventPage is untouched. Live-fire once picker is visible. |
| SC-3 desktop (Chromium) unchanged | ✓ (portal is a superset; no desktop-only change) | Desktop already worked; body-portal is viewport-relative on Chromium too. Tester confirms no regression. |
| SC-4 checkout phone path unchanged | ✓ verified (static) | Checkout hosts keep default `'modal'`; only the RSVP field uses `'overlay'`; the portal only affects the overlay. |
| SC-5 native unchanged | ✓ verified (static) | `WebOverlayPortal.tsx` (native) is a react-dom-free passthrough; overlay is web-only; CI gate check C enforces it. |
| SC-6 fails-on-revert regression test | ✓ verified | strict-grep gate (self-test 7/7) + fails-on-revert by true line deletion (§6). |
| SC-7 committed + pushed | ✓ | branch `ORCH-1300-rsvp-phone-picker-mobile-portal`. |
| SC-8 no new dependency | ✓ | `react-dom` already declared by mingla-business (web dep of react-native-web); native bundle stays react-dom-free via the `.web.tsx` split. |

---

## 3. Files changed

| File | Δ | What |
|---|---|---|
| `packages/phone-input/WebOverlayPortal.web.tsx` | NEW (~40) | WEB build: `createPortal(children, document.body)` (+ SSR guard). |
| `packages/phone-input/WebOverlayPortal.tsx` | NEW (~22) | NATIVE build: react-dom-free passthrough (Metro platform-resolves this off web). |
| `packages/phone-input/CountryPickerModal.tsx` | ~+13 | import `WebOverlayPortal`; wrap `CountryPickerOverlay`'s fixed `<View>` in `<WebOverlayPortal>`. `position:'fixed'` on web preserved. |
| `.github/scripts/strict-grep/orch-1300-rsvp-phone-picker-mobile-portal.mjs` | NEW | CI regression gate (checks A/B/C/D; self-test 7/7). |
| `.github/workflows/strict-grep-mingla-business.yml` | +16 | registers the gate job + registry header comment. |
| `mingla-business/src/components/event/__tests__/orch1300_web_overlay_portal.test.ts` | NEW | ts-jest behavioral test for the web portal contract (mocks react-dom, asserts portal→document.body). |

No migration. No edge function. No DB/RLS change. No new dependency. No checkout / chip-in / native change.

---

## 4. Old → New receipts

### packages/phone-input/CountryPickerModal.tsx
- **Before:** `CountryPickerOverlay` returned `<View style={overlayStyle...}>` (position `fixed` on web) rendered **inline** in PhoneInput's component tree — so on the RSVP page it was a descendant of `Animated`/transform wrappers, and mobile WebKit resolved `fixed` against a transformed ancestor → off-screen.
- **Now:** the same `<View>` is wrapped in `<WebOverlayPortal>…</WebOverlayPortal>`. On web that portals the whole fixed layer to `document.body` (zero transformed ancestors → `fixed` is viewport-relative on every engine). The `position:'fixed'` pin is unchanged. Native path unaffected (overlay never renders on native; wrapper is a passthrough).
- **Why:** SC-1 (the runtime-proven un-trap).

### packages/phone-input/WebOverlayPortal.web.tsx (NEW)
- `createPortal(children, document.body)` guarded by `typeof document !== 'undefined' && document.body` (SSR/static-export crash-safety; the overlay only mounts after a client tap, so the guard is never the real path). Imports `{ createPortal } from "react-dom"` — web-only, bundled only on web.

### packages/phone-input/WebOverlayPortal.tsx (NEW, native/default)
- Passthrough (`<>{children}</>`). No react-dom import. Metro resolves this on native so the web-only dep never enters the native bundle — mirrors the package's existing `ThemeEntranceAnimation.tsx`/`.web.tsx` and `PostHogAnalyticsProvider.tsx`/`.web.tsx` split.

---

## 5. Cross-surface impact

| Surface | Affected? | Detail |
|---|---|---|
| Buyer/anonymous Web (business) | YES | RSVP guest phone picker now covers the viewport on mobile web (and desktop). Ships via Vercel `[deploy]`. |
| Business iOS | NO | overlay is web-only (`resolvePickerPresentation`→`'modal'` off web); `WebOverlayPortal.tsx` passthrough is react-dom-free. Rides next business native build. |
| Business Android | NO | same as iOS. |
| Consumer iOS / Android | NO | `app-mobile` uses its OWN phone-input copies, not `@mingla/phone-input`; not touched. |
| Admin Web | NO | not imported. |
| Business Web preview | Incidental | shares buyer-web code. |

Parity: automatic (single shared `@mingla/phone-input` package). No manual parity paths.

---

## 6. Regression tests + fails-on-revert

### A. Strict-grep CI gate (CLOSE HARD MUST — CI-enforced guard)
`.github/scripts/strict-grep/orch-1300-rsvp-phone-picker-mobile-portal.mjs`, registered in `strict-grep-mingla-business.yml`. Checks: A (CountryPickerModal imports WebOverlayPortal AND wraps the overlay `<View>` in `<WebOverlayPortal>`), B (WebOverlayPortal.web.tsx `createPortal(children, document.body)`), C (WebOverlayPortal.tsx native has NO react-dom), D (web `position:'fixed'` preserved).
- Self-test: **PASS 7/7** (3 fixed shapes pass; 4 reverts fail).
- Live run: **PASS**.
- **Fails-on-revert by TRUE LINE DELETION, verified against the fix at commit `627b0c8dc`:**
  - Deleted the `<WebOverlayPortal>` wrap in CountryPickerModal.tsx (overlay back to inline) → gate **FAIL** (check A), exit 1 → restored → **PASS**.
  - Deleted the `createPortal(children, document.body)` line in WebOverlayPortal.web.tsx → gate **FAIL** (check B), exit 1 → restored → **PASS**.

### B. ts-jest behavioral test (runnable in CI)
`mingla-business/src/components/event/__tests__/orch1300_web_overlay_portal.test.ts` — mocks `react-dom`, stubs `document`, calls `WebOverlayPortal` from the `.web.tsx` build and asserts (T-1) it portals `children` into `document.body`, and (T-2) the SSR/no-DOM guard renders inline. Reverting `WebOverlayPortal.web.tsx` to inline fails T-1.
- **Could NOT run under jest in this session** — the worktree `node_modules` is a symlink to an EMPTY anchor install (no `react`/`react-dom`/`ts-jest`), and a full `npm install` would populate the SHARED anchor (forbidden). The equivalent decision was executed via plain node (`portal contract sim: 2/2 PASS`). The jest file runs in CI (react/react-dom present).

Append-only: both new test artifacts are additions; no existing test modified.

---

## 7. Gates run / not run (honest)

- **Strict-grep gate:** RUN — self-test 7/7 + live PASS + fails-on-revert (true line deletion). ✓
- **Portal contract (node sim):** RUN — 2/2. ✓
- **Live WebKit-mobile BUG repro:** RUN — picker off-screen at y=-683 (§0). ✓
- **WebKit-mobile FIX-MECHANISM proof:** RUN — portal-to-body is viewport-relative (box top 0, on-screen) vs inline-under-transform off-screen (box top -700) (§0). ✓
- **Full-integration WebKit-mobile FIX verify (the built app):** **NOT RUN — no local web build possible.** The worktree `node_modules` symlinks to an empty anchor install (no `react-native-web`), and installing would mutate the shared anchor (forbidden). Per the dispatch's explicit fallback, this is handed to the tester to live-fire on the deployed site (§11).
- **`tsc --noEmit` / `npx jest`:** NOT RUN — same empty-install reason. Types reasoned manually; the `.web.tsx`/`.tsx` split mirrors shipped, CI-tsc'd package patterns (`ThemeEntranceAnimation`, `PostHogAnalyticsProvider`). CI runs both.

---

## 8. Smoke result

Live WebKit-mobile reproduction of the bug (off-screen picker) + WebKit-mobile mechanism proof of the fix (§0). The BUILT fix was not smoke-tested (no local web build) → tester.

---

## 9. Known issues / deferred

- The underlying page-level defect flagged in ORCH-1299 (a looping `Animated` handle) is unrelated to this trap and remains a separate discovery; not in scope here.
- SSR guard in `WebOverlayPortal.web.tsx` returns children inline if `document` is absent — inert in practice (overlay only mounts after a client tap).

---

## 10. Operator action required

- None for DB/edge (none touched).
- Merge ships web via Vercel `[deploy]`; **NO business `eas update`** (COMMS-0052 OTA freeze) — native rides the next business native build.
- CI runs `orch-1300-*` gate + `orch1300_web_overlay_portal` jest test automatically.

---

## 11. Downstream routing

Conductor REVIEW → **mingla-tester MUST live-fire on the DEPLOYED site using Playwright `webkit` + an iPhone descriptor** (the implementor could not build the app locally): confirm the RSVP guest phone picker (a) OPENS and COVERS the viewport on tapping the flag inside the details modal AND the inline contact box on mobile WebKit, (b) the country list scrolls and rows are tappable, (c) selecting a country changes the flag + dial code + composed E.164, (d) desktop Chromium still works, (e) buyer checkout picker still opens. Then merge (web via Vercel `[deploy]`). The exact repro/mechanism scripts are in `Mingla_Artifacts/evidence/ORCH-1300/` inputs and the report §0.

---

## 12. Discoveries for Orchestrator

- **Chromium-at-viewport-width is NOT a substitute for a real mobile engine.** ORCH-1299 "passed" on Chromium@430px but the phone stayed broken because `position:fixed` containing-block behavior under transformed ancestors differs between Blink (lenient) and WebKit (strict). Any future web mobile-layout verification should use Playwright `webkit` + a device descriptor, not Chromium shrunk to phone width. Worth encoding in the tester's mobile-web checklist.
