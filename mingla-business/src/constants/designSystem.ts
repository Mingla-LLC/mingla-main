/**
 * Mingla Host design tokens: Graphite Glass (#4420, approved option K).
 *
 * This file holds every raw colour literal in host chrome. Primitives and
 * screens read the named exports below and never a literal; to retune the
 * look you edit this one file. The structure follows the kit's TOKENS.md
 * sections 1–4 one to one:
 *
 *   palette   (§1 primitives)   PRIVATE: read only here and by `materials`.
 *   color     (§2 semantic)     incl. `color.status` and `color.fill`.
 *   edge                        rims and hairline edges as RN border pairs.
 *   scrim                       modal scrim, photo shades, ambient veil.
 *   materials (§3)              { glassFill, solidFill, reducedFill, blur, webBackdrop, rim }.
 *                               `components/ui/Material.tsx` is the only reader
 *                               that turns one into pixels (and the only BlurView owner).
 *   type, radius, space, size, shadow, motion (§4).
 *
 * Content palettes (data, not chrome) also live here and are allow-listed by
 * the #4420 guard: `trafficAnalytics` (#4037) and `ariPalette` (ORCH-0821).
 *
 * The retired pre-Graphite exports (`colors`, `glass`, `text`, `semantic`,
 * `accent`, `canvas`, `shadows`, `typography`, `blurIntensity`, ...) were
 * deleted by #4420 wave 6 once every importer read the names above; the
 * #4420 guard (I-HOST-CHROME-TOKENS-ONLY) now fails by default.
 *
 * Android: shadows never draw (`androidSafeElevation`, ORCH-BIZ-0a-E4/E8),
 * because Android `elevation` draws a hard rectangle under rounded or
 * translucent surfaces; the rim does the separating instead.
 */

import { Platform, StyleSheet } from "react-native";

// Sub-phase E.3 (ORCH-BIZ-0a-E8): zero `elevation` on Android for EVERY shadow
// token. Android `elevation` draws a hard rectangular drop-shadow regardless of
// border-radius or alpha. Override at the component level if a future opaque
// surface truly needs it.
const androidSafeElevation = (ios: number): number =>
  Platform.select({ ios, android: 0, default: ios }) ?? ios;

// ===========================================================================
// §1 · Primitives (the only raw values; NOT exported)
// ===========================================================================

