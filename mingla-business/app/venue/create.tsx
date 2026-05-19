/**
 * Ve1+Ve2 — physical venue onboarding: pool match → category (optional) → wizard.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import { PoolMatchCard } from "../../src/components/brand/PoolMatchCard";
import { VenueCategoryPicker } from "../../src/components/brand/VenueCategoryPicker";
import { VenueCreatorWizard } from "../../src/components/venue/VenueCreatorWizard";
import { Button } from "../../src/components/ui/Button";
import { Icon } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Input } from "../../src/components/ui/Input";
import { usePoolMatchSearch } from "../../src/hooks/usePoolMatchSearch";
import { useDraftVenueStore } from "../../src/store/draftVenueStore";
import { prefillDraftFromPoolMatch } from "../../src/utils/prefillDraftFromPoolMatch";
import { slugifyBrandSlug } from "../../src/utils/brandSlugify";
import type { VenueCategory } from "../../src/types/brand";

type Phase = "gate" | "category" | "wizard" | "success";

function resolveInitialPhase(
  fromPoolParam: boolean,
): Phase {
  const st = useDraftVenueStore.getState();
  if (fromPoolParam || st.placePoolId !== null) {
    return "wizard";
  }
  if (st.workingName.trim().length >= 2 && st.venueCategory !== null) {
    return "wizard";
  }
  if (st.workingName.trim().length >= 2) {
    return "category";
  }
  return "gate";
}

export default function VenueCreateRoute(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ pool?: string }>();
  const fromPoolParam = params.pool === "1";
  const insets = useSafeAreaInsets();
  const { user, isAuthReady } = useAuth();
  const reset = useDraftVenueStore((s) => s.reset);
  const patch = useDraftVenueStore((s) => s.patch);
  const workingName = useDraftVenueStore((s) => s.workingName);
  const placePoolId = useDraftVenueStore((s) => s.placePoolId);
  const venueCategory = useDraftVenueStore((s) => s.venueCategory);

  const [phase, setPhase] = useState<Phase>(() =>
    resolveInitialPhase(fromPoolParam),
  );
  const [poolNote, setPoolNote] = useState<string | null>(null);
  const [coverWarning, setCoverWarning] = useState<string | null>(null);

  const {
    match: poolMatch,
    loading: poolSearchLoading,
    error: poolSearchError,
  } = usePoolMatchSearch(phase === "gate" ? workingName : "");

  useEffect(() => {
    if (fromPoolParam || useDraftVenueStore.getState().placePoolId !== null) {
      return;
    }
    if (useDraftVenueStore.getState().workingName.trim().length > 0) {
      return;
    }
    reset();
    setPhase("gate");
    setPoolNote(null);
  }, [fromPoolParam, reset]);

  useEffect(() => {
    if (!isAuthReady) return;
    if (user === null) {
      router.replace("/(tabs)/home" as never);
    }
  }, [isAuthReady, router, user]);

  const handleClose = useCallback((): void => {
    router.back();
  }, [router]);

  const goToCategory = useCallback((): void => {
    const n = workingName.trim();
    if (n.length < 2) {
      setPoolNote("Enter at least 2 characters.");
      return;
    }
    setPoolNote(null);
    patch({
      displayName: n,
      slug: slugifyBrandSlug(n),
      placePoolId: null,
    });
    setPhase("category");
  }, [patch, workingName]);

  const goToWizardFromPool = useCallback(
    (match: NonNullable<typeof poolMatch>): void => {
      patch(prefillDraftFromPoolMatch(match));
      setPoolNote(null);
      setPhase("wizard");
    },
    [patch],
  );

  const handleGateContinue = useCallback((): void => {
    if (poolMatch !== null) {
      setPoolNote("Tap Yes on the match card, or No to enter details manually.");
      return;
    }
    goToCategory();
  }, [goToCategory, poolMatch]);

  const handleCategoryContinue = useCallback((): void => {
    if (venueCategory === null) return;
    setPhase("wizard");
  }, [venueCategory]);

  if (!isAuthReady || user === null) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  if (phase === "wizard") {
    return (
      <VenueCreatorWizard
        onClose={handleClose}
        onDone={(warning) => {
          setCoverWarning(warning ?? null);
          setPhase("success");
        }}
      />
    );
  }

  if (phase === "success") {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingHorizontal: spacing.lg }]}>
        <View style={styles.successInner}>
          <Text style={styles.successTitle}>Thanks — you’re in the queue</Text>
          <Text style={styles.successBody}>
            Pending review. We usually approve venues within 4 business hours.
          </Text>
          {coverWarning !== null ? (
            <Text style={styles.successWarning}>{coverWarning}</Text>
          ) : null}
          <Button
            label="Done"
            variant="primary"
            size="lg"
            onPress={() => router.replace("/(tabs)/home" as never)}
          />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.chrome}>
        <IconChrome
          icon="chevL"
          accessibilityLabel="Back"
          onPress={handleClose}
        />
        <Text style={styles.chromeTitle}>Add a venue</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.section}
        keyboardShouldPersistTaps="handled"
      >
        {phase === "gate" ? (
          <>
            <Text style={styles.h1}>What’s your venue called?</Text>
            <Text style={styles.sub}>
              We’ll check our directory so we can prefill your listing when we know you.
            </Text>
            <Input
              variant="text"
              value={workingName}
              onChangeText={(t) => patch({ workingName: t, placePoolId: null })}
              placeholder="Venue name"
              accessibilityLabel="Venue working name"
            />
            {poolSearchLoading ? (
              <Text style={styles.hint}>Searching our directory…</Text>
            ) : null}
            {poolSearchError !== null ? (
              <Text style={styles.warn}>{poolSearchError}</Text>
            ) : null}
            {poolMatch !== null && placePoolId === null ? (
              <PoolMatchCard
                match={poolMatch}
                onYes={() => goToWizardFromPool(poolMatch)}
                onNo={goToCategory}
                onSkip={goToCategory}
              />
            ) : null}
            {poolNote !== null ? <Text style={styles.warn}>{poolNote}</Text> : null}
            <Button
              label="Continue without a match"
              variant="primary"
              size="lg"
              onPress={handleGateContinue}
            />
          </>
        ) : (
          <>
            <Pressable
              onPress={() => setPhase("gate")}
              style={styles.backRow}
              accessibilityRole="button"
              accessibilityLabel="Back to venue name"
            >
              <Icon name="chevL" size={18} color={textTokens.tertiary} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
            <Text style={styles.h1}>What kind of place is it?</Text>
            <VenueCategoryPicker
              value={venueCategory}
              onChange={(v: VenueCategory) => patch({ venueCategory: v })}
              testID="venue-category-picker"
            />
            <Button
              label="Continue"
              variant="primary"
              size="lg"
              disabled={venueCategory === null}
              onPress={handleCategoryContinue}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chromeTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  scroll: {
    flex: 1,
  },
  section: {
    flexGrow: 1,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  h1: {
    fontSize: typography.h3.fontSize,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  sub: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  hint: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  warn: {
    fontSize: typography.caption.fontSize,
    color: "#F59E0B",
  },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  backText: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
  },
  successInner: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  successTitle: {
    fontSize: typography.h3.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  successBody: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
    lineHeight: 22,
  },
  successWarning: {
    fontSize: typography.body.fontSize,
    color: textTokens.secondary,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
});
