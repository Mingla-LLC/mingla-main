/**
 * ORCH-0881 — Review stack for menu-snap pending experiences + bulk accept.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import {
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
}

export const ExperienceReviewCards: React.FC<ExperienceReviewCardsProps> = ({
  pending,
  isExecuting,
  onAccept,
  onReject,
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
        <Text style={styles.heading}>Suggested experiences</Text>
      </View>
      <Text style={styles.helper}>
        AI drafted these from your menu or activities. Add a date and price to publish each
        one.
      </Text>
      {pending.map((row) => (
        <ExperienceConfirmationCard
          key={row.id}
          args={row.tool_args}
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
  helper: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
    marginBottom: spacing.md,
  },
});
