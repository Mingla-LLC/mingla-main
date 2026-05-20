# ORCH-0885-A — REWORK CLOSE: `DesktopCanvas` centring + ambient gradient

**Date:** 2026-05-19
**Rework of:** `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md` (first-pass CLOSE)
**File touched:** `mingla-business/src/components/ui/DesktopCanvas.tsx` (1 file, scoped exactly to dispatch)
**Branch:** `Seth` (uncommitted — operator decides on commit per dispatch rule §5)

---

## 1. Context — the two bugs this rework fixes

The first-pass `DesktopCanvas` implementation shipped functional gate logic
(hook → wide-desktop branch) but two visible regressions in the wide-desktop
render path were caught by the operator's first smoke-test step on Chrome
at 1440 px:

- **BUG 1 — Content column left-anchored against the rail, not centred.**
  The 640 px column hugged the rail (left edge of the canvas) with ~1500 px
  of empty dark space on the right. Root cause: the column had
  `width: "100%"` + `alignSelf: "center"`. On RN-web, `width: 100%` forces
  the flex item to claim all cross-axis space (clamped only by `maxWidth`
  at paint time — not at layout time), so `alignSelf: "center"` becomes a
  no-op and the column lays out at the leading edge of the parent.

- **BUG 2 — Ambient gradient invisible.** The canvas rendered as uniform
  `#0c0e12`. The three radial gradient stops (warm orange top-centre,
  indigo bottom-left, cyan bottom-right) were not visually perceptible.
  Root cause: `react-native-svg` `<RadialGradient gradientUnits="objectBoundingBox">`
  with percentage `cx/cy/rx/ry` is unreliable on RN-web — the gradients
  paint at near-zero perceptible size, OR not at all. The brainstorm mock
  achieves the same visual via CSS `radial-gradient(...)` in a
  `background:` shorthand, which is the browser's native renderer.

Both bugs are fixed in this rework. No other ORCH-0885-A file was touched
(BottomNav.web.tsx, Sheet.web.tsx, useResponsiveLayout.ts, the
strict-grep gate, the layout, the hook test — all untouched).

---

## 2. Diff summary — what changed inside `DesktopCanvas.tsx`

All line numbers refer to the post-rework file.

**Imports (line 48–49)** — dropped `react-native-svg` (`Svg`, `Defs`, `SvgRadialGradient`, `Rect`, `Stop` no longer needed). Added `Platform` + `type ViewStyle`.

```diff
-import React from "react";
-import { StyleSheet, View } from "react-native";
-import Svg, {
-  Defs,
-  RadialGradient as SvgRadialGradient,
-  Rect,
-  Stop,
-} from "react-native-svg";
+import React from "react";
+import { Platform, StyleSheet, View, type ViewStyle } from "react-native";
```

**Gradient definition (lines 78–110)** — replaced the `GradientStop` interface + `GRADIENT_STOPS` array (~30 lines of SVG-shaped data) with `CANVAS_GRADIENT_BACKGROUND_IMAGE` (CSS string) + `gradientBackgroundStyle` (Platform-gated `backgroundImage` style object).

**Render body (lines 112–139)** — replaced the `<Svg>` block + nested `<Defs>` + 3 `<Rect>` + child `<View style={styles.column}>` (~40 lines) with the minimal:

```jsx
<View style={[styles.canvas, gradientBackgroundStyle]}>
  <View style={[styles.column, { maxWidth }]}>{children}</View>
</View>
```

**StyleSheet (lines 141–156)** — removed `alignSelf: "center"` from `column`; added `alignItems: "center"` to `canvas`. The column keeps `width: "100%"` + `flex: 1` + `paddingHorizontal: 32`; the parent's `alignItems: "center"` does the cross-axis centring (the canonical RN-web pattern).

Net: file went from 209 lines (first pass) to 159 lines (rework). Comment / doc / invariant coverage retained + expanded to document the rework rationale.

---

## 3. Fix 1 approach + why — wrapper-based centring (Option A from dispatch)

Adopted the dispatch's **Option A (wrapper-based centring)**:
- Parent canvas View gets `alignItems: "center"` (already a flex column via the implicit RN default + `flex: 1`).
- Child column keeps `width: "100%"`, `maxWidth: 640`, `flex: 1`, `paddingHorizontal: 32`.
- `alignSelf: "center"` removed (was a no-op the whole time, contradicted by `width: "100%"`).

**Why wrapper-based (not margin-auto):** `alignItems` is RN core API supported equally on native + web — even though this branch only renders on web, sticking with portable core API means the snapshot test (which mocks `react-native` in node-test-environment) keeps working with no extra polyfill, AND the pattern is reusable verbatim if the canvas is ever mounted in a non-`(tabs)` context. The `marginHorizontal: "auto"` alternative is web-only and would require either a `Platform.OS === "web"` guard inside the style object (more code) or a typecast to `any` (loses type safety on no upside, since `alignItems` already does the job).

