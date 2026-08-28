/**
 * Shared tokens aligned with app-mobile for consistent Mingla branding.
 *
 * Cycle 0a: extended additively with the design-package token set
 * (accent / canvas / glass / semantic / text / blurIntensity / easings /
 * durations / typography). Existing exports preserved verbatim.
 *
 * Sub-phase E.2: glass shadow tokens (`glassBadge`, `glassChrome`,
 * `glassChromeActive`, `glassCardBase`, `glassCardElevated`, `glassModal`)
 * use `Platform.select` to zero `elevation` on Android. Reason: Android
 * `elevation` draws a hard rectangular drop-shadow regardless of border-
 * radius or alpha, which bleeds through translucent glass surfaces and
 * creates a "solid box inside" artifact (ORCH-BIZ-0a-E4). iOS shadow*
 * fields are preserved verbatim — premium blur unchanged on iOS.
 */

import { Platform } from "react-native";

// Sub-phase E.3 (ORCH-BIZ-0a-E8): renamed from `glassElevation` and applied
// to ALL shadow tokens (including non-glass `sm`/`md`/`lg`/`xl`). Reason:
// styleguide demos render the generic shadows on translucent backgrounds,
// so the same Android elevation-rectangle artifact applied. There are no
// opaque-card consumers in mingla-business today; if a future cycle needs
// Android elevation on a specific opaque surface, override at the component
// level.
const androidSafeElevation = (ios: number): number =>
  Platform.select({ ios, android: 0, default: ios }) ?? ios;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 28,
  display: 40,
  full: 999,
} as const;

// META-ORCH-1148 sub-ORCH 2.0 — venue-suite layout token (Design §8). The
// desktop two-column master rail width. Named so no raw layout numbers live in
// VenueSuiteShell.
//
// 2.0.1 desktop polish: the rail narrowed 260→220 (the labels are short; 260
// left a dead band of empty rail) and the whole suite is LEFT-anchored to the
// Hub chrome's `spacing.md` edge instead of centered in the canvas column —
// `alignSelf:"center"` floated the rail far right of the left-aligned TopBar /
// To-Do / sub-nav chrome, opening the dead gutter Seth flagged.
//
// ORCH-1184: the former `venueSuiteMaxWidth` (1200) workspace max-width cap was
// REMOVED — the workspace now fills the full page width (Seth's decision; the
// cap left dead right-side canvas / a "black bar" on wide monitors).
export const venueRailWidth = 220 as const;

// Issue #2737 — reservation calendar geometry. This is deliberately scoped to
// the operator calendar so responsive density never becomes a second global
// page-layout system.
export const reservationCalendarLayout = {
  agendaMaxWidth: 920,
  agendaRowMinHeight: 68,
  entryMinTarget: 44,
  dateCellMinWidth: 48,
  dateCellMinHeight: 56,
  weekDayMinWidth: 112,
  monthCellMinHeight: 152,
  monthVisibleEntryLimit: 2,
} as const;

// ORCH-1186-A: the venue Settings content column readable-measure cap on wide
// desktop. The ORCH-1184 workspace fills the full page width, so an editable
// form would stretch to an unreadable line length on a wide monitor — cap the
// Settings column (left-anchored) to keep the ~65–75 char body measure.
export const venueSettingsMaxWidth = 720 as const;

// ── Issue #1484 [stay-desktop-shell] — suite page-measure tokens ────────────
// The Stay suite now renders inside the SHARED `SuiteDesktopShell` (the same
// rail + full-width workspace the Restaurant suite has). Its per-module width
// rules live here so no raw layout numbers sit in the components.
//
// suiteFormMaxWidth — the readable-measure cap for an EDITABLE FORM column on
// wide desktop (Stay Settings). The workspace fills the full page width, so an
// uncapped form would stretch to an unreadable line length; this keeps the
// ~65–75 character body measure, left-anchored. DELIBERATELY a NEW token, not a
// revival of `venueSettingsMaxWidth` — ORCH-1190 removed that token's last
// consumer and `venueSuitePolish.orch1190.test.ts` pins that it never returns
// to `VenueSettingsModule`.
export const suiteFormMaxWidth = 720 as const;

