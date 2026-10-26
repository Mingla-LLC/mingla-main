import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

interface PurchaseEmptyStateProps {
  period: "upcoming" | "past";
}

export function PurchaseEmptyState({ period }: PurchaseEmptyStateProps): React.ReactElement {
  const { t } = useTranslation("purchases");
  return (
    <View style={styles.card}>
      <Text style={styles.title}>
        {t(`empty.${period}.title`)}
      </Text>
      <Text style={styles.body}>
        {t(`empty.${period}.body`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "#171a20",
    paddingHorizontal: 28,
    paddingVertical: 40,
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  body: {
    maxWidth: 320,
    color: "rgba(255,255,255,0.58)",
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    marginTop: 8,
  },
});