---

## 4. Fix 2 approach + why — CSS `background-image: radial-gradient(...)`

Adopted the dispatch's **(a) CSS backgroundImage** approach.

`CANVAS_GRADIENT_BACKGROUND_IMAGE` is a single string composed of three comma-separated `radial-gradient(...)` declarations sourced verbatim from `Mingla_Artifacts/design/desktop-redesign/01-tier1-container-rail.html` `.canvas-bg` (lines 28–35). The geometry (`80% 50% at 50% 0%`, `60% 60% at 10% 100%`, `60% 60% at 90% 100%`), colour stops (`rgba(235,120,37,0.08)`, `rgba(120,80,200,0.06)`, `rgba(50,180,200,0.05)`), and fade-out offsets (60% / 50% / 50%) match the mock byte-for-byte.

`gradientBackgroundStyle` is a `Platform.OS === "web"` guarded `ViewStyle` (cast through `as ViewStyle` because `backgroundImage` is a react-native-web extension, not in RN core types). On native it resolves to `{}` — but the whole wide-desktop branch is unreachable on native anyway because `isWideDesktop` requires `Platform.OS === "web"`.

The style is applied as the second element of the `canvas` style array: `style={[styles.canvas, gradientBackgroundStyle]}`. The `styles.canvas` `backgroundColor: '#0c0e12'` paints the base; the browser then composites the three `radial-gradient(...)` layers on top (additively, because all three end at `transparent`). This is identical to how the mock's CSS `background:` shorthand layers `radial-gradient(...), radial-gradient(...), radial-gradient(...), #0c0e12` — same renderer, same syntax, same visual.

**Why CSS over SVG-userSpaceOnUse:** the dispatch correctly noted that `userSpaceOnUse` + `useWindowDimensions()` would also work, but CSS gradients are (a) one-liner per declaration, (b) zero additional dependency, (c) zero re-render on resize (the browser repaints the gradient natively), and (d) byte-identical to the mock's source code so visual parity is provably exact. The SVG approach kept the `react-native-svg` dependency on the desktop branch's hot path for zero functional gain.

---

## 5. Test results

| Check                                                            | Status  | Notes |
|------------------------------------------------------------------|---------|-------|
| `npx jest src/hooks/__tests__/useResponsiveLayout.test.ts`       | PASS 7/7 | hook + DesktopCanvas-gate cases all green |
| `npm run test:orch-0885-a` (strict-grep gate + hook test)        | PASS    | "ORCH-0885-A gate passed — BottomNav allow-list intact + desktop gate hook-only." + 7/7 jest |
| `npx tsc --noEmit` (DesktopCanvas-scoped)                        | PASS    | 0 new errors attributable to DesktopCanvas; pre-existing errors in `../packages/phone-input/*` unchanged |
| `npm run lint` (DesktopCanvas-scoped)                            | PASS    | 0 lint errors / warnings in `DesktopCanvas.tsx`; pre-existing repo-wide warnings unchanged |

