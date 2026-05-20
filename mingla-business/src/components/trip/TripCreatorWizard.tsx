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
  Image,
  Keyboard,
  type KeyboardEvent,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
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
import {
  DESKTOP_BEZEL_MARGIN,
  DESKTOP_RAIL_WIDTH,
  DESKTOP_TOP_INSET,
  DESKTOP_WIZARD_FORM_MAX_WIDTH,
  DESKTOP_WIZARD_RAIL_WIDTH,
} from "../../constants/desktopLayout";
import { useResponsiveLayout } from "../../hooks/useResponsiveLayout";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { GlassCard } from "../ui/GlassCard";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Stepper } from "../ui/Stepper";
import type { StepperStep } from "../ui/Stepper";
import { TopBar } from "../ui/TopBar";
import { Toast } from "../ui/Toast";
import {
  useUpdateTripBasics,
  useUpsertTripDays,
  useUpsertTripInclusions,
  useUpdateTripPricing,
  usePublishTrip,
} from "../../hooks/useTrips";
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 autosave hooks.
import {
  useUpdateBookingDeadline,
  useUpdateRefundPolicy,
} from "../../hooks/useRefundPolicy";
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
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — NEW Step 5 component.
import {
  TripCreatorStep5Policy,
  type Step5Draft,
} from "./TripCreatorStep5Policy";
import {
  TripCreatorStep5Review,
  type PublishErrorState,
  mapPublishErrorToState,
} from "./TripCreatorStep5Review";
// ORCH-0880 [Tr5 Traveler Intake Forms] — NEW Step 6 component (intake
// schema builder + live preview, per-tier scope).
import { TripCreatorStep6Intake } from "./TripCreatorStep6Intake";
// ORCH-0880 — per-tier intake schema query + mutation hooks.
import {
  useTripIntakeSchemasByEvent,
  useUpsertTripIntakeSchema,
} from "../../hooks/useIntakeSchema";
import type { IntakeSchema } from "../../services/intakeSchemaService";
import type { TripPreviewBrand } from "./TripPreview";

/*
 * Desktop web wizard contract restored after regression:
 * useResponsiveLayout / isWideDesktop gate must protect the desktop-only
 * shell, renderDesktopAppRail, renderDesktopStepRail, desktopShell,
 * desktopTopBarWrap, desktopStepRail, desktopFormPane,
 * DESKTOP_RAIL_WIDTH, DESKTOP_TOP_INSET, DESKTOP_WIZARD_RAIL_WIDTH,
 * DESKTOP_WIZARD_FORM_MAX_WIDTH, and <TopBar leftKind="brand" />.
 * The mobile Stepper/chromeRow path must remain mobile/narrow-web only.
 */

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

type StepIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEP_TITLES: Record<StepIndex, string> = {
  1: "Basics",
  2: "Day by day",
  3: "What's included",
  4: "Pricing",
  5: "Cancellation & deadline",
  6: "Traveler info",
  7: "Review",
};

const STEP_SUBTITLES: Record<StepIndex, string> = {
  1: "Title, dates, destination, capacity",
  2: "Day-by-day itinerary",
  3: "What's included and excluded",
  4: "Pricing and payment plan",
  5: "Refund tiers and when bookings close",
  6: "What to ask travelers before they pay",
  7: "Preview and publish",
};

// ORCH-0880 [Tr5 Traveler Intake Forms] — wizard grew from 6 to 7 steps per
// DESIGN_ORCH-0880 §3.1. Step 6 NEW (per-tier traveler intake schema
// builder + live preview); Review moved to Step 7.
const STEP_COUNT = 7;

const STEPPER_STEPS: StepperStep[] = [
  { id: "step-1", label: STEP_TITLES[1] },
  { id: "step-2", label: STEP_TITLES[2] },
  { id: "step-3", label: STEP_TITLES[3] },
  { id: "step-4", label: STEP_TITLES[4] },
  { id: "step-5", label: STEP_TITLES[5] },
  { id: "step-6", label: STEP_TITLES[6] },
  { id: "step-7", label: STEP_TITLES[7] },
];

