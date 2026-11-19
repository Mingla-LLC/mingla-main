/**
 * The host-supplied phone field's render contract (ORCH-1295). A leaf module so
 * the eager RSVP body and its lazily loaded guest block can both type against
 * it without importing each other.
 */
import type React from "react";
import type { ThemePalette } from "./themePalette";

export interface RsvpPhoneFieldRenderArgs {
  role: "primary" | "plus_one";
  guestId: string | null;
  index: number | null;
  label: string;
  testID: string;
  /** ISO 3166-1 alpha-2 country code (controlled by the hook). */
  countryCode: string | null;
  /** Raw value as typed; canonical E.164 is owned separately. */
  rawValue: string;
  /** New country picked → surface passes the freshly-composed E.164 too. */
  onChangeCountry: (isoCode: string, resolvedE164: string | null) => void;
  /** Digits edited → surface passes the freshly-composed E.164 too. */
  onChangeRawValue: (raw: string, resolvedE164: string | null) => void;
  /** True when the composed value is present but not a valid phone number. */
  invalid: boolean;
  /** Brand palette so the injected field matches the themed RSVP form. */
  palette: ThemePalette;
  /** Disable while a submit is in flight. */
  disabled: boolean;
  required: boolean;
  emptyRequired: boolean;
  onBlur: () => void;
  /**
   * issue #4508 1.6 — true on a GUEST number: the field must not offer the
   * device's own number (no telephoneNumber / tel autofill). Absent ⇒ false.
   */
  disableAutofill?: boolean;
  /** issue #4508 1.2b — the keyboard's done key adds the number. */
  onSubmitEditing?: () => void;
  /** issue #4508 — the field's own error line; absent ⇒ the renderer's default. */
  errorText?: string | null;
}
export type RsvpPhoneFieldRenderer = (
  args: RsvpPhoneFieldRenderArgs,
) => React.ReactNode;

/** The body's plain text field (ORCH-1150), handed to the lazily loaded guest
 * block as a component so the field's guest props live in that chunk. */
export interface RsvpPlainFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  palette: ThemePalette;
  invalid: boolean;
  invalidMsg: string;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  testID?: string;
  disabled?: boolean;
  /** issue #4508 1.6 — a guest's number never offers the device's own number. */
  disableAutofill?: boolean;
  onSubmitEditing?: () => void;
}
