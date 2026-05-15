// PublicEventNotFound — pure-presentational 404 for unresolved public event URLs.
//
// Per META-ORCH-0827 Pass 2. Caller injects `onBrowse` callback so each
// consuming app can navigate to its own root surface.
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  backgroundColor,
  glass,
  radius,
  spacing,
  text,
  typography,
} from "./designTokens";
import type { PublicEventNotFoundProps } from "./types";

export const PublicEventNotFound: React.FC<PublicEventNotFoundProps> = ({
  onBrowse,
}) => (
  <View style={styles.host}>
    <View style={styles.iconWrap}>
      <Text style={styles.icon}>?</Text>
    </View>
    <Text style={styles.title}>This event isn't live</Text>
    <Text style={styles.body}>
      The link may be expired, mistyped, or the event hasn't been published yet.
    </Text>
    <Pressable
      onPress={onBrowse}
      accessibilityRole="button"
      accessibilityLabel="Browse Mingla"
      style={styles.cta}
    >
      <Text style={styles.ctaLabel}>Browse Mingla →</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 999,
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  icon: {
    fontSize: 32,
    color: text.tertiary,
    fontWeight: "700",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: text.primary,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    color: text.tertiary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.lg,
    maxWidth: 320,
  },
  cta: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  ctaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});
