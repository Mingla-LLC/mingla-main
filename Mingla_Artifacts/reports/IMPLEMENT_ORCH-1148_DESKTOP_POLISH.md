# IMPLEMENT — META-ORCH-1148 Sub-A 2.0.1: Venue Suite desktop-web layout polish

**Scope:** DESKTOP-WEB layout/visual ONLY. Native + web-phone single-column path, the
toggle logic, module content, schema, and all non-shell files are untouched.
**Branch:** `ORCH-1148-venue-desktop-polish` (rebased onto `origin/main` @ `1407ba099` / #501).
**Commit:** `bd29f211f` — *META-ORCH-1148 Sub-A 2.0.1: Venue Suite desktop-web layout polish*.
**Files changed (2):**
- `mingla-business/src/components/venue/VenueSuiteShell.tsx`
- `mingla-business/src/constants/designSystem.ts`

---

## Root cause of Seth's two complaints

The suite renders inside `DesktopCanvas` (the global desktop shell), whose content
column is `width:100%` and already offset from the 80px primary icon-nav by
`paddingLeft = DESKTOP_RAIL_WIDTH(80) + DESKTOP_BEZEL_MARGIN(12) = 92px`. The Hub
chrome above the suite (TopBar, To-Do toggle, sub-nav — all in `hub/_layout.tsx`) is
**full-width and left-aligned to `spacing.md` (16px)** inside that column, so the
chrome's content left edge sits at `92 + 16 = 108px` from the viewport.

The suite block, however, used `alignSelf:"center"` + `maxWidth:1200`. On a wide
viewport that **centered** the rail+workspace block inside the full-width column,
pushing the rail far to the RIGHT of the chrome's left edge → the large dead gutter
between the primary nav and the rail content (complaint #1). The design IA's
"centered, chrome above unchanged" recommendation was internally inconsistent: the
chrome is left-aligned, so a centered suite necessarily mismatches it.

---

## Fix #1 — kill the dead left gutter (alignment)

`styles.desktopCentered`:

| | Before | After |
|---|---|---|
| `alignSelf` | `"center"` | `"flex-start"` |
| `paddingHorizontal` | — (none) | `spacing.md` (16) |
| `maxWidth` | `venueSuiteMaxWidth` (1200) | `venueSuiteMaxWidth` (1200) — kept |

The suite is now **LEFT-anchored** to the exact same `spacing.md` left edge as the
Hub chrome above it, so the rail sits flush under the nav (108px from viewport, same
as TopBar/To-Do/sub-nav). `maxWidth:1200` still caps the RIGHT side on ultra-wide so
the workspace never runs edge-to-edge — it just no longer steals space from the left.

**Net:** rail left edge moves from "centered (far right of chrome)" → "108px, flush
with the chrome left edge." Dead left gutter eliminated; suite shares a coherent left
edge + max-width container with the chrome.

---

## Fix #2 — modernize (width, grid, active-state, rhythm, seam)

**Rail width** (`venueRailWidth` token): **260 → 220**. The module labels are short
("Command/Overview/Booking/Settings"); 260 left a dead band of empty rail. 220 is
tighter and intentional.

**Left grid alignment:** section caps and item rows now share ONE left grid line.
- `railSection.paddingHorizontal`: `spacing.md` → `spacing.sm` (8)
- `railRow.paddingHorizontal`: `spacing.md` → `spacing.sm` (8)
Section labels ("Command", "Booking") and row text now align on the same vertical
edge instead of the caps floating in at a different inset.

**Active-state refinement** (`railRowActive`): replaced the heavy
`accent.tint` (warm `rgba(235,120,37,0.28)` — the brown/orange filled highlight Seth
called out) with the restrained, neutral `glass.tint.profileElevated`
(`rgba(255,255,255,0.06)`). The warm accent is now reserved for the existing 3px
`railActiveBar` (`accent.warm #eb7825`) + the `text.primary` bold label. This matches
the app's selected-state convention (faint neutral surface + warm edge signal) and
reads sleeker than a saturated fill. The 3px warm left bar is preserved per Design
IA §"Active-row affordance."

**Rail ↔ workspace seam:** added a hairline divider on the rail's right edge
(`borderRightWidth: StyleSheet.hairlineWidth`, `borderRightColor:
glass.border.profileBase` = `rgba(255,255,255,0.08)`) + `paddingRight: spacing.sm`,
paired with the workspace's existing `paddingLeft: spacing.lg` → a coherent, balanced
seam between the two columns (was an undelineated gap).

**Vertical rhythm:** rail is now `paddingTop: spacing.xs` (top-aligned with content,
was `paddingVertical: spacing.md` which dropped the first label well below the
workspace top). Row `paddingVertical` stays `spacing.sm` for consistent rhythm;
`railInner.gap: spacing.xxs` unchanged.

### Token values chosen (all from `designSystem.ts`, no raw magic numbers)
- `venueRailWidth = 220`, `venueSuiteMaxWidth = 1200`
- `spacing.md = 16` (suite left gutter, matches chrome), `spacing.sm = 8` (rail grid),
  `spacing.lg = 24` (workspace left), `spacing.xs = 4` (rail top), `spacing.xxs = 2`
- `glass.tint.profileElevated = rgba(255,255,255,0.06)` (active surface)
- `glass.border.profileBase = rgba(255,255,255,0.08)` (rail hairline)
- `accent.warm = #eb7825` (3px active bar — unchanged)
- `text.primary/secondary/tertiary` (labels — unchanged)

---

## Cross-platform / policy safety
- All new values are tokens (added `glass` to the existing import). No raw hex/px
  introduced.
- `glass.*` values are rgba strings; `StyleSheet.hairlineWidth` resolves to ~1px on
  RN-web — both cross-platform safe. The hairline + active surface are opaque-safe
  (white-alpha overlays, not translucent glass blur), so the Android opaque-glass
  policy is not implicated (and this branch is desktop-web-gated by `isWideDesktop`
  regardless).

---

## Gate results
- `npm run test:orch-1148` — **GREEN** (strict-grep tax-form gate self-test + run +
  16 jest tests across venueModules / venueFeeGate / venueShellScroll). Re-confirmed
  post-rebase.
- `npx jest src/components/venue src/components/hub` — **GREEN** (7 suites, 34 tests),
  incl. `venueSuiteLeakAndExit.tester.adversarial` (the I-39 a11y / exit-restore
  invariants) and `VenueCreatorWizard` / address-dedup suites.
- `hub-layout-nav-lock` — **GREEN** (3 tests; nav-lock + scroll-clearance invariants
  intact).
- `tsc --noEmit` — **clean on the two changed files** (pre-existing repo-wide errors in
  unrelated checkout/marketing/test files remain, untouched by this change).
- `eslint` on both changed files — **exit 0, clean**.
- A broad `--testPathPattern "nav.?lock|hub|venue"` run surfaced 149 pre-existing
  failures across 85 suites (missing `@testing-library/react-native` dep + source-
  string assertion tests e.g. `PublicBrandPage.ve4`) — **zero overlap with the
  changed files**; all venue/rail/designSystem-touching suites pass.

`git diff --stat`: 2 files, +41/-9.

---

## Before → after (structural, since no render was driven)
| Aspect | Before | After |
|---|---|---|
| Suite horizontal anchor | centered in canvas column (`alignSelf:center`) | left-anchored to chrome edge (`flex-start` + `paddingHorizontal:md`) |
| Rail left edge vs chrome | floated far right of chrome → dead gutter | flush with chrome left edge (108px from viewport) |
| Rail width | 260 (dead band) | 220 (tight) |
| Section caps vs rows | different left insets (md vs md but caps read offset) | one shared grid line (both `spacing.sm`) |
| Active state | `accent.tint` brown fill + 3px bar | `glass.tint.profileElevated` neutral surface + 3px warm bar + bold primary label |
| Rail ↔ workspace seam | undelineated gap | hairline divider + balanced `sm`/`lg` gutters |
| Rail vertical start | dropped (`paddingVertical:md`) | top-aligned with content (`paddingTop:xs`) |
| Ultra-wide cap | maxWidth 1200 (centered) | maxWidth 1200 (left-anchored, caps right only) |

---

## Open design question for Seth
- **Rail width 220 vs 240:** I tightened to 220 since the current labels are short.
  If the Booking band later gains longer module names (Tables / Availability /
  Reservations / Waitlist — the full 11-row IA), 220 may feel cramped; easy one-token
  bump if you prefer more breathing room. Flag if you want 240.
- No render/screenshot was driven (no live web server in this pass) — the above is a
  rigorous structural + token description. Recommend a quick eyeball on
  business.usemingla.com → Hub → Venue at ≥1440px after deploy to confirm the left
  edge now matches the sub-nav above it.

**Not deployed, not merged** — per dispatch.
