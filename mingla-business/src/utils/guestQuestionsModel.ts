/**
 * #4514 — the pure rules behind the "Guest questions" row, the shared attach
 * sheet and the manage-page tile. No react-native, no supabase, so each rule
 * is testable on its own and each guard has a test that fails when removed.
 *
 * Words are exact from the approved design (Design v3, v4, v6 on #4514).
 */

import type { BrandFormMode, BrandFormStatus } from "../services/brandFormsService";
import { MIN_RANK } from "./permissionGates";

/** What kind of page the questions are attached to. */
export type GuestQuestionsPageKind = "event" | "experience" | "trip" | "rsvp";

// ---------------------------------------------------------------------------
// Who sees what (contract correction C5)
// ---------------------------------------------------------------------------

/** The manage-page tile and the Responses page: marketing manager and up. */
export const canReadGuestQuestions = (rank: number): boolean =>
  rank >= MIN_RANK.READ_FORM_RESPONSES;

/** Attach, change, remove: event manager and up. */
export const canAttachGuestQuestions = (rank: number): boolean =>
  rank >= MIN_RANK.ATTACH_FORM_TO_PAGE;

/** Export (and, in later waves, Ask and Remind): event manager and up. */
export const canExportGuestAnswers = (rank: number): boolean =>
  rank >= MIN_RANK.EXPORT_FORM_RESPONSES;

// ---------------------------------------------------------------------------
// The attach sheet: "When guests answer"
// ---------------------------------------------------------------------------

export interface ModeRow {
  value: BrandFormMode;
  label: string;
  line: string;
  disabled: boolean;
  /** Why a row is off, shown under the group. */
  disabledReason: string | null;
}

const MODE_COPY: ReadonlyArray<{ value: BrandFormMode; label: string; line: string }> = [
  { value: "optional_on_page", label: "On the page, optional", line: "Guests can answer if they want." },
  { value: "required_step", label: "On the page, required", line: "Guests must answer before they finish." },
  { value: "after_purchase", label: "After they purchase", line: "Guests are taken to the form right after." },
];

export const TRIP_MODE_NOTE = "Trips keep their own questions step for now.";

/** The three radio rows, in order. "After they RSVP" on RSVP pages. */
export function modeRows(kind: GuestQuestionsPageKind): ModeRow[] {
  return MODE_COPY.map((m): ModeRow => {
    const tripRefuses = kind === "trip" && m.value !== "after_purchase";
    return {
      value: m.value,
      label: m.value === "after_purchase" && kind === "rsvp" ? "After they RSVP" : m.label,
      line: m.line,
      disabled: tripRefuses,
      disabledReason: tripRefuses ? TRIP_MODE_NOTE : null,
    };
  });
}

/** "On the page, required" is the default; a trip can only ask after purchase. */
export const defaultMode = (kind: GuestQuestionsPageKind): BrandFormMode =>
  kind === "trip" ? "after_purchase" : "required_step";

export interface FormChoice {
  id: string;
  status: BrandFormStatus;
}

export interface FormRowState {
  selectable: boolean;
  hint: "draft" | "closed" | null;
}

/**
 * A live form can be picked. A draft or closed form is shown but off, except
 * the one already on this page (so the host can still change its timing).
 */
export function formRowState(form: FormChoice, currentFormId: string | null): FormRowState {
  if (form.status === "archived") return { selectable: false, hint: null };
  if (form.id === currentFormId) return { selectable: true, hint: null };
  if (form.status === "draft") return { selectable: false, hint: "draft" };
  if (form.status === "closed") return { selectable: false, hint: "closed" };
  return { selectable: true, hint: null };
}

export interface AttachDraft {
  formId: string | null;
  mode: BrandFormMode | null;
}

export interface AttachCurrent {
  formId: string;
  mode: BrandFormMode;
}

