/**
 * countries — app-mobile thin re-export from `@mingla/phone-input`.
 *
 * Per ORCH-0847 Phase A — the country directory moved into the shared
 * package so mingla-business can reuse it for the public buyer form.
 * Existing callers (PhoneInput, CountryPickerModal, useOnboardingResume,
 * etc.) continue to import from this path.
 */

export {
  COUNTRIES,
  getCountryByCode,
  getDefaultCountryCode,
  formatPhoneDisplay,
} from "@mingla/phone-input";
