/**
 * #4111 D6 — the organiser row's action group on public event, RSVP, trip and
 * experience pages: Follow and Message side by side in one compact row. With
 * no Message (enquiries off, or not loaded yet) the Follow control renders
 * alone exactly as before.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemePalette } from "@mingla/offering-rendering";

export interface PresentedByActionsProps {
  follow: React.ReactNode;
  brandName: string;
  palette: ThemePalette;
  onMessage?: () => void;
  testID?: string;
}

export function PresentedByActions({
  follow,
  brandName,
  palette,
  onMessage,
  testID = "presented-by-message",
}: PresentedByActionsProps): React.ReactElement {
  if (onMessage === undefined) return <>{follow}</>;
  return (
    <View style={styles.row}>
      <View style={styles.cell}>{follow}</View>
      <Pressable
        onPress={onMessage}
        accessibilityRole="button"
        accessibilityLabel={`Message ${brandName}`}
        testID={testID}
        style={({ pressed }) => [
          styles.cell,
          styles.message,
          { borderColor: palette.accent },
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={[styles.label, { color: palette.primaryText }]}>
          Message
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch", gap: 10 },
  cell: { flex: 1, minWidth: 0 },
  message: {
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  label: { fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.85 },
});
