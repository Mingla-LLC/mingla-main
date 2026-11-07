/**
 * #4271 — the phone facts Tap to Pay depends on, with no storage, session or SDK
 * state. Settings rows, the Brand payments and onboarding screens and the
 * availability hook all read this, so a screen that only needs "could this phone
 * take taps?" never loads the Tap to Pay setup store (AsyncStorage) or the
 * Terminal session and flow at module scope.
 */
import { Platform } from "react-native";

import { isTapToPayIphoneEntitled } from "./howToTap";
import { isTerminalNativeModulePresent } from "./terminalSdk";

export interface TapToPayDeviceFacts {
  os: string;
  /** iOS: "17.4"-style string; Android: API level number. */
  version: string | number;
  isPad: boolean;
  nativeModulePresent: boolean;
  /** iPhone: the binary carries Apple's entitlement (Info.plist). Unused on Android. */
  entitled: boolean;
}

export const MIN_IOS_MAJOR = 17;
export const MIN_IOS_FOR_TAP = { major: 17, minor: 6 } as const;
export const MIN_ANDROID_API = 33;

const majorVersion = (version: string | number): number => {
  if (typeof version === "number") return version;
  const major = Number.parseInt(String(version).split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? 0 : major;
};

const minorVersion = (version: string | number): number => {
  if (typeof version === "number") return 0;
  const minor = Number.parseInt(String(version).split(".")[1] ?? "", 10);
  return Number.isNaN(minor) ? 0 : minor;
};

/** iPhone that runs Tap to Pay only after an iOS update (17.0 to 17.5). */
export const isIosBelowTapFloor = (os: string, version: string | number): boolean => {
  if (os !== "ios") return false;
  const major = majorVersion(version);
  return (
    major >= MIN_IOS_MAJOR &&
    (major < MIN_IOS_FOR_TAP.major ||
      (major === MIN_IOS_FOR_TAP.major && minorVersion(version) < MIN_IOS_FOR_TAP.minor))
  );
};

export const isTapToPayDeviceSupported = (device: TapToPayDeviceFacts): boolean => {
  if (device.os === "ios") return !device.isPad && majorVersion(device.version) >= MIN_IOS_MAJOR;
  if (device.os === "android") return majorVersion(device.version) >= MIN_ANDROID_API;
  return false;
};

export const currentTapToPayDevice = (): TapToPayDeviceFacts => ({
  os: Platform.OS,
  version: Platform.Version,
  isPad: Platform.OS === "ios" && (Platform as { isPad?: boolean }).isPad === true,
  nativeModulePresent: isTerminalNativeModulePresent(),
  entitled: isTapToPayIphoneEntitled(),
});
