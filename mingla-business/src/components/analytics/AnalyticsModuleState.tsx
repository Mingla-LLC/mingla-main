import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  accent,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
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
  <View style={styles.banner} accessibilityLiveRegion="polite">
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
  skeletonStack: { gap: spacing.md },
  errorCard: { minHeight: 180 },
  errorTitle: {
    color: textTokens.primary,
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
  },
  errorBody: {
    color: textTokens.secondary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    marginTop: spacing.sm,
  },
  retry: {
    minHeight: 44,
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: spacing.md,
  },
  retryText: {
    color: accent.warm,
    fontSize: typography.buttonMd.fontSize,
    lineHeight: typography.buttonMd.lineHeight,
    fontWeight: typography.buttonMd.fontWeight,
  },
  pressed: { opacity: 0.65 },
  banner: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: semantic.error,
    backgroundColor: semantic.errorTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  bannerText: {
    flex: 1,
    color: textTokens.primary,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
  },
  bannerAction: { minHeight: 44, justifyContent: "center" },
});
