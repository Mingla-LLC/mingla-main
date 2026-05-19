/**
 * Ve2 — inline pool match comparison card ("Is this you?").
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { PoolMatch } from "../../types/poolMatch";
import { Button } from "../ui/Button";
import { GlassCard } from "../ui/GlassCard";

export interface PoolMatchCardProps {
  match: PoolMatch;
  onYes: () => void;
  onNo: () => void;
  onSkip: () => void;
  testID?: string;
}

export const PoolMatchCard: React.FC<PoolMatchCardProps> = ({
  match,
  onYes,
  onNo,
  onSkip,
  testID = "pool-match-card",
}) => {
  const addressLine = [match.address, match.city].filter(Boolean).join(", ");

  return (
    <GlassCard variant="elevated" padding={spacing.md} testID={testID}>
      <Text style={styles.eyebrow}>We found a match in our directory</Text>
      <View style={styles.row}>
        {match.primaryPhotoUrl !== null ? (
          <Image
            source={{ uri: match.primaryPhotoUrl }}
            style={styles.photo}
            accessibilityLabel={`Photo of ${match.name}`}
          />
        ) : (
          <View style={styles.photoPlaceholder} />
        )}
        <View style={styles.textCol}>
          <Text style={styles.name} numberOfLines={2}>
            {match.name}
          </Text>
          {addressLine.length > 0 ? (
            <Text style={styles.address} numberOfLines={2}>
              {addressLine}
            </Text>
          ) : null}
          <Text style={styles.prompt}>Is this you?</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          label="Yes, this is me"
          variant="primary"
          size="md"
          onPress={onYes}
          testID="pool-match-yes"
        />
        <Button
          label="No, different business"
          variant="secondary"
          size="md"
          onPress={onNo}
          testID="pool-match-no"
        />
        <Button
          label="Skip — create from scratch"
          variant="ghost"
          size="sm"
          onPress={onSkip}
          testID="pool-match-skip"
        />
      </View>
    </GlassCard>
  );
};

const styles = StyleSheet.create({
  eyebrow: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: radiusTokens.md,
    backgroundColor: "#E5E7EB",
  },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: radiusTokens.md,
    backgroundColor: "#E5E7EB",
  },
  textCol: {
    flex: 1,
    gap: spacing.xs,
  },
  name: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  address: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  prompt: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: accent.warm,
    marginTop: spacing.xs,
  },
  actions: {
    gap: spacing.sm,
  },
});