const palette = {
  graphite: {
    1000: "#000000",
    975: "#0a0a0a", // ink
    950: "#0f0f11", // canvas
    930: "#151518", // solid chrome
    920: "#1a1a1d", // solid pane
    910: "#1b1b1e", // card
    900: "#1e1e22", // solid sheet / dialog
    880: "#212125", // solid control
    870: "#222226", // card-2
    850: "#26262a", // solid liquid (tab bar)
    820: "#2b2b30", // card-3
    810: "#2c2c30", // solid selected
    700: "#5a5a60", // text-4
    500: "#8b8b91", // text-3
    400: "#a8a8ad", // text-2
    300: "#d4d4d8",
    150: "#e6e6e8",
    100: "#f3f3f5",
    50: "#f5f5f7", // text-1
  },
  white: "#ffffff",
  pane: {
    88: "rgba(28, 28, 31, 0.88)",
    90: "rgba(35, 35, 39, 0.90)",
    92: "rgba(46, 46, 51, 0.92)",
    sheet: "rgba(30, 30, 34, 0.94)",
  },
  chrome90: "rgba(22, 22, 25, 0.90)",
  veil: {
    35: "rgba(15, 15, 17, 0.35)",
    65: "rgba(15, 15, 17, 0.65)",
    88: "rgba(15, 15, 17, 0.88)",
  },
  onPhotoSolid: "rgba(24, 24, 27, 0.84)",
  w: {
    "025": "rgba(255, 255, 255, 0.025)",
    "03": "rgba(255, 255, 255, 0.03)",
    "035": "rgba(255, 255, 255, 0.035)",
    "04": "rgba(255, 255, 255, 0.04)",
    "045": "rgba(255, 255, 255, 0.045)",
    "06": "rgba(255, 255, 255, 0.06)",
    "07": "rgba(255, 255, 255, 0.07)",
    "075": "rgba(255, 255, 255, 0.075)",
    "08": "rgba(255, 255, 255, 0.08)",
    "09": "rgba(255, 255, 255, 0.09)",
    "10": "rgba(255, 255, 255, 0.10)",
    "11": "rgba(255, 255, 255, 0.11)",
    "12": "rgba(255, 255, 255, 0.12)",
    "13": "rgba(255, 255, 255, 0.13)",
    "14": "rgba(255, 255, 255, 0.14)",
    "16": "rgba(255, 255, 255, 0.16)",
    "22": "rgba(255, 255, 255, 0.22)",
    "26": "rgba(255, 255, 255, 0.26)",
    "28": "rgba(255, 255, 255, 0.28)",
    "30": "rgba(255, 255, 255, 0.30)",
    "40": "rgba(255, 255, 255, 0.40)",
    "72": "rgba(255, 255, 255, 0.72)",
    "75": "rgba(255, 255, 255, 0.75)",
    "86": "rgba(255, 255, 255, 0.86)",
    "88": "rgba(255, 255, 255, 0.88)",
    "92": "rgba(255, 255, 255, 0.92)",
  },
  b: {
    "00": "rgba(0, 0, 0, 0)",
    "10": "rgba(0, 0, 0, 0.10)",
    "12": "rgba(0, 0, 0, 0.12)",
    "18": "rgba(0, 0, 0, 0.18)",
    "20": "rgba(0, 0, 0, 0.20)",
    "25": "rgba(0, 0, 0, 0.25)",
    "35": "rgba(0, 0, 0, 0.35)",
    "45": "rgba(0, 0, 0, 0.45)",
    "50": "rgba(0, 0, 0, 0.50)",
    "55": "rgba(0, 0, 0, 0.55)",
    "60": "rgba(0, 0, 0, 0.60)",
    "62": "rgba(0, 0, 0, 0.62)",
    "70": "rgba(0, 0, 0, 0.70)",
    "75": "rgba(0, 0, 0, 0.75)",
    "80": "rgba(0, 0, 0, 0.80)",
    "90": "rgba(0, 0, 0, 0.90)",
  },
  orange: {
    500: "#eb7825",
    300: "#f39a55",
    a14: "rgba(235, 120, 37, 0.14)",
    a40: "rgba(235, 120, 37, 0.40)",
  },
  ink: {
    // Hairline on a paper (white) surface: light embedded pages (Stripe,
    // email previews) and paper cards. Black at 10% on #fff ≈ #e6e6e6.
    line: "rgba(10, 10, 10, 0.10)",
    // Ink washes on the orange (sent chat bubble): secondary text, mention
    // and quote chips.
    a66: "rgba(10, 10, 10, 0.66)",
    a16: "rgba(10, 10, 10, 0.16)",
    a12: "rgba(10, 10, 10, 0.12)",
  },
  red: {
    500: "#ff3b30", // badges, dots
    450: "#ff453a", // live now dot
    600: "#d92d20", // destructive fill
    650: "#c4271c", // destructive pressed
    300: "#f87171", // error text
    a14: "rgba(248, 113, 113, 0.14)",
    a45: "rgba(248, 113, 113, 0.45)",
  },
  green: { 500: "#22c55e", 300: "#5ee08f", a12: "rgba(34, 197, 94, 0.12)" },
  blue: {
    500: "#3b82f6",
    300: "#8fb3ff",
    a14: "rgba(59, 130, 246, 0.14)",
  },
  amber: {
    500: "#f59e0b",
    300: "#fbbf24",
    a14: "rgba(245, 158, 11, 0.14)",
    // #4624: the deleted-offering row's border.
    a40: "rgba(245, 158, 11, 0.40)",
  },
  transparent: "transparent",
  // Status colours that read on a paper (light) surface: receipts, light
  // share sheets, light host-theme pages, the light keyboard toolbar.
  paperStatus: {
    success: "#17623a",
    successSoft: "#28724a",
    danger: "#b91c1c",
    dangerSoft: "#f87171",
    accent: "#9a470a",
    text2: "#6b7280",
    warningFill: "#fff8ed",
    warningLine: "#f3c98b",
    warningTitle: "#6d3908",
    warningText: "#6d4b2a",
    warningAction: "#7a3a11",
    noticeFill: "#fef3c7",
    noticeText: "#1f2937",
    selectedFill: "#e5eefc",
    link: "#1d4ed8",
  },
  // react-native-keyboard-controller toolbar (system appearance).
  keyboardToolbar: {
    lightDisabled: "#b0bec5",
    lightBackground: "#f3f3f4",
    lightRipple: "#bcbcbcbc",
    darkDisabled: "#707070",
    darkBackground: "#2c2c2e",
    darkRipple: "#f8f8f888",
  },
  // Opaque composites of the status tints over the canvas #0f0f11, for Android
  // and Reduce Transparency (ANDROID_GLASS_USES_OPAQUE_FALLBACK):
  //   success a12 → (17.3, 36.8, 26.2)  warning a14 → (47.2, 35.0, 16.2)
  //   error   a14 → (47.6, 28.7, 30.4)  info    a14 → (21.2, 31.1, 49.1)
  solidTint: {
    success: "#11251a",
    warning: "#2f2310",
    error: "#301d1e",
    info: "#151f31",
  },
} as const;

