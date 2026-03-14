import React from "react";
import { Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, typography, spacing } from "../../constants/designSystem";

function EmptyDiscussion() {
  return (
    <View style={styles.wrapper}>
      <Ionicons
        name="chatbubbles-outline"
        size={48}
        color={colors.gray[300]}
      />
      <Text style={styles.title}>Start the conversation</Text>
      <Text style={styles.subtitle}>
        Type a message below to get things rolling
      </Text>
    </View>
  );
}

export default EmptyDiscussion;

const styles = StyleSheet.create({
  wrapper: {
    transform: [{ scaleY: -1 }],
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
  },
  title: {
    ...typography.md,
    fontWeight: "600",
    color: colors.gray[500],
    marginTop: 16,
  },
  subtitle: {
    ...typography.sm,
    color: colors.gray[400],
    marginTop: 4,
    textAlign: "center",
  },
});
