/**
 * META-ORCH-1009 Sub-E — Step 3 explains the canonical CoverPicker handoff.
 */

import React from "react";
import {
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";

export interface VenueStep3PhotosProps {
  showErrors: boolean;
}

export const VenueStep3Photos: React.FC<VenueStep3PhotosProps> = ({
  showErrors: _showErrors,
}) => {
  return (
    <View style={styles.host}>
      <Text style={styles.title}>Hero cover</Text>
      <Text style={styles.helper}>
        You’ll add your cover right after you submit — the same photo/video
        picker used everywhere else in Mingla, so everything goes through one
        trusted upload pipeline.
      </Text>
      <GlassCard variant="elevated" padding={spacing.md}>
        <Text style={styles.cardTitle}>Next: add your cover</Text>
        <Text style={styles.cardBody}>
          After you submit, the deck-readiness screen opens the cover picker so
          you can add a hero photo or short video, answer the readiness
          questions, and confirm your AI-written venue bio before it goes public.
        </Text>
      </GlassCard>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  helper: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
  cardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
    marginBottom: spacing.xs,
  },
  cardBody: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    lineHeight: 20,
  },
});

export default VenueStep3Photos;
