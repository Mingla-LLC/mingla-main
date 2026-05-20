/**
 * MarketingEmptyIllustration — ORCH-0891 M3 §8 SVG illustrations.
 *
 * Three Marketing-specific empty-state illustrations rendered inline via
 * `react-native-svg`. The shapes mirror the designer SVG files at
 * `mingla-business/assets/illustrations/marketing/*.svg` byte-for-byte
 * (paths transcribed from the designer artefacts).
 *
 * # Why inline instead of `require("./*.svg")`
 * `mingla-business`'s Metro config does not register `react-native-svg-
 * transformer`. Requiring a `.svg` file would load it as a static asset
 * (raw URL) — usable by `expo-image` on web only, broken on native. The
 * inline-paths approach renders identically across iOS, Android, and web
 * via `react-native-svg`'s declarative API (already in deps at 15.12.1).
 *
 * Per DESIGN_SPEC §8 + SPEC §3.6 deliverable 7.
 */

import React from "react";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

const ACCENT_WARM = "#eb7825";
const SUBDUED = "rgba(255,255,255,0.32)";

export type MarketingIllustrationKey =
  | "marketing-audiences"
  | "marketing-campaigns"
  | "marketing-templates";

export interface MarketingEmptyIllustrationProps {
  illustration: MarketingIllustrationKey;
  /** Pixel size for the square rendered area. Default 120. */
  size?: number;
}

const AudiencesEmpty: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="0 0 160 160" fill="none">
    {/* Ground / horizon line */}
    <Line
      x1={24}
      y1={124}
      x2={136}
      y2={124}
      stroke={SUBDUED}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
    {/* Mailbox post */}
    <Line
      x1={80}
      y1={124}
      x2={80}
      y2={96}
      stroke={SUBDUED}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
    {/* Mailbox body */}
    <Path
      d="M 48 96 L 48 76 Q 48 56 64 56 L 96 56 Q 112 56 112 76 L 112 96 Z"
      stroke={ACCENT_WARM}
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    {/* Mailbox door hinge line */}
    <Line
      x1={64}
      y1={74}
      x2={64}
      y2={96}
      stroke={ACCENT_WARM}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
    {/* Mailbox flag */}
    <Line
      x1={112}
      y1={72}
      x2={120}
      y2={72}
      stroke={ACCENT_WARM}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
    <Path
      d="M 120 72 L 120 64 L 128 64 L 128 80 L 120 80 Z"
      stroke={ACCENT_WARM}
      strokeWidth={1.5}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
    {/* Falling envelope */}
    <G transform="translate(64, 24) rotate(-12 16 12)">
      <Rect
        x={0}
        y={0}
        width={32}
        height={22}
        rx={2}
        stroke={ACCENT_WARM}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Path
        d="M 0 0 L 16 12 L 32 0"
        stroke={SUBDUED}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </G>
    {/* Motion trails */}
    <Line x1={62} y1={14} x2={58} y2={10} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
    <Line x1={98} y1={14} x2={104} y2={10} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
    <Line x1={80} y1={6} x2={80} y2={2} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

const CampaignsEmpty: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="0 0 160 160" fill="none">
    {/* Motion trail */}
    <Path
      d="M 30 130 Q 60 110 80 90 T 110 60"
      stroke={SUBDUED}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeDasharray="3 6"
      fill="none"
    />
    {/* Paper plane */}
    <G transform="translate(96, 56)">
      <Path
        d="M -28 16 L 32 -16 L 16 8 Z"
        stroke={ACCENT_WARM}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Path
        d="M -28 16 L 16 8 L 12 -2"
        stroke={SUBDUED}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Line
        x1={16}
        y1={8}
        x2={-8}
        y2={0}
        stroke={ACCENT_WARM}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    </G>
    {/* Ambient sparkles */}
    <Circle cx={44} cy={40} r={1.5} fill={ACCENT_WARM} />
    <Circle cx={124} cy={32} r={1.5} fill={ACCENT_WARM} />
    <Circle cx={138} cy={84} r={1.5} fill={ACCENT_WARM} />
    {/* Ground hint */}
    <Line x1={24} y1={138} x2={44} y2={138} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
  </Svg>
);

const TemplatesEmpty: React.FC<{ size: number }> = ({ size }) => (
  <Svg width={size} height={size} viewBox="0 0 160 160" fill="none">
    {/* Bottom card */}
    <Rect
      x={40}
      y={92}
      width={80}
      height={40}
      rx={6}
      stroke={SUBDUED}
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
    {/* Middle card */}
    <Rect
      x={36}
      y={76}
      width={80}
      height={40}
      rx={6}
      stroke={SUBDUED}
      strokeWidth={1.5}
      strokeLinejoin="round"
    />
    {/* Top card (tilted) */}
    <G transform="translate(32, 56) rotate(-6 40 20)">
      <Rect
        x={0}
        y={0}
        width={80}
        height={40}
        rx={6}
        stroke={ACCENT_WARM}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <Line x1={10} y1={12} x2={44} y2={12} stroke={ACCENT_WARM} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={10} y1={22} x2={60} y2={22} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
      <Line x1={10} y1={28} x2={50} y2={28} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
    </G>
    {/* Horizon line */}
    <Line x1={24} y1={138} x2={136} y2={138} stroke={SUBDUED} strokeWidth={1.5} strokeLinecap="round" />
    {/* Sparkle */}
    <Path
      d="M 124 28 L 124 38 M 119 33 L 129 33"
      stroke={ACCENT_WARM}
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  </Svg>
);

export const MarketingEmptyIllustration: React.FC<MarketingEmptyIllustrationProps> = ({
  illustration,
  size = 120,
}) => {
  switch (illustration) {
    case "marketing-audiences":
      return <AudiencesEmpty size={size} />;
    case "marketing-campaigns":
      return <CampaignsEmpty size={size} />;
    case "marketing-templates":
      return <TemplatesEmpty size={size} />;
    default:
      return null;
  }
};

export default MarketingEmptyIllustration;
