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
 *
 * The rendered proof for both sheets (countdown, inline error, focus, counter)
 * is src/components/orders/__tests__/issue_4271_refund_reason.render.test.tsx.
 *
 * FAILS-ON-REVERT: the old helper text or a gate that keeps a short reason's
 * Send disabled fails H1/H2.
 */
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
});
