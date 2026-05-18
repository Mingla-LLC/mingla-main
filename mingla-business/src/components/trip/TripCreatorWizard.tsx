/**
 * TripCreatorWizard — host component for the 5-step trip-planner wizard.
 * Tr2 (ORCH-0859). Chrome rewritten in ORCH-0874 [Trip surfaces visual
 * parity with Events] per SPEC §3.3.5 + DESIGN §3.3 to mirror
 * EventCreatorWizard chrome:
 *
 *   - Chrome row: [Close X (always)] + [named Stepper] + [step counter]
 *   - Subtitle row: "{brand.name} · Step N of 5" + autosave-state text
 *   - Body: eyebrow + 26pt step title + 14pt subtitle (above step content)
 *   - Floating glass dock: Step 1 = single Continue; Steps 2-4 = Back+Continue;
 *     Step 5 = Back+Publish. Dock hides when keyboard up.
 *   - handleClose branches on isCreateMode + pristine:
 *     - Create + pristine: discard trip immediately + onExit
 *     - Create + dirty: show ConfirmDialog ("Discard this trip?")
 *     - Edit: silent onExit (autosave semantics)
 *   - Publish flow: ConfirmDialog ("Publish trip?") before mutation
 *   - Keyboard: explicit Keyboard.addListener + dynamic paddingBottom
 *     (replaces prior KeyboardAvoidingView per SPEC §3.3.5)
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md
 * Design: Mingla_Artifacts/design/DESIGN_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  accent,
  canvas,
  glass,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { IconChrome } from "../ui/IconChrome";
import { Stepper } from "../ui/Stepper";
import type { StepperStep } from "../ui/Stepper";
import { Toast } from "../ui/Toast";
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
  /**
   * True when this is the first edit of a freshly-created draft trip
   * (no title, no days, no inclusions, no pricing edits). Drives discard
   * semantics on Close X. Per SPEC_ORCH-0874 §3.3.5 + §3.3.6.
   */
  isCreateMode?: boolean;
  /**
   * Discard the entire trip draft (used by create-mode-dirty Close X
   * after user confirms in dialog). Optional — when not provided, the
   * Close X in create-mode-dirty falls back to silent exit (parent
   * decides). Per SPEC §3.3.6 option (a): route wires useSoftDeleteTrip.
   */
  onDiscardTrip?: () => Promise<void>;
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

const STEP_SUBTITLES: Record<StepIndex, string> = {
  1: "Title, dates, destination, capacity",
  2: "Day-by-day itinerary",
  3: "What's included and excluded",
  4: "Pricing and payment plan",
  5: "Preview and publish",
};

const STEP_COUNT = 5;

const STEPPER_STEPS: StepperStep[] = [
  { id: "step-1", label: STEP_TITLES[1] },
  { id: "step-2", label: STEP_TITLES[2] },
  { id: "step-3", label: STEP_TITLES[3] },
  { id: "step-4", label: STEP_TITLES[4] },
  { id: "step-5", label: STEP_TITLES[5] },
];

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
  return {
    tierName: tier?.tierName ?? "Standard",
    priceMajor: tier === undefined ? "" : (tier.priceCents / 100).toFixed(2),
    currency: tier?.currency ?? "USD",
    capacity: trip.businessTrip.capacity,
    paymentPlan: tier?.installmentSchedule ?? null,
    paymentPlanLocked: false,
  };
}

/**
 * Pristine check: returns true when none of the 4 step drafts have diverged
 * from the server-derived initial values. Used to skip the discard dialog
 * on a freshly-created create-mode draft (no edits → silent discard).
 *
 * Per SPEC_ORCH-0874 §3.3.5 handleClose pristine branch.
 */
