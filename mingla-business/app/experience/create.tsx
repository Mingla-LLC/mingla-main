import React, { useCallback } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { isSetupReturn, setupReturnWith } from "../../src/utils/brandEditReturn";
import { useQueryClient } from "@tanstack/react-query";

import { LazyExperienceCreatorWizard } from "../../src/components/experience/LazyExperienceCreatorWizard";
import { SafeScreen } from "../../src/components/ui/SafeScreen";
import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { experienceDetailKeys } from "../../src/hooks/useExperienceDetail";
import { experienceKeys } from "../../src/hooks/useExperiencesByBrand";
import {
  isJustPublishedPending,
  markJustPublished,
} from "../../src/utils/justPublishedSignal";

// #2830 — the way back to Website setup: one on-demand chunk, nothing hoisted.
const LazyCreatorReturnBar = React.lazy(() =>
  import("../../src/components/sites/setup/CreatorReturnBar"),
);

export default function ExperienceCreateRoute(): React.ReactElement {
  const router = useRouter();
  const currentBrand = useCurrentBrand();
  const queryClient = useQueryClient();
  const brandId = currentBrand?.id ?? null;
  // #2830 — Website setup's way back. Anything else behaves as if absent.
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const rawReturnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const setupReturn = isSetupReturn(rawReturnTo) ? (rawReturnTo as string) : null;

  const handleExit = useCallback((): void => {
    if (setupReturn) {
      router.replace(setupReturn as never);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/hub/experiences" as never);
  }, [router, setupReturn]);

  const handleComplete = useCallback(
    (newExperienceId: string): void => {
      // issue #3237 — the wizard writes through RPCs, not a mutation hook, so
      // nothing refreshed the Hub list or the manage screen: a new experience
      // could be missing from the list it just landed on.
      if (brandId !== null) {
        void queryClient.invalidateQueries({
          queryKey: experienceKeys.listByBrand(brandId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: experienceDetailKeys.detail(newExperienceId),
      });
      if (setupReturn) {
        router.replace(setupReturnWith(setupReturn, "experience", newExperienceId) as never);
        return;
      }
      // A PUBLISH lands on the experience's manage screen, which confirms it
      // and offers Share + the public page. A draft save still returns to the
      // Hub list.
      if (isJustPublishedPending(newExperienceId)) {
        router.replace(`/experience/${newExperienceId}` as never);
        return;
      }
      router.replace("/(tabs)/hub/experiences" as never);
    },
    [brandId, queryClient, router, setupReturn],
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
      {setupReturn ? (
        <React.Suspense fallback={null}>
          <LazyCreatorReturnBar onBack={handleExit} />
        </React.Suspense>
      ) : null}
      <React.Suspense fallback={<ActivityIndicator />}>
        <LazyExperienceCreatorWizard
          brandId={currentBrand.id}
          onComplete={handleComplete}
          onPublished={markJustPublished}
          onCancel={handleExit}
        />
      </React.Suspense>
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
