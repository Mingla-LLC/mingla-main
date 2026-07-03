/**
 * Ve1 — venue onboarding wizard (after category selection).
 *
 * META-ORCH-1255 Leg B — the wizard creates a `venue_listings` ROW under the
 * operator's CURRENT brand via `biz_create_venue_listing` (F-1 kill): NO brand
 * creation, NO active-brand switch, ever. Success carries `{ venueId,
 * placePoolId }` into the deck-readiness setup, and the per-brand draft store
 * clears only THIS brand's draft.
 *
 * ORCH-1263 [claim-adoption] — the wizard now hosts TWO step maps on the same
 * shell (SPEC §B0):
 *   create: s0–s5 (6 steps, flow byte-compatible with pre-1263 — SC-12)
 *   claim:  c0–c9 (10 steps — the DESIGN walkthrough; mode ⇔ draft.claim set)
 * Claim mode: adoption banner slot (DESIGN §5.1), prefilled stepper dots
 * (§5.2), per-step dock CTA labels (§5.3 Keep/Save/Continue), c4 blocks until
 * a cover is chosen, submit rides the SAME createVenue + tier-1 machinery
 * with the claim payload deltas (§B4), half-claim resume-not-recreate (D-C),
 * and the 23505 backstop branches own-row (resume) vs foreign (§8.2 card).
 * Claim mode does NOT enter the inline deck-readiness leg — deck-readiness
 * stays reachable post-submit via the existing to-dos/resume route, prefilled
 * from staging (Leg A §A3.1/§A3.5).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. KeyboardAvoidingView
// removed. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import {
  canvas,
  durations,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import {
  SlugCollisionError,
  resolveAvailableVenueSlug,
} from "../../hooks/useBrands";
import { useCreateVenueListing } from "../../hooks/useVenueListings";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import {
  fetchVenuePipelineState,
  upsertTier1Place,
} from "../../services/businessPlaceAuthoringService";
import {
  PlaceClaimConflictError,
  findOwnListingForPlace,
} from "../../services/venueListingsService";
import type { VenueCategory } from "../../types/brand";
import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import {
  claimDockLabel,
  claimPrefilledStepCount,
  claimStepPrefilled,
  resolveClaimSubmitPlan,
  venueStepError,
  venueWizardSteps,
} from "./venueWizardValidation";
import { Button } from "../ui/Button";
import { IconChrome } from "../ui/IconChrome";
import { Stepper, type StepperStep } from "../ui/Stepper";
// META-ORCH-1255(R2) — the deck-readiness setup lives in its own module (it is
// ALSO consumed by the durable resume route app/venue/deck-readiness.tsx; a
// shared-file layout hoisted this whole wizard into the eager __common chunk,
// breaching the ORCH-1083 web bundle budget).
import { VenueDeckReadinessSetup } from "./VenueDeckReadinessSetup";
import { VenueStep1Address } from "./VenueStep1Address";
import { VenueStep2NameSlug } from "./VenueStep2NameSlug";
import { VenueStep4Hours } from "./VenueStep4Hours";
import { VenueStep5Contact } from "./VenueStep5Contact";
import { VenueStep6Description } from "./VenueStep6Description";
import { VenueStep7Review } from "./VenueStep7Review";
import { ClaimAdoptionBanner } from "./claim/ClaimAdoptionBanner";
import { ClaimStepBookings } from "./claim/ClaimStepBookings";
import { ClaimStepCategory } from "./claim/ClaimStepCategory";
import { ClaimStepContact } from "./claim/ClaimStepContact";
import { ClaimStepCover } from "./claim/ClaimStepCover";
import { ClaimStepHours } from "./claim/ClaimStepHours";
import { ClaimStepPhotos } from "./claim/ClaimStepPhotos";
import { ClaimStepPitch } from "./claim/ClaimStepPitch";
import { ClaimStepPlace } from "./claim/ClaimStepPlace";
import { ClaimStepPrice } from "./claim/ClaimStepPrice";
import {
  ClaimStepReview,
  type ClaimSubmitBlock,
} from "./claim/ClaimStepReview";

export interface VenueCreatorWizardProps {
  /**
   * Optional warning when venue was created but cover upload failed.
   * META-ORCH-1255 — also hands back the created venue id so the success
   * screen can route to the new venue's management page.
   * ORCH-1263 — `claimName` is set on CLAIM submits so the success screen can
   * render the DESIGN §8.1 copy ("That's it — {name} is in review").
   */
  onDone: (
    coverWarning?: string | null,
    venueId?: string | null,
    claimName?: string | null,
  ) => void;
  onClose: () => void;
}

