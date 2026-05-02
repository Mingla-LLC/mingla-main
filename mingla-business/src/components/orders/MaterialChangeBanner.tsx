/**
 * MaterialChangeBanner — buyer-side banner shown on order detail page
 * when operator made material/destructive edits since the buyer's last
 * acknowledged view.
 *
 * Reads pre-filtered `materialEdits` (severity !== "additive") from
 * `useEventEditLogStore.getEditsForEventSince`. Single-tap "Got it"
 * acknowledges → parent advances `lastSeenEventUpdatedAt`.
 *
 * Per Cycle 9c spec §3.5.2 + Q-9c-6 default A.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { EventEditEntry } from "../../store/eventEditLogStore";

import { Icon } from "../ui/Icon";

export interface MaterialChangeBannerProps {
  /** Pre-filtered (severity !== "additive") + sorted (newest first). */
  materialEdits: EventEditEntry[];
  brandName: string;
  onAcknowledge: () => void;
}

export const MaterialChangeBanner: React.FC<MaterialChangeBannerProps> = ({
  materialEdits,
  brandName,
  onAcknowledge,
}) => {
  if (materialEdits.length === 0) return null;
  const latest = materialEdits[0];
  const heading =
    materialEdits.length === 1
      ? "Event details changed"
      : `Event updated ${materialEdits.length} times since you last viewed`;
  const body =
    materialEdits.length === 1
      ? `${brandName.length > 0 ? brandName : "The organiser"} updated this event.`
      : `${brandName.length > 0 ? brandName : "The organiser"} has made several updates.`;
  return (
    <View style={styles.host}>
      <View style={styles.iconBadge}>
        <Icon name="flag" size={18} color={accent.warm} />
      </View>
      <View style={styles.body}>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.copy}>{body}</Text>
        <Text style={styles.reasonLine} numberOfLines={3}>
          Latest reason: <Text style={styles.reasonText}>"{latest.reason}"</Text>
        </Text>
        <Pressable
          onPress={onAcknowledge}
          accessibilityRole="button"
          accessibilityLabel="Acknowledge update"
          style={({ pressed }) => [
            styles.btn,
            pressed && styles.btnPressed,
          ]}
        >
          <Text style={styles.btnLabel}>Got it</Text>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 4,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
    marginBottom: spacing.md,
  },
  iconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.42)",
    flexShrink: 0,
  },
  body: {
    flex: 1,
    gap: 6,
  },
  heading: {
    fontSize: 14,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.1,
  },
  copy: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
  },
  reasonLine: {
    fontSize: 13,
    lineHeight: 18,
    color: textTokens.secondary,
    fontStyle: "italic",
  },
  reasonText: {
    color: textTokens.primary,
  },
  btn: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radiusTokens.full,
    backgroundColor: "rgba(235, 120, 37, 0.22)",
    borderWidth: 1,
    borderColor: accent.border,
    marginTop: 6,
  },
  btnPressed: {
    opacity: 0.7,
  },
  btnLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: accent.warm,
  },
});

export default MaterialChangeBanner;