// ── #2262 [composer-responsive-layout] — composer layout tokens ────────────
//
// THREE tokens, each justified in the DESIGN contract on #2262 §1.2. They are
// deliberately NOT viewport arithmetic: `bp*` are THRESHOLDS a boolean is
// derived from (never a term in a height), and `composerSheetMinHeight` is a
// FLOOR on a flexed child (a `minHeight:` value and nothing else — enforced by
// the i-2262 gate rule R10). Neither is ever subtracted from a viewport height.

/**
 * Width breakpoint — below this the composer drops labels to glyphs and
 * tightens its gutter to `spacing.sm`. `useResponsiveLayout` does not gate on
 * it (it is a per-component width decision, not the desktop authority).
 */
export const bpCompact = 360 as const;

/**
 * Width breakpoint — at/above this a phone-shaped surface has room for a
 * labelled Preview button and the sheet takes `suiteFormMaxWidth`.
 */
export const bpRegular = 600 as const;

/**
 * HEIGHT breakpoint. #2262's worst measured failure was 1024x700 — a SHORT
 * window, not a narrow one, and structurally unreachable through a width-only
 * responsive system. `useResponsiveLayout` derives `isShort` from this and
 * exposes only the BOOLEAN: handing every consumer of the app's most-used
 * layout hook a number that changes on every keyboard frame is exactly the
 * `visualViewport` resize-churn ORCH-1098 spent a spike on.
 */
export const bpShort = 720 as const;

/**
 * The composer sheet's floor, in points.
 *
 * DERIVATION (#2262 SPEC AMENDMENT D-4 corrected the DESIGN's arithmetic, which
 * omitted the subject row its own §3.3 puts inside the same sheet):
 *
 *     44   subject row            (design §3.3 — a raw TextInput, not `Input`)
 *   + 44   toolbar foot           (design §3.5 — InsertionBar at the sheet foot)
 *   + 12   vertical padding pair  (8 top + 8 bottom, rounded to the pair)
 *   + 140  six body lines         (6 x 15px x 1.55 leading = 139.5)
 *   ────
 *     240
 *
 * On the SMS channel the subject row is absent, so SMS gets MORE body out of
 * the same floor. There is deliberately ONE value — a second SMS-specific floor
 * would be the same defect class (two numbers for one idea) that
 * `PHONE_WEB_BODY_MIN_PX` vs `Math.max(120, ...)` already was.
 *
 * This is a floor on a FLEXED child, which is a different object from the
 * `Math.max(120, rawBodyHeight)` this issue deletes: it participates in no
 * subtraction and reads no viewport. When available space drops below it the
 * sheet overflows the flex region and is CLIPPED there (Band B carries
 * `overflow:'hidden'`), so it can never displace the commit bar.
 */
export const composerSheetMinHeight = 240 as const;

// The PHONE / web-phone readable-measure caps the Stay modules already shipped
// with (tokenised here, values unchanged, so the sub-1024px layout is
// byte-identical). On wide desktop every one of these is released — the shared
// shell owns the gutters and the left anchor.
export const stayPageMaxWidth = 820 as const;
export const stayInventoryMaxWidth = 900 as const;
export const stayReservationsMaxWidth = 920 as const;

// Minimum comfortable width for one Stay Overview readiness row when the rows
// reflow into a multi-column grid on wide desktop. Below this the row falls
// back to fewer columns (flexWrap handles it).
export const stayOverviewRowMinWidth = 320 as const;

// #1484 — the Stay Overview readiness grid is capped at a MAXIMUM OF 3 COLUMNS
// (approved design: "Cards reflow into a 2–3 column grid, full width"). A
// PERCENTAGE flex-basis makes that cap arithmetic rather than a guess: with
// `columnGap: spacing.lg` (24) the wrap rule is `n*basis + (n-1)*gap <= C`, so
//   3 columns: 0.93C + 48 <= C  → fits for C >= ~686
//   4 columns: 1.24C + 72 <= C  → NEVER fits, at any container width
// and `stayOverviewRowMinWidth` clamps the low end back to 2 (and then 1) as
// the workspace narrows. Raising this above 33% would break the 4-column
// impossibility; that invariant is pinned by the #1484 web-render suite.
export const stayOverviewGridBasis = "31%" as const;

