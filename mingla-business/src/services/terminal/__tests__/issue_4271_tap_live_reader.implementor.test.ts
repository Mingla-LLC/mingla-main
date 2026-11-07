/**
 * #4271 tap-live-reader — the simulated Tap to Pay reader follows the Stripe
 * key mode, not the build type.
 *
 * Found live on a real iPhone: a development build pointed at production uses
 * the live publishable key, but isTerminalSimulated() returned true whenever
 * __DEV__ was set, so Stripe Terminal connected the simulated reader ("tap to
 * simulate payment") and the server then failed the payment.
 *
 * fails-on-revert: restoring the __DEV__ rule (or dropping the live-key guard)
 * fails the live-key assertions here.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

const LIVE = "pk_live_51ExampleLiveKey";
const TEST = "pk_test_51ExampleTestKey";

let mockExtraKey: string | undefined;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: mockExtraKey } };
    },
  },
}));

import { isTerminalSimulated, resolveTerminalSimulated } from "../terminalConfig";
import { tapToPayConnectParams } from "../tapToPayConnectParams";

const g = globalThis as unknown as { __DEV__?: boolean };
const savedDev = g.__DEV__;
const savedFlag = process.env.EXPO_PUBLIC_TERMINAL_SIMULATED;
const savedKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

beforeEach(() => {
  g.__DEV__ = true;
  mockExtraKey = undefined;
  delete process.env.EXPO_PUBLIC_TERMINAL_SIMULATED;
  delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
});

afterEach(() => {
  g.__DEV__ = savedDev;
  if (savedFlag === undefined) delete process.env.EXPO_PUBLIC_TERMINAL_SIMULATED;
  else process.env.EXPO_PUBLIC_TERMINAL_SIMULATED = savedFlag;
  if (savedKey === undefined) delete process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  else process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = savedKey;
});

describe("resolveTerminalSimulated (pure)", () => {
  test("live key → real reader", () => {
    expect(resolveTerminalSimulated({ publishableKey: LIVE, simulatedFlag: undefined }, () => {})).toBe(false);
  });

  test("test key → simulated", () => {
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: undefined }, () => {})).toBe(true);
  });

  test("env=1 with a live key → real reader, and a warning is logged", () => {
    const warn = jest.fn();
    expect(resolveTerminalSimulated({ publishableKey: LIVE, simulatedFlag: "1" }, warn)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/live/);
  });

  test("env=1 with a test key → simulated", () => {
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: "1" }, () => {})).toBe(true);
  });

  test("missing key → real reader, with or without the env", () => {
    expect(resolveTerminalSimulated({ publishableKey: undefined, simulatedFlag: undefined }, () => {})).toBe(false);
    expect(resolveTerminalSimulated({ publishableKey: "  ", simulatedFlag: undefined }, () => {})).toBe(false);
    expect(resolveTerminalSimulated({ publishableKey: null, simulatedFlag: "1" }, () => {})).toBe(false);
  });
});

describe("isTerminalSimulated reads the app's real key source", () => {
  test("development build (__DEV__) with the live key from app config → real reader", () => {
    mockExtraKey = LIVE;
    expect(g.__DEV__).toBe(true);
    expect(isTerminalSimulated()).toBe(false);
    expect(tapToPayConnectParams("tml_loc", "Mingla", false).simulated).toBe(false);
  });

  test("development build with the live key from env → real reader", () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = LIVE;
    expect(isTerminalSimulated()).toBe(false);
  });

  test("env=1 with the live key → real reader", () => {
    mockExtraKey = LIVE;
    process.env.EXPO_PUBLIC_TERMINAL_SIMULATED = "1";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(isTerminalSimulated()).toBe(false);
    warn.mockRestore();
  });

  test("test key from app config → simulated", () => {
    mockExtraKey = TEST;
    expect(isTerminalSimulated()).toBe(true);
    expect(tapToPayConnectParams("tml_loc", "Mingla", true).simulated).toBe(true);
  });

  test("env=1 with the test key → simulated", () => {
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY = TEST;
    process.env.EXPO_PUBLIC_TERMINAL_SIMULATED = "1";
    expect(isTerminalSimulated()).toBe(true);
  });

  test("no key anywhere, __DEV__ on → real reader", () => {
    expect(isTerminalSimulated()).toBe(false);
  });
});
