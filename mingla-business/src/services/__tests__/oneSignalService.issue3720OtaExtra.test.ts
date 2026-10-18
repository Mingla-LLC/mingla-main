/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * #3720 — the Host production OTA must initialize OneSignal from the served
 * Expo manifest even when no compile-time process.env substitution exists.
 *
 * INVARIANT(issue-3720-onesignal-ota-extra): Host push reads the public
 * OneSignal app id from Constants.expoConfig.extra before process.env, so a
 * valid served OTA manifest cannot boot with push silently disabled.
 */

delete process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockOtaAppId = "4505e476-0000-4000-8000-000000000000";
const initialize = jest.fn();

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: { EXPO_PUBLIC_ONESIGNAL_APP_ID: mockOtaAppId },
    },
  },
}));

jest.mock("react-native", () => ({ Platform: { OS: "ios" } }));

jest.mock("react-native-onesignal", () => ({
  LogLevel: { Verbose: 0, Warn: 4 },
  OneSignal: {
    Debug: { setLogLevel: jest.fn() },
    initialize,
    login: jest.fn(),
    logout: jest.fn(),
    User: {
      addTag: jest.fn(),
      pushSubscription: { optIn: jest.fn(async () => {}) },
    },
    Notifications: {
      getPermissionAsync: jest.fn(async () => true),
      canRequestPermission: jest.fn(async () => true),
      requestPermission: jest.fn(async () => true),
      clearAll: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    },
  },
}));

describe("#3720 OneSignal OTA manifest authority", () => {
  test("initializes from Constants.expoConfig.extra with process.env absent", () => {
    const service =
      require("../oneSignalService") as typeof import("../oneSignalService");

    service.initializeOneSignal();

    expect(initialize).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledWith(mockOtaAppId);
    expect(service.isOneSignalReady()).toBe(true);
  });
});
