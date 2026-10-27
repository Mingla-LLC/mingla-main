/**
 * #3872 round 2 — the one compact strip of up to three numbers. Its own
 * module so the brand page can show it without loading the Creator and
 * Referral program kit (ProgramKit re-exports it for program screens).
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { GlassCard } from "../ui/GlassCard";
import { glass, spacing, text as textTokens } from "../../constants/designSystem";
import { stripItems } from "./programLayout";

export function StatStrip({
  items,
}: {
  items: ReadonlyArray<
    | { value: string; label: string; onPress?: () => void; accessibilityHint?: string }
    | null
    | undefined
    | false
  >;
}): React.ReactElement {
  const shown = stripItems(items);
  return (
    <GlassCard
      variant="base"
      radius="lg"
      padding={0}
      contentStyle={styles.strip}
    >
      {shown.map((item, index) => {
        const body = (
          <>
            <Text style={styles.stripValue} numberOfLines={1} adjustsFontSizeToFit>
              {item.value}
            </Text>
            <Text style={styles.stripLabel} numberOfLines={2}>
              {item.label}
            </Text>
          </>
        );
        const cellStyle = [styles.stripCell, index > 0 && styles.stripDivider];
        return item.onPress ? (
          <Pressable
            key={item.label}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}: ${item.value}`}
            accessibilityHint={item.accessibilityHint}
            style={({ pressed }) => [...cellStyle, pressed && styles.pressed]}
          >
            {body}
          </Pressable>
        ) : (
          <View
            key={item.label}
            style={cellStyle}
            accessible
            accessibilityLabel={`${item.label}: ${item.value}`}
          >
            {body}
          </View>
        );
      })}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", paddingVertical: 14 },
  stripCell: { flex: 1, paddingHorizontal: spacing.sm, alignItems: "center", gap: 2 },
  stripDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: glass.border.profileElevated,
  },
  stripValue: { color: textTokens.primary, fontSize: 20, fontWeight: "800" },
  stripLabel: { color: textTokens.secondary, fontSize: 12, textAlign: "center" },
  pressed: { opacity: 0.85 },
});
