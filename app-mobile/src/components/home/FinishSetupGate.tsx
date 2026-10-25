import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

interface FinishSetupGateProps {
  onContinue: () => void;
}

export function FinishSetupGate({ onContinue }: FinishSetupGateProps): React.ReactElement {
  const { t } = useTranslation("purchases");
  return (
    <View style={styles.host} testID="finish-setup-gate">
      <View style={styles.card}>
        <Text style={styles.eyebrow}>{t("finishSetup.title")}</Text>
        <Text style={styles.title}>{t("finishSetup.homeTitle")}</Text>
        <Text style={styles.body}>{t("finishSetup.homeBody")}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("finishSetup.homeCta")}
          onPress={onContinue}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonText}>{t("finishSetup.homeCta")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#0b0d11",
  },
  card: {
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.12)",
    backgroundColor: "#171a20",
  },
  eyebrow: { color: "#eb7825", fontSize: 11, fontWeight: "800", letterSpacing: 1.3 },
  title: { color: "#ffffff", fontSize: 30, lineHeight: 35, fontWeight: "800", marginTop: 10 },
  body: { color: "rgba(255,255,255,.62)", fontSize: 15, lineHeight: 22, marginTop: 12 },
  button: {
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eb7825",
    marginTop: 24,
  },
  pressed: { opacity: 0.78 },
  buttonText: { color: "#ffffff", fontSize: 16, fontWeight: "800" },
});
