import { StyleSheet, Text, View } from "react-native";

import {
  formatCompactCount,
  formatFollowerCountA11y,
  formatFollowerCountLine,
} from "./followerCount";

export type FollowerCountLabels = {
  zero: string;
  line: (n: number, compact: string) => string;
  a11y: (n: number, compact: string) => string;
  prefixJoin?: string;
};

export type FollowerCountLineProps = {
  count: number | null | undefined;
  loading?: boolean;
  palette: { primaryText: string; secondaryText: string };
  variant: "caption" | "presentedBy";
  testID?: string;
  prefix?: string;
  labels?: FollowerCountLabels;
};

export function FollowerCountLine({
  count,
  loading = false,
  palette,
  variant,
  testID = "follower-count-line",
  prefix,
  labels,
}: FollowerCountLineProps) {
  if (loading) {
    return (
      <View
        testID={`${testID}-skeleton`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.skeleton,
          variant === "caption" ? styles.skeletonCaption : styles.skeletonPresentedBy,
          { backgroundColor: palette.secondaryText },
        ]}
      />
    );
  }

  if (typeof count !== "number") return null;
  const compact = formatCompactCount(count);
  if (compact === null) return null;

  const prefixText = prefix !== undefined && prefix.length > 0
    ? `${prefix}${labels?.prefixJoin ?? " · "}`
    : "";
  const line = labels?.line(count, compact) ?? formatFollowerCountLine(count);
  const accessibilityLabel = labels?.a11y(count, compact) ?? formatFollowerCountA11y(count);
  if (line === null || accessibilityLabel === null) return null;

  const textStyle = variant === "caption" ? styles.caption : styles.presentedBy;
  if (count === 0) {
    return (
      <Text
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        style={[textStyle, styles.zero, { color: palette.secondaryText }]}
      >
        {prefixText}{labels?.zero ?? line}
      </Text>
    );
  }

  const compactIndex = line.indexOf(compact);
  const before = compactIndex >= 0 ? line.slice(0, compactIndex) : "";
  const after = compactIndex >= 0 ? line.slice(compactIndex + compact.length) : line;

  return (
    <Text
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={[textStyle, { color: palette.secondaryText }]}
    >
      {prefixText}{before}
      {compactIndex >= 0 ? (
        <Text style={[styles.number, { color: palette.primaryText }]}>{compact}</Text>
      ) : null}
      {after}
    </Text>
  );
}

const styles = StyleSheet.create({
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
  presentedBy: {
    fontSize: 12,
    lineHeight: 16,
  },
  number: {
    fontWeight: "700",
  },
  zero: {
    fontWeight: "500",
  },
  skeleton: {
    height: 12,
    borderRadius: 6,
    opacity: 0.18,
  },
  skeletonCaption: {
    width: 84,
  },
  skeletonPresentedBy: {
    width: 72,
  },
});
