/**
 * #4541 R1.2 — the ONE home of the "When guests answer" words: the three
 * timing choices, their labels and lines (honest about "required"), the RSVP
 * wording, and the "not asked yet" count. A leaf (type imports only), so the
 * copy file and the model both re-export it without pulling the model into
 * every chunk that shows a mode label.
 */

import type { BrandFormMode } from "../services/brandFormsService";

export interface ModeCopy {
  value: BrandFormMode;
  label: string;
  line: string;
}

/** The three timing choices, in the order they are shown. Exact copy (#4541 R1.2). */
export const GUEST_QUESTION_MODES: readonly ModeCopy[] = [
  { value: "optional_on_page", label: "On the page, optional", line: "Guests can answer if they want." },
  {
    value: "required_step",
    label: "On the page, required",
    line: "Guests answer before they finish. Anyone booking from an older app version is asked afterwards.",
  },
  { value: "after_purchase", label: "After they purchase", line: "Guests are taken to the form right after they buy." },
];

/** "After they RSVP" on RSVP pages. */
export const AFTER_RSVP_LABEL = "After they RSVP";
export const AFTER_RSVP_LINE = "Guests are taken to the form right after they RSVP.";

/** The label for a mode; "After they RSVP" on RSVP pages. */
export function modeLabel(mode: BrandFormMode, isRsvp: boolean): string {
  if (mode === "after_purchase" && isRsvp) return AFTER_RSVP_LABEL;
  const found = GUEST_QUESTION_MODES.find((m) => m.value === mode);
  return found?.label ?? "On the page, required";
}

/** The line for a mode; the RSVP wording on RSVP pages. */
export function modeLine(mode: BrandFormMode, isRsvp: boolean): string {
  if (mode === "after_purchase" && isRsvp) return AFTER_RSVP_LINE;
  return GUEST_QUESTION_MODES.find((m) => m.value === mode)?.line ?? "";
}

/** "{m} not asked yet" (the tile line's second half). */
export const notAskedLine = (m: number): string => `${m} not asked yet`;
