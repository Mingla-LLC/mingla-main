# IMPLEMENT — ORCH-1190 [venue empty-state full-width on desktop web] — attempt #5 (the fix)

**Skill:** mingla-forensics+claude (driven as god-level engineer; production code)
**Worktree:** `~/Desktop/mingla-orchs/1190-[chrome-fullwidth]/` on branch `1190-chrome-fullwidth`
**Date:** 2026-06-21
**Status:** ROOT CAUSE PROVEN in real Chromium against the REAL shell; fixed at the shared primitive; before/after measured; fails-on-revert regression test added.
**COMMS:** acked COMMS-0052 (business-app OTA blocked — this is a web/JS-only fix, ships via Vercel, no `eas update`).

---

## 0. Why the prior 4 fixes failed (and why jsdom false-greened them)

R1–R4 all added `width:"100%"` / `alignSelf:"stretch"` to the empty CARD's outer
View (`emptyCard` / `emptyWrap`). They "proved" it with jsdom/ReactDOMServer
class-presence tests — jsdom has NO flexbox layout engine, so it can confirm a
class is emitted but can never measure that the box is actually narrow. The bug
was never in the leaf style: **the empty card's OUTER View was already full-width
in every attempt.** The collapse happened ONE layer deeper, inside the shared
`GlassChrome` primitive, which jsdom cannot see.

---

## 1. Reproduction in REAL Chromium against the REAL shell (the required evidence)

Tooling: an **esbuild** bundle (react-native → react-native-web 0.21.2 alias,
single React/react-dom/react-query instance from the anchor node_modules; data
hooks mocked to force the EMPTY reservations/waitlist/menu state; supabase /
auth / safe-area / reanimated stubbed — none affect width) mounting the **REAL
`VenueSuiteShell`** desktop path inside the **REAL ancestor chain**
(`(tabs)` host → `DesktopCanvas` → hub `host` → Slot region → module), served
over http and loaded in **real headless Chromium** (Playwright) at **1440×900**.
This is NOT jsdom and NOT an isolated leaf harness — it is the production
component tree in a real browser layout engine.

Self-validation that the harness is faithful: with a BARE `emptyCard`
(no width, no stretch) the outer card STILL measured 1132px full-width — i.e.
the harness reproduces the real shell's stretch behaviour, and the leaf style is
irrelevant, exactly as suspected.

### Parent chain walk (Reservations empty card, viewport 1440×900, real Chromium)

Walking UP from the empty card to the shell — every ancestor is full-width:

| depth | element (testID) | width px | display | alignItems | alignSelf | cssWidth |
|---|---|---|---|---|---|---|
| 0 | GlassCard OUTER View (`emptyCard`) | **1132** | flex/col | **center** | stretch | 1132px |
| 1 | `venue-reservations-empty-wrap` | 1132 | flex/col | stretch | stretch | 1132px |
| 2 | `venue-reservations-module` (host) | 1164 | flex/col | stretch | auto | 1164px |
| 3 | (host inner) | 1164 | flex/col | stretch | auto | 1164px |
| 4 | ScrollView content | 1164 | flex/col | stretch | auto | 1164px |
| 5 | `desktopWorkspace` | 1188 | flex/col | stretch | auto | 1188px |
| 6 | `desktopCentered` | 1440 | flex/ROW | stretch | flex-start | 1440px |
| 7 | `venue-suite-shell-desktop` | 1440 | flex/col | stretch | auto | 1440px |

The outer card is FULL-WIDTH (1132). So the constraint is NOT up the chain.

### Walk DOWN into the GlassChrome layers (the real constraint)

| depth | element | width px (BEFORE) | alignItems | alignSelf |
|---|---|---|---|---|
| 0 | GlassCard OUTER View (`emptyCard`) | 1132 | **center** | stretch |
| 1 | GlassChrome **`clip`** (the visible glass surface) | **496** ← COLLAPSED | stretch | auto |
| 2 | GlassChrome **`content`** | 496 | stretch | auto |
| 3 | GlassCard `{padding}` View | 496 | stretch | auto |
| 4 | icon SVG | 26 | — | — |

---

## 2. The deterministic constraint + the responsible CSS property

**Constraining element:** `GlassChrome`'s inner **`clip`** View (and the
`content` View nested in it) — `mingla-business/src/components/ui/GlassChrome.tsx`.

**Responsible property:** the `clip` and `content` Views had **no `width` and no
`alignSelf`**. On react-native-web a width-less child View shrinks to its
content's **min-content width**. Because the empty card's OUTER View sets
`alignItems:"center"`, that shrunken glass surface is then ALSO **centered** —
producing a full-width invisible box wrapping a NARROW, CENTERED visible card.
That is precisely Seth's symptom. The four prior fixes touched the outer View
(already full-width) and never the inner layers, so the visible surface stayed
narrow.

