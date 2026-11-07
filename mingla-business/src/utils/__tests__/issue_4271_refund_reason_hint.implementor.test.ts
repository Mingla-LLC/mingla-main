/**
 * #4271 — the refund reason box tells hosts how much more to type.
 *
 * Seth's live refund went through, but the reason box only said "Min 10
 * characters" in grey and "Send refund" stayed disabled with no explanation.
 * Door polish replaced the helper, the "0 / 200" counter and the separate red
 * error with ONE helper line. Pins, for RefundSheet (online orders) and
 * DoorRefundSheet (door sales):
 *   H1  the line counts down: empty -> "At least 10 characters.", short ->
 *       "N more characters needed." (singular at 1), enough -> "" (quiet);
 *   H2  tapping Send while too short keeps the button tappable and the line
 *       turns red: "N more characters needed. Reasons need at least 10.";
 *       a valid reason submits; not-ready stays off;
 *   H3  the "188 / 200" counter appears only from 180 characters.
 *
 * The rendered proof for both sheets is
 * src/components/orders/__tests__/issue_4271_refund_reason.render.test.tsx.
 *
 * FAILS-ON-REVERT: the old helper strings, a counter shown from 0, or a gate
 * that keeps a short reason's Send disabled fails H1/H2/H3.
 */
import { describe, expect, test } from "@jest/globals";

import { refundReasonHelper, refundReasonSendGate } from "../refundReason";

const line = (trimmedLength: number, pressedShort = false, length = trimmedLength) =>
  refundReasonHelper({ trimmedLength, length, minLength: 10, maxLength: 200, pressedShort });

describe("#4271 refund reason countdown", () => {
  test("H1 one helper line counts down to the 10-character minimum", () => {
    expect(line(0)).toEqual({ text: "At least 10 characters.", tone: "hint", counter: null });
    expect(line(1).text).toBe("9 more characters needed.");
    expect(line(3).text).toBe("7 more characters needed.");
    expect(line(9).text).toBe("1 more character needed.");
    expect(line(9).tone).toBe("hint");
    expect(line(10)).toEqual({ text: "", tone: "hint", counter: null });
    expect(line(150).text).toBe("");
  });

  test("H2 tapping Send while too short explains on the same line instead of doing nothing", () => {
    expect(line(3, true)).toEqual({
      text: "7 more characters needed. Reasons need at least 10.",
      tone: "error",
      counter: null,
    });
    expect(line(9, true).text).toBe("1 more character needed. Reasons need at least 10.");
    expect(line(0, true).text).toBe("10 more characters needed. Reasons need at least 10.");
    // Long enough: the red goes, whatever was pressed before.
    expect(line(10, true)).toEqual({ text: "", tone: "hint", counter: null });

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
  });

  test("H3 the counter appears only near the limit", () => {
    expect(line(179).counter).toBeNull();
    expect(line(180).counter).toBe("180 / 200");
    expect(line(186, false, 188).counter).toBe("188 / 200");
    expect(line(200).counter).toBe("200 / 200");
  });
});