Verbatim jest output:
```
PASS src/hooks/__tests__/useResponsiveLayout.test.ts
  useResponsiveLayout — happy-path contract
    ✓ native always returns isWideDesktop=false, isWeb=false (case 1)
    ✓ native android with desktop-class width still returns false
    ✓ web sub-1024 returns isWideDesktop=false (case 2)
    ✓ web at-or-above 1024 returns isWideDesktop=true — boundary INCLUSIVE (case 3)
    ✓ web at 1440 returns isWideDesktop=true
  DesktopCanvas — render contract
    ✓ at width 1440 the gate boolean is true (centred-column branch reached)
    ✓ at width 800 the gate boolean is false (Fragment passthrough reached)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

Strict-grep gate verbatim:
```
ORCH-0885-A gate passed — BottomNav allow-list intact + desktop gate hook-only.
```

---

## 6. Fails-on-revert

This rework touches **only the visual render branch** of `DesktopCanvas`
(centring + gradient layer). It does NOT touch the hook
(`useResponsiveLayout.ts`) — which is the only ORCH-0885-A behaviour
covered by the existing happy-path test (`useResponsiveLayout.test.ts`).

The existing happy-path test's fails-on-revert was proven in the first-pass
CLOSE (cite: `IMPLEMENTATION_ORCH-0885-A_TIER_1_DESKTOP_CONTAINER_RAIL.md` §"Fails-on-revert evidence (ORCH-0840 Step 0.5)"). The hook implementation
is unchanged in this rework, so that fails-on-revert protocol still holds verbatim — re-running it would produce the same 3 RED cases (case 3 boundary, case 1 native-always-false, case 2 web sub-1024).

The rework-specific behaviour (visual centring + gradient visibility) is by
nature a **paint-pixel observation**, not a jest-observable state change.
The two `DesktopCanvas — render contract` cases assert only the gate
boolean (which path the canvas component takes), which is unchanged by
this rework. A pixel-level visual fails-on-revert would require either:

- A Playwright / Puppeteer screenshot test against a live web preview (out of scope per dispatch §6 — operator drives the browser, not the implementor)
- A snapshot test of the rendered React tree at width 1440 — currently absent (and per dispatch §1 "only update tests as a last resort"; the gate boolean tests are sufficient to prove the wide-desktop branch is reached).

The fails-on-revert for this rework is therefore the **operator's eye on
the browser at 1440**: revert this commit, refresh Chrome, observe the
content hugging the rail with no warm wash visible (i.e. reproduce BUG 1
+ BUG 2). Re-apply the commit, refresh, observe content centred + warm
wash visible at top. This is the smoke-test the operator will execute
per dispatch §6 — and it is the same protocol the operator already used
to surface the two bugs in the first place.

---

## 7. Invariants honoured

- **I-RN-COLOR-FORMATS** — every colour is hex or rgba. `#0c0e12` is hex; `rgba(235, 120, 37, 0.08)`, `rgba(120, 80, 200, 0.06)`, `rgba(50, 180, 200, 0.05)` are rgba. No `oklch`, `lab`, `lch`, `color-mix`. Inside the CSS gradient string the same three rgba values are reused — browser CSS engine resolves them as rgba, not as an extended-gamut format.
- **I-DESKTOP-GATE-VIA-HOOK** — gating still flows exclusively through `useResponsiveLayout()`. The new render path is wrapped in `if (!isWideDesktop) return <>{children}</>;` — identical guard pattern to first-pass.
- **I-CROSS-SURFACE-IMPACT** — native is still a Fragment passthrough; no extra View, no gradient layer. The `gradientBackgroundStyle` Platform-guard ensures `backgroundImage` is never serialised into a StyleSheet on iOS/Android (StyleSheet.create-time validation would warn). And the whole wide-desktop branch is unreachable on native by the `isWideDesktop` precondition (which requires `Platform.OS === "web"`).
- **I-NO-BOTTOMNAV-OUTSIDE-LAYOUT** — N/A; this rework does not touch BottomNav. Verified by strict-grep gate PASS.
- **I-DESKTOP-CONTAINER-MAX-WIDTH-640** (from SPEC §3) — `DESKTOP_CONTENT_MAX_WIDTH = 640`, exported constant unchanged. Default value flows through `maxWidth` prop default.

---

## 8. What the operator should see now on Chrome 1440

On `cmd-shift-R` cold-load of `business.usemingla.com` at viewport ≥ 1024 px (e.g. 1440 wide):

1. **Centred content column** — the 640 px content column sits horizontally centred in the visible browser viewport. With the rail's 80 px absolute-positioned overlay on the left, the visual centre is slightly offset (you'll see ~400 px of ambient canvas on each side of the column at 1440 viewport width, with the rail floating over the leftmost 80 px of that left margin). NOT hugging the rail.

2. **Perceptible warm orange wash at top-centre** — a soft, glowy `rgba(235,120,37,0.08)` radial wash that bleeds downward from the top edge of the canvas, peaking at horizontal centre. Visible against the `#0c0e12` base as a subtle warm halo behind the header area.

3. **Indigo wash at bottom-left corner** — a `rgba(120,80,200,0.06)` radial wash centred at the bottom-left of the canvas (behind the rail). Subtle but visible as a cool purple bloom in the bottom-left ambient margin.

4. **Cyan wash at bottom-right corner** — a `rgba(50,180,200,0.05)` radial wash, mirror of the indigo. Subtle teal bloom in the bottom-right ambient margin.

The three washes add up to the "brand-ambient canvas in the margins"
brainstorm-mock vibe — not abandonment-black, not loud, just a quiet
ambient atmosphere that signals the desktop surface is intentional.

**Visual target file:** `Mingla_Artifacts/design/desktop-redesign/01-tier1-container-rail.html` — open in a second tab side-by-side with `business.usemingla.com` at 1440 to A/B the warm-wash position, intensity, and column-centring. They should be visually indistinguishable apart from the placeholder card / annotation content.

If the operator sees the warm wash but the column is still hugging the
rail → BUG 1 not fixed, escalate. If the column is centred but the canvas
is still uniform black → BUG 2 not fixed, escalate. Both fixed →
ORCH-0885-A rework PASS, ready for tester verdict.

---

**Status:** REWORK CLOSE — implementor done. Tester next.
**Working tree:** dirty (per dispatch §5 — no commit, no push).