// ===========================================================================
// §2 · Semantic colour
// ===========================================================================

export const color = {
  canvas: palette.graphite[950],
  card: palette.graphite[910],
  card2: palette.graphite[870],
  card3: palette.graphite[820],
  line: palette.w["075"],
  lineStrong: palette.w["13"],
  text1: palette.graphite[50],
  text2: palette.graphite[400],
  text3: palette.graphite[500],
  text4: palette.graphite[700],
  textOnPhoto: palette.white,
  textOnPhoto2: palette.w["86"],
  /** Selected labels. */
  textStrong: palette.white,
  /** Count inside a selected segment. */
  textSelectedMeta: palette.w["72"],
  textSelectedChipMeta: palette.w["75"],
  /** The primary button. Orange is not a button fill. */
  paper: palette.white,
  paperEnd: palette.graphite[100],
  paperPressed: palette.graphite[150],
  ink: palette.graphite[975],
  /** Hairline on a paper (light) surface, e.g. the light Stripe embedded pages. */
  lineOnPaper: palette.ink.line,
  /** Used ONLY for Create, the active nav icon, progress and steppers, and the "upcoming" dot. */
  accent: palette.orange[500],
  accentText: palette.orange[300],
  onAccent: palette.graphite[975],
  /** Secondary text on the orange (sent chat bubble meta, quoted text). */
  onAccent2: palette.ink.a66,
  /** Chips on the orange (mention, quote). */
  onAccentTint: palette.ink.a16,
  onAccentTint2: palette.ink.a12,
  accentTint: palette.orange.a14,
  accentLine: palette.orange.a40,
  focus: palette.white,
  danger: palette.red[600],
  dangerPressed: palette.red[650],
  onDanger: palette.white,
  badge: palette.red[500],
  badgeRing: palette.graphite[950],
  tabDotRing: palette.graphite[1000],
  live: palette.red[450],
  success: palette.green[500],
  successText: palette.green[300],
  successTint: palette.green.a12,
  info: palette.blue[500],
  infoText: palette.blue[300],
  infoTint: palette.blue.a14,
  warning: palette.amber[500],
  warningText: palette.amber[300],
  warningTint: palette.amber.a14,
  /** #4624: hairline on a warningTint row (deleted offering). */
  warningLine: palette.amber.a40,
  errorText: palette.red[300],
  errorTint: palette.red.a14,
  errorLine: palette.red.a45,
  /** Text and status colours for a paper (light) surface. */
  onPaper: palette.paperStatus,
  /** The native keyboard toolbar's own light / dark surfaces. */
  keyboardToolbar: palette.keyboardToolbar,
  /** Opaque status tints (Android, Reduce Transparency): the tint pre-composited over the canvas. */
  solidTint: palette.solidTint,
  skeleton: palette.w["06"],
  skeletonHi: palette.w["10"],
  homeIndicator: palette.w["92"],
  systemBarFg: palette.white,
  tabIcon: palette.w["88"],
  camera: palette.graphite[1000],
  spinnerTrackOnPaper: palette.b["12"],
  mask: palette.graphite[1000],
  transparent: palette.transparent,
  /** StatusPill dot colours. */
  status: {
    neutral: palette.graphite[500],
    refunded: palette.graphite[500],
    partial: palette.graphite[300],
    muted: palette.w["40"],
  },
  /** White-over-graphite washes, by role. */
  fill: {
    tableHead: palette.w["025"],
    rowHover: palette.w["035"],
    inset: palette.w["045"],
    tile: palette.w["06"],
    status: palette.w["06"],
    quietHover: palette.w["06"],
    quiet: palette.transparent,
    railOn: palette.w["09"],
    tabOn: palette.w["10"],
    step: palette.w["12"],
    pager: palette.w["28"],
    pagerOn: palette.white,
    handle: palette.w["30"],
    pressed: palette.w["08"],
    input: palette.w["045"],
    inputDisabled: palette.w["025"],
  },
} as const;

