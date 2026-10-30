import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { AriOrb } from "../../components/ari/AriOrb";
import {
  spacing,
  text as textTokens,
} from "../../constants/designSystem";

/** The visible, motion-aware transition while an existing Ari thread loads. */
export const AriThreadLoadingState: React.FC = () => (
  <View
    style={styles.root}
    accessibilityRole="progressbar"
    accessibilityLabel="Opening Ari conversation"
    accessibilityLiveRegion="polite"
  >
    <AriOrb size="md" thinking decorative />
    <Text style={styles.copy}>Opening conversation…</Text>
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  copy: {
    color: textTokens.secondary,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
});

