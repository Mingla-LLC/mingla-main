/**
 * EditPublishedTripScreen — sectioned full edit-after-publish surface for
 * trips (ORCH-0876). Trip-side mirror of `EditPublishedScreen.tsx`.
 *
 * Replaces the published-trip path through TripCreatorWizard, which is
 * create-mode-shaped (5-step linear with publish dock + autosave per step
 * transition). Once a trip is `scheduled` or `live`, the operator instead
 * lands on this 6-section accordion that consumes the existing wizard
 * step bodies via local edit state.
 *
 * Sections (one expanded at a time):
 *   1. Basics      → title + description (editable)
 *   2. Itinerary   → TripCreatorStep2Itinerary
 *   3. Inclusions  → TripCreatorStep3Inclusions
 *   4. Pricing     → TripCreatorStep4Pricing (with editMode.soldCountForTier)
 *   5. Cover       → shared <CoverPicker>
 *   6. Settings    → read-only refund-policy + booking-deadline snapshot
 *
 * Save flow:
 *   1. Compute LiveTripPatch via local-state → diff against `trip`
 *   2. Empty patch → toast "No changes to save."
 *   3. Otherwise → ChangeSummaryModal opens with field/day/inclusion/tier
 *      diffs + severity + required reason input + entityLabel="trip"
 *   4. Modal Confirm → handleConfirmSave(reason) → client-side
 *      validateLiveTripFieldUpdate fast-path → server `biz_update_live_trip`
 *      RPC via `useUpdateLiveTripFields` mutation
 *   5. ok=true → notifyTripChanged (fire-and-forget) → toast "Saved." →
 *      router.back
 *   6. ok=false → reject dialog "Refund first" with "Open Orders" CTA
 *      (stub until trip-orders ledger ships)
 *
 * Architecture: F-17 LEAPFROG. Trips write atomically server-side via
 * `biz_update_live_trip` RPC across events + trip_days + trip_inclusions
 * + trip_pricing_tiers + ticket_types + trip_edit_log in a single
 * transaction. Skips the events' Zustand-only-write tech debt entirely.
 *
 * Audit-test invariant: trip mutations route through the RPC; this
 * screen MUST NOT call any direct trip_days / trip_inclusions /
 * trip_pricing_tiers UPDATE/DELETE/INSERT.
 *
 * Per SPEC_ORCH-0876_V2_FULL_PARITY §6 + §7.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Keyboard,
  type KeyboardEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Toast } from "../ui/Toast";
import {
  CoverPicker,
  type CoverPatch,
} from "../ui/CoverPicker";

import { ChangeSummaryModal } from "../event/ChangeSummaryModal";
import { EditAfterPublishTripBanner } from "./EditAfterPublishTripBanner";
// ORCH-0880 [Tr5 Traveler Intake Forms] — new accordion section body.
import { EditPublishedTripIntakeAccordion } from "./EditPublishedTripIntakeAccordion";

import type {
  Trip,
  LiveTripPatch,
  TripDayInput,
  TripInclusionInput,
  TripPricingTierInput,
  UpdateLiveTripResult,
} from "../../services/tripsService";
import { UpdateLiveTripPermissionError } from "../../services/tripsService";
import {
  computeRichTripFieldDiffs,
  computeTripDayDiffs,
  computeTripInclusionDiffs,
  computeTripPricingTierDiffs,
  classifyTripSeverity,
  type TripFieldDiff,
  type TripDayDiff,
  type TripInclusionDiff,
  type TripPricingTierDiff,
  type TripEditSeverity,
} from "../../utils/tripAdapter";
import { validateLiveTripFieldUpdate } from "../../utils/publishedTripEditGuards";
import { useUpdateLiveTripFields } from "../../hooks/useTrips";
import { useTripHasWebPurchases } from "../../hooks/useTripHasWebPurchases";
import {
  deriveTripChannelFlags,
  notifyTripChanged,
} from "../../services/tripChangeNotifier";

import { TripCreatorStep2Itinerary } from "./TripCreatorStep2Itinerary";
import { TripCreatorStep3Inclusions } from "./TripCreatorStep3Inclusions";
import {
  TripCreatorStep4Pricing,
  type Step4Draft,
} from "./TripCreatorStep4Pricing";
import { InstallmentScheduleDisplay } from "./InstallmentScheduleDisplay";
import { projectInstallmentSchedule } from "../../utils/installmentScheduleProjection";
import type { TripDayDraft } from "./TripDayEditor";
import type { InclusionDraft } from "./TripCreatorStep3Inclusions";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import type { EventCoverMediaProvider } from "../../types/eventCoverProvider";

// ---- Section configuration -----------------------------------------

type SectionKey =
  | "basics"
  | "itinerary"
  | "inclusions"
  | "pricing"
  | "cover"
  // ORCH-0880 [Tr5 Traveler Intake Forms] — new accordion section.
  | "intake"
  | "settings";

interface SectionConfig {
  key: SectionKey;
  label: string;
}

const SECTIONS: readonly SectionConfig[] = [
  { key: "basics", label: "Basics" },
  { key: "itinerary", label: "Itinerary" },
  { key: "inclusions", label: "Inclusions" },
  { key: "pricing", label: "Pricing" },
  { key: "cover", label: "Cover" },
  // ORCH-0880 — sits between Cover and Settings per DESIGN §6.
  { key: "intake", label: "Intake form" },
  { key: "settings", label: "Settings" },
];

const SAVE_PROCESSING_MS = 800;
const TOAST_NAV_DELAY_MS = 600;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ---- Local edit state --------------------------------------------------

interface LocalTripEditState {
  // Basics
  title: string;
  description: string | null;
  // theme.business_trip
  startAt: string | null;
  endAt: string | null;
  destinationPlaceId: string | null;
  destinationLocationText: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
  capacity: number | null;
  // Itinerary
  days: TripDayDraft[];
  // Inclusions
  inclusions: InclusionDraft[];
  // Pricing — single-tier model (trip-side enforces 1 tier per ORCH-0859)
  pricing: Step4Draft;
  // Cover
  coverMediaUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  coverMediaProvider: EventCoverMediaProvider | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
}

function tripToLocalEditState(trip: Trip): LocalTripEditState {
  const firstTier = trip.pricingTiers[0];
  // Convert the cover_media_type wire value to the EventCoverMediaType union.
  const coverType: EventCoverMediaType | null =
    trip.coverMediaType === "image" ||
    trip.coverMediaType === "video" ||
    trip.coverMediaType === "gif"
      ? trip.coverMediaType
      : null;
  return {
    title: trip.title,
    description: trip.description,
    startAt: trip.businessTrip.startAt,
    endAt: trip.businessTrip.endAt,
    destinationPlaceId: trip.businessTrip.destinationPlaceId,
    destinationLocationText: trip.businessTrip.destinationLocationText,
    destinationLat: trip.businessTrip.destinationLat,
    destinationLng: trip.businessTrip.destinationLng,
    capacity: trip.businessTrip.capacity,
    days: trip.days.map((d) => ({
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative ?? "",
    })),
    inclusions: trip.inclusions.map((i) => ({
      kind: i.kind,
      item: i.item,
      ordinal: i.ordinal,
    })),
    pricing: {
      tierName: firstTier?.tierName ?? "Standard",
      priceMajor:
        firstTier === undefined ? "" : (firstTier.priceCents / 100).toFixed(2),
      currency: firstTier?.currency ?? "USD",
      capacity: trip.businessTrip.capacity,
      paymentPlan: firstTier?.installmentSchedule ?? null,
      paymentPlanLocked: false,
    },
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaType: coverType,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
  };
}

// ---- Patch computation ------------------------------------------------

interface PatchComputeResult {
  patch: LiveTripPatch;
  dayDiffs: TripDayDiff[];
  inclusionDiffs: TripInclusionDiff[];
  pricingTierDiffs: TripPricingTierDiff[];
  droppedDayOrdinals: number[];
  droppedInclusionKeys: string[];
  tierPriceChangedTicketTypeIds: string[];
}

function buildLiveTripPatch(
  trip: Trip,
  state: LocalTripEditState,
): PatchComputeResult {
  const patch: LiveTripPatch = {};

  // Title
  const titleTrim = state.title.trim();
  if (titleTrim !== trip.title) patch.title = titleTrim;

  // Description
  const descNormalized =
    state.description === null || state.description.trim().length === 0
      ? null
      : state.description;
  if (descNormalized !== trip.description) patch.description = descNormalized;

  // theme.business_trip — only include keys that changed
  const bt: Partial<{
    startAt: string | null;
    endAt: string | null;
    destinationPlaceId: string | null;
    destinationLocationText: string | null;
    destinationLat: number | null;
    destinationLng: number | null;
    capacity: number | null;
  }> = {};
  if (state.startAt !== trip.businessTrip.startAt) bt.startAt = state.startAt;
  if (state.endAt !== trip.businessTrip.endAt) bt.endAt = state.endAt;
  if (state.destinationPlaceId !== trip.businessTrip.destinationPlaceId) {
    bt.destinationPlaceId = state.destinationPlaceId;
  }
  if (
    state.destinationLocationText !==
    trip.businessTrip.destinationLocationText
  ) {
    bt.destinationLocationText = state.destinationLocationText;
  }
  if (state.destinationLat !== trip.businessTrip.destinationLat) {
    bt.destinationLat = state.destinationLat;
  }
  if (state.destinationLng !== trip.businessTrip.destinationLng) {
    bt.destinationLng = state.destinationLng;
  }
  if (state.capacity !== trip.businessTrip.capacity) {
    bt.capacity = state.capacity;
  }
  if (Object.keys(bt).length > 0) patch.theme = { business_trip: bt };

  // Days — full DELETE-then-INSERT semantics on the server; emit when any
  // field changed, ordinal added or removed.
  const oldDaysSig = JSON.stringify(
    trip.days
      .map((d) => ({
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative ?? "",
      }))
      .sort((a, b) => a.ordinal - b.ordinal),
  );
  const newDaysCanonical = state.days.map((d) => ({
    ordinal: d.ordinal,
    title: d.title.trim(),
    narrative: d.narrative.trim().length > 0 ? d.narrative.trim() : "",
  }));
  const newDaysSig = JSON.stringify(
    newDaysCanonical
      .map((d) => ({ ordinal: d.ordinal, title: d.title, narrative: d.narrative }))
      .sort((a, b) => a.ordinal - b.ordinal),
  );
  const daysChanged = oldDaysSig !== newDaysSig;
  if (daysChanged) {
    patch.days = newDaysCanonical.map<TripDayInput>((d) => ({
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative.length > 0 ? d.narrative : null,
    }));
  }
  const dayDiffs = daysChanged
    ? computeTripDayDiffs(trip.days, patch.days ?? [])
    : [];
  const droppedDayOrdinals = dayDiffs
    .filter((d) => d.status === "removed")
    .map((d) => d.ordinal);

  // Inclusions
  const oldIncSig = JSON.stringify(
    trip.inclusions
      .map((i) => ({ kind: i.kind, item: i.item, ordinal: i.ordinal }))
      .sort((a, b) =>
        a.kind === b.kind ? a.ordinal - b.ordinal : a.kind.localeCompare(b.kind),
      ),
  );
  const newIncCanonical = state.inclusions.map((i) => ({
    kind: i.kind,
    item: i.item.trim(),
    ordinal: i.ordinal,
  }));
  const newIncSig = JSON.stringify(
    newIncCanonical
      .slice()
      .sort((a, b) =>
        a.kind === b.kind ? a.ordinal - b.ordinal : a.kind.localeCompare(b.kind),
      ),
  );
  const inclusionsChanged = oldIncSig !== newIncSig;
  if (inclusionsChanged) {
    patch.inclusions = newIncCanonical as TripInclusionInput[];
  }
  const inclusionDiffs = inclusionsChanged
    ? computeTripInclusionDiffs(trip.inclusions, patch.inclusions ?? [])
    : [];
  const droppedInclusionKeys = inclusionDiffs
    .filter((d) => d.status === "removed")
    .map((d) => d.key);

  // Pricing tiers — single-tier model. Only emit when tier_name or
  // price_cents or installmentSchedule differs from the trip's current tier.
  const newPriceCents = Math.round(
    (parseFloat(state.pricing.priceMajor) || 0) * 100,
  );
  const firstTier = trip.pricingTiers[0];
  const tierNameChanged =
    firstTier !== undefined &&
    state.pricing.tierName.trim().length > 0 &&
    state.pricing.tierName.trim() !== firstTier.tierName;
  const tierPriceChanged =
    firstTier !== undefined && newPriceCents !== firstTier.priceCents;
  const oldPlanSig = JSON.stringify(firstTier?.installmentSchedule ?? null);
  const newPlanSig = JSON.stringify(state.pricing.paymentPlan ?? null);
  const tierPlanChanged = oldPlanSig !== newPlanSig;
  if (
    firstTier !== undefined &&
    (tierNameChanged || tierPriceChanged || tierPlanChanged)
  ) {
    const tierMetadata: Record<string, unknown> = {};
    if (state.pricing.paymentPlan !== null) {
      tierMetadata.installments = state.pricing.paymentPlan;
    }
    patch.pricing_tiers = [
      {
        ticket_type_id: firstTier.ticketTypeId,
        tier_name: tierNameChanged ? state.pricing.tierName.trim() : undefined,
        price_cents: tierPriceChanged ? newPriceCents : undefined,
        tier_metadata: tierPlanChanged ? tierMetadata : undefined,
      } as TripPricingTierInput,
    ];
  }
  const pricingTierDiffs =
    patch.pricing_tiers !== undefined
      ? computeTripPricingTierDiffs(trip.pricingTiers, patch.pricing_tiers)
      : [];
  const tierPriceChangedTicketTypeIds = pricingTierDiffs
    .filter((d) => d.status === "modified" && d.oldPriceCents !== d.newPriceCents)
    .map((d) => d.ticketTypeId);

  // Cover (7-field)
  if (state.coverMediaUrl !== trip.coverMediaUrl) {
    patch.cover_media_url = state.coverMediaUrl;
  }
  if (
    state.coverMediaType !==
    (trip.coverMediaType === "image" ||
    trip.coverMediaType === "video" ||
    trip.coverMediaType === "gif"
      ? trip.coverMediaType
      : null)
  ) {
    patch.cover_media_type = state.coverMediaType;
  }
  // Provider/source/credit/credit_url/alt are emitted whenever cover URL
  // changes — they're written together by CoverPicker on every selection.
  if (patch.cover_media_url !== undefined) {
    patch.cover_media_provider = state.coverMediaProvider;
    patch.cover_media_source_url = state.coverMediaSourceUrl;
    patch.cover_media_credit = state.coverMediaCredit;
    patch.cover_media_credit_url = state.coverMediaCreditUrl;
    patch.cover_media_alt = state.coverMediaAlt;
  }

  return {
    patch,
    dayDiffs,
    inclusionDiffs,
    pricingTierDiffs,
    droppedDayOrdinals,
    droppedInclusionKeys,
    tierPriceChangedTicketTypeIds,
  };
}

// ---- Reject dialog content --------------------------------------------

interface RejectDialogContent {
  title: string;
  body: string;
  primaryLabel: string;
  primaryAction: () => void;
}

// ---- Component --------------------------------------------------------

export interface EditPublishedTripScreenProps {
  trip: Trip;
}

interface ToastState {
  visible: boolean;
  message: string;
}

interface ModalState {
  visible: boolean;
  fieldDiffs: TripFieldDiff[];
  dayDiffs: TripDayDiff[];
  inclusionDiffs: TripInclusionDiff[];
  pricingTierDiffs: TripPricingTierDiff[];
  severity: TripEditSeverity;
}

export const EditPublishedTripScreen: React.FC<EditPublishedTripScreenProps> = ({
  trip,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const updateLiveTripMutation = useUpdateLiveTripFields();

  // Local edit state — never persisted client-side; round-trip via RPC.
  const initialState = useMemo<LocalTripEditState>(
    () => tripToLocalEditState(trip),
    [trip],
  );
  const [editState, setEditState] = useState<LocalTripEditState>(initialState);

  // ORCH-0876 P1-1 (QA rework, 2026-05-19): only re-seed local edit state
  // when the route lands on a DIFFERENT trip.id, not on every prop reference
  // change. The previous unguarded `useEffect([trip])` fired on every React
  // Query refetch (60s staleTime + default `refetchOnWindowFocus: true` on
  // `useTrip`) and silently wiped the operator's in-progress edits when they
  // switched tabs / apps mid-edit. The guard below preserves the
  // operator's local state across same-id refetches; the server snapshot
  // re-arrives via the `trip` prop and the Save flow's
  // `buildLiveTripPatch` re-diffs against it at submit time, so cache
  // invalidation still produces correct diffs.
  const prevTripIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevTripIdRef.current !== trip.id) {
      setEditState(tripToLocalEditState(trip));
      prevTripIdRef.current = trip.id;
    }
  }, [trip]);

  const [openSection, setOpenSection] = useState<SectionKey | null>("basics");

  // Modal + submitting
  const [modal, setModal] = useState<ModalState>({
    visible: false,
    fieldDiffs: [],
    dayDiffs: [],
    inclusionDiffs: [],
    pricingTierDiffs: [],
    severity: "additive",
  });
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reject dialog
  const [rejectDialog, setRejectDialog] = useState<RejectDialogContent | null>(
    null,
  );

  // Toast
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ---- Keyboard handling (Cycle 3 wizard root pattern) ----
  const [keyboardVisible, setKeyboardVisible] = useState<boolean>(false);
  const [keyboardHeight, setKeyboardHeight] = useState<number>(0);
  const scrollViewRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(
      showEvent,
      (e: KeyboardEvent): void => {
        setKeyboardVisible(true);
        setKeyboardHeight(e.endCoordinates.height);
      },
    );
    const hideSub = Keyboard.addListener(hideEvent, (): void => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });
    return (): void => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ---- Web purchases predicate (drives SMS-channel flag) ----
  const hasWebPurchaseOrders = useTripHasWebPurchases(trip.id);

  // ---- Sold-count snapshot — single tier per ORCH-0859 ----
  // The biz_trip_sold_count_by_tier helper exists in the migration but the
  // hook layer isn't pulling it pre-flight; for the client-side fast-path
  // we conservatively check via tier's recorded snapshot (zero by default).
  // The server-side refund-gate is the canonical guard regardless.
  const soldCountByTier = useMemo<Record<string, number>>(() => {
    // [TRANSITIONAL] — server is canonical. Future: wire a useTripSoldCounts
    // hook calling biz_trip_sold_count_by_tier and pre-flight the gate.
    // Exit condition: trip-orders ledger ships (post-Tr4).
    const out: Record<string, number> = {};
    for (const tier of trip.pricingTiers) {
      out[tier.ticketTypeId] = 0;
    }
    return out;
  }, [trip.pricingTiers]);
  const totalConfirmedOrders = useMemo<number>(
    () =>
      Object.values(soldCountByTier).reduce(
        (sum: number, n: number) => sum + n,
        0,
      ),
    [soldCountByTier],
  );

  // ---- Patch + diffs computation ----
  const computed = useMemo<PatchComputeResult>(
    () => buildLiveTripPatch(trip, editState),
    [trip, editState],
  );
  const tripFieldDiffs = useMemo<TripFieldDiff[]>(
    () =>
      computeRichTripFieldDiffs(trip, computed.patch, {
        droppedDayOrdinals: computed.droppedDayOrdinals,
        droppedInclusionKeys: computed.droppedInclusionKeys,
        tierPriceChangedTicketTypeIds: computed.tierPriceChangedTicketTypeIds,
      }),
    [trip, computed],
  );
  // Adapt TripFieldDiff[] to the event-side FieldDiff[] shape consumed by
  // ChangeSummaryModal. The fieldKey + fieldLabel + oldValue + newValue
  // pass through unchanged; severity maps additive→safe + material→material
  // (the event-side "destructive" tier has no trip analog per Q11).
  const modalFieldDiffs = useMemo(
    () =>
      tripFieldDiffs.map((d) => ({
        fieldKey: d.fieldKey,
        fieldLabel: d.fieldLabel,
        oldValue: d.oldValue,
        newValue: d.newValue,
        severity: (d.severity === "additive" ? "safe" : "material") as
          | "safe"
          | "material",
      })),
    [tripFieldDiffs],
  );

  // ---- Section "edited" indicator ----
  const editedSectionKeys = useMemo<Set<SectionKey>>(() => {
    const out = new Set<SectionKey>();
    const p = computed.patch;
    if (p.title !== undefined || p.description !== undefined) out.add("basics");
    if (p.theme !== undefined) {
      // theme touches Basics (capacity is a Pricing-mirror) + Itinerary
      // shown as Basics edit for the operator's mental model.
      out.add("basics");
    }
    if (p.days !== undefined) out.add("itinerary");
    if (p.inclusions !== undefined) out.add("inclusions");
    if (p.pricing_tiers !== undefined) out.add("pricing");
    if (
      p.cover_media_url !== undefined ||
      p.cover_media_type !== undefined ||
      p.cover_media_provider !== undefined
    ) {
      out.add("cover");
    }
    return out;
  }, [computed]);

  // ---- Update handlers ----
  const updateBasics = useCallback(
    (patch: Partial<LocalTripEditState>): void => {
      setEditState((prev) => ({ ...prev, ...patch }));
    },
    [],
  );
  const handleDaysChange = useCallback(
    (days: TripDayDraft[]): void => {
      setEditState((prev) => ({ ...prev, days }));
    },
    [],
  );
  const handleInclusionsChange = useCallback(
    (items: InclusionDraft[]): void => {
      setEditState((prev) => ({ ...prev, inclusions: items }));
    },
    [],
  );
  const handlePricingChange = useCallback(
    (patch: Partial<Step4Draft>): void => {
      setEditState((prev) => ({
        ...prev,
        pricing: { ...prev.pricing, ...patch },
      }));
    },
    [],
  );
  const handleCoverChange = useCallback((patch: CoverPatch): void => {
    setEditState((prev) => ({
      ...prev,
      coverMediaUrl: patch.coverMediaUrl,
      coverMediaType: patch.coverMediaType,
      coverMediaProvider: patch.coverMediaProvider,
      coverMediaSourceUrl: patch.coverMediaSourceUrl,
      coverMediaCredit: patch.coverMediaCredit,
      coverMediaCreditUrl: patch.coverMediaCreditUrl,
      coverMediaAlt: patch.coverMediaAlt,
    }));
  }, []);

  const handleToggleSection = useCallback((key: SectionKey): void => {
    setOpenSection((prev) => (prev === key ? null : key));
  }, []);

  // ---- Save flow ----
  const handleSavePress = useCallback((): void => {
    const { patch } = computed;
    if (Object.keys(patch).length === 0) {
      showToast("No changes to save.");
      return;
    }
    // Title required if provided
    if (patch.title !== undefined && patch.title.length === 0) {
      setOpenSection("basics");
      showToast("Trip title can't be empty.");
      return;
    }
    const changedKeys = Object.keys(patch);
    // Refine severity using the per-section drop indicators we computed.
    const severity = classifyTripSeverity(changedKeys, {
      dayOrdinals: computed.droppedDayOrdinals,
      inclusionKeys: computed.droppedInclusionKeys,
      tierPriceChangedTicketTypeIds: computed.tierPriceChangedTicketTypeIds,
    });
    setModal({
      visible: true,
      fieldDiffs: tripFieldDiffs,
      dayDiffs: computed.dayDiffs,
      inclusionDiffs: computed.inclusionDiffs,
      pricingTierDiffs: computed.pricingTierDiffs,
      severity,
    });
  }, [computed, tripFieldDiffs, showToast]);

  // ---- Map rejection result to dialog content ----
  const buildRejectDialog = useCallback(
    (
      result: Extract<UpdateLiveTripResult, { ok: false }>,
    ): RejectDialogContent => {
      const closeOnly = (): void => setRejectDialog(null);
      // Trip-orders ledger doesn't exist yet — surface a toast stub for now.
      const closeAndOpenOrders = (): void => {
        setRejectDialog(null);
        // [TRANSITIONAL] — trip-orders ledger ships post-Tr4. Until then,
        // we surface a hint that orders are managed via Stripe dashboard.
        // Exit condition: trip orders route ships.
        showToast(
          "Trip orders ledger is coming soon. Refund existing buyers via your Stripe dashboard first.",
        );
      };
      switch (result.reason) {
        case "missing_edit_reason":
        case "invalid_edit_reason":
          return {
            title: "Reason needed",
            body: "Please enter a reason between 10 and 200 characters.",
            primaryLabel: "Got it",
            primaryAction: closeOnly,
          };
        case "trip_not_found":
          return {
            title: "Couldn't find this trip",
            body: "It may have been deleted. Tap back to return.",
            primaryLabel: "Back",
            primaryAction: () => {
              setRejectDialog(null);
              if (router.canGoBack()) router.back();
            },
          };
        case "trip_not_editable_status":
          return {
            title: "This trip can't be edited",
            body: "It may have ended or been cancelled.",
            primaryLabel: "Got it",
            primaryAction: closeOnly,
          };
        case "capacity_below_sold": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} spot${n === 1 ? "" : "s"} already booked. To drop capacity below ${n}, refund existing travelers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "dates_shifted_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Travelers booked under the original dates. Refund ${n} buyer${n === 1 ? "" : "s"} before shifting the trip dates.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "days_dropped_with_sales": {
          const dropped = result.droppedDates ?? [];
          const n = result.affectedOrderCount ?? 0;
          const dayText =
            dropped.length === 1
              ? `day ${dropped[0]}`
              : `${dropped.length} days`;
          return {
            title: "Refund first",
            body: `Booked travelers expect every day in your itinerary. Refund ${n} buyer${n === 1 ? "" : "s"} before removing ${dayText}.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "inclusions_removed_with_sales": {
          const dropped = result.droppedInclusions ?? [];
          const n = result.affectedOrderCount ?? 0;
          const itemText =
            dropped.length === 1
              ? "one inclusion"
              : `${dropped.length} inclusions`;
          return {
            title: "Refund first",
            body: `Booked travelers were promised ${itemText}. Refund ${n} buyer${n === 1 ? "" : "s"} before removing them.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_delete_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} spot${n === 1 ? "" : "s"} booked for this tier. Refund all ${n} traveler${n === 1 ? "" : "s"} before deleting.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "tier_price_change_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Existing travelers are protected at the price they paid. Refund ${n} buyer${n === 1 ? "" : "s"}, then change the price (or add a new tier).`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        default: {
          const _exhaust: never = result.reason;
          return _exhaust;
        }
      }
    },
    [router, showToast],
  );

  const handleConfirmSave = useCallback(
    async (reason: string): Promise<void> => {
      if (submitting) return;
      setSubmitting(true);
      await sleep(SAVE_PROCESSING_MS);
      const { patch } = computed;

      // Client-side UX fast-path mirror of the RPC's refund-gate.
      const preflight = validateLiveTripFieldUpdate(
        trip,
        patch,
        soldCountByTier,
        totalConfirmedOrders,
        reason,
      );
      if (!preflight.ok) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        setRejectDialog(buildRejectDialog(preflight));
        return;
      }

      // Server-side atomic patch.
      let result: UpdateLiveTripResult;
      try {
        result = await updateLiveTripMutation.mutateAsync({
          eventId: trip.id,
          patch,
          reason: preflight.trimmedReason,
        });
      } catch (e) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        if (e instanceof UpdateLiveTripPermissionError) {
          if (e.code === "authentication_required") {
            showToast("You're signed out. Sign in to save changes.");
            return;
          }
          if (e.code === "event_not_a_trip") {
            showToast("This isn't a trip — open the event editor instead.");
            return;
          }
          showToast("You don't have permission to edit this trip.");
          return;
        }
        const msg =
          e instanceof Error && e.message.length > 0
            ? e.message
            : "Couldn't save your changes. Tap to try again.";
        showToast(msg);
        return;
      }

      if (!result.ok) {
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        setRejectDialog(buildRejectDialog(result));
        return;
      }

      // Fire-and-forget multi-channel notifier (banner is RPC-written; email
      // + SMS are TRANSITIONAL stubs).
      const flags = deriveTripChannelFlags(
        result.severity,
        hasWebPurchaseOrders,
      );
      void notifyTripChanged(
        {
          eventId: trip.id,
          tripTitle: editState.title,
          brandName: "",
          brandSlug: trip.brandSlug ?? "",
          tripSlug: trip.slug,
          reason: preflight.trimmedReason,
          severity: result.severity,
          changedKeys: result.changedKeys,
          affectedOrderIds: [],
          occurredAt: new Date().toISOString(),
        },
        flags,
      );

      setSubmitting(false);
      setModal((prev) => ({ ...prev, visible: false }));
      showToast("Saved. Live now.");
      setTimeout(() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          // orch-strict-grep-allow route-by-event-type — EditPublishedTripScreen is dispatched only for event_type='trip' rows (app/trip/[id]/edit.tsx status-based dispatch at line 100), so `trip.id` is always a trip row id; `routeForEventRow()` would be a redundant indirection (ORCH-0876 [Trip CRUD + Purchase Flow Completion])
          router.replace(`/trip/${trip.id}` as never);
        }
      }, TOAST_NAV_DELAY_MS);
    },
    [
      submitting,
      computed,
      trip,
      soldCountByTier,
      totalConfirmedOrders,
      updateLiveTripMutation,
      hasWebPurchaseOrders,
      editState.title,
      buildRejectDialog,
      router,
      showToast,
    ],
  );

  const handleModalClose = useCallback((): void => {
    if (submitting) return;
    setModal((prev) => ({ ...prev, visible: false }));
  }, [submitting]);

  // ---- Back/close ----
  const handleBack = useCallback((): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      // orch-strict-grep-allow route-by-event-type — EditPublishedTripScreen is dispatched only for event_type='trip' rows (app/trip/[id]/edit.tsx status-based dispatch at line 100), so `trip.id` is always a trip row id; `routeForEventRow()` would be a redundant indirection (ORCH-0876 [Trip CRUD + Purchase Flow Completion])
      router.replace(`/trip/${trip.id}` as never);
    }
  }, [router, trip.id]);

  // ---- Section body renderer ----
  const renderSectionBody = useCallback(
    (key: SectionKey): React.ReactNode => {
      switch (key) {
        case "basics":
          return (
            <View style={styles.basicsFields}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Title</Text>
                <TextInput
                  value={editState.title}
                  onChangeText={(v) => updateBasics({ title: v })}
                  placeholder="Trip title"
                  placeholderTextColor={textTokens.tertiary}
                  style={styles.textInput}
                  accessibilityLabel="Trip title"
                  testID="edit-trip-title"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  value={editState.description ?? ""}
                  onChangeText={(v) =>
                    updateBasics({
                      description: v.trim().length === 0 ? null : v,
                    })
                  }
                  placeholder="Optional — what makes this trip special"
                  placeholderTextColor={textTokens.tertiary}
                  style={[styles.textInput, styles.textArea]}
                  multiline
                  numberOfLines={4}
                  accessibilityLabel="Trip description"
                  testID="edit-trip-description"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Destination</Text>
                <TextInput
                  value={editState.destinationLocationText ?? ""}
                  onChangeText={(v) =>
                    updateBasics({
                      destinationLocationText: v.trim().length === 0 ? null : v,
                    })
                  }
                  placeholder="e.g. Tulum, Quintana Roo, Mexico"
                  placeholderTextColor={textTokens.tertiary}
                  style={styles.textInput}
                  accessibilityLabel="Destination"
                  testID="edit-trip-destination"
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Capacity</Text>
                <TextInput
                  value={
                    editState.capacity === null ? "" : String(editState.capacity)
                  }
                  onChangeText={(v) => {
                    const n = parseInt(v.replace(/[^0-9]/g, ""), 10);
                    updateBasics({
                      capacity: Number.isFinite(n) && n > 0 ? n : null,
                    });
                  }}
                  placeholder="12"
                  placeholderTextColor={textTokens.tertiary}
                  keyboardType="number-pad"
                  style={styles.textInput}
                  accessibilityLabel="Trip capacity"
                  testID="edit-trip-capacity"
                />
              </View>
            </View>
          );
        case "itinerary":
          return (
            <TripCreatorStep2Itinerary
              days={editState.days}
              onChange={handleDaysChange}
              disabled={submitting}
              editMode={{ totalConfirmedOrders }}
            />
          );
        case "inclusions":
          return (
            <TripCreatorStep3Inclusions
              items={editState.inclusions}
              onChange={handleInclusionsChange}
              disabled={submitting}
              editMode={{ totalConfirmedOrders }}
            />
          );
        case "pricing": {
          const firstTier = trip.pricingTiers[0];
          const soldCountForTier =
            firstTier === undefined
              ? 0
              : (soldCountByTier[firstTier.ticketTypeId] ?? 0);
          // ORCH-0882 [Render Payment Plan Disclosure on Trip Buyer +
          // Planner Surfaces] — planner-variant live preview below the
          // PaymentPlanEditor. Reads from `editState.pricing.paymentPlan`
          // (edit-buffer) so planner sees the exact schedule their
          // buyers will see, live-updating as they tweak deposit_pct or
          // installment percentages. Falls back to firstTier price +
          // currency for the projection inputs.
          // priceMajor is the displayed-decimal string ("50.00"); parse
          // to cents for the projection. Falls back to firstTier.priceCents
          // when parse fails (NaN guard) so the preview never fabricates
          // amounts from a half-typed input.
          const parsedPriceMajor = parseFloat(editState.pricing.priceMajor);
          const livePriceCents = Number.isFinite(parsedPriceMajor)
            ? Math.round(parsedPriceMajor * 100)
            : (firstTier?.priceCents ?? 0);
          const plannerPreviewSchedule =
            firstTier === undefined ||
            editState.pricing.paymentPlan === null
              ? null
              : projectInstallmentSchedule(
                  {
                    priceCents: livePriceCents,
                    currency: firstTier.currency,
                    installmentSchedule: editState.pricing.paymentPlan,
                  },
                  new Date(),
                );
          return (
            <View>
              <TripCreatorStep4Pricing
                draft={editState.pricing}
                onChange={handlePricingChange}
                disabled={submitting}
                editMode={{ soldCountForTier }}
              />
              {plannerPreviewSchedule !== null ? (
                <View style={styles.plannerPlanPreviewWrap}>
                  <InstallmentScheduleDisplay
                    schedule={plannerPreviewSchedule}
                    variant="planner"
                    isProjection={true}
                  />
                </View>
              ) : null}
            </View>
          );
        }
        case "cover":
          return (
            <View style={styles.coverWrap}>
              <CoverPicker
                brandId={trip.brandId}
                eventRowId={trip.id}
                initialMediaUrl={editState.coverMediaUrl}
                initialMediaType={editState.coverMediaType}
                initialProvider={editState.coverMediaProvider}
                initialSourceUrl={editState.coverMediaSourceUrl}
                initialCredit={editState.coverMediaCredit}
                initialCreditUrl={editState.coverMediaCreditUrl}
                initialAlt={editState.coverMediaAlt}
                onCoverChange={handleCoverChange}
                onShowToast={showToast}
                providers={["upload", "giphy", "pexels"]}
                disabled={submitting}
              />
            </View>
          );
        case "intake":
          // ORCH-0880 [Tr5 Traveler Intake Forms] — Intake form accordion
          // body. Self-contained: owns its query, mutation, reason dialog,
          // and toast. Per DESIGN §6 + I-PROPOSED-TR5-INTAKE-SCHEMA-EDIT-
          // PERSISTS-TO-DB — writes route through biz_update_live_trip RPC
          // with reason text (10-200 chars) via upsertTripIntakeSchema.
          return (
            <EditPublishedTripIntakeAccordion
              eventId={trip.id}
              ticketTypes={trip.pricingTiers}
            />
          );
        case "settings":
          return (
            <View style={styles.settingsWrap}>
              <Text style={styles.settingsHint}>
                Refund tiers and booking deadline are managed from the trip
                wizard (Step 5: Cancellation & deadline). Open the wizard
                from the draft trip menu to edit these.
              </Text>
              <View style={styles.settingsField}>
                <Text style={styles.settingsLabel}>Booking deadline</Text>
                <Text style={styles.settingsValue}>
                  {trip.bookingDeadline === null
                    ? "No deadline set"
                    : new Date(trip.bookingDeadline).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                </Text>
              </View>
              <View style={styles.settingsField}>
                <Text style={styles.settingsLabel}>Bookings closed</Text>
                <Switch
                  value={trip.bookingsClosed}
                  disabled
                  trackColor={{
                    false: "rgba(255,255,255,0.16)",
                    true: accent.warm,
                  }}
                  thumbColor="#ffffff"
                  ios_backgroundColor="rgba(255,255,255,0.16)"
                />
              </View>
              <View style={styles.settingsField}>
                <Text style={styles.settingsLabel}>Refund policy</Text>
                <Text style={styles.settingsValue}>
                  {trip.refundPolicy === null ||
                  trip.refundPolicy.tiers.length === 0
                    ? "Non-refundable (no tiers set)"
                    : `${trip.refundPolicy.tiers.length} tier${
                        trip.refundPolicy.tiers.length === 1 ? "" : "s"
                      }`}
                </Text>
              </View>
            </View>
          );
        default: {
          const _exhaust: never = key;
          return _exhaust;
        }
      }
    },
    [
      editState,
      updateBasics,
      handleDaysChange,
      handleInclusionsChange,
      handlePricingChange,
      handleCoverChange,
      submitting,
      totalConfirmedOrders,
      soldCountByTier,
      trip,
      showToast,
    ],
  );

  // ---- Render ----
  return (
    <View
      style={[
        styles.host,
        { paddingTop: insets.top, backgroundColor: canvas.discover },
      ]}
    >
      {/* Chrome */}
      <View style={styles.chromeRow}>
        <IconChrome
          icon="close"
          size={36}
          onPress={handleBack}
          accessibilityLabel="Close edit"
        />
        <Text style={styles.chromeTitle}>Edit trip</Text>
        <View style={styles.chromeRightSlot} />
      </View>

      <ScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom:
              keyboardHeight > 0
                ? keyboardHeight + 120
                : insets.bottom + 120,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <EditAfterPublishTripBanner />

        {SECTIONS.map((sec) => {
          const isOpen = openSection === sec.key;
          const isEdited = editedSectionKeys.has(sec.key);
          return (
            <View key={sec.key} style={styles.sectionCard}>
              <Pressable
                onPress={() => handleToggleSection(sec.key)}
                accessibilityRole="button"
                accessibilityLabel={`${sec.label} section${
                  isOpen ? " (expanded)" : " (collapsed)"
                }`}
                style={({ pressed }) => [
                  styles.sectionHeader,
                  pressed && styles.sectionHeaderPressed,
                ]}
              >
                <View style={styles.sectionHeaderLeft}>
                  <Text style={styles.sectionLabel}>{sec.label}</Text>
                  {isEdited ? (
                    <View style={styles.editedBadge}>
                      <Text style={styles.editedBadgeText}>Edited</Text>
                    </View>
                  ) : null}
                </View>
                <Icon
                  name={isOpen ? "chevU" : "chevD"}
                  size={16}
                  color={textTokens.tertiary}
                />
              </Pressable>
              {isOpen ? (
                <View style={styles.sectionBody}>
                  {renderSectionBody(sec.key)}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>

      {/* Sticky Save dock */}
      {!keyboardVisible ? (
        <View
          style={[
            styles.dock,
            { paddingBottom: insets.bottom + spacing.md },
          ]}
        >
          <Button
            label="Save changes"
            onPress={handleSavePress}
            variant="primary"
            size="lg"
            fullWidth
            disabled={submitting}
            accessibilityLabel="Save changes"
            testID="edit-trip-save"
          />
        </View>
      ) : null}

      {/* Review modal */}
      <ChangeSummaryModal
        visible={modal.visible}
        diffs={modalFieldDiffs}
        tripDayDiffs={modal.dayDiffs}
        tripInclusionDiffs={modal.inclusionDiffs}
        tripPricingTierDiffs={modal.pricingTierDiffs}
        severity={modal.severity}
        webPurchasePresent={hasWebPurchaseOrders}
        onClose={handleModalClose}
        onConfirm={handleConfirmSave}
        submitting={submitting}
        entityLabel="trip"
      />

      {/* Refund-first reject dialog */}
      <ConfirmDialog
        visible={rejectDialog !== null}
        onClose={() => setRejectDialog(null)}
        onConfirm={() => {
          if (rejectDialog !== null) {
            rejectDialog.primaryAction();
          }
        }}
        title={rejectDialog?.title ?? ""}
        description={rejectDialog?.body ?? ""}
        confirmLabel={rejectDialog?.primaryLabel ?? "OK"}
        cancelLabel="Close"
        variant="simple"
      />

      {/* Toast */}
      <Toast
        visible={toast.visible}
        kind="info"
        message={toast.message}
        onDismiss={() => setToast({ visible: false, message: "" })}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  chromeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  chromeTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: textTokens.primary,
    letterSpacing: -0.2,
    textAlign: "center",
  },
  chromeRightSlot: {
    width: 36,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.sm,
    borderRadius: radiusTokens.lg,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 56,
  },
  sectionHeaderPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.04)",
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
  },
  sectionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: textTokens.primary,
  },
  editedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radiusTokens.full,
    backgroundColor: accent.tint,
    borderWidth: 1,
    borderColor: accent.border,
  },
  editedBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: accent.warm,
    letterSpacing: 1.0,
    textTransform: "uppercase",
  },
  sectionBody: {
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.md,
  },
  basicsFields: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  textInput: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: radiusTokens.md,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.12)",
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
  },
  textArea: {
    height: 100,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: "top",
  },
  coverWrap: {
    paddingTop: spacing.sm,
  },
  // ORCH-0882 — planner-variant preview below PaymentPlanEditor in the
  // Pricing accordion. Sibling card with consistent vertical breathing
  // room so planner immediately sees what their buyers will see.
  plannerPlanPreviewWrap: {
    width: "100%",
    marginTop: spacing.lg,
  },
  settingsWrap: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  settingsHint: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  settingsField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
  settingsLabel: {
    fontSize: typography.bodySm.fontSize,
    color: textTokens.secondary,
    flex: 1,
  },
  settingsValue: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.primary,
    textAlign: "right",
  },
  dock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: "rgba(12, 14, 18, 0.94)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255, 255, 255, 0.06)",
  },
});

export default EditPublishedTripScreen;
