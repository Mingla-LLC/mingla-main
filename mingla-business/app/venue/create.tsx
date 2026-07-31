/**
 * Ve1+Ve2 — physical venue onboarding: pool match → category (optional) → wizard.
 *
 * ORCH-1263 [claim-adoption] — the gate now runs the DESIGN §4 match moment:
 * ClaimMatchCard (evolution of the retired PoolMatchCard) with presence facts
 * + claim_state; "Yes, this is me" fires the AUTHED adoption-detail fetch
 * (D-B copy-on-start — zero server writes) and enters the 10-step claim
 * wizard; claimed/pending places are blocked politely AT THE GATE
 * (I-PROPOSED-1263-CLAIMED-STATE-FRONT-LOADED); a persisted claim draft
 * renders the resume card (DESIGN §8.4); claim submit success shows the
 * §8.1 pending copy.
 */

import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper (KAS native /
// passthrough web). KeyboardAvoidingView removed. Per SPEC §7.F.
import { ScrollView } from "../../src/wrappers/SmartScrollView";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../src/constants/designSystem";
import { useAuth } from "../../src/context/AuthContext";
import {
  ClaimMatchCard,
  sortMatchesForGate,
} from "../../src/components/brand/ClaimMatchCard";
import { VenueCategoryPicker } from "../../src/components/brand/VenueCategoryPicker";
import { VenueCreatorWizard } from "../../src/components/venue/VenueCreatorWizard";
import { Button } from "../../src/components/ui/Button";
import { EventCoverMedia } from "../../src/components/ui/EventCoverMedia";
import { Icon } from "../../src/components/ui/Icon";
import { IconChrome } from "../../src/components/ui/IconChrome";
import { Input } from "../../src/components/ui/Input";
import { usePoolMatchSearch } from "../../src/hooks/usePoolMatchSearch";
import { useCurrentBrand } from "../../src/hooks/useCurrentBrand";
import { useFeatureFlag } from "../../src/hooks/useFeatureFlag";
import { useDraftVenueStore } from "../../src/store/draftVenueStore";
import {
  venueDraftBrandToActivate,
  venueDraftBrandToReset,
} from "../../src/components/venue/venueCreateBrandLifecycle";
import {
  fetchPlaceAdoptionDetail,
  PlaceNotAvailableError,
} from "../../src/services/poolSearchService";
import {
  prefillDraftFromAdoption,
  prefillDraftFromPoolMatch,
} from "../../src/utils/prefillDraftFromPoolMatch";
import { slugifyBrandSlug } from "../../src/utils/brandSlugify";
import type { PoolMatch } from "../../src/types/poolMatch";
import type { VenueCategory } from "../../src/types/brand";

type Phase = "gate" | "category" | "wizard" | "success";

function resolveInitialPhase(fromPoolParam: boolean): Phase {
  const st = useDraftVenueStore.getState();
  // ?pool=1 continues to mean wizard-resume for pool-linked drafts (claim or
  // legacy — the durable deep-link contract).
  if (fromPoolParam && st.placePoolId !== null) {
    return "wizard";
  }
  // ORCH-1263 (DESIGN §8.4) — a persisted claim draft re-enters at the GATE:
  // the resume card owns re-entry (Resume claim / Start over).
  if (st.claim !== null) {
    return "gate";
  }
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
  // META-ORCH-1255 — the wizard drafts + creates under the CURRENT brand.
  const currentBrand = useCurrentBrand();
  const activateBrand = useDraftVenueStore((s) => s.activateBrand);
  const activeDraftBrandId = useDraftVenueStore((s) => s.activeBrandId);
  const reset = useDraftVenueStore((s) => s.reset);
  const patch = useDraftVenueStore((s) => s.patch);
  const workingName = useDraftVenueStore((s) => s.workingName);
  const placePoolId = useDraftVenueStore((s) => s.placePoolId);
  const venueCategory = useDraftVenueStore((s) => s.venueCategory);
  const claimDraft = useDraftVenueStore((s) => s.claim);
  const draftStep = useDraftVenueStore((s) => s.step);
  const draftDisplayName = useDraftVenueStore((s) => s.displayName);
  const stayAuthoringFlag = useFeatureFlag("STAY_VENUE_AUTHORING");
  const stayAuthoringEnabled = stayAuthoringFlag.data === true;

  const [phase, setPhase] = useState<Phase>(() =>
    resolveInitialPhase(fromPoolParam),
  );
  const [poolNote, setPoolNote] = useState<string | null>(null);
  const [coverWarning, setCoverWarning] = useState<string | null>(null);
  // META-ORCH-1255 — the created venue id, so Done lands on ITS management page.
  const [createdVenueId, setCreatedVenueId] = useState<string | null>(null);
  // ORCH-1263 — claim submit success renders the §8.1 pending copy.
  const [claimSuccessName, setClaimSuccessName] = useState<string | null>(null);
  // ORCH-1263 — per-match YES state: detail fetch in flight / failed / the
  // place turned out unavailable mid-race (blocked-card swap backstop).
  const [yesLoadingId, setYesLoadingId] = useState<string | null>(null);
  const [fetchErrorIds, setFetchErrorIds] = useState<Set<string>>(new Set());
  const [unavailableIds, setUnavailableIds] = useState<Set<string>>(new Set());
  const [confirmStartOver, setConfirmStartOver] = useState(false);

  // META-ORCH-1009 Sub-E: the venue draft is now AsyncStorage-persisted, which
  // hydrates asynchronously. We must NOT read the draft (to pick the resume
  // phase) or run the empty-draft reset below until hydration completes —
  // otherwise a cold start reads defaults and wipes the persisted draft. Mirror
  // the proven event/create.tsx hydration gate.
  const [hydrated, setHydrated] = useState<boolean>(() =>
    useDraftVenueStore.persist.hasHydrated(),
  );
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

  // #1461 — a current brand can resolve after hydration. Never mark resume as
  // complete while it is null: activate the arriving (or newly switched) brand
  // first, then derive the phase from that brand's now-active draft.
  useEffect(() => {
    const brandId = venueDraftBrandToActivate({
      hydrated,
      currentBrandId: currentBrand?.id ?? null,
      activeDraftBrandId,
    });
    if (brandId === null) return;
    activateBrand(brandId);
    setPhase(resolveInitialPhase(fromPoolParam));
  }, [
    activateBrand,
    activeDraftBrandId,
    currentBrand?.id,
    fromPoolParam,
    hydrated,
  ]);

  const {
    matches: poolMatches,
    loading: poolSearchLoading,
    error: poolSearchError,
  } = usePoolMatchSearch(phase === "gate" ? workingName : "");

  useEffect(() => {
    const brandId = venueDraftBrandToReset({
      hydrated,
      currentBrandId: currentBrand?.id ?? null,
      activeDraftBrandId,
      hasPoolContext: fromPoolParam || placePoolId !== null,
      workingName,
    });
    if (brandId === null) return;
    // Scoped reset only. The no-argument reset remains reserved for logout;
    // routine venue entry must never erase another brand's parked draft.
    reset(brandId);
    setPhase("gate");
    setPoolNote(null);
  }, [
    activeDraftBrandId,
    currentBrand?.id,
    fromPoolParam,
    hydrated,
    placePoolId,
    reset,
    workingName,
  ]);

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
    // ORCH-1263 §B3 — No/Skip clears the adoption block with the pool link.
    patch({
      displayName: n,
      slug: slugifyBrandSlug(n),
      placePoolId: null,
      claim: null,
    });
    setPhase("category");
  }, [patch, workingName]);

  // ORCH-1263 §B3 — "Yes, this is me": authed adoption-detail fetch, then the
  // claim wizard. Copy-on-start (D-B): the ONLY effect of YES is a client
  // draft fill — zero server writes.
  const handleYes = useCallback(
    async (match: PoolMatch): Promise<void> => {
      setYesLoadingId(match.id);
      setPoolNote(null);
      try {
        const detail = await fetchPlaceAdoptionDetail(match.id);
        const { photoUris: _legacy, ...prefill } = prefillDraftFromAdoption(
          match,
          detail,
        );
        patch(prefill);
        setPhase("wizard");
      } catch (e) {
        if (e instanceof PlaceNotAvailableError) {
          // Race backstop (DESIGN §4.2): the place stopped being claimable
          // between search and YES — swap the card to the blocked state.
          setUnavailableIds((prev) => new Set(prev).add(match.id));
        } else {
          // Explicit fallback, never silent: the primary relabels
          // "Continue anyway" (lean whitelist prefill).
          setFetchErrorIds((prev) => new Set(prev).add(match.id));
        }
      } finally {
        setYesLoadingId(null);
      }
    },
    [patch],
  );

  const handleContinueAnyway = useCallback(
    (match: PoolMatch): void => {
      const { photoUris: _legacy, ...prefill } =
        prefillDraftFromPoolMatch(match);
      patch(prefill);
      setPoolNote(null);
      setPhase("wizard");
    },
    [patch],
  );

  const handleMessageSupport = useCallback((): void => {
    router.push("/support/inbox" as never);
  }, [router]);

  const handleGateContinue = useCallback((): void => {
    goToCategory();
  }, [goToCategory]);

  const handleCategoryContinue = useCallback((): void => {
    if (venueCategory === null) return;
    setPhase("wizard");
  }, [venueCategory]);

  const handleStartOver = useCallback((): void => {
    if (currentBrand !== null) {
      reset(currentBrand.id);
    }
    // A missing current brand is a loading/no-brand state. Never turn this
    // route-local action into the global draft wipe reserved for logout.
    setConfirmStartOver(false);
    setPhase("gate");
    setPoolNote(null);
  }, [currentBrand, reset]);

  if (!isAuthReady || user === null || !hydrated) {
    return <View style={[styles.root, { paddingTop: insets.top }]} />;
  }

  if (phase === "wizard") {
    return (
      <VenueCreatorWizard
        onClose={handleClose}
        onDone={(warning, venueId, claimName) => {
          setCoverWarning(warning ?? null);
          setCreatedVenueId(venueId ?? null);
          setClaimSuccessName(claimName ?? null);
          setPhase("success");
        }}
      />
    );
  }

  if (phase === "success") {
    const isClaimSuccess = claimSuccessName !== null;
    return (
      <View
        style={[
          styles.root,
          { paddingTop: insets.top, paddingHorizontal: spacing.lg },
        ]}
      >
        <View style={styles.successInner}>
          <Text style={styles.successTitle}>
            {isClaimSuccess
              ? `That's it — ${claimSuccessName} is in review`
              : "Your venue is being prepared"}
          </Text>
          <Text style={styles.successBody}>
            {isClaimSuccess
              ? "Your listing stays live while we verify it's really you. Approval usually lands within 4 business hours."
              : "We created the venue record and started the deck-readiness pipeline."}
          </Text>
          {coverWarning !== null ? (
            <Text style={styles.successWarning}>{coverWarning}</Text>
          ) : null}
          <Button
            label="Done"
            variant="primary"
            size="lg"
            onPress={() =>
              // META-ORCH-1255 — land on the NEW venue's management page.
              router.replace(
                (createdVenueId !== null
                  ? `/venue/${createdVenueId}`
                  : "/(tabs)/home") as never,
              )
            }
          />
        </View>
      </View>
    );
  }

  // ORCH-1263 (DESIGN §8.4) — persisted claim draft for the CURRENT brand →
  // resume card above the name input. The abandon boundary stays clean:
  // nothing server-side ever happened.
  const showResumeCard = phase === "gate" && claimDraft !== null;
  const resumePhoto = claimDraft?.keptGalleryUrls[0] ?? null;

  // Blocked variants sort below available (DESIGN §4.5); race-discovered
  // unavailability overrides a stale "available" claimState.
  const gateMatches = sortMatchesForGate(
    poolMatches.map((m) =>
      unavailableIds.has(m.id) && m.claimState === "available"
        ? { ...m, claimState: "pending" as const }
        : m,
    ),
  );

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
            {showResumeCard ? (
              <View style={styles.resumeCard} testID="claim-resume-card">
                <View style={styles.resumeRow}>
                  <View style={styles.resumePhoto}>
                    <EventCoverMedia
                      hue={25}
                      mediaUrl={resumePhoto}
                      mediaType={resumePhoto !== null ? "image" : null}
                      radius={radiusTokens.md}
                      label="Claim draft venue photo"
                      height={56}
                      width={56}
                    />
                  </View>
                  <View style={styles.resumeCol}>
                    <Text style={styles.resumeName} numberOfLines={1}>
                      {draftDisplayName.trim() || workingName.trim()}
                    </Text>
                    <Text style={styles.resumeStep}>
                      You&apos;re on step {Math.min(draftStep + 1, 10)} of 10 —
                      nearly there.
                    </Text>
                  </View>
                </View>
                {confirmStartOver ? (
                  <>
                    <Text style={styles.resumeConfirm}>
                      Throw away this claim draft?
                    </Text>
                    <View style={styles.resumeActions}>
                      <Button
                        label="Start over"
                        variant="destructive"
                        size="md"
                        onPress={handleStartOver}
                        testID="claim-resume-startover-confirm"
                      />
                      <Button
                        label="Cancel"
                        variant="ghost"
                        size="sm"
                        onPress={() => setConfirmStartOver(false)}
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.resumeActions}>
                    <Button
                      label="Resume claim"
                      variant="primary"
                      size="md"
                      onPress={() => setPhase("wizard")}
                      testID="claim-resume-resume"
                    />
                    <Button
                      label="Start over"
                      variant="ghost"
                      size="sm"
                      onPress={() => setConfirmStartOver(true)}
                      testID="claim-resume-startover"
                    />
                  </View>
                )}
              </View>
            ) : null}
            <Text style={styles.h1}>What’s your venue called?</Text>
            <Text style={styles.sub}>
              We’ll check our directory so we can prefill your listing when we
              know you.
            </Text>
            <Input
              variant="text"
              value={workingName}
              onChangeText={(t) =>
                // ORCH-1263 — while a claim draft exists, typing must NOT
                // sever its pool link (the resume card owns re-entry; a fresh
                // search requires Start over). No claim draft → pre-1263
                // behavior: typing re-arms the gate.
                patch(
                  claimDraft === null
                    ? { workingName: t, placePoolId: null }
                    : { workingName: t },
                )
              }
              placeholder="Venue name"
              accessibilityLabel="Venue working name"
            />
            {poolSearchLoading ? (
              <Text style={styles.hint}>Searching our directory…</Text>
            ) : null}
            {poolSearchError !== null ? (
              <Text style={styles.warn}>{poolSearchError}</Text>
            ) : null}
            {gateMatches.length > 0 && placePoolId === null ? (
              <View style={styles.matchList}>
                {/* ClaimMatchCard = the DESIGN §4 evolution of PoolMatchCard. */}
                {gateMatches.map((match) => (
                  <ClaimMatchCard
                    key={match.id}
                    match={match}
                    loading={yesLoadingId === match.id}
                    fetchError={fetchErrorIds.has(match.id)}
                    onYes={() => void handleYes(match)}
                    onContinueAnyway={() => handleContinueAnyway(match)}
                    onNo={goToCategory}
                    onSkip={goToCategory}
                    onMessageSupport={handleMessageSupport}
                    testID={`pool-match-card-${match.id}`}
                  />
                ))}
              </View>
            ) : null}
            {poolNote !== null ? (
              <Text style={styles.warn}>{poolNote}</Text>
            ) : null}
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
              includeStay={stayAuthoringEnabled}
              stayDisabled={!stayAuthoringEnabled}
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
              disabled={
                venueCategory === null ||
                (venueCategory === "stay" && !stayAuthoringEnabled)
              }
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
  // ORCH-1263 — resume card (DESIGN §8.4; flat elevated tint — opaque-safe on
  // Android per the deckBlock family).
  resumeCard: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.lg,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  resumeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  resumePhoto: {
    width: 56,
    height: 56,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
  },
  resumeCol: {
    flex: 1,
    gap: spacing.xxs,
  },
  resumeName: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  resumeStep: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: typography.caption.fontWeight,
    letterSpacing: typography.caption.letterSpacing,
    color: textTokens.secondary,
  },
  resumeConfirm: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
  },
  resumeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
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
