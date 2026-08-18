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
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + state + auto-insets DELETED. useKeyboardIsVisible() preserves dock-hide.
// Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  brandPaymentOnboardingRoute,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../../utils/paidPublishGuards";

import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
// issue #2101 [named-buyer checkout] — the owner-only "Eligible buyers" card.
// LAZY (ORCH-1083 boot budget): the card is mounted by THREE separate lazy
// route chunks (Event, Trip and Experience management), so a static import
// makes Metro hoist it into the eager `__common` chunk that EVERY buyer
// downloads before anything renders — for a control only a brand owner ever
// sees. Same treatment, and same reason, as SeeWhosGoingGate.
const EventTicketCheckoutAccessCard = React.lazy(() =>
  import("../event/EventTicketCheckoutAccessCard").then((m) => ({
    default: m.EventTicketCheckoutAccessCard,
  })),
);
import { Icon } from "../ui/Icon";
import { IconChrome } from "../ui/IconChrome";
import { Toast } from "../ui/Toast";
import { type CoverPatch } from "../ui/CoverPicker";
import { CoverPickerSheet } from "../ui/CoverPickerSheet";
import { EventCoverMedia } from "../ui/EventCoverMedia";

import { ChangeSummaryModal } from "../event/ChangeSummaryModal";
import { EditAfterPublishTripBanner } from "./EditAfterPublishTripBanner";
// ORCH-0880 [Tr5 Traveler Intake Forms] — new accordion section body.
import { EditPublishedTripIntakeAccordion } from "./EditPublishedTripIntakeAccordion";
import { EditPublishedTripSettingsAccordion } from "./EditPublishedTripSettingsAccordion";

import type { RefundPolicy } from "../../services/refundPolicyService";
import type {
  Trip,
  LiveTripPatch,
  TripDayInput,
  TripInclusionInput,
  TripPricingTierInput,
  UpdateLiveTripResult,
} from "../../services/tripsService";
import {
  UpdateLiveTripPermissionError,
  setTripPricingSwitches,
} from "../../services/tripsService";
// ORCH-1339 — guest-privacy leaf-write RPC (never biz_update_live_trip).
import { setEventGuestPrivacy } from "../../services/businessEvents";
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