/** Save stays off until the sheet is valid and something changed. */
export function canSaveAttach(
  kind: GuestQuestionsPageKind,
  draft: AttachDraft,
  current: AttachCurrent | null,
  busy: boolean,
): boolean {
  if (busy) return false;
  if (draft.formId === null || draft.mode === null) return false;
  const row = modeRows(kind).find((r) => r.value === draft.mode);
  if (row === undefined || row.disabled) return false;
  if (current !== null && current.formId === draft.formId && current.mode === draft.mode) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The tile
// ---------------------------------------------------------------------------

export type TileData =
  | {
      formName: string;
      formStatus: BrandFormStatus;
      mode: BrandFormMode;
      /** The attached form has been published at least once. */
      published: boolean;
      answered: number;
      notAnswered: number;
    }
  | null;

export type TileState =
  | { kind: "loading" }
  | { kind: "failed" }
  | { kind: "none" }
  | { kind: "draft" }
  | { kind: "closed" }
  | { kind: "attention"; toAnswer: number }
  | { kind: "live"; answered: number };

export function tileState(input: { isError: boolean; data: TileData | undefined }): TileState {
  if (input.data === undefined) {
    return input.isError ? { kind: "failed" } : { kind: "loading" };
  }
  const data = input.data;
  if (data === null) return { kind: "none" };
  if (data.formStatus === "closed") return { kind: "closed" };
  if (!data.published || data.formStatus === "draft") return { kind: "draft" };
  // Optional forms never ask anyone, so they never show "to answer".
  if (data.mode !== "optional_on_page" && data.notAnswered > 0) {
    return { kind: "attention", toAnswer: data.notAnswered };
  }
  return { kind: "live", answered: data.answered };
}

/** The one line under "Guest questions". */
export function tileLine(state: TileState): string {
  switch (state.kind) {
    case "loading":
      return "Loading…";
    case "failed":
      return "Unable to load";
    case "none":
      return "Not set up";
    case "draft":
      return "Not published";
    case "closed":
      return "Closed";
    case "attention":
      return `${state.toAnswer} to answer`;
    case "live":
      return `${state.answered} answered`;
    default: {
      const never: never = state;
      return never;
    }
  }
}

export type TileTarget =
  | { to: "sheet" }
  | { to: "builder" }
  | { to: "responses"; tab: "summary" | "not_answered" | "responses" }
  | { to: "retry" };

/** What a tap does (Design v4). */
export function tileTarget(state: TileState): TileTarget {
  switch (state.kind) {
    case "none":
      return { to: "sheet" };
    case "draft":
      return { to: "builder" };
    case "attention":
      return { to: "responses", tab: "not_answered" };
    case "live":
      return { to: "responses", tab: "summary" };
    case "closed":
      return { to: "responses", tab: "summary" };
    case "loading":
    case "failed":
      return { to: "retry" };
    default: {
      const never: never = state;
      return never;
    }
  }
}

/** The tile's accessibility label carries the full count. */
export function tileAccessibilityLabel(
  state: TileState,
  data: TileData | undefined,
  modeText: string | null,
): string {
  if (state.kind === "none") return "Guest questions. No form on this page yet.";
  if (data === null || data === undefined) return `Guest questions. ${tileLine(state)}.`;
  const lead = `Guest questions. ${data.formName}${modeText !== null ? `, ${modeText.toLowerCase()}` : ""}.`;
  switch (state.kind) {
    case "draft":
      return `${lead} Not published.`;
    case "closed":
      return `${lead} Closed, answers kept.`;
    case "attention":
    case "live":
      return `${lead} ${data.answered} of ${data.answered + data.notAnswered} answered.`;
    default:
      return `${lead} ${tileLine(state)}.`;
  }
}

// ---------------------------------------------------------------------------
// The "Guest questions" row on an edit screen
// ---------------------------------------------------------------------------

export interface RowInput {
  isError: boolean;
  /** undefined: still loading; null: no form on the page. */
  data: { formName: string; formStatus: BrandFormStatus; published: boolean; mode: BrandFormMode } | null | undefined;
}

/** The one line under "Guest questions" on an edit screen. */
export function rowSummary(input: RowInput, kind: GuestQuestionsPageKind): string {
  if (input.data === undefined) return input.isError ? "Unable to load" : "Loading…";
  if (input.data === null) return "Not set up";
  const { formName, formStatus, published, mode } = input.data;
  if (!published || formStatus === "draft") return `${formName} · Draft, publish it to start asking`;
  if (formStatus === "closed") return `${formName} · Closed`;
  const label = modeRows(kind).find((r) => r.value === mode)?.label ?? "";
  return `${formName} · ${label}`;
}
