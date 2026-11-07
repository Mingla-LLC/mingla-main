/**
 * #4271 door polish — one grouped list for the Tap to Pay setup facts and the
 * How to Tap guide, instead of a separate card per fact (three boxes read as
 * three choices). Text only: Apple allows no art of the feature on iPhone.
 *
 * iOS and web: translucent glass. Android: the opaque row fill and border
 * (ANDROID_GLASS_USES_OPAQUE_FALLBACK), no elevation.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import {
  androidOpaque,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../../constants/designSystem";

export interface TapFact {
  title: string;
  sub: string;
}

export interface TapFactListProps {
  facts: readonly TapFact[];
  testID?: string;
}

export const TapFactList = ({ facts, testID }: TapFactListProps): React.ReactElement => (
  <View style={[styles.list, Platform.OS === "android" ? styles.listAndroid : null]} testID={testID}>
    {facts.map((fact, index) => (
      <View
        key={fact.title}
        style={[styles.row, index > 0 ? styles.rowDivided : null]}
        accessible
        accessibilityLabel={`${fact.title}. ${fact.sub}`}
      >
        <Text style={styles.title}>{fact.title}</Text>
        <Text style={styles.sub}>{fact.sub}</Text>
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  list: {
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  listAndroid: {
    borderColor: androidOpaque.rowBorder,
    backgroundColor: androidOpaque.rowFill,
  },
  row: {
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: glass.border.profileBase,
  },
  title: { ...typography.body, fontWeight: "600", color: textTokens.primary },
  sub: { ...typography.bodySm, color: textTokens.secondary },
});
