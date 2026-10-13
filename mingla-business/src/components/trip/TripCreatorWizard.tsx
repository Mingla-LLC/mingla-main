/**
 * TripCreatorWizard — host component for the 8-step trip-planner wizard.
 * Tr2 (ORCH-0859). Chrome rewritten in ORCH-0874 [Trip surfaces visual
 * parity with Events] per SPEC §3.3.5 + DESIGN §3.3 to mirror
 * EventCreatorWizard chrome:
 *
 *   - Chrome row: [Close X (always)] + [named Stepper] + [step counter]
 *   - Subtitle row: "{brand.name} · Step N of 7" + current title/subtitle
 *     + autosave-state text
 *   - Floating glass dock: Step 1 = single Continue; Steps 2-6 = Back+Continue;
 *     Step 7 = Back+Publish. Dock hides when keyboard up.
 *   - handleClose branches on isCreateMode + pristine:
 *     - Create + pristine: discard trip immediately + onExit
 *     - Create + dirty: show ConfirmDialog ("Discard this trip?")
 *     - Edit: silent onExit (autosave semantics)
 *   - Publish flow: ConfirmDialog ("Publish trip?") before mutation
 *   - Keyboard: SmartScrollView/KAS owns focused-input scrolling
 *
 * Spec: Mingla_Artifacts/specs/SPEC_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md
 * Design: Mingla_Artifacts/design/DESIGN_ORCH-0874_TRIP_VISUAL_PARITY_WITH_EVENTS.md
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Keyboard listener
// + KeyboardAvoidingView wrap DELETED. KAS handles focused-input scroll.
// useKeyboardIsVisible() preserves dock-hide UX. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";
import { useKeyboardIsVisible } from "../../wrappers/useKeyboardIsVisible";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";

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
import { useScrollToTopOnStepChange } from "../../hooks/useScrollToTopOnStepChange";
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
  // META-ORCH-1174 Leg B2 — N-package create/remove mutations.
  useCreateTripPricingTier,
  useRemoveTripPricingTier,
  usePublishTrip,
} from "../../hooks/useTrips";
// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 autosave hooks.
import {
  useUpdateBookingDeadline,
  useUpdateRefundPolicy,
} from "../../hooks/useRefundPolicy";
import type { Trip, TripPublishValidationError } from "../../services/tripsService";
import { setTripPricingSwitches } from "../../services/tripsService";
// ORCH-1339 — guest-privacy leaf-write RPC (never the big trip edit RPCs).
import { setEventGuestPrivacy } from "../../services/businessEvents";
import type { ThemeInput } from "@mingla/offering-rendering";
import {
  normalizeThemeOverrides,
  patchOfferingTheme,
} from "../../services/offeringTheme";

import {
  TripCreatorStep1Basics,
  type Step1Draft,
} from "./TripCreatorStep1Basics";
// ORCH-1118 — trip departure + destination must be confirmed Mapbox picks before
// publish (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED). Do not loosen.
import {
  departureLocationValidated,
  destinationLocationValidated,
} from "./tripLocationValidated";
import { TripCreatorStep2Itinerary } from "./TripCreatorStep2Itinerary";
import type { TripDayDraft } from "./TripDayEditor";
import {
  TripCreatorStep3Inclusions,
  type InclusionDraft,
} from "./TripCreatorStep3Inclusions";
import {
  TripCreatorStep4Pricing,
  makePackageKey,
  type Step4Draft,
  type Step4Package,
} from "./TripCreatorStep4Pricing";
// META-ORCH-1174 Leg B2 — pure (RN-free) publish-gate package validator.
import { validateTripPackages } from "./tripPackagesValidation";
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
import {
  brandPaymentOnboardingRoute,
  resolveProviderNeutralPaidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
// issue #3801 — `supabase.rpc()` rejects with a PostgREST PLAIN OBJECT, and
// tripsService re-throws it verbatim. Reading the caught value as "its
// message if it is an Error, otherwise its string form" produced the literal
// text "[object Object]", so no guard reason could ever match. This reader
// (issue #3047) handles an Error, a plain object and a string, and never
// yields that.
import { readRpcFailureMessage } from "../../services/rsvpRpcFailure";
import {
  offeringNeedsStripeToPublish,
  tripDraftIsPaid,
} from "../offering/publishStripeReadiness";
import { useOrganiserTermsPublishGate } from "../../hooks/useOrganiserTermsPublishGate";
import {
  buildBankSetupReturnPath,
  resolveTripWizardInitialStep,
  withBankSetupReturn,
} from "../../utils/bankSetupReturn";
import { payoutGateStatus, isBrandPayoutReady } from "../../utils/brandPayout";
import { useBrandPaystackStatus } from "../../hooks/useBrandPaystack";
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
// ISSUE-1001 — the official business lockup now imports from the canonical
// master @mingla/brand-assets (packages/brand-assets/mingla-business-logo.png);
// the app-local copy is deleted.
import { MINGLA_BUSINESS_LOGO } from "@mingla/brand-assets";
// #1780 [bundle budget] — the invite surfaces come from their lazy owner, not
// from InvitePeopleStep directly. All four wizards are separate lazy route
// chunks, so a static import hoisted the whole invite cluster into `__common`,
// the boot payload every business-web visitor downloads (ORCH-1083 / #1509).
// See LazyInvitePeopleStep.tsx.
import {
  InvitePeoplePublishConfirmation,
  InvitePeopleStep,
  InvitePlanReviewSummary,
  type InviteNavigationState,
  InvitePlanSummaryBridge,
  PENDING_WIZARD_INVITE_SUMMARY,
  type WizardInvitePlanSummary,
} from "../invites/LazyInvitePeopleStep";
import { useFeatureFlag } from "../../hooks/useFeatureFlag";
import { useWizardHardwareBack } from "../../hooks/useWizardHardwareBack";
import type {
  WizardInvitePlan,
  WizardInviteQuote,
} from "../../services/offeringInvitePlanService";

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
  /**
   * #3645 — the step to open on (the route's `?step=`), used when the host
   * comes back from bank setup after a full page load. Anything that is not a
   * step the wizard can open cold is ignored and the wizard starts at step 1.
   */
  initialStep?: number;
}

type StepIndex = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;


const STEP_TITLES: Record<StepIndex, string> = {
  1: "Basics",
  2: "Day by day",
  3: "What's included",
  4: "Pricing",
  5: "Cancellation & deadline",
  6: "Traveler info",
  7: "Invite people",
  8: "Review",
};

const STEP_SUBTITLES: Record<StepIndex, string> = {
  1: "Title, dates and destination",
  2: "Day-by-day itinerary",
  3: "What's included and excluded",
  4: "Pricing and payment plan",
  5: "Refund tiers and when bookings close",
  6: "What to ask travelers before they pay",
  7: "Choose people from Your Book",
  8: "Preview and publish",
};

// ORCH-0880 [Tr5 Traveler Intake Forms] — wizard grew from 6 to 7 steps per
// DESIGN_ORCH-0880 §3.1. Step 6 NEW (per-tier traveler intake schema
// builder + live preview); Review moved to Step 7.
const STEP_COUNT = 8;

// issue #3801 — what the organiser is told, ON THE STEP WHERE IT HAPPENED, when
// a save fails for a reason we have no mapped copy for. A raw server code, a
// constraint name or developer wording is never shown.
const TRIP_STEP_SAVE_FAILED_MESSAGE =
  "We couldn't save this step. Check your connection and try again.";
const TRIP_DISCARD_FAILED_MESSAGE =
  "We couldn't discard this trip. Check your connection and try again.";