// ── Issue #1501 [add-rooms-form] — Stay offering EDITOR layout tokens ───────
// The "Add Rooms or Places" editor gains a form column + a sticky summary rail
// on wide desktop. Every width the editor and its new shared inputs depend on
// resolves here so no raw layout number lives in a component (the #1484 /
// #1501 lesson: an unnamed number is a number nobody can reason about).
//
// stayEditorFormMaxWidth — the readable measure of the FORM COLUMN itself.
//   The page is uncapped once the rail fits; the measure discipline moves onto
//   the column so "fill the space" never becomes a 1,400pt-wide text input.
// stayEditorSummaryWidth — the fixed width of the summary rail.
// stayEditorSummaryMinWidth — the CONTAINER width at or above which the rail
//   renders. 760 + 32 (columnGap: spacing.xl) + 320 = 1112 needs 1040+ of
//   container to be worth splitting; below it the summary collapses above the
//   CTA and nothing is lost, only stacked. This is a CONTAINER query fed by
//   `onLayout`, NOT a viewport query — the Stay workspace is ~252pt narrower
//   than the viewport, so a viewport threshold would show a rail that does not
//   fit.
// stayProseMaxWidth — the cap on any multi-line PROSE input (description,
//   cancellation policy). A textarea wider than this is unreadable.
export const stayEditorFormMaxWidth = 760 as const;
export const stayEditorSummaryWidth = 320 as const;
export const stayEditorSummaryMinWidth = 1040 as const;
export const stayProseMaxWidth = 620 as const;

// #1501 — AXIS-SCOPED field measures (invariant I-AXIS-SCOPED-FLEX). A field
// that sits inside a `flexDirection: "row"` MUST declare an explicit basis;
// `flex: 1` on every sibling is not a layout. Numeric fields are FIXED and the
// text field takes the remainder — never the reverse (SPEC AMENDMENT 1: a
// four-digit room number needs ~96pt, a prefix like "Garden Suite" needs real
// room).
export const stayFieldPairMinWidth = 200 as const;

// #1501 P2-2 — the numeric field's DESKTOP MEASURE, applied as `maxWidth` over
// `flexBasis: 0`, NOT as a flex basis.
//
// It WAS a `flexBasis: 220`, and the tester measured what that actually did on a
// phone: `flexWrap` breaks a line on the FLEX BASE SIZE, before any shrinking,
// so 220 + 220 + 16 = 456 > 326 (a 390pt phone's content box after the page and
// card gutters) put "How many you have" and "Guests per booking" on separate
// rows with dead space beside them — and `flexShrink: 1` never engaged, because
// a wrapped item owns its whole line. `origin/main`'s `flex: 1` is
// `flexBasis: 0`, which is why the pair used to sit side by side.
//
// As a CAP over a zero basis the pair shares one line and grows into it (155pt
// each at 390, 120pt at 320), while a desktop column still stops the box at 220
// instead of stretching it across 760pt. The cap, not the basis, is what the
// design ever wanted.
export const stayFieldNumMaxWidth = 220 as const;


// Lowered 140 -> 112 with the P2-2 fix. `flexWrap` clamps the hypothetical main
// size by `minWidth`, so a 140 floor would still have wrapped the pair on a
// 320pt phone (140 + 140 + 16 = 296 > 256). 112 + 112 + 16 = 240 fits 256 with
// room to spare, and the field still renders ~120pt wide there — plenty for a
// number.
export const stayFieldNumMinWidth = 112 as const;

// #1501 SPEC AMENDMENT 1 — the NameBuilder pattern row ("Starts with" / "From"
// / "To"). The prefix grows, the two numeric fields are fixed-basis.
export const namePatternPrefixMinWidth = 160 as const;
export const namePatternNumBasis = 96 as const;

// #1501 §3 — every toggle becomes an OPTION CARD (icon + label + helper +
// example) rather than a bare pill, so the terminology explains itself.
export const optionCardMinHeight = 72 as const;
export const optionCardMinWidth = 240 as const;

