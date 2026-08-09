/**
 * Ve1 — venue onboarding wizard (after category selection).
 *
 * META-ORCH-1255 Leg B — the wizard creates a `venue_listings` ROW under the
 * operator's CURRENT brand via `biz_create_venue_listing` (F-1 kill): NO brand
 * creation, NO active-brand switch, ever. ORCH-1285 — create success now
 * `router.replace`s to the DURABLE `/venue/deck-readiness` route (was an
 * ephemeral inline mount that flashed/unmounted on web, stranding the venue at
 * `business_authoring_status='processing'`); the per-brand draft store still
 * clears only THIS brand's draft first.
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
  commitNewVenueDiscoveryRange,
  fetchVenuePipelineState,
  syncGallery,
  upsertTier1Place,
} from "../../services/businessPlaceAuthoringService";
import {
  PlaceClaimConflictError,
  fetchVenueListing,
  findOwnListingForPlace,
} from "../../services/venueListingsService";
import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";
import { acquireVenueForSubmission } from "./venueSubmissionResume";
// META-ORCH-1290 Leg B (D-1) — the create post-submit deck-readiness NAV is
// RETIRED: create is now ONE folded submission that lands directly on the
// management page "In review" (the durable-route builder import is gone). The
// durable /venue/deck-readiness route SURVIVES as the Hub→Edit surface
// (VenueListingContent.handleEdit) — it is just no longer a create step.
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
// META-ORCH-1290 Leg B (D-1) — the wizard NEVER mounts VenueDeckReadinessSetup:
// create now collects photos/cover/price/pitch IN the folded wizard (steps
// below) and submit lands on the management page. The deck-readiness module
// lives ONLY on the durable Hub→Edit route now.
import { VenueStep1Address } from "./VenueStep1Address";
import { VenueStep2NameSlug } from "./VenueStep2NameSlug";
import { VenueStep4Hours } from "./VenueStep4Hours";
import { VenueStep7Review } from "./VenueStep7Review";
// META-ORCH-1290 Leg B — the folded create wizard reuses the claim step
// components (Contact/Price/Bookings share top-level draft fields; provenance
// chips resolve to null in create mode) + two new create-specific steps for
// the photo gallery + cover. ORCH-1304 removed the Pitch step — the shared
// pitch field and the claim pitch step no longer mount here; Mingla writes the
// pitch at approve.
import { VenuePhotosStep } from "./VenuePhotosStep";
import { VenueCoverStep } from "./VenueCoverStep";
import { ClaimAdoptionBanner } from "./claim/ClaimAdoptionBanner";
import { ClaimStepBookings } from "./claim/ClaimStepBookings";
import { ClaimStepCategory } from "./claim/ClaimStepCategory";
import { ClaimStepContact } from "./claim/ClaimStepContact";
import { ClaimStepCover } from "./claim/ClaimStepCover";
import { ClaimStepHours } from "./claim/ClaimStepHours";
import { ClaimStepPhotos } from "./claim/ClaimStepPhotos";
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
   * ORCH-1263 / #1467 — `submittedName` renders the exact listing on success;
   * `wasClaim` keeps the claim-only "listing stays live" copy off new venues.
   */
  onDone: (
    coverWarning?: string | null,
    venueId?: string | null,
    submittedName?: string | null,
    wasClaim?: boolean,
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
    const { lat, lng, venueCategory } = st;
    if (lat === null || lng === null || venueCategory === null) {
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
      // META-ORCH-1290 Leg B — the folded create wizard collects the cover in
      // step s4 (top-level `coverChoice`); claim keeps its own under `claim`.
      const coverChoice = claim?.coverChoice ?? st.coverChoice ?? null;
      // create s3 gallery (claim carries its own kept+added set).
      const createGalleryUrls = st.galleryUrls ?? [];

      // ORCH-1263 D-C/R-7 (DESIGN §8.3) — half-claim RESUME-NOT-RECREATE: when
      // an own listing row already exists for this place, never re-insert.
      // The pre-check runs BEFORE createVenue (own-row 23505 can't happen).
      let venueId: string | null = null;
      let resumedCreatePlacePoolId: string | null = null;
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
          onDone(null, plan.venueId, st.displayName.trim(), true);
          useDraftVenueStore.getState().reset(currentBrand.id);
          return;
        }
        if (plan.kind === "resume") {
          venueId = plan.venueId; // reuse the row, re-run tier-1 only.
        }
      }

      const createVenueRecord = async (): Promise<string> => {
        // Resolve a guaranteed available slug only when there is no remembered
        // row to resume. A retry must never advance the slug and insert again.
        const resolvedSlug = await resolveAvailableVenueSlug(
          st.displayName.trim(),
          st.slug.trim() || null,
          currentBrand.id,
        );
        return createVenue.mutateAsync({
          brandId: currentBrand.id,
          name: st.displayName.trim(),
          slug: resolvedSlug,
          tagline: st.tagline.trim() || undefined,
          description: st.description.trim(),
          placePoolId: st.placePoolId,
          googlePlaceId: st.googlePlaceId,
          lat,
          lng,
          city: st.city,
          countryCode: st.countryCode,
          coordinatePrecision: st.coordinatePrecision ?? null,
          address: st.formattedAddress.trim(),
          venueCategory,
          contact: {
            email: st.contactEmail.trim() || undefined,
            phone: st.contactPhone.trim() || undefined,
          },
          coverMediaUrl: coverChoice?.url ?? null,
          coverMediaPosterUrl:
            coverChoice?.posterUrl ??
            (coverChoice?.type === "image" ? coverChoice.url : null),
          coverMediaType: coverChoice?.type ?? null,
          hours: st.hours,
          // issue #1564 — the venue's own colours/font/motion, authored at
          // s4/s9 (create) or c4/c9 (claim) into the SAME top-level draft
          // field, so one line serves both paths. `?? null` = inherit.
          themeOverrides: st.themeOverrides ?? null,
        });
      };

      if (!claimMode) {
        const acquired = await acquireVenueForSubmission(
          {
            brandId: currentBrand.id,
            rememberedVenueId: st.submissionVenueId ?? null,
          },
          {
            fetchVenue: fetchVenueListing,
            createVenue: createVenueRecord,
            rememberVenue: (id) =>
              useDraftVenueStore.getState().patch({ submissionVenueId: id }),
          },
        );
        venueId = acquired.venueId;
        resumedCreatePlacePoolId = acquired.placePoolId;
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
        // Claim mode keeps its proven place-keyed resume path above. Only a
        // first-time claim reaches this create callback.
        venueId = await createVenueRecord();
      }

      let authoringPlacePoolId = resumedCreatePlacePoolId;
      if (authoringPlacePoolId === null) {
        const tier1 = await upsertTier1Place({
          brandId: currentBrand.id,
          venueId,
          selectedPlacePoolId: st.placePoolId,
          draft: {
            name: st.displayName.trim(),
            address: st.formattedAddress.trim(),
            lat,
            lng,
            city: st.city,
            countryCode: st.countryCode,
            venueCategory,
            coverMediaUrl: coverChoice?.url ?? null,
            coverMediaPosterUrl:
              coverChoice?.posterUrl ??
              (coverChoice?.type === "image" ? coverChoice.url : null),
            coverMediaType: coverChoice?.type ?? null,
            // META-ORCH-1290 D-4 — tagline collapsed into the single Pitch field;
            // the wizard no longer collects a tagline (vestigial empty string).
            tagline: st.tagline.trim(),
            description: st.description.trim(),
            hours: st.hours,
            // META-ORCH-1290 Leg B (D-1) — the folded create wizard now collects
            // website/gallery too. Issue #1384 removes discovery money from the
            // tier staging blob; both create and claim save one canonical range
            // after place/venue identity resolves below.
            website: st.website.trim() || null,
            adoptedGalleryUrls:
              claimMode && claim !== null
                ? claim.keptGalleryUrls
                : createGalleryUrls,
            // adoption provenance is claim-only (create has nothing to adopt).
            ...(claimMode && claim !== null
              ? {
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
        authoringPlacePoolId = tier1.place_pool_id;
      }
      if (authoringPlacePoolId.length === 0) {
        throw new Error("place_pool_link_missing");
      }
      if (venueId === null) {
        throw new Error("venue_link_missing");
      }

      await commitNewVenueDiscoveryRange({
        brandId: currentBrand.id,
        venueId,
        placePoolId: authoringPlacePoolId,
        priceMinInput: st.discoveryPriceMinInput ?? "",
        priceMaxInput: st.discoveryPriceMaxInput ?? "",
      });

      if (claimMode) {
        // ORCH-1263 — claim success: the standard pending card state (DESIGN
        // §8.1); NO inline deck-readiness leg (resume route serves it later).
        onDone(null, venueId, st.displayName.trim(), true);
        useDraftVenueStore.getState().reset(currentBrand.id);
        return;
      }

      // META-ORCH-1290 Leg B (D-1) — the create post-submit deck-readiness leg
      // is RETIRED. Create is ONE folded submission: tier-1 success lands the
      // owner DIRECTLY on the venue management page in "In review", exactly like
      // the claim path. First persist the wizard-collected gallery to
      // business_gallery_urls (the create-from-scratch INSERT stages the draft
      // blob but not the authoritative gallery column, which the ≥5-at-approve
      // deck gate + the deck gallery read) — non-blocking: a failure here just
      // means the owner adds photos later on the listing. Then clear THIS
      // brand's draft and hand back the venue id (onDone → management page).
      if (createGalleryUrls.length > 0) {
        try {
          await syncGallery({
            brandId: currentBrand.id,
            venueId,
            placePoolId: authoringPlacePoolId,
            galleryUrls: createGalleryUrls,
          });
        } catch {
          // non-blocking — the pitch/photos are editable on the listing page.
        }
      }
      onDone(null, venueId, st.displayName.trim(), false);
      useDraftVenueStore.getState().reset(currentBrand.id);
      return;
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

  const body = ((): React.ReactElement => {
    switch (stepId) {
      // ── create path — META-ORCH-1290 Leg B folded 10-step wizard ──────────
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
        return <VenuePhotosStep brandId={currentBrand?.id ?? null} />;
      case "s4":
        return <VenueCoverStep brandId={currentBrand?.id ?? null} />;
      case "s5":
        return <ClaimStepContact showErrors={showErr} />;
      // ORCH-1304 — the create Pitch step (s6) is removed; Mingla writes the
      // pitch at approve, edited later on the listing page.
      case "s7":
        return <ClaimStepPrice showErrors={showErr} />;
      case "s8":
        return <ClaimStepBookings />;
      case "s9":
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
      // ORCH-1304 — the claim Pitch step (c5) is removed; Mingla writes the
      // pitch at approve, edited later on the listing page.
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
    ((isClaim && stepId === "c4") || (!isClaim && stepId === "s4")) &&
    !stepValid
      ? "Pick a cover to continue"
      : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <IconChrome
          icon="close"
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
