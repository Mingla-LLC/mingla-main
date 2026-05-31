/**
 * META-ORCH-1009 Sub-E — Hub coaching loop for venue deck readiness.
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { BrandPlacePipelineState } from "../../services/businessPlaceAuthoringService";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

const FIX_LABELS: Record<string, string> = {
  edit_address: "Open venue basics",
  edit_website: "Add website",
  edit_hours: "Add hours",
  edit_cover: "Add photos",
  confirm_ai_outputs: "Review your story",
  review_pipeline: "Review setup",
};

export interface DeckReadinessCardProps {
  state: BrandPlacePipelineState;
  onFix: (fix: string) => void;
}

export const DeckReadinessCard: React.FC<DeckReadinessCardProps> = ({
  state,
  onFix,
}) => {
  const primary = state.coaching[0] ?? null;
  const title = useMemo((): string => {
    if (state.status === "deck_eligible") return "Venue deck-ready";
    if (primary !== null) return primary.title;
    if (state.status === "processing") return "Preparing your venue for the deck";
    return "Why you're not in the deck yet";
  }, [primary, state.status]);
  const body = useMemo((): string => {
    if (state.status === "deck_eligible") {
      return "Your venue passed the current deck-readiness checks.";
    }
    if (primary !== null) return primary.body;
    return "Finish the setup tasks so Mingla can safely recommend this venue.";
  }, [primary, state.status]);
  const fix = primary?.fix ?? "review_pipeline";

  return (
    <GlassCard variant="elevated" padding={spacing.lg}>
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>Deck readiness</Text>
        <Text style={styles.status}>{state.status.replace("_", " ")}</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {state.status !== "deck_eligible" ? (
        <View style={styles.ctaRow}>
          <Button
            label={FIX_LABELS[fix] ?? "Review setup"}
            variant="secondary"
            size="md"
            leadingIcon="sparkle"
            onPress={() => onFix(fix)}
          />
        </View>
      ) : null}
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontSize: typography.caption.fontSize,
    color: accent.warm,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  status: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  title: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  body: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: 20,
    color: textTokens.secondary,
  },
  ctaRow: {
    alignItems: "flex-start",
    marginTop: spacing.md,
  },
});

export default DeckReadinessCard;
