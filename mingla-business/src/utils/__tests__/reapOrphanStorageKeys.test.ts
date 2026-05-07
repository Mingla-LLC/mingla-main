/**
 * reapOrphanStorageKeys.test.ts — Cycle 2 / ORCH-0743 (RC-2).
 *
 * Pins the orphan-key reaper's whitelist to the current persist version of
 * each store. Any future persist-key bump that forgets to update
 * KNOWN_MINGLA_KEYS in reapOrphanStorageKeys.ts will fail the first test
 * here on CI — preventing the latent destruction risk surfaced by ORCH-0744.
 *
 * Per SPEC_ORCH_0743 §3.5.2.
 */

import { reapOrphanStorageKeys } from "../reapOrphanStorageKeys";
import AsyncStorage from "@react-native-async-storage/async-storage";

// Define __DEV__ for the Node test environment (RN provides this at runtime).
// Set true so the dev-only console branches in the SUT execute (we suppress
// their output via console.error/warn spies below).
(globalThis as { __DEV__?: boolean }).__DEV__ = true;

// Suppress dev-only console output from the SUT during tests — they're
// expected log paths, not test failures.
const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

jest.mock("@react-native-async-storage/async-storage", () => ({
  getAllKeys: jest.fn(),
}));

// Sentry breadcrumb is fire-and-forget telemetry; mock to a no-op so we don't
// trigger production SDK calls during unit tests.
jest.mock("@sentry/react-native", () => ({
  addBreadcrumb: jest.fn(),
}));

describe("reapOrphanStorageKeys", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does NOT report the LIVE currentBrand v14 blob as orphan (RC-2 regression)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "mingla-business.currentBrand.v14",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).not.toContain("mingla-business.currentBrand.v14");
    expect(result.orphanCount).toBe(0);
  });

  it("DOES report a v13 leftover as orphan (predecessor key correctly flagged)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "mingla-business.currentBrand.v13",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).toContain("mingla-business.currentBrand.v13");
    expect(result.orphanCount).toBe(1);
  });

  it("ignores Supabase auth keys (sb-*-auth-token pattern)", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "sb-gqnoajqerqhnvulmnyvv-auth-token",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).not.toContain("sb-gqnoajqerqhnvulmnyvv-auth-token");
    expect(result.orphanCount).toBe(0);
  });

  it("ignores keys outside mingla-business namespace", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockResolvedValue([
      "expo.modules.fonts",
      "@some-third-party.cache",
    ]);
    const result = await reapOrphanStorageKeys();
    expect(result.orphanKeys).toEqual([]);
    expect(result.orphanCount).toBe(0);
  });

  it("returns safe defaults on AsyncStorage.getAllKeys() throw", async () => {
    (AsyncStorage.getAllKeys as jest.Mock).mockRejectedValue(
      new Error("native failure"),
    );
    const result = await reapOrphanStorageKeys();
    expect(result).toEqual({ orphanCount: 0, orphanKeys: [] });
  });
});
