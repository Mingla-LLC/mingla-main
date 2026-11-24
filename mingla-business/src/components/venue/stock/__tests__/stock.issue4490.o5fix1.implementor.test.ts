/**
 * #4490 spec 08 O5 fix 1 (O5-T3): every sold-out line still waiting offers
 * Refund, even after another line of the same order was refunded (the server
 * keeps one refund per line, never one per order).
 */
import { canRefundSoldOutLine } from "../stockModel";

describe("O5-T3 every waiting sold-out line can be refunded", () => {
  test("a second waiting line still offers Refund after the first line's refund", () => {
    const data = { canRefund: true, refundUsed: true };
    expect(canRefundSoldOutLine(data, { resolution: null })).toBe(true);
  });
  test("a resolved line offers nothing; someone without refund rights sees no Refund", () => {
    expect(canRefundSoldOutLine({ canRefund: true }, { resolution: "refund" })).toBe(false);
    expect(canRefundSoldOutLine({ canRefund: true }, { resolution: "swap" })).toBe(false);
    expect(canRefundSoldOutLine({ canRefund: false }, { resolution: null })).toBe(false);
  });
});
