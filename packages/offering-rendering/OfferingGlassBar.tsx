// issue #4420 — the glass bottom bar every public offering page shares.
//
// One frosted pill: on the left, what the buyer is about to commit to (a bold
// line, e.g. "From ₦5,000" or "₦10,000", and a quiet line, e.g.
// "2 tickets · all-in"); on the right, the one next step. The page passes the
// copy, so the bar updates live as the buyer chooses. When nothing can be
// bought the bar shows the state (e.g. "Sold out") with no button, so a dead
// tap is impossible.
//
// Theme: the button is the ONLY gradient fill (accentFill + the gradient
// layer); every text accent stays the first colour (#1023 rule). The frosted
// layer uses GlassBlur, which skips backdrop blur on mobile web (stacked
// backdrop filters crash the mobile browser) and paints opaque on Android.
//
// Pure: react-native + this package only. Wave B (venues, stays) reuses it.

import React from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { GlassBlur } from "./GlassBlur";
import { ThemeAccentGradientLayer } from "./ThemeAccentFill";
import { accentFill, themeFontFace } from "./themeAccentStyle";
import { boldFontFamily, hexToRgba, type ThemePalette } from "./themePalette";

export interface OfferingGlassBarProps {
  palette: ThemePalette;
  theme?: ResolvedTheme;
  /** The bold line: a total, a "From" price, or the state ("Sold out"). */
  title: string;
  /** The quiet line under it (count, date, "all-in"). Null hides it. */
  subtitle?: string | null;
  /** The button label. Null renders no button (nothing can be bought). */
  ctaLabel: string | null;
  onPress?: () => void;
  /** false greys the button out (in-flight checkout). */
  enabled?: boolean;
  /** Spoken label for the button; defaults to "<cta>, <title>". */
  ctaAccessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** testID for the button; defaults to `${testID}-action`. */
  actionTestID?: string;
}

/** Readable translucent glass tone over the page colour. */
const glassFill = (palette: ThemePalette): string => {
  const base = palette.panelStrong.startsWith("#") ? palette.panelStrong : palette.page;
  if (!base.startsWith("#")) return palette.panelStrong;
  // Android paints opaque (no real blur); everywhere else ~78% over the blur.
  return Platform.OS === "android" ? base : hexToRgba(base, 0.78);
};

export const OfferingGlassBar: React.FC<OfferingGlassBarProps> = ({
  palette,
  theme,
  title,
  subtitle = null,
  ctaLabel,
  onPress,
  enabled = true,
  ctaAccessibilityLabel,
  style,
  testID,
  actionTestID,
}: OfferingGlassBarProps) => {
  const boldFace =
    theme !== undefined ? themeFontFace(boldFontFamily(theme)) : null;
  const showButton = ctaLabel !== null && ctaLabel.length > 0;
  const tappable = showButton && enabled && onPress !== undefined;
  const hasSubtitle = subtitle !== null && subtitle.length > 0;
  return (
    <View
      style={[
        styles.bar,
        { borderColor: palette.panelBorder, backgroundColor: glassFill(palette) },
        style,
      ]}
      testID={testID}
    >
      <GlassBlur
        intensity={40}
        tint={palette.glassTint}
        style={[StyleSheet.absoluteFill, styles.blur]}
        pointerEvents="none"
      />
      <View
        style={styles.textCol}
        accessible
        accessibilityRole="text"
        accessibilityLabel={hasSubtitle ? `${title}. ${subtitle}` : title}
        accessibilityLiveRegion="polite"
      >
        <Text
          style={[styles.title, { color: palette.primaryText }]}
          numberOfLines={1}
          ellipsizeMode="tail"
          testID={testID !== undefined ? `${testID}-title` : undefined}
        >
          {title}
        </Text>
        {hasSubtitle ? (
          <Text
            style={[styles.subtitle, { color: palette.secondaryText }]}
            numberOfLines={1}
            ellipsizeMode="tail"
            testID={testID !== undefined ? `${testID}-subtitle` : undefined}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {showButton ? (
        <Pressable
          onPress={tappable ? onPress : undefined}
          disabled={!tappable}
          accessibilityRole="button"
          accessibilityState={{ disabled: !tappable }}
          accessibilityLabel={ctaAccessibilityLabel ?? `${ctaLabel}, ${title}`}
          hitSlop={4}
          style={({ pressed }) => [
            styles.button,
            tappable
              ? accentFill(palette)
              : {
                  backgroundColor: palette.card,
                  borderColor: palette.panelBorder,
                  borderWidth: 1,
                },
            pressed && tappable ? styles.pressed : null,
          ]}
          testID={actionTestID ?? (testID !== undefined ? `${testID}-action` : undefined)}
        >
          {tappable && theme !== undefined ? (
            <ThemeAccentGradientLayer
              theme={theme}
              palette={palette}
              borderRadius={styles.button.borderRadius}
            />
          ) : null}
          <Text
            style={[
              styles.buttonText,
              { color: tappable ? palette.accentText : palette.tertiaryText },
              boldFace,
            ]}
            numberOfLines={1}
          >
            {ctaLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
};

/** Bar height including its padding; callers add the safe-area bottom. */
export const OFFERING_GLASS_BAR_HEIGHT = 68;
/** Gap between the bar and the screen's bottom safe edge. */
export const OFFERING_GLASS_BAR_GAP = 12;

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: OFFERING_GLASS_BAR_HEIGHT,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 8,
    paddingLeft: 20,
    paddingRight: 8,
    overflow: "hidden",
    ...Platform.select({
      android: { elevation: 6 },
      default: {
        shadowColor: "#000000",
        shadowOpacity: 0.32,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 14 },
      },
    }),
  },
  blur: { borderRadius: 999 },
  textCol: { flex: 1, minWidth: 0 },
  title: {
    fontSize: 15,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
  },
  subtitle: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  button: {
    flexShrink: 0,
    minHeight: 48,
    maxWidth: "62%",
    paddingHorizontal: 20,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  buttonText: { fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.86 },
});

export default OfferingGlassBar;
