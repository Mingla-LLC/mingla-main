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
  color,
  radius,
  type,
  space,
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
      ? color.success
      : deltaUp === false
        ? color.errorText
        : color.text3;

  return (
    <GlassCard variant="base" testID={testID} style={style}>
      <View style={styles.stack}>
        {/* #4490 N60: a label wraps rather than "KEPT FOR WALK-I…". */}
        <Text style={styles.label} numberOfLines={2}>
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
    gap: 2,
  },
  label: {
    fontSize: type.label.fontSize,
    lineHeight: type.label.lineHeight,
    fontWeight: type.label.fontWeight,
    letterSpacing: type.label.letterSpacing,
    color: color.text3,
  },
  value: {
    fontSize: type.stat.fontSize,
    lineHeight: type.stat.lineHeight,
    fontWeight: type.stat.fontWeight,
    letterSpacing: type.stat.letterSpacing,
    color: color.text1,
    marginTop: 2,
  },
  valueSkeleton: {
    width: 72,
    height: 24,
    borderRadius: radius.md,
    backgroundColor: color.fill.tile,
    marginTop: 2,
  },
  delta: {
    fontSize: type.caption.fontSize,
    lineHeight: type.caption.lineHeight,
    fontWeight: type.caption.fontWeight,
    letterSpacing: type.caption.letterSpacing,
    marginTop: space[1],
  },
  sub: {
    fontSize: type.small.fontSize,
    lineHeight: type.small.lineHeight,
    fontWeight: type.small.fontWeight,
    color: color.text2,
    marginTop: space[1],
  },
});

export default KpiTile;
