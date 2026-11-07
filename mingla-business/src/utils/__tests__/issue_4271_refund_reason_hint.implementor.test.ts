/**
 * #4271 — the refund reason box tells hosts how much more to type.
 *
 * Seth's live refund went through, but the reason box only said "Min 10
 * characters" in grey and "Send refund" stayed disabled with no explanation.
 * Pins, for RefundSheet (online orders) and DoorRefundSheet (door sales):
 *   H1  the helper counts down live: empty -> "Add a reason (10+ characters)",
 *       short -> "Add N more characters" (singular at 1), enough -> "Looks good";
 *   H2  tapping Send while too short shows "Your reason needs at least 10
 *       characters." instead of doing nothing (the button stays tappable when
 *       everything else is ready); a valid reason submits; not-ready stays off;
 *   H3  both sheets render that helper, show the error under the box, focus the
 *       box, keep the "N / 200" counter and the 10-character minimum.
 *
 * FAILS-ON-REVERT: restoring `Min ${REASON_MIN} characters` / `disabled={!canSubmit}`
 * in either sheet, or the old helper text, fails H1/H3.
 */
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

import {
  refundReasonHelperText,
  refundReasonSendGate,
  refundReasonTooShortMessage,
} from "../refundReason";

describe("#4271 refund reason countdown", () => {
  test("H1 helper counts down to the 10-character minimum", () => {
    expect(refundReasonHelperText(0, 10)).toBe("Add a reason (10+ characters)");
    expect(refundReasonHelperText(1, 10)).toBe("Add 9 more characters");
    expect(refundReasonHelperText(8, 10)).toBe("Add 2 more characters");
    expect(refundReasonHelperText(9, 10)).toBe("Add 1 more character");
    expect(refundReasonHelperText(10, 10)).toBe("Looks good");
    expect(refundReasonHelperText(200, 10)).toBe("Looks good");
  });

  test("H2 tapping Send while too short explains instead of doing nothing", () => {
    const base = { minLength: 10, maxLength: 200, otherwiseReady: true };
    expect(refundReasonSendGate({ ...base, trimmedLength: 0 })).toEqual({
      enabled: true,
      onPress: "show_reason_error",
    });
    expect(refundReasonSendGate({ ...base, trimmedLength: 9 })).toEqual({
      enabled: true,
      onPress: "show_reason_error",
    });
    expect(refundReasonSendGate({ ...base, trimmedLength: 10 })).toEqual({
      enabled: true,
      onPress: "submit",
    });
    expect(
      refundReasonSendGate({ ...base, trimmedLength: 3, otherwiseReady: false }),
    ).toEqual({ enabled: false, onPress: "none" });
    expect(refundReasonTooShortMessage(10)).toBe(
      "Your reason needs at least 10 characters.",
    );
  });

  test.each([
    ["src/components/orders/RefundSheet.tsx", "refund-reason-too-short"],
    ["src/components/door/DoorRefundSheet.tsx", "door-refund-reason-too-short"],
  ])("H3 %s wires the countdown, the inline error and focus", (file, testId) => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../..", file),
      "utf8",
    );
    expect(source).toContain("refundReasonHelperText(trimmedLen, REASON_MIN)");
    expect(source).not.toContain("`Min ${REASON_MIN} characters`");
    expect(source).toContain("disabled={!sendGate.enabled}");
    expect(source).not.toMatch(/disabled=\{!canSubmit\}\s*\n\s*accessibilityLabel="Send refund"/);
    const press = source.indexOf('if (sendGate.onPress === "show_reason_error") {');
    expect(press).toBeGreaterThan(-1);
    expect(source.indexOf("setReasonErrorShown(true);", press)).toBeGreaterThan(press);
    expect(source.indexOf("reasonInputRef.current?.focus();", press)).toBeGreaterThan(press);
    expect(source).toContain("ref={reasonInputRef}");
    expect(source).toContain(`testID="${testId}"`);
    expect(source).toContain("refundReasonTooShortMessage(REASON_MIN)");
    // The counter and the minimum are unchanged.
    expect(source).toContain("{trimmedLen} / {REASON_MAX}");
    expect(source).toContain("const REASON_MIN = 10;");
  });
});
