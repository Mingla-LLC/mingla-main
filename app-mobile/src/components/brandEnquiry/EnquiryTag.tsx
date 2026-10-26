/**
 * #4111 Wave D — the two small marks every enquiry row and thread header use.
 *
 *   EnquiryTag          the "Enquiry" chip that sits after the brand name
 *   EnquiryBrandAvatar  the brand logo in a rounded square with a small
 *                       question badge (initials when the brand has no logo)
 *
 * Self-contained on purpose: #4114 is redesigning the chat rows and will move
 * the chip into its shared tag slot (chatKind "enquiry", `isEnquiry`). Nothing
 * here depends on ChatListItem or ConnectionsPage.
 */
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

export const ENQUIRY_ACCENT = "#eb7825";

export function EnquiryTag({ testID = "enquiry-tag" }: { testID?: string }): React.ReactElement {
  const { t } = useTranslation("enquiry");
  return (
    <View style={styles.tag} testID={testID}>
      <Text style={styles.tagText} numberOfLines={1}>
        {t("enquiry:tag")}
      </Text>
    </View>
  );
}

const initials = (name: string): string => {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
  return letters.slice(0, 2) || "?";
};

export function EnquiryBrandAvatar({
  brandName,
  logoUrl,
  size = 52,
  testID = "enquiry-brand-avatar",
}: {
  brandName: string;
  logoUrl: string | null;
  size?: number;
  testID?: string;
}): React.ReactElement {
  const { t } = useTranslation("enquiry");
  const radius = Math.round(size * 0.27);
  const badge = Math.max(16, Math.round(size * 0.4));
  return (
    <View style={{ width: size, height: size }} testID={testID}>
      {logoUrl !== null ? (
        <Image
          source={{ uri: logoUrl }}
          style={[styles.logo, { width: size, height: size, borderRadius: radius }]}
          resizeMode="cover"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.logo, styles.fallback, { width: size, height: size, borderRadius: radius }]}>
          <Text style={[styles.fallbackText, { fontSize: Math.round(size * 0.34) }]}>{initials(brandName)}</Text>
        </View>
      )}
      <View
        style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2 }]}
        accessible
        accessibilityLabel={t("enquiry:question_badge_a11y")}
        testID={`${testID}-badge`}
      >
        <Text style={[styles.badgeText, { fontSize: Math.round(badge * 0.62), lineHeight: Math.round(badge * 0.8) }]}>?</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: "center",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "rgba(235,120,37,0.16)",
    borderWidth: 1,
    borderColor: "rgba(235,120,37,0.45)",
    flexShrink: 0,
  },
  tagText: {
    color: ENQUIRY_ACCENT,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  logo: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2a2d33",
  },
  fallbackText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  badge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: ENQUIRY_ACCENT,
    borderWidth: 2,
    borderColor: "#0c0e12",
  },
  badgeText: {
    color: "#ffffff",
    fontWeight: "900",
    textAlign: "center",
  },
});
