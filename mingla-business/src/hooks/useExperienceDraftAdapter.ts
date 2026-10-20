/**
 * META-ORCH-1059 [experiences-business-parity] · SUB-A · LAYER 5 (lifecycle design A.0.3 / A1)
 *
 * useExperienceDraftAdapter — a thin in-component adapter that lets the
 * experience wizard's When step render the EVENT `CreatorStep2When` body
 * verbatim, fed by a synthetic `DraftEvent`. The wizard does NOT own a
 * DraftEvent and we MUST NOT extend draftEventStore or fork CreatorStep2When
 * (lifecycle design lock A1, recommendation (a)).
 *
 * CreatorStep2When reads exactly these draft fields:
 *   whenMode · date · doorsOpen · endsAt · multiDates · recurrenceRule · timezone
 * plus updateDraft / errors / showErrors. This adapter maps experience local
 * state ⇄ that subset and exposes:
 *   - draftEvent     : a type-complete synthetic DraftEvent for the step body
 *   - updateDraft    : patches the When subset (ignores non-When fields)
 *   - errors         : the When-step validation errors (reuses validateStep(1, ...))
 *   - showErrors     : gates inline error display after a failed Continue
 *   - setShowErrors  : flips showErrors
 *   - isValid        : true when validateStep(1, ...) returns no errors
 *   - toPayloadWhen(): emits the whenMode/when/multiDates/recurrence_rules/timezone
 *                      fields of the biz_create_experience p_payload
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type DraftEvent,
  type MultiDateEntry,
  type RecurrenceRule,
  type WhenMode,
} from "../store/draftEventStore";
import { validateStep, type ValidationError } from "../utils/draftEventValidation";
import { computeEndsAtUtcWithSmartInfer } from "../utils/eventDateMath";
import {
  defaultTimezoneForBrand,
  detectDeviceTimezone,
} from "../utils/timezones";

/** The When-step subset of DraftEvent the adapter actually owns. */
export interface ExperienceWhenState {
  whenMode: WhenMode;
  date: string | null;
  doorsOpen: string | null;
  endsAt: string | null;
  timezone: string;
  recurrenceRule: RecurrenceRule | null;
  multiDates: MultiDateEntry[] | null;
}

/** The When-related fields of the biz_create_experience p_payload. */
export interface ExperiencePayloadWhen {
  whenMode: WhenMode;
  when: { date: string | null; doorsOpen: string | null; endsAt: string | null } | null;
  multiDates: Array<{ date: string; startTime: string; endTime: string }> | null;
  recurrence_rules: RecurrenceRule | null;
  timezone: string;
}

/** Brand hints used only when seeding a NEW experience's timezone. */
export interface ExperienceBrandTimezoneHints {
  payoutCountry?: string | null;
  currency?: string | null;
}

/**
 * Build a type-complete synthetic DraftEvent. Only the When subset is
 * meaningful; the rest are inert defaults so the type checks and the step body
 * (which reads only the When fields) renders correctly.
 */
/** ORCH-1339 — the two guest-privacy display gates (wizard-owned state). */
export interface ExperienceGuestPrivacyState {
  privateGuestList: boolean;
  hideRemainingCount: boolean;
  /** issue #3827 going-box — guests on the host's own list (0..5000). */
  extraGuestCount: number;
}

const GUEST_PRIVACY_DEFAULTS: ExperienceGuestPrivacyState = {
  privateGuestList: false,
  hideRemainingCount: false,
  extraGuestCount: 0,
};

function synthDraft(
  brandId: string,
  when: ExperienceWhenState,
  guestPrivacy: ExperienceGuestPrivacyState,
): DraftEvent {
  const now = new Date().toISOString();
  return {
    id: "experience-when-adapter",
    brandId,
    serverSlug: null,
    name: "",
    description: "",
    format: "in_person",
    partyTypes: [],
    vibeTags: [],
    musicGenres: [],
    // When subset (the meaningful part) ----------------------------------
    whenMode: when.whenMode,
    date: when.date,
    doorsOpen: when.doorsOpen,
    endsAt: when.endsAt,
    endsAtUtc: computeEndsAtUtcWithSmartInfer(
      when.date,
      when.doorsOpen,
      when.endsAt,
      when.timezone,
    ),
    timezone: when.timezone,
    recurrenceRule: when.recurrenceRule,
    multiDates: when.multiDates,
    // Inert remainder ----------------------------------------------------
    venueName: null,
    address: null,
    city: null,
    locationGeo: null,
    onlineUrl: null,
    hideAddressUntilTicket: true,
    coverHue: 25,
    coverMediaUrl: null,
    coverMediaType: null,
    coverMediaProvider: null,
    coverMediaSourceUrl: null,
    coverMediaCredit: null,
    coverMediaCreditUrl: null,
    coverMediaAlt: null,
    currency: null,
    tickets: [],
    pricingSwitches: { passTax: null, passMinglaFee: null, passServiceFee: null },
    visibility: "public",
    requireApproval: false,
    allowTransfers: true,
    // ORCH-1339 — the two guest-privacy display gates now flow from the
    // wizard-owned state (hydrated in edit mode; false in create mode) instead
    // of hard-coded false.
    hideRemainingCount: guestPrivacy.hideRemainingCount,
    passwordProtected: false,
    themeOverrides: null,
    privateGuestList: guestPrivacy.privateGuestList,
    extraGuestCount: guestPrivacy.extraGuestCount,
    inPersonPaymentsEnabled: false,
    // ORCH-1291 [rsvp-chip-in] — inert for the experience When-adapter.
    rsvpContributionEnabled: false,
    rsvpContributionSuggestedCents: null,
    rsvpContributionMinCents: null,
    lastStepReached: 1,
    status: "draft",
    createdAt: now,
    updatedAt: now,
  };
}