function isTripWizardPristine(
  step1Draft: Step1Draft,
  daysDraft: TripDayDraft[],
  inclusionsDraft: InclusionDraft[],
  step4Draft: Step4Draft,
  trip: Trip,
): boolean {
  // Step 1: every field equal to trip-derived initial
  const initStep1 = tripToStep1Draft(trip);
  if (
    step1Draft.title !== initStep1.title ||
    step1Draft.startAt !== initStep1.startAt ||
    step1Draft.endAt !== initStep1.endAt ||
    step1Draft.destinationPlaceId !== initStep1.destinationPlaceId ||
    step1Draft.destinationLocationText !== initStep1.destinationLocationText ||
    step1Draft.destinationLat !== initStep1.destinationLat ||
    step1Draft.destinationLng !== initStep1.destinationLng ||
    step1Draft.capacity !== initStep1.capacity
  ) {
    return false;
  }
  // Step 2: days length + every (ordinal, title, narrative) equal
  const initDays = tripToDaysDraft(trip);
  if (daysDraft.length !== initDays.length) return false;
  for (let i = 0; i < daysDraft.length; i += 1) {
    if (
      daysDraft[i].ordinal !== initDays[i].ordinal ||
      daysDraft[i].title !== initDays[i].title ||
      daysDraft[i].narrative !== initDays[i].narrative
    ) {
      return false;
    }
  }
  // Step 3: inclusions length + every (kind, item, ordinal) equal
  const initInclusions = tripToInclusionsDraft(trip);
  if (inclusionsDraft.length !== initInclusions.length) return false;
  for (let i = 0; i < inclusionsDraft.length; i += 1) {
    if (
      inclusionsDraft[i].kind !== initInclusions[i].kind ||
      inclusionsDraft[i].item !== initInclusions[i].item ||
      inclusionsDraft[i].ordinal !== initInclusions[i].ordinal
    ) {
      return false;
    }
  }
  // Step 4: tierName + priceMajor + capacity + paymentPlan equal
  const initStep4 = tripToStep4Draft(trip);
  if (
    step4Draft.tierName !== initStep4.tierName ||
    step4Draft.priceMajor !== initStep4.priceMajor ||
    step4Draft.capacity !== initStep4.capacity ||
    JSON.stringify(step4Draft.paymentPlan) !== JSON.stringify(initStep4.paymentPlan)
  ) {
    return false;
  }
  return true;
}

