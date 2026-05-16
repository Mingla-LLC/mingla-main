/**
 * Public types for @mingla/phone-input.
 *
 * Per ORCH-0847 Phase A — extraction from app-mobile/src/components/onboarding/
 * + app-mobile/src/types/onboarding. CountryData shape preserved verbatim so
 * existing consumers (auth onboarding, AddFriendView, etc.) keep working through
 * the thin re-export wrappers at the original paths.
 */

import type * as React from "react";

export interface CountryData {
  /** ISO 3166-1 alpha-2 country code (e.g., 'US'). */
  code: string;
  /** Display name (e.g., 'United States'). */
  name: string;
  /** ITU-T E.164 dial code with leading '+' (e.g., '+1'). */
  dialCode: string;
  /** Emoji flag (regional indicator pair). */
  flag: string;
}

/**
 * Icon names the package needs the host app to provide via IconRenderer.
 *
 * Host apps map these semantic names to their own icon set names
 * (e.g., 'chevronDown' → 'chevron-down' in app-mobile's icon set, or
 * 'ChevronDown' in mingla-business's icon set).
 */
export type PhoneInputIconName =
  | "chevronDown"
  | "checkmark"
  | "close"
  | "search";

/**
 * Icon renderer the host app supplies. Receives a semantic icon name + render
 * hints and returns a React element. Keeps the package free of any icon-set
 * dependency.
 */
export type IconRenderer = (
  name: PhoneInputIconName,
  props: { size: number; color: string },
) => React.ReactElement;

/**
 * Localized strings the PhoneInput + CountryPickerModal display.
 * Host app passes its translated values (consumer: i18next; business: literals).
 */
export interface PhoneInputLabels {
  /** Placeholder shown inside the phone-number TextInput. */
  phonePlaceholder: string;
  /** Accessibility label for the country code picker button.
   *  Receives the currently-selected country name (or ISO code as fallback). */
  countryButtonAccessibilityLabel: (countryName: string) => string;
  /** Accessibility label for the phone number input. */
  phoneInputAccessibilityLabel: string;
  /** Done button label on the iOS InputAccessoryView toolbar. */
  doneButton: string;
  /** Header title shown in the country picker modal. */
  pickerTitle: string;
  /** Placeholder for the search input in the country picker. */
  pickerSearchPlaceholder: string;
  /** Accessibility label for the close (×) button on the country picker. */
  pickerCloseAccessibilityLabel: string;
}

/**
 * Color tokens for PhoneInput + CountryPickerModal. Defaults are LIGHT-mode
 * (matching app-mobile auth onboarding). Host apps render the field on a
 * dark surface (e.g., mingla-business buyer.tsx) can override individual
 * keys to keep contrast readable.
 *
 * Per ORCH-0847 Phase B — added so the mingla-business public buyer form's
 * dark theme renders correctly without forking the component.
 */
export interface PhoneInputTheme {
  /** Background color for the input container + picker modal surface. */
  backgroundPrimary?: string;
  /** Body text and selected dial-code color. */
  textPrimary?: string;
  /** Secondary / placeholder / icon color. */
  textTertiary?: string;
  /** Container border color when unfocused. */
  borderDefault?: string;
  /** Container border color when the text input is focused. */
  borderFocused?: string;
  /** Container border color when an error is present. */
  borderError?: string;
  /** Background of the search input pill in the country picker. */
  searchBackground?: string;
  /** Background tint used for iOS pressed-row state in the country picker. */
  rowPressedBackground?: string;
  /** Internal divider line (between country button + text input + between picker rows). */
  divider?: string;
  /** Accessory toolbar (iOS "Done") background. */
  accessoryBackground?: string;
  /** Accessory toolbar (iOS "Done") top border. */
  accessoryBorder?: string;
  /** Color of the iOS "Done" button text + focused border. */
  accent?: string;
  /** Error text color (used for inline error message below the field). */
  errorText?: string;
}
