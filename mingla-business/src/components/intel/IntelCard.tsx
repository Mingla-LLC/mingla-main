import React from "react";
import { StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { spacing } from "../../constants/designSystem";
import { GlassCard } from "../ui/GlassCard";

export interface IntelCardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export const IntelCard: React.FC<IntelCardProps> = ({
  children,
  style,
  testID,
  accessibilityLabel,
}) => (
  <GlassCard
    variant="base"
    radius="lg"
    padding={spacing.md}
    style={style}
    contentStyle={styles.content}
    testID={testID}
  >
    <View accessible accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  </GlassCard>
);

const styles = StyleSheet.create({
  content: { gap: spacing.sm },
});
