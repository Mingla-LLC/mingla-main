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
        We save your venue basics first, then the next screen opens the same
        CoverPicker used everywhere else in Mingla. That keeps photos and video
        in one trusted upload pipeline.
      </Text>
      <GlassCard variant="elevated" padding={spacing.md}>
        <Text style={styles.cardTitle}>Coming next in this session</Text>
        <Text style={styles.cardBody}>
          Add a hero photo or short video, answer the deck-readiness questions,
          and confirm the AI-written venue bio before it goes public.
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
