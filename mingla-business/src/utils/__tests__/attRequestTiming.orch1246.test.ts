// ORCH-1246 (Apple 2.1) — ATT request-timing gate.
//
// iOS silently drops an ATT request issued while the app is not foreground
// `active`. shouldRequestAttNow decides request-now (active) vs defer-to-first-
// active (any other state). Fails-on-revert if the gate is removed.
import { describe, expect, test } from "@jest/globals";
import type { AppStateStatus } from "react-native";

import { shouldRequestAttNow } from "../attRequestTiming";

describe("shouldRequestAttNow (ORCH-1246 Apple 2.1)", () => {
  test("active → request NOW", () => {
    expect(shouldRequestAttNow("active")).toBe(true);
  });

  test("inactive → DEFER (wait for active)", () => {
    expect(shouldRequestAttNow("inactive")).toBe(false);
  });

  test("background → DEFER (wait for active)", () => {
    expect(shouldRequestAttNow("background")).toBe(false);
  });

  test("only the literal 'active' fires now — any other AppState defers", () => {
    const nonActive: AppStateStatus[] = [
      "inactive",
      "background",
      "unknown" as AppStateStatus,
      "extension" as AppStateStatus,
    ];
    for (const s of nonActive) {
      expect(shouldRequestAttNow(s)).toBe(false);
    }
  });
});
