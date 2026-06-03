/**
 * Ve1+Ve2 — physical venue onboarding: pool match → category (optional) → wizard.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper (KAS native /
// passthrough web). KeyboardAvoidingView removed. Per SPEC §7.F.
import { ScrollView } from "../../src/wrappers/SmartScrollView";
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

  // META-ORCH-1009 Sub-E: the venue draft is now AsyncStorage-persisted, which
  // hydrates asynchronously. We must NOT read the draft (to pick the resume
  // phase) or run the empty-draft reset below until hydration completes —
  // otherwise a cold start reads defaults and wipes the persisted draft. Mirror
  // the proven event/create.tsx hydration gate.
  const [hydrated, setHydrated] = useState<boolean>(() =>
    useDraftVenueStore.persist.hasHydrated(),
  );
  const phaseResumedRef = useRef(false);

  useEffect(() => {
    if (hydrated) return undefined;
    const unsub = useDraftVenueStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    // Defensive re-check for the rare microtask race between the initial
    // hasHydrated() read and this effect mounting.
    if (useDraftVenueStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);

  // Once hydrated, recompute the resume phase from the now-real persisted draft
  // (the useState initializer ran pre-hydration against defaults).
  useEffect(() => {
    if (!hydrated || phaseResumedRef.current) return;
    phaseResumedRef.current = true;
    setPhase(resolveInitialPhase(fromPoolParam));
  }, [fromPoolParam, hydrated]);

  const {
    matches: poolMatches,
    loading: poolSearchLoading,
    error: poolSearchError,
  } = usePoolMatchSearch(phase === "gate" ? workingName : "");

  useEffect(() => {
    // Gate on hydration — pre-hydration the store reads defaults, which would
    // reset() and wipe a legitimately-persisted in-progress draft on cold start.
    if (!hydrated) return;
    if (fromPoolParam || useDraftVenueStore.getState().placePoolId !== null) {
      return;
    }
    if (useDraftVenueStore.getState().workingName.trim().length > 0) {
      return;
    }
    reset();
    setPhase("gate");
    setPoolNote(null);
  }, [fromPoolParam, hydrated, reset]);

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
    (match: (typeof poolMatches)[number]): void => {
      patch(prefillDraftFromPoolMatch(match));
      setPoolNote(null);
      setPhase("wizard");
    },
    [patch],
  );

  const handleGateContinue = useCallback((): void => {
    goToCategory();
  }, [goToCategory]);

  const handleCategoryContinue = useCallback((): void => {
    if (venueCategory === null) return;
    setPhase("wizard");
  }, [venueCategory]);

  if (!isAuthReady || user === null || !hydrated) {
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
          <Text style={styles.successTitle}>Your venue is being prepared</Text>
          <Text style={styles.successBody}>
            We created the venue record and started the deck-readiness pipeline.
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
    <View style={[styles.root, { paddingTop: insets.top }]}>
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
            {poolMatches.length > 0 && placePoolId === null ? (
              <View style={styles.matchList}>
                {poolMatches.map((match) => (
                  <PoolMatchCard
                    key={match.id}
                    match={match}
                    onYes={() => goToWizardFromPool(match)}
                    onNo={goToCategory}
                    onSkip={goToCategory}
                    testID={`pool-match-card-${match.id}`}
                  />
                ))}
              </View>
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
            {/* B1: fullWidth makes Continue stretch to the same insets as the
                category cards above it (previously it shrank to content width,
                so the cards read as wider than the button). */}
            <Button
              label="Continue"
              variant="primary"
              size="lg"
              fullWidth
              disabled={venueCategory === null}
              onPress={handleCategoryContinue}
            />
          </>
        )}
      </ScrollView>
    </View>
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
  matchList: {
    gap: spacing.md,
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