// ===========================================================================
// Rims and edges. RN has no inset box-shadow, so each one is a border pair:
// a `rim` is a 1px TOP border (the soft top-edge highlight), an `edge` is a
// hairline frame. Spread these into a style or read `.color` for an overlay.
// ===========================================================================

const hairline = StyleSheet.hairlineWidth;

export const edge = {
  /** One soft top-edge highlight (CSS `--rim`). */
  rim: { borderTopWidth: 1, borderTopColor: palette.w["075"] },
  /** Hairline frame on panes (CSS `--edge`). */
  edge: { borderWidth: hairline, borderColor: palette.w["07"] },
  control: { borderWidth: hairline, borderColor: palette.w["11"] },
  seg: { borderWidth: hairline, borderColor: palette.w["08"] },
  inset: { borderWidth: hairline, borderColor: palette.w["06"] },
  photo: { borderWidth: hairline, borderColor: palette.w["08"] },
  line: { borderWidth: hairline, borderColor: palette.w["075"] },
  /** Hairline frame on a paper (light) surface. */
  lineOnPaper: { borderWidth: hairline, borderColor: palette.ink.line },
  lineStrong: { borderWidth: hairline, borderColor: palette.w["13"] },
  rimSelected: { borderTopWidth: 1, borderTopColor: palette.w["10"] },
  rimRailOn: { borderTopWidth: 1, borderTopColor: palette.w["08"] },
  rimTile: { top: palette.w["08"], edge: palette.w["07"] },
  rimOnPhoto: { top: palette.w["16"], edge: palette.w["26"], edgeWidth: 0.5 },
  rimStatusOnPhoto: { borderWidth: 0.5, borderColor: palette.w["26"] },
  rimLiquid: { top: palette.w["30"], bottom: palette.w["06"], edge: palette.w["16"], edgeWidth: 0.5 },
  rimLiquidOn: { borderTopWidth: 1, borderTopColor: palette.w["14"] },
  /** Top glint stop of the liquid rim gradient. */
  liquidGlint: palette.w["22"],
  tableHead: palette.w["10"],
  table: palette.w["06"],
  /** 2px canvas gap + 2px paper ring. */
  ringFocus: { gap: palette.graphite[950], ring: palette.white, gapWidth: 2, ringWidth: 2 },
  ringError: { borderWidth: 1.5, borderColor: palette.red.a45 },
  ringInputFocus: { borderWidth: 1.5, borderColor: palette.w["40"], halo: palette.w["10"], haloWidth: 4 },
} as const;

// ===========================================================================
// Scrims and photo shades (LinearGradient stops: `colors` + `locations`).
// ===========================================================================

export const scrim = {
  modal: Platform.select({ android: palette.b["62"], default: palette.b["55"] }) ?? palette.b["55"],
  hero: {
    colors: [palette.b["50"], palette.b["12"], palette.b["20"], palette.b["62"], palette.b["50"], palette.b["45"]],
    locations: [0, 0.18, 0.3, 0.52, 0.75, 1],
  },
  cardPhoto: {
    colors: [palette.b["25"], palette.b["10"], palette.b["75"], palette.b["90"]],
    locations: [0, 0.3, 0.68, 1],
  },
  photo: {
    colors: [palette.b["18"], palette.b["00"], palette.b["00"], palette.b["55"]],
    locations: [0, 0.3, 0.55, 1],
  },
  /** Ambient veil over the dim photo field on photo pages. */
  ambient: {
    colors: [palette.veil[35], palette.veil[65], palette.veil[88], palette.graphite[950]],
    locations: [0, 0.4, 0.7, 0.92],
  },
  maskHero: {
    colors: [palette.graphite[1000], palette.b["00"]],
    locations: [0.45, 0.92],
  },
} as const;

