/**
 * TripCreatorWizard — host component for the 5-step trip-planner wizard.
 * Tr2 (ORCH-0859). Per SPEC §4.8.
 *
 * Composes:
 *   - Stepper (1 of 5 / 2 of 5 / etc)
 *   - 5 step body components (TripCreatorStep1Basics .. Step5Review)
 *   - Sticky bottom dock with Back / Next / Publish
 *   - Autosave on each step transition (calls useUpdateTripBasics +
 *     useUpsertTripDays + useUpsertTripInclusions + useUpdateTripPricing)
 *   - Publish handler calls usePublishTrip; on error maps to step pointer
 *     and routes Step 5 banner
 *
 * State machine: linear navigation (no jumper). Local draft state mirrors
 * the server Trip; autosave runs on Next/Back press and on Publish press.
 * On publish success, calls onPublished(publishedTrip) so the host route
 * can router.replace to the public link.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import {
  useUpdateTripBasics,
  useUpsertTripDays,
  useUpsertTripInclusions,
  useUpdateTripPricing,
  usePublishTrip,
} from "../../hooks/useTrips";
import type { Trip, TripPublishValidationError } from "../../services/tripsService";

import {
  TripCreatorStep1Basics,
  type Step1Draft,
} from "./TripCreatorStep1Basics";
import { TripCreatorStep2Itinerary } from "./TripCreatorStep2Itinerary";
import type { TripDayDraft } from "./TripDayEditor";
import {
  TripCreatorStep3Inclusions,
  type InclusionDraft,
} from "./TripCreatorStep3Inclusions";
import {
  TripCreatorStep4Pricing,
  type Step4Draft,
} from "./TripCreatorStep4Pricing";
import {
  TripCreatorStep5Review,
  type PublishErrorState,
  mapPublishErrorToState,
} from "./TripCreatorStep5Review";
import type { TripPreviewBrand } from "./TripPreview";

export interface TripCreatorWizardProps {
  trip: Trip;
  brand: TripPreviewBrand;
  /** Fires after successful publish — host should router.replace to the public link. */
  onPublished: (published: Trip) => void;
  /** Fires when operator taps Close / back-out from step 1. */
  onExit: () => void;
}

type StepIndex = 1 | 2 | 3 | 4 | 5;

const STEP_TITLES: Record<StepIndex, string> = {
  1: "Basics",
  2: "Day by day",
  3: "What's included",
  4: "Pricing",
  5: "Review",
};

function tripToStep1Draft(trip: Trip): Step1Draft {
  return {
    title: trip.title,
    startAt: trip.businessTrip.startAt,
    endAt: trip.businessTrip.endAt,
    destinationPlaceId: trip.businessTrip.destinationPlaceId,
    destinationLocationText: trip.businessTrip.destinationLocationText,
    destinationLat: trip.businessTrip.destinationLat,
    destinationLng: trip.businessTrip.destinationLng,
    capacity: trip.businessTrip.capacity,
  };
}

function tripToDaysDraft(trip: Trip): TripDayDraft[] {
  return trip.days.map((d) => ({
    ordinal: d.ordinal,
    title: d.title,
    narrative: d.narrative ?? "",
  }));
}

function tripToInclusionsDraft(trip: Trip): InclusionDraft[] {
  return trip.inclusions.map((i) => ({
    kind: i.kind,
    item: i.item,
    ordinal: i.ordinal,
  }));
}

function tripToStep4Draft(trip: Trip): Step4Draft {
  const tier = trip.pricingTiers[0];
  // currency is read-only display only — the source of truth is
  // events.currency (locked at create time from brand.default_currency).
  // The tier.currency mirrors events.currency via the trigger.
  return {
    tierName: tier?.tierName ?? "Standard",
    priceMajor: tier === undefined ? "" : (tier.priceCents / 100).toFixed(2),
    currency: tier?.currency ?? "USD",
    capacity: trip.businessTrip.capacity,
  };
}

const STEP_COUNT = 5;

