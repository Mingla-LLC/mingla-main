// orch-strict-grep-allow orch-0892 — wizard uses a single ScrollView + keyboardShouldPersistTaps; SmartScrollView migration is a deferred keyboard-hygiene follow-up (token in first 3 lines: gate's multiline-import line-finder returns -1)
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
// orch-strict-grep-allow orch-0892 — META-ORCH-1059 Sub-A rebuilds the experience
// wizard onto a multi-stop itinerary + lifted CreatorStep2When + two-mode pricing.
// Keyboard-input fields sit in a single ScrollView with keyboardShouldPersistTaps;
// SmartScrollView migration deferred to a dedicated keyboard-hygiene follow-up.
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  accent,
  canvas,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../constants/designSystem";
import { useAuth } from "../../context/AuthContext";
import { useCurrentBrand } from "../../hooks/useCurrentBrand";
import { useExperienceVenueDefault } from "../../hooks/useExperienceVenueDefault";
import { useExperienceDraftAdapter } from "../../hooks/useExperienceDraftAdapter";
import { supabase } from "../../services/supabase";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { Stepper } from "../ui/Stepper";
import { Toast } from "../ui/Toast";
import { CreatorStep2When } from "../event/CreatorStep2When";
import { ExperienceCoverStep } from "./ExperienceCoverStep";
import type { CoverPatch } from "../ui/CoverPicker";
import { DEFAULT_TAKE_RATE_BPS } from "../../constants/pricing";
import type { PricingSwitchOverrides } from "../../services/pricingSwitchesService";
import { useBrandTaxRegistration } from "../../hooks/useBrandTaxRegistration";
import { ExperienceStopsStep } from "./ExperienceStopsStep";
import { ExperiencePricingStep } from "./ExperiencePricingStep";
import { StripeBlockedCard } from "../offering/StripeBlockedCard";
import {
  experienceDraftIsPaid,
  offeringNeedsStripeToPublish,
} from "../offering/publishStripeReadiness";
import {
  emptyStop,
  stopHasValidatedLocation,
  stopHasValidDescription,
  type ExperienceLocationMode,
  type ExperiencePricingMode,
  type ExperienceStopDraft,
} from "./experienceWizardTypes";
import {
  EXPERIENCE_INTENTS,
  normalizeExperienceIntents,
  type ExperienceIntentId,
} from "../../constants/experienceIntents";
import { EditAfterPublishExperienceBanner } from "./EditAfterPublishExperienceBanner";
import {
  validateLiveExperienceFieldUpdate,
  liveExperienceRejectCopy,
  type LiveExperiencePatch,
  type UpdateLiveExperienceRejectReason,
} from "../../utils/publishedExperienceEditGuards";
import {
  brandStripeOnboardingRoute,
  resolvePaidPublishGuardCopy,
} from "../../utils/paidPublishGuards";
import type { ExperienceDetail } from "../../services/experienceDetailService";

export interface ExperienceCreatorWizardProps {
  brandId: string;
  onComplete: (newExperienceId: string) => void;
  onCancel?: () => void;
  /** Optional AI-proposal / draft prefill (Layer 6 "Set up & publish"). */
  prefill?: { title?: string; description?: string; wholePriceMajor?: string };
  /**
   * META-ORCH-1059 Sub-B — edit-mode. When set, the wizard does NOT create a
   * new draft; it edits the existing draft row (its events-row id) in place.
   * The dashboard/edit route passes the draft id here so the cover step + the
   * publish/save path target the already-persisted row.
   */
  existingExperienceId?: string;
  /** Initial cover for edit-mode (so the cover step previews the saved cover). */
  initialCover?: CoverPatch;
  /** Full draft seed for edit-mode (stops + modes + pricing + when). */
  initialDraft?: ExperienceWizardInitialDraft;
  /**
   * META-ORCH-1059 Sub-E — LIVE-edit mode. When set, the experience is
   * scheduled/live (not a draft): the wizard shows the buyer-protection banner +
   * required reason, runs the client guard against the loaded experience, and
   * routes the single "Save changes" through biz_update_live_experience instead
   * of biz_publish_experience. Draft edits leave this undefined and keep the
   * existing Publish / Save-as-draft flow unchanged.
   */
  liveExperience?: ExperienceDetail;
  /** Total confirmed (paid) order quantity for the live experience (refund-gate input). */
  liveSoldCount?: number;
}