// ===========================================================================
// §3 · Materials (one recipe per platform). Rendered ONLY by
// `components/ui/Material.tsx`:
//   Android                 → solidFill (alpha 1; onPhoto .84 by design), no BlurView.
//   Reduce Transparency     → reducedFill (onPhoto → solid control).
//   web                     → shouldUseRealBlur ? glassFill + webBackdrop : solidFill.
//   iOS                     → BlurView(blur) + glassFill overlay (blur null = fill only).
// iOS cannot saturate(); the frost comes from the graphite fill over the blur.
// ===========================================================================

export type MaterialBlur = {
  readonly intensity: number;
  readonly tint: "systemChromeMaterialDark";
};

export type MaterialRim = {
  /** 1px top highlight colour, or null for none. */
  readonly top: string | null;
  /** Hairline frame colour. */
  readonly edge: string;
  readonly edgeWidth: number;
};

export type MaterialRecipe = {
  readonly glassFill: string;
  readonly solidFill: string;
  readonly reducedFill: string;
  readonly blur: MaterialBlur | null;
  readonly webBackdrop: string | null;
  readonly rim: MaterialRim;
};

const chromeBlur = (intensity: number): MaterialBlur => ({ intensity, tint: "systemChromeMaterialDark" });
const paneRim: MaterialRim = { top: palette.w["075"], edge: palette.w["07"], edgeWidth: hairline };

export const materials = {
  pane: {
    glassFill: palette.pane[88],
    solidFill: palette.graphite[920],
    reducedFill: palette.graphite[920],
    blur: chromeBlur(24),
    webBackdrop: "blur(10px) saturate(20%)",
    rim: paneRim,
  },
  control: {
    glassFill: palette.pane[90],
    solidFill: palette.graphite[880],
    reducedFill: palette.graphite[880],
    blur: chromeBlur(24),
    webBackdrop: "blur(10px) saturate(20%)",
    rim: { top: palette.w["075"], edge: palette.w["11"], edgeWidth: hairline },
  },
  selected: {
    glassFill: palette.pane[92],
    solidFill: palette.graphite[810],
    reducedFill: palette.graphite[810],
    blur: null,
    webBackdrop: null,
    rim: { top: palette.w["10"], edge: palette.w["08"], edgeWidth: hairline },
  },
  chrome: {
    glassFill: palette.chrome90,
    solidFill: palette.graphite[930],
    reducedFill: palette.graphite[930],
    blur: chromeBlur(24),
    webBackdrop: "blur(10px) saturate(20%)",
    rim: paneRim,
  },
  liquid: {
    glassFill: palette.w["06"],
    solidFill: palette.graphite[850],
    reducedFill: palette.graphite[850],
    blur: chromeBlur(34),
    webBackdrop: "blur(14px) saturate(170%)",
    // Android keeps the SAME rim on its solid capsule.
    rim: { top: palette.w["30"], edge: palette.w["16"], edgeWidth: 0.5 },
  },
  onPhoto: {
    glassFill: palette.w["10"],
    // The one near-opaque exception: still reads as floating over the photo.
    solidFill: palette.onPhotoSolid,
    reducedFill: palette.graphite[880],
    blur: chromeBlur(43),
    webBackdrop: "blur(18px) saturate(140%)",
    rim: { top: palette.w["16"], edge: palette.w["26"], edgeWidth: 0.5 },
  },
  sheet: {
    glassFill: palette.pane.sheet,
    solidFill: palette.graphite[900],
    reducedFill: palette.graphite[900],
    blur: chromeBlur(24),
    webBackdrop: "blur(24px) saturate(20%)",
    rim: paneRim,
  },
} as const satisfies Record<string, MaterialRecipe>;

export type MaterialKind = keyof typeof materials;