const STEPPER_STEPS: StepperStep[] = [
  { id: "step-1", label: STEP_TITLES[1] },
  { id: "step-2", label: STEP_TITLES[2] },
  { id: "step-3", label: STEP_TITLES[3] },
  { id: "step-4", label: STEP_TITLES[4] },
  { id: "step-5", label: STEP_TITLES[5] },
  { id: "step-6", label: STEP_TITLES[6] },
  { id: "step-7", label: STEP_TITLES[7] },
  { id: "step-8", label: STEP_TITLES[8] },
];

const DESKTOP_WIZARD_NAV_ITEMS = [
  { label: "Home", icon: "home", href: "/(tabs)/home", active: false },
  { label: "Hub", icon: "calendar", href: "/(tabs)/hub/trips", active: true },
  { label: "Ari", icon: "sparkle", href: "/(tabs)/ari", active: false },
  { label: "Blast", icon: "send", href: "/(tabs)/marketing", active: false },
] as const;

// #1022 — exported alongside isTripWizardPristine for the same reason.
export function tripToStep1Draft(trip: Trip): Step1Draft {
  return {
    title: trip.title,
    startAt: trip.businessTrip.startAt,
    endAt: trip.businessTrip.endAt,
    destinationPlaceId: trip.businessTrip.destinationPlaceId,
    destinationLocationText: trip.businessTrip.destinationLocationText,
    destinationLat: trip.businessTrip.destinationLat,
    destinationLng: trip.businessTrip.destinationLng,
    // ORCH-1016 — departure (origin) seeded from current trip row.
    departurePlaceId: trip.businessTrip.departurePlaceId,
    departureLocationText: trip.businessTrip.departureLocationText,
    departureLat: trip.businessTrip.departureLat,
    departureLng: trip.businessTrip.departureLng,
    // Issue #1363 — precision is a transient capture-side signal; existing trips
    // predate it, so seed null (the coordinate itself is already present).
    destinationCoordinatePrecision: null,
    departureCoordinatePrecision: null,
    // ORCH-0876 — cover media seeded from current trip row.
    coverMediaUrl: trip.coverMediaUrl,
    coverMediaType:
      trip.coverMediaType === "image" ||
      trip.coverMediaType === "video" ||
      trip.coverMediaType === "gif"
        ? trip.coverMediaType
        : null,
    // issue #868 [cover-gallery] — seed the ADDITIONAL photos from the trip row.
    coverGallery: trip.coverGallery ?? [],
    // #1022 — seed from the trip's persisted theme override columns.
    themeOverrides: normalizeThemeOverrides(trip.themeOverrides),
  };
}

export function tripToDaysDraft(trip: Trip): TripDayDraft[] {
  return trip.days.map((d) => ({
    ordinal: d.ordinal,
    title: d.title,
    narrative: d.narrative ?? "",
    // ORCH-1119 — seed the day's media gallery from the persisted trip.
    media: d.media ?? [],
  }));
}

export function tripToInclusionsDraft(trip: Trip): InclusionDraft[] {
  return trip.inclusions.map((i) => ({
    kind: i.kind,
    item: i.item,
    ordinal: i.ordinal,
  }));
}

// META-ORCH-1174 Leg B2 — seed N packages from ALL persisted pricing tiers.
// packages[0] is the primary tier (createTripDraft-seeded). When the trip has
// no tiers yet (brand-new draft pre-first-autosave), seed one empty primary
// package so the wizard always shows ≥1 row (DEC-E min 1).
function tierToStep4Package(tier: Trip["pricingTiers"][number]): Step4Package {
  return {
    key: makePackageKey(),
    ticketTypeId: tier.ticketTypeId,
    name: tier.tierName,
    priceMajor: (tier.priceCents / 100).toFixed(2),
    description: tier.description ?? "",
    capacity: tier.quantityTotal,
    paymentPlan: tier.installmentSchedule ?? null,
    // Drafts have no sales; the per-package post-sale lock is server-enforced.
    soldCount: 0,
  };
}

export function tripToStep4Draft(trip: Trip): Step4Draft {
  const currency = trip.pricingTiers[0]?.currency ?? "USD";
  const packages: Step4Package[] =
    trip.pricingTiers.length > 0
      ? trip.pricingTiers.map(tierToStep4Package)
      : [
          {
            key: makePackageKey(),
            ticketTypeId: null,
            name: "Standard",
            priceMajor: "",
            description: "",
            capacity: trip.businessTrip.capacity,
            paymentPlan: null,
            soldCount: 0,
          },
        ];
  return {
    packages,
    currency,
    // ORCH-1006 — seed switches from events.pass_* (NULL = inherit).
    pricingSwitches: {
      passTax: trip.pricingSwitches?.passTax ?? null,
      passMinglaFee: trip.pricingSwitches?.passMinglaFee ?? null,
      passServiceFee: trip.pricingSwitches?.passServiceFee ?? null,
    },
  };
}

/**
 * Issue #3801 — a trip's capacity is the SUM of its packages' spots. Mirrors
 * `sumTripPackageSpots` (services/tripPackages), which owns the same rule for
 * persisted rows; restated here over the draft shape because this file is
 * mounted by compiled-boundary suites that reject any new import.
 * `null` when there is no package or any package has no spots set — never a
 * partial number (Constitution rule 9).
 */
export function draftPackagesTotalSpots(
  packages: readonly Pick<Step4Package, "capacity">[],
): number | null {
  if (packages.length === 0) return null;
  let total = 0;
  for (const pkg of packages) {
    if (pkg.capacity === null || !Number.isFinite(pkg.capacity)) return null;
    total += Math.max(0, pkg.capacity);
  }
  return total;
}

/**
 * Issue #3801 — does this itinerary day hold anything the host put there?
 * The auto-seeded shell is `Day N` with no description and no media; a day the
 * host added by hand starts with an empty title. Anything else is content.
 */
export function tripDayHasHostContent(day: TripDayDraft): boolean {
  const title = day.title.trim();
  if (title.length > 0 && title !== `Day ${day.ordinal}`) return true;
  if (day.narrative.trim().length > 0) return true;
  return (day.media ?? []).length > 0;
}

/**
 * Issue #3801 — fit the itinerary to the day count the dates imply.
 *
 * Growing appends empty `Day N` shells. Shrinking drops trailing days ONLY when
 * none of them holds host content; otherwise the itinerary is returned
 * untouched together with the days that are at risk, and the caller must ask.
 * A date change used to slice the list silently, and the next itinerary save
 * (delete-then-insert on the server) made the loss permanent.
 */
export function fitItineraryToDayCount(
  current: TripDayDraft[],
  dayCount: number,
): { days: TripDayDraft[]; atRisk: TripDayDraft[] } {
  if (current.length === dayCount) return { days: current, atRisk: [] };
  if (current.length < dayCount) {
    const next = [...current];
    for (let i = current.length; i < dayCount; i += 1) {
      next.push({ ordinal: i + 1, title: `Day ${i + 1}`, narrative: "", media: [] });
    }
    return { days: next, atRisk: [] };
  }
  const atRisk = current.slice(dayCount).filter(tripDayHasHostContent);
  if (atRisk.length > 0) return { days: current, atRisk };
  return { days: current.slice(0, dayCount), atRisk: [] };
}

/** Issue #3801 — plain copy for the "this removes a day you wrote" question. */
export function describeItineraryDaysAtRisk(atRisk: TripDayDraft[]): string {
  const ordinals = atRisk.map((d) => String(d.ordinal));
  if (ordinals.length === 1) {
    return `Shortening this trip removes Day ${ordinals[0]} and what you wrote for it.`;
  }
  const list = `${ordinals.slice(0, -1).join(", ")} and ${ordinals[ordinals.length - 1]}`;
  return `Shortening this trip removes Days ${list} and what you wrote for them.`;
}

