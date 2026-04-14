import React, { useState, useCallback } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../src/context/AuthContext";
import { updateCreatorAccount } from "../../src/services/creatorAccount";
import AppRoutes from "../../src/config/routes";
import LanguageStep from "../../src/components/onboarding/LanguageStep";
import NameStep from "../../src/components/onboarding/NameStep";
import PhoneStep from "../../src/components/onboarding/PhoneStep";
import IntentStep from "../../src/components/onboarding/IntentStep";
import { colors } from "../../src/constants/designSystem";

/**
 * Onboarding flow for new business users.
 * 4 steps: Language → Name → Phone OTP → Intent
 * Resumable: uses onboarding_step from creator_accounts to restore position.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const { user, accountStatus, refreshAccountStatus } = useAuth();
  const [step, setStep] = useState<number>(accountStatus?.onboardingStep ?? 0);
  const [saving, setSaving] = useState(false);

  // Extract OAuth name for pre-fill
  const oauthName = user?.user_metadata?.full_name as string | undefined;
  const oauthParts = oauthName?.split(" ") ?? [];
  const oauthFirst = oauthParts[0] ?? "";
  const oauthLast = oauthParts.slice(1).join(" ") ?? "";

  const saveAndAdvance = useCallback(
    async (fields: Record<string, unknown>, nextStep: number) => {
      if (!user) return;
      setSaving(true);
      try {
        await updateCreatorAccount(user.id, {
          ...fields,
          onboarding_step: nextStep,
        });
        setStep(nextStep);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        Alert.alert("Couldn't save", msg);
      } finally {
        setSaving(false);
      }
    },
    [user]
  );

  const completeOnboarding = useCallback(
    async (intent: "place" | "events" | "both") => {
      if (!user) return;
      setSaving(true);
      try {
        await updateCreatorAccount(user.id, {
          intent,
          onboarding_completed: true,
          onboarding_step: 4,
        });
        await refreshAccountStatus();
        router.replace(AppRoutes.home);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Something went wrong";
        Alert.alert("Couldn't save", msg);
      } finally {
        setSaving(false);
      }
    },
    [user, refreshAccountStatus, router]
  );

  if (!user) return null;

  if (saving) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary[500]} />
      </View>
    );
  }

  switch (step) {
    case 0:
      return (
        <LanguageStep
          onContinue={(lang) =>
            saveAndAdvance({ language: lang }, 1)
          }
        />
      );
    case 1:
      return (
        <NameStep
          initialFirstName={oauthFirst}
          initialLastName={oauthLast}
          onBack={() => setStep(0)}
          onContinue={(first, last) =>
            saveAndAdvance(
              {
                first_name: first,
                last_name: last,
                display_name: `${first} ${last}`,
              },
              2
            )
          }
        />
      );
    case 2:
      return (
        <PhoneStep
          onBack={() => setStep(1)}
          onContinue={(phone) =>
            saveAndAdvance({ phone, phone_verified: true }, 3)
          }
        />
      );
    case 3:
      return (
        <IntentStep
          onBack={() => setStep(2)}
          onContinue={completeOnboarding}
        />
      );
    default:
      // If step >= 4, onboarding is done — redirect to dashboard
      router.replace(AppRoutes.home);
      return null;
  }
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background.primary,
  },
});
