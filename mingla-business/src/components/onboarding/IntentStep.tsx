import React, { useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";
import WizardChrome from "./WizardChrome";
import { colors, spacing, radius, fontWeights, surface, border } from "../../constants/designSystem";

type Intent = "place" | "events" | "both";

const OPTION_IDS: { id: Intent; icon: string; titleKey: string; descKey: string }[] = [
  { id: "place", icon: "location-outline", titleKey: "onboarding:intent.place", descKey: "onboarding:intent.place_desc" },
  { id: "events", icon: "ticket-outline", titleKey: "onboarding:intent.events", descKey: "onboarding:intent.events_desc" },
  { id: "both", icon: "swap-horizontal-outline", titleKey: "onboarding:intent.both", descKey: "onboarding:intent.both_desc" },
];

interface IntentStepProps {
  onContinue: (intent: Intent) => void;
  onBack: () => void;
}

export default function IntentStep({
  onContinue,
  onBack,
}: IntentStepProps): React.JSX.Element {
  const { t } = useTranslation(["onboarding"]);
  const [selected, setSelected] = useState<Intent | null>(null);

  return (
    <WizardChrome
      currentStep={4}
      totalSteps={4}
      onBack={onBack}
      onContinue={() => {
        if (selected) onContinue(selected);
      }}
      continueDisabled={!selected}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>{t("onboarding:intent.title")}</Text>
        <Text style={styles.subtitle}>{t("onboarding:intent.subtitle")}</Text>

        <View style={styles.list}>
          {OPTION_IDS.map((opt) => {
            const isSelected = selected === opt.id;
            const title = t(opt.titleKey);
            const desc = t(opt.descKey);
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSelected(opt.id);
                }}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${title}. ${desc}`}
              >
                <View
                  style={[
                    styles.iconContainer,
                    isSelected && styles.iconContainerSelected,
                  ]}
                >
                  <Ionicons
                    name={opt.icon as keyof typeof Ionicons.glyphMap}
                    size={24}
                    color={isSelected ? colors.primary[500] : colors.gray[400]}
                  />
                </View>
                <View style={styles.cardText}>
                  <Text style={styles.cardTitle}>{title}</Text>
                  <Text style={styles.cardDescription}>{desc}</Text>
                </View>
                {isSelected && (
                  <Ionicons
                    name="checkmark-circle"
                    size={24}
                    color={colors.primary[500]}
                  />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </WizardChrome>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  title: {
    fontSize: 24,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginBottom: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 80,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: surface.card,
    borderWidth: 1.5,
    borderColor: border.default,
    borderRadius: radius.lg,
  },
  cardSelected: {
    backgroundColor: surface.selected,
    borderColor: border.selected,
    borderWidth: 2,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.gray[100],
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  iconContainerSelected: {
    backgroundColor: colors.primary[50],
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  cardDescription: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 2,
  },
});
