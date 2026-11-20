/**
 * N135 (#4490) — the Organiser Terms sheet at the publish door closes on
 * Escape / a tap outside (the Sheet's onClose) without accepting; payout
 * onboarding (no onDismiss) stays non-dismissible.
 *
 * Fails-on-revert: going back to onClose={() => undefined} fails D-1.
 */
import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sheetCloses: Array<() => void> = [];
jest.mock("../../ui/Sheet", () => ({
  Sheet: (p: { onClose: () => void; children?: unknown }) => {
    sheetCloses.push(p.onClose);
    return null;
  },
}));
jest.mock("../../ui/Spinner", () => ({ Spinner: (): null => null }));
jest.mock("expo-haptics", () => ({ notificationAsync: jest.fn(), NotificationFeedbackType: { Success: "s" } }));
const accepted = { data: null, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock("../../../hooks/useMinglaToSAcceptance", () => ({
  useMinglaToSAcceptance: () => accepted,
  useAcceptMinglaToS: () => ({ isPending: false, mutate: jest.fn() }),
  isCurrentMinglaToSAccepted: () => false,
  CURRENT_MINGLA_TOS_VERSION: "test",
  ORGANISER_TERMS_URL: "https://example.test/terms",
}));

import { MinglaToSAcceptanceGate } from "../MinglaToSAcceptanceGate";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (e: React.ReactElement) => unknown;
  act: (cb: () => void) => void;
};

describe("N135 Organiser Terms dismissal", () => {
  test("D-1 at the publish door, closing the sheet calls onDismiss", () => {
    const onDismiss = jest.fn();
    sheetCloses.length = 0;
    TestRenderer.act(() => {
      TestRenderer.create(<MinglaToSAcceptanceGate brandId="b" userId="u" onPassed={jest.fn()} onDismiss={onDismiss} />);
    });
    sheetCloses[sheetCloses.length - 1]?.();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("D-2 without onDismiss (payout onboarding) closing does nothing", () => {
    sheetCloses.length = 0;
    const onPassed = jest.fn();
    TestRenderer.act(() => {
      TestRenderer.create(<MinglaToSAcceptanceGate brandId="b" userId="u" onPassed={onPassed} />);
    });
    expect(() => sheetCloses[sheetCloses.length - 1]?.()).not.toThrow();
    expect(onPassed).not.toHaveBeenCalled();
  });
});