/** META-ORCH-1059 Sub-B — edit-mode seed for the whole wizard. */
export interface ExperienceWizardInitialDraft {
  title: string;
  description: string;
  /** META-ORCH-1059 CHANGE 2 — curated vibes (MULTI; edit-mode seed). */
  intents: ExperienceIntentId[];
  locationMode: ExperienceLocationMode;
  pricingMode: ExperiencePricingMode;
  stops: ExperienceStopDraft[];
  wholePriceMajor: string;
  isFree: boolean;
  capacity: string;
  unlimited: boolean;
  pricingSwitches: PricingSwitchOverrides;
  when?: {
    whenMode: "single" | "recurring" | "multi_date";
    date: string | null;
    doorsOpen: string | null;
    endsAt: string | null;
    timezone: string;
    recurrenceRule: import("../../store/draftEventStore").RecurrenceRule | null;
    multiDates: import("../../store/draftEventStore").MultiDateEntry[] | null;
  };
}

type StepIndex = 1 | 2 | 3 | 4 | 5;

const STEPS = [
  { id: "identity", label: "Identity" },
  { id: "stops", label: "Stops" },
  { id: "when", label: "When" },
  { id: "pricing", label: "Pricing" },
  { id: "cover", label: "Cover" },
];

const RPC_ERROR_COPY: Record<string, string> = {
  not_authenticated: "Please sign in again.",
  brand_not_found: "We couldn't find your brand.",
  insufficient_event_permission: "You don't have permission to publish for this brand.",
  experience_title_required: "Give your experience a title.",
  experience_description_invalid: "Description must be 10–500 characters.",
  event_currency_unsupported: "That currency isn't supported yet.",
  invalid_mode: "Something went wrong with the pricing/location setup. Try again.",
  experience_stop_count_invalid: "An experience needs 2–5 stops.",
  stop_name_required: "Every stop needs a name.",
  stop_description_required: "Every stop needs a short description.",
  experience_intent_required: "Pick the best vibe for this experience.",
  experience_intent_invalid: "That vibe isn't recognised. Pick one from the list.",
  stop_address_unvalidated: "Pick each stop's address from the suggestions.",
  stop_too_many_images: "Each stop can have up to 5 photos.",
  experience_price_invalid: "Set a valid price, or mark the experience free.",
  event_date_required: "Pick at least one date.",
  slug_taken: "An experience with that name already exists. Try a small variation.",
  experience_not_found: "We couldn't find this experience. It may have been deleted.",
  event_not_an_experience: "That isn't an editable experience.",
  // META-ORCH-1059 Sub-E — live-edit refund-gate + lifecycle copy.
  experience_not_editable_status: "This experience can't be edited in its current state.",
};

const currencySymbolFor = (currency: string): string =>
  currency === "GBP" ? "£" : currency === "EUR" ? "€" : currency === "USD" ? "$" : `${currency} `;

const EMPTY_COVER: CoverPatch = {
  coverMediaUrl: null,
  coverMediaType: null,
  coverMediaProvider: null,
  coverMediaSourceUrl: null,
  coverMediaCredit: null,
  coverMediaCreditUrl: null,
  coverMediaAlt: null,
};

