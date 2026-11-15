// issue #4420 — the section heading on every public offering page ("Tickets",
// "About", "Where you'll be", "Presented by", "Cancellation policy", "Day by
// day"…), set in the host's display font, plus the small uppercase sub-label
// used inside a decision area ("DATE", "TIME", "HOW YOU PAY").
//
// Pure: react-native + this package only. Wave B (venues, stays) reuses it.

import React from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import type { ResolvedTheme } from "./designTokens";
import { themeFontFace } from "./themeAccentStyle";
import { boldFontFamily, type ThemePalette } from "./themePalette";

export interface OfferingSectionTitleProps {
  palette: ThemePalette;
  theme?: ResolvedTheme;
  /** Pass the face directly when the caller already resolved it. */
  fontFamily?: string;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

export const OfferingSectionTitle: React.FC<OfferingSectionTitleProps> = ({
  palette,
  theme,
  fontFamily,
  children,
  style,
  testID,
}: OfferingSectionTitleProps) => {
  const family =
    fontFamily ?? (theme !== undefined ? boldFontFamily(theme) : undefined);
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.title,
        { color: palette.primaryText },
        family !== undefined ? themeFontFace(family) : null,
        style,
      ]}
      testID={testID}
    >
      {children}
    </Text>
  );
};

export const OfferingSubLabel: React.FC<{
  palette: ThemePalette;
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  testID?: string;
}> = ({ palette, children, style, testID }) => (
  <Text
    style={[styles.sub, { color: palette.secondaryText }, style]}
    testID={testID}
  >
    {children}
  </Text>
);

const styles = StyleSheet.create({
  title: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 14,
  },
  sub: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 10,
  },
});

export default OfferingSectionTitle;
