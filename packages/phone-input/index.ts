/**
 * @mingla/phone-input — country-picker phone input shared between
 * mingla-business (public buyer form, ORCH-0847) and app-mobile (auth
 * onboarding).
 *
 * Host apps supply icon set + i18n labels via `iconRenderer` and `labels`
 * props. Package is pure presentational, no platform-host coupling.
 */

export { PhoneInput } from "./PhoneInput";
export type { PhoneInputProps } from "./PhoneInput";
export {
  CountryPickerModal,
  CountryPickerOverlay,
} from "./CountryPickerModal";
export {
  COUNTRIES,
  getCountryByCode,
  getDefaultCountryCode,
  formatPhoneDisplay,
} from "./countries";
export type {
  CountryData,
  IconRenderer,
  PhoneInputIconName,
  PhoneInputLabels,
  PhoneInputTheme,
} from "./types";
export { useKeyboard } from "./useKeyboard";
export type { KeyboardState } from "./useKeyboard";
