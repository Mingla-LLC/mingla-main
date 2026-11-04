/**
 * #4271 — may this phone offer "Tap to pay" for this event's brand?
 *
 * Returns {available, needsSetup, reason}. Tap to Pay is hidden (never shown
 * greyed out) unless every one of these holds:
 *   - a native iOS/Android build (not web)
 *   - the binary includes the Stripe Terminal native module (an over-the-air
 *     update on an older binary has no module: hidden, never crashes)
 *   - a phone that can take taps: iPhone on iOS 17+ (iOS 17 runs only on
 *     iPhone XS / XR and newer) or Android 13+; never an iPad
 *   - a Stripe brand (Paystack / Nigeria has no Stripe Terminal)
 *   - the sale's currency is GBP or USD (Tap to Pay countries Mingla supports:
 *     GB and US; Stripe Terminal charges in the account's own currency)
 *   - the brand can take card payments (Stripe charges enabled)
 * Stripe's own device check (attestation, NFC on, Apple entitlement) runs on the
 * setup screen; if it fails there the screen says "This phone can't take taps".
 */
import { useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import type { Brand } from "../types/brand";
import { isBrandChargeReady } from "../utils/brandPayout";
import { isTerminalNativeModulePresent } from "../services/terminal/terminalSdk";
import {
  readTapToPaySetupComplete,
  subscribeTapToPaySetup,
} from "../services/terminal/tapToPaySetupStore";

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

export interface TapToPayDeviceFacts {
  os: string;
  /** iOS: "17.4"-style string; Android: API level number. */
  version: string | number;
  isPad: boolean;
  nativeModulePresent: boolean;
}

/** ISO-2 country each supported Tap to Pay currency settles in. */
export const TAP_TO_PAY_COUNTRY_BY_CURRENCY: Readonly<Record<string, "GB" | "US">> = {
  GBP: "GB",
  USD: "US",
};

export const MIN_IOS_MAJOR = 17;
export const MIN_ANDROID_API = 33;

const majorVersion = (version: string | number): number => {
  if (typeof version === "number") return version;
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
};

export const isTapToPayDeviceSupported = (device: TapToPayDeviceFacts): boolean => {
  if (device.os === "ios") return !device.isPad && majorVersion(device.version) >= MIN_IOS_MAJOR;
  if (device.os === "android") return majorVersion(device.version) >= MIN_ANDROID_API;
  return false;
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
  if (!isTapToPayDeviceSupported(device)) return unavailable("unsupported_device");
  const brand = input?.brand ?? null;
  if (brand === null) return unavailable("no_brand");
  if (brand.paymentProvider === "paystack") return unavailable("paystack");
  const currency = (input?.currency ?? "").trim().toUpperCase();
  if (TAP_TO_PAY_COUNTRY_BY_CURRENCY[currency] === undefined) return unavailable("unsupported_country");
  if (!isBrandChargeReady(brand)) return unavailable("no_card_payments");
  return { available: true, needsSetup: !setupComplete, reason: "ok" };
};

export const currentTapToPayDevice = (): TapToPayDeviceFacts => ({
  os: Platform.OS,
  version: Platform.Version,
  isPad: Platform.OS === "ios" && (Platform as { isPad?: boolean }).isPad === true,
  nativeModulePresent: isTerminalNativeModulePresent(),
});

export const useTapToPayAvailability = (
  input: TapToPayAvailabilityInput | null,
): TapToPayAvailability => {
  const [setupComplete, setSetupComplete] = useState<boolean>(false);

  useEffect(() => {
    let alive = true;
    void readTapToPaySetupComplete().then((complete) => {
      if (alive) setSetupComplete(complete);
    });
    const unsubscribe = subscribeTapToPaySetup((complete) => {
      if (alive) setSetupComplete(complete);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const brand = input?.brand ?? null;
  const currency = input?.currency ?? null;
  const hasBrand = brand !== null;
  return useMemo(
    () => resolveTapToPayAvailability({ brand, currency }, currentTapToPayDevice(), setupComplete),
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
      setupComplete,
    ],
  );
};
