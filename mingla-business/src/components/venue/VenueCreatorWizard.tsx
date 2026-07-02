/**
 * Ve1 — 7-step venue onboarding wizard (after category selection).
 *
 * META-ORCH-1255 Leg B — the wizard creates a `venue_listings` ROW under the
 * operator's CURRENT brand via `biz_create_venue_listing` (F-1 kill): NO brand
 * creation, NO active-brand switch, ever. Success carries `{ venueId,
 * placePoolId }` into the deck-readiness setup, and the per-brand draft store
 * clears only THIS brand's draft.
 */

import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. KeyboardAvoidingView
// removed. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  canvas,
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
import { upsertTier1Place } from "../../services/businessPlaceAuthoringService";
import type { VenueCategory } from "../../types/brand";
import { sanitizeAuthoringError } from "../../utils/sanitizeAuthoringError";
import { useDraftVenueStore } from "../../store/draftVenueStore";
import { venueStepError } from "./venueWizardValidation";
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

// META-ORCH-1009 Sub-E: the old step-2 "Cover" was a dead explainer card (no
// picker) — the real hero-cover upload happens post-submit on the deck-readiness
// screen via the unified CoverPicker. Removed to drop the wasted tap (7→6 steps).
const TOTAL = 6;
const STEPPER_STEPS: StepperStep[] = [
  { id: "s0", label: "Address" },
  { id: "s1", label: "Name" },
  { id: "s2", label: "Hours" },
  { id: "s3", label: "Contact" },
  { id: "s4", label: "Inputs" },
  { id: "s5", label: "Review" },
];

export interface VenueCreatorWizardProps {
  /**
   * Optional warning when venue was created but cover upload failed.
   * META-ORCH-1255 — also hands back the created venue id so the success
   * screen can route to the new venue's management page.
   */
  onDone: (coverWarning?: string | null, venueId?: string | null) => void;
  onClose: () => void;
}

export const VenueCreatorWizard: React.FC<VenueCreatorWizardProps> = ({
  onDone,
  onClose,
}) => {
  const insets = useSafeAreaInsets();
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
  const [createdVenue, setCreatedVenue] = useState<{
    venueId: string;
    placePoolId: string;
    venueName: string;
    venueCategory: VenueCategory | null;
    operatorTagline: string | null;
    operatorDescription: string | null;
  } | null>(null);

  const draft = useDraftVenueStore();
  const poolLinked = draft.placePoolId !== null;

  // B2 — the dock Continue must be visibly disabled (greyed) until the current
  // step is valid, instead of looking active and silently no-op'ing on tap.
  // On step 0 this means Continue stays greyed until a validated autocomplete
  // address (with lat/lng) is selected. Recomputed from live draft state.
  const stepValid = venueStepError(step, draft) === null;

  const goNext = useCallback((): void => {
    const e = venueStepError(step, draft);
    if (e !== null) {
      setShowErr(true);
      return;
    }
    setShowErr(false);
    setSlugCollision(null);
    setStep(Math.min(TOTAL - 1, step + 1));
  }, [draft, setStep, step]);

  const goBack = useCallback((): void => {
    setShowErr(false);
    setSlugCollision(null);
    setStep(Math.max(0, step - 1));
  }, [setStep, step]);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (user?.id === undefined) return;
    if (currentBrand === null) {
      setSubmitErr(
        "Pick a brand first — your venue listing lives under one of your brands.",
      );
      return;
    }
    setSubmitErr(null);
    const st = useDraftVenueStore.getState();
    const last = venueStepError(TOTAL - 1, st);
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
    try {
      for (let i = 0; i < TOTAL - 1; i++) {
        const e = venueStepError(i, st);
        if (e !== null) {
          setSubmitErr(e);
          setStep(i);
          setShowErr(true);
          return;
        }
      }
      setShowErr(false);

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
      const venueId = await createVenue.mutateAsync({
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
        coverMediaUrl: null,
        coverMediaType: null,
        hours: st.hours,
      });

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
          coverMediaUrl: null,
          coverMediaType: null,
          tagline: st.tagline.trim(),
          description: st.description.trim(),
          hours: st.hours,
        },
      });
      if (tier1.place_pool_id.length === 0) {
        throw new Error("place_pool_link_missing");
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
      if (e instanceof Error && e.message.includes("Google location")) {
        setSubmitErr(e.message);
        return;
      }
      setSubmitErr(sanitizeAuthoringError(e, "Could not submit. Try again."));
    }
  }, [createVenue, currentBrand, setStep, user?.id]);

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
    switch (step) {
      case 0:
        return <VenueStep1Address showErrors={showErr} />;
      case 1:
        return (
          <VenueStep2NameSlug
            showErrors={showErr}
            slugError={slugCollision}
            brandId={currentBrand?.id ?? null}
            brandSlug={currentBrand?.slug ?? null}
          />
        );
      case 2:
        return <VenueStep4Hours showErrors={showErr} />;
      case 3:
        return <VenueStep5Contact showErrors={showErr} />;
      case 4:
        return <VenueStep6Description showErrors={showErr} />;
      case 5:
        return (
          <VenueStep7Review
            submitting={createVenue.isPending}
            submitError={submitErr}
            onSubmit={() => void handleSubmit()}
          />
        );
      default:
        return <View />;
    }
  })();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.chrome}>
        <IconChrome
          icon="x"
          accessibilityLabel="Close venue setup"
          onPress={onClose}
        />
        <View style={styles.chromeMid}>
          <Text style={styles.chromeTitle}>List your venue</Text>
          <Text style={styles.chromeSub}>
            Step {step + 1} of {TOTAL}
          </Text>
        </View>
        <View style={{ width: 36 }} />
      </View>

      <Stepper steps={STEPPER_STEPS} currentIndex={step} />

      {poolLinked ? (
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
        {body}
      </ScrollView>

      {step < TOTAL - 1 ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <View style={styles.dockRow}>
            {step > 0 ? (
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
              label="Continue"
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
  dockRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
});

export default VenueCreatorWizard;
