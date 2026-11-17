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
  color,
  radius,
  space,
  type,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

export const PublicBrandNotFound: React.FC = () => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleBrowse = (): void => {
    router.replace("/" as never);
  };

  return (
    <View style={[styles.host, { paddingTop: insets.top + space[7] }]}>
      <View style={styles.iconWrap}>
        <Icon name="search" size={32} color={color.text3} />
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
    borderRadius: radius.sm,
    overflow: "hidden",
    backgroundColor: color.fill.tabOn,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  ctaLabel: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
  },
});
