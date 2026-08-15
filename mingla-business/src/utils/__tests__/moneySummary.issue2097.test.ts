import { summarizeEventMoney } from "../moneySummary";

describe("#2097 nullable application-fee refund truth", () => {
  it("withholds exact payout and fee KPIs when a refund fee is unknown", () => {
    const summary = summarizeEventMoney({
      expectedCurrency: "USD",
      doorSales: [],
      orders: [{
        id: "order-2097",
        totalGbpAtPurchase: 10,
        totalCents: 1000,
        refundedAmountGbp: 5,
        refundedAmountCents: 500,
        stripeApplicationFeeAmountCents: 100,
        currency: "USD",
        status: "refunded_partial",
        paymentMethod: "card",
        refunds: [{ amountGbp: 5, applicationFeeRefundedCents: null }],
      }],
    });
    expect(summary.onlineNetMajor).toBeNull();
    expect(summary.stripeFeeOnlineMajor).toBeNull();
    expect(summary.expectedPayoutMajor).toBeNull();
    expect(summary.totalRefunded).toBe(5);
  });
});
