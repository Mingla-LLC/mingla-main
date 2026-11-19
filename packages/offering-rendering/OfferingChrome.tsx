// OfferingChrome — ORCH-1138 A2.
//
// The circular icon-button row over an offering cover: X (close) top-left;
// Share + optional Mute top-right. Matches DIRECTION_A_V2_FULL_RESPONSIVE.html
// `.chrome` (40×40 circular glass buttons, side-by-side Share + Mute).
//
// Used INSIDE ParallaxCoverShell, and exposed standalone so a page can mount it
// independently if it owns its own cover. Glyphs are inline SVG (the share glyph
// is ported verbatim from mingla-business Icon.tsx `share`; the volume glyph
// mirrors EventCoverMedia's VolumeGlyph) so the package stays isolated.
//
// Pure: react-native + react-native-svg + the shared ThemePalette only.

import React from "react";
import {
  Animated,
  Platform,
  Pressable,
  Text,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import Svg, { Circle, Line, Path } from "react-native-svg";

import { type ThemePalette } from "./themePalette";

import { shouldRenderCloseButton } from "./closeButtonVisibility";

const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 };

const CloseGlyph: React.FC<{ color?: string }> = ({ color = "#FFFFFF" }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
    <Line
      x1={6}
      y1={6}
      x2={18}
      y2={18}
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
    />
    <Line
      x1={18}
      y1={6}
      x2={6}
      y2={18}
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
    />
  </Svg>
);

// Ported verbatim from mingla-business Icon.tsx `share`.
const ShareGlyph: React.FC<{ color?: string }> = ({ color = "#FFFFFF" }) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
    <Circle cx={6} cy={12} r={2.5} stroke={color} strokeWidth={2} />
    <Circle cx={18} cy={6} r={2.5} stroke={color} strokeWidth={2} />
    <Circle cx={18} cy={18} r={2.5} stroke={color} strokeWidth={2} />
    <Path
      d="M8.2 10.8L15.8 7.2M8.2 13.2L15.8 16.8"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Svg>
);

// Mirrors EventCoverMedia's VolumeGlyph (filled speaker body + slash↔waves).
const VolumeGlyph: React.FC<{ muted: boolean; color?: string }> = ({
  muted,
  color = "#FFFFFF",
}) => (
  <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
    <Path
      d="M11 5 6 9H2v6h4l5 4V5z"
      fill={color}
      stroke={color}
      strokeWidth={2}
      strokeLinejoin="round"
    />
    {muted ? (
      <>
        <Line
          x1={16}
          y1={9}
          x2={22}
          y2={15}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Line
          x1={22}
          y1={9}
          x2={16}
          y2={15}
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
        />
      </>
    ) : (
      <Path
        d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    )}
  </Svg>
);

export interface OfferingChromeProps {
  palette: ThemePalette;
  showMute: boolean;
  muted: boolean;
  onClose: () => void;
  onShare: () => void;
  onToggleMute: () => void;
  closeAccessibilityLabel?: string;
  /**
   * ORCH-1159 — when true, the floating "X" (close) button is HIDDEN on web
   * (`Platform.OS === "web"`) and KEPT on native. On the public event / trip /
   * experience pages there is no parent screen to return to on web — the close
   * handler just bounces an anonymous share-link visitor to the brand page or
   * home, which is confusing. Share + Mute are NEVER affected. Native is
   * byte-identical to before. Absent / false ⇒ the close button renders on all
   * surfaces (current behavior — the public brand page keeps its X on web).
   */
  hideCloseOnWeb?: boolean;
  /**
   * issue #4420 — the slim glass header state. false (the cover is on screen):
   * the icons sit in frosted circles over the cover. true (the cover has
   * scrolled away): the header has its own frosted page-colour band, so the
   * icons turn plain, in the page's ink, and the title shows. Absent ⇒ false,
   * so every caller that does not pass it renders exactly as before.
   */
  solid?: boolean;
  /** issue #4420 — the title shown in the middle of the solid header. */
  title?: string | null;
  /** issue #4420 — the title's opacity (follows the scroll). */
  titleOpacity?: Animated.Value | Animated.AnimatedInterpolation<number>;
  /** issue #4420 — the theme-motion pause control, placed in the icon group. */
  pauseSlot?: React.ReactNode;
  /** issue #4420 — the host's bold face for the header title. */
  titleFontFamily?: string;
  testID?: string;
}

