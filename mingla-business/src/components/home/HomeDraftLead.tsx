/**
 * #4304 part 3 — State C Home: the newest event/RSVP draft leads Home's
 * content with "Finish draft". Rendered only when a draft exists.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";

export interface HomeLeadDraft {
  title: string;
  onFinish: () => void;
}

export function HomeDraftLead({
  draft,
}: {
  draft: HomeLeadDraft;
}): React.ReactElement {
  return (
    <View style={styles.draftCard} testID="home-lead-draft">
      <Text style={styles.draftEyebrow}>Draft</Text>
      <Text style={styles.draftTitle} numberOfLines={2}>
        {draft.title}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Finish draft ${draft.title}`}
        onPress={draft.onFinish}
        style={({ pressed }) => [styles.finish, pressed && styles.pressed]}
        testID="home-lead-finish-draft"
      >
        <Text style={styles.finishLabel}>Finish draft</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  draftCard: {
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: accent.border,
    backgroundColor: "rgba(17, 20, 24, 0.92)",
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  draftEyebrow: {
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: textTokens.tertiary,
    fontWeight: "600",
  },
  draftTitle: {
    fontSize: typography.body.fontSize,
    lineHeight: 22,
    fontWeight: "700",
    color: textTokens.primary,
  },
  finish: {
    marginTop: spacing.xs,
    minHeight: 40,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.warm,
    alignItems: "center",
    justifyContent: "center",
  },
  finishLabel: {
    color: "#101216",
    fontWeight: "700",
    fontSize: typography.bodySm.fontSize,
  },
  pressed: { opacity: 0.72 },
});
