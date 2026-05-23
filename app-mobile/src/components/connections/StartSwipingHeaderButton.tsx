import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Icon } from "../ui/Icon";
import { s } from "../../utils/responsive";
import { HapticFeedback } from "../../utils/hapticFeedback";

interface StartSwipingHeaderButtonProps {
  onPress: () => void;
  disabled?: boolean;
}

export function StartSwipingHeaderButton({
  onPress,
  disabled = false,
}: StartSwipingHeaderButtonProps) {
  const { t } = useTranslation(["social"]);

  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        HapticFeedback.medium();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t("social:startSwipingCta")}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      <View style={styles.content}>
        <Icon name="layers-outline" size={15} color="#FFFFFF" />
        <Text style={styles.label} numberOfLines={1}>
          {t("social:startSwipingCta")}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    maxWidth: s(176),
    minHeight: s(34),
    borderRadius: s(17),
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: 1,
    borderColor: "rgba(235, 120, 37, 0.5)",
    justifyContent: "center",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  label: {
    color: "#FFFFFF",
    fontSize: s(13),
    fontWeight: "600",
    flexShrink: 1,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    opacity: 0.5,
  },
});
