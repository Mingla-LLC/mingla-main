/**
 * Ve2 — inline pool match comparison card ("Is this you?").
 *
 * [TRANSITIONAL] ORCH-1263 superseded this card with ClaimMatchCard (the
 * DESIGN §4 evolution — photo strip, presence facts, blocked-at-the-gate
 * variants); no live call site imports PoolMatchCard anymore. The file is
 * retained ONLY because the pinned append-only suite
 * `src/services/__tests__/ve2PoolMatchFlow.test.ts` reads this source path.
 * Exit condition: a [TEST-MOD-APPROVED] ORCH retires that pinned read, then
 * this file is deleted.
 */

import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import {
  color,
  radius,
  space,
  type,
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
    <GlassCard variant="elevated" padding={space[4]} testID={testID}>
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
    fontSize: type.caption.fontSize,
    color: color.text2,
    marginBottom: space[2],
  },
  row: {
    flexDirection: "row",
    gap: space[4],
    marginBottom: space[4],
  },
  photo: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: color.fill.tile,
  },
  photoPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: radius.sm,
    backgroundColor: color.fill.tile,
  },
  textCol: {
    flex: 1,
    gap: space[1],
  },
  name: {
    fontSize: type.body.fontSize,
    fontWeight: "700",
    color: color.text1,
  },
  address: {
    fontSize: type.small.fontSize,
    color: color.text2,
  },
  prompt: {
    fontSize: type.small.fontSize,
    fontWeight: "600",
    color: color.text1,
    marginTop: space[1],
  },
  actions: {
    gap: space[2],
  },
});
