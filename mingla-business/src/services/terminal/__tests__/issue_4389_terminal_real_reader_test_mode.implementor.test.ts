/**
 * #4389 — Apple's Tap to Pay on iPhone review video needs Apple's REAL
 * "Hold Here to Pay" sheet while the app stays in Stripe test mode. A pk_test_
 * key always meant a simulated reader ("tap to simulate"), with no way out.
 *
 *   R1 EXPO_PUBLIC_TERMINAL_SIMULATED=0 + pk_test_ → real reader;
 *   R2 the default is unchanged: pk_test_ alone (or "1") → simulated;
 *   R3 a live key is never simulated, whatever the flag.
 *
 * FAILS ON REVERT: the `simulatedFlag !== "0"` branch removed → R1.
 */
import { describe, expect, test } from "@jest/globals";
import { resolveTerminalSimulated } from "../terminalConfig";

const TEST = "pk_test_51ExampleTestKey";
const LIVE = "pk_live_51ExampleLiveKey";
const quiet = (): void => undefined;

describe("#4389 — real Tap to Pay reader in Stripe test mode on request", () => {
  test("R1: flag 0 with a test key uses the real reader", () => {
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: "0" }, quiet)).toBe(false);
  });
  test("R2: default unchanged — a test key alone (or flag 1) is simulated", () => {
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: undefined }, quiet)).toBe(true);
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: "" }, quiet)).toBe(true);
    expect(resolveTerminalSimulated({ publishableKey: TEST, simulatedFlag: "1" }, quiet)).toBe(true);
  });
  test("R3: a live key is never simulated", () => {
    for (const flag of ["0", "1", undefined]) {
      expect(resolveTerminalSimulated({ publishableKey: LIVE, simulatedFlag: flag }, quiet)).toBe(false);
    }
  });
});