const MINGLA_BUSINESS_LOGO = require("../../../assets/brand/mingla-business-logo.png") as number;
const DESKTOP_WIZARD_NAV_ITEMS = [
  { label: "Home", icon: "home", href: "/(tabs)/home", active: false },
  { label: "Hub", icon: "calendar", href: "/(tabs)/hub/trips", active: true },
  { label: "Ari", icon: "sparkle", href: "/(tabs)/ari", active: false },
  { label: "Blast", icon: "send", href: "/(tabs)/marketing", active: false },
] as const;

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
    // ORCH-0876 — cover media seeded from current trip row.
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaType:
      trip.coverMediaType === "image" ||
      trip.coverMediaType === "video" ||
      trip.coverMediaType === "gif"
        ? trip.coverMediaType
        : null,
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

// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 draft seed from
// trip's persisted refund_policy + booking_deadline columns.
function tripToStep5Draft(trip: Trip): Step5Draft {
  return {
    refundPolicy: trip.refundPolicy,
    bookingDeadline: trip.bookingDeadline,
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
  step5Draft: Step5Draft,
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
    step1Draft.capacity !== initStep1.capacity ||
    // ORCH-0876 — cover fields part of Step 1 draft now.
    step1Draft.coverMediaUrl !== initStep1.coverMediaUrl ||
    step1Draft.coverMediaType !== initStep1.coverMediaType
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
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5: refundPolicy +
  // bookingDeadline equal to initial trip values.
  const initStep5 = tripToStep5Draft(trip);
  if (
    JSON.stringify(step5Draft.refundPolicy) !== JSON.stringify(initStep5.refundPolicy) ||
    step5Draft.bookingDeadline !== initStep5.bookingDeadline
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
  const router = useRouter();
  const { isWideDesktop } = useResponsiveLayout();
  const [step, setStep] = useState<StepIndex>(1);
  const [step1Draft, setStep1Draft] = useState<Step1Draft>(tripToStep1Draft(trip));
  const [daysDraft, setDaysDraft] = useState<TripDayDraft[]>(tripToDaysDraft(trip));
  const [inclusionsDraft, setInclusionsDraft] = useState<InclusionDraft[]>(
    tripToInclusionsDraft(trip),
  );
  const [step4Draft, setStep4Draft] = useState<Step4Draft>(tripToStep4Draft(trip));
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — new Step 5 (Cancellation
  // & deadline) state. Seeded from trip's persisted refund_policy +
  // booking_deadline columns.
  const [step5Draft, setStep5Draft] = useState<Step5Draft>(tripToStep5Draft(trip));
  // ORCH-0880 [Tr5 Traveler Intake Forms] — new Step 6 per-tier intake
  // schema state. Map<ticketTypeId, IntakeSchema | null>. null = planner
  // cleared the tier's schema (delete on autosave). Seeded from server
  // via useTripIntakeSchemasByEvent (see useEffect below).
  const [step6Draft, setStep6Draft] = useState<Map<string, IntakeSchema | null>>(
    new Map(),
  );
  // Track which tier ids' schemas the planner has touched since last
  // autosave; only these get upserted on autosaveStep6 to avoid
  // re-bumping schema_version_id on untouched tiers.
  const dirtyTierIdsRef = useRef<Set<string>>(new Set());
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
  // ORCH-0884 follow-up #9 — ScrollView ref passed to TripCreatorStep1Basics
  // → CoverPicker so the GIPHY/Pexels search TextInput can trigger an
  // explicit scroll-on-focus past iOS's auto-scroll position.
  const scrollViewRef = useRef<ScrollView | null>(null);
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
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 autosave hooks.
  const updateRefundPolicyMutation = useUpdateRefundPolicy();
  const updateBookingDeadlineMutation = useUpdateBookingDeadline();
  // ORCH-0880 [Tr5 Traveler Intake Forms] — Step 6 query + mutation.
  const intakeSchemasQuery = useTripIntakeSchemasByEvent(trip.id);
  const upsertIntakeSchemaMutation = useUpsertTripIntakeSchema();

  // Seed step6Draft from server-fetched schemas on first successful query.
  // After that, server data drift is handled via React Query cache
  // invalidation post-mutation; planner edits live in step6Draft until
  // autosave flushes back to server.
  const intakeSeededRef = useRef<boolean>(false);
  useEffect(() => {
    if (intakeSeededRef.current) return;
    if (intakeSchemasQuery.data === undefined) return;
    const seeded = new Map<string, IntakeSchema | null>();
    for (const [tierId, schema] of intakeSchemasQuery.data.entries()) {
      seeded.set(tierId, schema);
    }
    setStep6Draft(seeded);
    intakeSeededRef.current = true;
  }, [intakeSchemasQuery.data]);

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
        // ORCH-0876 — cover fields persist alongside basics. CoverPicker
        // emits patches synchronously into draft state; this writes them
        // to the events row on Continue / Back / Close (edit mode).
        coverMediaUrl: step1Draft.coverMediaUrl,
        coverMediaType: step1Draft.coverMediaType,
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

  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 autosave.
  // Writes refund_policy + booking_deadline via two parallel mutations.
  // Both target the events table; either may throw and propagate to
  // autosaveCurrentStep's catch.
  const autosaveStep5 = useCallback(async (): Promise<void> => {
    await Promise.all([
      updateRefundPolicyMutation.mutateAsync({
        eventId: trip.id,
        policy: step5Draft.refundPolicy,
      }),
      updateBookingDeadlineMutation.mutateAsync({
        eventId: trip.id,
        deadlineIso: step5Draft.bookingDeadline,
      }),
    ]);
  }, [
    step5Draft,
    trip.id,
    updateRefundPolicyMutation,
    updateBookingDeadlineMutation,
  ]);

  // ORCH-0880 [Tr5 Traveler Intake Forms] — Step 6 autosave. Iterates the
  // dirty-tier ref set, fires one upsertIntakeSchemaMutation per touched
  // tier (skipStatusProbe=true since wizard is always operating on a draft
  // trip), then clears the set. Mutations write directly to the
  // trip_intake_schemas table via RLS policy `trip_intake_schemas_planner_
  // all`; published-trip RPC path is reserved for EditPublishedTripScreen
  // accordion (Phase 4 surface, NOT this wizard).
  const autosaveStep6 = useCallback(async (): Promise<void> => {
    const dirty = Array.from(dirtyTierIdsRef.current);
    if (dirty.length === 0) return;
    await Promise.all(
      dirty.map((ticketTypeId) => {
        const schema = step6Draft.get(ticketTypeId) ?? null;
        return upsertIntakeSchemaMutation.mutateAsync({
          eventId: trip.id,
          ticketTypeId,
          schema,
          skipStatusProbe: true,
        });
      }),
    );
    dirtyTierIdsRef.current = new Set();
  }, [step6Draft, trip.id, upsertIntakeSchemaMutation]);

  const autosaveCurrentStep = useCallback(async (): Promise<void> => {
    setIsAutosaving(true);
    setAutosaveError(false);
    try {
      if (step === 1) await autosaveStep1();
      else if (step === 2) await autosaveStep2();
      else if (step === 3) await autosaveStep3();
      else if (step === 4) await autosaveStep4();
      else if (step === 5) await autosaveStep5();
      else if (step === 6) await autosaveStep6();
      setAutosaveSavedAt(new Date().toISOString());
    } catch (e) {
      setAutosaveError(true);
      throw e;
    } finally {
      setIsAutosaving(false);
    }
  }, [
    step,
    autosaveStep1,
    autosaveStep2,
    autosaveStep3,
    autosaveStep4,
    autosaveStep5,
    autosaveStep6,
  ]);

  // ----- Navigation -----
  const handleNext = useCallback(async (): Promise<void> => {
    try {
      await autosaveCurrentStep();
      setPublishError(null);
      // ORCH-0880 [Tr5 Traveler Intake Forms] — wizard grew 6→7 steps.
      setStep((s) => (s < 7 ? ((s + 1) as StepIndex) : s));
    } catch {
      setPublishError({
        code: "autosave_failed",
        message: "Couldn't save your changes. Check your connection and try again.",
        // Step 7 is Review-only (no autosave) so this branch never fires at
        // step === 7; clamp to satisfy the PublishErrorState.pointsToStep
        // union (1..5) which predates the wizard step expansion.
        pointsToStep: (step >= 5 ? 5 : step) as 1 | 2 | 3 | 4 | 5,
      });
    }
  }, [autosaveCurrentStep, step]);

  // ORCH-0876 — Back now autosaves before stepping back, mirroring
  // event wizard semantics so unsaved Step N edits aren't lost when the
  // operator returns to Step N-1. Autosave failure stays on the current
  // step with the persistent autosave-error banner; user can retry.
  const handleStepBack = useCallback(async (): Promise<void> => {
    if (step <= 1) return;
    try {
      await autosaveCurrentStep();
      setStep((s) => (s > 1 ? ((s - 1) as StepIndex) : s));
      setPublishError(null);
    } catch {
      setPublishError({
        code: "autosave_failed",
        message:
          "Couldn't save your changes. Check your connection and try again.",
        // Step 7 is Review-only (no autosave) so this branch never fires at
        // step === 7; clamp to satisfy the PublishErrorState.pointsToStep
        // union (1..5) which predates the wizard step expansion.
        pointsToStep: (step >= 5 ? 5 : step) as 1 | 2 | 3 | 4 | 5,
      });
    }
  }, [autosaveCurrentStep, step]);

  // ----- ORCH-0874 handleClose (chrome X) — branches on isCreateMode + pristine -----
  const handleClose = useCallback((): void => {
    if (isCreateMode) {
      const pristine = isTripWizardPristine(
        step1Draft,
        daysDraft,
        inclusionsDraft,
        step4Draft,
        step5Draft,
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
      // Edit mode — ORCH-0876: autosave any unsaved Step N edits before
      // exit so the operator doesn't lose changes when tapping the
      // chrome X. Autosave failure does NOT block exit (the persistent
      // autosave-error banner already surfaced); the user already chose
      // to leave.
      void (async (): Promise<void> => {
        try {
          await autosaveCurrentStep();
        } catch {
          // Silent — banner already flagged the failure; exit anyway.
        }
        onExit();
      })();
    }
  }, [
    isCreateMode,
    step1Draft,
    daysDraft,
    inclusionsDraft,
    step4Draft,
    step5Draft,
    trip,
    onDiscardTrip,
    onExit,
    autosaveCurrentStep,
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

  // ORCH-0876 — edit-mode "Saved" toast: when the operator is editing an
  // already-published trip's draft fields via this wizard (rare — published
  // trips route through EditPublishedTripScreen for the full Save flow),
  // surface a transient confirmation each time autosave succeeds so the
  // operator knows their change persisted. Skip in create mode (the dock
  // copy + subtitle "Saved" indicator already cover that path).
  const prevAutosaveSavedAtRef = useRef<string | null>(autosaveSavedAt);
  useEffect(() => {
    if (
      !isCreateMode &&
      autosaveSavedAt !== null &&
      autosaveSavedAt !== prevAutosaveSavedAtRef.current
    ) {
      showToast("Saved");
    }
    prevAutosaveSavedAtRef.current = autosaveSavedAt;
  }, [autosaveSavedAt, isCreateMode, showToast]);

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

  const handleDesktopRailNavigate = useCallback(
    (href: string): void => {
      router.replace(href as never);
    },
    [router],
  );

  const renderDesktopAppRail = (): React.ReactElement => (
    <View style={styles.desktopAppRail}>
      <View style={styles.desktopRailBrandMark}>
        <Image
          source={MINGLA_BUSINESS_LOGO}
          style={styles.desktopRailLogo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      {DESKTOP_WIZARD_NAV_ITEMS.map((item) => (
        <Pressable
          key={item.label}
          onPress={() => handleDesktopRailNavigate(item.href)}
          accessibilityRole="button"
          accessibilityLabel={`Go to ${item.label}`}
          style={[
            styles.desktopRailItem,
            item.active ? styles.desktopRailItemActive : null,
          ]}
        >
          <Icon
            name={item.icon}
            size={22}
            color={item.active ? accent.warm : textTokens.tertiary}
          />
          <Text
            style={[
              styles.desktopRailItemText,
              item.active ? styles.desktopRailItemTextActive : null,
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );

  const renderDesktopStepRail = (): React.ReactElement => (
    <GlassCard
      variant="base"
      padding={spacing.md}
      radius="lg"
      style={styles.desktopStepRail}
    >
      <View style={styles.desktopStepRailHeader}>
        <Text style={styles.desktopStepEyebrow}>Create trip</Text>
        <Text style={styles.desktopStepRailTitle} numberOfLines={2}>
          {step1Draft.title.trim().length > 0 ? step1Draft.title : "Untitled trip"}
        </Text>
        <Text style={styles.desktopStepRailSub} numberOfLines={1}>
          {brand.name} · Draft saved
        </Text>
      </View>
      <View style={styles.desktopStepList}>
        {STEPPER_STEPS.map((stepDef, index) => {
          const stepNumber = (index + 1) as StepIndex;
          const active = stepNumber === step;
          return (
            <View
              key={stepDef.id}
              style={[styles.desktopStepItem, active ? styles.desktopStepItemActive : null]}
            >
              <View
                style={[
                  styles.desktopStepIndex,
                  active ? styles.desktopStepIndexActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.desktopStepIndexText,
                    active ? styles.desktopStepIndexTextActive : null,
                  ]}
                >
                  {stepNumber}
                </Text>
              </View>
              <View style={styles.desktopStepCopy}>
                <Text
                  style={[
                    styles.desktopStepTitle,
                    active ? styles.desktopStepTitleActive : null,
                  ]}
                  numberOfLines={1}
                >
                  {STEP_TITLES[stepNumber]}
                </Text>
                <Text style={styles.desktopStepSub} numberOfLines={1}>
                  {STEP_SUBTITLES[stepNumber]}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </GlassCard>
  );

  return (
    <View
      style={[
        styles.host,
        {
          paddingTop: isWideDesktop ? 0 : insets.top,
          backgroundColor: canvas.discover,
        },
      ]}
    >
      {isWideDesktop ? renderDesktopAppRail() : null}
      {/* Chrome row: [Close X] [Stepper] [step counter] */}
      {isWideDesktop ? (
        <View style={styles.desktopTopBarWrap}>
          <TopBar
            leftKind="brand"
            rightSlot={
              <IconChrome
                icon="close"
                size={36}
                onPress={handleClose}
                accessibilityLabel="Close wizard"
              />
            }
          />
        </View>
      ) : (
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
      )}

      {/* Subtitle row: "{brand.name} · Step N of 5" + autosave state */}
      {isWideDesktop ? null : (
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
      )}

      <View style={isWideDesktop ? styles.desktopShell : styles.mobileShell}>
        {isWideDesktop ? renderDesktopStepRail() : null}
        <View style={isWideDesktop ? styles.desktopFormPane : styles.mobileFormPane}>

      {/* Body — canonical KeyboardAvoidingView pattern (ORCH-0884 follow-up
          #7). Prior attempts (auto-inset + manual paddingBottom alone) left
          the focused input HALF-COVERED by the keyboard because iOS's
          auto-scroll only puts the input TOP above the keyboard, not the
          full input. KeyboardAvoidingView with behavior="padding" shrinks
          the visible area by keyboardHeight so the ScrollView naturally
          fits its content above the keyboard. iOS's
          scrollResponderScrollNativeHandleToKeyboard then has a smaller
          visible area to scroll within, putting the focused input fully
          visible. keyboardVerticalOffset accounts for the chrome height
          above this view. */}
      <KeyboardAvoidingView
        style={styles.kbAvoid}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
      <ScrollView
        ref={scrollViewRef}
        style={styles.kbAvoid}
        contentContainerStyle={styles.body}
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
              brandId={trip.brandId}
              tripEventId={trip.id}
              onShowToast={showToast}
              parentScrollRef={scrollViewRef}
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
          {/* ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — NEW Step 5
              Cancellation & deadline. brand.timezone seeds the brand-TZ label
              on BookingDeadlinePicker; missing TZ falls back to UTC. */}
          {step === 5 ? (
            <TripCreatorStep5Policy
              draft={step5Draft}
              onChange={(patch) => setStep5Draft((s) => ({ ...s, ...patch }))}
              tripStartIso={step1Draft.startAt}
              brandTimezone={trip.timezone ?? null}
              disabled={submitting}
            />
          ) : null}
          {/* ORCH-0880 [Tr5 Traveler Intake Forms] — Step 6 per-tier intake
              schema builder + live preview. Per-tier state lives in step6Draft;
              touch tracking lives in dirtyTierIdsRef so autosaveStep6 only
              writes the tiers the planner actually changed. */}
          {step === 6 ? (
            <TripCreatorStep6Intake
              ticketTypes={trip.pricingTiers}
              schemasByTier={
                new Map(
                  Array.from(step6Draft.entries()).filter(
                    (entry): entry is [string, IntakeSchema] =>
                      entry[1] !== null,
                  ),
                )
              }
              onSchemaChange={(ticketTypeId, next) => {
                setStep6Draft((prev) => {
                  const cloned = new Map(prev);
                  cloned.set(ticketTypeId, next);
                  return cloned;
                });
                dirtyTierIdsRef.current = new Set([
                  ...dirtyTierIdsRef.current,
                  ticketTypeId,
                ]);
              }}
              disabled={submitting}
            />
          ) : null}
          {/* ORCH-0880: Review moved from Step 6 to Step 7. */}
          {step === 7 ? (
            <TripCreatorStep5Review
              trip={previewTrip}
              brand={brand}
              publishError={publishError}
            />
          ) : null}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

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
          ) : step === 7 ? (
            // ORCH-0880 [Tr5 Traveler Intake Forms] — Review (Publish) dock
            // moved from Step 6 to Step 7 (Step 6 NEW = traveler intake;
            // Step 7 NEW = Review). Steps 2-6 fall through to the generic
            // Back + Continue dock below.
            <View style={styles.dockButtonRow}>
              <View style={styles.dockBackCell}>
                <Button
                  label="Back"
                  variant="ghost"
                  size="md"
                  leadingIcon="chevL"
                  onPress={() => {
                    void handleStepBack();
                  }}
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
                  onPress={() => {
                    void handleStepBack();
                  }}
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
        </View>
      </View>

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
  mobileShell: {
    flex: 1,
  },
  mobileFormPane: {
    flex: 1,
  },
  desktopAppRail: {
    position: "absolute",
    zIndex: 20,
    elevation: 20,
    top: 0,
    left: 0,
    bottom: 0,
    width: DESKTOP_RAIL_WIDTH,
    alignItems: "center",
    paddingTop: spacing.xl,
    gap: spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "rgba(255, 255, 255, 0.06)",
  },
  desktopRailBrandMark: {
    width: 42,
    height: 42,
    marginBottom: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  desktopRailLogo: {
    width: 42,
    height: 42,
  },
  desktopRailItem: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "transparent",
  },
  desktopRailItemActive: {
    backgroundColor: "rgba(255, 255, 255, 0.055)",
    borderColor: "rgba(235, 120, 37, 0.45)",
  },
  desktopRailItemText: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "700",
    color: textTokens.tertiary,
  },
  desktopRailItemTextActive: {
    color: accent.warm,
  },
  desktopTopBarWrap: {
    paddingTop: DESKTOP_TOP_INSET,
    paddingLeft: DESKTOP_RAIL_WIDTH + DESKTOP_BEZEL_MARGIN,
    paddingRight: DESKTOP_BEZEL_MARGIN,
    paddingBottom: spacing.sm,
  },
  desktopShell: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingLeft: DESKTOP_RAIL_WIDTH + DESKTOP_BEZEL_MARGIN,
    paddingRight: DESKTOP_BEZEL_MARGIN,
    paddingBottom: DESKTOP_BEZEL_MARGIN,
  },
  desktopStepRail: {
    width: DESKTOP_WIZARD_RAIL_WIDTH,
    flexShrink: 0,
  },
  desktopStepRailHeader: {
    marginBottom: spacing.lg,
  },
  desktopStepEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: accent.warm,
    marginBottom: spacing.sm,
  },
  desktopStepRailTitle: {
    fontSize: typography.h3.fontSize,
    lineHeight: typography.h3.lineHeight,
    fontWeight: typography.h3.fontWeight,
    color: textTokens.primary,
  },
  desktopStepRailSub: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
  },
  desktopStepList: {
    gap: spacing.sm,
  },
  desktopStepItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
  },
  desktopStepItemActive: {
    backgroundColor: "rgba(235, 120, 37, 0.18)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(235, 120, 37, 0.45)",
  },
  desktopStepIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: glass.tint.profileBase,
  },
  desktopStepIndexActive: {
    backgroundColor: accent.warm,
  },
  desktopStepIndexText: {
    fontSize: typography.caption.fontSize,
    fontWeight: "800",
    color: textTokens.tertiary,
  },
  desktopStepIndexTextActive: {
    color: textTokens.inverse,
  },
  desktopStepCopy: {
    flex: 1,
    minWidth: 0,
  },
  desktopStepTitle: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "700",
    color: textTokens.tertiary,
  },
  desktopStepTitleActive: {
    color: textTokens.primary,
  },
  desktopStepSub: {
    marginTop: 2,
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  desktopFormPane: {
    flex: 1,
    maxWidth: DESKTOP_WIZARD_FORM_MAX_WIDTH,
    minWidth: 0,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.08)",
    backgroundColor: "rgba(255, 255, 255, 0.018)",
    overflow: "hidden",
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