// ORCH-1118 — published-edit departure + destination must be confirmed Mapbox
// picks before save. Swap the legacy plain TextInputs for the shared picker.
import { MapboxAddressInput } from "../location/MapboxAddressInput";
import {
  advanceLocationRequestGeneration,
  isFreeTextResolveStale,
  isLocationRequestGenerationCurrent,
  resolveFreeTextLocation,
} from "../../utils/resolveApproxLocation";
import type { LocationSelectionState } from "@mingla/location-input";
import {
  departureLocationValidated,
  destinationLocationValidated,
  TRIP_DEPARTURE_PICK_ERROR,
  TRIP_DESTINATION_PICK_ERROR,
} from "./tripLocationValidated";
import { TripCreatorStep2Itinerary } from "./TripCreatorStep2Itinerary";
import { TripCreatorStep3Inclusions } from "./TripCreatorStep3Inclusions";
import {
  TripCreatorStep4Pricing,
  makePackageKey,
  type Step4Draft,
} from "./TripCreatorStep4Pricing";
import { InstallmentScheduleDisplay } from "./InstallmentScheduleDisplay";
import { projectInstallmentSchedule } from "../../utils/installmentScheduleProjection";
import type { TripDayDraft } from "./TripDayEditor";
import type { InclusionDraft } from "./TripCreatorStep3Inclusions";
import type { EventCoverMediaType } from "../../store/draftEventStore";
import type { EventCoverMediaProvider } from "../../types/eventCoverProvider";
import type { OfferingGalleryImage } from "@mingla/offering-rendering";

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
  // ORCH-1016 — departure (origin) city
  departurePlaceId: string | null;
  departureLocationText: string | null;
  departureLat: number | null;
  departureLng: number | null;
  // Issue #1363 — legacy precision may be exact; selected-address resolution is
  // approximate; null means unset. Carried into theme.business_trip.* on save.
  destinationCoordinatePrecision: "exact" | "approximate" | null;
  departureCoordinatePrecision: "exact" | "approximate" | null;
  capacity: number | null;
  // Itinerary
  days: TripDayDraft[];
  // Inclusions
  inclusions: InclusionDraft[];
  // Pricing — single-tier model (trip-side enforces 1 tier per ORCH-0859)
  pricing: Step4Draft;
  // Cover
  coverMediaUrl: string | null;
  coverMediaPosterUrl: string | null;
  coverMediaType: EventCoverMediaType | null;
  // issue #868 [cover-gallery] — ADDITIONAL image/GIF items (default []).
  coverGallery: OfferingGalleryImage[];
  coverMediaProvider: EventCoverMediaProvider | null;
  coverMediaSourceUrl: string | null;
  coverMediaCredit: string | null;
  coverMediaCreditUrl: string | null;
  coverMediaAlt: string | null;
  // ORCH-1120 — Settings (published-trip refund/deadline/closed). Lifted from
  // the (now controlled) EditPublishedTripSettingsAccordion so the single
  // bottom Save button owns the edit state, diff, reason prompt, and gate.
  refundPolicy: RefundPolicy | null;
  bookingDeadline: string | null; // ISO timestamptz, or null to clear
  bookingsClosed: boolean;
  // ORCH-1339 — the two guest-privacy display gates (side-channel: EXCLUDED
  // from buildLiveTripPatch; persisted via setEventGuestPrivacy).
  privateGuestList: boolean;
  hideRemainingCount: boolean;
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
    departurePlaceId: trip.businessTrip.departurePlaceId,
    departureLocationText: trip.businessTrip.departureLocationText,
    departureLat: trip.businessTrip.departureLat,
    departureLng: trip.businessTrip.departureLng,
    // Issue #1363 — precision is transient capture-side (existing coord present).
    destinationCoordinatePrecision: null,
    departureCoordinatePrecision: null,
    capacity: trip.businessTrip.capacity,
    days: trip.days.map((d) => ({
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative ?? "",
      // ORCH-1119 — seed the per-day media gallery from the live trip.
      media: d.media ?? [],
    })),
    inclusions: trip.inclusions.map((i) => ({
      kind: i.kind,
      item: i.item,
      ordinal: i.ordinal,
    })),
    // META-ORCH-1174 Leg B2 — Step4Draft is now N-package. EditPublishedTripScreen
    // (the B4 edit-published path) remains SINGLE-package: seed exactly one
    // package from the trip's first tier so the existing single-tier edit flow
    // is byte-for-byte preserved. Multi-package edit-published is B4 scope.
    pricing: {
      packages: [
        {
          key: makePackageKey(),
          ticketTypeId: firstTier?.ticketTypeId ?? null,
          name: firstTier?.tierName ?? "Standard",
          priceMajor:
            firstTier === undefined
              ? ""
              : (firstTier.priceCents / 100).toFixed(2),
          description: firstTier?.description ?? "",
          capacity: trip.businessTrip.capacity,
          paymentPlan: firstTier?.installmentSchedule ?? null,
          soldCount: 0,
        },
      ],
      currency: firstTier?.currency ?? "USD",
      // ORCH-1006 — seed switches from events.pass_* (NULL = inherit).
      pricingSwitches: {
        passTax: trip.pricingSwitches?.passTax ?? null,
        passMinglaFee: trip.pricingSwitches?.passMinglaFee ?? null,
        passServiceFee: trip.pricingSwitches?.passServiceFee ?? null,
      },
    },
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaPosterUrl: trip.coverMediaPosterUrl ?? null,
    coverMediaType: coverType,
    // issue #868 [cover-gallery] — seed the ADDITIONAL photos from the trip row.
    coverGallery: trip.coverGallery ?? [],
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    // ORCH-1120 — Settings server snapshot.
    refundPolicy: trip.refundPolicy,
    bookingDeadline: trip.bookingDeadline,
    bookingsClosed: trip.bookingsClosed,
    // ORCH-1339 — guest-privacy server snapshot (theme leaf; false defaults).
    privateGuestList: trip.guestPrivacy?.privateGuestList ?? false,
    hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false,
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
  // ORCH-1006 — the new pricing switches when they differ from the trip's
  // current values, else null. Persisted via setTripPricingSwitches (the trip
  // patch RPC has no pass_* path), NOT through `patch`.
  pricingSwitchesChanged: {
    passTax: boolean | null;
    passMinglaFee: boolean | null;
    passServiceFee: boolean | null;
  } | null;
  // ORCH-1339 — the guest-privacy toggles when they differ from the trip's
  // current values (only the DIRTY keys), else null. Side-channel like the
  // pricing switches: persisted via setEventGuestPrivacy (leaf-write RPC), NOT
  // through `patch` — so they never enter biz_update_live_trip and never trip
  // the refund gate / reason prompt by themselves (SC-7).
  guestPrivacyChanged: {
    privateGuestList?: boolean;
    hideRemainingCount?: boolean;
  } | null;
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
    departurePlaceId: string | null;
    departureLocationText: string | null;
    departureLat: number | null;
    departureLng: number | null;
    destinationCoordinatePrecision: "exact" | "approximate" | null;
    departureCoordinatePrecision: "exact" | "approximate" | null;
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
  // ORCH-1016 — departure is ADDITIVE (no refund gate; doesn't change
  // price/dates/capacity/inclusions). The biz_update_live_trip generic
  // theme.business_trip merge persists these into theme; the ORCH-1016 trigger
  // syncs theme.business_trip.departureLocationText/Lat/Lng → events.departure_text/geo.
  if (state.departurePlaceId !== trip.businessTrip.departurePlaceId) {
    bt.departurePlaceId = state.departurePlaceId;
  }
  if (
    state.departureLocationText !== trip.businessTrip.departureLocationText
  ) {
    bt.departureLocationText = state.departureLocationText;
  }
  if (state.departureLat !== trip.businessTrip.departureLat) {
    bt.departureLat = state.departureLat;
  }
  if (state.departureLng !== trip.businessTrip.departureLng) {
    bt.departureLng = state.departureLng;
  }
  // Issue #1363 — persist capture precision only when it was set this session
  // (non-null). Rides the same theme.business_trip merge as the coords above.
  if (state.destinationCoordinatePrecision !== null) {
    bt.destinationCoordinatePrecision = state.destinationCoordinatePrecision;
  }
  if (state.departureCoordinatePrecision !== null) {
    bt.departureCoordinatePrecision = state.departureCoordinatePrecision;
  }
  if (state.capacity !== trip.businessTrip.capacity) {
    bt.capacity = state.capacity;
  }
  if (Object.keys(bt).length > 0) patch.theme = { business_trip: bt };

  // Days — full DELETE-then-INSERT semantics on the server; emit when any
  // field changed, ordinal added or removed.
  // ORCH-1119 — order-sensitive media fingerprint so a media-only change (add,
  // remove, reorder) sets daysChanged → patch.days → biz_update_live_trip §5b
  // persists media. Media is additive (never a refund-gate ordinal drop).
  const mediaSig = (
    m: ReadonlyArray<{ url: string; type: "image" | "video" }> | undefined,
  ): string => (m ?? []).map((x) => `${x.url}|${x.type}`).join(",");
  const oldDaysSig = JSON.stringify(
    trip.days
      .map((d) => ({
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative ?? "",
        media: mediaSig(d.media),
      }))
      .sort((a, b) => a.ordinal - b.ordinal),
  );
  const newDaysCanonical = state.days.map((d) => ({
    ordinal: d.ordinal,
    title: d.title.trim(),
    narrative: d.narrative.trim().length > 0 ? d.narrative.trim() : "",
    media: d.media ?? [],
  }));
  const newDaysSig = JSON.stringify(
    newDaysCanonical
      .map((d) => ({
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative,
        media: mediaSig(d.media),
      }))
      .sort((a, b) => a.ordinal - b.ordinal),
  );
  const daysChanged = oldDaysSig !== newDaysSig;
  if (daysChanged) {
    patch.days = newDaysCanonical.map<TripDayInput>((d) => ({
      ordinal: d.ordinal,
      title: d.title,
      narrative: d.narrative.length > 0 ? d.narrative : null,
      // ORCH-1119 — carry media into the published-edit patch.
      media: d.media,
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

  // Pricing tiers — single-tier model (B4 multi-tier is a later leg). Only emit
  // when tier_name or price_cents or installmentSchedule differs from the trip's
  // current tier. META-ORCH-1174 Leg B2 — read the sole edited package.
  const editPkg = state.pricing.packages[0];
  const newPriceCents = Math.round(
    (parseFloat(editPkg?.priceMajor ?? "") || 0) * 100,
  );
  const firstTier = trip.pricingTiers[0];
  const tierNameChanged =
    firstTier !== undefined &&
    editPkg !== undefined &&
    editPkg.name.trim().length > 0 &&
    editPkg.name.trim() !== firstTier.tierName;
  const tierPriceChanged =
    firstTier !== undefined && newPriceCents !== firstTier.priceCents;
  const oldPlanSig = JSON.stringify(firstTier?.installmentSchedule ?? null);
  const newPlanSig = JSON.stringify(editPkg?.paymentPlan ?? null);
  const tierPlanChanged = oldPlanSig !== newPlanSig;
  if (
    firstTier !== undefined &&
    editPkg !== undefined &&
    (tierNameChanged || tierPriceChanged || tierPlanChanged)
  ) {
    const tierMetadata: Record<string, unknown> = {};
    if (editPkg.paymentPlan !== null) {
      tierMetadata.installments = editPkg.paymentPlan;
    }
    patch.pricing_tiers = [
      {
        ticket_type_id: firstTier.ticketTypeId,
        tier_name: tierNameChanged ? editPkg.name.trim() : undefined,
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

  // #1719: cover URL/type/poster are one identity. Any change emits all three
  // so the transactional RPC wrapper can reject split or stale writes.
  const coverIdentityChanged =
    state.coverMediaUrl !== trip.coverMediaUrl ||
    state.coverMediaPosterUrl !== (trip.coverMediaPosterUrl ?? null) ||
    state.coverMediaType !==
      (trip.coverMediaType === "image" ||
      trip.coverMediaType === "video" ||
      trip.coverMediaType === "gif"
        ? trip.coverMediaType
        : null);
  if (coverIdentityChanged) {
    patch.cover_media_url = state.coverMediaUrl;
    patch.cover_media_poster_url = state.coverMediaPosterUrl;
    patch.cover_media_type = state.coverMediaType;
  }
  // issue #868 [cover-gallery] — the ADDITIONAL photos, dirtied INDEPENDENTLY of
  // the cover fields, sent to biz_update_live_trip (§G.4) as cover_media_gallery.
  if (
    JSON.stringify(state.coverGallery ?? []) !==
    JSON.stringify(trip.coverGallery ?? [])
  ) {
    patch.cover_media_gallery = state.coverGallery ?? [];
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

  // ORCH-1006 — diff the pricing switches (NULL = inherit). Side-channel:
  // not part of `patch` (the trip RPC has no pass_* path) — persisted via
  // setTripPricingSwitches in handleConfirmSave.
  const origSwitches = {
    passTax: trip.pricingSwitches?.passTax ?? null,
    passMinglaFee: trip.pricingSwitches?.passMinglaFee ?? null,
    passServiceFee: trip.pricingSwitches?.passServiceFee ?? null,
  };
  const newSwitches = state.pricing.pricingSwitches;
  const pricingSwitchesChanged =
    newSwitches !== undefined &&
    (origSwitches.passTax !== newSwitches.passTax ||
      origSwitches.passMinglaFee !== newSwitches.passMinglaFee ||
      origSwitches.passServiceFee !== newSwitches.passServiceFee)
      ? newSwitches
      : null;

  // ORCH-1120 — Settings (refund_policy / booking_deadline / bookings_closed).
  // Carry ONLY the dirty fields so the biz_update_live_trip RPC's favorable/
  // unfavorable classifier evaluates only what changed (omit unchanged keys).
  if (JSON.stringify(state.refundPolicy) !== JSON.stringify(trip.refundPolicy)) {
    patch.refund_policy = state.refundPolicy;
  }
  if (state.bookingDeadline !== trip.bookingDeadline) {
    patch.booking_deadline = state.bookingDeadline;
  }
  if (state.bookingsClosed !== trip.bookingsClosed) {
    patch.bookings_closed = state.bookingsClosed;
  }

  // ORCH-1339 — diff the guest-privacy toggles (side-channel; dirty keys only).
  const origPrivacy = {
    privateGuestList: trip.guestPrivacy?.privateGuestList ?? false,
    hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false,
  };
  const privacyPatch: { privateGuestList?: boolean; hideRemainingCount?: boolean } = {};
  if (state.privateGuestList !== origPrivacy.privateGuestList) {
    privacyPatch.privateGuestList = state.privateGuestList;
  }
  if (state.hideRemainingCount !== origPrivacy.hideRemainingCount) {
    privacyPatch.hideRemainingCount = state.hideRemainingCount;
  }
  const guestPrivacyChanged =
    Object.keys(privacyPatch).length > 0 ? privacyPatch : null;

  return {
    patch,
    dayDiffs,
    inclusionDiffs,
    pricingTierDiffs,
    droppedDayOrdinals,
    droppedInclusionKeys,
    tierPriceChangedTicketTypeIds,
    pricingSwitchesChanged,
    guestPrivacyChanged,
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

  const [departureSelectionState, setDepartureSelectionState] =
    useState<LocationSelectionState>(
      editState.departureLocationText?.trim() &&
          editState.departureLat !== null &&
          editState.departureLng !== null
        ? "selected"
        : "editing",
    );
  const [destinationSelectionState, setDestinationSelectionState] =
    useState<LocationSelectionState>(
      editState.destinationLocationText?.trim() &&
          editState.destinationLat !== null &&
          editState.destinationLng !== null
        ? "selected"
        : "editing",
    );
  // Issue #1363 P3-2 — latest-wins guards: the text currently committed to each
  // field, so a superseded free-text geocode can't patch a stale coordinate.
  const committedDepartureRef = useRef(editState.departureLocationText ?? "");
  const committedDestinationRef = useRef(editState.destinationLocationText ?? "");
  const departureRequestGenerationRef = useRef(0);
  const destinationRequestGenerationRef = useRef(0);
  const departureContextRef = useRef<{
    city: string | null;
    countryCode: string | null;
  }>({ city: null, countryCode: null });
  const destinationContextRef = useRef<{
    city: string | null;
    countryCode: string | null;
  }>({ city: null, countryCode: null });

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

  // ORCH-1118 — reveal the inline "pick from suggestions" error on a
  // departure/destination field after a blocked Save attempt.
  const [showEditAddressErrors, setShowEditAddressErrors] =
    useState<boolean>(false);

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
  const [coverPickerVisible, setCoverPickerVisible] = useState<boolean>(false);

  // Reject dialog
  const [rejectDialog, setRejectDialog] = useState<RejectDialogContent | null>(
    null,
  );

  // Toast
  const [toast, setToast] = useState<ToastState>({ visible: false, message: "" });
  const showToast = useCallback((message: string): void => {
    setToast({ visible: true, message });
  }, []);

  // ORCH-0892-B v2: keyboard listener + state DELETED. KAS via
  // SmartScrollView handles focused-input scroll. dock-hide via hook.
  const keyboardVisible = useKeyboardIsVisible();
  const scrollViewRef = useRef<ScrollView | null>(null);

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
    // ORCH-1120 — Settings dirtiness now flows through the parent patch diff
    // (controlled editor); the single bottom Save button owns the save.
    if (
      p.refund_policy !== undefined ||
      p.booking_deadline !== undefined ||
      p.bookings_closed !== undefined
    ) {
      out.add("settings");
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
  const resolveDeparture = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(
        departureRequestGenerationRef,
      );
      committedDepartureRef.current = rawLabel;
      setDepartureSelectionState("resolving");
      updateBasics({
        departureLocationText: rawLabel,
        departurePlaceId: null,
        departureLat: null,
        departureLng: null,
        departureCoordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            departureContextRef.current,
          );
          if (
            !isLocationRequestGenerationCurrent(
              departureRequestGenerationRef,
              generation,
            ) ||
            isFreeTextResolveStale(rawLabel, committedDepartureRef.current)
          ) return;
          if (resolution.status === "needs_context") {
            setDepartureSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          updateBasics({
            departureLat: approx.lat,
            departureLng: approx.lng,
            departureCoordinatePrecision: "approximate",
          });
          departureContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          setDepartureSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(
              departureRequestGenerationRef,
              generation,
            ) &&
            !isFreeTextResolveStale(rawLabel, committedDepartureRef.current)
          ) {
            setDepartureSelectionState("error");
          }
        }
      })();
    },
    [updateBasics],
  );
  const resolveDestination = useCallback(
    (rawLabel: string): void => {
      const generation = advanceLocationRequestGeneration(
        destinationRequestGenerationRef,
      );
      committedDestinationRef.current = rawLabel;
      setDestinationSelectionState("resolving");
      updateBasics({
        destinationLocationText: rawLabel,
        destinationPlaceId: null,
        destinationLat: null,
        destinationLng: null,
        destinationCoordinatePrecision: null,
      });
      void (async () => {
        try {
          const resolution = await resolveFreeTextLocation(
            rawLabel,
            destinationContextRef.current,
          );
          if (
            !isLocationRequestGenerationCurrent(
              destinationRequestGenerationRef,
              generation,
            ) ||
            isFreeTextResolveStale(rawLabel, committedDestinationRef.current)
          ) return;
          if (resolution.status === "needs_context") {
            setDestinationSelectionState("needs_context");
            return;
          }
          const approx = resolution.location;
          updateBasics({
            destinationLat: approx.lat,
            destinationLng: approx.lng,
            destinationCoordinatePrecision: "approximate",
          });
          destinationContextRef.current = {
            city: approx.city,
            countryCode: approx.countryCode,
          };
          setDestinationSelectionState("selected");
        } catch {
          if (
            isLocationRequestGenerationCurrent(
              destinationRequestGenerationRef,
              generation,
            ) &&
            !isFreeTextResolveStale(rawLabel, committedDestinationRef.current)
          ) {
            setDestinationSelectionState("error");
          }
        }
      })();
    },
    [updateBasics],
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
      coverMediaPosterUrl: patch.coverMediaPosterUrl,
      coverMediaType: patch.coverMediaType,
      // issue #868 [cover-gallery] — carry the ADDITIONAL photos into edit state.
      coverGallery: patch.coverGallery ?? [],
      coverMediaProvider: patch.coverMediaProvider,
      coverMediaSourceUrl: patch.coverMediaSourceUrl,
      coverMediaCredit: patch.coverMediaCredit,
      coverMediaCreditUrl: patch.coverMediaCreditUrl,
      coverMediaAlt: patch.coverMediaAlt,
    }));
  }, []);

  // ORCH-1120 — Settings (controlled editor): lift the three values into
  // editState so the single bottom Save button diffs + saves them.
  const handleRefundPolicyChange = useCallback(
    (next: RefundPolicy | null): void => {
      setEditState((prev) => ({ ...prev, refundPolicy: next }));
    },
    [],
  );
  const handleBookingDeadlineChange = useCallback(
    (next: string | null): void => {
      setEditState((prev) => ({ ...prev, bookingDeadline: next }));
    },
    [],
  );
  const handleBookingsClosedChange = useCallback((next: boolean): void => {
    setEditState((prev) => ({ ...prev, bookingsClosed: next }));
  }, []);
  // ORCH-1339 — guest-privacy toggle lifts (side-channel; never enter `patch`).
  const handlePrivateGuestListChange = useCallback((next: boolean): void => {
    setEditState((prev) => ({ ...prev, privateGuestList: next }));
  }, []);
  const handleHideRemainingCountChange = useCallback((next: boolean): void => {
    setEditState((prev) => ({ ...prev, hideRemainingCount: next }));
  }, []);

  const handleToggleSection = useCallback((key: SectionKey): void => {
    setOpenSection((prev) => (prev === key ? null : key));
  }, []);

  // ---- Save flow ----
  const handleSavePress = useCallback((): void => {
    const { patch } = computed;
    // ORCH-1006 — a switch-only change has an empty patch but still saves.
    if (
      Object.keys(patch).length === 0 &&
      computed.pricingSwitchesChanged === null
    ) {
      // ORCH-1339 — a guest-privacy-toggle-ONLY change persists DIRECTLY via
      // the leaf-write RPC: display prefs are never a material change, so they
      // bypass the ChangeSummaryModal reason prompt AND the refund gate (SC-7).
      const privacyOnly = computed.guestPrivacyChanged;
      if (privacyOnly !== null) {
        void (async (): Promise<void> => {
          setSubmitting(true);
          try {
            await setEventGuestPrivacy(trip.id, privacyOnly);
            setSubmitting(false);
            showToast("Saved. Live now.");
            setTimeout(() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                // orch-strict-grep-allow route-by-event-type — EditPublishedTripScreen is trip-only (app/trip/[id]/edit.tsx dispatch)
                router.replace(`/trip/${trip.id}` as never);
              }
            }, TOAST_NAV_DELAY_MS);
          } catch {
            setSubmitting(false);
            showToast("Couldn't save guest privacy. Tap to try again.");
          }
        })();
        return;
      }
      showToast("No changes to save.");
      return;
    }
    // Title required if provided
    if (patch.title !== undefined && patch.title.length === 0) {
      setOpenSection("basics");
      showToast("Trip title can't be empty.");
      return;
    }
    // ORCH-1118 — trip location must be a confirmed Mapbox pick before save.
    // BOTH departure AND destination are hard-required — an empty OR dirty
    // (typed-but-unpicked) value on either field blocks save. Reveal the inline
    // errors + expand the basics section. Do not loosen
    // (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED).
    if (
      !destinationLocationValidated(
        editState.destinationLocationText,
        editState.destinationPlaceId,
        editState.destinationLat,
        editState.destinationLng,
      ) ||
      !departureLocationValidated(
        editState.departureLocationText,
        editState.departurePlaceId,
        editState.departureLat,
        editState.departureLng,
      )
    ) {
      setShowEditAddressErrors(true);
      setOpenSection("basics");
      showToast("Pick the trip's departure and destination from the suggestions.");
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
    // ORCH-1339 — trip.id + router feed the toggle-only direct-persist branch.
  }, [computed, tripFieldDiffs, showToast, editState, trip.id, router]);

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
        case "stripe_charges_disabled":
        case "payment_collection_unavailable": {
          const paymentCopy = resolveProviderNeutralPaidPublishGuardCopy(
            result.reason,
          )!;
          return {
            title: paymentCopy.title,
            body: paymentCopy.body,
            primaryLabel: paymentCopy.actionLabel,
            primaryAction: () => {
              setRejectDialog(null);
              router.push(brandPaymentOnboardingRoute(trip.brandId) as never);
            },
          };
        }
        case "offering_date_past":
          return {
            title: "Pick a future date",
            body: "This date has already passed. Choose a date that's still ahead so people can book it.",
            primaryLabel: "Got it",
            primaryAction: closeOnly,
          };
        // ORCH-1120 — Settings buyer-protection blocks (SPEC §4.4.3). All
        // reuse the "Refund first" shape + the closeAndOpenOrders CTA. Both
        // refund_policy_downgrade_with_sales and the RESERVED
        // refund_tier_removed_with_sales are handled (the RPC emits only the
        // former under the realized-% classifier; the latter case keeps the
        // exhaustive switch satisfied if Q-1 ever flips).
        case "refund_policy_downgrade_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} traveler${n === 1 ? "" : "s"} booked under the current refund terms. You can make refunds MORE generous, but to lower them, refund existing buyers first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "refund_tier_removed_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `${n} traveler${n === 1 ? "" : "s"} are protected by your current refund tiers. Add a tier freely, but removing one means refunding them first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "booking_deadline_earlier_with_sales": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Moving the deadline earlier can strand people mid-booking. You can push it LATER any time; to pull it in, refund the ${n} affected first.`,
            primaryLabel: "Open Orders",
            primaryAction: closeAndOpenOrders,
          };
        }
        case "bookings_closed_harms_active": {
          const n = result.affectedOrderCount ?? 0;
          return {
            title: "Refund first",
            body: `Closing bookings this way affects ${n} active booking${n === 1 ? "" : "s"}. Refund them first, or leave bookings open.`,
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
    [router, showToast, trip.brandId],
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

      // ORCH-1006 — persist "Who covers the costs?" switches (side-channel: the
      // trip patch RPC has no pass_* path). Unsold only — the section renders
      // read-only once sold, so this only runs when changes are allowed.
      if (
        computed.pricingSwitchesChanged !== null &&
        trip.ticketsSoldCount === 0
      ) {
        try {
          await setTripPricingSwitches(trip.id, computed.pricingSwitchesChanged);
        } catch {
          setSubmitting(false);
          setModal((prev) => ({ ...prev, visible: false }));
          showToast("Couldn't save who covers costs. Tap to try again.");
          return;
        }
      }

      // If ONLY the switches changed, the trip patch RPC has nothing to do —
      // finish without it (no buyer notification: who-covers-cost never changes
      // the buyer's all-in price, T-1).
      if (Object.keys(patch).length === 0) {
        // ORCH-1339 — persist any dirty guest-privacy toggles alongside (leaf
        // write; NON-BLOCKING — display prefs never block the save).
        if (computed.guestPrivacyChanged !== null) {
          try {
            await setEventGuestPrivacy(trip.id, computed.guestPrivacyChanged);
          } catch {
            showToast("Saved, but guest privacy didn't update. Try again from Settings.");
          }
        }
        setSubmitting(false);
        setModal((prev) => ({ ...prev, visible: false }));
        showToast("Saved. Live now.");
        setTimeout(() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            // orch-strict-grep-allow route-by-event-type — EditPublishedTripScreen is trip-only (app/trip/[id]/edit.tsx dispatch)
            router.replace(`/trip/${trip.id}` as never);
          }
        }, TOAST_NAV_DELAY_MS);
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

      // ORCH-1339 — the gated patch succeeded; persist any dirty guest-privacy
      // toggles via the leaf-write RPC (SPEC §4.7: AFTER the gated patch).
      // NON-BLOCKING: a display-pref failure never rolls back the saved patch.
      if (computed.guestPrivacyChanged !== null) {
        try {
          await setEventGuestPrivacy(trip.id, computed.guestPrivacyChanged);
        } catch {
          showToast("Saved, but guest privacy didn't update. Try again from Settings.");
        }
      }

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
              {/* ORCH-1118 — Departing from (origin), ABOVE Destination. The
                  shared selected-address field resolves a coordinate
                  automatically; typing nulls the structured fields. The
                  ORCH-1016 trigger syncs
                  theme.business_trip.departureLocationText/Lat/Lng →
                  events.departure_text/geo (unchanged). testID lives on the
                  wrapping View (the picker wrapper takes no testID prop). */}
              <View style={styles.fieldGroup} testID="edit-trip-departure">
                <Text style={styles.fieldLabel}>Departing from</Text>
                <MapboxAddressInput
                  value={editState.departureLocationText ?? ""}
                  accessibilityLabel="Departing from"
                  placeholder="e.g. Washington, DC, USA"
                  allowFreeText
                  selectionState={departureSelectionState}
                  selectedLabel={editState.departureLocationText ?? ""}
                  onChangeText={(v) => {
                    advanceLocationRequestGeneration(
                      departureRequestGenerationRef,
                    );
                    departureContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDepartureRef.current = v;
                    updateBasics({
                      departureLocationText: v.trim().length === 0 ? null : v,
                      departurePlaceId: null,
                      departureLat: null,
                      departureLng: null,
                      departureCoordinatePrecision: null,
                    });
                  }}
                  onFreeText={resolveDeparture}
                  onPick={(place, selectedLabel) => {
                    advanceLocationRequestGeneration(
                      departureRequestGenerationRef,
                    );
                    const label = selectedLabel ?? place.formattedAddress;
                    committedDepartureRef.current = label;
                    updateBasics({
                      departurePlaceId: place.placeId,
                      departureLocationText: label,
                      departureLat: place.location.lat,
                      departureLng: place.location.lng,
                      departureCoordinatePrecision: "approximate",
                    });
                    departureContextRef.current = {
                      city: place.city,
                      countryCode: place.countryCode,
                    };
                    setDepartureSelectionState("selected");
                  }}
                  onChangeSelected={() => {
                    advanceLocationRequestGeneration(
                      departureRequestGenerationRef,
                    );
                    departureContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDepartureRef.current =
                      editState.departureLocationText ?? "";
                    setDepartureSelectionState("editing");
                    updateBasics({
                      departurePlaceId: null,
                      departureLat: null,
                      departureLng: null,
                      departureCoordinatePrecision: null,
                    });
                  }}
                  onClear={() => {
                    advanceLocationRequestGeneration(
                      departureRequestGenerationRef,
                    );
                    departureContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDepartureRef.current = "";
                    setDepartureSelectionState("editing");
                    updateBasics({
                      departurePlaceId: null,
                      departureLocationText: null,
                      departureLat: null,
                      departureLng: null,
                      departureCoordinatePrecision: null,
                    });
                  }}
                  error={
                    showEditAddressErrors &&
                    !departureLocationValidated(
                      editState.departureLocationText,
                      editState.departurePlaceId,
                      editState.departureLat,
                      editState.departureLng,
                    )
                      ? TRIP_DEPARTURE_PICK_ERROR
                      : undefined
                  }
                />
              </View>
              <View style={styles.fieldGroup} testID="edit-trip-destination">
                <Text style={styles.fieldLabel}>Destination</Text>
                <MapboxAddressInput
                  value={editState.destinationLocationText ?? ""}
                  accessibilityLabel="Destination"
                  placeholder="e.g. Tulum, Quintana Roo, Mexico"
                  allowFreeText
                  selectionState={destinationSelectionState}
                  selectedLabel={editState.destinationLocationText ?? ""}
                  onChangeText={(v) => {
                    advanceLocationRequestGeneration(
                      destinationRequestGenerationRef,
                    );
                    destinationContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDestinationRef.current = v;
                    updateBasics({
                      destinationLocationText: v.trim().length === 0 ? null : v,
                      destinationPlaceId: null,
                      destinationLat: null,
                      destinationLng: null,
                      destinationCoordinatePrecision: null,
                    });
                  }}
                  onFreeText={resolveDestination}
                  onPick={(place, selectedLabel) => {
                    advanceLocationRequestGeneration(
                      destinationRequestGenerationRef,
                    );
                    const label = selectedLabel ?? place.formattedAddress;
                    committedDestinationRef.current = label;
                    updateBasics({
                      destinationPlaceId: place.placeId,
                      destinationLocationText: label,
                      destinationLat: place.location.lat,
                      destinationLng: place.location.lng,
                      destinationCoordinatePrecision: "approximate",
                    });
                    destinationContextRef.current = {
                      city: place.city,
                      countryCode: place.countryCode,
                    };
                    setDestinationSelectionState("selected");
                  }}
                  onChangeSelected={() => {
                    advanceLocationRequestGeneration(
                      destinationRequestGenerationRef,
                    );
                    destinationContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDestinationRef.current =
                      editState.destinationLocationText ?? "";
                    setDestinationSelectionState("editing");
                    updateBasics({
                      destinationPlaceId: null,
                      destinationLat: null,
                      destinationLng: null,
                      destinationCoordinatePrecision: null,
                    });
                  }}
                  onClear={() => {
                    advanceLocationRequestGeneration(
                      destinationRequestGenerationRef,
                    );
                    destinationContextRef.current = {
                      city: null,
                      countryCode: null,
                    };
                    committedDestinationRef.current = "";
                    setDestinationSelectionState("editing");
                    updateBasics({
                      destinationPlaceId: null,
                      destinationLocationText: null,
                      destinationLat: null,
                      destinationLng: null,
                      destinationCoordinatePrecision: null,
                    });
                  }}
                  error={
                    showEditAddressErrors &&
                    !destinationLocationValidated(
                      editState.destinationLocationText,
                      editState.destinationPlaceId,
                      editState.destinationLat,
                      editState.destinationLng,
                    )
                      ? TRIP_DESTINATION_PICK_ERROR
                      : undefined
                  }
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
              brandId={trip.brandId}
              eventId={trip.id}
              onShowToast={showToast}
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
          // META-ORCH-1174 Leg B2 — sole edited package (single-package B4).
          const editPkg = editState.pricing.packages[0];
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
          const parsedPriceMajor = parseFloat(editPkg?.priceMajor ?? "");
          const livePriceCents = Number.isFinite(parsedPriceMajor)
            ? Math.round(parsedPriceMajor * 100)
            : (firstTier?.priceCents ?? 0);
          const plannerPreviewSchedule =
            firstTier === undefined ||
            editPkg === undefined ||
            editPkg.paymentPlan === null
              ? null
              : projectInstallmentSchedule(
                  {
                    priceCents: livePriceCents,
                    currency: firstTier.currency,
                    installmentSchedule: editPkg.paymentPlan,
                  },
                  new Date(),
                );
          // META-ORCH-1174 Leg B2 — pass the per-package sold count via the
          // package's `soldCount` so the single edited package shows the
          // post-sale price lock. (B4 multi-package edit comes later.)
          const lockedPackages = editState.pricing.packages.map((p, idx) =>
            idx === 0 ? { ...p, soldCount: soldCountForTier } : p,
          );
          return (
            <View>
              <TripCreatorStep4Pricing
                draft={{ ...editState.pricing, packages: lockedPackages }}
                onChange={handlePricingChange}
                disabled={submitting}
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
              {/* ORCH-0989 — unified CoverPickerSheet; video ENABLED on trips. */}
              <View style={styles.coverPreviewWrap}>
                <EventCoverMedia
                  hue={0}
                  mediaUrl={editState.coverMediaUrl}
                  mediaType={editState.coverMediaType}
                  radius={12}
                  label={editState.coverMediaAlt ?? "trip cover"}
                  height={180}
                  muted={true}
                  showAudioControl={editState.coverMediaType === "video"}
                />
              </View>
              <Button
                label={
                  typeof editState.coverMediaUrl === "string" &&
                  editState.coverMediaUrl.length > 0
                    ? "Change cover"
                    : "Add cover"
                }
                leadingIcon="upload"
                variant="secondary"
                size="md"
                shape="square"
                onPress={() => setCoverPickerVisible(true)}
                disabled={submitting}
                accessibilityLabel="Add cover photo, GIF, or video"
              />
              <CoverPickerSheet
                visible={coverPickerVisible}
                onClose={() => setCoverPickerVisible(false)}
                target={{
                  kind: "trip",
                  brandId: trip.brandId,
                  eventRowId: trip.id,
                  coverMediaApplyMode: "published_manual",
                }}
                initial={{
                  coverMediaUrl: editState.coverMediaUrl,
                  coverMediaPosterUrl: editState.coverMediaPosterUrl,
                  coverMediaType: editState.coverMediaType,
                  coverMediaProvider: editState.coverMediaProvider,
                  coverMediaSourceUrl: editState.coverMediaSourceUrl,
                  coverMediaCredit: editState.coverMediaCredit,
                  coverMediaCreditUrl: editState.coverMediaCreditUrl,
                  coverMediaAlt: editState.coverMediaAlt,
                  // issue #868 [cover-gallery] — seed the manager from edit state.
                  coverGallery: editState.coverGallery,
                }}
                onCoverChange={handleCoverChange}
                onShowToast={showToast}
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
          // ORCH-1120 [Settings refund/deadline editable] — the dead-end
          // read-only snapshot + "use the wizard" hint is replaced by a live,
          // sales-gated editor. REWORK (2026-06-12): the accordion is now a
          // PURE CONTROLLED EDITOR — its three values lift into editState and
          // the screen's single bottom Save button owns the diff, reason prompt
          // (ChangeSummaryModal), gate (biz_update_live_trip), and reject path
          // (buildRejectDialog). All writes route through biz_update_live_trip
          // (the accordion never calls refundPolicyService); refund-class
          // rejects render through this screen's ConfirmDialog via handleConfirmSave.
          return (
            <EditPublishedTripSettingsAccordion
              refundPolicy={editState.refundPolicy}
              onRefundPolicyChange={handleRefundPolicyChange}
              bookingDeadline={editState.bookingDeadline}
              onBookingDeadlineChange={handleBookingDeadlineChange}
              bookingsClosed={editState.bookingsClosed}
              onBookingsClosedChange={handleBookingsClosedChange}
              // ORCH-1339 — guest-privacy display gates (side-channel save via
              // setEventGuestPrivacy; excluded from buildLiveTripPatch).
              privateGuestList={editState.privateGuestList}
              onPrivateGuestListChange={handlePrivateGuestListChange}
              hideRemainingCount={editState.hideRemainingCount}
              onHideRemainingCountChange={handleHideRemainingCountChange}
              tripStartIso={trip.businessTrip.startAt}
              brandTimezone={trip.timezone}
              affectedOrderCount={totalConfirmedOrders}
              submitting={submitting}
            />
          );
        default: {
          const _exhaust: never = key;
          return _exhaust;
        }
      }
    },
    [
      editState,
      showEditAddressErrors,
      departureSelectionState,
      destinationSelectionState,
      resolveDeparture,
      resolveDestination,
      // ORCH-1122 [trip-edit cover dead-tap] — the cover section body renders
      // <CoverPickerSheet visible={coverPickerVisible}> and the "Change cover"
      // button inside this memoized callback. Omitting coverPickerVisible left
      // the memoized body closed over the stale `false`, so tapping the button
      // (setCoverPickerVisible(true)) re-rendered the screen but served the
      // cached body with visible={false} → the sheet never opened (dead tap).
      // Adding it as a dep re-mints the body when the flag flips. (The
      // setCoverPickerVisible setter is referentially stable and needs no dep.)
      coverPickerVisible,
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
      // ORCH-1120 — Settings controlled-editor wiring.
      handleRefundPolicyChange,
      handleBookingDeadlineChange,
      handleBookingsClosedChange,
      // ORCH-1339 — guest-privacy controlled-editor wiring (same ORCH-1122
      // stale-closure class: the memoized body renders the two switches).
      handlePrivateGuestListChange,
      handleHideRemainingCountChange,
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
          { paddingBottom: insets.bottom + 120 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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

        {/* issue #2101 [named-buyer checkout] — the SAME shared configuration
            card as the Event and Experience management surfaces (one service
            owner; no per-offering-type policy logic). Web-only by filename
            resolution: the .native.tsx sibling is a typed null renderer. */}
        {Platform.OS === "web" ? (
          <View style={styles.sectionCard}>
            <React.Suspense fallback={null}>
              <EventTicketCheckoutAccessCard eventId={trip.id} />
            </React.Suspense>
          </View>
        ) : null}
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
    overflow: "hidden",
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
  // Issue #1363 — non-silent inline hint on a failed free-text geocode (rule 3).
  editAddressHint: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.warning,
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
    gap: spacing.sm,
  },
  coverPreviewWrap: {
    borderRadius: 12,
    overflow: "hidden",
  },
  // ORCH-0882 — planner-variant preview below PaymentPlanEditor in the
  // Pricing accordion. Sibling card with consistent vertical breathing
  // room so planner immediately sees what their buyers will see.
  plannerPlanPreviewWrap: {
    width: "100%",
    marginTop: spacing.lg,
  },
  // ORCH-1120 — settingsWrap/settingsHint/settingsField/settingsLabel/
  // settingsValue deleted: the read-only Settings snapshot + dead-end hint is
  // replaced by <EditPublishedTripSettingsAccordion />.
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