export interface UseExperienceDraftAdapterResult {
  whenState: ExperienceWhenState;
  draftEvent: DraftEvent;
  updateDraft: (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>) => void;
  errors: ValidationError[];
  showErrors: boolean;
  setShowErrors: (v: boolean) => void;
  isValid: boolean;
  toPayloadWhen: () => ExperiencePayloadWhen;
}

export function useExperienceDraftAdapter(
  brandId: string,
  // META-ORCH-1059 Sub-B — edit-mode seeds the When state from the loaded draft.
  initialWhen?: Partial<ExperienceWhenState>,
  // ORCH-1339 — the wizard threads its guest-privacy toggle state so the
  // synthetic draft carries the host's real values (defaults false).
  guestPrivacy?: ExperienceGuestPrivacyState,
  // issue #3281 Round 1 — brand country/currency beat the device zone for new drafts.
  brandTzHints?: ExperienceBrandTimezoneHints,
): UseExperienceDraftAdapterResult {
  const seededTimezone =
    initialWhen?.timezone ??
    defaultTimezoneForBrand({
      payoutCountry: brandTzHints?.payoutCountry,
      currency: brandTzHints?.currency,
      deviceZone: detectDeviceTimezone(),
    });
  const [whenState, setWhenState] = useState<ExperienceWhenState>({
    whenMode: initialWhen?.whenMode ?? "single",
    date: initialWhen?.date ?? null,
    doorsOpen: initialWhen?.doorsOpen ?? null,
    endsAt: initialWhen?.endsAt ?? null,
    timezone: seededTimezone,
    recurrenceRule: initialWhen?.recurrenceRule ?? null,
    multiDates: initialWhen?.multiDates ?? null,
  });
  const [showErrors, setShowErrors] = useState(false);
  // Brand often hydrates after first paint. If the host has not touched
  // timezone yet and we seeded from the device, promote to the brand zone once.
  const timezoneTouchedRef = useRef(initialWhen?.timezone !== undefined);
  useEffect(() => {
    if (timezoneTouchedRef.current) return;
    if (initialWhen?.timezone !== undefined) return;
    const next = defaultTimezoneForBrand({
      payoutCountry: brandTzHints?.payoutCountry,
      currency: brandTzHints?.currency,
      deviceZone: detectDeviceTimezone(),
    });
    setWhenState((prev) => (prev.timezone === next ? prev : { ...prev, timezone: next }));
  }, [
    brandTzHints?.payoutCountry,
    brandTzHints?.currency,
    initialWhen?.timezone,
  ]);

  const draftEvent = useMemo(
    () => synthDraft(brandId, whenState, guestPrivacy ?? GUEST_PRIVACY_DEFAULTS),
    [brandId, whenState, guestPrivacy],
  );

  // Patch only the When subset; non-When keys are ignored (the step body never
  // patches them, but this keeps the contract honest if it ever does).
  const updateDraft = useCallback(
    (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>): void => {
      setWhenState((prev) => {
        const next: ExperienceWhenState = { ...prev };
        if ("whenMode" in patch && patch.whenMode !== undefined) next.whenMode = patch.whenMode;
        if ("date" in patch) next.date = patch.date ?? null;
        if ("doorsOpen" in patch) next.doorsOpen = patch.doorsOpen ?? null;
        if ("endsAt" in patch) next.endsAt = patch.endsAt ?? null;
        if ("timezone" in patch && patch.timezone !== undefined) {
          timezoneTouchedRef.current = true;
          next.timezone = patch.timezone;
        }
        if ("recurrenceRule" in patch) next.recurrenceRule = patch.recurrenceRule ?? null;
        if ("multiDates" in patch) next.multiDates = patch.multiDates ?? null;
        return next;
      });
    },
    [],
  );

  const errors = useMemo(
    () => validateStep(1, draftEvent),
    [draftEvent],
  );

  const isValid = errors.length === 0;

  const toPayloadWhen = useCallback(
    (): ExperiencePayloadWhen => ({
      whenMode: whenState.whenMode,
      when:
        whenState.whenMode === "multi_date"
          ? null
          : {
              date: whenState.date,
              doorsOpen: whenState.doorsOpen,
              endsAt: whenState.endsAt,
            },
      multiDates:
        whenState.whenMode === "multi_date" && whenState.multiDates !== null
          ? whenState.multiDates.map((d) => ({
              date: d.date,
              startTime: d.startTime,
              endTime: d.endTime,
            }))
          : null,
      recurrence_rules:
        whenState.whenMode === "recurring" ? whenState.recurrenceRule : null,
      timezone: whenState.timezone,
    }),
    [whenState],
  );

  return {
    whenState,
    draftEvent,
    updateDraft,
    errors,
    showErrors,
    setShowErrors,
    isValid,
    toPayloadWhen,
  };
}