// META-ORCH-1174 Leg B2 — canonical signature of the authored package set for
// pristine / dirty comparison (ignores the client-only `key`).
function step4PackagesSignature(packages: Step4Package[]): string {
  return JSON.stringify(
    packages.map((p) => ({
      ticketTypeId: p.ticketTypeId,
      name: p.name,
      priceMajor: p.priceMajor,
      description: p.description,
      capacity: p.capacity,
      paymentPlan: p.paymentPlan,
    })),
  );
}

// ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5 draft seed from
// trip's persisted refund_policy + booking_deadline columns.
// ORCH-1339 — plus the two guest-privacy display gates (theme leaf via
// tripsService.readGuestPrivacy; false defaults).
export function tripToStep5Draft(trip: Trip): Step5Draft {
  return {
    refundPolicy: trip.refundPolicy,
    bookingDeadline: trip.bookingDeadline,
    privateGuestList: trip.guestPrivacy?.privateGuestList ?? false,
    hideRemainingCount: trip.guestPrivacy?.hideRemainingCount ?? false,
  };
}

/**
 * Pristine check: returns true when none of the 4 step drafts have diverged
 * from the server-derived initial values. Used to skip the discard dialog
 * on a freshly-created create-mode draft (no edits → silent discard).
 *
 * Per SPEC_ORCH-0874 §3.3.5 handleClose pristine branch.
 */
