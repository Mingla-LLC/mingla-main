/**
 * PublicVenueNotFound — META-ORCH-1255(C) DESIGN §6.8.
 *
 * ONE state for "no such venue", "not live yet", and "suspended/removed" —
 * identical output, no information leak (an anon visitor can never tell a
 * pending venue from a non-existent one). Mirrors PublicBrandNotFound
 * geometry verbatim; copy is venue-specific.
 *
 * When the PARENT brand resolves publicly, a secondary "See {brand} →" link
 * routes to /b/{brandSlug}; otherwise it is omitted entirely.
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
import { brandPublicPath } from "../../constants/publicUrls";
import { Icon } from "../ui/Icon";

export interface PublicVenueNotFoundProps {
  brandSlug: string | null;
  /** Non-null ⇒ the parent brand resolved publicly → secondary link shows. */
  brandDisplayName: string | null;
}

export const PublicVenueNotFound: React.FC<PublicVenueNotFoundProps> = ({
  brandSlug,
  brandDisplayName,
}) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBrowse = (): void => {
    router.replace("/" as never);
  };

  const handleOpenBrand = (): void => {
    if (brandSlug === null) return;
    router.replace(brandPublicPath(brandSlug) as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + spacing.xl }]}>
      <View style={styles.iconWrap}>
        <Icon name="search" size={32} color={textTokens.tertiary} />
      </View>
      <Text style={styles.title}>This venue isn&apos;t on Mingla yet</Text>
      <Text style={styles.body}>
        The link may be mistyped, or the venue isn&apos;t live right now.
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
      {brandDisplayName !== null && brandSlug !== null ? (
        <Pressable
          onPress={handleOpenBrand}
          accessibilityRole="link"
          accessibilityLabel={`See ${brandDisplayName} on Mingla`}
          style={styles.brandLink}
        >
          <Text style={styles.brandLinkLabel}>See {brandDisplayName} →</Text>
        </Pressable>
      ) : null}
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
    overflow: "hidden",
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
    overflow: "hidden",
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  ctaLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
  brandLink: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  brandLinkLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
  },
});
