import { describe, expect, test } from "@jest/globals";
import { canSubmitRefundPreview } from "../../discounts/refundDiscountContract";

describe("RefundSheet discounted-order preview", () => {
  test("renders server refund amounts and blocks confirmation on preview failure", () => {
    const ready = {
      submitting: false,
      reasonValid: true,
      canRefund: true,
      hasCurrency: true,
      previewPending: false,
      previewFetching: false,
      previewDebouncing: false,
      previewError: false,
      previewLoaded: true,
      withinRemaining: true,
      previewAmountCents: 1250,
      hasSelection: true,
    };
    expect(canSubmitRefundPreview(ready)).toBe(true);
    expect(canSubmitRefundPreview({ ...ready, previewError: true })).toBe(
      false,
    );
    expect(canSubmitRefundPreview({ ...ready, previewLoaded: false })).toBe(
      false,
    );
    expect(canSubmitRefundPreview({ ...ready, withinRemaining: false })).toBe(
      false,
    );
    expect(canSubmitRefundPreview({ ...ready, previewAmountCents: 0 })).toBe(
      false,
    );
  });
});