// #1022 — exported so the pristine contract (B-3: theme + departure fields)
// is directly testable; the wizard remains its only runtime caller.
export function isTripWizardPristine(
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
    // ORCH-0876 — cover fields part of Step 1 draft now.
    step1Draft.coverMediaUrl !== initStep1.coverMediaUrl ||
    step1Draft.coverMediaType !== initStep1.coverMediaType ||
    // #1022 B-3 — the four ORCH-1016 departure fields were never compared, so
    // "type a departure city, tap X" silently discarded it. In scope here
    // because the moment themeOverrides joins step1Draft the same silent
    // discard applies to a theme-only edit.
    step1Draft.departurePlaceId !== initStep1.departurePlaceId ||
    step1Draft.departureLocationText !== initStep1.departureLocationText ||
    step1Draft.departureLat !== initStep1.departureLat ||
    step1Draft.departureLng !== initStep1.departureLng ||
    // #1022 — theme participates in pristineness, null-normalised both sides.
    JSON.stringify(normalizeThemeOverrides(step1Draft.themeOverrides)) !==
      JSON.stringify(normalizeThemeOverrides(initStep1.themeOverrides))
  ) {
    return false;
  }
  // NOTE (#1022): step6Draft is deliberately still absent from this
  // signature — that gap is out of scope for this build and tracked in #1028.
  // Step 2: days length + every (ordinal, title, narrative) equal
  const initDays = tripToDaysDraft(trip);
  if (daysDraft.length !== initDays.length) return false;
  const mediaSig = (m: TripDayDraft["media"]): string =>
    (m ?? []).map((x) => `${x.url}|${x.type}`).join(",");
  for (let i = 0; i < daysDraft.length; i += 1) {
    if (
      daysDraft[i].ordinal !== initDays[i].ordinal ||
      daysDraft[i].title !== initDays[i].title ||
      daysDraft[i].narrative !== initDays[i].narrative ||
      // ORCH-1119 — a media change marks the day dirty (autosave + discard guard).
      mediaSig(daysDraft[i].media) !== mediaSig(initDays[i].media)
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
  // Step 4: META-ORCH-1174 Leg B2 — the full N-package set must match the
  // server-derived initial set (name + price + description + capacity + plan
  // per package, and the same package count).
  const initStep4 = tripToStep4Draft(trip);
  if (
    step4PackagesSignature(step4Draft.packages) !==
    step4PackagesSignature(initStep4.packages)
  ) {
    return false;
  }
  // ORCH-0875 [Tr4 Refund Tiers + Booking Deadline] — Step 5: refundPolicy +
  // bookingDeadline equal to initial trip values.
  const initStep5 = tripToStep5Draft(trip);
  if (
    JSON.stringify(step5Draft.refundPolicy) !== JSON.stringify(initStep5.refundPolicy) ||
    step5Draft.bookingDeadline !== initStep5.bookingDeadline ||
    // ORCH-1339 — the two guest-privacy toggles count as edits too.
    step5Draft.privateGuestList !== initStep5.privateGuestList ||
    step5Draft.hideRemainingCount !== initStep5.hideRemainingCount
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
  initialStep,
}) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signOut } = useAuth();
  const { isWideDesktop } = useResponsiveLayout();
  // #3645 PR11c — Organiser Terms before first paid listing publish.
  const {
    blockPaidPublishUntilAccepted,
    gateElement: organiserTermsGateElement,
  } = useOrganiserTermsPublishGate(trip.brandId);
  const [step, setStep] = useState<StepIndex>(() =>
    resolveTripWizardInitialStep(initialStep),
  );
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

  // ORCH-0874: publish ConfirmDialog state (Step 7 publish tap).
  const [publishConfirmVisible, setPublishConfirmVisible] = useState<boolean>(false);
  const [invitePublishConfirmVisible, setInvitePublishConfirmVisible] =
    useState<boolean>(false);
  const [inviteNavigation, setInviteNavigation] = useState<InviteNavigationState | null>(null);
  const [checkingInvitePublish, setCheckingInvitePublish] = useState(false);

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

  // ORCH-1076 Stream B — proactive Stripe gate. A paid trip (single online
  // tier price > 0) on a brand that can't yet charge needs Stripe before it
  // can publish. tripDraftIsPaid mirrors the ORCH-1075 server predicate
  // (max(price_cents) WHERE available_online > 0); brand.stripeStatus mirrors
  // pg_brand_can_charge. The reactive RPC catch in handleConfirmPublish stays
  // the canonical fail-close.
  const tripNeedsStripe = useMemo(
    () =>
      offeringNeedsStripeToPublish({
        isPaid: tripDraftIsPaid(step4Draft),
        stripeStatus: payoutGateStatus(brand),
      }),
    [step4Draft, brand],
  );

  // #3645 — trip instalment plans stay bank/payout-gated (later charges weeks
  // after sale). Charge-ready alone is not enough when any package has a plan.
  // Freshen recipient_connected from Paystack status when available.
  const paystackStatusQuery = useBrandPaystackStatus(
    brand.paymentProvider === "paystack" ? brand.id : null,
  );
  const tripNeedsBankForInstallments = useMemo(() => {
    const hasPlan = step4Draft.packages.some((p) => p.paymentPlan != null);
    return (
      hasPlan &&
      !isBrandPayoutReady({
        ...brand,
        hasPaystackRecipient:
          paystackStatusQuery.data?.recipient_connected === true
            ? true
            : brand.hasPaystackRecipient,
      })
    );
  }, [
    step4Draft.packages,
    brand,
    paystackStatusQuery.data?.recipient_connected,
  ]);

  // META-ORCH-1174 Leg B2 — publish gate: every authored package must be valid
  // (≥1 package, name + price ≥0 + capacity ≥1 + valid plan terms). Blocks
  // Publish (dock disabled = suspenders; handlePublishTap = belt).
  const packagesValidation = useMemo(
    () => validateTripPackages(step4Draft.packages),
    [step4Draft.packages],
  );

  // ORCH-1118 — BOTH departure and destination must be confirmed Mapbox picks
  // (placeId + lat + lng) before publish. Empty or dirty (typed-but-unpicked)
  // text on EITHER field blocks publish. Do not loosen
  // (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED).
  const tripLocationValid = useMemo(
    () =>
      destinationLocationValidated(
        step1Draft.destinationLocationText,
        step1Draft.destinationPlaceId,
        step1Draft.destinationLat,
        step1Draft.destinationLng,
      ) &&
      departureLocationValidated(
        step1Draft.departureLocationText,
        step1Draft.departurePlaceId,
        step1Draft.departureLat,
        step1Draft.departureLng,
      ),
    [
      step1Draft.destinationLocationText,
      step1Draft.destinationPlaceId,
      step1Draft.destinationLat,
      step1Draft.destinationLng,
      step1Draft.departureLocationText,
      step1Draft.departurePlaceId,
      step1Draft.departureLat,
      step1Draft.departureLng,
    ],
  );
  const [showStep1AddressErrors, setShowStep1AddressErrors] =
    useState<boolean>(false);

  // #3645 — "Connect bank" carries where the host is, so bank setup brings
  // them straight back to this trip on this step (web and native).
  const bankSetupRoute = useMemo(
    () =>
      withBankSetupReturn(
        brandPaymentOnboardingRoute(trip.brandId),
        buildBankSetupReturnPath({ kind: "trip", id: trip.id, step }),
      ),
    [trip.brandId, trip.id, step],
  );
  const handleConnectStripe = useCallback((): void => {
    router.push(bankSetupRoute as never);
  }, [router, bankSetupRoute]);

  // #3645 — the Organiser Terms sheet resumes the publish it interrupted. The
  // ref always holds the LATEST handlePublishTap.
  const resumePublishRef = useRef<() => void>(() => undefined);

  // ORCH-0892-B v2: keyboard listener + keyboardVisible/keyboardHeight state
  // DELETED. KAS via SmartScrollView handles focused-input scroll. dock-hide
  // UX preserved via useKeyboardIsVisible() wrapper hook. Per SPEC §7.F.
  const keyboardVisible = useKeyboardIsVisible();
  // ORCH-0884 follow-up #9 — ScrollView ref passed to TripCreatorStep1Basics
  // → CoverPicker so the GIPHY/Pexels search TextInput can trigger an
  // explicit scroll-on-focus past iOS's auto-scroll position. Retained
  // for ORCH-0892-B v2 — KAS scrolls via its own animated ref; this JS-side
  // ref is unused by KAS but kept for the CoverPicker drilldown prop chain.
  const scrollViewRef = useRef<ScrollView | null>(null);
  // Each step opens at the top — the ScrollView is shared by every step.
  useScrollToTopOnStepChange(scrollViewRef, step);

  const updateBasicsMutation = useUpdateTripBasics();
  const upsertDaysMutation = useUpsertTripDays();
  const upsertInclusionsMutation = useUpsertTripInclusions();
  const updatePricingMutation = useUpdateTripPricing();
  // META-ORCH-1174 Leg B2 — N-package create/remove.
  const createTierMutation = useCreateTripPricingTier();
  const removeTierMutation = useRemoveTripPricingTier();
  const publishMutation = usePublishTrip();
  const inviteFlag = useFeatureFlag("business_wizard_invite_selection_v1");
  // #1780 [bundle budget] — the saved selection arrives from the LAZY invite
  // module, not from a hook imported here. All four wizards are separate lazy
  // route chunks, so an eager `useOfferingInvitePlanSummary` import kept that
  // hook and offeringInvitePlanService in `__common`, the payload every
  // business-web visitor downloads. The bridge below calls the same hook with
  // the same inputs on the far side of the chunk and reports each result here;
  // the snapshot has the hook's own shape, so every expression that reads it is
  // unchanged. Until it arrives this is PENDING_WIZARD_INVITE_SUMMARY, which
  // reads as "still loading", so Publish readiness and the rollback step
  // correction stay CLOSED rather than acting on a value we do not have.
  const [inviteSummary, setInviteSummary] =
    useState<WizardInvitePlanSummary>(PENDING_WIZARD_INVITE_SUMMARY);
  const invitePlan = inviteSummary.plan.data ?? null;
  const inviteQuote = inviteSummary.quote.data ?? null;
  const inviteEnabled = inviteFlag.data === true ||
    (invitePlan?.selectedCount ?? 0) > 0;
  const inviteRollbackReady = inviteFlag.data === false &&
    !inviteFlag.isPending && !inviteFlag.isFetching && !inviteFlag.isError &&
    invitePlan?.selectedCount === 0 &&
    !inviteSummary.plan.isPending && !inviteSummary.plan.isFetching &&
    !inviteSummary.plan.isError;
  const inviteSummaryReady = !inviteEnabled || (invitePlan !== null && inviteQuote !== null &&
    inviteQuote.selectionRevision === invitePlan.selectionRevision &&
    inviteQuote.selectionHash === invitePlan.selectionHash &&
    !inviteSummary.plan.isPending && !inviteSummary.plan.isFetching &&
    !inviteSummary.plan.isError && !inviteSummary.quote.isPending &&
    !inviteSummary.quote.isFetching && !inviteSummary.quote.isError);
  const invitePublishReady = inviteEnabled ? inviteSummaryReady : inviteRollbackReady;
  const handleInvitePlanChange = useCallback((
    _plan: WizardInvitePlan | null,
    _quote: WizardInviteQuote | null,
    navigation: InviteNavigationState,
  ) => setInviteNavigation(navigation), []);
  useEffect(() => {
    if (inviteFlag.data === false && invitePlan?.selectedCount === 0) {
      setStep((value) => value === 7 ? 8 : value);
    }
  }, [inviteFlag.data, invitePlan?.selectedCount]);
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

  // META-ORCH-1174 Leg B2 — capacity is PER-PACKAGE (DEC-D), authored in
  // Step 4 and persisted to each package's ticket_types.quantity_total.
  // Issue #3801 — Step 1 no longer has a trip-level capacity field (it was
  // never saved), so nothing seeds a package's spots from it. The trip total
  // is derived: the sum of the packages' spots.

  // Issue #3801 — what the itinerary-fit effect below needs without re-running
  // on every keystroke in a day: the live itinerary, the live dates, and the
  // last dates the itinerary was fitted to (what "Keep dates" restores).
  const daysDraftRef = useRef<TripDayDraft[]>(daysDraft);
  daysDraftRef.current = daysDraft;
  const step1DraftDatesRef = useRef<{ startAt: string | null; endAt: string | null }>({
    startAt: step1Draft.startAt,
    endAt: step1Draft.endAt,
  });
  step1DraftDatesRef.current = {
    startAt: step1Draft.startAt,
    endAt: step1Draft.endAt,
  };
  const acceptedDatesRef = useRef<{ startAt: string | null; endAt: string | null }>({
    startAt: step1Draft.startAt,
    endAt: step1Draft.endAt,
  });
  const itineraryFittedOnceRef = useRef<boolean>(false);
  const [pendingDayTrim, setPendingDayTrim] = useState<{
    atRisk: TripDayDraft[];
    dayCount: number;
    previousStartAt: string | null;
    previousEndAt: string | null;
  } | null>(null);

  // ORCH-0859 REWORK 3: auto-seed days from Step 1 date range (unchanged).
  // Issue #3801 — the range-to-day-count guards and the grow / trim shapes
  // below are the original ones; what changed is that a trim which would
  // remove a day holding host content is asked about first.
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
    // Issue #3801 — never drop a day that holds host content without asking.
    const { atRisk } = fitItineraryToDayCount(daysDraftRef.current, dayCount);
    const isFirstFit = !itineraryFittedOnceRef.current;
    itineraryFittedOnceRef.current = true;
    if (atRisk.length > 0) {
      // On open there is no date change to undo, so nothing is asked and
      // nothing is removed. After a date change, ask; declining puts the
      // previous dates back.
      if (!isFirstFit) {
        setPendingDayTrim({
          atRisk,
          dayCount,
          previousStartAt: acceptedDatesRef.current.startAt,
          previousEndAt: acceptedDatesRef.current.endAt,
        });
      }
      return;
    }
    acceptedDatesRef.current = { startAt: startIso, endAt: endIso };
    setDaysDraft((current) => {
      if (current.length === dayCount) return current;
      if (current.length < dayCount) {
        const next = [...current];
        for (let i = current.length; i < dayCount; i += 1) {
          next.push({
            ordinal: i + 1,
            title: `Day ${i + 1}`,
            narrative: "",
            media: [],
          });
        }
        return next;
      }
      // Only reached when no trailing day holds host content (checked above).
      return current.slice(0, dayCount);
    });
  }, [step1Draft.startAt, step1Draft.endAt]);

  const handleKeepDatesAfterTrimQuestion = useCallback((): void => {
    if (pendingDayTrim === null) return;
    const { previousStartAt, previousEndAt } = pendingDayTrim;
    setPendingDayTrim(null);
    setStep1Draft((s) => ({ ...s, startAt: previousStartAt, endAt: previousEndAt }));
  }, [pendingDayTrim]);

  const handleConfirmDayTrim = useCallback((): void => {
    if (pendingDayTrim === null) return;
    const { dayCount } = pendingDayTrim;
    setPendingDayTrim(null);
    acceptedDatesRef.current = { ...step1DraftDatesRef.current };
    setDaysDraft((current) => current.slice(0, dayCount));
  }, [pendingDayTrim]);

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
        departurePlaceId: step1Draft.departurePlaceId,
        departureLocationText: step1Draft.departureLocationText,
        departureLat: step1Draft.departureLat,
        departureLng: step1Draft.departureLng,
        // Issue #3801 — derived from the packages on screen, never authored.
        capacity: draftPackagesTotalSpots(step4Draft.packages),
      },
      days: daysDraft.map((d, i) => ({
        id: `preview-day-${i}`,
        eventId: trip.id,
        ordinal: d.ordinal,
        title: d.title,
        narrative: d.narrative.length > 0 ? d.narrative : null,
        date: null,
        stops: [],
        // ORCH-1119 — preview the in-flight day gallery.
        media: d.media ?? [],
      })),
      inclusions: inclusionsDraft.map((i, idx) => ({
        id: `preview-inc-${idx}`,
        eventId: trip.id,
        kind: i.kind,
        item: i.item,
        ordinal: i.ordinal,
      })),
      // META-ORCH-1174 Leg B2 — preview ALL authored packages (Step 5 review +
      // Step 7 publish summary). Each draft package projects to one pricing
      // tier; the matching persisted tier (by ticketTypeId) supplies the stable
      // id/metadata, else a synthetic preview shell is used.
      pricingTiers: step4Draft.packages.map((p, idx) => {
        const persisted =
          p.ticketTypeId !== null
            ? trip.pricingTiers.find((t) => t.ticketTypeId === p.ticketTypeId)
            : undefined;
        const priceCents = Math.round((parseFloat(p.priceMajor) || 0) * 100);
        return {
          id: persisted?.id ?? `preview-tier-${idx}`,
          eventId: trip.id,
          ticketTypeId: p.ticketTypeId ?? `preview-tt-${idx}`,
          tierName: p.name.trim().length > 0 ? p.name : `Package ${idx + 1}`,
          tierMetadata: persisted?.tierMetadata ?? {},
          priceCents,
          currency: step4Draft.currency,
          quantityTotal: p.capacity,
          ticketsRemaining: persisted?.ticketsRemaining ?? null,
          isUnlimited: false,
          installmentSchedule: p.paymentPlan,
          description: p.description.trim().length > 0 ? p.description.trim() : null,
        };
      }),
    }),
    [trip, step1Draft, daysDraft, inclusionsDraft, step4Draft],
  );

  // META-ORCH-1174 Leg B2 — the set of ticketTypeIds the server is known to
  // hold, so a package the operator removed in the UI is soft-removed on the
  // next pricing autosave. Seeded from the initial trip; updated as packages
  // are created/removed.
  const persistedTierIdsRef = useRef<Set<string>>(
    new Set(trip.pricingTiers.map((t) => t.ticketTypeId)),
  );

  // META-ORCH-1174 Leg B2 — persist the full N-package set:
  //   • a package WITH a ticketTypeId  → updateTripPricing (in-place; never
  //     clobbers a sold tier — see I-PROPOSED-1174-EDIT-NO-CLOBBER).
  //   • a package WITHOUT a ticketTypeId (added in the UI) → createTripPricingTier,
  //     then adopt the returned id into draft state so the next save updates it.
  //   • a persisted tier no longer present in the draft → removeTripPricingTier
  //     (soft-delete; the B1 service throws tier_delete_with_sales if it sold).
  // Each package carries its OWN price + capacity + installments (DEC-D/F).
  const persistPackages = useCallback(async (): Promise<void> => {
    const currentPackages = step4Draft.packages;
    const seenIds = new Set<string>();
    // Map of clientKey → adopted ticketTypeId for the create-then-adopt step.
    const adopted = new Map<string, string>();

    for (const pkg of currentPackages) {
      const priceCents = Math.round((parseFloat(pkg.priceMajor) || 0) * 100);
      const capacity = pkg.capacity ?? 1;
      const tierName = pkg.name.trim() || "Standard";
      const descriptionPatch = pkg.description.trim();
      if (pkg.ticketTypeId !== null) {
        seenIds.add(pkg.ticketTypeId);
        await updatePricingMutation.mutateAsync({
          eventId: trip.id,
          patch: {
            ticketTypeId: pkg.ticketTypeId,
            tierName,
            priceCents,
            capacity,
            installmentSchedule: pkg.paymentPlan,
            description: descriptionPatch.length > 0 ? descriptionPatch : null,
          },
        });
      } else {
        const created = await createTierMutation.mutateAsync({
          eventId: trip.id,
          patch: {
            tierName,
            priceCents,
            capacity,
            installmentSchedule: pkg.paymentPlan,
            description: descriptionPatch.length > 0 ? descriptionPatch : null,
          },
        });
        seenIds.add(created.ticketTypeId);
        adopted.set(pkg.key, created.ticketTypeId);
      }
    }

    // Soft-remove persisted tiers that the operator dropped from the draft.
    for (const knownId of persistedTierIdsRef.current) {
      if (!seenIds.has(knownId)) {
        await removeTierMutation.mutateAsync({
          eventId: trip.id,
          ticketTypeId: knownId,
        });
      }
    }
    persistedTierIdsRef.current = seenIds;

    // Adopt newly-created ids into draft state (one batched update).
    if (adopted.size > 0) {
      setStep4Draft((s) => ({
        ...s,
        packages: s.packages.map((p) =>
          p.ticketTypeId === null && adopted.has(p.key)
            ? { ...p, ticketTypeId: adopted.get(p.key) ?? null }
            : p,
        ),
      }));
    }
  }, [
    step4Draft.packages,
    trip.id,
    updatePricingMutation,
    createTierMutation,
    removeTierMutation,
  ]);

  // ----- Autosave per step transition -----
  // #1022 — the review-step row writes into the SAME step1Draft the Step-1 row
  // does, so both touchpoints share one source of truth and one persistence path.
  const handleReviewThemeChange = useCallback((next: ThemeInput | null): void => {
    setStep1Draft((s) => ({ ...s, themeOverrides: next }));
  }, []);

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
          departurePlaceId: step1Draft.departurePlaceId,
          departureLocationText: step1Draft.departureLocationText,
          departureLat: step1Draft.departureLat,
          departureLng: step1Draft.departureLng,
        },
        // ORCH-0876 — cover fields persist alongside basics. CoverPicker
        // emits patches synchronously into draft state; this writes them
        // to the events row on Continue / Back / Close (edit mode).
        coverMediaUrl: step1Draft.coverMediaUrl,
        coverMediaType: step1Draft.coverMediaType,
        // issue #868 [cover-gallery] — persist the ADDITIONAL photos via
        // updateTripBasics (§G.5, writes cover_media_gallery independently).
        coverGallery: step1Draft.coverGallery ?? [],
      },
    });
    // #1022 — the theme override columns are written SEPARATELY and strictly
    // AFTER updateBasicsMutation resolves. updateTripBasics read-modify-writes
    // the whole `theme` JSONB across two round-trips; sequencing after it means
    // the theme columns can never be caught inside that race. Columns are not
    // touched by that RMW, and a column-only UPDATE fires no trigger (the
    // departure-sync trigger is scoped `UPDATE OF theme`).
    await patchOfferingTheme({
      offeringId: trip.id,
      themeOverrides: normalizeThemeOverrides(step1Draft.themeOverrides),
    });
    // META-ORCH-1174 Leg B2 — persist the package set on Step 1 → Step 2 too,
    // so the primary package's price/capacity stays in sync with Step 1's
    // capacity seed (the historic Step-1 pricing write, now N-package-safe).
    await persistPackages();
  }, [
    step1Draft,
    trip.id,
    trip.brandId,
    updateBasicsMutation,
    persistPackages,
  ]);

  const autosaveStep2 = useCallback(async (): Promise<void> => {
    await upsertDaysMutation.mutateAsync({
      eventId: trip.id,
      days: daysDraft.map((d) => ({
        ordinal: d.ordinal,
        title: d.title.trim(),
        narrative: d.narrative.trim().length > 0 ? d.narrative.trim() : null,
        // ORCH-1119 — persist the per-day media gallery on draft autosave.
        media: d.media ?? [],
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
    // META-ORCH-1174 Leg B2 — persist ALL packages (create new / update
    // existing / soft-remove dropped), each with its own price + capacity +
    // installments.
    await persistPackages();
    // ORCH-1006 — persist the all-in pricing switches to events.pass_*. Skip
    // once any ticket has sold (post-sale lock): the section renders read-only
    // and the server would reject the change anyway.
    if (trip.ticketsSoldCount === 0) {
      await setTripPricingSwitches(trip.id, step4Draft.pricingSwitches);
    }
  }, [
    persistPackages,
    step4Draft.pricingSwitches,
    trip.id,
    trip.ticketsSoldCount,
  ]);

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
    // ORCH-1339 — persist the two guest-privacy display gates via the
    // leaf-write RPC (the server draft events row exists). NON-BLOCKING: a
    // display-pref failure never blocks step navigation or publish — toast and
    // continue (SPEC §4.7).
    try {
      await setEventGuestPrivacy(trip.id, {
        privateGuestList: step5Draft.privateGuestList,
        hideRemainingCount: step5Draft.hideRemainingCount,
      });
    } catch {
      showToast("Couldn't save guest privacy — check Settings after publishing.");
    }
  }, [
    step5Draft,
    trip.id,
    updateRefundPolicyMutation,
    updateBookingDeadlineMutation,
    showToast,
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
  // #3645 — a step save never sends the host to bank setup any more. A priced
  // package saves as a draft (the server stopped refusing it) and the stop is
  // at Publish, where the Review card offers "Connect bank" and brings them
  // straight back. A money-setup guard can still land in the catches below for
  // a brand with no payout country: it is said on the step, where the pricing
  // step's own prompt lets them choose one, and nothing navigates.
  const handleNext = useCallback(async (): Promise<void> => {
    if (step === 7) {
      if (inviteNavigation?.phase === "error") inviteNavigation.retry();
      if (inviteNavigation?.phase !== "ready") return;
    }
    try {
      await autosaveCurrentStep();
      setPublishError(null);
      setStep((s) => {
        if (s === 6 && !inviteEnabled) return 8;
        return s < 8 ? ((s + 1) as StepIndex) : s;
      });
    } catch (e) {
      // issue #1014 (rework F-1) — a currency-less brand pricing a PAID trip
      // fires trigger (d)'s event_currency_required during the Step-4 autosave
      // write (updateTripPricing / createTripPricingTier). Run the caught
      // error through the guard resolver FIRST: money-setup guards surface the
      // locked copy + the payments-onboard route (mirroring
      // handleConfirmPublish); only unrecognized errors keep the connection
      // toast.
      const autosaveErrCode = readRpcFailureMessage(e);
      const guardCopy = resolveProviderNeutralPaidPublishGuardCopy(autosaveErrCode);
      if (guardCopy !== null && guardCopy.action === "payment_onboarding") {
        // #3645 — no detour to bank setup on a save (see above handleNext).
        showToast(guardCopy.body);
        setPublishError({
          code: guardCopy.reason,
          message: guardCopy.body,
          pointsToStep: (step >= 5 ? 5 : step) as 1 | 2 | 3 | 4 | 5,
        });
        return;
      }
      // issue #3801 — say so ON THIS STEP. The banner below only renders on
      // Review, so without the toast a failed save here showed nothing.
      showToast(guardCopy?.body ?? TRIP_STEP_SAVE_FAILED_MESSAGE);
      setPublishError({
        code: "autosave_failed",
        message: "Couldn't save your changes. Check your connection and try again.",
        // Step 7 is Review-only (no autosave) so this branch never fires at
        // step === 7; clamp to satisfy the PublishErrorState.pointsToStep
        // union (1..5) which predates the wizard step expansion.
        pointsToStep: (step >= 5 ? 5 : step) as 1 | 2 | 3 | 4 | 5,
      });
    }
  }, [autosaveCurrentStep, step, inviteEnabled, inviteNavigation, showToast]);

  // ORCH-0876 — Back autosaves before stepping back, mirroring event wizard
  // semantics so unsaved Step N edits aren't lost when the operator returns
  // to Step N-1.
  // issue #3801 — a failed save no longer traps the organiser on the step.
  // Back says the save failed (toast, on this step) and then goes back anyway:
  // the edits stay in the wizard's own draft state and the header keeps
  // showing "Unsaved changes" until a later save lands. The one exception is
  // gone since #3645: a money-setup guard no longer routes to payments
  // onboarding on a save; it toasts and goes back like any other failure.
  const handleStepBack = useCallback(async (): Promise<void> => {
    if (step <= 1) return;
    if (step === 7 && inviteNavigation?.phase !== "ready") return;
    const goBack = (): void => {
      setStep((s) => {
        if (s === 8 && !inviteEnabled) return 6;
        return s > 1 ? ((s - 1) as StepIndex) : s;
      });
    };
    try {
      await autosaveCurrentStep();
      goBack();
      setPublishError(null);
    } catch (e) {
      // issue #1014 (rework F-1) — same money-setup guard mapping as
      // handleNext's catch: locked copy + payments-onboard route first;
      // only unrecognized errors keep the connection toast.
      const autosaveErrCode = readRpcFailureMessage(e);
      const guardCopy = resolveProviderNeutralPaidPublishGuardCopy(autosaveErrCode);
      if (guardCopy !== null && guardCopy.action === "payment_onboarding") {
        // #3645 — Back is never a detour to bank setup either.
        showToast(guardCopy.body);
        goBack();
        setPublishError({
          code: guardCopy.reason,
          message: guardCopy.body,
          pointsToStep: (step >= 5 ? 5 : step) as 1 | 2 | 3 | 4 | 5,
        });
        return;
      }
      showToast(guardCopy?.body ?? TRIP_STEP_SAVE_FAILED_MESSAGE);
      goBack();
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
  }, [autosaveCurrentStep, step, inviteEnabled, inviteNavigation?.phase, showToast]);

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
      // issue #3801 — the thrown value is developer wording (an Error) or a
      // PostgREST plain object; neither is shown. The reason is kept for the
      // console and the organiser gets one plain sentence.
      console.error(
        "[TripCreatorWizard] discard failed:",
        readRpcFailureMessage(e) || "unknown",
      );
      setDiscardError(TRIP_DISCARD_FAILED_MESSAGE);
    } finally {
      setIsDiscarding(false);
    }
  }, [onDiscardTrip, onExit]);

  // ----- Publish -----
  const handlePublishTap = useCallback(async (): Promise<void> => {
    // ORCH-1118 — trip location must be a confirmed Mapbox pick before publish
    // (belt; the dock Publish disabled is the suspenders). Both departure AND
    // destination are hard-required — empty or dirty text blocks publish. Reveal
    // the inline errors + jump back to Step 1. Do not loosen
    // (I-PROPOSED-TRIP-LOCATION-MAPBOX-VALIDATED).
    if (!tripLocationValid) {
      setShowStep1AddressErrors(true);
      setStep(1);
      showToast("Pick the trip's departure and destination from the suggestions.");
      return;
    }
    // ORCH-1076 Stream B — proactive Stripe pre-check. A paid trip on a
    // Stripe-unready brand can't publish; surface the blocking toast and do
    // NOT open the confirm dialog (the dock Publish is also disabled, so this
    // is the belt-and-suspenders path matching EventCreatorWizard).
    if (tripNeedsStripe) {
      showToast("Connect a bank to publish this paid trip.");
      return;
    }
    // #3645 — instalment plans require a bank even when charge-ready.
    if (tripNeedsBankForInstallments) {
      showToast(
        "Connect a bank before publishing a trip with a payment plan.",
      );
      return;
    }
    // #3645 PR11c — paid trips require current Organiser Terms acceptance.
    if (
      blockPaidPublishUntilAccepted(tripDraftIsPaid(step4Draft), () =>
        resumePublishRef.current(),
      )
    ) {
      return;
    }
    // META-ORCH-1174 Leg B2 — every package must be valid before publish.
    // Surface the first failing reason + jump back to the pricing step.
    if (!packagesValidation.ok) {
      setStep(4);
      showToast(packagesValidation.reason ?? "Fix your packages before publishing.");
      return;
    }
    if (!inviteEnabled) {
      if (!inviteRollbackReady) {
        showToast("Checking saved invite plans before publishing.");
        return;
      }
      setPublishConfirmVisible(true);
      return;
    }
    setCheckingInvitePublish(true);
    try {
      const latest = await inviteSummary.refreshAuthoritative();
      if (latest.quote === null) {
        if (inviteFlag.data === false && latest.plan.selectedCount === 0) {
          setPublishConfirmVisible(true);
        } else {
          showToast("Refresh the invite estimate before publishing.");
        }
        return;
      }
      if (latest.quote.selectionRevision !== latest.plan.selectionRevision ||
          latest.quote.selectionHash !== latest.plan.selectionHash) {
        showToast("Refresh the invite estimate before publishing.");
        return;
      }
      if (latest.plan.selectedCount > 0) {
        setInvitePublishConfirmVisible(true);
        return;
      }
      setPublishConfirmVisible(true);
    } catch {
      showToast("Refresh the invite estimate before publishing.");
    } finally {
      setCheckingInvitePublish(false);
    }
  }, [tripLocationValid, tripNeedsStripe, tripNeedsBankForInstallments,
      packagesValidation, showToast, inviteSummary,
    inviteEnabled, inviteRollbackReady, inviteFlag.data, step4Draft,
    blockPaidPublishUntilAccepted]);

  useEffect(() => {
    resumePublishRef.current = (): void => {
      void handlePublishTap();
    };
  }, [handlePublishTap]);

  const handleConfirmPublish = useCallback(async (): Promise<void> => {
    setPublishError(null);
    try {
      const published = await publishMutation.mutateAsync({
        eventId: trip.id,
        brandId: trip.brandId,
        invites: invitePlan && invitePlan.selectedCount > 0
          ? {
              selectionRevision: invitePlan.selectionRevision,
              selectionConfirmed: true,
            }
          : undefined,
        draftPayload: {
          title: step1Draft.title.trim(),
          cover_media_url: step1Draft.coverMediaUrl,
          cover_media_poster_url:
            step1Draft.coverMediaPosterUrl ??
            (step1Draft.coverMediaType === "image" ? step1Draft.coverMediaUrl : null),
          cover_media_type: step1Draft.coverMediaType,
          cover_media_gallery: step1Draft.coverGallery ?? [],
          theme: {
            business_trip: {
              startAt: step1Draft.startAt,
              endAt: step1Draft.endAt,
              destinationPlaceId: step1Draft.destinationPlaceId,
              destinationLocationText: step1Draft.destinationLocationText,
              destinationLat: step1Draft.destinationLat,
              destinationLng: step1Draft.destinationLng,
              departurePlaceId: step1Draft.departurePlaceId,
              departureLocationText: step1Draft.departureLocationText,
              departureLat: step1Draft.departureLat,
              departureLng: step1Draft.departureLng,
              // Issue #1363 — precision rides theme.business_trip.* (JSON; no
              // column). The publish RPC preserves unknown business_trip keys, so
              // this persists with no RPC change.
              destinationCoordinatePrecision:
                step1Draft.destinationCoordinatePrecision ?? null,
              departureCoordinatePrecision:
                step1Draft.departureCoordinatePrecision ?? null,
            },
          },
          timezone: trip.timezone,
        },
      });
      // ORCH-1339 — re-assert the guest-privacy toggles on publish success
      // (leaf write; belt-and-suspenders with the Step-5 autosave). NON-BLOCKING:
      // display prefs never block publish (SPEC §4.7).
      try {
        await setEventGuestPrivacy(trip.id, {
          privateGuestList: step5Draft.privateGuestList,
          hideRemainingCount: step5Draft.hideRemainingCount,
        });
      } catch {
        showToast("Couldn't save guest privacy — check Settings after publishing.");
      }
      setPublishConfirmVisible(false);
      setInvitePublishConfirmVisible(false);
      onPublished(published);
    } catch (e) {
      const err = e as TripPublishValidationError;
      setPublishConfirmVisible(false);
      setPublishError(mapPublishErrorToState(err.code ?? "publish_failed", err.message));
      // ORCH-1075 — a paid trip on a Stripe-unready brand can't publish; route
      // the operator to the brand's Stripe Connect onboarding to finish setup.
      const guardCopy = resolveProviderNeutralPaidPublishGuardCopy(err.message);
      if (guardCopy?.action === "payment_onboarding") {
        router.push(bankSetupRoute as never);
      }
    }
  }, [publishMutation, router, step1Draft, step5Draft, trip.id, trip.brandId, trip.timezone, onPublished, showToast, invitePlan, bankSetupRoute]);

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

  // #3446 — Android back = this wizard's own Back (step > 1) or close (step 1). See I-3446-WIZARD-ANDROID-BACK-IS-STEP-BACK.
  useWizardHardwareBack({
    isFirstStep: step === 1,
    busy: submitting || checkingInvitePublish || isDiscarding,
    exitSurfaced: discardDialogVisible,
    onStepBack: handleStepBack,
    onExit: handleClose,
  });

  const visibleStepperSteps = inviteEnabled
    ? STEPPER_STEPS
    : STEPPER_STEPS.filter((item) => item.id !== "step-7");
  const visibleStepNumber = !inviteEnabled && step === 8 ? 7 : step;
  const visibleStepCount = inviteEnabled ? STEP_COUNT : STEP_COUNT - 1;
  const stepIdx = visibleStepNumber - 1;
  const stepTitle = STEP_TITLES[step];
  const stepSubtitle = step === 7
    ? "Choose people from Your Book. Nothing sends until this trip is published."
    : STEP_SUBTITLES[step];

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
        // Issue #3801 — trip dates are calendar dates stored at UTC; read
        // them at UTC so the day never shifts with the device's timezone.
        const fmt = new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
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
        {visibleStepperSteps.map((stepDef, index) => {
          const stepNumber = Number(stepDef.id.slice(5)) as StepIndex;
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
                  {index + 1}
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
          {/* orch-strict-grep-allow leftKind-brand-rightSlot — wizard chrome replaces (not composes with) the primary-tab [search,bell] cluster; default cluster is semantically wrong inside a modal creator. Per ORCH-0894 desktop layout polish. */}
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
              steps={visibleStepperSteps}
              currentIndex={stepIdx}
              showCaption={false}
            />
          </View>
          <Text style={styles.stepCounter} testID="trip-wizard-step-counter">
            {visibleStepNumber}/{visibleStepCount}
          </Text>
        </View>
      )}

          {/* Subtitle row uses the active flag-aware step count and title. */}
      {isWideDesktop ? null : (
      <View style={styles.subtitleRow}>
        <Text style={styles.subtitle}>
          {brand.name} · Step {visibleStepNumber} of {visibleStepCount}
        </Text>
        <Text accessibilityRole={step === 7 ? "header" : undefined} style={styles.mobileStepTitle}>{stepTitle}</Text>
        <Text style={styles.mobileStepSub}>{stepSubtitle}</Text>
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

      {/* ORCH-0892-B v2: KeyboardAvoidingView wrap DELETED. SmartScrollView
          (KAS on native) computes overlap = (focused field bottom) -
          (visibleHeight - keyboardHeight - bottomOffset) and scrolls
          exactly that amount so the focused TextInput sits ~12pt above
          the keyboard. Chrome (header + dock) renders OUTSIDE this
          ScrollView so it stays stationary. Per SPEC §7.F. */}
      <ScrollView
        ref={scrollViewRef}
        style={styles.kbAvoid}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.stepBodyWrap}>
          {step === 1 ? (
            <TripCreatorStep1Basics
              draft={step1Draft}
              onChange={(patch) => setStep1Draft((s) => ({ ...s, ...patch }))}
              disabled={submitting}
              brandId={trip.brandId}
              tripEventId={trip.id}
              onShowToast={showToast}
              showAddressErrors={showStep1AddressErrors}
              timeZone={trip.timezone ?? null}
            />
          ) : null}
          {step === 2 ? (
            <TripCreatorStep2Itinerary
              days={daysDraft}
              onChange={setDaysDraft}
              disabled={submitting}
              brandId={trip.brandId}
              eventId={trip.id}
              onShowToast={showToast}
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
              // #3645 — paid (or on a payment plan) and no bank yet: the
              // pricing step says the draft still saves.
              needsBankToPublish={tripNeedsStripe || tripNeedsBankForInstallments}
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
          {step === 7 && inviteEnabled ? (
            <InvitePeopleStep
              eventId={trip.id}
              brandId={trip.brandId}
              eventType="trip"
              showHeader={isWideDesktop}
              onProtectedFlowExit={onExit}
              onReauthenticate={async () => {
                await signOut();
                router.replace("/auth");
              }}
              onPlanChange={handleInvitePlanChange}
            />
          ) : null}
          {step === 8 ? (
            <TripCreatorStep5Review
              trip={previewTrip}
              brand={brand}
              publishError={publishError}
              // #3645 — a payment plan is treated like a priced trip: the
              // same card, the same way back.
              needsStripe={tripNeedsStripe || tripNeedsBankForInstallments}
              onConnectStripe={handleConnectStripe}
              themeOverrides={step1Draft.themeOverrides}
              onThemeChange={handleReviewThemeChange}
            />
          ) : null}
          {step === 8 ? (
            <InvitePlanReviewSummary plan={invitePlan} quote={inviteQuote} />
          ) : null}
        </View>
      </ScrollView>

      {/* Dock — sleek floating glass card. Hidden when keyboard up. */}
      {keyboardVisible ? null : (
        <GlassCard
          variant="elevated"
          padding={0}
          radius="xxl"
          style={[styles.dock, { marginBottom: insets.bottom + spacing.lg }]}
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
          ) : step === 8 ? (
                // #1780 — Review (Publish) is Step 8 when Invite people is
                // enabled and remains visible Step 7 when the flag is dark.
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
                  // #1780 — no stepping back to Invite while Publish re-reads the plan.
                  disabled={submitting || checkingInvitePublish}
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
                  onPress={() => void handlePublishTap()}
                  loading={submitting || checkingInvitePublish}
                  // ORCH-1076 Stream B — disable Publish for a paid trip on a
                  // Stripe-unready brand (proactive gate; mirrors events).
                  // ORCH-1118 — also disable until departure + destination are
                  // confirmed Mapbox picks (suspenders; belt in handlePublishTap).
                  // META-ORCH-1174 Leg B2 — and until every package is valid.
                  disabled={
                    submitting ||
                    tripNeedsStripe ||
                    tripNeedsBankForInstallments ||
                    !tripLocationValid ||
                    !packagesValidation.ok ||
                    !invitePublishReady ||
                    checkingInvitePublish
                  }
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
                  disabled={submitting || (step === 7 && inviteNavigation?.phase !== "ready")}
                  fullWidth
                />
              </View>
              <View style={styles.dockPrimaryCell}>
                <Button
                  label={step === 7
                    ? inviteNavigation?.primaryLabel ?? "Checking…"
                    : submitting ? "Saving…" : "Continue"}
                  variant="primary"
                  size="md"
                  onPress={() => {
                    void handleNext();
                  }}
                  loading={submitting || (step === 7 && inviteNavigation?.phase === "saving")}
                  disabled={submitting || (step === 7 && inviteNavigation?.blocked === true)}
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

      {/* Issue #3801 — a date change that would remove a day the host wrote. */}
      <ConfirmDialog
        visible={pendingDayTrim !== null}
        onClose={handleKeepDatesAfterTrimQuestion}
        onConfirm={handleConfirmDayTrim}
        title="Remove part of your itinerary?"
        description={
          pendingDayTrim !== null
            ? describeItineraryDaysAtRisk(pendingDayTrim.atRisk)
            : ""
        }
        confirmLabel={
          pendingDayTrim !== null && pendingDayTrim.atRisk.length > 1
            ? "Remove days"
            : "Remove day"
        }
        cancelLabel="Keep dates"
        destructive
        testID="trip-wizard-day-trim-dialog"
      />

      <InvitePlanSummaryBridge
        eventId={trip.id}
        enabled={true}
        quoteWhenEmpty={inviteFlag.data === true}
        onChange={setInviteSummary}
      />

      <InvitePeoplePublishConfirmation
        visible={invitePublishConfirmVisible}
        eventType="trip"
        plan={invitePlan}
        quote={inviteQuote}
        publishing={publishMutation.isPending}
        onClose={() => setInvitePublishConfirmVisible(false)}
        onConfirm={handleConfirmPublish}
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

      {organiserTermsGateElement}

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
  mobileStepTitle: {
    marginTop: spacing.md,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "700",
    color: textTokens.primary,
  },
  mobileStepSub: {
    marginTop: 4,
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    color: textTokens.secondary,
  },
  saveState: {
    marginTop: spacing.xs,
    fontSize: typography.caption.fontSize,
    color: textTokens.quaternary,
  },
  saveStateError: {
    color: semantic.error,
  },
  body: {
    paddingHorizontal: spacing.md + 8,
    paddingTop: 0,
    paddingBottom: spacing.xl,
  },
  stepBodyWrap: {
    width: "100%",
  },
  dock: {
    marginHorizontal: spacing.md,
    // marginBottom is applied inline as insets.bottom + spacing.lg so the
    // floating dock clears the phone's bottom nav / home-indicator on both
    // Android gesture-nav and iOS (META-ORCH-1059 Sub-A footer-bleed fix).
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
