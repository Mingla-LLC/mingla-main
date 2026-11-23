/**
 * #4490 spec 08 §3 O2 + §12 item 3 — when the payment sheet offers Tap to pay.
 *
 * Offered only when ALL hold:
 *   1. the brand may tap: a Stripe brand paid out in GB or the US
 *      (tapToPayBrandEligible; never Paystack, so never Nigeria);
 *   2. the release switch is on for this platform (biz_tap_to_pay_release);
 *   3. a phone, not web;
 *   4. a supported device (iPhone on iOS 17.6 or later, never iPad; Android
 *      API 33 or later) with the Terminal module in this build;
 *   5. on iPhone, a build that carries the Tap to Pay entitlement;
 *   6. the acting member may sell here, and the server agrees (catalog
 *      `tapAvailable`: brand country, provider and release re-checked there).
 * Hidden when the brand, the release, the platform or the seller rule it out
 * (Nigeria never sees it); shown disabled with the reason when only this phone
 * or this build cannot do it. Otherwise the sheet leads with Scan to pay.
 *
 * Pure: every fact is passed in (tested as a matrix).
 */
import { tapToPayBrandEligible } from "../../../utils/tapToPayBrandEligible";
import {
  isIosBelowTapFloor,
  isTapToPayDeviceSupported,
  type TapToPayDeviceFacts,
} from "../../../services/terminal/tapToPayDevice";

export type TillTapOffer =
  | { kind: "hidden" }
  | { kind: "disabled"; reason: "unsupported_device" | "ios_update" | "needs_latest_app" }
  | { kind: "ready" };

export interface TillTapFacts {
  /** Null when this login cannot read the brand (the server decides). */
  brand: { paymentProvider?: string | null; defaultCurrency?: string | null; payoutCountry?: string | null } | null;
  /** biz_tap_to_pay_release for this brand. */
  release: { iphone: boolean; android: boolean } | null;
  device: TapToPayDeviceFacts;
  canSell: boolean;
  /** venue-till catalog `tapAvailable` (server half). */
  serverAllows: boolean;
}

export const tillTapOffer = (facts: TillTapFacts): TillTapOffer => {
  // A brand this login cannot read (a venue-staff seller) is judged by the
  // server's answer alone, which re-checks provider, country and release.
  if (!facts.canSell || (facts.brand !== null && !tapToPayBrandEligible(facts.brand))) return { kind: "hidden" };
  const os = facts.device.os;
  if (os !== "ios" && os !== "android") return { kind: "hidden" };
  const released = os === "ios" ? facts.release?.iphone === true : facts.release?.android === true;
  if (!released || !facts.serverAllows) return { kind: "hidden" };
  if (os === "ios" && facts.device.isPad) return { kind: "disabled", reason: "unsupported_device" };
  if (isIosBelowTapFloor(os, facts.device.version)) return { kind: "disabled", reason: "ios_update" };
  if (!isTapToPayDeviceSupported(facts.device)) return { kind: "disabled", reason: "unsupported_device" };
  if (!facts.device.nativeModulePresent || (os === "ios" && !facts.device.entitled)) {
    return { kind: "disabled", reason: "needs_latest_app" };
  }
  return { kind: "ready" };
};