// ===========================================================================
// §4 · Type, radius, space, size, shadow, motion
// ===========================================================================

export type TypeStyle = {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: "400" | "500" | "600" | "700";
  readonly letterSpacing: number;
};

/** letterSpacing in px from the kit's em values. */
const em = (value: number, fontSize: number): number => Math.round(value * fontSize * 100) / 100;
const t = (
  fontSize: number,
  lineHeight: number,
  fontWeight: TypeStyle["fontWeight"],
  letterSpacingEm = 0,
): TypeStyle => ({ fontSize, lineHeight, fontWeight, letterSpacing: em(letterSpacingEm, fontSize) });

const typeWeb = {
  display: t(34, 40, "700", -0.028),
  title: t(28, 34, "700", -0.024),
  // The kit's h1 weight is 650; RN's fontWeight union stops at hundreds.
  h1: t(21, 28, "600", -0.016),
  h2: t(17, 24, "600", -0.01),
  row: t(15, 21, "600"),
  body: t(15, 22, "400"),
  small: t(14, 20, "400"),
  caption: t(13, 18, "500"),
  label: t(12, 16, "600", 0.07),
  statXl: t(44, 48, "700", -0.035),
  stat: t(28, 32, "700", -0.025),
  btn: t(15, 20, "600", -0.006),
  btnSm: t(14, 18, "600"),
  chip: t(14, 18, "600"),
  mono: t(13, 18, "500", -0.01),
  nav: t(12, 14, "600"),
} as const;

const typeIos = {
  display: t(34, 41, "700", -0.026),
  title: t(28, 34, "700", -0.022),
  h1: t(22, 28, "700", -0.018),
  h2: t(17, 22, "600", -0.012),
  row: t(16, 21, "600"),
  body: t(17, 22, "400"),
  small: t(15, 20, "400"),
  caption: t(13, 18, "500"),
  label: t(12, 16, "600", 0.06),
  statXl: t(40, 44, "700", -0.035),
  stat: t(26, 30, "700", -0.025),
  btn: t(17, 22, "600"),
  btnSm: t(15, 20, "600"),
  chip: t(15, 20, "600"),
  mono: t(13, 18, "500", -0.01),
  nav: t(10.5, 13, "600"),
} as const;

const typeAndroid = {
  display: t(32, 40, "700", -0.02),
  title: t(28, 34, "700", -0.02),
  h1: t(22, 28, "700", -0.012),
  h2: t(17, 22, "600", -0.006),
  row: t(16, 21, "600"),
  body: t(16, 22, "400"),
  small: t(14, 20, "400"),
  caption: t(13, 18, "500"),
  label: t(12, 16, "600", 0.06),
  statXl: t(38, 44, "700", -0.03),
  stat: t(26, 30, "700", -0.02),
  btn: t(16, 22, "600"),
  btnSm: t(14, 20, "600"),
  chip: t(14, 20, "600"),
  mono: t(13, 18, "500", -0.01),
  nav: t(11, 14, "600"),
} as const;

export type TypeScale = { readonly [K in keyof typeof typeWeb]: TypeStyle };

/** Platform type scale (TOKENS §4): system font on every platform. */
export const type: TypeScale =
  Platform.select<TypeScale>({ ios: typeIos, android: typeAndroid, web: typeWeb, default: typeIos }) ?? typeIos;

/** Monospace family per platform, for `type.mono`. */
export const monoFontFamily: string =
  Platform.select({ ios: "Menlo", android: "monospace", web: "ui-monospace, SFMono-Regular, Menlo, monospace", default: "Menlo" }) ??
  "Menlo";

export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  /** Web card. */
  xl: 24,
  /** Phone card, dialog (the kit's 2xl). */
  xxl: 28,
  /** Sheet (the kit's 3xl). */
  xxxl: 34,
  full: 999,
} as const;

/** 4/8 spacing scale, keyed like the kit's `--s-1` … `--s-10`. */
export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 64,
} as const;