const ChromeButton: React.FC<{
  onPress: () => void;
  accessibilityLabel: string;
  children: React.ReactNode;
  testID?: string;
}> = ({ onPress, accessibilityLabel, children, testID }) => (
  <Pressable
    onPress={onPress}
    hitSlop={HIT_SLOP}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel}
    style={styles.button}
    testID={testID}
  >
    {children}
  </Pressable>
);

export const OfferingChrome: React.FC<OfferingChromeProps> = ({
  palette,
  showMute,
  muted,
  onClose,
  onShare,
  onToggleMute,
  closeAccessibilityLabel = "Close",
  hideCloseOnWeb = false,
  solid = false,
  title = null,
  titleOpacity,
  pauseSlot = null,
  titleFontFamily,
  testID,
}: OfferingChromeProps) => {
  // Over the cover: frosted circles on a neutral scrim, readable on any
  // cover. issue #4420 — in the solid glass header the band itself is the
  // glass, so the icons turn plain, in the page's ink.
  const tint: ViewStyle = solid
    ? styles.plain
    : { backgroundColor: "rgba(0,0,0,0.48)" };
  const glyph = solid ? palette.primaryText : "#FFFFFF";
  const showTitle = title !== null && title.length > 0;
  // ORCH-1159 — hide ONLY the close button on web when the caller opts in
  // (public event / trip / experience pages). Share + Mute always render; native
  // is unaffected. When the close button is hidden, an empty placeholder keeps
  // the left slot so the space-between row still pins the Share/Mute group to the
  // right edge (a single child under space-between would otherwise flush LEFT).
  const showClose = shouldRenderCloseButton(hideCloseOnWeb, Platform.OS);
  return (
    <View style={styles.row} pointerEvents="box-none" testID={testID}>
      {showClose ? (
        <ChromeButton
          onPress={onClose}
          accessibilityLabel={closeAccessibilityLabel}
          testID={testID !== undefined ? `${testID}-close` : undefined}
        >
          <View style={[styles.glass, tint]}>
            <CloseGlyph color={glyph} />
          </View>
        </ChromeButton>
      ) : (
        <View pointerEvents="none" style={showTitle ? styles.closeSpacer : null} />
      )}
      {showTitle ? (
        <Animated.View
          style={[styles.titleWrap, titleOpacity !== undefined ? { opacity: titleOpacity } : null]}
          pointerEvents="none"
        >
          <Text
            style={[
              styles.title,
              { color: palette.primaryText },
              titleFontFamily !== undefined ? { fontFamily: titleFontFamily } : null,
            ]}
            numberOfLines={1}
            accessibilityElementsHidden={!solid}
            importantForAccessibility={solid ? "auto" : "no-hide-descendants"}
            testID={testID !== undefined ? `${testID}-title` : undefined}
          >
            {title}
          </Text>
        </Animated.View>
      ) : null}
      <View style={styles.rightGroup}>
        {pauseSlot}
        <ChromeButton
          onPress={onShare}
          accessibilityLabel="Share"
          testID={testID !== undefined ? `${testID}-share` : undefined}
        >
          <View style={[styles.glass, tint]}>
            <ShareGlyph color={glyph} />
          </View>
        </ChromeButton>
        {showMute ? (
          <ChromeButton
            onPress={onToggleMute}
            accessibilityLabel={
              muted ? "Turn on cover sound" : "Mute cover sound"
            }
            testID={testID !== undefined ? `${testID}-mute` : undefined}
          >
            <View style={[styles.glass, tint]}>
              <VolumeGlyph muted={muted} color={glyph} />
            </View>
          </ChromeButton>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  rightGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  // issue #4420 — the solid-header title and plain icons.
  titleWrap: {
    flex: 1,
    minWidth: 0,
    alignSelf: "center",
    paddingHorizontal: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  closeSpacer: { width: 40 },
  plain: { backgroundColor: "transparent" },
  button: {
    // 44pt min hit target via hitSlop; the visible glass is 40×40.
  },
  glass: {
    // #4490: 44 touch target (a phone browser has no hitSlop).
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    // Android opaque glass fallback (ANDROID_GLASS_USES_OPAQUE_FALLBACK).
    ...Platform.select({
      android: { backgroundColor: "rgba(0,0,0,0.7)" },
      default: {},
    }),
    overflow: "hidden",
  },
});

export default OfferingChrome;