/**
 * M-2 step transition — incoming slide+fade (±24 → 0, 260ms out) keyed by
 * step; web is fade-only (horizontal slides fight browser back-gesture
 * affordances); reduced-motion = instant swap. Built inside the component —
 * never a module-top-level reanimated builder (ORCH-1211 web-crash lesson).
 * The 180ms outgoing overlap of M-2 is intentionally not double-mounted
 * (documented deviation — a second absolute-fill mount inside the ScrollView
 * risks layout fights for marginal fidelity).
 */
const StepTransition: React.FC<{
  stepKey: string;
  direction: 1 | -1;
  children: React.ReactNode;
}> = ({ stepKey, direction, children }) => {
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);
  const prevKey = useRef(stepKey);

  useEffect(() => {
    if (prevKey.current === stepKey) return;
    prevKey.current = stepKey;
    if (reduceMotion) {
      opacity.value = 1;
      translateX.value = 0;
      return;
    }
    opacity.value = 0;
    opacity.value = withTiming(1, { duration: durations.entry });
    if (Platform.OS !== "web") {
      translateX.value = 24 * direction;
      translateX.value = withTiming(0, { duration: durations.entry });
    } else {
      translateX.value = 0;
    }
  }, [direction, opacity, reduceMotion, stepKey, translateX]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
};

