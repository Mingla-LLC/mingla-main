/**
 * EmbeddedEventChips — visualises events the operator has inserted into the
 * campaign body. The body still carries the raw `{{event:<uuid>}}` token
 * (that's what the server-side renderer reads at send time), but this row
 * gives the operator a friendly chip per event with a remove ×.
 *
 * Tapping remove fires `onRemove(eventId)` — the parent composer then
 * strips the matching token from the body string and drops the id from
 * `embedded_events`.
 *
 * No-events state: returns `null` so the parent's spacing collapses
 * naturally — no empty placeholder card.
 */

import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface EmbeddedEventDetail {
  id: string;
  title: string;
  date_label?: string | null;
}

export interface EmbeddedEventChipsProps {
  events: ReadonlyArray<EmbeddedEventDetail>;
  onRemove: (eventId: string) => void;
}

export const EmbeddedEventChips: React.FC<EmbeddedEventChipsProps> = ({
  events,
  onRemove,
}) => {
  if (events.length === 0) return null;
  return (
    <View style={styles.host}>
      <Text style={styles.label}>
        EMBEDDED CARDS · {events.length}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.scroll}
        contentContainerStyle={styles.row}
        keyboardShouldPersistTaps="handled"
      >
        {events.map((event) => (
          <View key={event.id} style={styles.chip}>
            <View style={styles.chipBody}>
              <Text style={styles.chipTitle} numberOfLines={1}>
                {event.title}
              </Text>
              {event.date_label !== null && event.date_label !== undefined && event.date_label.length > 0 ? (
                <Text style={styles.chipDate} numberOfLines={1}>
                  {event.date_label}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => onRemove(event.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${event.title} card from the email`}
              hitSlop={8}
              style={({ pressed }) => [
                styles.removeBtn,
                pressed ? styles.removeBtnPressed : null,
              ]}
            >
              <Text style={styles.removeBtnLabel}>×</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.xs,
  },
  label: {
    ...typography.labelCap,
    color: textTokens.tertiary,
    fontSize: 11,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: "row",
    gap: spacing.xs,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingLeft: spacing.md,
    paddingRight: 6,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
    maxWidth: 220,
  },
  chipBody: {
    gap: 2,
    flexShrink: 1,
  },
  chipTitle: {
    ...typography.bodySm,
    color: textTokens.primary,
    fontWeight: "600",
  },
  chipDate: {
    ...typography.bodySm,
    color: textTokens.secondary,
    fontSize: 11,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.06)",
  },
  removeBtnPressed: {
    opacity: 0.6,
  },
  removeBtnLabel: {
    ...typography.body,
    color: textTokens.primary,
    fontWeight: "700",
    fontSize: 18,
    lineHeight: 18,
    marginTop: -2,
  },
});
