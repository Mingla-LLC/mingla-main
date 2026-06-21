/**
 * LucideIcons — META-ORCH-1174 Leg A.4 [trip-page polish · lucide pills].
 *
 * The ONE shared, pure-presentational lucide-icon module consumed by the three
 * shared offering bodies (TripOfferingBody / EventOfferingBody / RsvpOfferingBody)
 * to replace the prior emoji / geometric-glyph `<Text>` icons (📅 ✈ ⏱ 👥 ◷ ◯ ⌖
 * − + ✓) with crisp, theme-tinted vector icons that render IDENTICALLY on every
 * surface (buyer-web react-native-web + business iOS/Android + consumer iOS/Android).
 *
 * WHY hand-drawn paths, not the `lucide-react-native` dependency:
 *   - The package stays dependency-isolated (I-MOR-0827-PACKAGE-ISOLATION) and adds
 *     NO new runtime dep — it already peer-depends on `react-native-svg` (see the
 *     `RsvpMomentumDecision` glyph pattern). We render the EXACT lucide path data
 *     (lucide is MIT-licensed) inside a 24×24 viewBox via react-native-svg, the same
 *     way every other glyph in this package is drawn.
 *   - lucide's standard stroke styling: a 24×24 viewBox, `fill="none"`,
 *     `stroke={color}`, `strokeWidth={2}` (overridable), round caps + round joins.
 *
 * Each icon is a small pure component taking `{ size, color, strokeWidth? }` and
 * scales the 24×24 art to the requested footprint (so it slots into the same space
 * the prior glyph occupied). No state, no data, no app-src import. Renders on
 * react-native-web AND native RN.
 */

import React from "react";
import Svg, { Circle, Path } from "react-native-svg";

export interface LucideIconProps {
  /** Rendered width = height in px (the 24×24 art scales to fit). */
  size: number;
  /** Stroke color (theme token — palette.accent / palette.accentText / etc.). */
  color: string;
  /** lucide's standard stroke width is 2; callers may thin/thicken it. */
  strokeWidth?: number;
}

/**
 * Shared lucide frame — a 24×24-viewBox SVG with `fill="none"` and the canonical
 * lucide stroke styling. Children are the per-icon `<Path>` / `<Circle>` art (which
 * inherit `stroke`/`strokeWidth`/`strokeLinecap`/`strokeLinejoin` from here).
 */
const LucideFrame: React.FC<
  LucideIconProps & { children: React.ReactNode }
> = ({ size, color, strokeWidth = 2, children }) => (
  <Svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </Svg>
);

// ───────────────────────────── the 9 icons ──────────────────────────────────
// Each uses the REAL lucide path data (24×24 grid). Stroke styling is inherited
// from <LucideFrame>; per-element overrides are avoided so the whole icon shares
// the one color/width.

/** lucide `calendar` — rounded rect body + two top ticks + a horizontal divider. */
export const Calendar: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M8 2v4" />
    <Path d="M16 2v4" />
    <Path d="M3 10h18" />
    <Path d="M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
  </LucideFrame>
);

/** lucide `plane` — the airplane silhouette. */
export const Plane: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2Z" />
  </LucideFrame>
);

/** lucide `moon` — the crescent (used for the nights pill). */
export const Moon: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </LucideFrame>
);

/** lucide `users` — two overlapping person shapes (seats / headcount). */
export const Users: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <Circle cx={9} cy={7} r={4} />
    <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </LucideFrame>
);

/** lucide `globe` — circle + meridian + the two horizontal lat lines. */
export const Globe: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Circle cx={12} cy={12} r={10} />
    <Path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
    <Path d="M2 12h20" />
  </LucideFrame>
);

/** lucide `map-pin` — the pin teardrop + the inner circle. */
export const MapPin: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
    <Circle cx={12} cy={10} r={3} />
  </LucideFrame>
);

/** lucide `minus` — a single horizontal stroke (stepper decrement). */
export const Minus: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M5 12h14" />
  </LucideFrame>
);

/** lucide `plus` — a horizontal + vertical stroke cross (stepper increment). */
export const Plus: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M5 12h14" />
    <Path d="M12 5v14" />
  </LucideFrame>
);

/** lucide `badge-check` — the scalloped verification badge + the inner check. */
export const BadgeCheck: React.FC<LucideIconProps> = (props) => (
  <LucideFrame {...props}>
    <Path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z" />
    <Path d="m9 12 2 2 4-4" />
  </LucideFrame>
);
