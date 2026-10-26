/**
 * #4111 — the shared Business PhoneField (country picker, smart entry) dressed
 * in the brand's palette, for the brand page foot ("Mobile (optional)") and the
 * message sheet ("Phone (optional)"). It reports the parsed state upward; the
 * shared components never parse numbers themselves.
 */
import React, { useEffect, useMemo } from "react";

import type { PhoneInputTheme } from "@mingla/phone-input";
import type {
  EnquiryPhoneFieldArgs,
  EnquiryPhoneState,
} from "@mingla/brand-rendering/enquiry/BrandMessageSheet";

import { PhoneField, usePhoneEntry } from "../ui/PhoneField";

const brandPhoneTheme = (palette: EnquiryPhoneFieldArgs["palette"]): PhoneInputTheme => ({
  backgroundPrimary: palette.card,
  textPrimary: palette.primaryText,
  textTertiary: palette.tertiaryText,
  borderDefault: palette.panelBorder,
  borderFocused: palette.accent,
  borderError: "#ef4444",
  searchBackground: palette.page,
  rowPressedBackground: palette.accentWash,
  divider: palette.panelBorder,
  accessoryBackground: palette.card,
  accessoryBorder: palette.panelBorder,
  accent: palette.accent,
  errorText: "#ef4444",
});

export interface EnquiryPhoneFieldProps extends EnquiryPhoneFieldArgs {
  /** The brand's (or venue's) country first, so the picker starts there. */
  startCountries: ReadonlyArray<string | null | undefined>;
}

export function EnquiryPhoneField({
  testID,
  accessibilityLabel,
  placeholder,
  palette,
  onChange,
  startCountries,
}: EnquiryPhoneFieldProps): React.ReactElement {
  const entry = usePhoneEntry({ startCountries, mode: "mobile" });
  const theme = useMemo(() => brandPhoneTheme(palette), [palette]);
  const state: EnquiryPhoneState = { e164: entry.e164, isEmpty: entry.isEmpty, valid: entry.e164 !== null };
  useEffect(() => {
    onChange(state);
    // Report only when the parsed state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.e164, state.isEmpty, state.valid]);
  return (
    <PhoneField
      entry={entry}
      accessibilityLabel={accessibilityLabel}
      placeholder={placeholder}
      theme={theme}
      actionColor={palette.accent}
      testID={testID}
    />
  );
}

/** A `renderPhoneField` for the shared foot and sheet. */
export const makeEnquiryPhoneRenderer = (
  startCountries: ReadonlyArray<string | null | undefined>,
): ((args: EnquiryPhoneFieldArgs) => React.ReactElement) =>
  function renderEnquiryPhoneField(args: EnquiryPhoneFieldArgs): React.ReactElement {
    return <EnquiryPhoneField {...args} startCountries={startCountries} />;
  };