export const TripCreatorWizard: React.FC<TripCreatorWizardProps> = ({
  trip,
  brand,
  onPublished,
  onExit,
}) => {
  // ORCH-0859 REWORK 2 (operator smoke #2): respect device safe-area
  // so the header doesn't bleed into the iPhone status bar.
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<StepIndex>(1);
  const [step1Draft, setStep1Draft] = useState<Step1Draft>(tripToStep1Draft(trip));
  const [daysDraft, setDaysDraft] = useState<TripDayDraft[]>(tripToDaysDraft(trip));
  const [inclusionsDraft, setInclusionsDraft] = useState<InclusionDraft[]>(
    tripToInclusionsDraft(trip),
  );
  const [step4Draft, setStep4Draft] = useState<Step4Draft>(tripToStep4Draft(trip));
  const [publishError, setPublishError] = useState<PublishErrorState | null>(null);
  const [isAutosaving, setIsAutosaving] = useState<boolean>(false);

  const updateBasicsMutation = useUpdateTripBasics();
  const upsertDaysMutation = useUpsertTripDays();
  const upsertInclusionsMutation = useUpsertTripInclusions();
  const updatePricingMutation = useUpdateTripPricing();
  const publishMutation = usePublishTrip();

  // Keep step4Draft.capacity in sync with step1Draft.capacity
  useEffect(() => {
    if (step4Draft.capacity !== step1Draft.capacity) {
      setStep4Draft((s) => ({ ...s, capacity: step1Draft.capacity }));
    }
  }, [step1Draft.capacity, step4Draft.capacity]);

  // ORCH-0859 REWORK 3 (operator smoke item C — auto-seed days from range):
  // when Step 1 has both start + end set, derive the day count from the
  // date range and ensure daysDraft has that many cards. Preserve
  // operator-filled titles/narratives at matching ordinals; pad tail with
  // empty "Day N" cards on grow; trim tail on shrink. Operator typing
  // titles/narratives never causes overwrites because we only mutate the
  // length, not existing entries.
  useEffect(() => {
    const startIso = step1Draft.startAt;
    const endIso = step1Draft.endAt;
    if (startIso === null || endIso === null) return;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs <= startMs) return;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    // Inclusive day count: Aug 16 → Aug 22 = 7 days (the range itself
    // describes 6 nights + 7 calendar days). Operator's smoke wording
    // ("6 days") matches the night count, but the wizard models
    // calendar-days so we round up to nearest whole day and add 1 to
    // include both endpoints.
    const dayCount = Math.max(
      1,
      Math.floor((endMs - startMs) / MS_PER_DAY) + 1,
    );
    setDaysDraft((current) => {
      if (current.length === dayCount) return current;
      if (current.length < dayCount) {
        // Grow: append empty cards at next ordinals, preserve existing.
        const next = [...current];
        for (let i = current.length; i < dayCount; i += 1) {
          next.push({
            ordinal: i + 1,
            title: `Day ${i + 1}`,
            narrative: "",
          });
        }
        return next;
      }
      // Shrink: trim tail. Operator-filled entries within [0, dayCount)
      // are preserved.
      return current.slice(0, dayCount);
    });
  }, [step1Draft.startAt, step1Draft.endAt]);

  // Build a current Trip view for Step 5 preview (merges in-flight draft).
  const previewTrip: Trip = useMemo(
    () => ({
      ...trip,
      title: step1Draft.title,
      businessTrip: {
        startAt: step1Draft.startAt,
        endAt: step1Draft.endAt,
        destinationPlaceId: step1Draft.destinationPlaceId,
        destinationLocationText: step1Draft.destinationLocationText,
        destinationLat: step1Draft.destinationLat,
        destinationLng: step1Draft.destinationLng,
        capacity: step1Draft.capacity,
      },
      days: daysDraft.map((d, i) => ({
        id: `preview-day-${i}`,
        eventId: trip.id,
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative.length > 0 ? d.narrative : null,
        date: null,
        stops: [],
      })),
      inclusions: inclusionsDraft.map((i, idx) => ({
        id: `preview-inc-${idx}`,
        eventId: trip.id,
        kind: i.kind,
        item: i.item,
        ordinal: i.ordinal,
      })),
      pricingTiers:
        trip.pricingTiers.length > 0
          ? [
              {
                ...trip.pricingTiers[0],
                tierName: step4Draft.tierName,
                priceCents: Math.round(
                  (parseFloat(step4Draft.priceMajor) || 0) * 100,
                ),
                currency: step4Draft.currency,
                quantityTotal: step1Draft.capacity,
                isUnlimited: false,
              },
            ]
          : [],
    }),
    [trip, step1Draft, daysDraft, inclusionsDraft, step4Draft],
  );

  // ----- Autosave per step transition -----
  const autosaveStep1 = useCallback(async (): Promise<void> => {
    await updateBasicsMutation.mutateAsync({
      eventId: trip.id,
      brandId: trip.brandId,
      patch: {
        title: step1Draft.title.trim(),
        businessTrip: {
          startAt: step1Draft.startAt,
          endAt: step1Draft.endAt,
          destinationPlaceId: step1Draft.destinationPlaceId,
          destinationLocationText: step1Draft.destinationLocationText,
          destinationLat: step1Draft.destinationLat,
          destinationLng: step1Draft.destinationLng,
          capacity: step1Draft.capacity,
        },
      },
    });
  }, [step1Draft, trip.id, trip.brandId, updateBasicsMutation]);

  const autosaveStep2 = useCallback(async (): Promise<void> => {
    await upsertDaysMutation.mutateAsync({
      eventId: trip.id,
      days: daysDraft.map((d) => ({
        ordinal: d.ordinal,
        title: d.title.trim(),
        narrative: d.narrative.trim().length > 0 ? d.narrative.trim() : null,
      })),
    });
  }, [daysDraft, trip.id, upsertDaysMutation]);

  const autosaveStep3 = useCallback(async (): Promise<void> => {
    await upsertInclusionsMutation.mutateAsync({
      eventId: trip.id,
      items: inclusionsDraft.map((i) => ({
        kind: i.kind,
        item: i.item.trim(),
        ordinal: i.ordinal,
      })),
    });
  }, [inclusionsDraft, trip.id, upsertInclusionsMutation]);

  const autosaveStep4 = useCallback(async (): Promise<void> => {
    // ORCH-0859 REWORK 2: do NOT send currency from the wizard.
    // The service derives currency from events.currency (which is locked
    // at create time from brand.default_currency) to satisfy the
    // tg_enforce_event_ticket_currency trigger. Sending a user-typed
    // value caused `ticket_currency_must_match_event_currency` failures.
    const priceMajor = parseFloat(step4Draft.priceMajor) || 0;
    await updatePricingMutation.mutateAsync({
      eventId: trip.id,
      patch: {
        tierName: step4Draft.tierName.trim() || "Standard",
        priceCents: Math.round(priceMajor * 100),
        capacity: step1Draft.capacity ?? 1,
      },
    });
  }, [step4Draft, step1Draft.capacity, trip.id, updatePricingMutation]);

  const autosaveCurrentStep = useCallback(async (): Promise<void> => {
    setIsAutosaving(true);
    try {
      if (step === 1) await autosaveStep1();
      else if (step === 2) await autosaveStep2();
      else if (step === 3) await autosaveStep3();
      else if (step === 4) await autosaveStep4();
      // Step 5 doesn't autosave — it triggers publish via the footer.
    } finally {
      setIsAutosaving(false);
    }
  }, [step, autosaveStep1, autosaveStep2, autosaveStep3, autosaveStep4]);

  // ----- Navigation -----
  const handleNext = useCallback(async (): Promise<void> => {
    try {
      await autosaveCurrentStep();
      // ORCH-0859 REWORK 2 (item 7): clear any stale autosave-failure
      // banner from a previous failed step. Without this, an autosave
      // error set on Step 4 would persist visually into Step 5 even
      // after the operator went back, fixed the input, and re-saved.
      setPublishError(null);
      setStep((s) => (s < 5 ? ((s + 1) as StepIndex) : s));
    } catch {
      // Autosave failures bubble up as mutation errors — surface as banner
      setPublishError({
        code: "autosave_failed",
        message: "Couldn't save your changes. Check your connection and try again.",
        pointsToStep: step,
      });
    }
  }, [autosaveCurrentStep, step]);

  const handleBack = useCallback((): void => {
    if (step === 1) {
      onExit();
      return;
    }
    setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
    setPublishError(null);
  }, [step, onExit]);

  // ----- Publish -----
  const handlePublish = useCallback(async (): Promise<void> => {
    setPublishError(null);
    try {
      const published = await publishMutation.mutateAsync({
        eventId: trip.id,
        brandId: trip.brandId,
        draftPayload: {
          title: step1Draft.title.trim(),
          theme: {
            business_trip: {
              startAt: step1Draft.startAt,
              endAt: step1Draft.endAt,
              destinationPlaceId: step1Draft.destinationPlaceId,
              destinationLocationText: step1Draft.destinationLocationText,
              destinationLat: step1Draft.destinationLat,
              destinationLng: step1Draft.destinationLng,
              capacity: step1Draft.capacity,
            },
          },
          timezone: trip.timezone,
        },
      });
      onPublished(published);
    } catch (e) {
      const err = e as TripPublishValidationError;
      setPublishError(mapPublishErrorToState(err.code ?? "publish_failed", err.message));
    }
  }, [publishMutation, step1Draft, trip.id, trip.brandId, trip.timezone, onPublished]);

  // ----- Render -----
  const submitting = isAutosaving || publishMutation.isPending;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.host, { paddingTop: insets.top }]}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Exit wizard" : "Previous step"}
          style={styles.backBtn}
          hitSlop={8}
        >
          <Icon name="chevL" size={20} color={textTokens.primary} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text style={styles.stepCounter}>Step {step} of {STEP_COUNT}</Text>
          <Text style={styles.stepTitle}>{STEP_TITLES[step]}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {/* Step progress dots — ORCH-0859 REWORK 2 (operator smoke #4) */}
      <View
        style={styles.progressRow}
        accessibilityRole="progressbar"
        accessibilityLabel={`Step ${step} of ${STEP_COUNT}`}
        testID="trip-wizard-progress"
      >
        {Array.from({ length: STEP_COUNT }).map((_, idx) => {
          const idx1Based = idx + 1;
          const isComplete = idx1Based < step;
          const isCurrent = idx1Based === step;
          return (
            <View
              key={idx1Based}
              style={[
                styles.progressSegment,
                isComplete
                  ? styles.progressComplete
                  : isCurrent
                    ? styles.progressCurrent
                    : styles.progressUpcoming,
              ]}
            />
          );
        })}
      </View>

      {/* Step body */}
      <View style={styles.body}>
        {step === 1 ? (
          <TripCreatorStep1Basics
            draft={step1Draft}
            onChange={(patch) => setStep1Draft((s) => ({ ...s, ...patch }))}
            disabled={submitting}
          />
        ) : null}
        {step === 2 ? (
          <TripCreatorStep2Itinerary
            days={daysDraft}
            onChange={setDaysDraft}
            disabled={submitting}
          />
        ) : null}
        {step === 3 ? (
          <TripCreatorStep3Inclusions
            items={inclusionsDraft}
            onChange={setInclusionsDraft}
            disabled={submitting}
          />
        ) : null}
        {step === 4 ? (
          <TripCreatorStep4Pricing
            draft={step4Draft}
            onChange={(patch) => setStep4Draft((s) => ({ ...s, ...patch }))}
            disabled={submitting}
          />
        ) : null}
        {step === 5 ? (
          <TripCreatorStep5Review
            trip={previewTrip}
            brand={brand}
            publishError={publishError}
          />
        ) : null}
      </View>

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          label={
            submitting
              ? "Saving…"
              : step === 5
                ? publishError === null
                  ? "Publish trip"
                  : "Try publish again"
                : "Continue"
          }
          onPress={step === 5 ? handlePublish : handleNext}
          variant="primary"
          size="lg"
          loading={submitting}
          disabled={submitting}
          testID="trip-wizard-footer-cta"
        />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
    backgroundColor: "#0c0e12",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radiusTokens.sm,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  stepCounter: {
    fontSize: typography.caption.fontSize,
    fontWeight: "700",
    letterSpacing: 0.6,
    color: accent.warm,
  },
  stepTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  progressRow: {
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  progressComplete: {
    backgroundColor: accent.warm,
  },
  progressCurrent: {
    backgroundColor: accent.warm,
    opacity: 0.6,
  },
  progressUpcoming: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  body: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
});

export default TripCreatorWizard;
