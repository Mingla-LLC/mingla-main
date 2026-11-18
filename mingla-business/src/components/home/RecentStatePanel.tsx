import React, { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import {
  radius as radiusTokens,
  color,
  space,
  type,
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
    paddingHorizontal: space[6],
    paddingVertical: space[6],
    gap: space[1],
  },
  title: {
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
    letterSpacing: type.h1.letterSpacing,
    color: color.text1,
    textAlign: "center",
  },
  description: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: type.small.fontWeight,
    color: color.text2,
    textAlign: "center",
  },
  ctaWrap: { marginTop: space[6] - space[1] },
  cta: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: space[4],
    borderRadius: radiusTokens.full,
    backgroundColor: color.paper,
  },
  ctaPressed: { opacity: 0.72 },
  ctaFocused: {
    borderWidth: 2,
    borderColor: color.canvas,
  },
  ctaLabel: {
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
    letterSpacing: type.btnSm.letterSpacing,
    color: color.ink,
  },
});