export const shadows = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: androidSafeElevation(2),
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: androidSafeElevation(4),
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 15,
    elevation: androidSafeElevation(8),
  },
  xl: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: androidSafeElevation(12),
  },
  glassBadge: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: androidSafeElevation(4),
  },
  glassChrome: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: androidSafeElevation(6),
  },
  glassChromeActive: {
    shadowColor: "#eb7825",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: androidSafeElevation(8),
  },
  glassCardBase: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: androidSafeElevation(6),
  },
  glassCardElevated: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 24,
    elevation: androidSafeElevation(10),
  },
  glassModal: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.48,
    shadowRadius: 40,
    elevation: androidSafeElevation(16),
  },
};

export const fontWeights = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

export const colors = {
  primary: {
    500: "#f97316",
    700: "#c2410c",
  },
  gray: {
    200: "#e5e7eb",
  },
  background: {
    primary: "#ffffff",
    secondary: "#f9fafb",
  },
  text: {
    primary: "#111827",
    secondary: "#4b5563",
    tertiary: "#6b7280",
    inverse: "#ffffff",
  },
  accent: "#eb7825",
} as const;

/** Welcome / auth gradient endpoint (warm off-white) */
export const backgroundWarmGlow = "#fff9f5" as const;

// ---------------------------------------------------------------------------
// Cycle 0a additions — design-package token port (additive only).
// Values match `Mingla_Artifacts/design-package/.../project/tokens.css` verbatim.
// ---------------------------------------------------------------------------

export const accent = {
  warm: "#eb7825",
  glow: "rgba(235, 120, 37, 0.35)",
  tint: "rgba(235, 120, 37, 0.28)",
  border: "rgba(235, 120, 37, 0.55)",
} as const;

// ORCH-0821 — Ari signature palette (rework 2026-05-12).
//
// CALMER + REFRESHING. Decoupled from accent.warm (#eb7825 stays the brand
// action color — punchy on purpose). Ari is its own visual identity: a soft
// peach-coral gradient that reads "warm, premium, lit from within" without
// shouting. Tuned to feel like glass with a warm light behind it, not a
// brand action button.
//
// All HSL/hex per the Cycle 7 FX2 RN color rule (no oklch/lab/color-mix —
// they render transparent on iOS+Android).
export const ariPalette = {
  // Orb gradient stops — soft peach gold → calm warm coral → muted ember.
  gold: "hsl(35, 88%, 78%)",      // #f7d09a — pale peach highlight
  flame: "hsl(20, 72%, 64%)",    // #e69869 — calm warm coral (Ari signature)
  ember: "hsl(10, 55%, 50%)",    // #c66c54 — soft muted ember rim
  // Secondary touches — calmer than the brand warm for UI accents
  cursor: "hsl(20, 72%, 64%)",   // same as flame
  proposalBorder: "hsla(20, 72%, 64%, 0.45)",
  proposalShadow: "hsla(20, 72%, 64%, 0.28)",
  // Glow color for the orb's halo
  glow: "hsla(22, 75%, 68%, 0.4)",
  // ORCH-1101 — Ari thread brand accent. Operator decision (2026-06-08): the
  // send button + user bubble + Confirm button + §5 cards use the canonical
  // Mingla brand action color from the dev style guide (accent.warm #eb7825),
  // paired with white text (colors.text.inverse) exactly like every other
  // brand action button app-wide. This supersedes the earlier Ari-specific
  // deep ember (#a85a44): brand consistency was chosen over the Ari-only 4.5:1
  // target; white-on-#eb7825 (~2.9:1) is the established app-wide action pairing.
  userBubble: accent.warm, // #eb7825 — Mingla brand action color
} as const;

