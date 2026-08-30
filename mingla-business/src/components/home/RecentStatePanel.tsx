import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export function RecentStatePanel({
  title,
  description,
  cta,
}: {
  title: string;
  description: string;
  cta?: { label: string; onPress: () => void };
}): React.ReactElement {
  const [ctaFocused, setCtaFocused] = useState(false);
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {cta !== undefined ? (
        <View style={styles.ctaWrap}>
          <Pressable
            testID="recent-state-cta"
            accessibilityRole="button"
            accessibilityLabel={cta.label}
            onPress={cta.onPress}
            onFocus={() => setCtaFocused(true)}
            onBlur={() => setCtaFocused(false)}
            style={({ pressed }) => [
              styles.cta,
              pressed && styles.ctaPressed,
              Platform.OS === "web" && ctaFocused && styles.ctaFocused,
            ]}
          >
            <Text style={styles.ctaLabel}>{cta.label}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    letterSpacing: typography.h3.letterSpacing,
    color: textTokens.primary,
    textAlign: "center",
  },
  description: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
    color: textTokens.secondary,
    textAlign: "center",
  },
  ctaWrap: { marginTop: spacing.lg - spacing.xs },
  cta: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
  },
  ctaPressed: { opacity: 0.72 },
  ctaFocused: {
    borderWidth: 2,
    borderColor: textTokens.inverse,
  },
  ctaLabel: {
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
    letterSpacing: typography.buttonMd.letterSpacing,
    color: textTokens.inverse,
  },
});
