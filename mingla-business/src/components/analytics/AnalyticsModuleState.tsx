import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  radius,
  space,
  color,
  type,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";
import { Skeleton } from "../ui/Skeleton";

export const AnalyticsModuleSkeleton: React.FC<{
  testID: string;
}> = ({ testID }) => (
  <GlassCard testID={testID} style={styles.skeletonCard}>
    <View style={styles.skeletonStack} accessible={false}>
      <Skeleton width="52%" height={24} />
      <Skeleton width="78%" height={16} />
      <Skeleton width="100%" height={72} />
      <Skeleton width="100%" height={72} />
    </View>
  </GlassCard>
);

export const AnalyticsModuleError: React.FC<{
  title: string;
  onRetry: () => void;
}> = ({ title, onRetry }) => (
  <GlassCard style={styles.errorCard}>
    <Text style={styles.errorTitle} accessibilityRole="header">
      {title}
    </Text>
    <Text style={styles.errorBody}>Check your connection and try again.</Text>
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
    >
      <Text style={styles.retryText}>Retry</Text>
    </Pressable>
  </GlassCard>
);

export const RefreshFailureBanner: React.FC<{ onRetry: () => void }> = ({
  onRetry,
}) => (
  <View style={styles.banner}>
    <Text style={styles.bannerText}>Couldn&apos;t refresh analytics</Text>
    <Pressable
      onPress={onRetry}
      accessibilityRole="button"
      style={({ pressed }) => [styles.bannerAction, pressed && styles.pressed]}
    >
      <Text style={styles.retryText}>Try again</Text>
    </Pressable>
  </View>
);

const styles = StyleSheet.create({
  skeletonCard: { width: "100%", minHeight: 260 },
  skeletonStack: { gap: space[4] },
  errorCard: { minHeight: 180 },
  errorTitle: {
    color: color.text1,
    fontSize: type.h1.fontSize,
    lineHeight: type.h1.lineHeight,
    fontWeight: type.h1.fontWeight,
  },
  errorBody: {
    color: color.text2,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    marginTop: space[2],
  },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: space[4],
  },
  retryText: {
    color: color.accent,
    fontSize: type.btnSm.fontSize,
    lineHeight: type.btnSm.lineHeight,
    fontWeight: type.btnSm.fontWeight,
  },
  pressed: { opacity: 0.65 },
  banner: {
    minHeight: 48,
    paddingHorizontal: space[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.danger,
    backgroundColor: color.errorTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[4],
  },
  bannerText: {
    flex: 1,
    color: color.text1,
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
  },
  bannerAction: { minHeight: 44, justifyContent: "center" },
});
