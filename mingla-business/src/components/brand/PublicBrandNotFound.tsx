/**
 * PublicBrandNotFound — friendly 404 for unresolved public brand URLs.
 *
 * Renders when `/b/{brandSlug}` doesn't match any Brand in the store.
 * Reasons it might happen:
 *   - Slug typo (most likely — IG-bio links are typed by humans)
 *   - Brand was deleted (post-MVP — no delete-brand flow today)
 *   - Pre-MVP: store was wiped via logout
 *
 * Mirrors PublicEventNotFound (Cycle 6) verbatim except for copy.
 *
 * Per Cycle 7 spec §2.5.
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

export const PublicBrandNotFound: React.FC = () => {
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
      <Text style={styles.title}>We couldn't find that brand</Text>
      <Text style={styles.body}>
        The link may be mistyped or the brand may have changed its name.
        Check the URL and try again.
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
