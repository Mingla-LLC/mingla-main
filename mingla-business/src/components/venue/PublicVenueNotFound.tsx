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
  radius as radiusTokens,
  space,
  color,
  type,
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
    <View style={[styles.host, { paddingTop: insets.top + space[7] }]}>
      <View style={styles.iconWrap}>
        <Icon name="search" size={32} color={color.text3} />
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
    backgroundColor: color.canvas,
    paddingHorizontal: space[6],
    alignItems: "center",
    justifyContent: "center",
    gap: space[2],
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: color.fill.inset,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[4],
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: color.text1,
    textAlign: "center",
  },
  body: {
    fontSize: 14,
    color: color.text3,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: space[6],
    maxWidth: 320,
  },
  cta: {
    paddingVertical: space[4],
    paddingHorizontal: space[6],
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    backgroundColor: color.accentLine,
    borderWidth: 1,
    borderColor: color.accentLine,
  },
  ctaLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
  brandLink: {
    paddingVertical: space[2],
    paddingHorizontal: space[4],
  },
  brandLinkLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.accent,
  },
});
