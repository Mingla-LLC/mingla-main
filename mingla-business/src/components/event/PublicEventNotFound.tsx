/**
 * PublicEventNotFound — friendly 404 for unresolved public event URLs.
 *
 * Renders when `/e/{brandSlug}/{eventSlug}` doesn't match any LiveEvent
 * in the store. Reasons it might happen:
 *   - Slug typo
 *   - Event was unpublished/cancelled (Cycle 9)
 *   - Pre-MVP: store was wiped via logout (no remote source of truth yet)
 *
 * The "Browse Mingla" CTA routes to `/` (root). Cycle 15 wires the
 * marketing landing; for now `/` is the auth/home redirect target.
 *
 * Per Cycle 6 spec §3.3.2.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export const PublicEventNotFound: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBrowse = (): void => {
    router.replace("/" as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.iconWrap}>
        <Icon name="search" size={32} color={textTokens.tertiary} />
      </View>
      <Text style={styles.title}>This event isn't live</Text>
      <Text style={styles.body}>
        The link may be expired, mistyped, or the event hasn't been
        published yet.
      </Text>
      <Pressable
        onPress={handleBrowse}
        accessibilityRole="button"
        accessibilityLabel="Browse Mingla"
        style={styles.cta}
      >
        <Text style={styles.ctaLabel}>Browse Mingla →</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
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
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    color: textTokens.tertiary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: spacing.lg,
    maxWidth: 320,
  },
  cta: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radiusTokens.md,
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