export const VenueCreatorWizard: React.FC<VenueCreatorWizardProps> = ({
  onDone,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  // META-ORCH-1255 — the venue attaches to the CURRENT brand (F-1 kill).
  const currentBrand = useCurrentBrand();
  const createVenue = useCreateVenueListing();

  // META-ORCH-1009 Sub-E: the wizard step is sourced REACTIVELY from the
  // PERSISTED draft store so re-entry resumes where the operator stopped (not
  // always step 0). A reactive selector — rather than a one-time useState
  // initializer — also sidesteps the AsyncStorage rehydration race (the persisted
  // step lands a tick after mount and flows in automatically).
  const step = useDraftVenueStore((s) => s.step);
  const setStep = useDraftVenueStore((s) => s.setStep);
  const [showErr, setShowErr] = useState(false);
  const [slugCollision, setSlugCollision] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // ORCH-1263 — the §8.2 (foreign) / §8.3 (retry) submit edge states.
  const [claimBlock, setClaimBlock] = useState<ClaimSubmitBlock | null>(null);
  const [createdVenue, setCreatedVenue] = useState<{
    venueId: string;
    placePoolId: string;
    venueName: string;
    venueCategory: VenueCategory | null;
    operatorTagline: string | null;
    operatorDescription: string | null;
  } | null>(null);
  const lastDirection = useRef<1 | -1>(1);

  const draft = useDraftVenueStore();
  // ORCH-1263 — claim mode ⇔ the draft carries an adoption block (set by both
  // the full-detail prefill AND the "Continue anyway" lean prefill).
  const isClaim = draft.claim !== null;
  const poolLinked = draft.placePoolId !== null;

  const baseSteps = venueWizardSteps(isClaim);
  const TOTAL = baseSteps.length;
  const clampedStep = Math.min(step, TOTAL - 1);
  const stepId = baseSteps[clampedStep]?.id ?? baseSteps[0].id;
  // DESIGN §5.2 — prefilled flags come from the immutable adopted snapshot.
  const stepperSteps: StepperStep[] = baseSteps.map((s) => ({
    ...s,
    prefilled: isClaim && claimStepPrefilled(s.id, draft),
  }));

  // B2 — the dock Continue must be visibly disabled (greyed) until the current
  // step is valid, instead of looking active and silently no-op'ing on tap.
  // On step 0 this means Continue stays greyed until a validated autocomplete
  // address (with lat/lng) is selected. Recomputed from live draft state.
  const stepValid = venueStepError(stepId, draft) === null;

  const goNext = useCallback((): void => {
    const e = venueStepError(stepId, draft);
    if (e !== null) {
      setShowErr(true);
      return;
    }
    setShowErr(false);
    setSlugCollision(null);
    lastDirection.current = 1;
    setStep(Math.min(TOTAL - 1, clampedStep + 1));
  }, [TOTAL, clampedStep, draft, setStep, stepId]);

  const goBack = useCallback((): void => {
    setShowErr(false);
    setSlugCollision(null);
    lastDirection.current = -1;
    setStep(Math.max(0, clampedStep - 1));
  }, [clampedStep, setStep]);

  const jumpToStep = useCallback(
    (id: string): void => {
      const index = baseSteps.findIndex((s) => s.id === id);
      if (index < 0) return;
      lastDirection.current = index >= clampedStep ? 1 : -1;
      setShowErr(false);
      setStep(index);
    },
    [baseSteps, clampedStep, setStep],
  );

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (user?.id === undefined) return;
    if (currentBrand === null) {
      setSubmitErr(
        "Pick a brand first — your venue listing lives under one of your brands.",
      );
      return;
    }
    setSubmitErr(null);
    setClaimBlock(null);
    const st = useDraftVenueStore.getState();
    const claimMode = st.claim !== null;
    const stepIds = venueWizardSteps(claimMode).map((s) => s.id);
    const last = venueStepError(stepIds[stepIds.length - 1], st);
    if (last !== null) {
      setShowErr(true);
      return;
    }
    if (
      st.lat === null ||
      st.lng === null ||
      st.venueCategory === null
    ) {
      setSubmitErr("Some required fields are missing. Go back and check.");
      return;
    }
    setSubmitting(true);
    try {
      for (let i = 0; i < stepIds.length - 1; i++) {
        const e = venueStepError(stepIds[i], st);
        if (e !== null) {
          setSubmitErr(e);
          setStep(i);
          setShowErr(true);
          return;
        }
      }
      setShowErr(false);

      const claim = st.claim;
      const coverChoice = claim?.coverChoice ?? null;

      // ORCH-1263 D-C/R-7 (DESIGN §8.3) — half-claim RESUME-NOT-RECREATE: when
      // an own listing row already exists for this place, never re-insert.
      // The pre-check runs BEFORE createVenue (own-row 23505 can't happen).
      let venueId: string | null = null;
      if (claimMode && st.placePoolId !== null) {
        const own = await findOwnListingForPlace(
          currentBrand.id,
          st.placePoolId,
        );
        const pipe = own !== null
          ? await fetchVenuePipelineState(own.id)
          : null;
        const plan = resolveClaimSubmitPlan(
          own?.id ?? null,
          pipe?.tier1_completed_at ?? null,
        );
        if (plan.kind === "already-submitted") {
          // Claim already fully submitted — route to the venue, not a
          // duplicate submit.
          useDraftVenueStore.getState().reset(currentBrand.id);
          onDone(null, plan.venueId, st.displayName.trim());
          return;
        }
        if (plan.kind === "resume") {
          venueId = plan.venueId; // reuse the row, re-run tier-1 only.
        }
      }

      if (venueId === null) {
        // META-ORCH-1009 Sub-E: resolve a GUARANTEED-available slug at submit time,
        // regardless of what the name-step UI currently shows. This closes the gaps
        // where the UI could still carry a taken/unverified slug (availability check
        // still in flight, all 4 displayed candidates taken, or a race since the
        // check ran). resolveAvailableVenueSlug honors the shown slug if still free,
        // else advances suffixes, with a timestamp fallback that cannot run out.
        // META-ORCH-1255(R) — scoped to the CURRENT brand: venue slug truth is
        // `venue_listings UNIQUE (brand_id, slug)`, not the brands table.
        const resolvedSlug = await resolveAvailableVenueSlug(
          st.displayName.trim(),
          st.slug.trim() || null,
          currentBrand.id,
        );

        // META-ORCH-1255 — create the venue LISTING under the CURRENT brand.
        // NO brand insert, NO active-brand switch (the operator stays where they
        // are; the new venue appears in this brand's Hub venue tab).
        // ORCH-1263 §B4.2 — the claim's chosen cover rides the create RPC
        // (venue row = hero truth, 1255(C) D-C); create path stays null.
        venueId = await createVenue.mutateAsync({
          brandId: currentBrand.id,
          name: st.displayName.trim(),
          slug: resolvedSlug,
          tagline: st.tagline.trim() || undefined,
          description: st.description.trim(),
          placePoolId: st.placePoolId,
          googlePlaceId: st.googlePlaceId,
          lat: st.lat,
          lng: st.lng,
          city: st.city,
          countryCode: st.countryCode,
          address: st.formattedAddress.trim(),
          venueCategory: st.venueCategory,
          contact: {
            email: st.contactEmail.trim() || undefined,
            phone: st.contactPhone.trim() || undefined,
          },
          coverMediaUrl: coverChoice?.url ?? null,
          coverMediaType: coverChoice?.type ?? null,
          hours: st.hours,
        });
      }

      const tier1 = await upsertTier1Place({
        brandId: currentBrand.id,
        venueId,
        selectedPlacePoolId: st.placePoolId,
        draft: {
          name: st.displayName.trim(),
          address: st.formattedAddress.trim(),
          lat: st.lat,
          lng: st.lng,
          city: st.city,
          countryCode: st.countryCode,
          venueCategory: st.venueCategory,
          coverMediaUrl: coverChoice?.url ?? null,
          coverMediaType: coverChoice?.type ?? null,
          tagline: st.tagline.trim(),
          description: st.description.trim(),
          hours: st.hours,
          // ORCH-1263 §B4.3 — claim payload deltas (Leg A §A3.1 reads these
          // into the STAGING columns; create path leaves them undefined).
          ...(claimMode && claim !== null
            ? {
                website: st.website.trim() || null,
                priceTiers: st.priceTiers,
                adoptedGalleryUrls: claim.keptGalleryUrls,
                adoption: {
                  source: "place_pool" as const,
                  adoptedAt: claim.adoptedAt,
                  summarySource: claim.adopted.summarySource,
                  wantsReservations: st.wantsReservations,
                },
              }
            : {}),
        },
      });
      if (tier1.place_pool_id.length === 0) {
        throw new Error("place_pool_link_missing");
      }

      if (claimMode) {
        // ORCH-1263 — claim success: the standard pending card state (DESIGN
        // §8.1); NO inline deck-readiness leg (resume route serves it later).
        useDraftVenueStore.getState().reset(currentBrand.id);
        onDone(null, venueId, st.displayName.trim());
        return;
      }

      setCreatedVenue({
        venueId,
        placePoolId: tier1.place_pool_id,
        venueName: st.displayName.trim(),
        venueCategory: st.venueCategory,
        operatorTagline: st.tagline.trim() || null,
        operatorDescription: st.description.trim() || null,
      });
      // The venue is created and the flow moves to the deck-readiness screen
      // (which reads from createdVenue, not the draft). Clear THIS brand's
      // persisted draft so the NEXT "Create venue listing" starts clean —
      // other brands' drafts are untouched (per-brand store v2).
      useDraftVenueStore.getState().reset(currentBrand.id);
    } catch (e) {
      if (e instanceof SlugCollisionError) {
        setSlugCollision(
          "This URL slug is taken. Go back to Name and adjust it.",
        );
        setStep(1);
        return;
      }
      // ORCH-1263 — 23505 place-uniq backstop (the race the gate can't catch).
      // Own-row 23505 can no longer occur (the resume pre-check wins), but the
      // catch still branches on findOwnListingForPlace before showing the
      // §8.2 card (race honesty) — an own row means RESUME, never support.
      if (claimMode && e instanceof PlaceClaimConflictError) {
        const st2 = useDraftVenueStore.getState();
        let own = null;
        if (st2.placePoolId !== null) {
          own = await findOwnListingForPlace(
            currentBrand.id,
            st2.placePoolId,
          ).catch(() => null);
        }
        setClaimBlock(own !== null ? { kind: "retry" } : { kind: "foreign" });
        return; // draft NOT cleared — their work survives (DESIGN §8.2).
      }
      if (e instanceof Error && e.message.includes("Google location")) {
        setSubmitErr(e.message);
        return;
      }
      if (claimMode) {
        // Venue row may exist while tier-1 died (R-7) — the retry card resumes
        // via the pre-check; the raw error still surfaces beneath it.
        setClaimBlock({ kind: "retry" });
        setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));
        return;
      }
      setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));
    } finally {
      setSubmitting(false);
    }
  }, [createVenue, currentBrand, onDone, setStep, user?.id]);

  if (createdVenue !== null && user?.id !== undefined && currentBrand !== null) {
    return (
      <VenueDeckReadinessSetup
        accountId={user.id}
        brandId={currentBrand.id}
        venueId={createdVenue.venueId}
        placePoolId={createdVenue.placePoolId}
        venueName={createdVenue.venueName}
        venueCategory={createdVenue.venueCategory}
        operatorTagline={createdVenue.operatorTagline}
        operatorDescription={createdVenue.operatorDescription}
        onDone={() => onDone(null, createdVenue.venueId)}
      />
    );
  }

  const body = ((): React.ReactElement => {
    switch (stepId) {
      // ── create path (unchanged) ───────────────────────────────────────────
      case "s0":
        return <VenueStep1Address showErrors={showErr} />;
      case "s1":
        return (
          <VenueStep2NameSlug
            showErrors={showErr}
            slugError={slugCollision}
            brandId={currentBrand?.id ?? null}
            brandSlug={currentBrand?.slug ?? null}
          />
        );
      case "s2":
        return <VenueStep4Hours showErrors={showErr} />;
      case "s3":
        return <VenueStep5Contact showErrors={showErr} />;
      case "s4":
        return <VenueStep6Description showErrors={showErr} />;
      case "s5":
        return (
          <VenueStep7Review
            submitting={createVenue.isPending || submitting}
            submitError={submitErr}
            onSubmit={() => void handleSubmit()}
          />
        );
      // ── claim path (ORCH-1263) ────────────────────────────────────────────
      case "c0":
        return <ClaimStepCategory showErrors={showErr} />;
      case "c1":
        return (
          <ClaimStepPlace
            showErrors={showErr}
            slugError={slugCollision}
            brandId={currentBrand?.id ?? null}
            brandSlug={currentBrand?.slug ?? null}
          />
        );
      case "c2":
        return <ClaimStepHours showErrors={showErr} />;
      case "c3":
        return <ClaimStepPhotos brandId={currentBrand?.id ?? null} />;
      case "c4":
        return <ClaimStepCover brandId={currentBrand?.id ?? null} />;
      case "c5":
        return <ClaimStepPitch showErrors={showErr} />;
      case "c6":
        return <ClaimStepContact showErrors={showErr} />;
      case "c7":
        return <ClaimStepPrice showErrors={showErr} />;
      case "c8":
        return <ClaimStepBookings />;
      case "c9":
        return (
          <ClaimStepReview
            submitting={createVenue.isPending || submitting}
            submitError={submitErr}
            claimBlock={claimBlock}
            onSubmit={() => void handleSubmit()}
            onJump={jumpToStep}
            onMessageSupport={() => router.push("/support/inbox" as never)}
            onBackToVenues={() => router.replace("/(tabs)/home" as never)}
          />
        );
      default:
        return <View />;
    }
  })();

  const dockLabel = isClaim ? claimDockLabel(stepId, draft) : "Continue";
  const coverGateCaption =
    isClaim && stepId === "c4" && !stepValid
      ? "Pick a cover to continue"
      : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <IconChrome
          icon="x"
          accessibilityLabel="Close venue setup"
          onPress={onClose}
        />
        <View style={styles.chromeMid}>
          <Text style={styles.chromeTitle}>
            {isClaim ? "Claim your place" : "List your venue"}
          </Text>
          <Text style={styles.chromeSub}>
            Step {clampedStep + 1} of {TOTAL}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Stepper steps={stepperSteps} currentIndex={clampedStep} />

      {isClaim ? (
        <ClaimAdoptionBanner
          venueName={draft.displayName.trim() || draft.workingName.trim()}
          filledCount={claimPrefilledStepCount(draft)}
          collapsed={clampedStep > 0}
        />
      ) : poolLinked ? (
        <Text style={styles.poolBanner}>
          Prefilled from our directory — review each step before you submit.
        </Text>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <StepTransition stepKey={stepId} direction={lastDirection.current}>
          {body}
        </StepTransition>
      </ScrollView>

      {clampedStep < TOTAL - 1 ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          {coverGateCaption !== null ? (
            <Text style={styles.dockCaption}>{coverGateCaption}</Text>
          ) : null}
          <View style={styles.dockRow}>
            {clampedStep > 0 ? (
              <Button
                label="Back"
                variant="ghost"
                size="lg"
                onPress={goBack}
              />
            ) : (
              <View style={{ width: 88 }} />
            )}
            <Button
              label={dockLabel}
              variant="primary"
              size="lg"
              onPress={goNext}
              disabled={!stepValid}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: canvas.discover,
  },
  chrome: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chromeMid: {
    flex: 1,
    alignItems: "center",
  },
  chromeTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "700",
    color: textTokens.primary,
  },
  chromeSub: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  poolBanner: {
    fontSize: typography.caption.fontSize,
    color: textTokens.secondary,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  dock: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.12)",
  },
  dockCaption: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    textAlign: "center",
    paddingBottom: spacing.sm,
  },
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});

export default VenueCreatorWizard;
