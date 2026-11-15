import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { color, space, type } from "../../constants/designSystem";
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
            <Icon name="check" size={16} color={color.successText} />
          ) : index === stage ? (
            <ActivityIndicator size="small" color={color.accent} />
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
  body: { minHeight: INTEL_RESULT_MIN_HEIGHT, gap: space[2] },
  row: { flexDirection: "row", alignItems: "center", gap: space[2] },
  pendingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.fill.step,
    marginHorizontal: 3,
  },
  line: { ...type.small, color: color.text2 },
  current: { color: color.text1 },
  pending: { color: color.text4 },
  honesty: {
    ...type.caption,
    color: color.text3,
    marginTop: space[1],
  },
});
