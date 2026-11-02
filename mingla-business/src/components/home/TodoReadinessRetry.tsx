/**
 * TodoReadinessRetry — #3355 P5 "Try again" beside the to-do row that says the
 * canonical brand readiness read failed. Re-reads it from the server; never
 * guesses rows in the meantime (Constitution #3 / #9).
 */
import React, { useCallback } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  accent,
  radius,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { brandReadinessKeys } from "../../hooks/brandReadinessKeys";

export interface TodoReadinessRetryProps {
  brandId: string;
  testID?: string;
}

export const TodoReadinessRetry: React.FC<TodoReadinessRetryProps> = ({
  brandId,
  testID,
}) => {
  const queryClient = useQueryClient();
  const handleRetry = useCallback((): void => {
    void queryClient.invalidateQueries({
      queryKey: brandReadinessKeys.brand(brandId),
    });
  }, [queryClient, brandId]);
  return (
    <Pressable
      onPress={handleRetry}
      accessibilityRole="button"
      accessibilityLabel="Try checking your brand setup again"
      style={styles.control}
      testID={testID}
    >
      <Text style={styles.controlText}>Try again</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  control: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  controlText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
});

export default TodoReadinessRetry;
