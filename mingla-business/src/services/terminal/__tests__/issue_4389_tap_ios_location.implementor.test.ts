/**
 * #4389 — the iPhone location read behind Tap to Pay setup's pre-alert.
 *   S1 the native answer maps to granted / denied / not_determined;
 *   S2 a binary without the functions (or Android) is "unavailable" and keeps
 *      the old behaviour (a sale may start);
 *   S3 a sale may start only when granted or unavailable.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

let mockNative: Record<string, unknown> | null = null;
let mockOs = "ios";
jest.mock("react-native", () => ({ Platform: { get OS() { return mockOs; } } }));
jest.mock("expo", () => ({ requireOptionalNativeModule: () => mockNative }));

import { requestTapLocation, tapLocationReadyForSale, tapLocationStatus } from "../tapToPayIosLocation";

beforeEach(() => {
  mockOs = "ios";
  mockNative = null;
});

describe("#4389 — iPhone location for Tap to Pay", () => {
  test("S1: the native answer maps through", async () => {
    for (const v of ["granted", "denied", "not_determined"] as const) {
      mockNative = { locationAuthorization: () => v, requestLocationWhenInUse: async () => v };
      expect(tapLocationStatus()).toBe(v);
      await expect(requestTapLocation()).resolves.toBe(v);
    }
  });

  test("S2: no functions, or Android → unavailable", async () => {
    mockNative = {};
    expect(tapLocationStatus()).toBe("unavailable");
    await expect(requestTapLocation()).resolves.toBe("unavailable");
    mockOs = "android";
    mockNative = { locationAuthorization: () => "denied" };
    expect(tapLocationStatus()).toBe("unavailable");
  });

  test("S3: a sale may start only when granted or unavailable", () => {
    expect(tapLocationReadyForSale("granted")).toBe(true);
    expect(tapLocationReadyForSale("unavailable")).toBe(true);
    expect(tapLocationReadyForSale("not_determined")).toBe(false);
    expect(tapLocationReadyForSale("denied")).toBe(false);
  });
});