export const ExperienceCreatorWizard: React.FC<ExperienceCreatorWizardProps> = ({
  brandId,
  onComplete,
  onCancel,
  prefill,
  existingExperienceId,
  initialCover,
  initialDraft,
  liveExperience,
  liveSoldCount,
}) => {
  const isLiveEdit = liveExperience !== undefined;
  const { user } = useAuth();
  const brand = useCurrentBrand();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const taxRegistration = useBrandTaxRegistration(brand?.id ?? null);
  const venueDefault = useExperienceVenueDefault(brandId);
  const scrollRef = useRef<ScrollView>(null);

  const currency = brand?.defaultCurrency ?? "USD";
  const currencySymbol = currencySymbolFor(currency);

  const [step, setStep] = useState<StepIndex>(1);
  const [title, setTitle] = useState(initialDraft?.title ?? prefill?.title ?? "");
  const [description, setDescription] = useState(
    initialDraft?.description ?? prefill?.description ?? "",
  );
  // META-ORCH-1059 CHANGE 2 — curated vibes (MULTI; ≥1 required at publish).
  const [intents, setIntents] = useState<ExperienceIntentId[]>(
    initialDraft?.intents ?? [],
  );
  // Toggle a vibe in/out; preserves the canonical EXPERIENCE_INTENTS order.
  const toggleIntent = useCallback((id: ExperienceIntentId): void => {
    setIntents((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : normalizeExperienceIntents([...prev, id]),
    );
  }, []);

  // Stops + modes
  const [locationMode, setLocationMode] = useState<ExperienceLocationMode>(
    initialDraft?.locationMode ?? "single",
  );
  const [pricingMode, setPricingMode] = useState<ExperiencePricingMode>(
    initialDraft?.pricingMode ?? "whole",
  );
  const [stops, setStops] = useState<ExperienceStopDraft[]>(
    initialDraft?.stops && initialDraft.stops.length > 0
      ? initialDraft.stops
      : [emptyStop(), emptyStop()],
  );

  // Pricing
  const [wholePriceMajor, setWholePriceMajor] = useState(
    initialDraft?.wholePriceMajor ?? prefill?.wholePriceMajor ?? "0.00",
  );
  const [isFree, setIsFree] = useState(initialDraft?.isFree ?? false);
  const [capacity, setCapacity] = useState(initialDraft?.capacity ?? "20");
  const [unlimited, setUnlimited] = useState(initialDraft?.unlimited ?? false);
  const [pricingSwitches, setPricingSwitches] = useState<PricingSwitchOverrides>(
    initialDraft?.pricingSwitches ?? {
      passTax: null,
      passMinglaFee: null,
      passServiceFee: null,
    },
  );

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showStepErrors, setShowStepErrors] = useState(false);
  // META-ORCH-1059 Sub-E — live-edit reason + inline rejection message.
  const [liveEditReason, setLiveEditReason] = useState("");
  const [liveEditError, setLiveEditError] = useState<string | null>(null);

  // META-ORCH-1059 Sub-B — draft-first lifecycle. A server draft row (and thus
  // an events-row id) is created UP FRONT so the Cover step has a real id for
  // the video-capable picker. In edit-mode the id is the existing draft.
  const [experienceId, setExperienceId] = useState<string | null>(
    existingExperienceId ?? null,
  );
  const [creatingDraft, setCreatingDraft] = useState(false);
  const draftCreateInFlight = useRef(false);
  const [cover, setCover] = useState<CoverPatch>(initialCover ?? EMPTY_COVER);

  // When-step adapter (feeds the lifted CreatorStep2When). Edit-mode seeds it.
  const whenAdapter = useExperienceDraftAdapter(brandId, initialDraft?.when);

  // Seed stop 1 from the brand venue default (design §2.7): name/address text
  // only; placeId stays null so the brand must confirm a real Mapbox pick.
  useEffect(() => {
    if (venueDefault.hasPrefill && venueDefault.defaultVenue.trim().length > 0) {
      setStops((prev) => {
        if (prev.length === 0) return prev;
        if (prev[0].address.trim().length > 0 || prev[0].placeName.trim().length > 0) return prev;
        const seeded = [...prev];
        seeded[0] = { ...seeded[0], address: venueDefault.defaultVenue.trim() };
        return seeded;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venueDefault.hasPrefill, venueDefault.defaultVenue]);

  const resolvedTotalMajor = useMemo(() => {
    if (isFree) return 0;
    if (pricingMode === "whole") {
      const v = parseFloat(wholePriceMajor);
      return Number.isFinite(v) && v >= 0 ? v : 0;
    }
    return stops.reduce((sum, s) => {
      const v = parseFloat(s.priceMajor);
      return sum + (Number.isFinite(v) && v >= 0 ? v : 0);
    }, 0);
  }, [isFree, pricingMode, stops, wholePriceMajor]);

  // ORCH-1076 Stream B — proactive Stripe gate. A paid experience
  // (!isFree && resolvedTotalMajor > 0, mirroring the ORCH-1075 server
  // predicate across whole + per-stop modes) on a brand that can't yet charge
  // needs Stripe before it can publish. Live-edit experiences keep ONLY the
  // reactive ORCH-1075 catch (D-1: no proactive banner on edit-to-paid). The
  // reactive RPC catch in handleSubmit stays the canonical fail-close.
  const experienceNeedsStripe = useMemo(
    () =>
      !isLiveEdit &&
      offeringNeedsStripeToPublish({
        isPaid: experienceDraftIsPaid({ isFree, resolvedTotalMajor }),
        stripeStatus: brand?.stripeStatus ?? null,
      }),
    [isLiveEdit, isFree, resolvedTotalMajor, brand?.stripeStatus],
  );

  const handleConnectStripe = useCallback((): void => {
    if (brand !== null) {
      router.push(brandStripeOnboardingRoute(brand.id) as never);
    }
  }, [brand, router]);

  // Per-step Continue gate.
  const stopsValid = useMemo(() => {
    if (stops.length < 2 || stops.length > 5) return false;
    return stops.every((s, i) => {
      if (s.placeName.trim().length === 0) return false;
      // CHANGE 3 — every stop needs a description.
      if (!stopHasValidDescription(s)) return false;
      const needsAddress = locationMode === "per_stop" || i === 0;
      if (needsAddress && !stopHasValidatedLocation(s)) return false;
      return true;
    });
  }, [stops, locationMode]);

  const pricingValid = useMemo(() => {
    if (!unlimited && (parseInt(capacity, 10) || 0) <= 0) return false;
    if (isFree) return true;
    if (pricingMode === "whole") return resolvedTotalMajor > 0;
    // per-stop: every stop must have an explicit non-empty price entry
    return stops.every((s) => s.priceMajor.trim().length > 0);
  }, [unlimited, capacity, isFree, pricingMode, resolvedTotalMajor, stops]);

  const canContinue = useMemo(() => {
    if (step === 1)
      return (
        title.trim().length > 0 &&
        description.trim().length >= 10 &&
        intents.length > 0
      );
    if (step === 2) return stopsValid;
    if (step === 3) return whenAdapter.isValid;
    if (step === 4) return pricingValid;
    return true;
  }, [step, title, description, intents, stopsValid, whenAdapter.isValid, pricingValid]);

  const goBack = useCallback((): void => {
    if (step === 1) onCancel?.();
    else setStep((prev) => Math.max(1, prev - 1) as StepIndex);
  }, [onCancel, step]);

  const buildPayload = useCallback(
    (publish: boolean) => {
      const whenPayload = whenAdapter.toPayloadWhen();
      return {
        title: title.trim(),
        description: description.trim(),
        experience_intents: intents,
        currency,
        location_mode: locationMode,
        pricing_mode: pricingMode,
        whole_price_cents: Math.round(resolvedTotalMajor * 100),
        is_free: isFree,
        capacity: unlimited ? null : parseInt(capacity, 10) || null,
        pass_tax: pricingSwitches.passTax,
        pass_mingla_fee: pricingSwitches.passMinglaFee,
        pass_service_fee: pricingSwitches.passServiceFee,
        stops: stops.map((s, i) => ({
          stop_order: i,
          place_id: s.placeId,
          place_name: s.placeName.trim(),
          address: s.address.trim(),
          city: s.city,
          region: s.region,
          country_code: s.countryCode,
          lat: s.lat,
          lng: s.lng,
          image_urls: s.imageUrls,
          start_time: s.startTime,
          price_cents:
            pricingMode === "per_stop"
              ? Math.round((parseFloat(s.priceMajor) || 0) * 100)
              : 0,
          ai_description: s.description.trim(),
        })),
        whenMode: whenPayload.whenMode,
        when: whenPayload.when,
        multiDates: whenPayload.multiDates,
        recurrence_rules: whenPayload.recurrence_rules,
        timezone: whenPayload.timezone,
        // META-ORCH-1059 BUG 3 — thread the cover so the RPC persists the 7
        // cover_media_* columns. Pexels/Giphy/Library picks only emit a patch
        // to wizard state; without this the RPC drops the cover entirely.
        cover: {
          coverMediaUrl: cover.coverMediaUrl,
          coverMediaType: cover.coverMediaType,
          coverMediaProvider: cover.coverMediaProvider,
          coverMediaSourceUrl: cover.coverMediaSourceUrl,
          coverMediaCredit: cover.coverMediaCredit,
          coverMediaCreditUrl: cover.coverMediaCreditUrl,
          coverMediaAlt: cover.coverMediaAlt,
        },
      };
    },
    [
      whenAdapter,
      title,
      description,
      intents,
      currency,
      locationMode,
      pricingMode,
      resolvedTotalMajor,
      isFree,
      unlimited,
      capacity,
      pricingSwitches,
      stops,
      cover,
    ],
  );

  // META-ORCH-1059 Sub-B — create the server draft row up front (returns its
  // events-row id) so the Cover step's video-capable picker has a real id.
  // Idempotent: only creates once; edit-mode short-circuits to the existing id.
  const ensureDraft = useCallback(async (): Promise<string | null> => {
    if (experienceId !== null) return experienceId;
    if (draftCreateInFlight.current) return null;
    draftCreateInFlight.current = true;
    setCreatingDraft(true);
    try {
      const { data, error } = await supabase.rpc("biz_create_experience", {
        p_brand_id: brandId,
        p_payload: buildPayload(false),
        p_publish: false,
      });
      if (error !== null) {
        const code = error.message ?? "";
        throw new Error(RPC_ERROR_COPY[code] ?? "Couldn't start your draft. Tap to retry.");
      }
      const result = data as { event?: { id?: string } } | null;
      const newId = result?.event?.id;
      if (typeof newId !== "string") {
        throw new Error("Couldn't start your draft. Tap to retry.");
      }
      setExperienceId(newId);
      return newId;
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't start your draft. Tap to retry.");
      return null;
    } finally {
      draftCreateInFlight.current = false;
      setCreatingDraft(false);
    }
  }, [brandId, buildPayload, experienceId]);

  const goNext = useCallback((): void => {
    if (!canContinue) {
      setShowStepErrors(true);
      if (step === 3) whenAdapter.setShowErrors(true);
      return;
    }
    setShowStepErrors(false);
    // Leaving Step 1 (Identity) → ensure the server draft exists so the Cover
    // step (Step 5) has a real events-row id. Fire-and-advance; the Cover step
    // renders a "preparing" state until the id resolves.
    if (step === 1 && experienceId === null) {
      void ensureDraft();
    }
    setStep((prev) => Math.min(5, prev + 1) as StepIndex);
  }, [canContinue, ensureDraft, experienceId, step, whenAdapter]);

  // ORCH-1075 — surface the two paid-publish guard reasons as actionable copy
  // and route to Stripe onboarding (Guard A) or the When step (Guard B).
  // Returns true when the raw reason WAS an ORCH-1075 guard (so the caller
  // skips its generic error copy); false otherwise.
  const handlePaidPublishGuard = useCallback(
    (raw: string | null | undefined): boolean => {
      const copy = resolvePaidPublishGuardCopy(raw);
      if (copy === null) return false;
      setToast(copy.body);
      if (copy.action === "stripe_onboarding") {
        if (brand !== null) {
          router.push(brandStripeOnboardingRoute(brand.id) as never);
        }
      } else {
        // Guard B — jump to the When step (step 3) and reveal its errors.
        setStep(3);
        setShowStepErrors(true);
        whenAdapter.setShowErrors(true);
      }
      return true;
    },
    [brand, router, whenAdapter],
  );

  const handleSubmit = useCallback(
    async (publish: boolean): Promise<void> => {
      if (brand === null || user?.id === undefined) return;
      // ORCH-1076 Stream B — proactive Stripe pre-check. A paid experience on a
      // Stripe-unready brand can't publish; surface the blocking toast and
      // return BEFORE the biz_publish_experience RPC. Draft saves
      // (publish=false) are exempt — they never gate. The Publish button is
      // also disabled, so this is the belt-and-suspenders path.
      if (publish && experienceNeedsStripe) {
        setToast("Connect a bank to publish this paid experience.");
        return;
      }
      if (
        publish &&
        (intents.length === 0 || !stopsValid || !pricingValid || !whenAdapter.isValid)
      ) {
        setShowStepErrors(true);
        whenAdapter.setShowErrors(true);
        // META-ORCH-1059 BUG 5 — never a silent no-op. Name the specific
        // missing piece so the operator knows WHY publish didn't go through.
        const reason =
          intents.length === 0
            ? "Pick at least one vibe on step 1 before publishing."
            : !stopsValid
              ? "Finish your stops (each needs a name, description, and address) before publishing."
              : !whenAdapter.isValid
                ? "Set the date and time on the When step before publishing."
                : "Set a valid price (or mark it free) before publishing.";
        setToast(reason);
        return;
      }
      setSubmitting(true);
      try {
        // Ensure the draft row exists (covers the case where the operator
        // jumped straight to publish without leaving Step 1, or a prior
        // ensureDraft failed). Then UPDATE-publish it via biz_publish_experience.
        const targetId = await ensureDraft();
        if (targetId === null) {
          throw new Error("Couldn't save experience. Tap to retry.");
        }
        const { data, error } = await supabase.rpc("biz_publish_experience", {
          p_event_id: targetId,
          p_payload: buildPayload(publish),
          p_publish: publish,
        });
        if (error !== null) {
          // META-ORCH-1059 BUG 5 — NEVER fail silently. Prefer mapped copy;
          // otherwise surface the raw reason so the operator sees SOMETHING
          // actionable instead of a no-op publish.
          const code = (error.message ?? "").trim();
          // ORCH-1075 — paid-publish integrity guards (Stripe readiness /
          // past date) get actionable copy + a route, not a raw error.
          if (handlePaidPublishGuard(code)) {
            return;
          }
          const mapped = RPC_ERROR_COPY[code];
          throw new Error(
            mapped ??
              (code.length > 0
                ? `Couldn't ${publish ? "publish" : "save"} experience: ${code}`
                : `Couldn't ${publish ? "publish" : "save"} experience. Tap to retry.`),
          );
        }
        const result = data as { event?: { id?: string } } | null;
        const savedId = result?.event?.id ?? targetId;
        onComplete(savedId);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "Couldn't save experience. Tap to retry.");
      } finally {
        setSubmitting(false);
      }
    },
    [
      brand,
      buildPayload,
      ensureDraft,
      experienceNeedsStripe,
      handlePaidPublishGuard,
      intents,
      onComplete,
      pricingValid,
      stopsValid,
      user?.id,
      whenAdapter,
    ],
  );

  // META-ORCH-1059 Sub-E — live-experience save. Builds the LiveExperiencePatch
  // from the SAME wizard state buildPayload uses, runs the client guard (UX
  // fast-path), then routes through biz_update_live_experience. The server
  // re-validates the refund-gate; the inline error mirrors the server reason.
  const handleLiveSave = useCallback(async (): Promise<void> => {
    if (liveExperience === undefined) return;
    if (brand === null || user?.id === undefined) return;
    setLiveEditError(null);

    // Step-level completeness still required for a live experience (published
    // rows must stay valid). Reuse the same publish-readiness checks.
    if (intents.length === 0 || !stopsValid || !pricingValid || !whenAdapter.isValid) {
      setShowStepErrors(true);
      whenAdapter.setShowErrors(true);
      const reason =
        intents.length === 0
          ? "Pick at least one vibe on step 1 before saving."
          : !stopsValid
            ? "Finish your stops (each needs a name, description, and address) before saving."
            : !whenAdapter.isValid
              ? "Set the date and time on the When step before saving."
              : "Set a valid price (or mark it free) before saving.";
      setToast(reason);
      return;
    }

    // Build the guard patch from current wizard state (mirrors buildPayload).
    const resolvedCents = Math.round(resolvedTotalMajor * 100);
    const patch: LiveExperiencePatch = {
      capacity: unlimited ? null : parseInt(capacity, 10) || null,
      is_free: isFree,
      pricing_mode: pricingMode,
      whole_price_cents: resolvedCents,
      stops: stops.map((s) => ({
        placeName: s.placeName.trim(),
        priceCents:
          pricingMode === "per_stop"
            ? Math.round((parseFloat(s.priceMajor) || 0) * 100)
            : 0,
      })),
    };

    // Client guard — UX fast-path.
    const guard = validateLiveExperienceFieldUpdate(
      liveExperience,
      patch,
      liveSoldCount ?? 0,
      liveEditReason,
    );
    if (!guard.ok) {
      const copy = liveExperienceRejectCopy(guard.reason, guard.affectedOrderCount);
      setLiveEditError(copy);
      setToast(copy);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc("biz_update_live_experience", {
        p_event_id: liveExperience.id,
        p_payload: buildPayload(true),
        p_reason: guard.trimmedReason,
      });
      if (error !== null) {
        const code = (error.message ?? "").trim();
        // ORCH-1075 — paid-edit integrity guards (defense-in-depth: this RPC
        // returns them via data.reason, but a future RAISE path is covered too).
        if (handlePaidPublishGuard(code)) {
          return;
        }
        throw new Error(
          RPC_ERROR_COPY[code] ??
            (code.length > 0
              ? `Couldn't save experience: ${code}`
              : "Couldn't save experience. Tap to retry."),
        );
      }
      const result = data as
        | { ok?: boolean; reason?: string; affected_order_count?: number; event?: { id?: string } }
        | null;
      // ORCH-1075 — Stripe-readiness / past-date guard (structured return).
      if (
        result !== null &&
        result.ok === false &&
        handlePaidPublishGuard(result.reason)
      ) {
        return;
      }
      // Server-side refund-gate rejection (canonical).
      if (result !== null && result.ok === false && typeof result.reason === "string") {
        const copy = liveExperienceRejectCopy(
          result.reason as UpdateLiveExperienceRejectReason,
          result.affected_order_count,
        );
        setLiveEditError(copy);
        setToast(copy);
        return;
      }
      const savedId = result?.event?.id ?? liveExperience.id;
      onComplete(savedId);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Couldn't save experience. Tap to retry.");
    } finally {
      setSubmitting(false);
    }
  }, [
    brand,
    buildPayload,
    capacity,
    handlePaidPublishGuard,
    intents,
    isFree,
    liveEditReason,
    liveExperience,
    liveSoldCount,
    onComplete,
    pricingMode,
    pricingValid,
    resolvedTotalMajor,
    stops,
    stopsValid,
    unlimited,
    user?.id,
    whenAdapter,
  ]);

  return (
    <View style={styles.host}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel={step === 1 ? "Cancel experience creation" : "Back"}
          style={styles.backTouch}
        >
          <Icon name={step === 1 ? "close" : "chevL"} size={18} color={textTokens.secondary} />
        </Pressable>
        <Stepper steps={STEPS} currentIndex={step - 1} />
      </View>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {isLiveEdit ? (
          <EditAfterPublishExperienceBanner
            reason={liveEditReason}
            onReasonChange={(next) => {
              setLiveEditReason(next);
              if (liveEditError !== null) setLiveEditError(null);
            }}
            errorMessage={liveEditError}
          />
        ) : null}
        {step === 1 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>Create experience</Text>
            <Text style={styles.label}>Experience title</Text>
            <Input
              variant="text"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Friday Night Jazz Crawl"
              accessibilityLabel="Experience title"
              clearable
            />
            <Text style={styles.label}>What&apos;s it about?</Text>
            <TextInput
              value={description}
              onChangeText={(value) => setDescription(value.slice(0, 500))}
              placeholder="10–500 characters."
              placeholderTextColor={textTokens.quaternary}
              accessibilityLabel="Experience description"
              multiline
              style={styles.textArea}
            />

            {/* META-ORCH-1059 CHANGE 2 — curated vibes picker (MULTI; ≥1 required) */}
            <Text style={styles.label}>Which vibes fit this experience?</Text>
            <Text style={styles.helperBody}>
              Pick every vibe that fits — buyers find your experience under each one on
              the Mingla deck. Choose at least one.
            </Text>
            <View style={styles.intentGrid}>
              {EXPERIENCE_INTENTS.map((opt) => {
                const selected = intents.includes(opt.id);
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => toggleIntent(opt.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${opt.label} — ${opt.description}`}
                    style={[styles.intentChip, selected && styles.intentChipActive]}
                  >
                    <Icon
                      name={selected ? "check" : opt.icon}
                      size={18}
                      color={selected ? accent.warm : textTokens.secondary}
                    />
                    <View style={styles.intentTextCol}>
                      <Text
                        style={[
                          styles.intentLabel,
                          selected && styles.intentLabelActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                      <Text style={styles.intentDesc} numberOfLines={1}>
                        {opt.description}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            {showStepErrors && intents.length === 0 ? (
              <Text style={styles.inlineError}>Pick at least one vibe for this experience.</Text>
            ) : null}
          </View>
        ) : null}

        {step === 2 ? (
          <ExperienceStopsStep
            brandId={brandId}
            currencySymbol={currencySymbol}
            stops={stops}
            setStops={setStops}
            locationMode={locationMode}
            setLocationMode={setLocationMode}
            pricingMode={pricingMode}
            showErrors={showStepErrors}
            onToast={setToast}
          />
        ) : null}

        {step === 3 ? (
          <View style={styles.stepBody}>
            <Text style={styles.title}>When does it happen?</Text>
            <CreatorStep2When
              draft={whenAdapter.draftEvent}
              updateDraft={whenAdapter.updateDraft}
              errors={whenAdapter.errors}
              showErrors={whenAdapter.showErrors}
              onShowToast={setToast}
              scrollToBottom={() => scrollRef.current?.scrollToEnd({ animated: true })}
              // META-ORCH-1059 — experiences can recur with no end.
              allowNeverEnds
            />
          </View>
        ) : null}

        {step === 4 && brand !== null ? (
          <ExperiencePricingStep
            currencySymbol={currencySymbol}
            currency={currency}
            pricingMode={pricingMode}
            setPricingMode={setPricingMode}
            stops={stops}
            setStops={setStops}
            wholePriceMajor={wholePriceMajor}
            setWholePriceMajor={setWholePriceMajor}
            isFree={isFree}
            setIsFree={setIsFree}
            capacity={capacity}
            setCapacity={setCapacity}
            unlimited={unlimited}
            setUnlimited={setUnlimited}
            pricingSwitches={pricingSwitches}
            setPricingSwitches={setPricingSwitches}
            brandDefaults={{
              passTax: brand.defaultPassTax ?? false,
              passMinglaFee: brand.defaultPassMinglaFee ?? false,
              passServiceFee: brand.defaultPassServiceFee ?? false,
            }}
            takeRateBps={brand.takeRateBpsOverride ?? DEFAULT_TAKE_RATE_BPS}
            vatRegistered={taxRegistration.data?.hasActiveRegistration === true}
            onEditDefaults={() => router.push(`/brand/${brand.id}/pricing-defaults` as never)}
            onSetupVat={() => router.push("/connect-tax-registrations" as never)}
            showErrors={showStepErrors}
          />
        ) : null}

        {/* ORCH-1076 Stream B — proactive Stripe banner on the Pricing step, at
            the bottom of the step body so the brand sees it the moment they set
            a non-zero price. */}
        {step === 4 && experienceNeedsStripe ? (
          <View style={styles.stripeBannerWrap}>
            <StripeBlockedCard
              title="Bank required for paid experiences"
              body="Connect a bank to publish this paid experience. Free experiences can be published any time."
              ctaLabel="Connect bank"
              onConnectStripe={handleConnectStripe}
              testID="experience-pricing-stripe-blocked"
            />
          </View>
        ) : null}

        {step === 5 ? (
          <ExperienceCoverStep
            brandId={brandId}
            experienceId={experienceId}
            preparingDraft={creatingDraft}
            cover={cover}
            onCoverChange={setCover}
            onShowToast={setToast}
          />
        ) : null}

        {/* ORCH-1076 Stream B — proactive Stripe banner on the FINAL (Cover)
            step, at the bottom of the scroll body so it sits directly above the
            footer Publish CTA. */}
        {step === 5 && experienceNeedsStripe ? (
          <View style={styles.stripeBannerWrap}>
            <StripeBlockedCard
              title="Bank required for paid experiences"
              body="Connect a bank to publish this paid experience. Free experiences can be published any time."
              ctaLabel="Connect bank"
              onConnectStripe={handleConnectStripe}
              testID="experience-cover-stripe-blocked"
            />
          </View>
        ) : null}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        {step < 5 ? (
          <Button label="Continue" onPress={goNext} variant="primary" size="lg" />
        ) : isLiveEdit ? (
          // META-ORCH-1059 Sub-E — live experiences are already published, so
          // there's one "Save changes" action routed through the refund-gate RPC
          // (no Save-as-draft / Publish split — a live experience can't go back
          // to draft).
          <Button
            label="Save changes"
            onPress={() => void handleLiveSave()}
            variant="primary"
            size="lg"
            loading={submitting}
            testID="experience-live-edit-save"
          />
        ) : (
          <View style={styles.footerRow}>
            <Button
              label="Save as draft"
              onPress={() => void handleSubmit(false)}
              variant="secondary"
              size="lg"
              loading={submitting}
              style={styles.footerButton}
            />
            <Button
              label="Publish"
              onPress={() => void handleSubmit(true)}
              variant="primary"
              size="lg"
              loading={submitting}
              // ORCH-1076 Stream B — disable Publish for a paid experience on a
              // Stripe-unready brand (proactive gate; "Save as draft" stays
              // enabled because drafts are server-exempt).
              disabled={experienceNeedsStripe}
              style={styles.footerButton}
              testID="experience-footer-publish"
            />
          </View>
        )}
      </View>
      <Toast visible={toast !== null} kind="error" message={toast ?? ""} onDismiss={() => setToast(null)} />
    </View>
  );
};

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: canvas.discover },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  backTouch: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
  },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  // ORCH-1076 Stream B — proactive Stripe banner spacing (inherits the
  // scrollContent horizontal padding; only needs top separation).
  stripeBannerWrap: { marginTop: spacing.md },
  stepBody: { gap: spacing.md },
  title: {
    fontSize: typography.h2.fontSize,
    lineHeight: typography.h2.lineHeight,
    fontWeight: typography.h2.fontWeight,
    color: textTokens.primary,
  },
  body: {
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    color: textTokens.secondary,
  },
  label: {
    fontSize: typography.bodySm.fontSize,
    lineHeight: typography.bodySm.lineHeight,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  textArea: {
    minHeight: 120,
    padding: spacing.md,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: glass.tint.profileBase,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.border.profileBase,
    color: textTokens.primary,
    fontSize: typography.body.fontSize,
    lineHeight: typography.body.lineHeight,
    textAlignVertical: "top",
  },
  footer: { padding: spacing.lg },
  footerRow: { flexDirection: "row", gap: spacing.sm },
  footerButton: { flex: 1 },
  helperBody: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: textTokens.tertiary,
  },
  intentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  intentChip: {
    flexBasis: "47%",
    flexGrow: 1,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  intentChipActive: {
    borderColor: accent.border,
    backgroundColor: accent.tint,
  },
  intentTextCol: { flex: 1 },
  intentLabel: {
    fontSize: typography.bodySm.fontSize,
    fontWeight: "600",
    color: textTokens.secondary,
  },
  intentLabelActive: { color: textTokens.primary },
  intentDesc: {
    fontSize: typography.caption.fontSize,
    color: textTokens.tertiary,
    marginTop: 1,
  },
  inlineError: {
    fontSize: typography.caption.fontSize,
    lineHeight: typography.caption.lineHeight,
    color: semantic.error,
    marginTop: spacing.xxs,
  },
});

export default ExperienceCreatorWizard;
