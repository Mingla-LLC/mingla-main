/**
 * ORCH-0881 — Accept / edit / reject card for a proposed experience.
 */

import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import {
  accent,
  glass,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassChrome } from "../ui/GlassChrome";

export interface ExperienceConfirmationCardProps {
  args: Record<string, unknown>;
  isExecuting: boolean;
  onAccept: (editedArgs?: Record<string, unknown>) => void;
  onReject: () => void;
}

function formatCapacity(args: Record<string, unknown>): string | null {
  const min = args.capacity_min;
  const max = args.capacity_max;
  if (typeof min === "number" && typeof max === "number" && min > 0 && max > 0) {
    if (min === max) return `Up to ${max} people`;
    return `${min}–${max} people`;
  }
  if (typeof max === "number" && max > 0) {
    return `Up to ${max} people`;
  }
  if (typeof min === "number" && min > 0) {
    return `From ${min} people`;
  }
  return null;
}

function formatPriceRange(args: Record<string, unknown>): string | null {
  const min = args.suggested_price_min_cents;
  const max = args.suggested_price_max_cents;
  const currency = typeof args.currency === "string" ? args.currency : "GBP";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : `${currency} `;
  if (typeof min === "number" && typeof max === "number" && min > 0 && max > 0) {
    return `${symbol}${(min / 100).toFixed(0)}–${symbol}${(max / 100).toFixed(0)} per head`;
  }
  if (typeof max === "number" && max > 0) {
    return `Up to ${symbol}${(max / 100).toFixed(0)} per head`;
  }
  return null;
}

export const ExperienceConfirmationCard: React.FC<ExperienceConfirmationCardProps> = ({
  args,
  isExecuting,
  onAccept,
  onReject,
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(String(args.title ?? ""));
  const [narrative, setNarrative] = useState(String(args.narrative ?? ""));

  const intentTags = useMemo(() => {
    const raw = args.intent_tags;
    if (!Array.isArray(raw)) return [];
    return raw.filter((t): t is string => typeof t === "string");
  }, [args.intent_tags]);

  const priceLabel = formatPriceRange(args);
  const capacityLabel = formatCapacity(args);
  const timeOfDay =
    typeof args.suggested_time_of_day === "string" && args.suggested_time_of_day.trim()
      ? args.suggested_time_of_day.trim()
      : null;

  const buildEditedArgs = (): Record<string, unknown> => ({
    ...args,
    title: title.trim(),
    narrative: narrative.trim(),
  });

  return (
    <GlassChrome
      intensity="cardElevated"
      tintColor={glass.tint.profileElevated}
      borderColor={glass.border.profileBase}
      radius="lg"
      style={styles.card}
    >
      <View style={styles.inner} accessibilityRole="summary">
        <Text style={styles.verb}>PROPOSED EXPERIENCE</Text>
        {editing ? (
          <>
            <TextInput
              style={styles.inputTitle}
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Experience title"
            />
            <TextInput
              style={styles.inputBody}
              value={narrative}
              onChangeText={setNarrative}
              multiline
              accessibilityLabel="Experience description"
            />
          </>
        ) : (
          <>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.narrative}>{narrative}</Text>
          </>
        )}
        {capacityLabel !== null && (
          <Text style={styles.meta}>{capacityLabel}</Text>
        )}
        {timeOfDay !== null && (
          <Text style={styles.meta}>{timeOfDay}</Text>
        )}
        {priceLabel !== null && (
          <Text style={styles.meta}>{priceLabel}</Text>
        )}
        {intentTags.length > 0 && (
          <Text style={styles.tags}>{intentTags.join(" · ")}</Text>
        )}
        <View style={styles.actions}>
          <Pressable
            onPress={onReject}
            disabled={isExecuting}
            style={({ pressed }) => [styles.btn, styles.rejectBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Reject experience"
          >
            <Text style={styles.rejectText}>Reject</Text>
          </Pressable>
          <Pressable
            onPress={() => setEditing((e) => !e)}
            disabled={isExecuting}
            style={({ pressed }) => [styles.btn, styles.editBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={editing ? "Done editing" : "Edit experience"}
          >
            <Text style={styles.editText}>{editing ? "Done" : "Edit"}</Text>
          </Pressable>
          <Pressable
            onPress={() => onAccept(editing ? buildEditedArgs() : undefined)}
            disabled={isExecuting}
            style={({ pressed }) => [styles.btn, styles.acceptBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Accept experience"
          >
            <Text style={styles.acceptText}>{isExecuting ? "Saving…" : "Accept"}</Text>
          </Pressable>
        </View>
      </View>
    </GlassChrome>
  );
};

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  inner: { padding: spacing.md },
  verb: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 1,
    color: textTokens.tertiary,
  },
  title: {
    marginTop: spacing.sm,
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  narrative: {
    marginTop: spacing.xs,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  inputTitle: {
    marginTop: spacing.sm,
    fontSize: typography.h3.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: glass.border.profileBase,
    paddingVertical: spacing.xs,
  },
  inputBody: {
    marginTop: spacing.sm,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.primary,
    minHeight: 72,
    textAlignVertical: "top",
  },
  meta: {
    marginTop: spacing.sm,
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
  },
  tags: {
    marginTop: 4,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  actions: {
    marginTop: spacing.md,
    flexDirection: "row",
    gap: spacing.xs,
  },
  btn: {
    flex: 1,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectBtn: {
    borderWidth: 1,
    borderColor: glass.border.chrome,
  },
  editBtn: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  acceptBtn: {
    flex: 1.4,
    backgroundColor: accent.warm,
  },
  rejectText: { color: textTokens.secondary, fontWeight: "500" },
  editText: { color: textTokens.primary, fontWeight: "500" },
  acceptText: { color: textTokens.inverse, fontWeight: "600" },
  pressed: { opacity: 0.85 },
});
