/**
 * issue #4271 — Tap to Pay availability for the door sale sheet.
 *
 * [TRANSITIONAL] Minimal stub so the door sale sheet compiles and hides the
 * Tap to pay row. The Tap to Pay build (#4271 tap lane, owner of this file and
 * src/services/terminal/**) replaces it with the real device, country and
 * brand checks; same signature. Exit condition: that lane's file lands here.
 */

import type { Brand } from "../types/brand";

export type TapToPayUnavailableReason =
  | "web"
  | "sdk_missing"
  | "unsupported_device"
  | "no_brand"
  | "paystack"
  | "unsupported_country"
  | "no_card_payments";

export type TapToPayReason = "ok" | TapToPayUnavailableReason;

export interface TapToPayAvailability {
  available: boolean;
  needsSetup: boolean;
  reason: TapToPayReason;
}

export type TapToPayBrandFacts = Pick<
  Brand,
  "paymentProvider" | "stripeStatus" | "chargesEnabled" | "paystackSubaccountCode" | "payoutHoldCutoverAt"
>;

export interface TapToPayAvailabilityInput {
  brand: TapToPayBrandFacts | null | undefined;
  /** The sale's currency (the event's currency, else the brand default). */
  currency: string | null | undefined;
}

export const useTapToPayAvailability = (
  _input: TapToPayAvailabilityInput,
): TapToPayAvailability => ({
  available: false,
  needsSetup: false,
  reason: "sdk_missing",
});