// ORCH-1101 — Ari thread density spine. One vertical-rhythm + type + geometry
// system applied across ChatBubble / MessageList / InputBar / cards. Promotes
// the proven ORCH-0821 literals to named tokens and tightens 1–2px. Zero magic
// numbers downstream; every Ari layout value resolves here.
export const ariThread = {
  // Vertical rhythm
  gapTurn: 10, // between different-speaker turns
  gapGroup: 4, // between same-speaker consecutive bubbles (iMessage cluster)
  orbGap: 6, // orb → bubble gap on Ari rows
  // Bubble geometry + padding
  bubblePadH: 12,
  bubblePadV: 8,
  bubbleRadius: 16, // 3 non-tail corners (was 18)
  bubbleTail: 4, // tail corner
  bodyFont: 14,
  bodyLine: 19,
  // Cards
  cardPad: 12,
  cardTitleFont: 15,
  cardTitleLine: 21,
  btnHeight: 34,
  // ORCH-1103 — Ari brand-proposal cover band height (one shared band, all states).
  coverBandH: 132,
  // Composer
  composerMinH: 48,
  composerPadV: 8,
  inputPadV: 6,
  inputMinH: 30,
  // Send button
  sendSize: 34,
  // Chips
  chipFont: 13,
  chipLine: 17,
  // Android opaque-glass equivalent for the Ari bubble fill (composited value).
  ariBubbleAndroid: "#16181b",
  // ORCH-1101 REWORK Bug #4 — OPAQUE composer surface. The composer host used
  // the translucent glass.tint.profileBase (rgba .04), so the empty-state hint
  // ("Tap + for things to try") and any thread content showed THROUGH the input
  // field. This is a solid, slightly-elevated fill over the dark discover canvas
  // (#0c0e12) on EVERY platform (no rgba/hsla → satisfies
  // ANDROID_GLASS_USES_OPAQUE_FALLBACK; nothing can bleed through).
  composerSurface: "#191c21",
  // Success / cancelled ribbon padding (matches new bubble density).
  ribbonPadH: 10,
  ribbonPadV: 5,
} as const;

/**
 * #1022 A/F-18 — the canonical Android opaque composites for the Theme control
 * row. Android gets opaque fills instead of translucent glass
 * (ANDROID_GLASS_USES_OPAQUE_FALLBACK), and these are the true arithmetic
 * composites over canvas.discover #0c0e12:
 *   fill   0.04*255 + 0.96*(12,14,18) = (21.7, 23.6, 27.5) -> #16181b
 *   border 0.08*255 + 0.92*(12,14,18) = (31.4, 33.3, 37.0) -> #1f2125
 *
 * `rowFill` ALIASES the existing ariThread.ariBubbleAndroid rather than
 * creating a third copy of the same literal (B-27).
 *
 * NOTE: RsvpStep5Setup's #23262b (a ~0.09 composite) is deliberately NOT
 * changed here — it is out of scope (#1028). On Android the Theme row will
 * therefore read very slightly darker than the RSVP Step-5 rows in the same
 * wizard until #1028 lands. That is the correct direction: this row matches
 * the true composite; the RSVP rows are the drifted ones.
 */
export const androidOpaque = {
  rowFill: ariThread.ariBubbleAndroid,
  rowBorder: "#1f2125",
  /**
   * #1501 §9 — the SELECTED option-card / chip fill. Android gets an opaque
   * composite instead of the translucent `rgba(235,120,37,0.14)` accent tint
   * (ANDROID_GLASS_USES_OPAQUE_FALLBACK), computed over canvas.discover
   * #0c0e12 exactly like `rowFill`/`rowBorder` above:
   *   0.14*(235,120,37) + 0.86*(12,14,18) = (43.2, 28.8, 20.7) -> #2b1d15
   * The translucent value stays the iOS/web truth; only Android composites.
   */
  accentFill: "#2b1d15",
  /**
   * #2262 — the Android opaque composite of `glass.border.control` (0.34 white)
   * over canvas.discover, computed the same way as `rowFill`/`rowBorder`:
   *   0.34*(255,255,255) + 0.66*(12,14,18) = (94.6, 95.9, 97.9) -> #5f6062
   * Rounded to #5f6063 to match the design's stated value; the ratio is
   * unchanged at 3.07:1. Android never receives translucent glass on a control
   * border under ANDROID_GLASS_USES_OPAQUE_FALLBACK.
   */
  controlBorder: "#5f6063",
  // Issue #1008 — semantic chip composites over canvas.discover. Native
  // Android never receives translucent glass under rounded content.
  successFill: "#102f20",
  warningFill: "#362811",
  errorFill: "#35181b",
  infoFill: "#14233b",
} as const;


export const canvas = {
  discover: "#0c0e12",
  profile: "#141113",
  depth: "#08090c",
} as const;

