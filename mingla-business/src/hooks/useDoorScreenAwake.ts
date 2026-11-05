/**
 * issue #4271 (design H3) — while a pay code is showing, the phone stays awake at
 * full brightness so a guest can scan it; leaving restores the phone's settings.
 *
 * Only what the installed binary has: each native module is asked for by name and
 * a binary without it just goes without. expo-keep-awake ships inside `expo`, and
 * expo-brightness is a declared dependency, so a binary built from this tree has
 * both; an older binary that receives this code over the air keeps the screen as
 * it was. On web the browser's wake lock does the job.
 */
import { useEffect } from "react";
import { Platform } from "react-native";

const TAG = "door-pay-code";

interface KeepAwakeModule {
  activate: (tag: string) => Promise<void>;
  deactivate: (tag: string) => Promise<void>;
}
interface BrightnessModule {
  getBrightnessAsync: () => Promise<number>;
  setBrightnessAsync: (value: number) => Promise<void>;
}
interface WakeLockHandle {
  release: () => Promise<void>;
}

const optionalModule = <T>(name: string): T | null => {
  try {
    const { requireOptionalNativeModule } = require("expo") as {
      requireOptionalNativeModule: (moduleName: string) => T | null;
    };
    return requireOptionalNativeModule(name);
  } catch {
    return null;
  }
};

const warn = (what: string, error: unknown): void => {
  console.warn(`[door-pay] ${what}`, error instanceof Error ? error.message : "unknown");
};

const holdWeb = (): (() => void) => {
  const nav = (globalThis as { navigator?: { wakeLock?: { request: (type: "screen") => Promise<WakeLockHandle> } } })
    .navigator;
  if (nav?.wakeLock === undefined) return () => undefined;
  let released = false;
  let handle: WakeLockHandle | null = null;
  nav.wakeLock
    .request("screen")
    .then((lock) => {
      if (released) void lock.release();
      else handle = lock;
    })
    .catch((error: unknown) => warn("wake lock refused", error));
  return () => {
    released = true;
    if (handle !== null) void handle.release();
  };
};

const holdNative = (): (() => void) => {
  const keepAwake = optionalModule<KeepAwakeModule>("ExpoKeepAwake");
  const brightness = optionalModule<BrightnessModule>("ExpoBrightness");
  keepAwake?.activate(TAG).catch((error: unknown) => warn("keep awake failed", error));
  let previous: number | null = null;
  let released = false;
  brightness
    ?.getBrightnessAsync()
    .then((value) => {
      if (released) return undefined;
      previous = value;
      return brightness.setBrightnessAsync(1);
    })
    .catch((error: unknown) => warn("brightness failed", error));
  return () => {
    released = true;
    keepAwake?.deactivate(TAG).catch((error: unknown) => warn("keep awake release failed", error));
    if (previous !== null) {
      brightness?.setBrightnessAsync(previous).catch((error: unknown) => warn("brightness restore failed", error));
    }
  };
};

export const useDoorScreenAwake = (active: boolean): void => {
  useEffect(() => {
    if (!active) return undefined;
    return Platform.OS === "web" ? holdWeb() : holdNative();
  }, [active]);
};
