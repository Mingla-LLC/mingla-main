import React, { useMemo } from "react";
import { Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { accent, glass, radius, spacing, text as textTokens } from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

interface DownloadMinglaCtaProps {
  orderId: string;
  eventName: string;
  eventType: "event" | "trip";
}

const APP_STORE_URL = "https://apps.apple.com/app/mingla";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.mingla.app.v2";

export const DownloadMinglaCta: React.FC<DownloadMinglaCtaProps> = ({
  orderId,
  eventName,
  eventType,
}) => {
  const universalLink = `https://usemingla.com/orders/${orderId}/chat`;
  const noun = eventType === "trip" ? "trip" : "event";
  const primaryStore = useMemo(() => {
    if (Platform.OS === "ios") return APP_STORE_URL;
    if (Platform.OS === "android") return PLAY_STORE_URL;
    return universalLink;
  }, [universalLink]);

  const open = (url: string) => {
    Linking.openURL(url).catch(() => Linking.openURL(universalLink));
  };

  return (
    <View style={styles.card}>
      <View style={styles.iconWrap}>
        <Icon name="chat" size={20} color={accent.warm} />
      </View>
      <Text style={styles.title} numberOfLines={2}>
        Join your {noun} chat in the Mingla app
      </Text>
      <Text style={styles.body} numberOfLines={2}>
        Get updates, ask questions, and message other buyers for {eventName}.
      </Text>
      <View style={styles.badgeRow}>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Open in Mingla"
          style={styles.primaryBadge}
          onPress={() => open(primaryStore)}
        >
          <Icon name="download" size={16} color={textTokens.inverse} />
          <Text style={styles.primaryBadgeText}>Open in Mingla</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Google Play"
          style={styles.secondaryBadge}
          onPress={() => open(PLAY_STORE_URL)}
        >
          <Text style={styles.secondaryBadgeText}>Google Play</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: accent.tint,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
    color: textTokens.primary,
  },
  body: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  badgeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  primaryBadge: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: accent.warm,
  },
  primaryBadgeText: {
    color: textTokens.inverse,
    fontWeight: "700",
  },
  secondaryBadge: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  secondaryBadgeText: {
    color: textTokens.primary,
    fontWeight: "700",
  },
});

export default DownloadMinglaCta;
