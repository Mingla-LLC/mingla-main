/**
 * ORCH-0881 — Review stack for menu-snap pending experiences + bulk accept.
 */

import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import type { HubPendingExperienceRow } from "../../services/experienceGenerationService";
import { ExperienceConfirmationCard } from "./ExperienceConfirmationCard";

export interface ExperienceReviewCardsProps {
  pending: HubPendingExperienceRow[];
  isExecuting: boolean;
  onAccept: (id: string, editedArgs?: Record<string, unknown>) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onAcceptAll: () => Promise<void>;
}

export const ExperienceReviewCards: React.FC<ExperienceReviewCardsProps> = ({
  pending,
  isExecuting,
  onAccept,
  onReject,
  onAcceptAll,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleAccept = useCallback(
    async (id: string, editedArgs?: Record<string, unknown>) => {
      setActiveId(id);
      try {
        await onAccept(id, editedArgs);
      } finally {
        setActiveId(null);
      }
    },
    [onAccept],
  );

  const handleReject = useCallback(
    async (id: string) => {
      setActiveId(id);
      try {
        await onReject(id);
      } finally {
        setActiveId(null);
      }
    },
    [onReject],
  );

  if (pending.length === 0) return null;

  return (
    <View style={styles.host}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Review suggested experiences</Text>
        <Pressable
          onPress={() => void onAcceptAll()}
          disabled={isExecuting}
          style={({ pressed }) => [styles.acceptAll, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Accept all suggested experiences"
        >
          <Text style={styles.acceptAllText}>Accept all</Text>
        </Pressable>
      </View>
      {pending.map((row) => (
        <ExperienceConfirmationCard
          key={row.id}
          args={row.tool_args}
          expiresAt={row.expires_at}
          isExecuting={isExecuting && activeId === row.id}
          onAccept={(edited) => void handleAccept(row.id, edited)}
          onReject={() => void handleReject(row.id)}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  host: { marginBottom: spacing.lg },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  heading: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
    flex: 1,
  },
  acceptAll: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.xl,
    backgroundColor: accent.warm,
  },
  acceptAllText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.inverse,
  },
  pressed: { opacity: 0.85 },
});
