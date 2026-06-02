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

import { useCallback, useMemo, useState } from "react";

import {
  type DraftEvent,
  type MultiDateEntry,
  type RecurrenceRule,
  type WhenMode,
} from "../store/draftEventStore";
import { validateStep, type ValidationError } from "../utils/draftEventValidation";
import { computeEndsAtUtcWithSmartInfer } from "../utils/eventDateMath";

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

const detectDeviceTimezone = (): string => {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === "string" && tz.length > 0 ? tz : "UTC";
  } catch {
    return "UTC";
  }
};

/**
 * Build a type-complete synthetic DraftEvent. Only the When subset is
 * meaningful; the rest are inert defaults so the type checks and the step body
 * (which reads only the When fields) renders correctly.
 */
function synthDraft(brandId: string, when: ExperienceWhenState): DraftEvent {
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
    hideRemainingCount: false,
    passwordProtected: false,
    themeOverrides: null,
    privateGuestList: false,
    inPersonPaymentsEnabled: false,
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
): UseExperienceDraftAdapterResult {
  const [whenState, setWhenState] = useState<ExperienceWhenState>({
    whenMode: initialWhen?.whenMode ?? "single",
    date: initialWhen?.date ?? null,
    doorsOpen: initialWhen?.doorsOpen ?? null,
    endsAt: initialWhen?.endsAt ?? null,
    timezone: initialWhen?.timezone ?? detectDeviceTimezone(),
    recurrenceRule: initialWhen?.recurrenceRule ?? null,
    multiDates: initialWhen?.multiDates ?? null,
  });
  const [showErrors, setShowErrors] = useState(false);

  const draftEvent = useMemo(
    () => synthDraft(brandId, whenState),
    [brandId, whenState],
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
        if ("timezone" in patch && patch.timezone !== undefined) next.timezone = patch.timezone;
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
