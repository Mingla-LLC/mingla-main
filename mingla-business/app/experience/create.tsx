import React, { useCallback } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";

import { ExperienceCreatorWizard } from "../../src/components/experience/ExperienceCreatorWizard";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";

export default function ExperienceCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();

  const handleExit = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  }, [router]);

  const handleComplete = useCallback(
    (_newExperienceId: string): void => {
      router.replace("/(tabs)/hub/experiences" as never);
    },
    [router],
  );

  if (currentBrand === null) {
    return (
      <SafeScreen style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.body}>Loading brand…</Text>
      </SafeScreen>
    );
  }

  return (
    <SafeScreen style={styles.host}>
      <ExperienceCreatorWizard
        brandId={currentBrand.id}
        onComplete={handleComplete}
        onCancel={handleExit}
      />
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: canvas.discover,
  },
  body: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
  },
});