export const size = {
  btn: { sm: 36, md: 44, lg: 52, xl: 56, phone: 50, phoneLg: 54 },
  iconBtn: { sm: 36, md: 44, lg: 48 },
  ember: 48,
  emberTab: 54,
  input: 48,
  handle: { width: 36, height: 5 },
  rail: 80,
  sidebar: 248,
  sidebarCollapsed: 80,
  bezel: 12,
  topbar: 64,
  pageMax: 1680,
  gutter: 24,
  sidePanel: 400,
  modal: 560,
  dialog: 400,
  stepList: 280,
  toast: 380,
} as const;

export type ShadowToken = {
  readonly shadowColor: string;
  readonly shadowOffset: { readonly width: number; readonly height: number };
  readonly shadowOpacity: number;
  readonly shadowRadius: number;
  readonly elevation: number;
};

/**
 * The kit's CSS shadows (`x y blur spread colour`) as RN shadow props. RN has
 * no spread, so a negative spread is folded into the opacity
 * (`alpha × (1 + spread / blur)`), and the radius is half the CSS blur.
 * iOS and web only: Android elevation stays 0.
 */
const cssShadow = (y: number, blur: number, spread: number, alpha: number): ShadowToken => ({
  shadowColor: palette.graphite[1000],
  shadowOffset: { width: 0, height: y },
  shadowOpacity: Math.round(alpha * Math.max(0.2, 1 + spread / blur) * 100) / 100,
  shadowRadius: blur / 2,
  elevation: androidSafeElevation(0),
});

const NO_SHADOW: ShadowToken = {
  shadowColor: palette.transparent,
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0,
  shadowRadius: 0,
  elevation: 0,
};

