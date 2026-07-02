// ORCH-1250 [business push-permission parity] — ADVERSARIAL regression.
//
// Attacks DIFFERENT failure modes than the happy-path test:
//   (A) DENIED-DEVICE TRUTH — when the OS reports permission DENIED, the tag is
//       written 'denied' (not silently 'granted'), so the dashboard audience
//       (push_os_permission != 'granted') can reach the real decliner and the
//       audience is never wrong-in-the-other-direction.
//   (B) NO SETTINGS-FALLBACK ON A GRANTED DEVICE — the service NEVER passes
//       fallbackToSettings=true, so the native "Open Settings" dialog can't be
//       triggered by the app on a device with notifications ON. Asserted by
//       reading the SOURCE (contract-level): `requestPermission(false)` and the
//       absence of `requestPermission(true)`.
//   (C) ONE-SHOT + canRequest GATE — the usePushPermissionMoment gate stamps the
//       one-shot flag and refuses to prompt when canRequestPushPermission() is
//       false (device already answered), so a decliner is never re-nagged.

import fs from "node:fs";
import path from "node:path";

process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID =
  process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID ?? "388b3efc-test-app-id";

// The service reads the RN global __DEV__; define it for the node test env.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

// react-native is Flow/ESM and not transformed under the node/ts-jest config;
// the service only uses Platform.OS, so mock it to a native (non-'web') OS.
jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

const tagCalls: Array<[string, string]> = [];
const requestPermissionCalls: unknown[] = [];
let permissionGranted = true;
let canRequest = true;

jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: () => {} },
    initialize: () => {},
    login: () => {},
    logout: () => {},
    User: {
      addTag: (k: string, v: string) => {
        tagCalls.push([k, v]);
      },
      pushSubscription: { optIn: async () => {} },
    },
    Notifications: {
      getPermissionAsync: async () => permissionGranted,
      canRequestPermission: async () => canRequest,
      requestPermission: async (fallbackToSettings: unknown) => {
        requestPermissionCalls.push(fallbackToSettings);
        return permissionGranted;
      },
      clearAll: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  },
}));

const TAG_KEY = "push_os_permission";
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function loadService(): typeof import("../oneSignalService") {
  jest.resetModules();
  tagCalls.length = 0;
  requestPermissionCalls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../oneSignalService");
}

describe("ORCH-1250 push-permission parity (adversarial)", () => {
  beforeEach(() => {
    permissionGranted = true;
    canRequest = true;
  });

  // (A) DENIED-DEVICE TRUTH
  test("denied OS permission → addTag(push_os_permission, 'denied')", async () => {
    const svc = loadService();
    permissionGranted = false;
    svc.initializeOneSignal();
    await flush();
    tagCalls.length = 0;
    await svc.syncPushPermissionTag();
    expect(tagCalls).toEqual([[TAG_KEY, "denied"]]);
    // Must NEVER masquerade a denied device as granted.
    expect(tagCalls).not.toContainEqual([TAG_KEY, "granted"]);
  });

  // (B) NO SETTINGS-FALLBACK PATH EXISTS IN SOURCE
  test("service source NEVER requests permission with fallbackToSettings=true", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../oneSignalService.ts"),
      "utf8",
    );
    // The ORCH-1244 parity arg: false. The banned (bug) arg: true.
    expect(src).toMatch(
      /Notifications\.requestPermission\(\s*false\s*\)/,
    );
    expect(src).not.toMatch(
      /Notifications\.requestPermission\(\s*true\s*\)/,
    );
  });

  // (B') RUNTIME PROOF — even when the OS reports GRANTED, the only arg the
  // service ever passes to requestPermission is false, so the native settings
  // dialog is unreachable from app code.
  test("granted device → requestPermission arg is false (no settings dialog reachable)", async () => {
    const svc = loadService();
    permissionGranted = true;
    svc.initializeOneSignal();
    await flush();
    await svc.requestPushPermission();
    expect(requestPermissionCalls.every((a) => a === false)).toBe(true);
    expect(requestPermissionCalls).not.toContain(true);
  });

  // (C) ONE-SHOT + canRequest GATE in the hook's source contract.
  test("hook gates the OS dialog behind canRequestPushPermission + one-shot flag", () => {
    const hookSrc = fs.readFileSync(
      path.resolve(__dirname, "../../hooks/usePushPermissionMoment.ts"),
      "utf8",
    );
    // Imports the new gate.
    expect(hookSrc).toMatch(/canRequestPushPermission/);
    // Refuses to prompt when the device already answered.
    expect(hookSrc).toMatch(
      /if\s*\(!\(await\s+canRequestPushPermission\(\)\)\)\s*return/,
    );
    // One-shot AsyncStorage guard is intact (key unchanged).
    expect(hookSrc).toMatch(/mingla-business\.pushPermissionPrompted\.v1/);
  });

  // (C') canRequestPushPermission itself self-guards on init.
  test("canRequestPushPermission returns false before init", async () => {
    const svc = loadService();
    // no init
    expect(await svc.canRequestPushPermission()).toBe(false);
  });
});
