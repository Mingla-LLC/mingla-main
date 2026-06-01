/**
 * NoVenueDeckEntryCard — META-ORCH-1009 Sub-E (Job A: discoverability fix).
 *
 * Always-available Home entry that guides a brand with NO authored/claimed
 * venue into the deck-readiness funnel. Renders only when the brand's place
 * pipeline state has loaded and is empty (no venue yet) — the gap left by
 * <DeckReadinessCard>, which renders only once a venue exists and its status
 * is past "draft". One-tap routes to /venue/create (VenueCreatorWizard).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

export interface NoVenueDeckEntryCardProps {
  onPress: () => void;
  /**
   * META-ORCH-1009 Sub-E: true when a persisted venue draft is in progress (the
   * operator started the wizard but hasn't submitted). The card then offers to
   * RESUME rather than start fresh, so "continue where you left off" is reachable
   * from Home after a refresh — not just by re-opening the wizard.
   */
  resumable?: boolean;
}

export const NoVenueDeckEntryCard: React.FC<NoVenueDeckEntryCardProps> = ({
  onPress,
  resumable = false,
}) => {
  return (
    <GlassCard variant="elevated" padding={spacing.lg}>
      <Text style={styles.eyebrow}>Get discovered</Text>
      <Text style={styles.title}>
        {resumable ? "Finish adding your venue" : "Get your venue into the deck"}
      </Text>
      <Text style={styles.body}>
        {resumable
          ? "You have a venue setup in progress. Pick up right where you left off — we kept your details."
          : "Add your venue so Mingla can recommend it to people deciding where to go. We'll build your story and check deck readiness for you."}
      </Text>
      <View style={styles.ctaRow}>
        <Button
          label={resumable ? "Continue your venue" : "Add your venue"}
          variant="primary"
          size="md"
          leadingIcon="sparkle"
          onPress={onPress}
          accessibilityLabel={
            resumable
              ? "Continue your in-progress venue setup"
              : "Add your venue to get into the deck"
          }
          testID="no-venue-deck-entry-cta"
        />
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: typography.caption.fontSize,
    color: accent.warm,
    fontWeight: "700",
    textTransform: "uppercase",
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

export default NoVenueDeckEntryCard;