export const TripCreatorWizard: React.FC<TripCreatorWizardProps> = ({
  trip,
  brand,
  isCreateMode = false,
  onDiscardTrip,
  onPublished,
  onExit,
}) => {
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
  const [autosaveError, setAutosaveError] = useState<boolean>(false);
  const [autosaveSavedAt, setAutosaveSavedAt] = useState<string | null>(null);

  // ORCH-0874: discard ConfirmDialog state (create-mode-dirty close).
  const [discardDialogVisible, setDiscardDialogVisible] = useState<boolean>(false);
  const [isDiscarding, setIsDiscarding] = useState<boolean>(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  // ORCH-0874: publish ConfirmDialog state (Step 5 publish tap).
  const [publishConfirmVisible, setPublishConfirmVisible] = useState<boolean>(false);

  // ORCH-0874: toast for transient feedback (discard error, etc.).
  const [toast, setToast] = useState<{ visible: boolean; message: string }>({
    visible: false,
    message: "",
  });
  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);
  const dismissToast = useCallback((): void => {
    setToast((p) => ({ ...p, visible: false }));
  }, []);

  // ORCH-0874: keyboard listener pattern (mirrors EventCreatorWizard:262-312).
  // Replaces prior KeyboardAvoidingView. paddingBottom = keyboardHeight on
  // ScrollView contentContainerStyle so the focused bottom-most input sits
  // immediately above the keyboard with no visible gap; dock hides while
  // keyboard is visible.
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvent, (e: KeyboardEvent): void => {
      setKeyboardVisible(true);
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

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

  // ORCH-0859 REWORK 3: auto-seed days from Step 1 date range (unchanged).
  useEffect(() => {
    const startIso = step1Draft.startAt;
    const endIso = step1Draft.endAt;
    if (startIso === null || endIso === null) return;
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return;
    if (endMs <= startMs) return;
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const dayCount = Math.max(
      1,
      Math.floor((endMs - startMs) / MS_PER_DAY) + 1,
    );
    setDaysDraft((current) => {
      if (current.length === dayCount) return current;
      if (current.length < dayCount) {
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
    const priceMajor = parseFloat(step4Draft.priceMajor) || 0;
    await updatePricingMutation.mutateAsync({
      eventId: trip.id,
      patch: {
        tierName: step4Draft.tierName.trim() || "Standard",
        priceCents: Math.round(priceMajor * 100),
        capacity: step1Draft.capacity ?? 1,
        installmentSchedule: step4Draft.paymentPlan,
      },
    });
  }, [step4Draft, step1Draft.capacity, trip.id, updatePricingMutation]);

  const autosaveCurrentStep = useCallback(async (): Promise<void> => {
    setIsAutosaving(true);
    setAutosaveError(false);
    try {
      if (step === 1) await autosaveStep1();
      else if (step === 2) await autosaveStep2();
      else if (step === 3) await autosaveStep3();
      else if (step === 4) await autosaveStep4();
      setAutosaveSavedAt(new Date().toISOString());
    } catch (e) {
      setAutosaveError(true);
      throw e;
    } finally {
      setIsAutosaving(false);
    }
  }, [step, autosaveStep1, autosaveStep2, autosaveStep3, autosaveStep4]);

  // ----- Navigation -----
  const handleNext = useCallback(async (): Promise<void> => {
    try {
      await autosaveCurrentStep();
      setPublishError(null);
      setStep((s) => (s < 5 ? ((s + 1) as StepIndex) : s));
    } catch {
      setPublishError({
        code: "autosave_failed",
        message: "Couldn't save your changes. Check your connection and try again.",
        pointsToStep: step,
      });
    }
  }, [autosaveCurrentStep, step]);

  const handleStepBack = useCallback((): void => {
    if (step <= 1) return;
    setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
    setPublishError(null);
  }, [step]);

  // ----- ORCH-0874 handleClose (chrome X) — branches on isCreateMode + pristine -----
  const handleClose = useCallback((): void => {
    if (isCreateMode) {
      const pristine = isTripWizardPristine(
        step1Draft,
        daysDraft,
        inclusionsDraft,
        step4Draft,
        trip,
      );
      if (pristine) {
        // No edits — discard silently + exit. If onDiscardTrip absent,
        // fall through to silent exit (parent handles).
        if (onDiscardTrip !== undefined) {
          void (async (): Promise<void> => {
            try {
              await onDiscardTrip();
            } catch {
              // Discard failed silently is acceptable here — the user
              // intent was "leave without saving", not "delete this trip".
              // The orphan draft will surface on /hub/trips for cleanup.
            }
            onExit();
          })();
        } else {
          onExit();
        }
      } else {
        // Dirty — open Discard ConfirmDialog.
        setDiscardError(null);
        setDiscardDialogVisible(true);
      }
    } else {
      // Edit mode — silent exit (autosave semantics).
      onExit();
    }
  }, [
    isCreateMode,
    step1Draft,
    daysDraft,
    inclusionsDraft,
    step4Draft,
    trip,
    onDiscardTrip,
    onExit,
  ]);

  const handleCloseDiscardDialog = useCallback((): void => {
    if (isDiscarding) return;
    setDiscardDialogVisible(false);
    setDiscardError(null);
  }, [isDiscarding]);

  const handleConfirmDiscard = useCallback(async (): Promise<void> => {
    if (onDiscardTrip === undefined) {
      // No discard handler wired — close dialog and exit anyway.
      setDiscardDialogVisible(false);
      onExit();
      return;
    }
    setDiscardError(null);
    setIsDiscarding(true);
    try {
      await onDiscardTrip();
      setDiscardDialogVisible(false);
      onExit();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Couldn't discard. Try again.";
      setDiscardError(message);
    } finally {
      setIsDiscarding(false);
    }
  }, [onDiscardTrip, onExit]);

  // ----- Publish -----
  const handlePublishTap = useCallback((): void => {
    // Open ConfirmDialog; actual publish runs in handleConfirmPublish.
    setPublishConfirmVisible(true);
  }, []);

  const handleConfirmPublish = useCallback(async (): Promise<void> => {
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
      setPublishConfirmVisible(false);
      onPublished(published);
    } catch (e) {
      const err = e as TripPublishValidationError;
      setPublishConfirmVisible(false);
      setPublishError(mapPublishErrorToState(err.code ?? "publish_failed", err.message));
    }
  }, [publishMutation, step1Draft, trip.id, trip.brandId, trip.timezone, onPublished]);

  // Suppress autosave-error toast surfacing via setPublishError; show via
  // the persistent banner in Step 5. Show toast for discard errors only.
  useEffect(() => {
    if (discardError !== null) {
      showToast(discardError);
    }
  }, [discardError, showToast]);

  // ----- Render -----
  const submitting = isAutosaving || publishMutation.isPending;
  const stepIdx = step - 1; // Stepper is 0-indexed; state is 1-indexed.
  const stepTitle = STEP_TITLES[step];
  const stepSubtitle = STEP_SUBTITLES[step];

  // Autosave state copy for subtitle row.
  const autosaveStateText = useMemo<string>(() => {
    if (autosaveError) return "Unsaved changes — retrying";
    if (isAutosaving) return "Saving…";
    if (autosaveSavedAt !== null) return "Saved";
    return "";
  }, [autosaveError, isAutosaving, autosaveSavedAt]);

  // Publish dialog description: destination + dates if available.
  const publishDialogDescription = useMemo<string>(() => {
    const dest = step1Draft.destinationLocationText;
    const start = step1Draft.startAt;
    const end = step1Draft.endAt;
    let datesLabel = "";
    if (start !== null) {
      try {
        const fmt = new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
        });
        datesLabel = `${fmt.format(new Date(start))}${
          end !== null ? `–${fmt.format(new Date(end))}` : ""
        }`;
      } catch {
        datesLabel = "";
      }
    }
    const prefix = dest !== null && dest.length > 0
      ? `${dest}${datesLabel.length > 0 ? ` · ${datesLabel}` : ""}`
      : datesLabel;
    return `${prefix ? prefix + ". " : ""}Buyers can book immediately. You can edit details after publishing.`;
  }, [step1Draft.destinationLocationText, step1Draft.startAt, step1Draft.endAt]);

  return (
    <View
      style={[styles.host, { paddingTop: insets.top, backgroundColor: canvas.discover }]}
    >
      {/* Chrome row: [Close X] [Stepper] [step counter] */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleClose}
          accessibilityLabel="Close wizard"
        />
        <View style={styles.stepperWrap}>
          <Stepper
            steps={STEPPER_STEPS}
            currentIndex={stepIdx}
            showCaption={false}
          />
        </View>
        <Text style={styles.stepCounter} testID="trip-wizard-step-counter">
          {step}/{STEP_COUNT}
        </Text>
      </View>

      {/* Subtitle row: "{brand.name} · Step N of 5" + autosave state */}
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          {brand.name} · Step {step} of {STEP_COUNT}
        </Text>
        {autosaveStateText.length > 0 ? (
          <Text
            style={[styles.saveState, autosaveError && styles.saveStateError]}
          >
            {autosaveStateText}
          </Text>
        ) : null}
      </View>

      {/* Body */}
      <ScrollView
        style={styles.kbAvoid}
        contentContainerStyle={[
          styles.body,
          keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : null,
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>
          STEP {step} OF {STEP_COUNT}
        </Text>
        <Text style={styles.stepTitle}>{stepTitle}</Text>
        <Text style={styles.stepSub}>{stepSubtitle}</Text>

        <View style={styles.stepBodyWrap}>
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
      </ScrollView>

      {/* Dock — sleek floating glass card. Hidden when keyboard up. */}
      {keyboardVisible ? null : (
        <GlassCard
          variant="elevated"
          padding={0}
          radius="xxl"
          style={styles.dock}
        >
          {step === 1 ? (
            <Button
              label={submitting ? "Saving…" : "Continue"}
              onPress={() => {
                void handleNext();
              }}
              variant="primary"
              size="md"
              loading={submitting}
              disabled={submitting}
              fullWidth
              testID="trip-wizard-footer-cta"
            />
          ) : step === 5 ? (
            <View style={styles.dockButtonRow}>
              <View style={styles.dockBackCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  leadingIcon="chevL"
                  onPress={handleStepBack}
                  disabled={submitting}
                  fullWidth
                />
              </View>
              <View style={styles.dockPublishCell}>
                <Button
                  label={
                    submitting
                      ? "Publishing…"
                      : publishError === null
                        ? "Publish trip"
                        : "Try publish again"
                  }
                  variant="primary"
                  size="md"
                  onPress={handlePublishTap}
                  loading={submitting}
                  disabled={submitting}
                  fullWidth
                  testID="trip-wizard-footer-cta"
                />
              </View>
            </View>
          ) : (
            <View style={styles.dockButtonRow}>
              <View style={styles.dockBackCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  onPress={handleStepBack}
                  disabled={submitting}
                  fullWidth
                />
              </View>
              <View style={styles.dockPrimaryCell}>
                <Button
                  label={submitting ? "Saving…" : "Continue"}
                  variant="primary"
                  size="md"
                  onPress={() => {
                    void handleNext();
                  }}
                  loading={submitting}
                  disabled={submitting}
                  fullWidth
                  testID="trip-wizard-footer-cta"
                />
              </View>
            </View>
          )}
        </GlassCard>
      )}

      {/* Overlays at root — discard ConfirmDialog, publish ConfirmDialog, Toast wrap */}
      <ConfirmDialog
        visible={discardDialogVisible}
        onClose={handleCloseDiscardDialog}
        onConfirm={handleConfirmDiscard}
        title="Discard this trip?"
        description="You'll lose your changes."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmLoading={isDiscarding}
        confirmDisabled={isDiscarding}
        closeDisabled={isDiscarding}
        errorMessage={discardError}
        destructive
        testID="trip-wizard-discard-dialog"
      />

      <ConfirmDialog
        visible={publishConfirmVisible}
        onClose={() => setPublishConfirmVisible(false)}
        onConfirm={handleConfirmPublish}
        title="Publish trip?"
        description={publishDialogDescription}
        confirmLabel="Publish"
        cancelLabel="Cancel"
        confirmLoading={publishMutation.isPending}
        confirmDisabled={publishMutation.isPending}
        closeDisabled={publishMutation.isPending}
        testID="trip-wizard-publish-dialog"
      />

      <View style={styles.toastWrap} pointerEvents="box-none">
        <Toast
          visible={toast.visible}
          kind="info"
          message={toast.message}
          onDismiss={dismissToast}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  kbAvoid: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  stepperWrap: {
    flex: 1,
  },
  stepCounter: {
    fontSize: 12,
    color: textTokens.tertiary,
    fontVariant: ["tabular-nums"],
    minWidth: 28,
    textAlign: "right",
  },
  subtitleRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  subtitle: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  saveState: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  saveStateError: {
    color: semantic.error,
  },
  body: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: 6,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: "700",
    letterSpacing: -0.2,
    color: textTokens.primary,
    marginBottom: 6,
  },
  stepSub: {
    fontSize: 14,
    color: textTokens.secondary,
    marginBottom: spacing.lg,
  },
  stepBodyWrap: {
    // step body content
  },
  dock: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  dockButtonRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  dockBackCell: {
    flex: 1,
  },
  dockPrimaryCell: {
    flex: 1,
  },
  dockPublishCell: {
    flex: 2,
  },
  toastWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  // suppress unused
  _unused: {
    color: glass.tint.profileBase,
  },
});

export default TripCreatorWizard;
