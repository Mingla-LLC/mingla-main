/**
 * #4271 — may this phone offer "Tap to Pay" for this event's brand?
 *
 * Returns {available, needsSetup, reason}. Tap to Pay is hidden (never shown
 * greyed out) unless every one of these holds:
 *   - a native iOS/Android build (not web)
 *   - the binary includes the Stripe Terminal native module (an over-the-air
 *     update on an older binary has no module: hidden, never crashes)
 *   - the release gate: iPhone needs an entitled binary AND the server's yes;
 *     Android needs the server's yes (useTapToPayRelease). __DEV__ does not
 *     bypass this. A local Xcode development build made with
 *     MINGLA_TAP_TO_PAY_ENTITLEMENT=1 passes only because it is entitled and
 *     its brand is listed in the server's test brands (EAS builds never carry
 *     the entitlement; see app.config.js).
 *   - a phone that can take taps: iPhone on iOS 17+ (iOS 17 runs only on
 *     iPhone XS / XR and newer) or Android 13+; never an iPad
 *   - a Stripe brand (Paystack / Nigeria has no Stripe Terminal)
 *   - the sale's currency is GBP or USD (Tap to Pay countries Mingla supports:
 *     GB and US; Stripe Terminal charges in the account's own currency)
 *   - the brand can take card payments (Stripe charges enabled)
 * iOS 17.0 to 17.5 stays visible with reason "ios_update_required": Apple wants
 * an update message, not a hidden row. Below iOS 17 stays hidden: an iPhone X or
 * 8 can never reach 17.6, and the app can't tell it apart without a model library.
 * Stripe's own device check (attestation, NFC on, Apple entitlement) runs on the
 * setup screen; if it fails there the screen says "This phone can't take taps".
 */
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import type { Brand } from "../types/brand";
import { isBrandChargeReady } from "../utils/brandPayout";
import {
  readTapToPayWarmHint,
  subscribeTapToPayWarmHint,
} from "../services/terminal/tapToPaySetupStore";
import {
  tapToPayAcceptanceFor,
  useTapToPayTerminal,
  type TapToPayAcceptance,
} from "../services/terminal/tapToPaySession";
import { useTapToPayRelease } from "./useTapToPayRelease";
import { useTapToPayBrandFacts } from "./useTapToPayBrandFacts";
import {
  currentTapToPayDevice,
  isIosBelowTapFloor,
  isTapToPayDeviceSupported,
  type TapToPayDeviceFacts,
} from "../services/terminal/tapToPayDevice";

export {
  currentTapToPayDevice,
  isIosBelowTapFloor,
  isTapToPayDeviceSupported,
  MIN_ANDROID_API,
  MIN_IOS_FOR_TAP,
  MIN_IOS_MAJOR,
} from "../services/terminal/tapToPayDevice";
export type { TapToPayDeviceFacts } from "../services/terminal/tapToPayDevice";

export type TapToPayUnavailableReason =
  | "web"
  | "sdk_missing"
  | "not_released"
  | "unsupported_device"
  | "no_brand"
  | "paystack"
  | "unsupported_country"
  | "no_card_payments";

export type TapToPayReason = "ok" | "ios_update_required" | TapToPayUnavailableReason;

export interface TapToPayAvailability {
  available: boolean;
  needsSetup: boolean;
  reason: TapToPayReason;
}

export type TapToPayBrandFacts = Pick<
  Brand,
  "paymentProvider" | "stripeStatus" | "chargesEnabled" | "paystackSubaccountCode" | "payoutHoldCutoverAt"
> &
  Partial<Pick<Brand, "id">>;

export interface TapToPayAvailabilityInput {
  brand: TapToPayBrandFacts | null | undefined;
  /** The sale's currency (the event's currency, else the brand default). */
  currency: string | null | undefined;
  /** The server's answer for this brand and platform (useTapToPayRelease). */
  released: boolean;
}


/** ISO-2 country each supported Tap to Pay currency settles in. */
export const TAP_TO_PAY_COUNTRY_BY_CURRENCY: Readonly<Record<string, "GB" | "US">> = {
  GBP: "GB",
  USD: "US",
};


const unavailable = (reason: TapToPayUnavailableReason): TapToPayAvailability => ({
  available: false,
  needsSetup: false,
  reason,
});

