/**
 * KpiTile — small dashboard tile showing a label, a stat value, an
 * optional delta line, and an optional sub-line of supporting context.
 *
 * Currency-aware contract (Invariant I-10): `value` accepts
 * `string | number`. The CALLER is responsible for `Intl.NumberFormat`
 * formatting (locale + currency + min/max fraction digits). KpiTile
 * never formats currency itself — that authority lives at the call site
 * which knows the brand's locale.
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import {
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

import { GlassCard } from "./GlassCard";

export interface KpiTileProps {
  label: string;
  /** Pre-formatted value. Caller decides currency, locale, fraction digits. */
  value: string | number;
  /** Pre-formatted delta string e.g. `"+12.4%"`, `"-3"`. */
  delta?: string;
  /** Drives delta colour: `true` = success, `false` = error, `undefined` = neutral. */
  deltaUp?: boolean;
  sub?: string;
  loading?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const KpiTile: React.FC<KpiTileProps> = ({
  label,
  value,
  delta,
  deltaUp,
  sub,
  loading = false,
  testID,
  style,
}) => {
  const deltaColor =
    deltaUp === true
      ? semantic.success
      : deltaUp === false
        ? semantic.error
        : textTokens.tertiary;

  return (
    <GlassCard variant="base" testID={testID} style={style}>
      <View style={styles.stack}>
        <Text style={styles.label} numberOfLines={1}>
          {label.toUpperCase()}
        </Text>
        {loading ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.valueSkeleton}
            testID={testID === undefined ? "kpi-loading" : `${testID}-loading`}
          />
        ) : (
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
            {String(value)}
          </Text>
        )}
        {!loading && delta !== undefined ? (
          <Text style={[styles.delta, { color: deltaColor }]} numberOfLines={1}>
            {delta}
          </Text>
        ) : null}
        {!loading && sub !== undefined ? (
          <Text style={styles.sub} numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xxs,
  },
  label: {
    fontSize: typography.labelCap.fontSize,
    lineHeight: typography.labelCap.lineHeight,
    fontWeight: typography.labelCap.fontWeight,
    letterSpacing: typography.labelCap.letterSpacing,
    color: textTokens.tertiary,
  },
  value: {
    fontSize: typography.statValue.fontSize,
    lineHeight: typography.statValue.lineHeight,
    fontWeight: typography.statValue.fontWeight,
    letterSpacing: typography.statValue.letterSpacing,
    color: textTokens.primary,
    marginTop: spacing.xxs,
  },
  valueSkeleton: {
    width: 72,
    height: 24,
    borderRadius: radius.md,
    backgroundColor: "rgba(255, 255, 255, 0.06)",
    marginTop: spacing.xxs,
  },
  delta: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    marginTop: spacing.xs,
  },
  sub: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: typography.bodySm.fontWeight,
    color: textTokens.secondary,
    marginTop: spacing.xs,
  },
});

export default KpiTile;
