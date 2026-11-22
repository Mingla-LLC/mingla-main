/**
 * #4541 R2.12 — the words @mingla/form-rendering draws, with English defaults.
 *
 * Pure (no React Native), so rules, renderers and host apps all read it. Host
 * web and buyer web inject nothing and keep today's English. The Explorer app
 * injects its `forms` namespace values through `primitives.copy`.
 */

import type { FormRenderingCopy } from "./types";

export const SHOWN_TO_DOOR_STAFF = "Shown to door staff";
export const ANSWERS_SEEN_LINE = "The host and their door staff can see your answers.";

export const DEFAULT_FORM_RENDERING_COPY: Readonly<FormRenderingCopy> = Object.freeze({
  shownToDoorStaff: SHOWN_TO_DOOR_STAFF,
  answersSeenLine: ANSWERS_SEEN_LINE,
  optional: "(optional)",
  untitledQuestion: "Untitled question",
  requiredToContinue: "Answer the required questions to continue",
  fieldErrors: Object.freeze({
    required: "Answer this question.",
    type: "Check this answer.",
    option: "Pick one of the choices.",
    too_long: "This answer is too long.",
  }),
  textPlaceholder: "Type your answer…",
  numberPlaceholder: "Enter a number",
  numberMin: (min: string): string => `Min ${min}`,
  numberMax: (max: string): string => `Max ${max}`,
  datePlaceholder: "Tap to choose date",
  dateCancel: "Cancel",
  dateSet: "Set date",
  brandFallbackName: "Your brand",
  fromBrand: (brand: string): string => `From ${brand}`,
  fromHost: "From the host",
});

/** The injected words over the English defaults (a partial object fills the gaps). */
export function resolveFormCopy(copy: Partial<FormRenderingCopy> | undefined): FormRenderingCopy {
  if (copy === undefined) return DEFAULT_FORM_RENDERING_COPY;
  return {
    ...DEFAULT_FORM_RENDERING_COPY,
    ...copy,
    fieldErrors: { ...DEFAULT_FORM_RENDERING_COPY.fieldErrors, ...(copy.fieldErrors ?? {}) },
  };
}