/** Pure decision, unit-tested per reason. */
export const resolveTapToPayAvailability = (
  input: TapToPayAvailabilityInput | null,
  device: TapToPayDeviceFacts,
  setupComplete: boolean,
): TapToPayAvailability => {
  if (device.os !== "ios" && device.os !== "android") return unavailable("web");
  if (!device.nativeModulePresent) return unavailable("sdk_missing");
  const released = input?.released === true;
  if (device.os === "ios" ? !(device.entitled && released) : !released) {
    return unavailable("not_released");
  }
  if (!isTapToPayDeviceSupported(device)) return unavailable("unsupported_device");
  const brand = input?.brand ?? null;
  if (brand === null) return unavailable("no_brand");
  if (brand.paymentProvider === "paystack") return unavailable("paystack");
  const currency = (input?.currency ?? "").trim().toUpperCase();
  if (TAP_TO_PAY_COUNTRY_BY_CURRENCY[currency] === undefined) return unavailable("unsupported_country");
  if (!isBrandChargeReady(brand)) return unavailable("no_card_payments");
  if (isIosBelowTapFloor(device.os, device.version)) {
    return { available: true, needsSetup: false, reason: "ios_update_required" };
  }
  return { available: true, needsSetup: !setupComplete, reason: "ok" };
};

/**
 * An event's server detail carries a slim brand (id, name) with no payment
 * facts; read that way every brand looks unable to take cards and Tap to Pay
 * never shows at the door (#4271, measured on a real iPhone). True when the
 * object carries the facts isBrandChargeReady reads.
 */
export const hasTapToPayCardFacts = (brand: TapToPayBrandFacts): boolean =>
  brand.paymentProvider !== undefined ||
  brand.stripeStatus !== undefined ||
  brand.chargesEnabled !== undefined;

/**
 * iPhone: Apple's answer decides. The hint only stands in until Apple has been
 * asked, and it can never overrule "not accepted". Android has no Apple terms, so
 * the hint is its setup-done flag.
 */
export const tapToPayNeedsSetup = (
  os: string,
  acceptance: TapToPayAcceptance,
  hint: boolean,
): boolean =>
  os === "ios" ? acceptance === "not_accepted" || (acceptance === "unknown" && !hint) : !hint;


export const useTapToPayAvailability = (
  input: Omit<TapToPayAvailabilityInput, "released"> | null,
): TapToPayAvailability => {
  const givenBrand = input?.brand ?? null;
  const brandId = givenBrand?.id ?? null;
  // A slim brand is completed from the brand's own record (useBrand); a brand
  // that already carries its card facts is used as is and fetches nothing.
  const slimBrandId = givenBrand !== null && !hasTapToPayCardFacts(givenBrand) ? brandId : null;
  const fullBrand = useTapToPayBrandFacts(slimBrandId);
  const [hint, setHint] = useState<boolean>(false);

  useEffect(() => {
    setHint(false);
    if (brandId === null) return undefined;
    let alive = true;
    void readTapToPayWarmHint(brandId).then((value) => {
      if (alive) setHint(value);
    });
    const unsubscribe = subscribeTapToPayWarmHint((changedBrandId, value) => {
      if (alive && changedBrandId === brandId) setHint(value);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [brandId]);

  const session = useTapToPayTerminal();
  const acceptance = tapToPayAcceptanceFor(session, brandId);
  const needsSetup = tapToPayNeedsSetup(Platform.OS, acceptance, hint);

  const brand = slimBrandId !== null ? fullBrand ?? givenBrand : givenBrand;
  const currency = input?.currency ?? null;
  const hasBrand = brand !== null;
  const { live } = useTapToPayRelease(brand?.id ?? null);
  return useMemo(
    () => resolveTapToPayAvailability({ brand, currency, released: live }, currentTapToPayDevice(), !needsSetup),
    // Brand facts that matter are listed so a fresh brand object does not recompute needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      brand?.paymentProvider,
      brand?.stripeStatus,
      brand?.chargesEnabled,
      brand?.paystackSubaccountCode,
      brand?.payoutHoldCutoverAt,
      hasBrand,
      currency,
      live,
      needsSetup,
    ],
  );
};