export const shadow = {
  none: NO_SHADOW,
  pane: cssShadow(10, 24, -18, 0.7),
  paper: cssShadow(1, 2, 0, 0.35),
  ember: cssShadow(6, 16, -8, 0.7),
  liquid: cssShadow(10, 30, -12, 0.8),
  sheet: cssShadow(-12, 40, -12, 0.7),
  dialog: cssShadow(30, 80, -20, 0.8),
  toast: cssShadow(14, 34, -14, 0.8),
  menu: cssShadow(18, 48, -16, 0.8),
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

export const motion = {
  easings,
  durations,
  spring: {
    /** RN spring for sheets (kit `--spring-sheet`). */
    sheet: { damping: 26, stiffness: 260, mass: 1 },
  },
  pressScale: 0.98,
} as const;

export const fontWeights = {
  regular: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};

// ===========================================================================
// Layout tokens (feature-owned measures; unchanged by #4420 wave 1).
// ===========================================================================

export const venueRailWidth = 220 as const;

/** #2829 W9r — the Website section's two-panel layout (DESIGN_SPEC §2, §5). */
export const websiteRailWidth = 232 as const;
export const websitePaneMaxWidth = 760 as const;
export const websitePreviewWidth = 440 as const;

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

// Issue #2726 — one scoped owner for the Restaurant Hub's approved responsive
// measures. These values belong together: the Availability grids and the three
// empty modules must not drift back into locally guessed widths.
export const restaurantHubLayout = {
  proseMaxWidth: 720,
  emptyContentMaxWidth: 560,
  compactCtaMaxWidth: 240,
  availabilityTwoColumnMinWidth: 960,
  availabilityThreeColumnMinWidth: 1440,
} as const;

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

// ===========================================================================
// Content palettes (data encodings, not chrome; allow-listed by the #4420 guard)
// ===========================================================================

// #4037 — one fixed visual language for host traffic/value analytics. These
// colours are contractual data encodings, not decorative choices: source order
// and colour must remain stable across the brand dashboard, listing insights,
// accessibility labels and screenshots.
export const trafficAnalytics = {
  heroGradient: [
    "rgba(235, 120, 37, 0.30)",
    "rgba(235, 120, 37, 0.06)",
  ] as const,
  positiveDelta: "#46c98b",
  positiveDeltaTint: "rgba(70, 201, 139, 0.16)",
  // Decision 7 (#4037 comment 6325156309): a decline (or no change) is shown,
  // never hidden, in the neutral secondary treatment rather than an alarm colour.
  neutralDelta: "rgba(255, 255, 255, 0.72)",
  neutralDeltaTint: "rgba(255, 255, 255, 0.08)",
  selectedPageTint: "rgba(235, 120, 37, 0.08)",
  tapMeter: "#5fd4d0",
  sources: {
    mingla_app: "#eb7825",
    mingla_ads: "#f6a15f",
    search: "#ffd2a8",
    social: "#b49cff",
    own_links: "#7aa7ff",
    direct_unknown: "#8b93a3",
  },
} as const;

// ORCH-0821 — Ari signature palette (rework 2026-05-12): a soft peach-coral
// gradient, Ari's own identity, deliberately decoupled from the brand action
// colour. HSL/hex only (no oklch/lab/color-mix: they render transparent on
// iOS and Android).
export const ariPalette = {
  gold: "hsl(35, 88%, 78%)", // #f7d09a — pale peach highlight
  flame: "hsl(20, 72%, 64%)", // #e69869 — calm warm coral (Ari signature)
  ember: "hsl(10, 55%, 50%)", // #c66c54 — soft muted ember rim
  cursor: "hsl(20, 72%, 64%)", // same as flame
  proposalBorder: "hsla(20, 72%, 64%, 0.45)",
  proposalShadow: "hsla(20, 72%, 64%, 0.28)",
  glow: "hsla(22, 75%, 68%, 0.4)",
  // #4420 — the three-ring orb mark (ari/AriOrb, home/HomeAriOrb): Ari's
  // identity art, not the action orange.
  orb: "#f07a3d",
  orbCore: "#ffb07c",
  // ORCH-1101 — the Ari user bubble uses the brand action colour.
  userBubble: color.accent,
} as const;

// #4420 — third-party marks drawn in their owners' required colours (Google
// sign-in "G" per Google's brand guidelines). Content, not chrome.
export const brandMarks = {
  google: { blue: "#4285F4", green: "#34A853", yellow: "#FBBC04", red: "#EA4335" },
} as const;

// ORCH-1101 — Ari thread density spine. Every Ari layout value resolves here.
// #4420: the colour fields are folded into `color.*` (layout numbers unchanged).
export const ariThread = {
  // Vertical rhythm
  gapTurn: 16,
  gapGroup: 4,
  orbGap: 16,
  // Bubble geometry + padding
  bubblePadH: 16,
  bubblePadV: 12,
  bubbleRadius: 20,
  bubbleTail: 12,
  bubbleMaxWidth: 560,
  threadMaxWidth: 760,
  bodyFont: 16,
  bodyLine: 24,
  labelFont: 15,
  labelLine: 20,
  // Cards
  cardPad: 12,
  cardTitleFont: 15,
  cardTitleLine: 21,
  btnHeight: 44,
  // ORCH-1103 — Ari brand-proposal cover band height (one shared band, all states).
  coverBandH: 132,
  // Composer
  composerMinH: 60,
  composerPadH: 8,
  composerPadV: 7,
  inputPadV: 8,
  inputMinH: 44,
  inputMaxH: 120,
  // Send button
  sendSize: 44,
  controlSize: 44,
  attachmentCardW: 220,
  attachmentCardMinH: 64,
  attachmentThumb: 44,
  activityMinH: 48,
  websiteAriMinWidth: 420,
  websiteAriMaxWidth: 520,
  // Chips
  chipFont: 13,
  chipLine: 17,
  // Success / cancelled ribbon padding (matches new bubble density).
  ribbonPadH: 10,
  ribbonPadV: 5,
} as const;

/**
 * #3040 — Host cover / video upload sheet geometry (Appendix A §13).
 * #4420: colour fields folded into `color.*` / `scrim.*`.
 */
export const coverUpload = {
  thumb: 56,
  thumbRadius: 8,
  previewHeightCompact: 180,
  previewHeightWide: 260,
  stepperBar: 3,
  trackHeight: 4,
  tileRing: 36,
  statusIcon: 28,
  pillHeight: 28,
} as const;

/** #2796 feature-owned competition-sheet geometry. */
export const competitorSheet = {
  contentInsetCompact: 16,
  contentInsetRegular: 24,
  contentInsetWide: 32,
  addMaxWidth: 640,
  briefMaxWidth: 720,
  readableCopyMaxWidth: 600,
  sectionGap: 32,
  cardGap: 16,
  stickyFooterMinHeight: 76,
} as const;
