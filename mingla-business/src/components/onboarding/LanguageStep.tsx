import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Animated,
} from "react-native";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import * as Localization from "expo-localization";
import { useTranslation } from "react-i18next";
import i18n, { persistLanguage } from "../../i18n";
import WizardChrome from "./WizardChrome";
import { colors, spacing, radius, fontWeights, surface, border } from "../../constants/designSystem";

const LANGUAGES = [
  { code: "en", name: "English", native: "English", flag: "🇺🇸" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸" },
] as const;

interface LanguageStepProps {
  onContinue: (languageCode: string) => void;
}

export default function LanguageStep({
  onContinue,
}: LanguageStepProps): React.JSX.Element {
  const { t } = useTranslation(["onboarding"]);
  const deviceLocale = Localization.getLocales()[0]?.languageCode ?? "en";
  const defaultLang = LANGUAGES.find((l) => l.code === deviceLocale)?.code ?? "en";
  const [selected, setSelected] = useState<string>(defaultLang);

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const handleSelect = (code: string): void => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(code);
    i18n.changeLanguage(code);
    persistLanguage(code);
  };

  return (
    <WizardChrome
      currentStep={1}
      totalSteps={4}
      onContinue={() => onContinue(selected)}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.title}>{t("onboarding:language.title")}</Text>
        <Text style={styles.subtitle}>
          {t("onboarding:language.subtitle")}
        </Text>

        <View style={styles.list}>
          {LANGUAGES.map((lang) => {
            const isSelected = selected === lang.code;
            return (
              <TouchableOpacity
                key={lang.code}
                style={[styles.card, isSelected && styles.cardSelected]}
                onPress={() => handleSelect(lang.code)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`${lang.name}, ${lang.native}`}
              >
                <Text style={styles.flag}>{lang.flag}</Text>
                <View style={styles.cardText}>
                  <Text style={styles.langName}>{lang.native}</Text>
                  <Text style={styles.langSub}>{lang.name}</Text>
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
        </Animated.View>
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
    minHeight: 72,
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
  flag: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  cardText: {
    flex: 1,
  },
  langName: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  langSub: {
    fontSize: 14,
    color: colors.text.tertiary,
    marginTop: 2,
  },
});
