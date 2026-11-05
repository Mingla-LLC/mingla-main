import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { accent, spacing, text as textTokens } from "../../../constants/designSystem";

/**
 * #2830 design state 11 — the way back stays visible through the whole creator.
 * Rendered by each creator route above its wizard, loaded by an inline
 * React.lazy there, so wizard internals stay untouched and nothing is hoisted.
 */
export default function CreatorReturnBar({ onBack }: { onBack: () => void }): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top }]} testID="creator-return-bar">
      <Pressable
        onPress={onBack}
        accessibilityRole="link"
        accessibilityLabel="Back to website setup"
        style={styles.back}
        testID="creator-return-back"
      >
        <Text style={styles.backLabel}>Back to website setup</Text>
      </Pressable>
      <Text style={styles.note}>Saved as a draft if you go back</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap", paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: "rgba(255, 255, 255, 0.1)" },
  back: { minHeight: 44, justifyContent: "center" },
  backLabel: { fontSize: 14, fontWeight: "600", color: accent.warm },
  note: { fontSize: 13, color: textTokens.tertiary },
});