Cross-check with the WORKING sibling: `VenueTablesModule.tableCard` renders
full-width only because it manually pins its direct content child (`tableRow`) to
`width:"100%"` — a per-consumer workaround for the same GlassChrome-inner
collapse. The empty cards had no such inner pin, so they collapsed.

### BEFORE (origin/main GlassChrome) — visible glass-surface (`clip`) width, real Chromium

| module | outer card | clip surface (visible glass) | verdict |
|---|---|---|---|
| reservations | 1132px | **496px** | narrow + centered |
| waitlist | 1132px | **553px** | narrow + centered |
| menu | 1132px | **528px** | narrow + centered |

---

## 3. The fix (at the shared primitive — fixes all 3 modules at once)

`mingla-business/src/components/ui/GlassChrome.tsx` — add `alignSelf:"stretch"`
to BOTH inner layers so the visible glass surface always fills its outer View's
resolved width:

```
clip:    { overflow: "hidden", alignSelf: "stretch" }
content: { position: "relative", alignSelf: "stretch" }
```

Why this is universally correct (not just for the venue cards): `alignSelf:
"stretch"` resolves against the **outer View's** cross size. For the venue empty
cards the outer View is full-width → the clip becomes full-width. For
intrinsically-sized chrome (pills, badges) the outer View is content-sized → the
clip matches that small width — unchanged. There is no consumer for which the
visible clip should be a DIFFERENT width than its own outer container, so this is
safe across all 94 GlassChrome/GlassCard consumers.

The leaf `width:"100%"`+`alignSelf:"stretch"` on the empty cards (from R4) are now
redundant but left in place — harmless, and removing them would needlessly churn
the R3/R4 tests with zero layout effect.

### AFTER (GlassChrome fix) — visible glass-surface (`clip`) width, real Chromium

| module | outer card | clip surface (visible glass) | verdict |
|---|---|---|---|
| reservations | 1132px | **1132px** | FULL WIDTH ✓ |
| waitlist | 1132px | **1132px** | FULL WIDTH ✓ |
| menu | 1132px | **1132px** | FULL WIDTH ✓ |

Before→after delta: +636px (reservations), +579px (waitlist), +604px (menu).

---

## 4. Regression test (fails-on-revert, cited)

New, NON-jsdom-fragile contract on the actual fixed primitive:
- `mingla-business/src/components/ui/__tests__/glassChromeFullWidthSurface.orch1190.web.render.test.tsx`
- config `mingla-business/jest.orch1190.glasschrome.web.render.cjs`

Renders the REAL `GlassChrome` through react-native-web's atomic-class compiler
(ReactDOMServer = the exact classes Vercel ships) and asserts the
`alignSelf:"stretch"` atom (`r-alignSelf-1pz39u2`) appears on the inner glass
layers ≥2 times (clip + content). The test header carries the full real-Chromium
measurement table as the load-bearing evidence (jsdom can't measure layout).

**Fails-on-revert PROVEN by true line-deletion:** deleting the two `alignSelf`
lines from GlassChrome drops the atom count to 0 → test FAILS
(`Expected: >= 2, Received: 0`); restoring → PASS (2/2). Verified this pass.

Existing venue width suites still green: `jest.orch1190r3.venuewidth` (3/3),
`jest.orch1190r2.tablecard` (4/4), `venueSuiteShell.orch1184.fullwidth.test` (5/5).
(`*.adversarial.render` + `brandSwitch.orch1190r2` "fail to run" — pre-existing
missing `@testing-library/react-native` in the anchor node_modules; same failure
on origin/main without my change; NOT a regression.)

---

## 5. Files changed (allowlist)

| File | Δ | What |
|---|---|---|
| `mingla-business/src/components/ui/GlassChrome.tsx` | +`alignSelf:"stretch"` on `clip` + `content` (+ explanatory comments) | THE FIX |
| `mingla-business/src/components/ui/__tests__/glassChromeFullWidthSurface.orch1190.web.render.test.tsx` | +new | fails-on-revert regression test |
| `mingla-business/jest.orch1190.glasschrome.web.render.cjs` | +new | jest config for the test |

Real source change → forces a fresh Vercel build. Temp esbuild+Playwright
harness lived entirely under `/tmp/orch1190` (outside the repo) and is NOT
committed; the earlier abandoned `.orch1190-repro` npm attempt + its
package.json/lock churn were reverted — repo is clean except the three files above.

---

## 6. Cross-surface note

Business desktop web only (the `isWideDesktop` path). The fix is at the shared
primitive but is layout-neutral on native + web-phone (the outer View there is
already the sizing authority; stretch matches it). Business-app OTA stays blocked
(COMMS-0052) — irrelevant here; this ships to buyers/operators via the Vercel web
build, not via `eas update`.
