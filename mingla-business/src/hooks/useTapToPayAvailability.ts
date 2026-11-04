/**
 * issue #4271 — Tap to Pay availability for the door sale sheet.
 *
 * [TRANSITIONAL] Minimal stub so the door sale sheet compiles and hides the
 * Tap to pay row. The Tap to Pay build (#4271 tap lane, owner of this file and
 * src/services/terminal/**) replaces it with the real device, country and
 * brand checks. Exit condition: that lane lands its implementation here.
 */

export type TapToPayUnavailableReason =
  | "not_built"
  | "unsupported_country"
  | "unsupported_device"
  | "card_payments_off";

export interface TapToPayAvailability {
  available: boolean;
  needsSetup: boolean;
  reason: TapToPayUnavailableReason | null;
}

export const useTapToPayAvailability = (
  _eventId: string | null,
): TapToPayAvailability => ({
  available: false,
  needsSetup: false,
  reason: "not_built",
});
