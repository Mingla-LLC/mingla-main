import React, { useRef, useState } from "react";
import { View, Text, TextInput, ScrollView, StyleSheet, Animated } from "react-native";
import { useTranslation } from "react-i18next";
import WizardChrome from "./WizardChrome";
import { colors, spacing, radius, fontWeights, surface, border } from "../../constants/designSystem";

interface NameStepProps {
  initialFirstName?: string;
  initialLastName?: string;
  onContinue: (firstName: string, lastName: string) => void;
  onBack: () => void;
}

export default function NameStep({
  initialFirstName = "",
  initialLastName = "",
  onContinue,
  onBack,
}: NameStepProps): React.JSX.Element {
  const { t } = useTranslation(["onboarding"]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const [firstName, setFirstName] = useState(initialFirstName);
  const [lastName, setLastName] = useState(initialLastName);
  const [firstTouched, setFirstTouched] = useState(false);
  const [lastTouched, setLastTouched] = useState(false);

  const trimmedFirst = firstName.trim();
  const trimmedLast = lastName.trim();
  const isValid = trimmedFirst.length >= 1 && trimmedLast.length >= 1;

  return (
    <WizardChrome
      currentStep={2}
      totalSteps={4}
      onBack={onBack}
      onContinue={() => onContinue(trimmedFirst, trimmedLast)}
      continueDisabled={!isValid}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.title}>{t("onboarding:name.title")}</Text>
        <Text style={styles.subtitle}>{t("onboarding:name.subtitle")}</Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t("onboarding:name.first_name")}</Text>
          <TextInput
            style={[
              styles.input,
              firstTouched && trimmedFirst.length === 0 && styles.inputError,
            ]}
            value={firstName}
            onChangeText={setFirstName}
            onBlur={() => setFirstTouched(true)}
            placeholder={t("onboarding:name.first_placeholder")}
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="words"
            autoComplete="given-name"
            returnKeyType="next"
            maxLength={50}
            accessibilityLabel={t("onboarding:name.first_name")}
          />
          {firstTouched && trimmedFirst.length === 0 && (
            <Text style={styles.errorText}>{t("onboarding:name.required")}</Text>
          )}
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>{t("onboarding:name.last_name")}</Text>
          <TextInput
            style={[
              styles.input,
              lastTouched && trimmedLast.length === 0 && styles.inputError,
            ]}
            value={lastName}
            onChangeText={setLastName}
            onBlur={() => setLastTouched(true)}
            placeholder={t("onboarding:name.last_placeholder")}
            placeholderTextColor={colors.text.tertiary}
            autoCapitalize="words"
            autoComplete="family-name"
            returnKeyType="done"
            maxLength={50}
            accessibilityLabel={t("onboarding:name.last_name")}
          />
          {lastTouched && trimmedLast.length === 0 && (
            <Text style={styles.errorText}>{t("onboarding:name.required")}</Text>
          )}
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
  fieldGroup: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
    marginBottom: 6,
  },
  input: {
    height: 48,
    backgroundColor: surface.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.text.primary,
  },
  inputError: {
    borderColor: colors.error[500],
    borderWidth: 2,
  },
  errorText: {
    fontSize: 12,
    color: colors.error[500],
    marginTop: 4,
  },
});
