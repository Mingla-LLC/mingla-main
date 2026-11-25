/**
 * #4490 spec 08 O3 part B — phones stay portrait at runtime, tablets rotate,
 * an older binary without expo-screen-orientation is untouched.
 *
 * fails-on-revert: change the 600 dp limit, lock tablets, import the
 * expo-screen-orientation package, or drift from the package's OrientationLock
 * numbers and a test here fails.
 */
import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

jest.mock("react-native", () => ({
  Platform: { OS: "android", select: (o: Record<string, unknown>) => o.android ?? o.default },
  StyleSheet: { hairlineWidth: 1, create: <T,>(styles: T): T => styles },
  Dimensions: { get: () => ({ width: 390, height: 844 }), addEventListener: () => ({ remove: () => undefined }) },
}));

let nativeModules: Record<string, unknown> = {};
jest.mock(
  "expo",
  () => ({ requireOptionalNativeModule: (name: string) => nativeModules[name] ?? null }),
  { virtual: true },
);

// eslint-disable-next-line import/first
import {
  applyPortraitLock,
  loadScreenOrientation,
  ORIENTATION_LOCK_DEFAULT,
  ORIENTATION_LOCK_PORTRAIT_UP,
  type ScreenOrientationModule,
} from "../../utils/portraitLock";
// eslint-disable-next-line import/first
import { shouldLockPortrait } from "../../utils/deviceOrientation";

const moduleWith = (): ScreenOrientationModule & { lockAsync: jest.Mock } => ({
  lockAsync: jest.fn((_lock: number) => Promise.resolve()),
}) as ScreenOrientationModule & { lockAsync: jest.Mock };

describe("08-O3B portrait lock decision (shortest screen side)", () => {
  test.each([
    [599, 1000, true],
    [1000, 599, true],
    [390, 844, true],
    [600, 960, false],
    [960, 600, false],
    [768, 1024, false],
    [1024, 768, false],
  ])("%i x %i locks portrait: %s", (width, height, lock) => {
    expect(shouldLockPortrait({ width, height })).toBe(lock);
  });

  test("599 locks to PORTRAIT_UP on Android and iOS", async () => {
    for (const platform of ["android", "ios"]) {
      const mod = moduleWith();
      const out = await applyPortraitLock(platform, { width: 599, height: 900 }, null, () => mod);
      expect(out).toEqual({ result: "locked", locked: true });
      expect(mod.lockAsync).toHaveBeenCalledWith(ORIENTATION_LOCK_PORTRAIT_UP);
    }
  });

  test("600 and 768 are tablets: never locked, module not even asked", async () => {
    for (const screen of [{ width: 600, height: 960 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
      const load = jest.fn(moduleWith);
      const out = await applyPortraitLock("android", screen, null, load);
      expect(out.result).toBe("unchanged");
      expect(load).not.toHaveBeenCalled();
    }
  });

  test("a foldable opening to tablet size is unlocked; an unchanged phone is not re-locked", async () => {
    const mod = moduleWith();
    const opened = await applyPortraitLock("android", { width: 673, height: 841 }, true, () => mod);
    expect(opened).toEqual({ result: "unlocked", locked: false });
    expect(mod.lockAsync).toHaveBeenCalledWith(ORIENTATION_LOCK_DEFAULT);
    const again = await applyPortraitLock("android", { width: 390, height: 844 }, true, () => mod);
    expect(again.result).toBe("unchanged");
  });

  test("module ABSENT (older binary): no throw, nothing locked", async () => {
    await expect(applyPortraitLock("android", { width: 390, height: 844 }, null, () => null)).resolves.toEqual({
      result: "unavailable",
      locked: null,
    });
  });

  test("the real loader: absent module -> null (older binary); present -> that module", async () => {
    nativeModules = {};
    expect(loadScreenOrientation()).toBeNull();
    await expect(applyPortraitLock("ios", { width: 390, height: 844 }, null)).resolves.toEqual({ result: "unavailable", locked: null });
    const mod = moduleWith();
    nativeModules = { ExpoScreenOrientation: mod };
    expect(loadScreenOrientation()).toBe(mod);
    await expect(applyPortraitLock("ios", { width: 390, height: 844 }, null)).resolves.toEqual({ result: "locked", locked: true });
    expect(mod.lockAsync).toHaveBeenCalledWith(ORIENTATION_LOCK_PORTRAIT_UP);
    nativeModules = {};
  });

  test("a lock that fails is reported, not thrown", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = { lockAsync: jest.fn(() => Promise.reject(new Error("no activity"))) };
    await expect(applyPortraitLock("ios", { width: 390, height: 844 }, null, () => mod)).resolves.toEqual({
      result: "unavailable",
      locked: null,
    });
    warn.mockRestore();
  });

  test("web does nothing", async () => {
    const load = jest.fn(moduleWith);
    expect((await applyPortraitLock("web", { width: 390, height: 844 }, null, load)).result).toBe("unavailable");
    expect(load).not.toHaveBeenCalled();
  });

  test("lock numbers match the installed expo-screen-orientation OrientationLock", () => {
    const types = fs.readFileSync(
      path.join(__dirname, "../../../node_modules/expo-screen-orientation/build/ScreenOrientation.types.js"),
      "utf8",
    );
    expect(types).toContain(`OrientationLock["PORTRAIT_UP"] = ${ORIENTATION_LOCK_PORTRAIT_UP}`);
    expect(types).toContain(`OrientationLock["DEFAULT"] = ${ORIENTATION_LOCK_DEFAULT}`);
  });

  test("source: the package is never imported, only the native module by name", () => {
    const src = ["../usePhonePortraitLock.ts", "../usePhonePortraitLock.web.ts", "../../utils/portraitLock.ts"]
      .map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");
    expect(src).not.toMatch(/from ["']expo-screen-orientation["']|require\(["']expo-screen-orientation["']\)/);
    expect(src).toContain('requireOptionalNativeModule("ExpoScreenOrientation")');
    const layout = fs.readFileSync(path.join(__dirname, "../../../app/_layout.tsx"), "utf8");
    expect(layout).toContain("usePhonePortraitLock();");
  });
});
