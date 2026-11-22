// ORCH-1250 [business push-permission parity] — ADVERSARIAL regression,
// REWRITTEN by #4549 S4 / H8.
//
// Attacks:
//   (A) DENIED DEVICE — a phone whose OS permission is DENIED still never
//       writes the account-wide tag (S4: the tag was the last phone's view of
//       a many-phone account, so any write is wrong).
//   (B) NO SETTINGS-FALLBACK — the service NEVER passes fallbackToSettings=true
//       (ORCH-1244, unchanged).
//   (C) H8 ORDER — the permission hook waits for the SDK before it decides or
//       stamps the one-shot flag, and refuses to prompt a device that already
//       answered.
//   (D) SOURCE — no addTag of push_os_permission anywhere in the service.

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
const removeTagCalls: string[] = [];
const requestPermissionCalls: unknown[] = [];

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
}));
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
      removeTag: (k: string) => {
        removeTagCalls.push(k);
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
  removeTagCalls.length = 0;
  requestPermissionCalls.length = 0;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../oneSignalService");
}

describe("ORCH-1250 push-permission parity (adversarial)", () => {
  beforeEach(() => {
    permissionGranted = true;
    canRequest = true;
  });

  // (A) DENIED DEVICE
  test("denied OS permission → the tag is never written, only removed", async () => {
    const svc = loadService();
    permissionGranted = false;
    svc.initializeOneSignal();
    await flush();
    svc.loginToOneSignal("user-denied");
    await svc.requestPushPermission();
    await flush();
    expect(tagCalls).toEqual([]);
    expect(removeTagCalls).toEqual([TAG_KEY]);
  });

  // (D) SOURCE: no write path left
  test("service source never adds the push_os_permission tag", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../oneSignalService.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/addTag\(/);
    expect(src).toMatch(/removeTag\(PERMISSION_TAG_KEY\)/);
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

  // (C) H8 ORDER + canRequest GATE in the hook's source contract.
  test("hook waits for the SDK before deciding or stamping, and gates on canRequestPushPermission", () => {
    const hookSrc = fs.readFileSync(
      path.resolve(__dirname, "../../hooks/usePushPermissionMoment.ts"),
      "utf8",
    );
    const wait = hookSrc.indexOf("await whenOneSignalReady(");
    const gate = hookSrc.indexOf("await canRequestPushPermission()");
    const firstStamp = hookSrc.indexOf("AsyncStorage.setItem(PROMPTED_FLAG_KEY");
    expect(wait).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(wait);
    expect(firstStamp).toBeGreaterThan(gate);
    expect(hookSrc).toMatch(/mingla-business\.pushPermissionPrompted\.v1/);
  });

  // (C') canRequestPushPermission itself self-guards on init.
  test("canRequestPushPermission returns false before init", async () => {
    const svc = loadService();
    // no init
    expect(await svc.canRequestPushPermission()).toBe(false);
  });
});
