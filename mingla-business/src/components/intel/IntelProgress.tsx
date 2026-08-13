import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import {
  accent,
  spacing,
  text,
  typography,
} from "../../constants/designSystem";
import { Icon } from "../ui/Icon";

const STAGES = [
  "Reading your event details…",
  "Checking demand and competition…",
  "Modeling likely turnout…",
  "Building your forecast…",
] as const;

export const INTEL_RESULT_MIN_HEIGHT = 212;

export const IntelProgress: React.FC = () => {
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const interval = setInterval(
      () => setStage((value) => Math.min(value + 1, STAGES.length - 1)),
      7_500,
    );
    const slowTimer = setTimeout(() => setSlow(true), 30_000);
    return () => {
      clearInterval(interval);
      clearTimeout(slowTimer);
    };
  }, []);
  return (
    <View style={styles.body} testID="turnout-progress">
      {STAGES.map((label, index) => (
        <View key={label} style={styles.row}>
          {index < stage ? (
            <Icon name="check" size={16} color="#22c55e" />
          ) : index === stage ? (
            <ActivityIndicator size="small" color={accent.warm} />
          ) : (
            <View style={styles.pendingDot} />
          )}
          <Text
            style={[
              styles.line,
              index === stage ? styles.current : null,
              index > stage ? styles.pending : null,
            ]}
          >
            {label}
          </Text>
        </View>
      ))}
      {slow ? (
        <Text style={styles.honesty}>
          Still working — live research can take up to a minute.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  body: { minHeight: INTEL_RESULT_MIN_HEIGHT, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  pendingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginHorizontal: 3,
  },
  line: { ...typography.bodySm, color: text.secondary },
  current: { color: text.primary },
  pending: { color: text.quaternary },
  honesty: {
    ...typography.caption,
    color: text.tertiary,
    marginTop: spacing.xs,
  },
});