export const glass = {
  tint: {
    badge: {
      idle: "rgba(12, 14, 18, 0.42)",
      pressed: "rgba(12, 14, 18, 0.52)",
    },
    chrome: {
      idle: "rgba(12, 14, 18, 0.48)",
      pressed: "rgba(12, 14, 18, 0.58)",
    },
    backdrop: "rgba(12, 14, 18, 0.34)",
    profileBase: "rgba(255, 255, 255, 0.04)",
    profileElevated: "rgba(255, 255, 255, 0.06)",
  },
  border: {
    badge: "rgba(255, 255, 255, 0.14)",
    chrome: "rgba(255, 255, 255, 0.14)",
    profileBase: "rgba(255, 255, 255, 0.08)",
    profileElevated: "rgba(255, 255, 255, 0.12)",
    pending: "rgba(255, 255, 255, 0.28)",
    /**
     * #2262 — the boundary that IDENTIFIES an outlined control, and therefore
     * the only glass border that has to clear WCAG 2.2 SC 1.4.11's 3:1.
     * Composited over `canvas.discover` #0c0e12 every existing border tops out
     * at 2.46:1 (`pending`); 0.34 composites to #5f6063 = 3.07:1 and is the
     * LOWEST white alpha that clears the bar. Used ONLY on the commit bar's
     * outlined controls — not on cards, not on the composer sheet.
     */
    control: "rgba(255, 255, 255, 0.34)",
  },
  highlight: {
    badge: "rgba(255, 255, 255, 0.22)",
    profileBase: "rgba(255, 255, 255, 0.10)",
    profileElevated: "rgba(255, 255, 255, 0.14)",
  },
} as const;

export const semantic = {
  success: "#22c55e",
  successTint: "rgba(34, 197, 94, 0.18)",
  warning: "#f59e0b",
  warningTint: "rgba(245, 158, 11, 0.18)",
  error: "#ef4444",
  errorTint: "rgba(239, 68, 68, 0.18)",
  info: "#3b82f6",
  infoTint: "rgba(59, 130, 246, 0.18)",
} as const;

export const text = {
  primary: "rgba(255, 255, 255, 0.96)",
  secondary: "rgba(255, 255, 255, 0.72)",
  tertiary: "rgba(255, 255, 255, 0.52)",
  quaternary: "rgba(255, 255, 255, 0.32)",
  inverse: "#ffffff",
} as const;

export const blurIntensity = {
  badge: 24,
  chrome: 28,
  backdrop: 22,
  cardBase: 30,
  cardElevated: 34,
  modal: 40,
} as const;

export const easings = {
  out: "cubic-bezier(0.33, 1, 0.68, 1)",
  in: "cubic-bezier(0.32, 0, 0.67, 0)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  press: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  sine: "cubic-bezier(0.37, 0, 0.63, 1)",
} as const;

export const durations = {
  instant: 80,
  fast: 120,
  normal: 200,
  entry: 260,
  exit: 180,
  slow: 320,
  deliberate: 400,
  slowest: 800,
} as const;

export const typography = {
  display: { fontSize: 32, lineHeight: 48, fontWeight: "700" as const, letterSpacing: -0.4 },
  h1: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const, letterSpacing: -0.2 },
  h2: { fontSize: 24, lineHeight: 36, fontWeight: "700" as const, letterSpacing: -0.2 },
  h3: { fontSize: 20, lineHeight: 32, fontWeight: "600" as const, letterSpacing: 0 },
  bodyLg: { fontSize: 18, lineHeight: 28, fontWeight: "500" as const, letterSpacing: 0 },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const, letterSpacing: 0 },
  bodySm: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const, letterSpacing: 0 },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const, letterSpacing: 0.2 },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 0.4 },
  labelCap: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const, letterSpacing: 1.4 },
  buttonLg: { fontSize: 16, lineHeight: 24, fontWeight: "600" as const, letterSpacing: 0 },
  buttonMd: { fontSize: 14, lineHeight: 20, fontWeight: "600" as const, letterSpacing: 0.2 },
  statValue: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const, letterSpacing: -0.4 },
  monoMd: { fontSize: 14, lineHeight: 20, fontWeight: "500" as const, letterSpacing: 0 },
} as const;
