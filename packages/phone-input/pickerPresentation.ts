/**
 * pickerPresentation — pure decision for which country-picker surface PhoneInput
 * renders. Kept in its OWN module (no react-native imports) so it can be unit
 * tested in a plain node/ts-jest environment without mounting the RN tree.
 *
 * Per ORCH-1299 [rsvp-phone-picker-nested-modal].
 *
 * WHY this exists: the RSVP guest details form (name/email/phone) lives INSIDE
 * RsvpDetailsModal — a portal RN <Modal>. PhoneInput's default country picker is
 * CountryPickerModal, itself a nested RN <Modal>. On react-native-web a <Modal>
 * nested inside another <Modal> never opens/interacts → the picker freezes (the
 * ORCH-1299 dead-tap). The package already ships CountryPickerOverlay (an
 * in-place absolute/fixed-fill View) for EXACTLY the "inside an existing Modal"
 * case. This helper decides when to use it.
 *
 * Native is NEVER changed: a nested <Modal> works fine on native RN (the proven
 * AddFriendView pattern), so 'overlay' resolves to 'modal' off web — the overlay
 * variant is a WEB-only escape hatch.
 */

export type PhoneInputPickerPresentation = "modal" | "overlay";
export type WebOverlayFocusAction = "close" | "first" | "last" | null;

export function pickerCloseFocusTarget(
  countryWasSelected: boolean,
): "phone" | "country" {
  return countryWasSelected ? "phone" : "country";
}

export function shouldHapticCountrySelection(platform: string): boolean {
  return platform !== "web";
}

export function webOverlayFocusAction(input: {
  key: string;
  shiftKey: boolean;
  activeIndex: number;
  focusableCount: number;
}): WebOverlayFocusAction {
  if (input.key === "Escape") return "close";
  if (input.key !== "Tab" || input.focusableCount < 1) return null;
  if (input.shiftKey && input.activeIndex <= 0) return "last";
  if (!input.shiftKey &&
      (input.activeIndex < 0 || input.activeIndex >= input.focusableCount - 1)) {
    return "first";
  }
  return null;
}

/**
 * Resolve the effective picker surface.
 *
 * @param presentation caller's requested presentation (undefined = 'modal').
 * @param platformOS   `Platform.OS` value ('web' | 'ios' | 'android' | ...).
 * @returns 'overlay' ONLY when the caller asked for 'overlay' AND we are on web;
 *          'modal' otherwise (the unchanged default — keeps the buyer-checkout
 *          picker and every native surface exactly as before).
 */
export function resolvePickerPresentation(
  presentation: PhoneInputPickerPresentation | undefined,
  platformOS: string,
): PhoneInputPickerPresentation {
  if (presentation === "overlay" && platformOS === "web") {
    return "overlay";
  }
  return "modal";
}
